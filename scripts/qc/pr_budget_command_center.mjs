#!/usr/bin/env node
/**
 * @fileoverview QC for the Budget Command Center rebuild.
 *
 *   node scripts/qc/pr_budget_command_center.mjs --preview   # this branch's wcrp-* worker
 *   node scripts/qc/pr_budget_command_center.mjs             # production (main)
 *
 * Two jobs:
 *
 *  1. Contract conformance for every endpoint the rebuild added or reshaped
 *     (docs/plans/budget-command-center/API-CONTRACT.md). Each check asserts the
 *     SHAPE, not the values — this is a live database and the numbers move.
 *  2. A regression guard on the budget endpoints that already existed, so a
 *     production run proves the rebuild did not break what was already live.
 *
 * Endpoints that do not exist yet on the target are reported as PENDING rather
 * than failed, so the mandatory production run is meaningful before the merge.
 * Anything present but malformed still fails.
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const client = createClient({ base: BASE });
const { ok: check, info, finish } = createChecks();

const IS_PREVIEW = process.argv.includes("--preview");
console.log(`\nQC · Budget Command Center → ${BASE}${IS_PREVIEW ? " (preview)" : " (production)"}\n`);

/** Endpoints the rebuild introduces. On production before merge these 404. */
const NEW_ROUTES = new Set([
  "/api/budget/workbench-summary",
  "/api/budget/reconciliation-queue",
  "/api/budget/reallocations",
  "/api/budget/contingency",
  "/api/budget/compliance",
  "/api/budget-tracker/financial-accounts",
]);

/**
 * Endpoints that already existed but whose RESPONSE SHAPE this branch changes.
 * Before the merge, production answers 200 with the old shape — that is correct
 * for production, so a shape mismatch there is reported as pending rather than
 * failed. On the preview (which runs this branch) the new shape is mandatory.
 */
const RESHAPED_ROUTES = new Set([
  "/api/budget/grid",
  "/api/budget/inbox",
  "/api/budget/rooms-finance",
]);

/** Pages this branch adds. Absent from production until the merge. */
const NEW_PAGES = new Set(["/admin/budget"]);

const pending = [];

/**
 * GET `path` and hand the parsed body to `assert`.
 *
 * A 404/501 on a route this branch introduces is recorded as pending, never as
 * a failure — before the merge, production genuinely does not serve it yet.
 */
async function shape(path, label, assert) {
  const route = path.split("?")[0];
  const res = await client.get(path);

  if ((res.status === 404 || res.status === 501) && NEW_ROUTES.has(route)) {
    pending.push(`${path} → ${res.status} (route not deployed here)`);
    console.log(`  · ${label} — PENDING (route not deployed to this target yet)`);
    return null;
  }
  if (!check(`${label} → 200`, res.status === 200, `GET ${path} → ${res.status}`)) return null;
  const body = res.json;
  if (!check(`${label} returns an object`, body && typeof body === "object")) return null;

  // On production before the merge, a reshaped route still serves its old
  // shape. Assert it there and every check fails for the wrong reason, which
  // would drown the regression guard this run exists for.
  if (!IS_PREVIEW && RESHAPED_ROUTES.has(route)) {
    pending.push(`${path} → 200, pre-merge shape`);
    console.log(`  · ${label} — PENDING (serves the pre-merge shape here; asserted on the preview)`);
    return body;
  }

  assert(body);
  return body;
}

const isInt = (v) => Number.isInteger(v);
const isIntOrNull = (v) => v === null || Number.isInteger(v);
const isArr = Array.isArray;

await assertReachable(client, { ok: check });

