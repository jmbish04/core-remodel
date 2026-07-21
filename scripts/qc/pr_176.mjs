#!/usr/bin/env node
/**
 * @fileoverview QC for PR #176 — receipt extraction was truncating the totals.
 *
 * Migrations: none (code-only).
 *
 * Run:  pnpm run test:pr 176
 *       pnpm run test:pr 176 -- --preview
 *
 * The bug: `buildPrompt` clamped the email body with `.slice(0, 8000)`. Order
 * summaries sit at the BOTTOM of a commerce email, under a long header of
 * tracking links and image alt text. On the real Costco receipt (12,481 chars)
 * "Subtotal" began at char 8,098 — 98 past the knife. The model never saw a
 * total, returned `invoiceData: null`, and threw away the line items it had
 * already parsed, while flagging "the email does not explicitly state the total
 * amount paid".
 *
 * These checks drive the fix over that exact stored email and assert the
 * amounts reconcile, so a regression to head-only truncation fails loudly.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const client = createClient();
const checks = createChecks();

/** The seeded Costco order confirmation: 1 TOTO + 2 Kohler smart toilets. */
const EMAIL_ID = 3;
const EXPECT = { subtotal: 5599.97, tax: 405.36, total: 5105.33, lineItems: 2 };

async function main() {
  console.log(`\nPR #176 QC → ${client.base}\n`);
  await assertReachable(client, checks);

  const noAuth = await client.get("/api/worker-emails", { auth: false });
  checks.ok("worker-emails rejects an unauthenticated read (401)", noAuth.status === 401, `got ${noAuth.status}`);

  // ── Re-drive extraction over the stored email ─────────────────────────────
  // Before this PR there was no way to do this at all: inbound processing is
  // one-shot, so a failed extraction was stuck permanently.
  const re = await client.post(`/api/worker-emails/${EMAIL_ID}/reprocess`, {});
  checks.ok(
    `POST /api/worker-emails/${EMAIL_ID}/reprocess → 200`,
    re.status === 200,
    `got ${re.status}${re.status === 404 ? " — endpoint missing" : ""}`,
  );
  checks.ok("re-analysis classifies it as a receipt", re.json?.classification === "receipt", `got ${re.json?.classification}`);
  checks.ok("exactly one invoice recorded (re-run replaces, never appends)", re.json?.invoiceCount === 1, `got ${re.json?.invoiceCount}`);

  // ── The amounts that used to be truncated away ────────────────────────────
  const detail = await client.get(`/api/worker-emails/${EMAIL_ID}`);
  checks.ok("GET email detail → 200", detail.status === 200, `got ${detail.status}`);

  const inv = detail.json?.invoices?.[0];
  checks.ok("an invoice was extracted (was null before the fix)", Boolean(inv), "no invoice row");
  if (!inv) return checks.finish();

  checks.info(`vendor=${inv.vendorName} order=${inv.invoiceNumber} date=${inv.invoiceDate}`);
  checks.ok("vendor extracted", Boolean(inv.vendorName), `got ${inv.vendorName}`);

  for (const [field, want] of [["subtotal", EXPECT.subtotal], ["tax", EXPECT.tax], ["total", EXPECT.total]]) {
    checks.ok(
      `${field} = ${want} (lives past char 8,000 — the old truncation point)`,
      Math.abs((inv[field] ?? 0) - want) < 0.005,
      `got ${inv[field]}`,
    );
  }

  // ── Line items, staged for material linking ───────────────────────────────
  const lines = inv.lineItems ?? [];
  checks.ok(`${EXPECT.lineItems} line items staged`, lines.length === EXPECT.lineItems, `got ${lines.length}`);
  for (const li of lines) checks.info(`  ${li.quantity} × ${String(li.description).slice(0, 50)} @${li.unitPrice} = ${li.lineTotal}`);

  checks.ok(
    "every line item is unmatched, awaiting a material link",
    lines.length > 0 && lines.every((li) => li.matchStatus === "unmatched"),
    lines.map((li) => li.matchStatus).join(","),
  );
  checks.ok(
    "quantities survived (2 Kohlers, not 1)",
    lines.some((li) => li.quantity === 2),
    lines.map((li) => li.quantity).join(","),
  );

  // ── The arithmetic reconciles ─────────────────────────────────────────────
  // Catches a partial extraction that looks plausible but dropped an item.
  const lineSum = lines.reduce((a, li) => a + (li.lineTotal ?? 0), 0);
  checks.ok(
    "line totals sum to the subtotal (nothing dropped)",
    Math.abs(lineSum - EXPECT.subtotal) < 0.02,
    `Σ line totals = ${lineSum.toFixed(2)}, subtotal = ${EXPECT.subtotal}`,
  );

  // ── Idempotency ───────────────────────────────────────────────────────────
  // A second run must replace, not accumulate — otherwise every retry doubles
  // the line items a reviewer has to triage.
  const again = await client.post(`/api/worker-emails/${EMAIL_ID}/reprocess`, {});
  checks.ok("second reprocess → 200", again.status === 200, `got ${again.status}`);
  checks.ok("still exactly one invoice after re-running", again.json?.invoiceCount === 1, `got ${again.json?.invoiceCount}`);

  const after = await client.get(`/api/worker-emails/${EMAIL_ID}`);
  checks.ok(
    "line items did not duplicate",
    (after.json?.invoices?.[0]?.lineItems ?? []).length === EXPECT.lineItems,
    `got ${(after.json?.invoices?.[0]?.lineItems ?? []).length}`,
  );

  // ── Guards ────────────────────────────────────────────────────────────────
  const missing = await client.post("/api/worker-emails/999999/reprocess", {});
  checks.ok("reprocessing an unknown email → 404", missing.status === 404, `got ${missing.status}`);

  const list = await client.get("/api/worker-emails");
  checks.ok("email list read path still 200", list.status === 200, `got ${list.status}`);

  checks.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
