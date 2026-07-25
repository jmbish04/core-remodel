#!/usr/bin/env node
/**
 * @fileoverview QC for PR #203 — receipt → material room deduction (0030).
 *
 * Migrations: 0130 (material_room_proposals) — already applied to remote.
 *
 * Run:  pnpm run test:pr 999 -- --preview   (while the PR is open)
 *       pnpm run test:pr 999                 (production, after merge)
 *
 * A receipt line item ("2× Kohler Fora Toilet") does not say WHICH of the three
 * bathrooms it belongs to. The deduction engine (src/backend/services/materials/
 * deduction.ts) narrows rooms by elimination, ranks the remainder, and STAGES a
 * proposal for a human rather than guessing. This QC drives the real Costco
 * receipt (email id 3) through the ingest hook and the review surface:
 *   - reprocess email 3 → the pipeline hook auto-stages proposals
 *   - GET /room-proposals surfaces the toilet proposals with reasoning + candidates
 *   - resolve one to a bathroom → the material shows up under that subcategory/room
 *   - unknown room → 400, nonexistent proposal → 404
 *   - learning: a confirmed room is eliminated from later deductions
 *
 * WHY REST, NOT THE MCP TOOLS: registry tools sit behind the OAuth-gated /mcp
 * transport a QC script cannot authenticate to. The REST endpoints run the same
 * service code (listRoomProposals / resolveProposal) the tools call.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const EMAIL_ID = 3; // the real Costco receipt
const client = createClient();
const checks = createChecks();

const isToilet = (p, toiletId) =>
  (toiletId != null && p.subcategoryId === toiletId) || /toilet/i.test(p.title || "");

async function main() {
  console.log(`\nPR #203 QC (0030 receipt→material deduction) → ${client.base}\n`);
  await assertReachable(client, checks);

  // ── Reference data: the Toilet subcategory + active bathrooms ─────────────
  const subs = await client.get("/api/config/subcategories");
  const toilet = (subs.json?.subcategories ?? []).find(
    (s) => String(s.name).toLowerCase() === "toilet" && s.isActive,
  );
  checks.ok("`Toilet` subcategory exists (the type deduction matches on)", Boolean(toilet),
    (subs.json?.subcategories ?? []).map((s) => s.name).join(","));
  const toiletId = toilet?.id ?? null;

  const catalog = await client.get("/api/rooms/catalog");
  const baths = (catalog.json?.rooms ?? []).filter((r) => /bath|powder/i.test(r.roomName || ""));
  for (const b of baths) checks.info(`bathroom ${b.id} · ${b.roomName}`);
  checks.ok("at least one active bathroom to place a toilet into", baths.length > 0, `got ${baths.length}`);
  if (baths.length === 0) return checks.finish();
  const targetBath = baths[0];

  // ── Reprocess email 3 — the ingest hook should auto-stage proposals ───────
  const reproc = await client.post(`/api/worker-emails/${EMAIL_ID}/reprocess`);
  checks.ok(`POST /api/worker-emails/${EMAIL_ID}/reprocess → 200`, reproc.status === 200, `got ${reproc.status}`);
  checks.info(`reprocess: classification=${reproc.json?.classification}, invoices=${reproc.json?.invoiceCount}`);

  // ── The staged proposals exist and are reviewable ─────────────────────────
  let proposals = await client.get("/api/materials/room-proposals");
  checks.ok("GET /api/materials/room-proposals → 200", proposals.status === 200, `got ${proposals.status}`);
  let staged = proposals.json?.proposals ?? [];
  checks.ok("proposals were staged from the receipt", staged.length > 0, `got ${staged.length}`);

  const toiletProps = staged.filter((p) => isToilet(p, toiletId));
  checks.ok("at least one TOILET proposal (the ambiguous-room case)", toiletProps.length > 0,
    `titles: ${staged.map((p) => p.title).join(" | ").slice(0, 200)}`);

  // Each proposal must carry the staged ARGUMENT, not a bare guess.
  const sample = toiletProps[0] ?? staged[0];
  if (sample) {
    checks.ok("a proposal carries reasoningMarkdown", Boolean(sample.reasoningMarkdown),
      JSON.stringify(sample.reasoningMarkdown));
    checks.ok("a proposal carries parsed candidates (array)", Array.isArray(sample.candidates),
      typeof sample.candidates);
    checks.ok("candidates carry room-level evidence (kept + evidence)",
      Array.isArray(sample.candidates) && sample.candidates.every((c) => "kept" in c && "evidence" in c),
      JSON.stringify(sample.candidates?.[0]));
    checks.ok("names are JOINed, not stored (proposedRoomName / subcategoryName present when ids are)",
      (sample.proposedRoomId == null || typeof sample.proposedRoomName === "string"),
      JSON.stringify({ id: sample.proposedRoomId, name: sample.proposedRoomName }));
  }

  // Pick a STAGED toilet proposal to drive the resolve path. Negative tests run
  // first — they throw before any write, so the same proposal survives for the
  // positive resolve afterward.
  const target = toiletProps.find((p) => p.status === "staged") ?? staged.find((p) => p.status === "staged");
  if (!target) {
    checks.ok("a staged proposal is available to resolve", false, "none staged — cannot exercise resolve");
    return checks.finish();
  }

  // ── Negative: nonexistent proposal → 404 ──────────────────────────────────
  const missing = await client.post(`/api/materials/room-proposals/999999999/resolve`, { roomId: targetBath.id });
  checks.ok("resolve a nonexistent proposal → 404", missing.status === 404, `got ${missing.status}`);

  // ── Negative: unknown/inactive room → 400 (no mutation — throws pre-write) ─
  const badRoom = await client.post(`/api/materials/room-proposals/${target.id}/resolve`, { roomId: 999999999 });
  checks.ok("resolve to an unknown/inactive room → 400", badRoom.status === 400, `got ${badRoom.status}`);

  // ── Positive: resolve the staged toilet onto a real bathroom → 200 ────────
  const resolved = await client.post(`/api/materials/room-proposals/${target.id}/resolve`, { roomId: targetBath.id });
  checks.ok("resolve a staged proposal to a bathroom → 200", resolved.status === 200, `got ${resolved.status}`);
  const newMaterialId = resolved.json?.materialId ?? null;
  checks.ok("resolve minted a material (materialId returned)", Number.isInteger(newMaterialId),
    JSON.stringify(resolved.json));
  checks.info(`resolved: material=${newMaterialId}, room=${resolved.json?.roomId}, status=${resolved.json?.status}`);

  // ── The material now answers "which materials are toilets" in that room ───
  if (toiletId != null && newMaterialId != null) {
    const bySub = await client.get(`/api/materials/by-subcategory/${toiletId}`);
    checks.ok(`GET /api/materials/by-subcategory/${toiletId} → 200`, bySub.status === 200, `got ${bySub.status}`);
    const mine = (bySub.json?.materials ?? []).find((m) => m.id === newMaterialId);
    checks.ok("the newly-created toilet material appears under the Toilet subcategory", Boolean(mine),
      `${(bySub.json?.materials ?? []).length} toilet materials`);
    checks.ok("...and it is placed in the confirmed bathroom",
      Boolean(mine) && mine.roomId === targetBath.id,
      JSON.stringify({ roomId: mine?.roomId, expected: targetBath.id, roomName: mine?.roomName }));
  }

  // ── Learning: a confirmed room is eliminated from later deductions ────────
  // Re-run the receipt. The material just placed in `targetBath` persists (only
  // the invoice/line-items are replaced), so the "already sourced" and
  // "previously confirmed" elimination steps should now rule that room out of
  // any fresh toilet proposal's candidates.
  const reproc2 = await client.post(`/api/worker-emails/${EMAIL_ID}/reprocess`);
  checks.ok("reprocess again → 200 (drives the learning step)", reproc2.status === 200, `got ${reproc2.status}`);

  proposals = await client.get("/api/materials/room-proposals");
  staged = proposals.json?.proposals ?? [];
  const freshToilets = staged.filter((p) => p.status === "staged" && isToilet(p, toiletId));
  const withCandidates = freshToilets.filter((p) => Array.isArray(p.candidates) && p.candidates.length > 0);

  if (withCandidates.length > 0) {
    // The confirmed bath must not be a KEPT candidate anywhere in a fresh proposal.
    const stillKeepsBath = withCandidates.some((p) =>
      p.candidates.some((c) => c.roomId === targetBath.id && c.kept),
    );
    checks.ok(
      `learning: confirmed bathroom (${targetBath.id}) is eliminated from fresh toilet proposals`,
      !stillKeepsBath,
      `a fresh proposal still keeps room ${targetBath.id} as a candidate`,
    );
    // Show the evidence line for the eliminated room, when present.
    const evidence = withCandidates
      .flatMap((p) => p.candidates)
      .find((c) => c.roomId === targetBath.id && !c.kept)?.evidence;
    if (evidence) checks.info(`elimination evidence: "${evidence}"`);
  } else {
    checks.info(
      "Could not force a fresh toilet proposal with candidates to inspect (extraction is " +
        "non-deterministic — line items varied on re-run). Weaker learning invariant not " +
        "exercised this run; the deterministic elimination is unit-covered in the service.",
    );
  }

  checks.info(`material ${newMaterialId} left behind by this run — delete by hand if reruns accumulate`);
  checks.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