// ── 1 · Workbench summary — fills the whole shell header ────────────────────
await shape("/api/budget/workbench-summary", "workbench-summary", (b) => {
  check("summary.kpis present", b.kpis && typeof b.kpis === "object");
  const k = b.kpis ?? {};
  check("totalBudgetCents is integer cents", isInt(k.totalBudgetCents), `got ${k.totalBudgetCents}`);
  check("spentToDateCents is integer cents", isInt(k.spentToDateCents), `got ${k.spentToDateCents}`);
  check("remainingCents is integer cents", isInt(k.remainingCents), `got ${k.remainingCents}`);
  check(
    "varianceVsEstimateCents is integer cents",
    isInt(k.varianceVsEstimateCents),
    `got ${k.varianceVsEstimateCents}`,
  );
  // The runway divides by trailing burn; null (not NaN/Infinity) when burn is 0.
  check(
    "runwayMonths is a finite number or null",
    k.runwayMonths === null || Number.isFinite(k.runwayMonths),
    `got ${k.runwayMonths}`,
  );
  check(
    "varianceDirection is one of over|under|even",
    ["over", "under", "even"].includes(k.varianceDirection),
    `got ${k.varianceDirection}`,
  );
  check("tabCounts has all six tabs", b.tabCounts && isInt(b.tabCounts.inbox) && isInt(b.tabCounts.compliance));
  check("decisionsWaiting is an integer", isInt(b.decisionsWaiting), `got ${b.decisionsWaiting}`);
  // The four KPI cards are read side by side; they have to agree.
  check(
    "remaining equals total budget minus spent",
    k.remainingCents === k.totalBudgetCents - k.spentToDateCents,
    `${k.totalBudgetCents} - ${k.spentToDateCents} != ${k.remainingCents}`,
  );
  if (k.totalBudgetCents > 0) {
    const pct = k.spentToDateCents / k.totalBudgetCents;
    check(
      "spentPctOfBudget matches spent over total",
      Math.abs(k.spentPctOfBudget - pct) < 0.0001,
      `got ${k.spentPctOfBudget}, expected ~${pct.toFixed(4)}`,
    );
  }
  // A negative runway is not a number of months.
  check(
    "runwayMonths is never negative",
    k.runwayMonths === null || k.runwayMonths >= 0,
    `got ${k.runwayMonths}`,
  );
  check(
    "varianceDirection agrees with the sign of varianceVsEstimateCents",
    (k.varianceVsEstimateCents > 0 && k.varianceDirection === "over") ||
      (k.varianceVsEstimateCents < 0 && k.varianceDirection === "under") ||
      (k.varianceVsEstimateCents === 0 && k.varianceDirection === "even"),
    `${k.varianceVsEstimateCents} vs ${k.varianceDirection}`,
  );
  info(`budget ${k.totalBudgetCents}¢ · spent ${k.spentToDateCents}¢ · inbox ${b.tabCounts?.inbox}`);
});

// ── 2 · Grid — the reshaped time-phased endpoint ────────────────────────────
await shape("/api/budget/grid?from=2026-02&to=2026-07&view=actuals", "grid", (b) => {
  check("grid.months is an array", isArr(b.months));
  check("grid.phases is an array", isArr(b.phases));
  check("grid.footer has both aggregates", b.footer && isInt(b.footer.availableBudgetCents) && isInt(b.footer.netBurnCents));
  const months = b.months ?? [];
  check("every month has key + label", months.every((m) => typeof m.key === "string" && typeof m.label === "string"));
  const row = (b.phases ?? []).flatMap((p) => p.rows ?? [])[0];
  if (row) {
    check("row has integer total + variance", isInt(row.totalCents) && isInt(row.varianceCents));
    check("row.cells is keyed by month", row.cells && typeof row.cells === "object");
    // vendorLabel comes from a JOIN and is null until budget lines get a vendor FK.
    check("row.vendorLabel is a string or null", row.vendorLabel === null || typeof row.vendorLabel === "string");
    const cell = Object.values(row.cells ?? {})[0];
    if (cell) {
      check(
        "cell has plannedCents/actualCents/isEditable",
        isIntOrNull(cell.plannedCents) && isIntOrNull(cell.actualCents) && typeof cell.isEditable === "boolean",
      );
    }
    info(`${months.length} months · ${(b.phases ?? []).length} phases · ${(b.phases ?? []).flatMap((p) => p.rows ?? []).length} rows`);

    // Arithmetic, not shape. A shape-only check passed while the row variance
    // badge was sign-inverted and every under-budget line read "over".
    const allRows = (b.phases ?? []).flatMap((p) => p.rows ?? []);

    // totalCents is the planned sum across the visible window.
    const totalMismatch = allRows.filter((r) => {
      const planned = Object.values(r.cells ?? {}).reduce((n, c) => n + (c.plannedCents ?? 0), 0);
      return r.totalCents !== planned;
    });
    check(
      "every row's totalCents equals the sum of its planned cells",
      totalMismatch.length === 0,
      totalMismatch.length ? `${totalMismatch.length} row(s), first: ${totalMismatch[0].title}` : "",
    );

    // varianceCents is actual - planned, so POSITIVE MEANS OVER BUDGET.
    const varianceMismatch = allRows.filter((r) => {
      const cells = Object.values(r.cells ?? {});
      const planned = cells.reduce((n, c) => n + (c.plannedCents ?? 0), 0);
      const actual = cells.reduce((n, c) => n + (c.actualCents ?? 0), 0);
      return r.varianceCents !== actual - planned;
    });
    check(
      "every row's varianceCents equals actual minus planned (positive = over)",
      varianceMismatch.length === 0,
      varianceMismatch.length ? `${varianceMismatch.length} row(s), first: ${varianceMismatch[0].title}` : "",
    );

    // A line with nothing spent cannot be over budget. This is the assertion
    // that catches a flipped sign even when both sides agree with each other.
    const falseOver = allRows.filter((r) => {
      const spent = Object.values(r.cells ?? {}).reduce((n, c) => n + (c.actualCents ?? 0), 0);
      return spent === 0 && r.varianceCents > 0;
    });
    check(
      "no row with zero actuals reports a positive (over-budget) variance",
      falseOver.length === 0,
      falseOver.length ? `${falseOver.length} row(s), first: ${falseOver[0].title}` : "",
    );

    const subtotalMismatch = (b.phases ?? []).filter(
      (p) => p.subtotalCents !== (p.rows ?? []).reduce((n, r) => n + r.totalCents, 0),
    );
    check(
      "every phase subtotal equals the sum of its rows",
      subtotalMismatch.length === 0,
      subtotalMismatch.length ? `first: ${subtotalMismatch[0].name}` : "",
    );
  } else {
    info("grid returned no rows — arithmetic checks skipped");
  }
});

