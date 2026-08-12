import type { ClearanceDetails } from "@backend/db/schema/showroom/index";

import {
  buildBatchMessage,
  parseClearanceBatchReply,
  CLEARANCE_SYSTEM_PROMPT,
} from "@backend/services/jules/clearance-prompts";
import {
  JulesClient,
  isSessionReady,
  isSessionTerminal,
  type JulesSessionState,
} from "@backend/services/jules/client";
import {
  computeClearanceHash,
  extractClearance,
  isClearanceUnchanged,
  persistSaleSnapshot,
  scrapeClearanceMarkdown,
  sweepSalePage,
  touchClearanceLink,
  type ClearanceLink,
} from "@backend/services/showroom/sales";
/**
 * @fileoverview JulesClearanceAgent — the Durable Object that drives a repoless
 * Jules session as the PRIMARY clearance-extraction worker (0038 Phase B/C).
 *
 * WHY A DO: Jules boots a VM per session, which takes a moment, and then replies
 * to a batch on ITS OWN schedule (often minutes, not seconds). We must create the
 * session, wait for the VM, feed pages in BATCHES, and read back one JSON reply
 * per batch. That is a stateful async loop the ~15-min `scheduled` wall can't hold.
 *
 * THE WAIT IS ALARM-DRIVEN, NOT A BLOCKING SLEEP. After a batch is sent we persist
 * it as `pending` and re-arm the alarm; the NEXT fire checks Jules for the reply.
 * A blocking in-alarm poll would (a) burn DO wall-clock holding a reply that takes
 * minutes and (b) time out before Jules answers — making Jules "primary" in name
 * only while still paying for the VM. The state machine avoids both.
 *
 * COST DISCIPLINE (per the owner's directive + the $700 DO-billing history):
 *   - Native `ctx.storage.setAlarm()` only — never the Agents-SDK `this.schedule()`.
 *   - The DO's SQLite storage holds ONLY the alarm + one tiny `jobId` key; all bulk
 *     state (session id, link queue, in-flight batch, results) lives in a TTL'd KV
 *     key in `AGENT_ADHOC_MEMORY_KV`.
 *   - The Jules SESSION is archived in `finish` (and on the lifetime→fallback flip)
 *     so a booted VM is never leaked on the paid subscription.
 *   - `/start` refuses to clobber an in-flight job (see fetch), so a manual sweep
 *     racing the weekly cron can't sever a running session.
 *   - `MAX_LIFETIME_MS` ceiling: a job that never gets a ready VM drains its
 *     remaining links through the Workers-AI fallback rather than reporting a
 *     clean "done" with nothing extracted.
 *
 * FALLBACK: if Jules FAILS, a reply can't be parsed, or the reply never arrives
 * within the alarm-driven budget, the affected pages are extracted with the
 * Workers-AI fallback (`extractClearance`) so a snapshot is never blanked.
 */
import { DurableObject } from "cloudflare:workers";

// --- Tunables --------------------------------------------------------------
/** Pages scraped + sent to Jules per batch. */
const BATCH_SIZE = 3;
/** Re-check cadence while the VM is still booting (QUEUED). */
const BOOT_POLL_MS = 8_000;
/** Re-check cadence right after approving a plan. */
const READY_POLL_MS = 3_000;
/** Gap between successive work batches once the session is ready. */
const WORK_GAP_MS = 2_000;
/** Alarm cadence while waiting for a batch reply (Jules answers in minutes). */
const REPLY_POLL_MS = 20_000;
/** Reply-wait alarm cycles before a batch falls back to Workers-AI (~2.7 min). */
const REPLY_MAX_CYCLES = 8;
/** Hard lifetime ceiling — past this a job drains to fallback, then stops. */
const MAX_LIFETIME_MS = 30 * 60 * 1_000;
/** KV key namespace + TTL for the job document. */
const KV_PREFIX = "jules:clearance:";
const KV_TTL_SECONDS = 24 * 60 * 60;

export interface JulesClearanceSummary {
  pages: number;
  recorded: number;
  unchanged: number;
  empty: number;
  errors: number;
  /** Pages that fell back to the Workers-AI extractor (Jules miss/timeout). */
  fallback: number;
}

