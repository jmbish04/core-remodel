# 0027 — Public /health page + on-demand health screen

**Status:** built · **Branch:** `claude/health-status-page` · **PR:** #182
**Plan slug (D1):** `0027_health_status_page`
**Preview changelog:** https://core-remodel.hacolby.workers.dev/admin/changelog/preview/health-status-page

## Context / problem
`https://core-remodel.hacolby.workers.dev/health` 404s today. The only health surface is
`GET /api/health` (JSON), which merely pings D1 and re-reads the `health_checks` table — it does
not exercise the other bindings, and there is no human-facing page. The user asked for a `/health`
page with an on-demand button that runs real health screening on the worker and renders the results.

## What exists (reuse, don't rebuild)
- `health_checks` D1 table (`service_name`, `status`, `response_time`, `error_message`, `timestamp`).
- `GET /api/health` (public, write-on-read) + `GET /api/health/history` (`src/backend/api/routes/health.ts`).
- Page/island pattern: `usage.astro` → island → `shared.tsx`. No `/health` page, no health service.
- Env bindings: `DB` + `TESLA_DB` (D1), `CACHE` (KV), `ARTIFACTS_BUCKET` (R2), `AI` (Workers AI).

## Design
- **`src/backend/services/health/screen.ts`** — `runHealthScreen(env)` probes in parallel, bounded
  and free: `DB` + `TESLA_DB` (`SELECT 1`), `CACHE` (KV put/get a short-TTL probe), `ARTIFACTS_BUCKET`
  (R2 `head` a sentinel), `AI` (binding presence — running a model costs, so no). Times each, writes
  one `health_checks` row per service via `db.batch()` (NEVER `db.transaction()` — D1 has no
  transactions), rolls up overall (down > degraded > healthy). No probe throws out; a failure is a
  `down` result; a persistence failure is logged but doesn't sink the live results.
- **`POST /api/health/run`** (`routes/health.ts`) — on-demand trigger, public (like `GET /api/health`).
  Returns per-service results; 200 even when a service is down (read `status` from the body).
- **`/health` page + `HealthCheckApp` island** (public) — snapshot on mount (`GET /api/health`), the
  button runs a fresh screen (`POST /api/health/run`), per-service cards (healthy/degraded/down badge
  + latency), overall roll-up. Follows the page-shell rule; the island owns the `<main>` container.

## Non-goals / decisions
- No schema change (reuses `health_checks`). Public by design — matches the bare `/health` URL and the
  already-public `/api/health`; the "run" action can move under `/api/admin/*` to gate it later.
- Own branch off `origin/main`, separate from the Tesla-telemetry work (PR #181), to keep that PR clean.

## Success criteria
- `/health` renders and, on button click, shows live per-service status + latency for D1, TESLA_DB, KV,
  R2, and Workers AI, with an overall roll-up; each run writes `health_checks` rows.

## Verification
- `tsc --noEmit` clean on touched files. QC `scripts/qc/pr_182.mjs` (preview + prod-pending aware):
  `GET /api/health` regression, `POST /run` shape + service coverage, history, `/health` HTML.