// ── 3 · Decision inbox — ranked in SQL, must arrive descending ──────────────
await shape("/api/budget/inbox", "inbox", (b) => {
  check("inbox.items is an array", isArr(b.items));
  check("inbox.total is an integer", isInt(b.total), `got ${b.total}`);
  const items = b.items ?? [];
  check(
    "every item has a valid severity",
    items.every((i) => ["block", "warn", "info"].includes(i.severity)),
  );
  check("every item has integer exposureCents", items.every((i) => isInt(i.exposureCents)));
  check(
    "every item has an actionKind and href",
    items.every((i) => typeof i.actionKind === "string" && typeof i.actionHref === "string"),
  );
  // The ranking is the endpoint's whole contract: the server orders, not the
  // client. Severity leads (a blocking gate must never sort below a bigger
  // dollar figure), and exposure orders WITHIN a severity band.
  let bandOk = true;
  for (const sev of ["block", "warn", "info"]) {
    const band = items.filter((i) => i.severity === sev).map((i) => i.exposureCents);
    if (!band.every((v, idx) => idx === 0 || band[idx - 1] >= v)) bandOk = false;
  }
  check(
    "exposure descends within each severity band",
    bandOk,
    `order: ${items.slice(0, 6).map((i) => `${i.severity}:${i.exposureCents}`).join(", ")}`,
  );
  // A blocking compliance gate must not sort below a larger dollar figure —
  // it fell off the end of the list behind 30 low-value rows.
  const rank = { block: 0, warn: 1, info: 2 };
  const severities = items.map((i) => rank[i.severity]);
  check(
    "severity outranks exposure in the ordering",
    severities.every((v, idx) => idx === 0 || severities[idx - 1] <= v),
    `order: ${items.slice(0, 6).map((i) => i.severity).join(", ")}`,
  );
  check("no item reports a negative exposure", items.every((i) => i.exposureCents >= 0));
  info(`${items.length} decisions · total ${b.total}`);
});

