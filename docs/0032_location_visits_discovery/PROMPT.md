# 0032 — Build Prompt (coding agent)

You are implementing **0032 — Location-Source-Agnostic Visits & Discovery** in `jmbish04/core-remodel`. Read `IMPLEMENTATION_PLAN.md` and `DESIGN_SPEC.md` in this folder first. Preview changelog: https://core-remodel.hacolby.workers.dev/admin/changelog/preview/0032-location-visits-discovery

## The one idea
Decouple visit-capture & discovery from the 500 ms streaming Durable Object. Introduce a normalized `LocationFix` ingress that **any** source feeds — Tessie poll, phone GPS (`device_location`, already exists), AI-supplied coords, manual, or the optional streaming DO — and run the existing park pipeline off that. With the DO **off**, the poller + phone + AI must keep every feature working at ~120 s granularity.

## Ground rules (repo law — see AGENTS.md)
- **First action:** `pnpm run worktree:check`; rebase onto `origin/main` if behind.
- Migrations: `pnpm run db:generate` / `db:generate:tesla` only — **never hand-author**. Additive/nullable so concurrent previews survive. CHECK via Drizzle `check()`; verify generated SQL.
- D1: no `transaction()` — use `db.batch()`; chunk any unbounded list to ≤100 bound params.
- FKs + JOIN for display names — never a denormalized `*_name`.
- Notes = PlateJS `{markdown, html}` both columns. Currency = text+cents (n/a here).
- Every MCP tool has a REST twin through one service layer. Hand-written Zod v4, correct annotations, ≥1 example.
- Reuse, don't rebuild: `services/tesla.ts`, `device_location`, `visit-sessions.ts`, `drive-geo-match.ts`, `google/maps.ts` (`placesNearby`/`reverseGeocode`/`isUnderMonthlyQuota`), `whats_near_me`, `find_known_showrooms`, `showroom_gaps` pattern.
- One PR per phase; QC script per PR (preview + prod); changelog entry + detail with Mermaid + verification block; changelog link in the PR body. Open PRs autonomously.
- **Deploy is agent-owned:** after merge run the `Deploy (manual)` action (`run_migrations: true` when schema changed).

## Build order (this pass owns L0–V2, C1, D1-service)
1. **L0 — ingress.** `src/backend/services/location/ingest.ts`: `LocationFix` type + `ingestLocationFix(env, fix)`. Adapt callers: `tesla-poller.ts`, `tesla-stream.ts onFrame`, `POST /device-location`, new `POST /api/tesla/manual-here`, new MCP `report_location`. No new firehose table — provenance reuses existing sinks; write only park-session events.
2. **L1 — detector.** `src/backend/services/location/park-detector.ts`: shiftState transition OR dwell heuristic (KV state `loc:detector:<subjectId>`); `park_sessions` table (§5.4); emit park/drive-away → call the existing decision tree in `visit-sessions.ts` (extend it from "stream-only" to "fix-driven"). Constants from config (§7).
3. **V1 — schema.** Reconcile `showroom_visit_log` to §5.1: add `visit_type`, `hitl_queue_id` + XOR CHECK (confirm the soft-arrival nullability rule with the user first — see plan §10), `match_distance_m`, `provenance_json`, `rating` CHECK, widen `gps_source`. Migrate the mislabeled `type` axis.
4. **V2 — visit logs.** REST CRUD `/api/showroom-visit-logs` (+ `/showroom-stores/:id/visit-logs`, `/showroom-contact-log`); MCP `create/get/list/update/delete_visit_log`, `stage_showroom_visit`, `finalize_visit_log`, `log_contact_interaction` (extend `record_showroom_visit` to also write a SUBMITTED row); the workspace pages + store Visits section per DESIGN_SPEC; shared components.
5. **C1 — config.** `/admin/config/tesla` (home/work geocode, radii, stale, dwell) + `config-nav.ts` + permit "primary residence" toggle.
6. **D1 — proximity service.** `src/backend/services/tesla/proximity-scan.ts` (reuse `placesNearby` + `find_known_showrooms` + quota hard-disable, 10 s timeouts); `showroom_store_hitl_queue` + `showroom_exclusions` tables; decision 1.d; `drive_lists += paused`, `drive_list_stops += is_detour/hitl_queue_id`, `showroom_stores` proximity flags; HITL REST + MCP (`list_showroom_discoveries`/`decide_showroom_discovery`); Park-Finds page shell.

## Explicitly NOT this pass (hand off — see TRACKING.json)
- **D2** discovery finder (`showroom_search/_revision/_result`, `find_showrooms` orchestration, realtime DO, finder pages, voice CRUD parity).
- **N1** multi-waypoint nav + waypoints spike + `NavigateTeslaButton`.
- **K1** real-time voice MCP keepalive (P7-INFRA-01).

## Definition of done (per phase)
tsc clean on touched files · build green · migration applied to remote & verified · QC green on preview and prod · changelog entry with real QC output · deployed via the manual action · `TRACKING.json` sections flipped to `done` with the PR number.
