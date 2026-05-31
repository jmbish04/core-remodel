# Workflow: AI-Augmented Questionnaire, Floor Plan & Contractor Deal Portal

## Objective

Implement an enterprise-grade asynchronous planning and communication platform for "126 Colby - Remodel Mission Control" that bridges homeowner desires and field crew execution, with an admin-controlled AI rationale workflow that the user can configure, run on demand, and observe in real time.

## Implementation Phases

### Phase 1 — Docs sync

1. Pull updated `docs/` files from `origin/main` (merge or branch from main HEAD).
2. Clean up superseded files at old paths only if they are not also re-created on main.

### Phase 2 — Schema & migration

1. Add `src/backend/db/schema/home/questionnaire.ts` with 6 tables: `checklist_sections`, `checklist_questions`, `checklist_answers`, `checklist_room_mappings`, `room_material_quotes`, `checklist_service_logs`.
2. Add `src/backend/db/schema/admin/workflow_schedules.ts` with 2 tables: `system_cron_schedules`, `workflow_run_history`.
3. Append exports to `src/backend/db/schema/index.ts`.
4. Run `pnpm run db:generate` then `pnpm run migrate:local`.
5. Seed at least one schedule row for `checklist_rationale` (disabled by default).

### Phase 3 — Hono routers

1. Create `src/backend/api/routes/construction-checklist.ts` (mount at `/api/construction-checklist`).
   - Use `zValidator("json", schema)` middleware (project convention).
   - Auto-emit `budget_tracker_items` row when an answer is committed (non-draft, checked, first transition).
2. Add `GET /rooms/:roomId/quotes` to existing `src/backend/api/routes/portal.ts`.
3. Create `src/backend/api/routes/admin-workflows.ts` (mount at `/api/admin/workflows` — auto-inherits `requireAccessAuth`).
4. Create `src/backend/services/cron-utils.ts` (5-field cron parser + `computeNextRunAt`).

### Phase 4 — Frontend

1. Build `ConstructionChecklistApp.tsx`, `InteractiveFloorPlan.tsx`, `ChecklistPrintView.tsx` (React components).
2. Build `AdminWorkflowsPanel.tsx` and wire it into `AdminDashboardApp.tsx` as a new tab.
3. Add 3 Astro pages: `/questionnaire/`, `/questionnaire/[section_slug]`, `/questionnaire/print`.
4. Add `{ href: "/questionnaire", label: "Questionnaire" }` to `siteConfig.navItems`.
5. Flip the `questionnaire-and-ai-guidance` docs entry from `status: "planned"` to `status: "live"`.
6. **Do NOT replace the existing `AppSidebar.tsx`** — it already has the docs tree and audience grouping the requirement describes.

### Phase 5 — AI rationale workflow

1. Create `src/backend/services/checklist-rationale-workflow.ts` extending `WorkflowEntrypoint`.
2. Stream progress through `publishRealtimeEvent(env, "admin-workflows:checklist_rationale", payload)` at every step boundary.
3. Respect HITL retention: NEVER overwrite mappings whose `associationStatus` is `user_confirmed` or `user_disassociated`.
4. Create `src/backend/services/workflow-dispatcher.ts` — reads `system_cron_schedules`, fires due workflows.
5. Re-export `ChecklistRationaleWorkflow` from `src/_worker.ts`.
6. Gate the existing `scheduled()` handler by `event.cron` so each trigger fires the right path.
7. Register the new workflow + `* * * * *` master-tick cron in `wrangler.jsonc`.
8. Run `pnpm run cf-typegen`.

### Phase 6 — Verification

1. `pnpm run build` (must succeed — JSX `class=` typos fail hard).
2. Smoke-test the API surface with curl.
3. Visit `/questionnaire`, `/admin`, `/budget-tracker`; confirm committed answers auto-emit budget rows.
4. Open `/admin` → Workflows tab → click "Run Now" → confirm live WS feed streams `queued → started → load-candidates → ai-infer → upsert-mappings → finished`.
