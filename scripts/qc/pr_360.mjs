#!/usr/bin/env node
/**
 * QC — PR #360 · 0035 budget grid schema foundations.
 * Run: node scripts/qc/pr_360.mjs --preview   (or bare for prod)
 *
 * This PR is backend + schema only (no grid UI yet). It exercises the one live
 * surface it adds — the budget-phases config vocabulary — plus a regression
 * guard on the shared config router.
 *
 * Covers:
 *   1. GET /api/config/budget-phases → 200, BARE array (the panel dialect), and
 *      the 4 seeded default phases are present.
 *   2. Full CRUD round-trip: POST creates (derives a key), PATCH edits, PATCH
 *      isActive:false soft-deactivates (drops from the active list). Cleanup safe
 *      to re-run — the created row is always deactivated at the end.
 *   3. The config page /admin/config/budget/phases returns 200 HTML.
 *   4. Regression: the pre-existing /api/config/store-types (same router,
 *      same bare-array dialect) still 200s.
 *
 * Brand-new endpoints won't exist on prod until this merges + deploys, so on a
 * prod run before merge those checks report "pending merge/deploy" rather than
 * hard-failing.
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const isPreview = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC 0035 budget foundations against ${BASE}${isPreview ? " (preview)" : ""}\n`);

const SEEDED = [
  "Pre-construction & demolition",
  "Structural & rough-in (MEP)",
  "Interior architectural finishes",
  "Exterior & landscaping",
];

try {
  const list = await c.get("/api/config/budget-phases");
  const deployed = list.status === 200;

  if (!deployed && !isPreview) {
    info("budget-phases endpoint: pending merge/deploy (404 on prod until shipped)");
  } else {
    check("GET /api/config/budget-phases 200", deployed, `status=${list.status}`);
    // Coerce to an array — a non-array body (e.g. an error object) must not crash .map/.every.
    const rows = Array.isArray(list.json) ? list.json : [];
    check("returns a BARE array (panel dialect)", Array.isArray(list.json), `got ${typeof list.json}`);

    const names = new Set(rows.map((p) => p.name));
    for (const n of SEEDED) check(`seeded phase present: ${n}`, names.has(n));

    // Every row carries the panel-required shape.
    const shapeOk = rows.every((p) => typeof p.id === "number" && typeof p.name === "string");
    check("rows expose id + name", shapeOk);

    // ── CRUD round-trip ──────────────────────────────────────────────────────
    const created = await c.post("/api/config/budget-phases", { name: "QC temp phase", description: "qc" });
    check("POST creates a phase (201)", created.status === 201, `status=${created.status}`);
    const newId = created.json?.id;
    check("created row returns an id + name", typeof newId === "number" && created.json?.name === "QC temp phase");

    // Guard every downstream CRUD step on a real id — a failed POST must not send
    // PATCH /budget-phases/undefined and produce misleading failures.
    if (typeof newId === "number") {
      const afterCreate = await c.get("/api/config/budget-phases");
      check(
        "created phase appears in the active list",
        (Array.isArray(afterCreate.json) ? afterCreate.json : []).some((p) => p.id === newId),
      );

      const edited = await c.patch(`/api/config/budget-phases/${newId}`, { description: "qc edited" });
      check("PATCH edits (200)", edited.status === 200 && edited.json?.description === "qc edited", `status=${edited.status}`);

      const deactivated = await c.patch(`/api/config/budget-phases/${newId}`, { isActive: false });
      check("PATCH isActive:false (200)", deactivated.status === 200, `status=${deactivated.status}`);

      const afterDeactivate = await c.get("/api/config/budget-phases");
      check(
        "soft-deactivated phase drops from the active list",
        !(Array.isArray(afterDeactivate.json) ? afterDeactivate.json : []).some((p) => p.id === newId),
      );
    }

    // Bad id → 404, empty body → 400 (contract guards).
    const notFound = await c.patch("/api/config/budget-phases/99999999", { name: "x" });
    check("PATCH unknown id → 404", notFound.status === 404, `status=${notFound.status}`);
  }

  // ── config page ─────────────────────────────────────────────────────────────
  const page = await c.get("/admin/config/budget/phases");
  if (page.status === 200) {
    check("config page /admin/config/budget/phases 200", true);
    check("page renders the ConfigDefinitionPage island", page.text.includes("Budget Phases"));
  } else if (!isPreview) {
    info("config page: pending merge/deploy");
  } else {
    check("config page /admin/config/budget/phases 200", false, `status=${page.status}`);
  }

  // ── grid API + seed + plan-schedule (Phase 1/2 surface) ──────────────────────
  const grid = await c.get("/api/budget/grid");
  if (grid.status !== 200 && !isPreview) {
    info("grid API: pending merge/deploy (404 on prod until shipped)");
  } else {
    check("GET /api/budget/grid 200", grid.status === 200, `status=${grid.status}`);
    const g = grid.json?.grid;
    check("grid has months[] + phases[]", Array.isArray(g?.months) && Array.isArray(g?.phases));
    check("grid has footer + scorecards", Boolean(g?.footer) && Boolean(g?.scorecards));
    // Scorecard identity: remaining = totalBudget - spent (signed).
    const sc = g?.scorecards ?? {};
    check(
      "scorecard remaining = totalBudget - spent",
      sc.remainingCents === (sc.totalBudgetCents ?? 0) - (sc.spentCents ?? 0),
      `rem=${sc.remainingCents} tb=${sc.totalBudgetCents} spent=${sc.spentCents}`,
    );
    // Per phase, plan[]/actual[] length == months length.
    const monthN = g?.months?.length ?? 0;
    const lenOk = (g?.phases ?? []).every(
      (p) => p.plan?.length === monthN && p.actual?.length === monthN,
    );
    check("every phase plan[]/actual[] matches month count", lenOk);

    // Seed is idempotent: two runs, the second seeds no NEW plan rows for the same items.
    const seed1 = await c.post("/api/budget/grid/seed", {});
    check("POST /api/budget/grid/seed 200", seed1.status === 200, `status=${seed1.status}`);
    check("seed reports counts", typeof seed1.json?.plansSeeded === "number");
    const seed2 = await c.post("/api/budget/grid/seed", {});
    check(
      "seed is idempotent (2nd run seeds 0 new plans)",
      seed2.json?.plansSeeded === 0,
      `2nd run plansSeeded=${seed2.json?.plansSeeded}`,
    );

    // plan-schedule PATCH: reject an unknown trackId (404), accept a real one round-trip.
    const bad = await c.patch("/api/budget/plan-schedule", {
      trackId: "qc-nonexistent-track",
      period: "2026-05",
      plannedCents: 1234,
    });
    check("PATCH plan-schedule unknown trackId → 404", bad.status === 404, `status=${bad.status}`);
    // Non-polluting round-trip: write an EXISTING in-window cell back to its own
    // current value. Never write a far-future period — the window derivation
    // anchors to max(period), so a stray future row would distort the default grid.
    const firstPhase = (g?.phases ?? []).find((p) => (p.lines ?? []).length > 0);
    const firstLine = firstPhase?.lines?.[0];
    const firstPeriod = g?.months?.[0]?.period;
    if (firstLine?.trackId && firstPeriod) {
      const idx = 0;
      const patched = await c.patch("/api/budget/plan-schedule", {
        trackId: firstLine.trackId,
        period: firstPeriod,
        plannedCents: firstLine.plan?.[idx] ?? 0, // write the same value back — no data drift
      });
      check("PATCH plan-schedule valid trackId 200", patched.status === 200, `status=${patched.status}`);
    } else {
      info("PATCH plan-schedule round-trip skipped — no in-window line items to target");
    }
  }

  // ── MCP get_budget_grid registered ───────────────────────────────────────────
  const mcpDocs = await c.get("/api/mcp-docs");
  if (mcpDocs.status === 200) {
    const hasTool = (mcpDocs.json?.tools ?? []).some((t) => t.name === "get_budget_grid");
    if (hasTool || isPreview) check("MCP get_budget_grid registered", hasTool);
    else info("MCP get_budget_grid: pending merge/deploy");
  }

  // ── regression guard ─────────────────────────────────────────────────────────
  const storeTypes = await c.get("/api/config/store-types");
  check("regression: /api/config/store-types still 200", storeTypes.status === 200, `status=${storeTypes.status}`);
} catch (err) {
  console.error("\nQC threw:", err?.message ?? err);
  process.exitCode = 1;
}

summary();
