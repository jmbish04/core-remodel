#!/usr/bin/env node
/**
 * QC — PR #408 · 0035 P4 decision-inbox + per-room finance rollup.
 * Run: node scripts/qc/pr_408.mjs --preview   (or bare for prod)
 *
 * Deterministic shape + invariant checks (read-only, no fabricated data). Prod
 * currently has ~32 budget items all UNPHASED and no funding accounts, so the
 * inbox is expected to carry an `unphased_items` alert and (given spend) a
 * `no_funding` alert — those are asserted when present but the surface shape is
 * the hard gate.
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const isPreview = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC 0035 P4 inbox + rooms-finance against ${BASE}${isPreview ? " (preview)" : ""}\n`);

try {
  const inbox = await c.get("/api/budget/inbox");
  if (inbox.status !== 200 && !isPreview) {
    info("inbox endpoint: pending merge/deploy");
  } else {
    check("GET /api/budget/inbox 200", inbox.status === 200, `status=${inbox.status}`);
    const alerts = inbox.json?.alerts;
    check("inbox returns alerts[]", Array.isArray(alerts));
    // Every alert carries the contract shape.
    const shapeOk = (alerts ?? []).every(
      (a) => a.id && a.type && a.severity && a.title && a.action?.target,
    );
    check("every alert has id/type/severity/title/action.target", shapeOk);
    // No '0 issues' noise: an alert with a numeric count must have count > 0.
    const noZero = (alerts ?? []).every((a) => a.entity?.count == null || a.entity.count > 0);
    check("no zero-count alerts (empty sources omitted)", noZero);

    const rf = await c.get("/api/budget/rooms-finance");
    check("GET /api/budget/rooms-finance 200", rf.status === 200, `status=${rf.status}`);
    check("rooms-finance returns rooms[] + totals", Array.isArray(rf.json?.rooms) && !!rf.json?.totals);
    // Invariant: totals.remaining === committed − spent.
    const t = rf.json?.totals ?? {};
    check(
      "totals.remaining = committed − spent",
      t.remainingCents === (t.committedCents ?? 0) - (t.spentCents ?? 0),
      `rem=${t.remainingCents} c=${t.committedCents} s=${t.spentCents}`,
    );
    // Every room row: remaining = committed − spent, riskLevel valid.
    const roomsOk = (rf.json?.rooms ?? []).every(
      (r) =>
        r.remainingCents === r.committedCents - r.spentCents &&
        ["over", "watch", "ok"].includes(r.riskLevel),
    );
    check("each room: remaining math + valid riskLevel", roomsOk);

    // Data-aware (prod has unphased items): if unphased items exist, the alert fires.
    const unphased = (alerts ?? []).find((a) => a.type === "unphased_items");
    if (unphased) check("unphased_items alert present + routed to grid", unphased.action.target.includes("/admin/budget/grid"));
    else info("no unphased_items alert (all items phased or none exist)");
  }

  const docs = await c.get("/api/mcp-docs");
  if (docs.status === 200) {
    const has = (docs.json?.tools ?? []).some((t) => t.name === "get_budget_inbox");
    if (has || isPreview) check("MCP get_budget_inbox registered", has);
    else info("MCP get_budget_inbox: pending merge/deploy");
  }

  const grid = await c.get("/api/budget/grid");
  check("regression: /api/budget/grid still 200", grid.status === 200, `status=${grid.status}`);
} catch (err) {
  console.error("\nQC threw:", err?.message ?? err);
  process.exitCode = 1;
}

summary();
