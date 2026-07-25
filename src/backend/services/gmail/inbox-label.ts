/**
 * @fileoverview The `core-remodel/inbox` Gmail safety-net.
 *
 * Gmail ingestion normally pulls mail that matches a company's contact
 * addresses (see `ingestion.ts`). Some genuinely relevant email will always
 * slip that net — an unexpected sender, a thread the search terms miss, a
 * one-off. Rather than lose it, the user can drop ANY message into the
 * predictable `core-remodel/inbox` label (from the Gmail app or desktop) and
 * the worker will pull it in on its next poll — a manual override, no
 * configuration, no search-term tuning.
 *
 * Contract:
 *  - the label is created automatically (predictable name, so the user can find
 *    it without being told a var — see `ensureLoopbackLabels`);
 *  - each labelled message is fed through the SAME inbound pipeline as real
 *    inbound mail, forced to the catch-all `general` route (the message was
 *    addressed to the user, not to remodel@, so normal address routing would
 *    reject it — the whole point of the override is to bypass that);
 *  - after ingestion the label is REMOVED from the message, so the next poll
 *    does not reprocess it. The message itself is left in Gmail untouched.
 *
 * Idempotent: the pipeline's Message-ID guard means a message that was already
 * ingested by the normal path is skipped, not duplicated.
 */

import { getGmailAccessToken } from "./auth";
import {
  extractMessage,
  getMessage,
  getRawMessage,
  modifyMessageLabels,
  searchMessages,
} from "./client";
import { ensureLoopbackLabels, LABEL_INBOX } from "@backend/services/health/email-loopback";
import { CATCH_ALL_PROFILE } from "@backend/services/email/routes";
import { processEmail } from "@backend/services/email/pipeline";
import type { RouteDecision } from "@backend/services/email/types";

/** Bound per poll — a safety net is low-volume; cap the work regardless. */
const MAX_PER_POLL = 25;
const WORKER_EMAIL = "remodel@hacolby.app";

/** Force the catch-all route: the message wasn't addressed to us, we're pulling it in on purpose. */
const INBOX_DECISION: RouteDecision = {
  routeId: "general",
  reason: "Manually filed into the core-remodel/inbox Gmail label (safety-net ingestion).",
  profile: CATCH_ALL_PROFILE,
};

export interface IngestInboxLabelResult {
  found: number;
  ingested: number;
  skipped: number;
}

/**
 * Pull every message currently under `core-remodel/inbox` into the inbound
 * pipeline, then unlabel it. Never throws for a single-message failure — it
 * logs and moves on, so one bad message cannot strand the rest.
 */
export async function ingestInboxLabel(env: Env): Promise<IngestInboxLabelResult> {
  const token = await getGmailAccessToken(env);
  const labelIds = await ensureLoopbackLabels(env);
  const inboxLabelId = labelIds[LABEL_INBOX];

  // Quote the full nested-label path — Gmail's search grammar accepts
  // `label:"parent/child"` for hierarchical labels verbatim.
  const messageHits = await searchMessages(token, `label:"${LABEL_INBOX}"`, MAX_PER_POLL);

  let ingested = 0;
  let skipped = 0;
  for (const hit of messageHits) {
    try {
      const full = await getMessage(token, hit.id);
      const extracted = extractMessage(full);
      const raw = await getRawMessage(token, hit.id);
      const messageId = extracted.messageIdHeader || hit.id;

      await processEmail({
        messageId,
        rawEmail: raw,
        from: extracted.from,
        to: extracted.to[0] || WORKER_EMAIL,
        decision: INBOX_DECISION,
        env,
      });

      // Unlabel so we don't reprocess. Leave the message in Gmail otherwise.
      if (inboxLabelId) await modifyMessageLabels(token, hit.id, [], [inboxLabelId]);
      ingested++;
    } catch (err) {
      skipped++;
      console.error(`[gmail/inbox-label] failed to ingest message ${hit.id}:`, err);
    }
  }

  return { found: messageHits.length, ingested, skipped };
}