/** A scraped, changed page awaiting its Jules reply (markdown kept for fallback). */
interface PendingPage {
  linkId: number;
  storeId: number;
  url: string;
  hash: string;
  markdown: string;
}

/** The batch sent to Jules and not yet answered. */
interface PendingBatch {
  pages: PendingPage[];
  /** Newest Jules `agentMessaged` createTime (ms) BEFORE the send — the baseline. */
  baseline: number;
  /** Reply-wait alarm cycles elapsed. */
  polls: number;
}

/** The whole job, persisted in KV (never in DO SQLite). */
interface JulesClearanceJob {
  jobId: string;
  sessionId: string | null;
  /** True once a create was attempted, so a caught error can't double-create. */
  sessionRequested: boolean;
  links: ClearanceLink[];
  cursor: number;
  startedAt: number;
  status: "booting" | "running" | "awaiting_reply" | "fallback" | "done" | "failed";
  pending: PendingBatch | null;
  summary: JulesClearanceSummary;
}

function terminalStatus(s: JulesClearanceJob["status"]): boolean {
  return s === "done" || s === "failed";
}

export class JulesClearanceAgent extends DurableObject<Env> {
  private kvKey(jobId: string): string {
    return `${KV_PREFIX}${jobId}`;
  }

  private async loadJob(jobId: string): Promise<JulesClearanceJob | null> {
    return this.env.AGENT_ADHOC_MEMORY_KV.get<JulesClearanceJob>(this.kvKey(jobId), "json");
  }

  private async saveJob(job: JulesClearanceJob): Promise<void> {
    await this.env.AGENT_ADHOC_MEMORY_KV.put(this.kvKey(job.jobId), JSON.stringify(job), {
      expirationTtl: KV_TTL_SECONDS,
    });
  }

