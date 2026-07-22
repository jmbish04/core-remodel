/**
 * @fileoverview Email round-trip health — the state machine behind the two
 * loopback probes.
 *
 * Goal: prove BOTH directions of the mail pipeline end-to-end, the way a user
 * would experience them —
 *   Leg 1 (Gmail → worker): send a real email FROM justin@126colby.com TO the
 *     worker inbox (remodel@hacolby.app) and confirm (a) it arrived and (b) the
 *     worker stored the body we planted, so extraction works.
 *   Leg 2 (worker → Gmail): have the worker reply BACK to Gmail and confirm
 *     (c) Gmail received it and (d) the body we planted extracts correctly.
 *
 * Why a state machine and not one synchronous probe: real SMTP delivery takes
 * seconds-to-minutes, far past a probe's 10s budget. So a cycle is ADVANCED one
 * step per health session — send on one run, verify on a later one. The probes
 * only read the latest cycle (`getLatestLoopback`); this module owns every send
 * and transition. `advanceEmailLoopback` never throws: a failed step is recorded
 * on the row and surfaced by the probes, it does not sink the health session.
 *
 * Cost/noise guards:
 *  - a new cycle starts at most once per {@link MIN_CYCLE_INTERVAL_MS}, so
 *    clicking Run repeatedly cannot spam the mailbox;
 *  - the Gmail→worker probe email is short-circuited in the inbound pipeline
 *    (subject prefix {@link SUBJECT_PREFIX}) so it never burns an AI classify;
 *  - the sent probe email is labelled `core-remodel/unit-testing` in Gmail so
 *    the user can bulk-archive/delete these, and the worker_emails row is
 *    DELETED once the cycle completes.
 */

