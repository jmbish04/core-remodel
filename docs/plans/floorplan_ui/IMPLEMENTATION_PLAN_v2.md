# Plan: Sync `docs/` from `origin/main` + Implement Master Blueprint (Questionnaire / Floor Plan / Contractor Portal) with Admin-Controlled AI Rationale Workflow

## Context

You asked me to **first pull updated `docs/` files from `origin/main`** (where you've made changes via GitHub that aren't synced here yet), and **then implement the "Master Blueprint" for the AI-augmented questionnaire, interactive floor plan, and contractor deal portal** — with one decisive elevation to Journey D: the AI rationale loop must run as a **Cloudflare Workflow** with **real-time progress streaming via `publishRealtimeEvent`** to a new **admin-only control panel** where you can configure the cron schedule, fire on-demand runs, and watch progress live.

## State vs main

- Local branch `codex/frontend-docs-suite` is **23 commits behind `origin/main`**.
- Main brings in **8 new docs files** (reorganized into `docs/context/builder_checklists/` and `docs/research/features/`) plus 2 Apps Script JSON files and a PR merge commit. **Zero source-code conflicts.**
- Two local untracked files at OLD paths are stale copies of files RENAMED on main (`docs/context/prompt_checklist_ux_discovery.md` is superseded; `docs/context/stitch_builder_Questionaire.md` is byte-identical to the canonical).

## Locked decisions (from your answers)

1. **Reject Blueprint File 6** (AppSidebar rewrite). The existing 367-line [src/frontend/components/AppSidebar.tsx](src/frontend/components/AppSidebar.tsx) already implements a richer collapsible docs tree driven by `docsAudienceGroups`. Reach the new questionnaire surface by adding one nav item to [src/frontend/lib/config.ts](src/frontend/lib/config.ts) and flipping the docs entry from `"planned"` to `"live"` in [src/frontend/lib/docs.ts](src/frontend/lib/docs.ts).
2. **AI rationale = Cloudflare Workflow + admin control panel + real-time `publishRealtimeEvent`** (details in Phase 5).
3. **Conform to existing `zValidator("json", schema)` middleware** — replace blueprint's inline `safeParse`.
4. **Package as two commits in one PR**: (1) merge `origin/main`, (2) implement blueprint.

## Existing infrastructure to reuse (confirmed by exploration)

- **`publishRealtimeEvent(env, room, payload)`** at [src/backend/realtime/publish.ts](src/backend/realtime/publish.ts) — already posts to `EstimateCollabHub` DO. 15+ call sites use rooms like `"uploads"`, `"home"`, `"budget"`, `scenario:${id}`. New room name: **`admin-workflows:checklist_rationale`**.
- **WebSocket subscriber pattern** — frontend already does `new WebSocket(\`${protocol}://${window.location.host}/api/realtime/estimates?room=${room}\`)` in [BudgetTrackerApp.tsx:544](src/frontend/components/BudgetTrackerApp.tsx), [EstimatesApp.tsx:171](src/frontend/components/EstimatesApp.tsx), [UniversalUploadApp.tsx:242](src/frontend/components/UniversalUploadApp.tsx). Reuse verbatim.
- **`scheduled()` handler ALREADY EXISTS** at [src/_worker.ts:67-69](src/_worker.ts) running `runPermitSync(env)` on `triggers.crons: ["0 14 * * *"]`. We extend it with a dispatcher.
- **Workflow pattern proven** by `ImageProcessingWorkflow` at [src/backend/services/image-workflow.ts](src/backend/services/image-workflow.ts) — `WorkflowEntrypoint<Env, Params>`, `step.do("name", async () => {...})`, registered in `wrangler.jsonc.workflows[]`, invoked via `env.BINDING.create({id, params})`. Each step publishes realtime progress. **Copy this exactly.**
- **Admin auth**: `requireAccessAuth` middleware already applied to all `/api/admin/*` routes via [src/backend/api/index.ts:59](src/backend/api/index.ts).
- **`budget_tracker_items` field shapes** verified — blueprint's auto-insert matches; we set `trackId: \`questionnaire:${answerId}\``, `revisionNumber: 1`, `changeSource: "questionnaire"`, all required NOT NULL fields explicitly.

