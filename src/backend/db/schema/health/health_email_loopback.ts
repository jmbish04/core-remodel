import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Email round-trip health cycles (0030).
 *
 * The two email-loopback probes cannot be synchronous: a real Gmail → Cloudflare
 * Email Routing delivery takes seconds to minutes, far past a probe's 10s
 * timeout. So a cycle is a small state machine persisted here, and it is
 * ADVANCED one step per health session — send on one run, verify-receipt on a
 * later one. The probes only READ the latest cycle; `advanceEmailLoopback`
 * (services/health/email-loopback.ts) does the sending and the transitions.
 *
 * One row = one full round-trip attempt:
 *   1. `stage=sent_g2w`  — a probe email was sent FROM Gmail (justin@126colby)
 *      TO the worker inbox (remodel@hacolby.app), carrying a unique token + a
 *      known number the worker is expected to store verbatim.
 *   2. `stage=sent_w2g`  — the worker email arrived, its body extracted as
 *      expected, and the worker replied FROM its address BACK to Gmail with a
 *      second token + number.
 *   3. `stage=complete`  — Gmail received the worker's reply and its body
 *      extracted as expected. All four checks passed.
 *   `failed` / `expired` are terminal too (a leg never arrived within the window).
 */
export const HEALTH_EMAIL_LOOPBACK_STAGES = [
  "sent_g2w",
  "sent_w2g",
  "complete",
  "failed",
  "expired",
] as const;

export const healthEmailLoopback = sqliteTable(
  "health_email_loopback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Unique per cycle. Embedded in both legs' subject+body; the join key across systems. */
    token: text("token").notNull(),
    stage: text("stage", { enum: HEALTH_EMAIL_LOOPBACK_STAGES }).notNull().default("sent_g2w"),

    startedAt: integer("started_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    finishedAt: integer("finished_at", { mode: "timestamp" }),

    // ── Leg 1: Gmail → worker ────────────────────────────────────────────────
    /** The known number planted in the Gmail→worker body; success = the worker stored it. */
    g2wExpected: integer("g2w_expected").notNull(),
    /** Gmail message id of the sent probe email (in justin's Sent). */
    g2wGmailMessageId: text("g2w_gmail_message_id"),
    /** worker_emails.id once the inbound message lands (also what we delete on cleanup). */
    g2wWorkerEmailId: integer("g2w_worker_email_id"),
    g2wReceived: integer("g2w_received", { mode: "boolean" }).notNull().default(false),
    g2wExtractOk: integer("g2w_extract_ok", { mode: "boolean" }).notNull().default(false),

    // ── Leg 2: worker → Gmail ────────────────────────────────────────────────
    /** The known number planted in the worker→Gmail reply; success = Gmail delivered it back. */
    w2gExpected: integer("w2g_expected").notNull(),
    /** Gmail message id of the worker's reply once found by search. */
    w2gGmailMessageId: text("w2g_gmail_message_id"),
    w2gReceived: integer("w2g_received", { mode: "boolean" }).notNull().default(false),
    w2gExtractOk: integer("w2g_extract_ok", { mode: "boolean" }).notNull().default(false),

    /** Last error / reason, surfaced by the probes. */
    lastError: text("last_error"),
  },
  (t) => ({
    tokenIdx: uniqueIndex("health_email_loopback_token_idx").on(t.token),
    startedIdx: index("health_email_loopback_started_idx").on(t.startedAt),
  }),
);