  /** HTTP surface: POST /start {links} → begin a job; GET /status?jobId= → read it. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/start") {
      const { links } = (await request.json().catch(() => ({}))) as { links?: ClearanceLink[] };
      if (!links?.length) return Response.json({ ok: false, error: "no links" }, { status: 400 });

      // Refuse to clobber an in-flight job — a manual sweep racing the weekly cron
      // must not sever a running session (which would orphan its KV doc and leak
      // its Jules VM). Return the existing job instead.
      const currentId = await this.ctx.storage.get<string>("jobId");
      if (currentId) {
        const current = await this.loadJob(currentId);
        if (
          current &&
          !terminalStatus(current.status) &&
          Date.now() - current.startedAt < MAX_LIFETIME_MS
        ) {
          return Response.json({
            ok: true,
            jobId: current.jobId,
            links: current.links.length,
            alreadyRunning: true,
          });
        }
      }

      const jobId = crypto.randomUUID();
      const job: JulesClearanceJob = {
        jobId,
        sessionId: null,
        sessionRequested: false,
        links,
        cursor: 0,
        startedAt: Date.now(),
        status: "booting",
        pending: null,
        summary: { pages: 0, recorded: 0, unchanged: 0, empty: 0, errors: 0, fallback: 0 },
      };
      await this.saveJob(job);
      await this.ctx.storage.put("jobId", jobId); // the only DO-storage write besides the alarm
      await this.ctx.storage.setAlarm(Date.now() + 500);
      return Response.json({ ok: true, jobId, links: links.length });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const jobId = url.searchParams.get("jobId") ?? (await this.ctx.storage.get<string>("jobId"));
      const job = jobId ? await this.loadJob(jobId) : null;
      return Response.json({ ok: true, job });
    }

    return new Response("not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const jobId = await this.ctx.storage.get<string>("jobId");
    if (!jobId) return;
    const job = await this.loadJob(jobId);
    if (!job || terminalStatus(job.status)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const client = await JulesClient.fromEnv(this.env);
    // No key at runtime → finish the remainder on the Workers-AI path.
    if (!client && job.status !== "fallback") {
      job.status = "fallback";
      job.pending = null;
      await this.saveJob(job);
    }

    // Lifetime ceiling. Never re-arm forever: drain any remainder to fallback
    // (so a persistently-slow Jules still yields data), else stop.
    if (Date.now() - job.startedAt > MAX_LIFETIME_MS) {
      if (job.status !== "fallback" && job.cursor < job.links.length) {
        await this.archive(client, job);
        job.status = "fallback";
        job.pending = null;
        job.startedAt = Date.now(); // give the fallback drain its own budget
        await this.saveJob(job);
        await this.ctx.storage.setAlarm(Date.now() + WORK_GAP_MS);
        return;
      }
      await this.finish(client, job, "done");
      return;
    }

    try {
      if (job.status === "fallback" || !client) {
        await this.runFallbackBatch(job);
        return;
      }
      if (job.status === "awaiting_reply") {
        await this.handleReply(job, client);
        return;
      }

      // Ensure a session exists (creating it boots the VM while we poll).
      if (!job.sessionId) {
        job.sessionRequested = true;
        await this.saveJob(job); // mark BEFORE the call so a caught error can't double-create
        const session = await client.createRepolessSession(
          CLEARANCE_SYSTEM_PROMPT,
          "core-remodel clearance analysis",
        );
        job.sessionId = session.id;
        job.status = "booting";
        await this.saveJob(job);
        await this.ctx.storage.setAlarm(Date.now() + BOOT_POLL_MS);
        return;
      }

      const state: JulesSessionState = (await client.getSession(job.sessionId)).state;
      if (isSessionTerminal(state)) {
        // Session died mid-job — finish the rest on the fallback path. It's already
        // terminal, so no archive is needed.
        job.status = "fallback";
        job.sessionId = null;
        job.pending = null;
        await this.saveJob(job);
        await this.ctx.storage.setAlarm(Date.now() + WORK_GAP_MS);
        return;
      }
      if (state === "AWAITING_PLAN_APPROVAL") {
        await client.approvePlan(job.sessionId);
        await this.ctx.storage.setAlarm(Date.now() + READY_POLL_MS);
        return;
      }
      if (!isSessionReady(state)) {
        await this.ctx.storage.setAlarm(Date.now() + BOOT_POLL_MS); // still QUEUED / PAUSED
        return;
      }

      job.status = "running";
      await this.scrapeAndSend(job, client);
    } catch (err) {
      console.error(`[jules-clearance] alarm error (job ${job.jobId}):`, err);
      await this.saveJob(job);
      await this.ctx.storage.setAlarm(Date.now() + BOOT_POLL_MS); // transient — retry, bounded by lifetime
    }
  }

  /**
   * Scrape the next window, change-detect, and SEND the changed pages to Jules.
   * Does NOT wait for the reply — it persists the batch as `pending` and re-arms;
   * `handleReply` picks it up on a later fire.
   */
  private async scrapeAndSend(job: JulesClearanceJob, client: JulesClient): Promise<void> {
    const window = job.links.slice(job.cursor, job.cursor + BATCH_SIZE);
    const changed: PendingPage[] = [];
    for (const link of window) {
      await touchClearanceLink(this.env, link.id);
      job.summary.pages++;
      try {
        const markdown = await scrapeClearanceMarkdown(this.env, link.url);
        if (!markdown) {
          job.summary.errors++;
          continue;
        }
        const hash = await computeClearanceHash(markdown);
        if (await isClearanceUnchanged(this.env, link.id, hash)) {
          job.summary.unchanged++;
          continue;
        }
        changed.push({ linkId: link.id, storeId: link.storeId, url: link.url, hash, markdown });
      } catch (err) {
        console.error(`[jules-clearance] scrape failed for ${link.url}:`, err);
        job.summary.errors++;
      }
    }

    if (changed.length === 0) {
      job.cursor += window.length;
      await this.advance(client, job); // nothing to send this window
      return;
    }

    // Baseline on JULES's own timeline BEFORE the send, so the reply is detected
    // as newer-than-baseline without ever comparing against the Worker's clock.
    // Advance the cursor only AFTER the send succeeds — if sendMessage throws, the
    // caught error re-arms and the whole window is retried rather than dropped.
    const baseline = await client.baselineReplyTime(job.sessionId!).catch(() => 0);
    await client.sendMessage(job.sessionId!, buildBatchMessage(changed));
    job.cursor += window.length;
    job.pending = { pages: changed, baseline, polls: 0 };
    job.status = "awaiting_reply";
    await this.saveJob(job);
    await this.ctx.storage.setAlarm(Date.now() + REPLY_POLL_MS);
  }

