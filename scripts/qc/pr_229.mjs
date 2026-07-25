#!/usr/bin/env node
/**
 * @fileoverview QC for PR #229 — joint receipt→room allocation.
 *
 * Migrations: 0139 (material_schedule_items.quantity + source_line_item_id,
 *             material_room_proposals.unit_index + application)
 *
 * Run:  pnpm run test:pr 229 -- --preview
 *       pnpm run test:pr 229                 # production, after merge+deploy
 *
 * The bug this replaces: the shipped per-line deduction proposed 1 TOTO + 2
 * Kohler toilets ALL to the Primary bath, because each line was ranked in
 * isolation and a qty-2 line never split. The joint allocator reasons about the
 * whole receipt at once. This drives it over the REAL Costco receipt (email 3)
 * and asserts the outcome a seasoned rep would produce: premium unit in the
 * primary, identical pair across the two distinct secondary baths.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const client = createClient();
const checks = createChecks();

const EMAIL_ID = 3;

/** Read proposals for a status, tolerant of {proposals:[]} or a bare array. */
async function proposals(status) {
  const r = await client.get(`/api/materials/room-proposals?status=${status}`);
  const body = r.json?.proposals ?? r.json ?? [];
  return { status: r.status, list: Array.isArray(body) ? body : [] };
}

async function main() {
  console.log(`\nPR #229 QC → ${client.base}\n`);
  await assertReachable(client, checks);

  const noAuth = await client.get("/api/materials/room-proposals", { auth: false });
  checks.ok("proposals read rejects unauthenticated (401)", noAuth.status === 401, `got ${noAuth.status}`);

  // ── Re-stage the real receipt through the joint allocator ─────────────────
  const re = await client.post(`/api/worker-emails/${EMAIL_ID}/reprocess`, {});
  checks.ok(
    `POST /worker-emails/${EMAIL_ID}/reprocess → 200 (migration 0139 applied)`,
    re.status === 200,
    `got ${re.status}${re.status === 500 ? " — run migrate:remote" : ""}`,
  );
  // Give the best-effort staging a moment to finish under ctx.waitUntil.
  await new Promise((r) => setTimeout(r, 3000));

  const staged = await proposals("staged");
  checks.ok("staged proposals read → 200", staged.status === 200, `got ${staged.status}`);

  const toilets = staged.list.filter((p) => (p.subcategoryName ?? "").toLowerCase() === "toilet");
  checks.info(
    `toilet proposals: ${toilets.map((t) => `"${(t.title ?? "").slice(0, 18)}"→${t.proposedRoomName}`).join(" | ")}`,
  );

  // ── THREE toilets, not one line ───────────────────────────────────────────
  // The qty-2 Kohler line must explode into two unit-proposals; with the single
  // TOTO that is three toilet proposals total.
  checks.ok(
    "the qty-2 Kohler line split into units → 3 toilet proposals total",
    toilets.length === 3,
    `got ${toilets.length} — a qty-2 line was not exploded`,
  );

  // ── THREE DISTINCT rooms — the collision this PR fixes ────────────────────
  const rooms = toilets.map((t) => t.proposedRoomId).filter((x) => x != null);
  const distinct = new Set(rooms);
  checks.ok(
    "the three toilets land in three DISTINCT rooms (no double-Primary)",
    rooms.length === 3 && distinct.size === 3,
    `rooms=${JSON.stringify(toilets.map((t) => t.proposedRoomName))}`,
  );

  // ── Premium unit → Primary ────────────────────────────────────────────────
  const toto = toilets.find((t) => (t.title ?? "").toUpperCase().includes("TOTO"));
  checks.ok(
    "the premium TOTO is placed in the Primary Bathroom",
    /primary/i.test(toto?.proposedRoomName ?? ""),
    `TOTO → ${toto?.proposedRoomName}`,
  );

  // ── The identical Kohler pair is split across the two secondaries ─────────
  const kohlers = toilets.filter((t) => (t.title ?? "").toUpperCase().includes("KOHLER"));
  checks.ok("the identical Kohler pair is two proposals", kohlers.length === 2, `got ${kohlers.length}`);
  checks.ok(
    "the two Kohlers are in two different rooms",
    kohlers.length === 2 && kohlers[0].proposedRoomId !== kohlers[1].proposedRoomId,
    `${kohlers.map((k) => k.proposedRoomName).join(" vs ")}`,
  );
  checks.ok(
    "neither Kohler is in the Primary (reserved for the premium unit)",
    kohlers.every((k) => !/primary/i.test(k.proposedRoomName ?? "")),
    `${kohlers.map((k) => k.proposedRoomName).join(", ")}`,
  );

  // ── Every proposal shows its work ─────────────────────────────────────────
  checks.ok(
    "every toilet proposal carries an application",
    toilets.every((t) => typeof t.application === "string" && t.application.length > 0),
    JSON.stringify(toilets.map((t) => t.application)),
  );
  checks.ok(
    "every toilet proposal carries reasoning",
    toilets.every((t) => typeof t.reasoningMarkdown === "string" && t.reasoningMarkdown.length > 0),
    "a proposal has no reasoning",
  );
  checks.ok(
    "proposals expose invoiceId for receipt grouping",
    toilets.every((t) => t.invoiceId != null),
    "a proposal is missing invoiceId",
  );
  checks.ok(
    "the split units carry distinct unitIndex",
    new Set(kohlers.map((k) => k.unitIndex)).size === kohlers.length,
    `unitIndex: ${kohlers.map((k) => k.unitIndex).join(",")}`,
  );

  // ── Nothing auto-committed an ambiguous multi-unit receipt ────────────────
  // All three toilets were a CHOICE among rooms, so none may auto-confirm.
  const auto = await proposals("auto_confirmed");
  const autoToilets = auto.list.filter(
    (p) => (p.subcategoryName ?? "").toLowerCase() === "toilet" && p.invoiceId != null,
  );
  checks.ok(
    "no toilet from this receipt was auto-committed (ambiguous → staged)",
    autoToilets.length === 0,
    `${autoToilets.length} auto-confirmed toilets`,
  );

  checks.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
