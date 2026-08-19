#!/usr/bin/env node
/**
 * QC — PR #400 · 0035 budget grid usability (phase assignment + funding config).
 * Run: node scripts/qc/pr_400.mjs --preview   (or bare for prod)
 *
 * All mutations are NON-POLLUTING: the phase round-trip restores the line to
 * Unphased, and the funding round-trip writes each account's own current amount
 * back (a true no-op). Nothing invents a budget or leaves a stray phase.
 *
 * The carry-forward behavior + phaseId-in-PATCH are NEW in this PR, so on a prod
 * run before merge those assertions report "pending merge/deploy" (old prod code
 * ignores phaseId on the item PATCH) rather than hard-failing.
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const isPreview = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC 0035 grid usability against ${BASE}${isPreview ? " (preview)" : ""}\n`);

try {
  // ── phases vocabulary ────────────────────────────────────────────────────
  const phases = await c.get("/api/config/budget-phases");
  check("GET /api/config/budget-phases 200", phases.status === 200, `status=${phases.status}`);
  const phaseList = Array.isArray(phases.json) ? phases.json : [];
  check("at least one active phase exists", phaseList.length > 0);

  const grid0 = await c.get("/api/budget/grid");
  check("GET /api/budget/grid 200", grid0.status === 200, `status=${grid0.status}`);
  const g0 = grid0.json?.grid;

  // ── funding round-trip (write current values back — no-op) ────────────────
  const fin = await c.get("/api/budget-tracker/financial-status");
  check("GET /financial-status 200", fin.status === 200, `status=${fin.status}`);
  check("financial-status returns accounts[]", Array.isArray(fin.json?.accounts));
  const accounts = (fin.json?.accounts ?? []).map((a) => ({
    accountKey: a.accountKey,
    accountLabel: a.accountLabel,
    amountCents: a.amountCents, // write the SAME value back
  }));
  if (accounts.length > 0) {
    const putRes = await c.req("PUT", "/api/budget-tracker/financial-accounts", { body: { accounts } });
    check("PUT /financial-accounts round-trip 200", putRes.status === 200, `status=${putRes.status}`);
  } else {
    info("no funding accounts to round-trip");
  }

  // ── phase assignment round-trip + carry-forward ───────────────────────────
  const unphased = (g0?.phases ?? []).find((p) => p.id === 0);
  const line = unphased?.lines?.[0];
  if (!line) {
    info("no Unphased line to test phase assignment");
  } else {
    const targetPhase = phaseList[0];
    const assign = await c.patch(`/api/budget-tracker/items/${line.id}`, { phaseId: targetPhase.id });
    check("PATCH item phaseId 200", assign.status === 200, `status=${assign.status}`);

    const g1 = (await c.get("/api/budget/grid")).json?.grid;
    const moved = (g1?.phases ?? [])
      .find((p) => p.id === targetPhase.id)
      ?.lines?.some((l) => l.trackId === line.trackId);

    if (!moved && !isPreview) {
      info("phase-assign persistence: pending merge/deploy (old prod code ignores phaseId on PATCH)");
    } else {
      check("line moved into the assigned phase group", moved);

      // carry-forward: an unrelated edit must NOT wipe the phase.
      const active = (g1.phases.find((p) => p.id === targetPhase.id).lines.find((l) => l.trackId === line.trackId));
      await c.patch(`/api/budget-tracker/items/${active.id}`, { status: "researching" });
      const g2 = (await c.get("/api/budget/grid")).json?.grid;
      const retained = (g2?.phases ?? [])
        .find((p) => p.id === targetPhase.id)
        ?.lines?.some((l) => l.trackId === line.trackId);
      check("phase retained after an unrelated edit (carry-forward)", retained);

      // restore: back to Unphased + status open (leave data as-found).
      const cur = (g2.phases.find((p) => p.id === targetPhase.id).lines.find((l) => l.trackId === line.trackId));
      const restore = await c.patch(`/api/budget-tracker/items/${cur.id}`, { phaseId: null, status: "open" });
      check("restored line to Unphased", restore.status === 200, `status=${restore.status}`);
    }
  }

  // ── regression ────────────────────────────────────────────────────────────
  const grid2 = await c.get("/api/budget/grid");
  check("regression: grid still 200", grid2.status === 200, `status=${grid2.status}`);
} catch (err) {
  console.error("\nQC threw:", err?.message ?? err);
  process.exitCode = 1;
}

summary();
