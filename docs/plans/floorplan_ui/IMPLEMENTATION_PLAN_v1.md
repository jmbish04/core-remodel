# Plan: Sync `docs/` from `origin/main` + Implement Master Blueprint (Questionnaire / Floor Plan / Contractor Portal)

## Context

You asked me to **first pull updated `docs/` files from `origin/main`** (where you've made changes via GitHub that aren't synced here yet), and **then implement the "Master Blueprint" for the AI-augmented questionnaire, interactive floor plan, and contractor deal portal**.

### Current state vs main

- Local branch `codex/frontend-docs-suite` is **23 commits behind `origin/main`**.
- Main brings in **8 new docs files** (reorganized into `docs/context/builder_checklists/` and `docs/research/features/`) plus 2 Apps Script JSON files and a PR merge commit.
- Two local untracked files at OLD paths (`docs/context/prompt_checklist_ux_discovery.md` and `docs/context/stitch_builder_Questionaire.md`) are stale copies of files that were RENAMED on main — the in-main canonical versions supersede them.

### Blueprint reality check (from codebase exploration)

The blueprint as written has several mismatches that must be fixed on the way in:

1. **File 6 (AppSidebar rewrite) MUST be rejected** — the existing [src/frontend/components/AppSidebar.tsx](src/frontend/components/AppSidebar.tsx) is a 367-line component that already implements a richer collapsible docs tree (driven by `docsAudienceGroups` in [src/frontend/lib/docs.ts](src/frontend/lib/docs.ts)) with hash-anchor active state, mobile dialog, and uploads-pending badge. The blueprint's 80-line rewrite would silently destroy all of that. The "Homeowner Manual / Contractor Guide" requirement is already satisfied by the existing audience groups.
2. **JSX bugs**: blueprint File 3 has 3 `class=` attributes (should be `className=`) and File 6 has 4 (moot since we reject File 6). These would fail TypeScript / silently lose styling.
3. **Missing portal endpoint**: `ConstructionChecklistApp.tsx` fetches `/api/portal/rooms/:roomId/quotes` which does NOT exist. Must be added to [src/backend/api/routes/portal.ts](src/backend/api/routes/portal.ts).
4. **Missing Astro pages**: `/questionnaire/[section_slug]` and `/questionnaire/print` routes don't exist.
5. **Convention divergence**: blueprint uses inline `safeParse`; codebase convention is `zValidator("json", schema)` middleware (every existing router uses it).
6. **No cron infrastructure**: the AI rationale loop (Journey D) requires either Cloudflare Cron Triggers + `scheduled()` handler or a Durable Object alarm. Neither exists today.
7. **Fetch convention**: blueprint omits `credentials: "include"`; every existing component includes it.
8. **In-flight working tree**: untracked migration `drizzle/0015_clean_infant_terrible.sql` + modified `drizzle/meta/_journal.json` must be settled before running `pnpm db:generate`, or the next migration will collide with `0015`.

---

## Phase 1 — Sync docs from `origin/main` (the explicit "pull" ask)

1. **Stash in-flight working-tree changes** so the merge is clean:
   - Files affected: `drizzle/meta/_journal.json`, `src/backend/api/routes/images.ts`, `src/backend/db/schema/images/image_upload_staging.ts`, `src/backend/services/image-processor.ts`, `worker-configuration.d.ts`, `wrangler.jsonc`.
   - Also save (then drop) the two stale untracked docs files: `docs/context/prompt_checklist_ux_discovery.md`, `docs/context/stitch_builder_Questionaire.md` — both are superseded by renamed versions on main (the `stitch_builder` one is byte-identical to the canonical; the other is an older draft).
2. **`git merge origin/main --no-edit`** — confirmed no source-code conflicts (all 23 incoming commits touch only `docs/`, `appsscript/`, or are the PR-merge commit).
3. **Discard the saved stale copies**, **pop the stash**.
4. Verify `git diff --name-status HEAD...origin/main` returns empty.

---

## Phase 2 — Schema & migration

1. **Add `src/backend/db/schema/home/questionnaire.ts`** verbatim from Blueprint File 1. Sibling imports (`./rooms`, `./remodel_scenarios`) are valid in `home/`. All money columns are `integer` cents ✓. Matches existing `budget_tracker_items` field shapes ✓.
2. **Append one line to [src/backend/db/schema/index.ts](src/backend/db/schema/index.ts)** at the end of the `./home/*` block: `export * from "./home/questionnaire";`.
3. **Commit the existing untracked `drizzle/0015_clean_infant_terrible.sql`** first (so it has a parent in the journal), then run `pnpm run db:generate` — expect a new `drizzle/0016_<two_words>.sql`.
4. **Apply locally** with `pnpm run migrate:local`.

