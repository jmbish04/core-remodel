# PROMPT — build the /health page

Build a public `/health` status page for the core-remodel worker (Hono + Astro + Drizzle/D1).

1. **`src/backend/services/health/screen.ts`** — `runHealthScreen(env)`: probe `DB` + `TESLA_DB`
   (`SELECT 1`), `CACHE` (KV put/get a short-TTL probe key), `ARTIFACTS_BUCKET` (R2 `head` a sentinel),
   and `AI` (binding presence only — do NOT run a model, it costs). Time each; write one `health_checks`
   row per service with `db.batch()` (NEVER `db.transaction()` — D1 has no transactions); roll up
   overall (down > degraded > healthy). No probe may throw out of the service — a failure becomes a
   `down` result; a persistence failure is logged, not thrown.
2. **`POST /api/health/run`** in `src/backend/api/routes/health.ts` — call the screen, return results,
   200 even when a service is down. Keep it public (like `GET /api/health`).
3. **`src/frontend/pages/health.astro`** (thin, `BaseLayout`) + **`HealthCheckApp`** island
   (`src/frontend/components/health/`): snapshot on mount (`GET /api/health`), a Run button
   (`POST /api/health/run`), per-service cards + overall roll-up. Follow the page-shell rule; the
   island owns `<main className="container mx-auto max-w-4xl px-4 py-8 pb-12">` (`className` is correct
   inside a `.tsx` island).
4. Reuse the existing `health_checks` table + `GET /api/health/history`. No migration.
5. Add `scripts/qc/pr_<n>.mjs` (preview + prod-pending aware) and typecheck touched files.