  /** Check for the pending batch's reply; persist it, or fall back after the budget. */
  private async handleReply(job: JulesClearanceJob, client: JulesClient): Promise<void> {
    const pending = job.pending!;
    let parsed: ReturnType<typeof parseClearanceBatchReply> = null;
    try {
      const reply = await client.latestAgentReplyAfter(job.sessionId!, pending.baseline);
      if (reply?.message) parsed = parseClearanceBatchReply(reply.message);
    } catch (err) {
      console.error(`[jules-clearance] reply poll failed:`, err);
    }

    if (!parsed) {
      pending.polls++;
      if (pending.polls < REPLY_MAX_CYCLES) {
        await this.saveJob(job);
        await this.ctx.storage.setAlarm(Date.now() + REPLY_POLL_MS);
        return;
      }
      // Budget exhausted — extract this batch on the fallback and move on.
      await this.persistPending(job, new Map());
      return;
    }

    const byLink = new Map(parsed.map((r) => [r.linkId, r.details]));
    await this.persistPending(job, byLink);
  }

  /** Persist each pending page from Jules (or the per-page Workers-AI fallback). */
  private async persistPending(
    job: JulesClearanceJob,
    byLink: Map<number, ClearanceDetails>,
  ): Promise<void> {
    for (const page of job.pending!.pages) {
      // ponytail: Jules hit, else Workers-AI fallback for just this page.
      const details =
        byLink.get(page.linkId) ?? (await extractClearance(this.env, page.url, page.markdown));
      if (!details) {
        job.summary.errors++;
        continue;
      }
      if (!byLink.has(page.linkId)) job.summary.fallback++;
      const result = await persistSaleSnapshot(this.env, {
        storeId: page.storeId,
        link: { id: page.linkId, url: page.url },
        contentHash: page.hash,
        details,
      });
      if (result.outcome === "recorded") job.summary.recorded++;
      else if (result.outcome === "empty") job.summary.empty++;
    }
    job.pending = null;
    job.status = "running";
    await this.advance(await JulesClient.fromEnv(this.env), job);
  }

  /** Process one BATCH_SIZE window entirely on the Workers-AI fallback sweep. */
  private async runFallbackBatch(job: JulesClearanceJob): Promise<void> {
    const window = job.links.slice(job.cursor, job.cursor + BATCH_SIZE);
    for (const link of window) {
      const result = await sweepSalePage(this.env, link.storeId, link);
      job.summary.pages++;
      job.summary.fallback++;
      if (result.outcome === "recorded") job.summary.recorded++;
      else if (result.outcome === "unchanged") job.summary.unchanged++;
      else if (result.outcome === "empty") job.summary.empty++;
      else job.summary.errors++;
    }
    job.cursor += window.length;
    await this.advance(null, job);
  }

  /** Re-arm for the next batch, or finish when the queue is exhausted. */
  private async advance(client: JulesClient | null, job: JulesClearanceJob): Promise<void> {
    if (job.cursor >= job.links.length) {
      await this.finish(client, job, "done");
      return;
    }
    await this.saveJob(job);
    await this.ctx.storage.setAlarm(Date.now() + WORK_GAP_MS);
  }

  /** Best-effort session teardown so a booted Jules VM is never leaked. */
  private async archive(client: JulesClient | null, job: JulesClearanceJob): Promise<void> {
    if (!client || !job.sessionId) return;
    try {
      await client.archiveSession(job.sessionId);
    } catch (err) {
      console.error(`[jules-clearance] archive failed for session ${job.sessionId}:`, err);
    }
    job.sessionId = null;
  }

  private async finish(
    client: JulesClient | null,
    job: JulesClearanceJob,
    status: "done" | "failed",
  ): Promise<void> {
    await this.archive(client, job);
    job.status = status;
    await this.saveJob(job);
    await this.ctx.storage.deleteAlarm();
    console.info(
      `[jules-clearance] job ${job.jobId} ${status}: ${job.summary.pages} pages — ` +
        `${job.summary.recorded} recorded, ${job.summary.unchanged} unchanged, ${job.summary.empty} empty, ` +
        `${job.summary.errors} errors, ${job.summary.fallback} fallback`,
    );
  }
}