---

## Phase 3 — Hono API

1. **Create `src/backend/api/routes/construction-checklist.ts`** based on Blueprint File 2, with these conformance fixes:
   - Replace inline `safeParse` with `zValidator("json", schema)` middleware (matches [src/backend/api/routes/auth.ts](src/backend/api/routes/auth.ts), [budget-tracker.ts](src/backend/api/routes/budget-tracker.ts), [photo-edits.ts](src/backend/api/routes/photo-edits.ts), etc.).
   - Auto-insert into `budget_tracker_items` must set ALL required fields: `trackId: \`questionnaire:${answerId}\``, `revisionNumber: 1`, `isActive: true`, `isDraft: false`, `itemType: "project"`, `executionClass`, `status: "open"`, `riskLevel: "medium"`, `changeSource: "questionnaire"`, `changedBy: "system_edge_worker"`, `title`, `estimatedLowCents`, `estimatedHighCents`, `scenarioId`.
   - Error responses use `{ success: false, error }`.
2. **Mount in [src/backend/api/index.ts](src/backend/api/index.ts)**: import the router, then `app.route("/api/construction-checklist", constructionChecklistRouter);` near the existing route mounts.
3. **Add the missing `GET /rooms/:roomId/quotes` endpoint to existing [src/backend/api/routes/portal.ts](src/backend/api/routes/portal.ts)** (do not fragment the portal namespace into a second router):
   ```ts
   portalRouter.get("/rooms/:roomId/quotes", async (c) => { /* select roomMaterialQuotes by roomId, order by datetimeCreated desc */ });
   ```

---

## Phase 4 — Frontend

### 4a. Components (3 of 4 from blueprint)

- **`src/frontend/components/ConstructionChecklistApp.tsx`** — paste Blueprint File 3, then:
  - Fix the 3 `class=` → `className=` typos.
  - Add `credentials: "include"` to both `fetch()` calls (matches [HomeMissionControlApp.tsx](src/frontend/components/HomeMissionControlApp.tsx), [BudgetTrackerApp.tsx](src/frontend/components/BudgetTrackerApp.tsx) convention).
- **`src/frontend/components/InteractiveFloorPlan.tsx`** — paste Blueprint File 4 as-is; verify no `class=` slipped in; verify `Badge` (already installed) is the only shadcn primitive needed.
- **`src/frontend/components/ChecklistPrintView.tsx`** — paste Blueprint File 5 as-is; verify no `class=` slipped in.
- **REJECT Blueprint File 6 (AppSidebar rewrite).** Keep existing sidebar untouched.

### 4b. Astro pages (new)

Create three new pages following the [src/frontend/pages/budget-tracker.astro](src/frontend/pages/budget-tracker.astro) island-mount pattern:

- `src/frontend/pages/questionnaire/index.astro` — section picker (lists `checklist_sections` rows; links to each `/questionnaire/[section_slug]`).
- `src/frontend/pages/questionnaire/[section_slug].astro` — mounts `<ConstructionChecklistApp client:load sectionSlug={Astro.params.section_slug} />` inside `BaseLayout`.
- `src/frontend/pages/questionnaire/print.astro` — mounts `<ChecklistPrintView client:load />` using a minimal layout (no sidebar, no header) so prints come out clean on letter paper.

### 4c. Sidebar & docs integration (NO new sidebar code)

- **Add `{ href: "/questionnaire", label: "Questionnaire" }` to `siteConfig.navItems`** in [src/frontend/lib/config.ts](src/frontend/lib/config.ts) (around line 28, after `budget-tracker`). The existing sidebar auto-renders it.
- **Flip [src/frontend/lib/docs.ts](src/frontend/lib/docs.ts) line ~305** — the `["homeowners", "questionnaire-and-ai-guidance"]` page — from `status: "planned"` to `status: "live"`. Soften related "planned/intended/still being developed" prose strings (lines ~308, ~336–338, ~766) to present-tense shipping language.

---

## Phase 5 — AI rationale cron loop (Journey D)

**Approach:** Cloudflare Cron Triggers + `scheduled()` handler. Cheapest, native, easy to disable.

