# 0023 — Tesla Telemetry Webhooks: streaming ingest, IFTTT pipeline, location AI, cost-safety

> 🔗 **Active planning cross-reference (2026-07-26):** the follow-on pass **`0032_location_visits_discovery`** reframes this plan's `ING-03` / park pipeline into a **source-agnostic `LocationFix` ingress** so visit-capture & discovery work with the streaming DO turned **off** (Tessie poll / phone / AI coords). **Unaffected & shipped:** SA-01..05 (circuit breaker), SB-01..04 (Google quota), ING-02 `TeslaStreamDO` (now one optional source). **Claimed by 0032:** ING-03, P1-DB/API/MCP/FE, P2, P3-SVC-* (generalized), P4 service. **Left for a later pass:** P7 (discovery + realtime + voice keepalive), P5 (nav). Preview: https://core-remodel.hacolby.workers.dev/admin/changelog/preview/0032-location-visits-discovery · tracker: `docs/0032_location_visits_discovery/TRACKING.json`

**Status:** Planning → preview changelog filed for review
**Plan slug (D1 `/admin/plans`):** `0023_tesla_telemetry_webhooks`
**Preview changelog:** https://core-remodel.hacolby.workers.dev/admin/changelog/preview/tesla-telemetry-webhooks
**Branch:** `claude/tesla-telemetry-webhooks-2jnnj9`
**Builds on:** 0022 GPS Showroom Drives (`docs/0022_gps_showroom_drives/`) — this plan delivers the
full 0022 phase set **plus** two net-new cost-safety systems, and corrects the ingest architecture
(the reason `TESLA_DB` is empty).

---

## 1. Context / problem

`TESLA_DB` (`core-remodel-tesla-telemetry`, id `1e291822-…`) is **empty**. The writers are not broken:
`POST /api/tesla/webhook` and `/telemetry` (`src/backend/api/routes/tesla.ts`) already persist
everything they receive. **Nothing is pushing to them.** Tessie's real-time Fleet Telemetry is **not
an inbound webhook** — it is an **outbound WebSocket** the client connects to
(`streaming.tessie.com/<vin>`, bearer token). No component holds that socket, so the table has never
had a row. A persistent outbound socket is a push stream, not a cron poll — it satisfies "no cron".

Navigation already works (outbound Tessie REST `sendNavigation`). The rest of 0022 — IFTTT park
pipeline, `showroom_visit_log` two-row soft-arrival/drive-away model, config gate, location MCP
enrichment, discovery finder — is specced in 0022 but unbuilt beyond P0 (`evaluateAutomations` is a
stub returning `[]`).

**Two hard cost-safety mandates (user, non-negotiable):**
1. Never repeat the **$700 Durable Object alarm runaway**, and install a **circuit breaker** that
   auto-detects a runaway and *hard-stops* it (downtime acceptable over billing).
2. **Track Google API usage per-API and hard-block** each API (Places, Geocoding/reverse-geocode) the
   moment its free quota is exhausted, so no billing is incurred.

### Root cause of the $700 incident (must not recur)

Fixed in commit `26b7607` / PR #162. `RemodelOrchestrator`
(`src/backend/ai/agents/RemodelOrchestrator/index.ts`) used the `@cloudflare/agents` SDK
`this.schedule()`, which is **append-only** — every call inserts a row into the SDK's internal
`cf_agents_schedules` SQLite table. It was re-armed unconditionally from `onStart()` (fires on *every*
DO wake) **and** `audit()`'s `finally`. Rows compounded (more rows → more alarms → more rows) to ~1M;
every alarm full-scanned the table → **537 billion DO-SQLite rows read in 30 days (~$512, climbing)**.
Cost driver = **DO-SQLite rows-read from an unbounded, self-multiplying schedule table** — not
wall-clock, not writes.

**Design law:** never use the Agents-SDK `schedule()` for a recurring alarm. Use native
`ctx.storage.setAlarm()` — a DO has exactly **one** alarm slot; `setAlarm` *replaces*, it cannot
append or grow a table. Every new alarm-bearing DO in this work uses native alarms.

---

## 2. Workstream A — DO alarm safety + circuit breaker (LANDS FIRST)

Ships before any alarm-bearing DO, as its own PR, wired into every alarm path.

- **A1. Native-alarm rule + CI guard.** New DOs extend `DurableObject` and use
  `ctx.storage.setAlarm()` / `deleteAlarm()` — never `this.schedule()`. Add a grep/eslint check that
  fails CI if `this.schedule(` appears in a DO other than the audited `RemodelOrchestrator`.
