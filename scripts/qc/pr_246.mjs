#!/usr/bin/env node
/**
 * @fileoverview QC — PR #246, receipt-review HITL page (0030 frontend).
 *
 * The page is frontend-only and reuses the room-proposal endpoints shipped in
 * #236, so this QC asserts:
 *
 *   GET  /admin/shopping/receipt-review           → 200, shell + island present
 *   GET  /api/materials/room-proposals?status=..  → grouped proposal shape
 *   POST /api/materials/room-proposals/:id/resolve → mints material vs a roomId FK
 *
 * The page route is NEW, so on prod (pre-merge) it 404s — reported PENDING, not
 * failed. The resolve POST mutates live D1 (previews share prod D1), so it runs
 * ONLY against a preview target and restores via a receipt reprocess. Run both:
 *
 *   pnpm run test:pr 246 -- --preview   # this branch's preview (new page)
 *   pnpm run test:pr 246                 # production — regression + PENDING report
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(
  `\nQC pr_246 — receipt-review HITL page\n  target: ${resolveBase()}${
    onProd ? " (PROD — new page reports PENDING until merge+deploy)" : ""
  }\n`,
);

await assertReachable(client, checks);

// ── The page route renders the shell + React island ───────────────────────────
const page = await client.get("/admin/shopping/receipt-review");
if (onProd && page.status === 404) {
  checks.info("PENDING: /admin/shopping/receipt-review not on prod yet (pending merge+deploy)");
} else {
  const html = page.text ?? "";
  checks.ok(
    "GET /admin/shopping/receipt-review → 200 with shell + island",
    page.status === 200 && html.includes("Receipt Review") && html.includes("astro-island"),
    `→ ${page.status} shell=${html.includes("Receipt Review")} island=${html.includes("astro-island")}`,
  );
}

// ── The proposals endpoint returns the grouped shape the page consumes ─────────
const list = await client.get("/api/materials/room-proposals?status=staged");
const proposals = list.json?.proposals ?? [];
checks.ok(
  "GET /api/materials/room-proposals?status=staged → 200 with proposal[]",
  list.status === 200 && Array.isArray(proposals),
  `→ ${list.status} count=${proposals.length}`,
);
if (proposals.length > 0) {
  const p = proposals[0];
  checks.ok(
    "each proposal carries invoiceId + candidates[] + proposedRoomId (FK, not name)",
    typeof p.invoiceId === "number" &&
      Array.isArray(p.candidates) &&
      (p.proposedRoomId === null || typeof p.proposedRoomId === "number"),
    `→ invoiceId=${p.invoiceId} candidates=${p.candidates?.length} proposedRoomId=${p.proposedRoomId}`,
  );
}

// ── The resolve POST (the Confirm button) mints a material vs the chosen roomId.
//    Mutates live D1, so preview-only; restored by reprocessing the receipt. ────
if (onProd) {
  checks.info("SKIPPED on prod: resolve POST mutates D1 (QC stays read-only against prod)");
} else {
  const target = proposals.find((x) => x.status === "staged" && typeof x.proposedRoomId === "number");
  if (!target) {
    checks.info("no staged proposal with a proposed room to resolve — reprocess email 3 first");
  } else {
    const res = await client.post(`/api/materials/room-proposals/${target.id}/resolve`, {
      roomId: target.proposedRoomId,
    });
    checks.ok(
      "POST /room-proposals/:id/resolve → 200, mints material vs roomId",
      res.status === 200 &&
        typeof res.json?.materialId === "number" &&
        res.json?.roomId === target.proposedRoomId &&
        res.json?.status === "confirmed",
      `→ ${res.status} ${JSON.stringify(res.json)}`,
    );
    // Restore: reprocess the source receipt so the queue returns to its staged state.
    const reprocess = await client.post("/api/worker-emails/3/reprocess", {});
    checks.ok(
      "reprocess email 3 → 200 (restore staged queue)",
      reprocess.status === 200 || reprocess.status === 202,
      `→ ${reprocess.status}`,
    );
  }
}

checks.finish();
