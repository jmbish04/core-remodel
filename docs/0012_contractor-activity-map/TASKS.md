# Contractor Activity Map — Implementation Plan

Ordered by dependency: DB → sync logic → API → UI → verify. See [SPEC.md](./SPEC.md).

## 1. Database schema (Drizzle) — ✅ DONE
- [x] `permits_records`: add `filedDate`.
- [x] `permits_contacts`: identity + anchor fields.
- [x] `permits_contact_activity`: trade/flags/relation/recentActivity/match fields.
- [x] `permits_contact_insights`: `beforeBusyness`, `afterBusyness`.
- [x] `pnpm run db:generate` → `drizzle/0032_demonic_psylocke.sql` (23 clean ADD COLUMNs). Applied locally.

## 2. Backend sync — ✅ DONE (modularized under `services/dbi/`)
- [x] `soda.ts` — shared SODA client + helpers.
- [x] `datasets.ts` — trade registry + per-dataset field maps.
- [x] `matching.ts` — Phase 3 cascade (license→sf-biz→firm→person→name-tokens→address-tokens) with **shared-address precision guard**.
- [x] `activity.ts` — Phase 4 inspections (`vckc-dh2h`/`fuas-yurr`) + addenda (`87xy-gk8d`) batched.
- [x] `contractor-sync.ts` — Phases 2/3/5: anchor contacts → gather → filter (open/recently-closed) → relation tag → persist; auto-demote stale monitors (replaces `CONTACT_EXCLUSIONS`).
- [x] `ai-insights.ts` — Phase 6 before/after busyness; template-literal prompt; heuristic fallback.
- [x] `permits-sync.ts` — slimmed orchestrator (1860→~720 lines), Phase 1 multi-trade + `filedDate`, preserved dashboard/detail getters, new contractor-centric `getPermitContactsInsights`.

## 3. API — ✅ DONE
- [x] `getPermitContactsInsights` returns `{ contractors[], target }`; route spreads it unchanged.

## 4. Frontend — IN PROGRESS (delegated to cf-frontend-engineer, background)
- [ ] `ContractorActivityMap.tsx`: filters (top) → AI busyness cards → map (markers + home marker) → sortable/filterable table → bidirectional hover highlight.
- [ ] Wire into `PermitsAdminApp` `section==="contacts"` branch.

## 5. Verify
- [x] Migration generated + applied locally.
- [x] oxlint clean on all new modules.
- [x] Live SODA validation: parcel 5934/005, street clause, matcher precision (guarded), inspection + addenda joins.
- [x] Unit validation: where-clause (building + electrical field maps), classifier guard, status/open-closed/block-lot helpers.
- [x] Homeowners permits doc fixed (daily 14:00 UTC, not hourly).
- [x] End-to-end: ran real `runPermitSync` via `getPlatformProxy` against local D1 + live SODA → 4 anchors, 4 contractors, 1,400 activity rows (1,381 geo), 4 AI insights, **0 errors**.
- [x] **Bug caught + fixed by e2e:** `persistTargetRecords` used `db.transaction()` — D1 rejects `BEGIN`/`SAVEPOINT`, so every persist silently failed. Now sequential idempotent upserts. (Inherited from original code — likely why the page never populated.)
- [ ] Frontend hover/visual pass in a real browser (rendered HTTP 200 under `astro dev`; map markers not yet eyeballed live).
- [ ] `pnpm run migrate:remote` + `pnpm run deploy` at ship (prod change, user-triggered).

## Findings / open decision
- **Old "open-but-quiet" anchors inflate volume.** Some 126 Colby anchors are plumbing permits filed in 2000/2006 that were `issued` but never formally closed. Per the agreed "open = anchor" rule they pull in those contractors' full multi-decade history → 1,400 activity rows, ~5 min sync. It works, but risks the Workers **1,000-subrequest limit** as the open-anchor set grows.
- **Recommendation (needs your call):** cap anchors to open permits filed within the last N years (e.g., 3–5), OR cap gathered permits per contractor to the most-recent N. Either keeps the sync well within Worker limits without abandoning the open-status rule. Not changed unilaterally since it touches the rule you specified.
- Map renders 1,381 individual markers; consider `MapClusterLayer` (already in `ui/map.tsx`) if the per-contractor filter isn't enough.
