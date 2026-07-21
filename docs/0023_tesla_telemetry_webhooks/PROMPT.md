# PROMPT — build 0023 Tesla Telemetry Webhooks

You are building `docs/0023_tesla_telemetry_webhooks/` on branch
`claude/tesla-telemetry-webhooks-2jnnj9`. Read `IMPLEMENTATION_PLAN.md`, `DESIGN_SPEC.md`, this repo's
`AGENTS.md` (esp. the new "MANDATORY planning artifacts" section and the deploy / PR / changelog
discipline), and `docs/0022_gps_showroom_drives/` (PRD + TASKS.json) — 0023 delivers the full 0022 set
plus two safety systems and a corrected ingest architecture.

**Do the two cost-safety systems FIRST, each as its own PR, before anything that opens a socket, arms
an alarm, or calls Google:**

1. **DO alarm circuit breaker.** New alarm-bearing DOs extend `DurableObject` and use native
   `ctx.storage.setAlarm()` / `deleteAlarm()` — **NEVER** the Agents-SDK `this.schedule()`. That
   append-only API caused the $700 `cf_agents_schedules` runaway (root cause in commit `26b7607` /
   #162: `onStart()` fires on every DO wake + `audit()`'s `finally` both re-armed unconditionally → the
   schedule table grew to ~1M rows → 537B DO-SQLite rows read). Add a CI guard that fails on
   `this.schedule(` in new DOs. Build `src/backend/services/safety/do-circuit-breaker.ts`: on every
   alarm fire, cheap self-checks (fire-rate rolling counter, SARGABLE schedule-table count, per-day
   TESLA_DB write budget + max connected duration); on trip → `deleteAlarm()` + a global kill-switch in
   `project_system_variables` + refuse to run (hard breakage; downtime by design) + admin surface.
   Retro-harden `RemodelOrchestrator`.

2. **Per-API Google quota hard-block.** In `src/backend/services/google/maps.ts`, replace the single
   combined `total` guard with per-API buckets (places / geocoding / routes) read from
   `google_maps_usage_log.byEndpoint`; each blocks its own API only at the free-tier limit. Fold the
   buggy `canUseGoogleMaps` (8,000 / ms-vs-seconds) into the one guard. Close the untracked bypasses
   (Places-Photo fetches in `services/showroom/onboarding.ts` and
   `ShowroomResearchAgent/methods/backfill.ts`; the raw fetch in `shopping-journal.ts`). Add gated
   `reverseGeocode(lat,lng)` + `placesNearby(...)`.

**Then ingest (PR 3):** `TeslaStreamDO` holding the outbound Tessie WebSocket
(`streaming.tessie.com/<vin>`, `fetch` Upgrade → `resp.webSocket.accept()`) → write frames to
`TESLA_DB` (recording gate + write budget) → pipeline; reconnect via native alarm with capped backoff;
lifecycle bounded to active-drive / manual windows. Keep the `POST /api/tesla/webhook` + `/telemetry`
endpoints as a compat/fallback feeding the same pipeline.

**Then** P1 visit-logs → P2 config → P3 pipeline (transition detection, park tree 1.a–1.c, two-row
drive-away, `paused`) → P4 HITL proximity → P5 nav → P6 location AI (`get_current_vehicle_location`,
`whats_near_me`) → P7 discovery finder + realtime + voice-MCP keepalive, per the phase table and
`TASKS.json`.

**Every PR:** rebase onto `origin/main`; `scripts/qc/pr_<n>.mjs` run against `--preview`; migrations
applied to remote and verified; changelog entry (branch / PR / tests-run / remote-migration-status)
with the link in the PR body; delete the preview on merge. Schema only via `pnpm run db:generate` /
`db:generate:tesla` → `migrate:remote` / `migrate:tesla:remote` — never hand-edit migrations. A new DO
means bumping the `wrangler.jsonc` migration tag and exporting from `src/_worker.ts` **without
disturbing the `OAuthProvider` wrapper** (`scheduled` + `email` forwarding must keep working).
