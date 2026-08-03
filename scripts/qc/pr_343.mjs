#!/usr/bin/env node
/**
 * QC for PR #343 — homeowner room model + canonical measurement view (0041/0043).
 * Run: node scripts/qc/pr_343.mjs            (prod regression)
 *      node scripts/qc/pr_343.mjs --preview  (this branch's preview worker)
 *
 * What this PR actually adds at runtime is thin: the substance is
 * measurement-view.ts, a PURE resolver with no HTTP endpoint of its own yet
 * (the 0043 read layer is deferred). Its real gate is the mutation-checked unit
 * test (measurement-view.test.ts), run separately:
 *   node --test src/backend/services/homeowner/measurement-view.test.ts
 *
 * So this script is a REGRESSION guard: it proves the rooms read path still works
 * after rooms.area_sq_ft moved from a stored column to a computed field. Against
 * prod (main) that column still exists, so a green run proves we didn't break
 * what's live; re-run it post-merge+deploy to prove the computed path is live.
 *
 * The new tables (0169) and the resolver's live wiring are reported as
 * PENDING — they only exist once the PR merges and 0169 is reconciled + applied.
 */
import { createClient, createChecks, resolveBase, assertReachable } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_343 (room model / measurement view) against ${BASE}\n`);

await assertReachable(c, { ok: check });

// Regression: rooms read must not 500 after the area_sq_ft column change.
const rooms = await c.get("/api/rooms/catalog");
check("GET /api/rooms reachable (not 5xx)", rooms.status < 500, `status=${rooms.status}`);
check(
  "GET /api/rooms returns rooms (200 + body)",
  rooms.status === 200 && !!rooms.text,
  `status=${rooms.status} ${rooms.text?.slice(0, 120)}`,
);
// areaSqFt should still be present as a field (computed post-merge, stored on prod now).
const mentionsArea = typeof rooms.text === "string" && /areaSqFt/.test(rooms.text);
check("rooms payload still carries areaSqFt (computed/stored)", mentionsArea, `found=${mentionsArea}`);

// Deferred surface — honest markers, not silent gaps.
info("PENDING (merge/deploy): 0169 tables (walls, room_measurements, decisions/impacts, …) — not applied to remote yet.");
info("PENDING (merge/deploy): rooms.area_sq_ft DROP must ride the deploy; do NOT migrate:remote from the unmerged branch.");
info("Resolver gate is the unit test: node --test src/backend/services/homeowner/measurement-view.test.ts");

process.exit(summary().failed === 0 ? 0 : 1);