## Blueprint pre-flight fixes (apply on paste)

- **JSX bug**: File 3 (`ConstructionChecklistApp.tsx`) has 3 `class=` attributes that must be `className=`. File 6 moot (rejected).
- **Add `credentials: "include"`** to every `fetch()` in the blueprint components — matches existing convention.
- **Convert `safeParse`** to `zValidator("json", schema)` middleware in the Hono router.

---

## Phase 1 — Sync docs from `origin/main` (commit 1 of the PR)

```bash
# Stash the in-flight unrelated working-tree edits so the merge is clean.
git stash push -m "blueprint-prep: images + wrangler + journal" \
  drizzle/meta/_journal.json \
  src/backend/api/routes/images.ts \
  src/backend/db/schema/images/image_upload_staging.ts \
  src/backend/services/image-processor.ts \
  worker-configuration.d.ts \
  wrangler.jsonc

# Move the two stale untracked docs files out of the way (both are superseded by renames on main).
mv docs/context/prompt_checklist_ux_discovery.md /tmp/prompt_checklist_ux_discovery.OLD.md
mv docs/context/stitch_builder_Questionaire.md /tmp/stitch_builder_Questionaire.OLD.md

git merge origin/main --no-edit

# Confirm equivalency before discarding.
diff /tmp/stitch_builder_Questionaire.OLD.md docs/context/builder_checklists/stitch_builder_Questionaire.md   # expect empty
rm /tmp/prompt_checklist_ux_discovery.OLD.md /tmp/stitch_builder_Questionaire.OLD.md

git stash pop
```

**Verification:** `git diff --name-status HEAD...origin/main` returns empty.

This is **commit 1** of the PR — pure `Merge branch 'main' into codex/frontend-docs-suite`.

---

## Phase 2 — Schema & migration

**Add tables** for the questionnaire surface AND the admin workflow control surface.

### 2a. Questionnaire tables — `src/backend/db/schema/home/questionnaire.ts`

Paste Blueprint File 1 verbatim. Sibling imports (`./rooms`, `./remodel_scenarios`) are valid. All money columns are `integer` cents. Tables:

- `checklist_sections`, `checklist_questions`, `checklist_answers`, `checklist_room_mappings`, `room_material_quotes`, `checklist_service_logs`.

### 2b. Admin workflow schedule + run history — `src/backend/db/schema/admin/workflow_schedules.ts` (NEW directory)

Two new tables for the admin control panel:

```ts
// system_cron_schedules — user-mutable schedule per workflow job
// columns: id (pk autoincrement), jobKey (text unique, e.g. "checklist_rationale"),
//          cronExpression (text, e.g. "*/15 * * * *"), enabled (boolean default false),
//          lastRunAt (timestamp), nextRunAt (timestamp), updatedAt, updatedBy

// workflow_run_history — per-invocation audit row, joined to checklist_service_logs
// columns: id (pk autoincrement), jobKey (text), workflowInstanceId (text),
//          triggerSource (text: "cron" | "manual_admin"), status (text: "queued"|"running"|"success"|"failed"),
//          startedAt, finishedAt, errorMessage, summaryJson
```

### 2c. Barrel & migration

- Append to [src/backend/db/schema/index.ts](src/backend/db/schema/index.ts):
  ```ts
  export * from "./home/questionnaire";
  export * from "./admin/workflow_schedules";
  ```
- **Settle the in-flight `drizzle/0015_clean_infant_terrible.sql`** (commit it or stash it) before regenerating, or the next migration will collide.
- `pnpm run db:generate` → expect `drizzle/0016_<two_words>.sql` + `drizzle/meta/0016_snapshot.json`.
- `pnpm run migrate:local` → apply to `.wrangler/state` D1.
- Seed one row into `system_cron_schedules`: `{ jobKey: "checklist_rationale", cronExpression: "*/15 * * * *", enabled: false }`.

---

## Phase 3 — Hono API

### 3a. Construction checklist router — `src/backend/api/routes/construction-checklist.ts`