import { EmailMessage } from "cloudflare:email";
import { desc, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { healthEmailLoopback, workerEmails } from "@backend/db";
import { getGmailAccessToken } from "@backend/services/gmail/auth";
import {
  buildComposeRaw,
  ensureLabel,
  extractMessage,
  getMessage,
  modifyMessageLabels,
  searchMessages,
  sendMessage,
} from "@backend/services/gmail/client";

import {
  checkNumber,
  extractionMatches,
  LABEL_INBOX,
  LABEL_UNIT_TESTING,
  probeBody,
  SUBJECT_PREFIX,
  WORKER_LABEL_NS,
} from "./email-loopback-markers";

// Re-export the pure marker surface so existing importers keep one entry point.
export {
  isHealthcheckSubject,
  LABEL_INBOX,
  LABEL_UNIT_TESTING,
  SUBJECT_PREFIX,
  WORKER_LABEL_NS,
} from "./email-loopback-markers";

/** The Workspace user the service account impersonates (also the human end of the loop). */
const GMAIL_USER = "justin@126colby.com";
/** The worker's own inbound address (Cloudflare Email Routing → the `email()` handler). */
const WORKER_EMAIL = "remodel@hacolby.app";

/** A cycle starts at most this often, however many times Run is clicked. */
const MIN_CYCLE_INTERVAL_MS = 5 * 60 * 1000;
/** A leg that has not arrived within this window is declared dead (not merely in-flight). */
const LEG_EXPIRY_MS = 6 * 60 * 60 * 1000;

type LoopbackRow = typeof healthEmailLoopback.$inferSelect;

/** Build a raw RFC-822 message for `env.EMAIL.send()` (plain text). */
function rawMime(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject.replace(/[\r\n]+/g, " ")}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.inReplyTo}`);
  return `${lines.join("\r\n")}\r\n\r\n${opts.body}`;
}

/** Ensure the three standard Gmail labels exist. Idempotent; safe to call every run. */
export async function ensureLoopbackLabels(env: Env): Promise<Record<string, string>> {
  const token = await getGmailAccessToken(env, GMAIL_USER);
  const [ns, unit, inbox] = await Promise.all([
    ensureLabel(token, WORKER_LABEL_NS),
    ensureLabel(token, LABEL_UNIT_TESTING),
    ensureLabel(token, LABEL_INBOX),
  ]);
  return { [WORKER_LABEL_NS]: ns, [LABEL_UNIT_TESTING]: unit, [LABEL_INBOX]: inbox };
}

/** The most recent cycle (any stage). The probes read this. */
export async function getLatestLoopback(env: Env): Promise<LoopbackRow | null> {
  const db = drizzle(env.DB);
  const [row] = await db
    .select()
    .from(healthEmailLoopback)
    .orderBy(desc(healthEmailLoopback.startedAt), desc(healthEmailLoopback.id))
    .limit(1);
  return row ?? null;
}

const isTerminal = (stage: string) => stage === "complete" || stage === "failed" || stage === "expired";

/**
 * Advance the loopback one step. Called from `runHealthSession` on every
 * human/MCP/API health screen (never the per-minute cron). Never throws.
 */
export async function advanceEmailLoopback(env: Env): Promise<{ action: string; token?: string }> {
  try {
    const labels = await ensureLoopbackLabels(env).catch(() => null);
    const latest = await getLatestLoopback(env);
    const now = Date.now();

    // ── Start a new cycle when there is no active one (throttled) ────────────
    if (!latest || isTerminal(latest.stage)) {
      if (latest && now - latest.startedAt.getTime() < MIN_CYCLE_INTERVAL_MS) {
        return { action: "throttled" };
      }
      return await startCycle(env, labels?.[LABEL_UNIT_TESTING] ?? null);
    }

    // ── Leg 1 pending: has the worker received + stored it? ──────────────────
    if (latest.stage === "sent_g2w") {
      return await advanceLeg1(env, latest, now);
    }

    // ── Leg 2 pending: has Gmail received the worker's reply? ────────────────
    if (latest.stage === "sent_w2g") {
      return await advanceLeg2(env, latest, now);
    }

    return { action: "noop" };
  } catch (err) {
    console.error("[health/email-loopback] advance failed:", err);
    return { action: "error" };
  }
}

async function startCycle(env: Env, unitLabelId: string | null): Promise<{ action: string; token: string }> {
  const db = drizzle(env.DB);
  const token = `hlb_${crypto.randomUUID().slice(0, 12)}`;
  const n1 = checkNumber();
  const n2 = checkNumber();
  const subject = `${SUBJECT_PREFIX} ${token}`;

  const gToken = await getGmailAccessToken(env, GMAIL_USER);
  const raw = buildComposeRaw({
    from: GMAIL_USER,
    to: [WORKER_EMAIL],
    subject,
    body: probeBody(token, n1, "outbound"),
  });
  const sent = await sendMessage(gToken, raw);
  if (unitLabelId) {
    await modifyMessageLabels(gToken, sent.id, [unitLabelId]).catch((e) =>
      console.error("[health/email-loopback] label apply failed:", e),
    );
  }

  await db.insert(healthEmailLoopback).values({
    token,
    stage: "sent_g2w",
    g2wExpected: n1,
    w2gExpected: n2,
    g2wGmailMessageId: sent.id,
  });
  return { action: "started", token };
}

async function advanceLeg1(env: Env, row: LoopbackRow, now: number): Promise<{ action: string; token: string }> {
  const db = drizzle(env.DB);
  // The inbound pipeline stores the probe email in worker_emails with our token
  // in the subject. Find it (idempotency guard in the pipeline makes this 0-or-1).
  const [inbound] = await db
    .select({ id: workerEmails.id, bodyText: workerEmails.bodyText })
    .from(workerEmails)
    .where(like(workerEmails.subject, `%${row.token}%`))
    .limit(1);

  if (!inbound) {
    if (now - row.startedAt.getTime() > LEG_EXPIRY_MS) {
      await db
        .update(healthEmailLoopback)
        .set({
          stage: "expired",
          finishedAt: new Date(),
          updatedAt: new Date(),
          lastError: "Gmail→worker email never arrived within 6h.",
        })
        .where(eq(healthEmailLoopback.id, row.id));
      return { action: "expired-leg1", token: row.token };
    }
    return { action: "awaiting-leg1", token: row.token };
  }

  const extractOk = extractionMatches(inbound.bodyText, row.token, row.g2wExpected);

  // Reply worker → Gmail (leg 2).
  const replySubject = `Re: ${SUBJECT_PREFIX} ${row.token}`;
  const message = new EmailMessage(
    WORKER_EMAIL,
    GMAIL_USER,
    rawMime({
      from: WORKER_EMAIL,
      to: GMAIL_USER,
      subject: replySubject,
      body: probeBody(row.token, row.w2gExpected, "reply"),
    }),
  );
  await env.EMAIL.send(message);

  await db
    .update(healthEmailLoopback)
    .set({
      stage: "sent_w2g",
      g2wReceived: true,
      g2wExtractOk: extractOk,
      g2wWorkerEmailId: inbound.id,
      updatedAt: new Date(),
    })
    .where(eq(healthEmailLoopback.id, row.id));
  return { action: "sent-reply", token: row.token };
}

async function advanceLeg2(env: Env, row: LoopbackRow, now: number): Promise<{ action: string; token: string }> {
  const db = drizzle(env.DB);
  const gToken = await getGmailAccessToken(env, GMAIL_USER);
  // The worker's reply, back in Gmail: from the worker address, carrying the token.
  const hits = await searchMessages(gToken, `from:${WORKER_EMAIL} "${row.token}"`, 5);

  if (hits.length === 0) {
    if (now - row.startedAt.getTime() > LEG_EXPIRY_MS) {
      await db
        .update(healthEmailLoopback)
        .set({
          stage: "failed",
          finishedAt: new Date(),
          updatedAt: new Date(),
          lastError: "Worker→Gmail reply never arrived back in Gmail within 6h.",
        })
        .where(eq(healthEmailLoopback.id, row.id));
      await cleanupWorkerEmail(env, row.g2wWorkerEmailId);
      return { action: "failed-leg2", token: row.token };
    }
    return { action: "awaiting-leg2", token: row.token };
  }

  const full = await getMessage(gToken, hits[0].id);
  const extractOk = extractionMatches(extractMessage(full).body, row.token, row.w2gExpected);

  await db
    .update(healthEmailLoopback)
    .set({
      stage: "complete",
      w2gReceived: true,
      w2gExtractOk: extractOk,
      w2gGmailMessageId: hits[0].id,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(healthEmailLoopback.id, row.id));

  // Keep the worker inbox clean — delete the probe row now the cycle is done.
  // Gmail is left alone (the sent + reply live under core-remodel/unit-testing).
  await cleanupWorkerEmail(env, row.g2wWorkerEmailId);
  return { action: "complete", token: row.token };
}

/** Delete the probe's worker_emails row (best-effort — a leftover row is cosmetic). */
async function cleanupWorkerEmail(env: Env, emailId: number | null): Promise<void> {
  if (emailId == null) return;
  try {
    const db = drizzle(env.DB);
    await db.delete(workerEmails).where(eq(workerEmails.id, emailId));
  } catch (e) {
    console.error("[health/email-loopback] worker_emails cleanup failed:", e);
  }
}
