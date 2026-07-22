# 0029 — PROMPT (hand-off to the coding agent)

Build the health platform described in `docs/0029_health_platform/IMPLEMENTATION_PLAN.md` and
`DESIGN_SPEC.md`. Work off a fresh worktree cut from `origin/main`.

1. **Contract first.** `src/backend/services/health/types.ts` — `HealthProbe` (name, displayName,
   description, healthTsFilepath, bindingTypesTested, whatSuccessMeans, whatFailureMeans,
   troubleshootingSteps, devOpsPlaybook, isBillingRisk, severity, `run(env)`), plus `defineProbe`,
   `ok`/`degraded`/`failure`, `readSecret`, `scalar`, `tableExists`.

2. **One `health.ts` per backend module**, each exporting `HEALTH_PROBES: HealthProbe[]`:
   `db`, `api`, `ai`, `mcp`, `realtime`, `services/{workflows,ai-gateway,usage,render,email,gmail,
   google,google-photos,tesla,showroom,documents,image-processor}`.
   Every probe must be **bounded and free** — binding presence, Secrets Store reads, D1 aggregates,
   one tiny KV round trip, R2 `head`/`list({limit:1})`. Never invoke a model, call a paid API, or
   create a Workflow instance. Verify every table and column against the real drizzle schema before
   writing SQL — do not guess names. The documentation fields are read by a human at 3am: real,
   specific, numbered steps naming this repo's actual commands.

3. **Schema** — `src/backend/db/schema/health/health_tests.ts`: `health_test_def`,
   `health_binding_types`, `health_test_binding_types`, `health_results` (see the ERD in the plan).
   Export from the schema barrel, `pnpm run db:generate`, apply with `pnpm run migrate:remote`.
   Leave `health_checks` alone.

4. **Registry + runner** — `services/health/registry.ts` groups modules for the dashboard and
   flattens to `ALL_HEALTH_PROBES` (de-duplicating by name, logging rather than throwing).
   `services/health/run.ts`: `syncHealthCatalogue` (upsert defs + binding vocabulary + mappings,
   deactivate probes deleted from code), `runHealthSession` (concurrent, 10s per-probe time box,
   one `health_results` row per probe under a shared `session_uuid`), `getHealthCatalogue`,
   `getLatestHealthSession`, `listHealthSessions`. **`db.batch()` only — never `db.transaction()`.**

5. **API** — add `POST /api/health/session`, `GET /api/health/session/latest`,
   `GET /api/health/sessions`, `GET /api/health/catalogue`, `GET /api/health/badge` to
   `routes/health.ts`, all behind `isRequestAuthenticated`. Leave `GET /api/health` and
   `POST /api/health/run` public and unchanged.

6. **Frontend** — new `src/frontend/pages/admin/health.astro` (Astro shell owns `<main>` + the h1
   header block with a 24px icon; `class`, never `className`), `HealthDashboardApp` timeline island,
   `HealthStatusBadge` pip wired into `AppHeader` and the mobile sidebar bar, `System Health` in
   `NAV_GROUPS`, `["/health", "/admin/health"]` in `LEGACY_REDIRECTS`, delete the old public page and
   `HealthCheckApp`.

7. **Ship it.** `npx tsc --noEmit`, `pnpm run migrate:remote` + verify the tables exist remotely,
   `pnpm run deploy:preview`, run a real session and paste its output, `scripts/qc/pr_<n>.mjs`
   against preview **and** production, changelog branch + entry + `PhaseDetail` with Mermaid
   diagrams and a `verification` block, then the PR with the changelog link.
