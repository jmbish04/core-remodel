#!/usr/bin/env node
/**
 * QC for PR #310 — 0041 store inbox + ingestion gating.
 *   node scripts/qc/pr_310.mjs --preview   (new surface: this branch's worker)
 *   node scripts/qc/pr_310.mjs             (prod regression — main)
 *
 * Read-only + idempotent. Exercises the new inbox surface on --preview and acts
 * as a regression guard on prod (where the new folder/counts shape is absent
 * until merge+deploy — reported as "pending", not a hard failure).
 */
import { createClient, createChecks, resolveBase, assertReachable } from "../config.mjs";

const BASE = resolveBase();
const IS_PREVIEW = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_310 (store-inbox) against ${BASE}${IS_PREVIEW ? " [preview]" : ""}\n`);

const FOLDERS = ["inbox", "receipts", "spam", "trash"];

await assertReachable(c, { ok: check });

// Find a showroom that has matched mail (fall back to the user's example, 222).
let storeId = 222;
const probe = await c.get(`/api/gmail/showrooms/${storeId}/threads-by-domain?folder=inbox`);
const hasNewSurface = probe.status === 200 && probe.json && typeof probe.json.counts === "object";

if (!hasNewSurface) {
  info(
    probe.status === 200
      ? "folder/counts shape absent → running against main (pre-merge). Pending deploy; regression-only."
      : `threads-by-domain status=${probe.status}`,
  );
  // On prod pre-merge the legacy route still returns 200 with a threads[] array.
  check("legacy showroom inbox still returns 200 (regression)", probe.status === 200, `status=${probe.status}`);
  process.exit(summary().failed === 0 ? 0 : 1);
}

// ── New surface (preview / post-deploy) ──────────────────────────────────────
for (const folder of FOLDERS) {
  const r = await c.get(`/api/gmail/showrooms/${storeId}/threads-by-domain?folder=${folder}`);
  const j = r.json ?? {};
  check(
    `folder=${folder} → 200 with counts + folder echo`,
    r.status === 200 && j.folder === folder && j.counts && FOLDERS.every((f) => typeof j.counts[f] === "number"),
    `status=${r.status} folder=${j.folder} counts=${JSON.stringify(j.counts)}`,
  );
}

// getThread returns the new per-message fields + attachment/image arrays.
const inbox = await c.get(`/api/gmail/showrooms/${storeId}/threads-by-domain?folder=inbox`);
const tid = inbox.json?.threads?.[0]?.threadId;
if (tid) {
  const t = await c.get(`/api/gmail/threads/${encodeURIComponent(tid)}`);
  const m = t.json?.messages?.[0] ?? {};
  check(
    "getThread returns attachments[] + images[] arrays",
    Array.isArray(t.json?.attachments) && Array.isArray(t.json?.images),
    `status=${t.status}`,
  );
  check(
    "message carries bodyVisible/bodyQuoted/classification/isSpam",
    ["bodyVisible", "bodyQuoted", "classification", "isSpam"].every((k) => k in m),
    `keys=${Object.keys(m).join(",")}`,
  );
} else {
  info("no inbox threads to inspect getThread — skipped");
}

// Spam folder: the Rejuvenation sender rule (if that mail is present here).
const spam = await c.get(`/api/gmail/showrooms/${storeId}/threads-by-domain?folder=spam`);
const rej = (spam.json?.threads ?? []).some(
  (th) => (th.spamRationale || "").includes("rejuvenation@e.rejuvenation.com"),
);
if (rej) check("rejuvenation@e.rejuvenation.com foldered as Spam with rationale", true, "found");
else info("no Rejuvenation mail under this store's Spam (store-dependent) — skipped");

// backfill-classification is idempotent (one small page).
const bf = await c.post(`/api/gmail/backfill-classification?limit=1`, undefined);
check(
  "POST /backfill-classification → 200 (idempotent)",
  bf.status === 200 && typeof bf.json?.processedMessages === "number",
  `status=${bf.status} ${JSON.stringify(bf.json)?.slice(0, 120)}`,
);

// Reply validation: empty body rejected before any send (non-mutating).
const badReply = await c.post(`/api/gmail/threads/nonexistent/reply`, {});
check("reply with no body/markdown/html → 400", badReply.status === 400, `status=${badReply.status}`);

// draft-assist requires threadId (non-spending validation).
const badDraft = await c.post(`/api/gmail/draft-assist`, {});
check("draft-assist without threadId → 400", badDraft.status === 400, `status=${badDraft.status}`);

process.exit(summary().failed === 0 ? 0 : 1);