// ── 4 · Rooms finance — aggregated server-side, totals must reconcile ───────
await shape("/api/budget/rooms-finance", "rooms-finance", (b) => {
  check("rooms is an array", isArr(b.rooms));
  check(
    "totals carries all four aggregates",
    b.totals && isInt(b.totals.committedCents) && isInt(b.totals.spentCents) && isInt(b.totals.remainingCents) && isInt(b.totals.openMaterialsCount),
  );
  const rooms = b.rooms ?? [];
  check("every room has a numeric id and a name", rooms.every((r) => isInt(r.roomId) && typeof r.name === "string"));
  check("every room has integer money fields", rooms.every((r) => isInt(r.committedCents) && isInt(r.spentCents) && isInt(r.remainingCents)));
  check("every room risk is one of ok|watch|at_risk", rooms.every((r) => ["ok", "watch", "at_risk"].includes(r.risk)));
  // RoomsTab renders `totals` as a Total row directly under the column, so a
  // reader adds the column and expects that number. If the endpoint's totals
  // are deliberately project-wide (including rooms not listed), the response
  // must say so rather than letting the two silently disagree.
  for (const [field, label] of [
    ["committedCents", "committed"],
    ["spentCents", "spent"],
    ["remainingCents", "remaining"],
  ]) {
    const summed = rooms.reduce((n, r) => n + r[field], 0);
    const total = b.totals?.[field];
    const explained = b.totals?.unassigned?.[field] ?? b.unassigned?.[field] ?? null;
    check(
      `totals.${field} reconciles with the ${label} column`,
      total === summed || (explained !== null && total === summed + explained),
      `rows=${summed} total=${total}${explained === null ? " (no unassigned delta reported)" : ` unassigned=${explained}`}`,
    );
  }
  check(
    "every room's remaining equals committed minus spent",
    rooms.every((r) => r.remainingCents === r.committedCents - r.spentCents),
    "",
  );
  info(`${rooms.length} rooms · committed ${b.totals?.committedCents}¢ · spent ${b.totals?.spentCents}¢`);
});

// ── 5 · Reconciliation queue — paginated in SQL, candidates carry reasoning ─
await shape("/api/budget/reconciliation-queue?limit=5", "reconciliation-queue", (b) => {
  check("items is an array", isArr(b.items));
  check("nextCursor is a string or null", b.nextCursor === null || typeof b.nextCursor === "string");
  const items = b.items ?? [];
  check("limit is honoured by SQL, not sliced in JS", items.length <= 5, `got ${items.length} for limit=5`);
  const withCandidates = items.find((i) => (i.candidates ?? []).length > 0);
  if (withCandidates) {
    const cand = withCandidates.candidates[0];
    check("candidate has a rank and a verdict", isInt(cand.rank) && ["likely", "possible", "eliminated"].includes(cand.verdict));
    // The reasoning is the point of the screen — a human reviews an argument.
    check(
      "candidate reasoning is a {markdown, html} pair",
      cand.reasoning && "markdown" in cand.reasoning && "html" in cand.reasoning,
    );
    check("candidate roomName comes from a JOIN", typeof cand.roomName === "string");
  } else {
    info("no queued line has candidates yet — candidate shape checks skipped");
  }
  info(`${items.length} unmapped lines`);
});

// ── 6 · Funding accounts + reallocation ledger + contingency ────────────────
await shape("/api/budget-tracker/financial-accounts", "financial-accounts", (b) => {
  check("accounts is an array", isArr(b.accounts));
  check("totalCents is an integer summed in SQL", isInt(b.totalCents), `got ${b.totalCents}`);
  const accounts = b.accounts ?? [];
  check("every account has a key, a label and integer cents", accounts.every((a) => typeof a.accountKey === "string" && typeof a.accountLabel === "string" && isInt(a.amountCents)));
  // The server's SUM and the row values must agree, or the KPI lies.
  const summed = accounts.reduce((n, a) => n + a.amountCents, 0);
  check("totalCents equals the sum of the rows", summed === b.totalCents, `rows=${summed} total=${b.totalCents}`);
  info(`${accounts.length} accounts · ${b.totalCents}¢`);
});

await shape("/api/budget/reallocations?limit=5", "reallocations", (b) => {
  check("entries is an array", isArr(b.entries));
  check("nextCursor is a string or null", b.nextCursor === null || typeof b.nextCursor === "string");
  check("limit is honoured by SQL", (b.entries ?? []).length <= 5, `got ${(b.entries ?? []).length}`);
  const e = (b.entries ?? [])[0];
  if (e) {
    check("entry has integer amountCents", isInt(e.amountCents));
    check("entry has an occurredAt timestamp", isInt(e.occurredAt));
    // Contingency is an ordinary funding account, so both sides share one enum.
    for (const side of ["from", "to"]) {
      if (e[side]) {
        check(
          `entry.${side}.kind is account|room|external`,
          ["account", "room", "external"].includes(e[side].kind),
          `got ${e[side].kind}`,
        );
        check(`entry.${side}.label is a JOINed string`, typeof e[side].label === "string");
      }
    }
  } else {
    info("ledger is empty — entry shape checks skipped");
  }
});

