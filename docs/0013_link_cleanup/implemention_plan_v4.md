# Plan: Site/URL cleanup roadmap + live progress tracker (docs/0013_link_cleanup)

## Context

The two-viewport request expanded into a full information-architecture redesign plus ~10 new subsystems (documents, design/moodboards, companies CRM, brands/products e-commerce, bids/budget, showroom cleanup, floor/room routing). The user's spec is a long braindump with many embedded open questions (`[BROKEN?]`, `[HOLD]`, "is this different from…?") and several "moves" that actually require data-model changes.

**Decision:** don't build features this session. Instead, **capture the vision as a durable planning package and stand up a live progress tracker**, so future sessions execute against it and `/admin/plans` reflects status in real time. Confirmed with the user: public URLs stay at root; reuse the existing `remodel_access` cookie auth as-is; roadmap lives in `docs/0013_link_cleanup/` (the user's existing staging folder) and is exposed at `/admin/plans` backed by a seeded D1 table.

> **Why you don't see the docs yet:** I'm in **plan mode**, which is read-only — I can only edit this plan file. `docs/0009_site_url_cleanup/` and all files below are **created the moment you approve** (ExitPlanMode). Nothing is lost; it just can't be written until then. Working dir: the `serene-pike-c99f96` worktree, branch `claude/serene-pike-c99f96`.

**This session's scope (infra + roadmap authoring ONLY — no feature builds):**

1. Author the planning package under `docs/0009_site_url_cleanup/`.
2. Create a D1 `plans` + `plan_tasks` schema (Drizzle) + migration.
3. Seed it from the canonical task list.
4. Build `/admin/plans` (overview) + `/admin/plans/[slug]` (board) progress monitor.
5. Wire the `/api/admin/plans/*` endpoints (list, get, patch status, seed).
6. Add "Plans" to the admin sidebar.

---

## Part 1 — Planning package: `docs/0009_site_url_cleanup/`