Paste Blueprint File 2, then apply:
- **Convert all `safeParse` to `zValidator("json", schema)` middleware** — matches [auth.ts](src/backend/api/routes/auth.ts), [budget-tracker.ts](src/backend/api/routes/budget-tracker.ts), [photo-edits.ts](src/backend/api/routes/photo-edits.ts).
- Error envelope: `c.json({ success: false, error: "..." }, 400)`.
- Budget auto-insert: explicitly set `trackId: \`questionnaire:${answerId}\``, `revisionNumber: 1`, `isActive: true`, `isDraft: false`, `itemType: "project"`, `executionClass`, `status: "open"`, `riskLevel: "medium"`, `changeSource: "questionnaire"`, `changedBy: "system_edge_worker"`.

### 3b. Add `GET /rooms/:roomId/quotes` to existing [portal.ts](src/backend/api/routes/portal.ts)

Add to the existing `portalRouter` (do NOT fragment):
```ts
portalRouter.get("/rooms/:roomId/quotes", async (c) => {
  const roomId = Number.parseInt(c.req.param("roomId"), 10);
  if (!Number.isFinite(roomId)) return c.json({ success: false, error: "Invalid roomId" }, 400);
  const db = drizzle(c.env.DB);
  const quotes = await db.select().from(roomMaterialQuotes)
    .where(eq(roomMaterialQuotes.roomId, roomId))
    .orderBy(desc(roomMaterialQuotes.datetimeCreated)).all();
  return c.json({ success: true, quotes });
});
```

### 3c. Admin workflow control router — `src/backend/api/routes/admin-workflows.ts` (NEW)

Endpoints (all behind existing `requireAccessAuth`):
- `GET /api/admin/workflows/schedules` — list rows from `system_cron_schedules`.
- `PATCH /api/admin/workflows/schedules/:jobKey` — body `{ cronExpression?, enabled? }`; validates the cron expression syntax, recomputes `nextRunAt`, writes audit log.
- `POST /api/admin/workflows/:jobKey/run` — manual fire. Generates `workflowInstanceId = \`${jobKey}-manual-${Date.now()}\``, invokes `c.env.CHECKLIST_RATIONALE_WORKFLOW.create({ id, params: { triggerSource: "manual_admin" } })`, inserts a `workflow_run_history` row with `status: "queued"`, publishes `publishRealtimeEvent(env, "admin-workflows:checklist_rationale", { type: "queued", workflowInstanceId })`, returns `{ success, workflowInstanceId }`.
- `GET /api/admin/workflows/:jobKey/runs?limit=20` — recent run history for the panel.

Mount in [src/backend/api/index.ts](src/backend/api/index.ts):
```ts
import { constructionChecklistRouter } from "./routes/construction-checklist";
import { adminWorkflowsRouter } from "./routes/admin-workflows";

app.route("/api/construction-checklist", constructionChecklistRouter);
app.route("/api/admin/workflows", adminWorkflowsRouter);   // auto-inherits requireAccessAuth from /api/admin/* middleware
```

---

## Phase 4 — Frontend

### 4a. Components (3 of 4 from blueprint)

- **`src/frontend/components/ConstructionChecklistApp.tsx`** — paste Blueprint File 3, fix 3× `class=` → `className=`, add `credentials: "include"` to both fetches.
- **`src/frontend/components/InteractiveFloorPlan.tsx`** — paste Blueprint File 4 as-is; verify no `class=` slipped in; no Popover dep needed (uses pure Tailwind hover).
- **`src/frontend/components/ChecklistPrintView.tsx`** — paste Blueprint File 5 as-is; verify no `class=`.

### 4b. Astro pages

Follow [src/frontend/pages/budget-tracker.astro](src/frontend/pages/budget-tracker.astro) island-mount pattern:
- `src/frontend/pages/questionnaire/index.astro` — section picker.
- `src/frontend/pages/questionnaire/[section_slug].astro` — mounts `<ConstructionChecklistApp client:load sectionSlug={Astro.params.section_slug} />`.
- `src/frontend/pages/questionnaire/print.astro` — **minimal layout** (no `BaseLayout`, no sidebar) + `@media print { aside { display:none } }` belt-and-suspenders.

### 4c. Sidebar/docs integration (NO sidebar code change)