await shape("/api/budget/contingency", "contingency", (b) => {
  check("openingReserveCents is an integer", isInt(b.openingReserveCents), `got ${b.openingReserveCents}`);
  check("currentBalanceCents is an integer", isInt(b.currentBalanceCents), `got ${b.currentBalanceCents}`);
  // Guards the divide-by-zero: an unallotted reserve must read 0, never NaN.
  check(
    "pctRemaining is finite (never NaN/Infinity)",
    Number.isFinite(b.pctRemaining),
    `got ${b.pctRemaining}`,
  );
  info(`opening ${b.openingReserveCents}¢ · balance ${b.currentBalanceCents}¢`);
});

// ── 7 · Compliance — the highest-stakes surface ─────────────────────────────
await shape("/api/budget/compliance", "compliance", (b) => {
  check("contracts is an array", isArr(b.contracts));
  const contracts = b.contracts ?? [];
  check("every contract has an overallState", contracts.every((k) => ["ok", "block", "warn"].includes(k.overallState)));
  const withGates = contracts.find((k) => (k.gates ?? []).length > 0);
  if (withGates) {
    const types = withGates.gates.map((g) => g.gateType);
    // All four gates must always be present. Omitting one reads as "all clear",
    // which is the worst possible failure on a compliance screen.
    for (const t of ["down_payment_cap", "signed_change_order", "lien_release", "license_active"]) {
      check(`gate ${t} is present`, types.includes(t), `got ${types.join(", ")}`);
    }
    check(
      "every gate state is pass|fail|warn|na",
      withGates.gates.every((g) => ["pass", "fail", "warn", "na"].includes(g.state)),
    );
    check(
      "every gate carries {markdown, html} evidence",
      withGates.gates.every((g) => g.evidence && "markdown" in g.evidence && "html" in g.evidence),
    );
  } else {
    info("no contracts with gates — gate shape checks skipped");
  }
  info(`${contracts.length} contracts`);
});

// ── 8 · Regression guard — budget endpoints that already existed ────────────
console.log("\n  regression guard (pre-existing endpoints)\n");
for (const [path, label] of [
  ["/api/budget-tracker/items", "budget-tracker items"],
  ["/api/budget-tracker/expenses", "budget-tracker expenses"],
  ["/api/budget-tracker/financial-status", "budget-tracker financial-status"],
  ["/api/budget-data/trades", "budget-data trades"],
  ["/api/budget-data/work-item-types", "budget-data work-item-types"],
  ["/api/budget-assumptions/summary", "budget-assumptions summary"],
  ["/api/budget-scenarios", "budget-scenarios"],
]) {
  const res = await client.get(path);
  check(`${label} still 200`, res.status === 200, `GET ${path} → ${res.status}`);
}

// ── 9 · The pages themselves render ────────────────────────────────────────
// `fetch` follows redirects, so the two legacy paths are asserted by where they
// LAND: a 200 whose HTML carries the workbench heading proves the redirect went
// to the Command Center rather than to a page that can no longer parse its data.
console.log("\n  pages\n");
const WORKBENCH_MARKER = "Budget Command Center";
for (const [path, label, wantMarker] of [
  ["/admin/budget", "Budget Command Center page renders", true],
  ["/admin/budget/grid", "legacy /grid lands on the workbench", true],
  ["/admin/budget/inbox", "legacy /inbox lands on the workbench", true],
  ["/admin/budget/tracker", "budget tracker page still renders", false],
]) {
  const res = await client.get(path);
  if (res.status === 404 && !IS_PREVIEW && (NEW_PAGES.has(path) || wantMarker)) {
    pending.push(`${path} → 404 (page not deployed here)`);
    console.log(`  · ${label} — PENDING (not deployed to this target yet)`);
    continue;
  }
  const got200 = check(`${label} → 200`, res.status === 200, `GET ${path} → ${res.status}`);
  if (got200 && wantMarker) {
    const served = (res.text ?? "").includes(WORKBENCH_MARKER);
    if (!served && !IS_PREVIEW) {
      pending.push(`${path} → 200, still the pre-merge page`);
      console.log(`  · ${label} — PENDING (still the pre-merge page here)`);
      continue;
    }
    check(`${label} — served the workbench`, served);
  }
}

if (pending.length > 0) {
  console.log(`\n  ${pending.length} endpoint(s) PENDING merge/deploy on this target:`);
  for (const p of pending) console.log(`    · ${p}`);
}

finish();
