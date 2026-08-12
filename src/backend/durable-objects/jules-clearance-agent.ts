import {
  buildBatchMessage,
  parseClearanceBatchReply,
  CLEARANCE_SYSTEM_PROMPT,
  type ClearanceBatchPage,
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
 * WHY A DO: Jules boots a VM per session, which takes a moment. We must create
 * the session, wait for the VM to be ready, then feed scraped pages in BATCHES
 * and read back one JSON reply per batch — a stateful async loop that would blow
 * the ~15-min `scheduled` wall the old inline sweep already hit. A native-alarm
 * DO owns that loop and, crucially, is COST-BOUNDED like TeslaStreamDO: bounded
 * work per alarm fire, and the alarm is deleted the instant the job is done, so
 * the DO goes dormant (~$0).
 *
 * COST DISCIPLINE (per the owner's directive):
 *   - The DO's onboard SQLite storage is NOT used for job data — only the single
 *     alarm slot plus ONE tiny `jobId` key (needed to find the KV job after an
 *     eviction). All bulk state (session id, link queue, scraped markdown,
 *     results) lives in the `AGENT_ADHOC_MEMORY_KV` binding under a TTL'd key.
 *   - Alarms are native `ctx.storage.setAlarm()` — never the Agents-SDK
 *     `this.schedule()` (the append-only $700 runaway).
 *   - Each alarm fire scrapes at most BATCH_SIZE pages and sends ONE Jules
 *     message, so no single fire runs away.
 *
 * FALLBACK: if the Jules session FAILS, or a batch reply can't be parsed within
 * the in-alarm poll budget, the affected pages are extracted with the Workers-AI
 * fallback (`extractClearance`) so a snapshot is never blanked by a Jules outage.
 */
import { DurableObject } from "cloudflare:workers";

// --- Tunables --------------------------------------------------------------
/** Pages scraped + sent to Jules per alarm fire. Small = each fire stays short. */
const BATCH_SIZE = 3;
/** Re-check cadence while the VM is still booting (QUEUED). */
const BOOT_POLL_MS = 8_000;
/** Re-check cadence right after approving a plan. */
const READY_POLL_MS = 3_000;
/** Gap between successive work batches once the session is ready. */
const WORK_GAP_MS = 2_000;
/** In-alarm wait for a batch reply: attempts × gap ≈ 24s before falling back. */
const REPLY_POLL_ATTEMPTS = 6;
const REPLY_POLL_GAP_MS = 4_000;
/** Hard lifetime ceiling — a stuck job stops itself rather than re-arming forever. */
const MAX_LIFETIME_MS = 20 * 60 * 1_000;
/** KV key namespace + TTL for the job document. */
const KV_PREFIX = "jules:clearance:";
const KV_TTL_SECONDS = 24 * 60 * 60;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface JulesClearanceSummary {
  pages: number;
  recorded: number;
  unchanged: number;
  empty: number;
  errors: number;
  /** Pages that fell back to the Workers-AI extractor (Jules miss/timeout). */
  fallback: number;
}

/** The whole job, persisted in KV (never in DO SQLite). */
interface JulesClearanceJob {
  jobId: string;
  sessionId: string | null;
  links: ClearanceLink[];
  cursor: number;
  startedAt: number;
  status: "booting" | "running" | "fallback" | "done" | "failed";
  summary: JulesClearanceSummary;
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

      const jobId = crypto.randomUUID();
      const job: JulesClearanceJob = {
        jobId,
        sessionId: null,
        links,
        cursor: 0,
        startedAt: Date.now(),
        status: "booting",
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
    if (!job || job.status === "done" || job.status === "failed") {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    // Lifetime ceiling — never re-arm forever.
    if (Date.now() - job.startedAt > MAX_LIFETIME_MS) {
      await this.finish(job, "done");
      return;
    }

    const client = await JulesClient.fromEnv(this.env);
    if (!client) {
      // No key at runtime — degrade the whole remainder to the Workers-AI path.
      job.status = "fallback";
      await this.saveJob(job);
    }

    try {
      if (job.status === "fallback" || !client) {
        await this.runFallbackBatch(job);
        return;
      }

      // Ensure a session exists (creating it boots the VM while we poll).
      if (!job.sessionId) {
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
        // Session died mid-job — finish the rest on the fallback path.
        job.status = "fallback";
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
        // Still QUEUED / PAUSED — VM not ready yet.
        await this.ctx.storage.setAlarm(Date.now() + BOOT_POLL_MS);
        return;
      }

      job.status = "running";
      await this.runJulesBatch(job, client);
    } catch (err) {
      console.error(`[jules-clearance] alarm error (job ${job.jobId}):`, err);
      // Transient — re-arm and retry; the lifetime ceiling bounds the retries.
      await this.saveJob(job);
      await this.ctx.storage.setAlarm(Date.now() + BOOT_POLL_MS);
    }
  }

  /** Process one BATCH_SIZE window via Jules, per-page fallback on any miss. */
  private async runJulesBatch(job: JulesClearanceJob, client: JulesClient): Promise<void> {
    const window = job.links.slice(job.cursor, job.cursor + BATCH_SIZE);

    // Scrape + change-detect. Only CHANGED pages are sent to Jules (an unchanged
    // page costs no analysis — the whole point of content hashing).
    const changed: (ClearanceBatchPage & { storeId: number; hash: string })[] = [];
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
        changed.push({ linkId: link.id, url: link.url, markdown, storeId: link.storeId, hash });
      } catch (err) {
        console.error(`[jules-clearance] scrape failed for ${link.url}:`, err);
        job.summary.errors++;
      }
    }

    if (changed.length > 0) {
      const sentAt = Date.now();
      let resultsByLink = new Map<number, ReturnType<typeof parseClearanceBatchReply>>();
      try {
        await client.sendMessage(job.sessionId!, buildBatchMessage(changed));
        // Poll for the reply within a bounded budget, then give up to fallback.
        let parsed: ReturnType<typeof parseClearanceBatchReply> = null;
        for (let i = 0; i < REPLY_POLL_ATTEMPTS && !parsed; i++) {
          await sleep(REPLY_POLL_GAP_MS);
          const reply = await client.latestAgentReplyAfter(job.sessionId!, sentAt);
          if (reply?.message) parsed = parseClearanceBatchReply(reply.message);
        }
        if (parsed) resultsByLink = new Map(parsed.map((r) => [r.linkId, [r]]));
      } catch (err) {
        console.error(`[jules-clearance] batch send/reply failed:`, err);
      }

      for (const page of changed) {
        const hit = resultsByLink.get(page.linkId)?.[0];
        // ponytail: Jules miss/timeout → Workers-AI fallback for just this page.
        // Upgrade path: persist the pending batch and read the reply on the next
        // alarm instead of falling back, if Jules replies routinely run >24s.
        const details = hit?.details ?? (await extractClearance(this.env, page.url, page.markdown));
        if (!details) {
          job.summary.errors++;
          continue;
        }
        if (!hit) job.summary.fallback++;
        const result = await persistSaleSnapshot(this.env, {
          storeId: page.storeId,
          link: { id: page.linkId, url: page.url },
          contentHash: page.hash,
          details,
        });
        if (result.outcome === "recorded") job.summary.recorded++;
        else if (result.outcome === "empty") job.summary.empty++;
      }
    }

    job.cursor += window.length;
    await this.advance(job);
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
    await this.advance(job);
  }

  /** Re-arm for the next batch, or finish when the queue is exhausted. */
  private async advance(job: JulesClearanceJob): Promise<void> {
    if (job.cursor >= job.links.length) {
      await this.finish(job, "done");
      return;
    }
    await this.saveJob(job);
    await this.ctx.storage.setAlarm(Date.now() + WORK_GAP_MS);
  }

  private async finish(job: JulesClearanceJob, status: "done" | "failed"): Promise<void> {
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