- **Add `{ href: "/questionnaire", label: "Questionnaire" }`** to `siteConfig.navItems` in [src/frontend/lib/config.ts](src/frontend/lib/config.ts) (after `/budget-tracker`). Existing sidebar auto-renders.
- **Flip [src/frontend/lib/docs.ts](src/frontend/lib/docs.ts) line ~305** `["homeowners", "questionnaire-and-ai-guidance"]` `status: "planned"` → `"live"`. Soften ~6 prose strings (lines ~308, ~336–338, ~766) from planned/intended/still-being-developed to present-tense.

### 4d. Admin workflow control panel (NEW)

Refactor [src/frontend/components/AdminDashboardApp.tsx](src/frontend/components/AdminDashboardApp.tsx) to add a **shadcn Tabs** structure with two tabs:
- **Overview** (existing analytics — unchanged).
- **Workflows** (new) — renders a new `<AdminWorkflowsPanel />`.

**New `src/frontend/components/AdminWorkflowsPanel.tsx`:**
- Lists schedule rows from `GET /api/admin/workflows/schedules`.
- Per row: cron expression editor (Input + validate-on-blur), Enabled switch (PATCHes immediately), "Run Now" button (POSTs to `/api/admin/workflows/:jobKey/run`), "Next run" / "Last run" timestamps.
- **Live progress feed**: subscribes to WebSocket `/api/realtime/estimates?room=admin-workflows:checklist_rationale` on mount. Renders a scrolling pane of `{stepName, progressPct, status, timestamp}` events from the workflow. Same pattern as [BudgetTrackerApp.tsx:544](src/frontend/components/BudgetTrackerApp.tsx).
- **Recent runs**: list from `GET /api/admin/workflows/:jobKey/runs?limit=20`.

---

## Phase 5 — AI rationale Workflow + scheduled dispatcher

### 5a. New Workflow class — `src/backend/services/checklist-rationale-workflow.ts`

Modeled exactly on `ImageProcessingWorkflow`:
```ts
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { publishRealtimeEvent } from "@backend/realtime/publish";

export interface ChecklistRationaleParams {
  triggerSource: "cron" | "manual_admin";
  workflowInstanceId: string;   // mirrors the run history row
}

const ROOM = "admin-workflows:checklist_rationale";

export class ChecklistRationaleWorkflow extends WorkflowEntrypoint<Env, ChecklistRationaleParams> {
  async run(event: WorkflowEvent<ChecklistRationaleParams>, step: WorkflowStep) {
    const { workflowInstanceId, triggerSource } = event.payload;
    await publishRealtimeEvent(this.env, ROOM, { type: "started", workflowInstanceId, triggerSource });

    const candidates = await step.do("load-candidates", async () => { /* select recent committed answers */ });
    await publishRealtimeEvent(this.env, ROOM, { type: "step", stepName: "load-candidates", count: candidates.length });

    const inferences = await step.do("ai-infer-room-mappings", async () => { /* env.AI.run per candidate */ });
    await publishRealtimeEvent(this.env, ROOM, { type: "step", stepName: "ai-infer", count: inferences.length });

    await step.do("upsert-mappings-respecting-hitl", async () => {
      // CRITICAL HITL retention: skip rows where checklist_room_mappings.associationStatus
      // IN ('user_disassociated', 'user_confirmed'). Only upsert where row is absent
      // or already 'ai_suggested'. Never override the homeowner.
    });
    await publishRealtimeEvent(this.env, ROOM, { type: "step", stepName: "upsert-mappings" });

    await step.do("log-service-result", async () => { /* checklist_service_logs + workflow_run_history finished */ });
    await publishRealtimeEvent(this.env, ROOM, { type: "finished", workflowInstanceId, status: "success" });
  }
}
```

Re-export from `src/_worker.ts` alongside `RenovationAgent` and `EstimateCollabHub`:
```ts
export { ChecklistRationaleWorkflow } from "./backend/services/checklist-rationale-workflow";
```

### 5b. Register in `wrangler.jsonc`

Append to `workflows[]`:
```jsonc
{ "name": "checklist-rationale-workflow", "binding": "CHECKLIST_RATIONALE_WORKFLOW", "class_name": "ChecklistRationaleWorkflow" }
```