This is the user's existing staging folder. It currently exists only in the **main checkout** (uncommitted), holding `DRAFT_SITEMAP_NOTES.md` (the braindump source) plus my earlier `IMPLEMENTATION_PLAN.md`/`_v2`/`_v3` drafts — this worktree's branch can't see them. This session: **copy `DRAFT_SITEMAP_NOTES.md` into the worktree** package so the braindump gets version-controlled, then author the **canonical files** below alongside it. The main checkout's uncommitted `IMPLEMENTATION_PLAN*.md` drafts are superseded by this package — the user can discard them (I won't touch another checkout's working tree). Files (mirrors the repo's `docs/00NN_*` convention + cloudflare-jedi planning package):

- **`ROADMAP.md`** — the organized vision: workstreams → phases (Part 2), sequencing, dependencies, and a status legend.
- **`SITEMAP.md`** — the **target-state sitemap** (Part 3): every route resolved to `keep | move | new | delete | investigate`, grouped public vs admin by namespace, with the user's per-route notes preserved. Pairs with the dynamic `/sitemap`.
- **`TASKS.json`** — structured tasks (the seed source of truth; schema in Part 4). One entry per actionable item from the braindump.
- **`IMPLEMENTATION_PLAN.md`** — how the roadmap executes turn-over-turn + how the tracker works.
- **`PROMPT.md`** — briefing for future coding-agent sessions (references the AGENTS rules, the tracker API, "pick next unblocked task → build → PATCH status").
- **`OPEN_QUESTIONS.md`** — every embedded question from the braindump, numbered, for the user to resolve before the relevant phase (Part "Open questions" below).
- **`RECOVERY.md`** — the lost-functionality archaeology log (Workstream W0): each lost feature, where it was found (stash `blank-canvas-and-features-wip`, which branch/worktree, or the deployed bundle), and the restore approach. Seeded as recovery tasks in `TASKS.json`.

---

## Part 2 — Proposed workstreams & phases (review this — it's my organization of your vision)

Sequenced by dependency. Each becomes a `workstream` + `phase` on the tasks.

- **Phase 0 — Tracker + roadmap infra** _(this session)_: docs package, D1 tasks, `/admin/plans`, API, seed.
- **Workstream W0 — Rescue uncommitted work (HIGH PRIORITY, dedicated follow-up)**: the lost features + a large amount of other work are sitting **uncommitted** in the `room-floorplan-overview-and-room-viewport-changes` checkout (45 commits behind main, ~80 dirty files) — never committed to any branch, not in prod. **Source found — not archaeology, it's right there:**
  - **Blank-canvas recovery:** `BlankCanvasAdminApp.tsx` (modified) + `services/render/blank-canvas-generator.ts` + `services/image-processor/inline-editor.ts` + `components/ui/InlineMaskEditor.tsx` + `pages/admin/blank-canvas/` (the missing sub-routes: upload/generate/exclusions/floor/room).
  - **Unmerged features:** ClickUp (`routes/clickup.ts`, `services/clickup-client.ts`, `components/clickup/`, `schema/scrum/`, `pages/admin/tasks.astro`), Admin Chat (`AdminChatAgent/`, `RemodelOrchestrator/`, `AdminChatPanel.tsx`), saved image searches (`schema/images/saved_image_searches.ts`).
  - **4 uncommitted migrations** `drizzle/0055–0058` — my branch is already at `0065`, so they're likely renumbered/superseded on main → **migration reconciliation required** (do not blind-apply).
  - **CAVEAT — delicate 3-way merge:** several of those dirty files (`_worker.ts`, `AppSidebar.tsx`, `showroom-stores.ts`, `api/index.ts`, `ShowroomsDirectoryApp.tsx`) are the exact files I rewrote + deployed on serene-pike. Rescue = per-file 3-way merge onto the current base, not a cherry-pick. This is its own focused effort — captured here with the full inventory so nothing is lost, executed as the first tracked follow-up (not bundled into this tracker-build session).
- **Phase 1 — Foundational IA & viewport split**: two sidebars (public `PublicSidebar` / admin `AdminSidebar`) chosen by path in `BaseLayout`; "Enter Admin Portal" button (→ `/admin`, existing auth); admin namespace reorg (`/admin/budget/*`, `/admin/design/*`, `/admin/prepare/*`, `/admin/bids/*`, `/admin/planning/*`, `/admin/config/*`, `/admin/pmo/*`); mechanical public moves (`/photos/*`, `/log/*`, `/specs/measurements`); redirects (in `_worker.ts`, per the [[astro-cf-redirects-splat-bug]]); fix the stale contractor guide in `portal.ts`; delete dead pages (`/gallery`, `/supporting-docs`, `/photo-edits`, old docs routes). _Excludes data-model-dependent moves._
- **Phase 2 — Documents system** _(unblocks 3/4/5 via the reusable uploader)_: extend the existing `documents` schema for visibility (private-by-default) + associations + saved views (static/dynamic); reusable upload pipeline (dropzone → metadata/type/tags/associations → OCR/VisionAI text → R2 → D1 keys → Vectorize embeddings); public `/docs` (public-marked, saved views, URL-persisted search, viewer via `/pdf-viewer` / image iframe / CAD-download) + `/admin/docs` (all docs, permissions, view builder with amber exposure warnings, edit).
- **Phase 3 — Companies CRM**: `/admin/companies/[id]/{contacts,notes,todos,documents,permits,emails}` — notes/todos in PlateJS; documents reuse Phase 2; emails = Gmail-inbox integration (flagged big/OAuth).
- **Phase 4 — Design**: `/admin/design/moodboards/*` (Gemini reference-image flow, revisions, floor/room scoping), `/admin/design/workshop` (nano-banana-spatial-design repo), `/admin/design/decision-room` (room→materials→product/description), blank-canvas rebuild (`upload`/`generate`/`exclusions`/floor/room), `builder`→`/admin/prepare/blank-canvas/angles` (camera-on-floorplan), public `/planning/design-master-plan`.
- **Phase 5 — Brands / Products / Showroom sourcing**: consolidate `/admin/shopping/*`; e-commerce-style brand + product pages; brand↔product↔showroom associations; per-entity research + shopping-journal; showroom sub-pages (`/admin/shopping/showrooms/[id]/{products,brands,research,shopping-journal}`); fix "broken" showroom routes; RAG journal viewer at `/admin/shopping/journal`.
- **Phase 6 — Bids & Budget**: per-contractor PIN bids (`/bid`, `/bid/[token]`), `/admin/bids` (from bid-portfolios), condense estimates into bids; `/admin/budget/{tracker,dashboard,truth-table,reconciliation}`.
- **Phase 7 — Floor plan / rooms restructure**: `/floor-plan/floors/[id]/rooms/[id]` (the `home/floors` + `home/rooms` D1 tables already exist), `kitchen-layout` → layouts.

Dependency notes: P1 first (structure); **P2 before P3/P4/P5** (shared uploader); P7 underlies rooms/design deep-links.

---

## Part 3 — Target sitemap namespaces (full detail in `SITEMAP.md`)

**Public (root):** `/` · `/photos/{listing,inspiration}` · `/floor-plan` (+ `/floors/[id]/rooms/[id]`) · `/log/{daily,weekly}` · `/specs/measurements` · `/docs` (+ `/docs/[id]`, `/docs/view/[id]`) · `/planning/design-master-plan` · `/bid` (+ `/bid/[token]`) · `/access`.
**Admin (`/admin/*`):** `/admin` · `/admin/budget/*` · `/admin/bids/*` · `/admin/prepare/*` (uploads, review, blank-canvas/_) · `/admin/design/_`(moodboards/*, workshop, decision-room, layouts/[id]) ·`/admin/planning/_`(measure, questionnaire, research) ·`/admin/pmo/_`(operations, schedule/contractor) ·`/admin/docs/_`·`/admin/companies/[id]/_`·`/admin/shopping/_` (showrooms/[id]/_, brands/[id]/_, products/[id]/_, journal, stores/[id]) · `/admin/{config,integrations,dialer,permits}/*`.

`SITEMAP.md` lists every current route with its target + change-type + the user's note verbatim.

---

## Part 4 — D1 schema (`src/backend/db/schema/plans/`)

Two tables (Drizzle, per the domain-folder convention; add to `schema/index.ts` barrel; `pnpm run db:generate`):

- **`plans`**: `slug` (pk text), `title`, `description`, `docPath`, `status` (`planning|active|done`), `createdAt`, `updatedAt`.
- **`plan_tasks`**: `id` (pk autoinc), `planSlug` (FK), `taskKey` (text, e.g. `P1-NAV-01`), `workstream` (text), `phase` (int 0–7), `title`, `description`, `targetRoute` (text, nullable), `changeType` (enum `new|move|update|delete|keep|investigate`), `status` (enum `pending|in_progress|blocked|deferred|done`, default `pending`), `dependsOn` (json text — taskKeys), `sortOrder` (int), `notes` (text), `createdAt`, `updatedAt`. Unique index on `(planSlug, taskKey)` for idempotent seeding.

No `drizzle-zod` in schema files (breaks the build — [[drizzle-zod-breaks-build]]); hand-write route Zod.

---

## Part 5 — API: `src/backend/api/routes/admin-plans.ts` (mount `/api/admin/plans`, `requireAccessAuth`)

- `GET /api/admin/plans` → all plans + per-plan progress counts.
- `GET /api/admin/plans/:slug` → plan + tasks grouped by phase/workstream, with progress rollups.
- `PATCH /api/admin/plans/tasks/:id` → `{ status?, notes? }` (used by future sessions to mark progress).
- `POST /api/admin/plans/:slug/seed` → idempotent upsert from the canonical task list (`onConflictDoNothing` on `(planSlug, taskKey)`), mirroring `showroom-seed.ts`.

Seed source: `src/backend/db/seeds/seed-plan-tasks.ts` holds the canonical typed task array (single source of truth); `TASKS.json` is the doc mirror written to match. (Avoids cross-dir JSON import fragility in the Worker bundle.)

---

## Part 6 — Frontend: `/admin/plans`

- `src/frontend/pages/admin/plans/index.astro` → `PlansOverviewApp` (list plans, overall % complete, link into each).
- `src/frontend/pages/admin/plans/[slug].astro` → `PlanBoardApp`: phases as collapsible sections; each task a row with `changeType` + `status` badges, target route, deps; per-phase/workstream progress bars; filter by workstream/status; **polls the API (~10s) for near-real-time updates**. Monolith styling (`bg-card`, `ring-1 ring-border/40`, no 1px borders; recharts only if a chart is added).
- Add **Plans** to `AppSidebar.tsx` (System group, `/admin/plans`).

---

## Open questions (captured in `OPEN_QUESTIONS.md`; resolve before the owning phase)

Representative (not exhaustive): questionnaire → admin then possibly delete? · `/budget-reconciliation` vs the "Seed Homeowner Plan" button — same thing? · condense `/admin/estimates` into `/admin/bids` — confirm removal · Gmail inbox integration scope + OAuth · `store/[id]` vs `showrooms/[id]` and `product/[id]` duplication · the many `[BROKEN?]` showroom routes' intended behavior · `kitchen-layout` marked CONTRACTOR but targeted to an `/admin/...` path (mismatch) · design-master-plan public vs admin · which pages are truly deleted vs archived.

---

## Resolved decisions + additions (from the user's OPEN_QUESTIONS answers — bake into the docs)

**Conventions:** plural collection routes (`showrooms`, `stores`, `brands`, `products`); `/admin/designs/*`; `/admin/pmo/{operations,schedule/contractor}` (Program Mgmt Office); all taxonomy/enums under `/admin/config/*`. **Deletions:** hard-delete the marked routes **but keep a running tally** (in `SITEMAP.md` → "Deleted routes" table) **and preserve the underlying data/features** ("desk stuff") for replanting.

**Per-area (feeds SITEMAP.md + TASKS.json):** questionnaire → move+keep under `/admin/planning/questionnaire`; `kitchen-layout` → admin `/admin/designs/layouts/[id]`; `/planning/design-master-plan` → public read-only render of admin `decision-room` config **+ contractor comments**; moodboards admin-only (surfaced to contractors only via design-master-plan); doc view-visibility precedence = as specced (view overrides doc; amber warnings on dynamic-without-`visibility:public` and static-with-private); non-iframe-previewable files → download-only; bid PIN = contractor phone number; **estimates list deleted**, manual-estimate intake survives as `/admin/bids/new`; `/budget-reconciliation` = the existing CSV/Sheets reconcile (`BudgetReconciliationApp.tsx` + `/api/budget-tracker/csv-ingestion`) — same concept as "Seed Homeowner Plan"; **keep ALL showroom sub-pages** (`sourcing/progress/scan/intake/schedule/compare/gaps/research`) and reintegrate them into the flow; floor/room routing `[id]` = floors/rooms **auto-PK** reached via the floorplan visual (+ a `closets` "all closets on this floor" view); task management is **ClickUp-backed** (`services/clickup-client.ts`) **mirrored into our own D1 + PMO** (ClickUp = fallback).

**OCR/parse stack (Phase 2 uploader):** `@llamaindex/liteparse` + Workers AI vision `@cf/meta/llama-3.2-11b-vision-instruct` (user supplied the exact call); embeddings → existing Vectorize.

**Showroom hero hours (Phase 5, small + high-value):** keep hours on the showroom hero, make it professional (beste.co `BusinessHero`/`ShowroomContact` blocks the user provided), apply the tightened card to the **List + Directory** cards, and make the hero hours card **clickable → modal** with full M–Sun schedule + phone/email/address/socials (modal only inside the showroom viewport).

**Two new spec docs (saved verbatim into the package so the handoffs survive):**

- `docs/0013_link_cleanup/specs/GMAIL_COMMS.md` — Gmail service-account DWD comms hub (poll `justin@126colby.com`; per-contractor email-domain search; `gmail_threads`/`gmail_messages` D1 tables per the user's schema; body embeddings→Vectorize with `{rag_uuid, message_id, thread_id}` metadata; reply-all send via Gmail API; Workers-AI draft assist; Agent-SDK reader querying Vectorize by thread + parties; secret bindings `GOOGLE_CREDS_SA_*`; inbox UI via `shadcn sidebar-09`). Workstream under Phase 3.
- `docs/0013_link_cleanup/specs/SHOWROOM_ENRICHMENT.md` — sitemap-driven crawl→AI-triage→full-page screenshot→CF-Images→extract contact/hours/socials/brands+favicon→D1 (`showroom_store_brands` table, `page-screenshot` image kind, `enrichStore` agent method + `/enrich` route). Workstream under Phase 5.

These become `investigate`→`resolved` notes on the tasks; `OPEN_QUESTIONS.md` ships with the answers inlined.

## Critical files

- `docs/0009_site_url_cleanup/{ROADMAP,SITEMAP,IMPLEMENTATION_PLAN,PROMPT,OPEN_QUESTIONS}.md` + `TASKS.json` (new).
- `src/backend/db/schema/plans/{plans,plan_tasks,index}.ts` (new) + `schema/index.ts` (barrel export) + generated migration in `drizzle/`.
- `src/backend/db/seeds/seed-plan-tasks.ts` (new, canonical tasks).
- `src/backend/api/routes/admin-plans.ts` (new) + mount + `requireAccessAuth` in `src/backend/api/index.ts`.
- `src/frontend/pages/admin/plans/{index,[slug]}.astro` + `src/frontend/components/plans/{PlansOverviewApp,PlanBoardApp}.tsx` (new).
- `src/frontend/components/AppSidebar.tsx` (add Plans link).

## Verification

1. `pnpm run db:generate` produces one new migration; `tsc --noEmit` clean on new files; `astro build` (server+client) succeeds.
2. After `pnpm run migrate:remote` + `POST /api/admin/plans/0009_site_url_cleanup/seed`: `GET /api/admin/plans/0009_site_url_cleanup` returns the seeded tasks grouped by phase.
3. `/admin/plans` lists the plan with overall %, `/admin/plans/0009_site_url_cleanup` renders the board; a `PATCH` to a task's status is reflected on the page within the poll interval.
4. "Plans" appears in the admin sidebar; the page is `/admin`-gated (redirects to `/access` when logged out).
5. Dogfood: mark the Phase-0 tasks `done` and confirm the progress bar advances.

## Notes

- Feature builds (Phases 1–7) are **out of scope this session** — this establishes the plan + tracker only. Deploy via `pnpm run deploy` (this one DOES add a migration, so `migrate:remote` runs).
- `SITEMAP.md` becomes the target companion to the live dynamic `/sitemap`.