- **A2. Reusable circuit breaker** (`src/backend/services/safety/do-circuit-breaker.ts`), mixed into
  each alarm-bearing DO; on **every** alarm fire, before work, cheap self-checks:
  fire-rate (rolling counter in DO storage), schedule-table bound (SARGABLE
  `SELECT count(*) … WHERE callback=?`, the exact #162 signature), and a per-day `TESLA_DB` write
  budget + max continuous connected duration.
- **A3. Trip = hard breakage.** `deleteAlarm()`, set a global kill-switch in
  `project_system_variables` (`do_circuit_breaker_tripped` = reason + ts + DO); every alarm/`fetch`
  entrypoint reads it first and refuses to run until a human clears it. Surface on the admin usage
  page (reuse the "Circuit breaker" badge pattern from `MapsUsageSection.tsx`).
- **A4. Retro-harden `RemodelOrchestrator`** with the A2 schedule-table-bound check on top of #162.
- **A5. Defense in depth:** breaker checks run on each stream-DO alarm and on admin-page load; no
  polling cron (per the user's "no cron" preference).

---

## 3. Workstream B — per-API Google quota hard-block

Today `GoogleMapsService` (`src/backend/services/google/maps.ts`) gates on a **single combined
`total`** via two *divergent* guards (`isUnderMonthlyQuota` 10,000 / `canUseGoogleMaps` 8,000 with a
ms-vs-seconds bug), and billable calls **bypass** gating (Places-Photo fetches in `onboarding.ts:671`
+ `ShowroomResearchAgent/methods/backfill.ts:314`; raw fetch in `shopping-journal.ts`). No
geocoding/reverse-geocode or nearby-search method exists yet. The usage log (`google_maps_usage_log`)
already records `api_type`/`endpoint` — the data for per-API bucketing exists, just unused for gating.

- **B1. Per-API buckets + hard block.** Replace the single-`total` gate with a per-API guard reading
  `getMonthlyUsage().byEndpoint`, bucketed into SKUs (`places`, `geocoding`, `routes`), each with its
  own free-tier request-count limit. A bucket at/over limit throws `MAPS_QUOTA_EXCEEDED` / returns
  null for **that API only**. Fold `canUseGoogleMaps` into the one guard.
- **B2. Close the bypasses.** Route Places-Photo fetches + the `shopping-journal` raw fetch through
  the guarded+logged service path so the counter is complete.
- **B3. New gated methods:** `reverseGeocode(lat,lng)` (Geocoding SKU) + `placesNearby(lat,lng,radius,
  type)` (Places SKU), each checks `isUnderApiQuota(...)` first and `logUsage(...)` after.
- **B4. Admin visibility:** usage page shows per-API buckets + remaining free quota + a per-API
  blocked badge.

---

## 4. The 0022 build — full scope, sequenced as PRs

P0 is shipped. Each phase is one coherent PR (rebase, QC script, changelog, preview, migrate:remote).
Task detail lives in this folder's `TASKS.json`, mirrored 1:1 in D1 `plan_tasks`
(`/admin/plans/0023_tesla_telemetry_webhooks`).

| PR | Phase | Deliverable | Safety gate |
|---|---|---|---|
| 1 | **A** | DO circuit breaker + native-alarm rule + retro-harden orchestrator | foundation |
| 2 | **B** | Per-API Google quota hard-block + `reverseGeocode`/`placesNearby` | foundation |
| 3 | **Ingest** | `TeslaStreamDO` outbound-WS → `TESLA_DB`; recording gate; `shouldProcessLocation`; stream start/stop/status | A (native alarm + breaker + write budget) |
| 4 | **P1** | `showroom_visit_log` (+contact_log cols); visit-logs REST + MCP; Visit Logs workspace; store-viewport Visits section; nav | — |
| 5 | **P2** | `/admin/config/tesla` (master switch, home/work geocoded, radii, stale secs); permit "primary residence" toggle | B (geocode) |
| 6 | **P3** | Shift-state transition detection (KV); park tree 1.a–1.c; two-row SOFT_ARRIVAL→STAGED drive-away; `drive_lists.paused` + toggle; drive viewport slide-over | wired into ingest |
| 7 | **P4** | `showroom_store_hitl_queue` + `proximityScan`; decision 1.d detour+HITL; Park-Finds page; discovery MCP; proximity flags; detour cols | B (Places) + breaker |
| 8 | **P5** | Reusable NavigateTeslaButton; multi-waypoint "send drive to car" (+ `navigation_waypoints_request` spike, sequential-share fallback) | — |
| 9 | **P6** | `get_current_vehicle_location` (heading + reverse-geocoded address + staleness) + `whats_near_me` + `navigate_tesla`/`map_drive_to_tesla`/`set_drive_active` | B (geocode + nearby) |
| 10 | **P7** | Discovery finder tables + `find_showrooms` + REST/slug actions + realtime DO + discovery/exclusions pages; visit/contact full-CRUD MCP+REST; time/location grounding; real-time voice MCP keepalive spike/fix | B (Places hard-disable) + A |

### 4.1 Ingest architecture (PR 3) — the actual fix for the empty DB

`TeslaStreamDO` (`src/backend/durable-objects/tesla-stream.ts`, extends `DurableObject`):
- Connects out: `fetch("https://streaming.tessie.com/<vin>", { headers: { Upgrade:"websocket",
  Authorization:"Bearer <token>" }})` → `resp.webSocket.accept()`. Frames push in.
- Per frame: shared `extractTelemetryFields` (lifted from `routes/tesla.ts` into
  `src/backend/services/tesla/frames.ts`) → insert `tesla_telemetry_events` (gated by the recording
  switch **and** the A2 write budget) → hand to the pipeline service (PR 6).
- **Reconnect via native `ctx.storage.setAlarm()`** with capped exponential backoff; the single alarm
  slot self-replaces (cannot grow). Circuit breaker checked on every fire.
- **Lifecycle bounds duration cost:** connect only while recording is on AND (a drive is `active` OR a
  manual window); disconnect on home/work park or prolonged idle. Controls:
  `POST /api/tesla/stream/start|stop`, `GET /api/tesla/stream/status`.
- Register in `wrangler.jsonc` (binding + **new migration tag**; production deploy is agent-owned so
  the bump is safe — do NOT re-enable branch CI) and export from `src/_worker.ts` **without disturbing
  the `OAuthProvider` wrapper / `scheduled`+`email` forwarding**.
- Keep `POST /api/tesla/webhook` + `/telemetry` as a **compat/fallback** feeding the same pipeline.

### 4.2 IFTTT pipeline (PR 6)

`src/backend/services/tesla/pipeline.ts` replaces the `evaluateAutomations` stub's empty return
(keep the normalized `TeslaEvent` shape + both call sites):
- Transition detection via `CACHE` KV (`tesla:last-shift:<vin>`); heavy work only on transitions
  (500 ms stream stays one KV read + compare). Webhook `drive_state` feeds the same comparator; dedupe
  on event id via `CACHE`.
- **…→P (park)**, reusing `haversineMeters` (`drive-geo-match.ts`): 1.a home/work → pause active
  drives; 1.b active-stop match → `TESLA_SOFT_ARRIVAL` + check off + auto-nav next; 1.c any registered
  showroom → soft arrival; 1.d (P4) proximity scan → HITL + detour.
- **P→D (drive-away)** → close open soft arrivals into `TESLA_STAGED` rows with arrival + departure
  (dwell) + `soft_arrival_id`. This is the row the user finalizes later.

---

## 5. Data model deltas

Per 0022 §5: new `showroom_visit_log` (two-row; XOR CHECK store_id/hitl_queue_id, rating 1–5 CHECK,
unique `soft_arrival_id`, PlateJS `notes_markdown`+`notes_html`); new `showroom_store_hitl_queue`;
`drive_lists` gains `paused`; `drive_list_stops` gains `is_detour`+`hitl_queue_id`; `showroom_stores`
proximity flags; `contact_log` gains `showroom_visit_log_id`+`type`; `TESLA_DB.tesla_telemetry_events`
gains `heading`; discovery tables (`showroom_search`/`_revision`/`_result`, `showroom_exclusions`) per
0022 §5.7. All via `pnpm run db:generate` / `db:generate:tesla` → `migrate:remote` /
`migrate:tesla:remote`; never hand-edit migrations.

**Compliance scan:** `showroom_visit_log.status`/`type` are fixed system enums (not user-editable
vocab), so the multi-select definition-table rule does not apply. No currency fields.

---

## 6. Success criteria
- `TESLA_DB.tesla_telemetry_events` accumulates real frames from the outbound-WS DO with no cron;
  `stream/status` shows connected + a recent frame.
- Park at an active-drive stop stages a `TESLA_SOFT_ARRIVAL` + checks the stop off; drive-away writes a
  `TESLA_STAGED` row with departure/dwell; home/work park pauses active drives.
- `get_current_vehicle_location` returns heading + reverse-geocoded address + staleness; `whats_near_me`
  returns registered + Places-nearby candidates.
- Breaker trips on synthetic fire-rate / schedule-table overflow, deletes the alarm, sets the
  kill-switch, and the DO refuses work; CI guard bans `this.schedule()` in new DOs.
- Driving a Google bucket to its limit blocks that API only; the previously-untracked Places-Photo path
  now logs and counts.
- Full 0022 acceptance criteria A1–A13 (see 0022 PRD §11).

## 7. Verification
Per PR: `scripts/qc/pr_<n>.mjs` against the **preview** (`--preview`); migrations applied to **remote**
and verified; changelog entry with QC output + remote-migration status; changelog link in the PR body.
`node scripts/tesla-smoke.mjs preflight` + `simulate-park` exercise the pipeline without a real drive.
After merge: `pnpm run deploy`, then QC against production.