### 5c. Master-tick cron + dispatcher in `scheduled()`

`triggers.crons` is **static config** — it cannot be edited at runtime. The user-configurable schedule lives in D1 (`system_cron_schedules.cronExpression`). To bridge: add a **`* * * * *` master-tick cron** that calls a dispatcher which reads D1 and fires due jobs.

**Add to `wrangler.jsonc` `triggers.crons` (keeping the existing permit-sync cron):**
```jsonc
"triggers": { "crons": ["0 14 * * *", "* * * * *"] }
```

**Extend [src/_worker.ts](src/_worker.ts) `scheduled()` handler:**
```ts
async scheduled(event, env, ctx) {
  // Existing permit sync runs on 14:00 only — gate by cron expression.
  if (event.cron === "0 14 * * *") {
    ctx.waitUntil(runPermitSync(env));
    return;
  }
  // Master tick: */1 dispatches user-configurable workflows that are due.
  if (event.cron === "* * * * *") {
    ctx.waitUntil(dispatchDueWorkflows(env));
    return;
  }
}
```

**`src/backend/services/workflow-dispatcher.ts` (new):**
- Read all `system_cron_schedules` rows where `enabled = true AND nextRunAt <= now`.
- For each, generate `workflowInstanceId`, invoke the appropriate workflow binding (lookup `jobKey` → binding map: `checklist_rationale` → `env.CHECKLIST_RATIONALE_WORKFLOW`), insert `workflow_run_history` `status: "queued"` row, update `lastRunAt = now` and `nextRunAt = next match of cronExpression`. Use a small cron parser (e.g. `cron-parser`) — add to `package.json` deps.

### 5d. cf-typegen

```bash
pnpm run cf-typegen
```
Regenerates `worker-configuration.d.ts` so `env.CHECKLIST_RATIONALE_WORKFLOW` is typed.

---

## Phase 6 — Workflow rules & agent config

1. **Create `.agent/workflows/implement-feature.md`** with the blueprint's deployment iteration list.
2. **Update `.agent/rules/`** — merge in the three rules (cents-integer enforcement, three-state HITL `ai_suggested | user_confirmed | user_disassociated`, Monolith borderless contrast) into the existing rules files (do not create orphan files).

---

## Verification (end-to-end local)

```bash
# Backend wiring
pnpm run db:generate                # expect drizzle/0016_<words>.sql
pnpm run migrate:local
pnpm run cf-typegen
pnpm run build                      # JSX className errors fail hard here
pnpm run preview                    # wrangler dev

# Smoke
curl -s 'http://localhost:8787/api/construction-checklist/sections/mep' | jq '.success, (.questions|length)'
curl -s -H "Cookie: $ADMIN_COOKIE" 'http://localhost:8787/api/admin/workflows/schedules' | jq '.'
curl -s -H "Cookie: $ADMIN_COOKIE" -X POST 'http://localhost:8787/api/admin/workflows/checklist_rationale/run' | jq '.'
curl -s 'http://localhost:8787/api/portal/rooms/1/quotes' | jq '.success, (.quotes|length)'

# Browser
# /questionnaire                                            -> section picker
# /questionnaire/mep                                        -> ConstructionChecklistApp; switch+save triggers budget_tracker_items auto-insert
# /questionnaire/print                                      -> clean letter layout, no sidebar
# /docs/homeowners/questionnaire-and-ai-guidance            -> sidebar highlights, "Live" badge
# /admin                                                    -> Workflows tab shows schedule editor, "Run Now" button, live WS feed
# /budget-tracker                                           -> committed answer appears with changeSource="questionnaire"

# Belt-and-suspenders
grep -rn ' class="' src/frontend/components/ --include="*.tsx"   # expected: zero matches
```

**Live WS test**: open `/admin` in browser, hit "Run Now", confirm the live progress pane streams `started → load-candidates → ai-infer → upsert-mappings → finished` events.

---

## Critical files

