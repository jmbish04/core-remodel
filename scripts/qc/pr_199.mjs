#!/usr/bin/env node
/**
 * @fileoverview QC — PR #199, 0028 Phase 0 (PMO foundation).
 *
 *   pnpm run test:pr 199 -- --preview   # this branch's preview worker
 *   pnpm run test:pr 199                # production — new endpoint PENDING
 *                                       # until merge + deploy
 *
 * The deliverable is the source-agnostic `/api/pmo/work-items` surface over the
 * new adapter layer. The assertions check that:
 *   - both adapters return a valid, normalized WorkItem shape for real rows;
 *   - the composite id / filter contract holds;
 *   - the write path round-trips a status change and reverts it;
 *   - the auth gate rejects an unauthenticated caller;
 *   - the schema migration actually landed on remote D1 (a plan_tasks column).
 *
 * `plan_tasks` is guaranteed to have rows (the 0028 plan itself, 61 of them), so
 * the plan adapter is exercised against real data. The planning adapter is
 * checked for shape only when `planning_tasks` has any rows — the remodel side
 * may legitimately be empty.
 */
import { createClient, createChecks, assertReachable, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(
  `\nQC pr_199 — 0028 P0 PMO foundation\n  target: ${resolveBase()}${
    onProd ? " (PROD — /api/pmo PENDING until merge+deploy)" : ""
  }\n`,
);

await assertReachable(client, checks);

/** Every field the WorkItem contract promises, with a loose type check. */
function isWorkItem(x) {
  return (
    x &&
    typeof x.id === "string" &&
    x.id.includes(":") &&
    typeof x.nativeId === "string" &&
    typeof x.key === "string" &&
    typeof x.source === "string" &&
    typeof x.status === "string" &&
    typeof x.health === "string" &&
    Array.isArray(x.dependsOn) &&
    Array.isArray(x.people) &&
    Array.isArray(x.links)
  );
}

const WORK_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked", "deferred", "done"];
const HEALTHS = ["on_track", "at_risk", "blocked", "unknown"];

// ── 1. The plan adapter, against the 0028 plan's own rows ───────────────────
const planRes = await client.get("/api/pmo/work-items?source=plan&container=0028_project_management");

if (onProd && planRes.status === 404) {
  checks.info("PENDING (prod): /api/pmo not deployed yet — expected before merge.");
} else {
  const okList = checks.ok(
    "GET /api/pmo/work-items?source=plan → 200",
    planRes.status === 200,
    `→ ${planRes.status}`,
  );

  if (okList) {
    const items = planRes.json?.items ?? [];
    checks.ok("plan adapter returns the 0028 tasks", items.length >= 11, `${items.length} items`);
    checks.ok("every row is a valid WorkItem", items.length > 0 && items.every(isWorkItem));
    checks.ok(
      "statuses are in WorkStatus space (mapped, not raw)",
      items.every((i) => WORK_STATUSES.includes(i.status)),
    );
    checks.ok("health is derived onto every item", items.every((i) => HEALTHS.includes(i.health)));
    checks.ok(
      "composite id is `plan:<nativeId>`",
      items.every((i) => i.id === `plan:${i.nativeId}` && i.source === "plan"),
    );

    // Phase filter narrows.
    const p0 = await client.get(
      "/api/pmo/work-items?source=plan&container=0028_project_management&phase=0",
    );
    checks.ok(
      "?phase=0 narrows to phase-0 tasks only",
      p0.status === 200 && p0.json.items.length > 0 && p0.json.items.every((i) => i.phase === 0),
      `${p0.json?.items?.length} phase-0 items`,
    );
  }
}

// ── 2. The planning adapter (shape only; the remodel side may be empty) ─────
const planningRes = await client.get("/api/pmo/work-items?source=planning");
if (!onProd || planningRes.status === 200) {
  if (checks.ok("GET ?source=planning → 200", planningRes.status === 200, `→ ${planningRes.status}`)) {
    const items = planningRes.json?.items ?? [];
    if (items.length === 0) {
      checks.info("planning_tasks is empty — planning adapter shape not exercised (ok).");
    } else {
      checks.ok(
        "planning items are valid WorkItems with source=planning",
        items.every((i) => isWorkItem(i) && i.source === "planning" && i.id === `planning:${i.nativeId}`),
      );
    }
  }
}

// ── 3. The "everything" read concatenates sources ───────────────────────────
const allRes = await client.get("/api/pmo/work-items");
if (!onProd || allRes.status === 200) {
  if (checks.ok("GET /api/pmo/work-items (no source) → 200", allRes.status === 200)) {
    const sources = new Set((allRes.json?.items ?? []).map((i) => i.source));
    checks.ok("cross-source read includes plan items", sources.has("plan"));
  }
}

// ── 4. The write path round-trips, then reverts ─────────────────────────────
if (!onProd && planRes.status === 200 && planRes.json.items.length > 0) {
  const target = planRes.json.items[0];
  const original = target.status;
  const next = original === "in_progress" ? "todo" : "in_progress";

  const patch = await client.patch(`/api/pmo/work-items/${target.id}`, { status: next });
  const okPatch = checks.ok(
    "PATCH work-items/:id changes status",
    patch.status === 200 && patch.json?.item?.status === next,
    `→ ${patch.status}, status=${patch.json?.item?.status}`,
  );

  if (okPatch) {
    // Revert, so a re-run starts from the same state.
    const revert = await client.patch(`/api/pmo/work-items/${target.id}`, { status: original });
    checks.ok("PATCH reverts cleanly", revert.status === 200 && revert.json.item.status === original);
  }

  const bad = await client.patch("/api/pmo/work-items/plan:notanumber", { status: "done" });
  checks.ok("PATCH on an unknown id → 404", bad.status === 404, `→ ${bad.status}`);

  const malformed = await client.patch("/api/pmo/work-items/nocolon", { status: "done" });
  checks.ok("PATCH on a malformed id → 400", malformed.status === 400, `→ ${malformed.status}`);
} else if (onProd) {
  checks.info("PENDING (prod): write-path checks run against --preview only.");
}

// ── 5. The auth gate ────────────────────────────────────────────────────────
const unauth = await client.get("/api/pmo/work-items", { auth: false });
if (!onProd || unauth.status !== 404) {
  checks.ok(
    "unauthenticated /api/pmo → 401",
    unauth.status === 401,
    `→ ${unauth.status}`,
  );
}

// ── 6. The migration landed (a new plan_tasks column is queryable) ──────────
// Proven indirectly but reliably: a plan item carries the new schedule fields
// (null is fine — the point is the column exists, else the query 500s).
if (!onProd && planRes.status === 200 && planRes.json.items.length > 0) {
  const item = planRes.json.items[0];
  checks.ok(
    "new plan_tasks columns are present (startAt/progressPct on the item)",
    "startAt" in item && "progressPct" in item && "effortPoints" in item,
  );
}

checks.finish();
