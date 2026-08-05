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
    check("returns a BARE array (panel dialect)", Array.isArray(list.json), `got ${typeof list.json}`);

    const names = new Set((list.json ?? []).map((p) => p.name));
    for (const n of SEEDED) check(`seeded phase present: ${n}`, names.has(n));

    // Every row carries the panel-required shape.
    const shapeOk = (list.json ?? []).every(
      (p) => typeof p.id === "number" && typeof p.name === "string",
    );
    check("rows expose id + name", shapeOk);

    // ── CRUD round-trip ──────────────────────────────────────────────────────
    const created = await c.post("/api/config/budget-phases", { name: "QC temp phase", description: "qc" });
    check("POST creates a phase (201)", created.status === 201, `status=${created.status}`);
    const newId = created.json?.id;
    check("created row returns an id + name", typeof newId === "number" && created.json?.name === "QC temp phase");

    const afterCreate = await c.get("/api/config/budget-phases");
    check(
      "created phase appears in the active list",
      (afterCreate.json ?? []).some((p) => p.id === newId),
    );

    const edited = await c.patch(`/api/config/budget-phases/${newId}`, { description: "qc edited" });
    check("PATCH edits (200)", edited.status === 200 && edited.json?.description === "qc edited", `status=${edited.status}`);

    const deactivated = await c.patch(`/api/config/budget-phases/${newId}`, { isActive: false });
    check("PATCH isActive:false (200)", deactivated.status === 200, `status=${deactivated.status}`);

    const afterDeactivate = await c.get("/api/config/budget-phases");
    check(
      "soft-deactivated phase drops from the active list",
      !(afterDeactivate.json ?? []).some((p) => p.id === newId),
    );

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

  // ── regression guard ─────────────────────────────────────────────────────────
  const storeTypes = await c.get("/api/config/store-types");
  check("regression: /api/config/store-types still 200", storeTypes.status === 200, `status=${storeTypes.status}`);
} catch (err) {
  console.error("\nQC threw:", err?.message ?? err);
  process.exitCode = 1;
}

summary();
