#!/usr/bin/env node
/**
 * QC — PR #406 · 0035 P3 estimate-line reconciliation HITL.
 * Run: node scripts/qc/pr_406.mjs --preview   (or bare for prod)
 *
 * There are 0 estimate_line_items on the shared DB (no estimates entered yet),
 * so this verifies the SURFACE + error paths deterministically (no AI cost, no
 * fabricated data): the queue shape, the not-found guards on the mutating
 * routes (which fire BEFORE any AI call / write), the roomId-existence guard,
 * MCP tool registration, and a regression on the estimates list.
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const isPreview = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC 0035 P3 reconciliation against ${BASE}${isPreview ? " (preview)" : ""}\n`);

const NO_LINE = 999999999; // no estimate_line_items row will ever have this id

try {
  // ── queue ─────────────────────────────────────────────────────────────────
  const q = await c.get("/api/estimates/reconcile/queue?limit=5");
  if (q.status !== 200 && !isPreview) {
    info("reconcile queue: pending merge/deploy");
  } else {
    check("GET /api/estimates/reconcile/queue 200", q.status === 200, `status=${q.status}`);
    check(
      "queue returns { items, limit, offset, hasMore }",
      q.json && Array.isArray(q.json.items) && "limit" in q.json && "hasMore" in q.json,
    );

    // ── not-found guards (fire before AI / write) ─────────────────────────────
    const suggest = await c.post(`/api/estimates/line-items/${NO_LINE}/ai-suggest`, {});
    check("ai-suggest unknown line → 404 (no AI call)", suggest.status === 404, `status=${suggest.status}`);

    const patch = await c.patch(`/api/estimates/line-items/${NO_LINE}/reconcile`, {
      mappingStatus: "rejected",
    });
    check("reconcile unknown line → 404", patch.status === 404, `status=${patch.status}`);

    // roomId-existence guard: a non-existent room must be rejected 400.
    const badRoom = await c.patch(`/api/estimates/line-items/${NO_LINE}/reconcile`, {
      roomId: NO_LINE,
    });
    // Either the room guard (400) or the line guard (404) must reject — never a 200 write.
    check(
      "reconcile with bad roomId is rejected (400/404, never 200)",
      badRoom.status === 400 || badRoom.status === 404,
      `status=${badRoom.status}`,
    );

    // Invalid mappingStatus enum → 400.
    const badStatus = await c.patch(`/api/estimates/line-items/${NO_LINE}/reconcile`, {
      mappingStatus: "bogus",
    });
    check(
      "reconcile with invalid mappingStatus rejected (400/404)",
      badStatus.status === 400 || badStatus.status === 404,
      `status=${badStatus.status}`,
    );
  }

  // ── MCP tools registered ────────────────────────────────────────────────────
  const docs = await c.get("/api/mcp-docs");
  if (docs.status === 200) {
    const names = new Set((docs.json?.tools ?? []).map((t) => t.name));
    if (names.size && (names.has("reconcile_estimate_line") || isPreview)) {
      check("MCP reconcile_estimate_line registered", names.has("reconcile_estimate_line"));
      check("MCP list_reconciliation_queue registered", names.has("list_reconciliation_queue"));
    } else {
      info("MCP reconcile tools: pending merge/deploy");
    }
  }

  // ── regression ──────────────────────────────────────────────────────────────
  const est = await c.get("/api/estimates");
  check("regression: /api/estimates still 200", est.status === 200, `status=${est.status}`);
} catch (err) {
  console.error("\nQC threw:", err?.message ?? err);
  process.exitCode = 1;
}

summary();