1. Add `scheduled` export to [src/_worker.ts](src/_worker.ts) alongside the existing `fetch`. Implementation calls a new helper `runChecklistRationaleLoop(env)`.
2. Create `src/backend/services/checklist-rationale.ts` — pulls newly committed `checklist_answers` since last `checklist_service_logs` run, calls `env.AI` to derive room mappings + rationale, upserts into `checklist_room_mappings` with `associationStatus: "ai_suggested"` (respecting the strict retention matrix: never overwrite `user_disassociated` or `user_confirmed`), writes a log row to `checklist_service_logs`.
3. Add `"triggers": { "crons": ["*/15 * * * *"] }` to `wrangler.jsonc` (commented out for v1 if you'd rather ship the handler without turning on cadence; uncomment to activate).

---

## Phase 6 — Workflow rules & agent config

1. **Create `.agent/workflows/implement-feature.md`** with the Blueprint's deployment iteration list.
2. **Update `.agent/rules/`** — merge in the three rules (cents-integer enforcement, three-state HITL flags `ai_suggested | user_confirmed | user_disassociated`, Monolith borderless contrast) into the existing rules files rather than creating an orphan.

---

## Verification (end-to-end local test)

```bash
pnpm run db:generate                 # expect drizzle/0016_<two_words>.sql
pnpm run migrate:local               # apply to .wrangler/state D1
pnpm run cf-typegen                  # refresh worker-configuration.d.ts
pnpm run build                       # catches className= JSX errors hard
pnpm run preview                     # boot wrangler dev

# Smoke tests
curl -s 'http://localhost:8787/api/construction-checklist/sections/mep' | jq '.success, (.questions|length)'
curl -s 'http://localhost:8787/api/portal/rooms/1/quotes' | jq '.success, (.quotes|length)'

# Browser checks
# /questionnaire                                                  -> section picker
# /questionnaire/mep                                              -> ConstructionChecklistApp loads, switch+save works
# /questionnaire/print                                            -> clean letter-paper layout, no sidebar in print
# /docs/homeowners/questionnaire-and-ai-guidance                  -> sidebar highlights, page badge shows "Live"
# /budget-tracker                                                 -> after committing one answer, confirm auto-inserted row with changeSource="questionnaire"

# Belt-and-suspenders
grep -rn ' class="' src/frontend/components/ --include="*.tsx"   # expected: zero matches
```

---

## Critical files to be created or modified

**Created:**
- `src/backend/db/schema/home/questionnaire.ts`
- `src/backend/api/routes/construction-checklist.ts`
- `src/frontend/components/ConstructionChecklistApp.tsx`
- `src/frontend/components/InteractiveFloorPlan.tsx`
- `src/frontend/components/ChecklistPrintView.tsx`
- `src/frontend/pages/questionnaire/index.astro`
- `src/frontend/pages/questionnaire/[section_slug].astro`
- `src/frontend/pages/questionnaire/print.astro`
- `src/backend/services/checklist-rationale.ts`
- `.agent/workflows/implement-feature.md`
- `drizzle/0016_<two_words>.sql` (auto-generated by drizzle-kit)

**Modified:**
- `src/backend/db/schema/index.ts` (one new export line)
- `src/backend/api/index.ts` (mount new router)
- `src/backend/api/routes/portal.ts` (add `GET /rooms/:roomId/quotes`)
- `src/frontend/lib/config.ts` (one new navItem)
- `src/frontend/lib/docs.ts` (flip questionnaire status to live; soften prose)
- `src/_worker.ts` (add `scheduled()` handler)
- `wrangler.jsonc` (add `triggers.crons` block)
- Existing `.agent/rules/*` (merge in three new rules)

**REJECTED:**
- Blueprint File 6 — would destroy existing 367-line AppSidebar with rich docs tree.

---

## Risk register

| Surface | Risk | Mitigation |
|---|---|---|
| Existing AppSidebar | Blueprint rewrite would silently delete docs tree, anchor highlight, uploads badge, mobile dialog | Reject File 6 outright; integrate via `config.ts` navItem instead |
| In-flight `drizzle/0015_*` | Untracked migration would collide with regenerated 0016 | Commit existing 0015 first, then run `db:generate` |
| In-flight `wrangler.jsonc` changes | Cron-triggers edit could conflict with image-workflow edits | Stash before merge; reintroduce `triggers` block AFTER images settle |
| Print view sidebar bleed | If `/questionnaire/print` uses `BaseLayout`, sidebar appears on printed page | Minimal layout for `print.astro`; `@media print { aside { display:none } }` belt-and-suspenders |
| HITL retention drift | Rationale loop overwrites `user_disassociated` rows | Loop MUST filter out `associationStatus IN ('user_disassociated','user_confirmed')` before upserting |
| `scheduled()` auth | Cron runs unauthenticated; service must not call request-scoped auth helpers | Pass `env` directly; don't import request-scoped middleware |
| docs.ts prose drift | Flipping status to "live" without softening neighboring prose creates inconsistent UI | Edit ~6 string literals in same PR |