**Created:**
- `src/backend/db/schema/home/questionnaire.ts`
- `src/backend/db/schema/admin/workflow_schedules.ts`
- `src/backend/api/routes/construction-checklist.ts`
- `src/backend/api/routes/admin-workflows.ts`
- `src/backend/services/checklist-rationale-workflow.ts`
- `src/backend/services/workflow-dispatcher.ts`
- `src/frontend/components/ConstructionChecklistApp.tsx`
- `src/frontend/components/InteractiveFloorPlan.tsx`
- `src/frontend/components/ChecklistPrintView.tsx`
- `src/frontend/components/AdminWorkflowsPanel.tsx`
- `src/frontend/pages/questionnaire/index.astro`
- `src/frontend/pages/questionnaire/[section_slug].astro`
- `src/frontend/pages/questionnaire/print.astro`
- `.agent/workflows/implement-feature.md`
- `drizzle/0016_<two_words>.sql` (auto-generated)

**Modified:**
- `src/backend/db/schema/index.ts` (two new exports)
- `src/backend/api/index.ts` (mount two new routers)
- `src/backend/api/routes/portal.ts` (add `GET /rooms/:roomId/quotes`)
- `src/_worker.ts` (re-export new Workflow class, gate `scheduled()` by `event.cron`, dispatcher call)
- `wrangler.jsonc` (add workflow binding; append `"* * * * *"` to `triggers.crons`)
- `src/frontend/lib/config.ts` (one new navItem)
- `src/frontend/lib/docs.ts` (flip questionnaire status; soften ~6 prose strings)
- `src/frontend/components/AdminDashboardApp.tsx` (wrap in shadcn Tabs; mount new Workflows tab)
- `package.json` (add `cron-parser` for the dispatcher's nextRunAt math)
- `.agent/rules/*` (merge in three new rules)

**Rejected:**
- Blueprint File 6 (AppSidebar rewrite) — destroys richer existing implementation.

---

## PR strategy

Two commits, one PR against `codex/frontend-docs-suite` (or rename branch if you'd rather target `main` directly):

1. `Merge branch 'main' into codex/frontend-docs-suite` — Phase 1 only.
2. `feat: AI-augmented questionnaire, floor plan, contractor portal + admin workflow control` — Phases 2–6.

---

## Risk register

| Surface | Risk | Mitigation |
|---|---|---|
| Existing 367-line AppSidebar | Blueprint rewrite would silently delete docs tree, anchor highlight, uploads badge, mobile dialog | **Reject File 6**; nav added via `config.ts` |
| In-flight `drizzle/0015_*` (untracked) | Collides with regenerated 0016 | Commit (or stash) existing 0015 first |
| In-flight `wrangler.jsonc` (modified) | Cron-triggers + workflow binding additions could conflict with image-workflow edits | Stash for Phase 1 merge, hand-merge the workflow + triggers blocks in Phase 5 |
| Print view sidebar bleed | If `print.astro` uses `BaseLayout`, sidebar prints | Minimal layout + `@media print { aside { display:none } }` |
| HITL retention drift | Rationale workflow could overwrite `user_disassociated`/`user_confirmed` mappings | The `upsert-mappings-respecting-hitl` step MUST `WHERE associationStatus IN ('ai_suggested', NULL)` only |
| `scheduled()` unauthenticated | Workflow service must not call request-scoped auth helpers | Pass `env` directly; dispatcher reads D1 + invokes `env.X.create()` only |
| Master-tick `* * * * *` cron load | Every minute the dispatcher hits D1 even when no jobs are due | Cheap single indexed scan; gate further by `WHERE enabled = true AND nextRunAt <= now` — empty in steady state |
| Existing `0 14 * * *` permit sync regression | Adding the master tick must not silently break permit sync | Gate by `event.cron` string in the `scheduled()` handler so each cron fires the correct path |
| Admin auth | New `/api/admin/workflows/*` endpoints are admin-only | Auto-inherits `requireAccessAuth` from existing `/api/admin/*` middleware in `src/backend/api/index.ts:59` |
| docs.ts prose drift | Status="live" with neighboring "still being developed" prose creates inconsistency | Edit ~6 string literals in same PR |
| `cron-parser` bundle bloat in Worker | New dep adds bytes to the worker bundle | Use a tiny implementation (`cron-parser` is ~30 KB; acceptable). Alternative: write a 60-line minimal cron next-tick computer. |