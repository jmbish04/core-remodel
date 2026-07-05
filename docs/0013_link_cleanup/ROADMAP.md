# Roadmap — Site/URL cleanup + two-viewport IA (0013)

> Live status: **`/admin/plans/0013_link_cleanup`** (D1-backed; updates as tasks are marked done). This doc is the human narrative; `TASKS.json` is the machine source (mirrors `src/backend/db/seeds/seed-plan-tasks.ts`).

## What this is

A full information-architecture redesign of core-remodel: split the app into a **public/contractor viewport** (root URLs) and an **admin viewport** (`/admin/*`), normalize the admin namespace, and layer ~10 new subsystems. Public URLs stay at root; admin auth reuses the existing `remodel_access` cookie (`/access`).

## Status legend

`pending` → not started · `in_progress` → active · `blocked` → waiting on a dep/answer · `deferred` → intentionally later · `done` → shipped.
Change types: `new` `move` `update` `delete` `keep` `investigate` `recover`.

## Phases (sequenced by dependency)

- **Phase 0 — Tracker + roadmap infra** *(this session)* — the `docs/0013` package + D1 `plan_tasks` + `/admin/plans` + API. Done when the board renders.
- **W0 — Rescue uncommitted work** *(high-priority follow-up)* — the lost blank-canvas suite + ClickUp/AdminChat/saved-searches are sitting **uncommitted** in the `room-floorplan` checkout. See `RECOVERY.md`. A delicate per-file 3-way merge with the deployed serene-pike changes; do first so nothing is re-lost.
- **Phase 1 — Foundational IA & viewport split** — two sidebars, "Enter Admin" button, admin namespace reorg (`/admin/{budget,designs,prepare,bids,planning,config,pmo}/*`), public moves (`/photos`, `/log`, `/specs`), redirects (`_worker.ts`), fix stale contractor guide, hard-delete dead routes (keep tally + data).
- **Phase 2 — Documents system** *(unblocks 3/4/5 via the reusable uploader)* — private-by-default docs + associations + saved views; upload pipeline (`@llamaindex/liteparse` + `@cf/meta/llama-3.2-11b-vision-instruct` OCR → R2 → D1 → Vectorize); public `/docs` + `/admin/docs` with view-visibility precedence + amber exposure warnings.
- **Phase 3 — Companies CRM** — contacts, notes/todos (PlateJS), documents (Phase 2), permits, and the **Gmail comms hub** (`specs/GMAIL_COMMS.md`).
- **Phase 4 — Design** — moodboards (Gemini reference flow, revisions), `/admin/designs/workshop` (plan 0014), decision-room, blank-canvas rebuild (extends W0), builder→angles, public `/planning/design-master-plan` (+ contractor comments).
- **Phase 5 — Brands / Products / Showroom sourcing** — consolidate `/admin/shopping/*` (keep all sub-pages), e-commerce brand/product pages, per-entity research + shopping-journal, RAG journal viewer, hero-hours modal (beste.co), and the **showroom enrichment pipeline** (`specs/SHOWROOM_ENRICHMENT.md`).
- **Phase 6 — Bids & Budget** — per-contractor phone-PIN bids, `/admin/bids` (from bid-portfolios), delete estimates list (keep manual intake as `/admin/bids/new`), `/admin/budget/*`.
- **Phase 7 — Floor plan / rooms** — `/floor-plan/floors/[id]/rooms/[id]` via the floorplan visual (floor PK + room PK), closets view.

Dependencies: P1 first · **P2 before P3/P4/P5** (shared uploader) · P7 underlies room/design deep-links · W0 before P4 (blank-canvas).

## Sibling initiatives (own plans on `/admin/plans`)

`0009_clickup_taskmanagement` · `0010_gallery_search` · `0011_photo_editing` · `0012_contractor_activity_map` · `0014_ai_photo_workshop`. Each has its own docs folder + high-level tasks; detail lives in those folders.

## How to execute (future sessions)

See `PROMPT.md`. In short: read `SITEMAP.md` + `OPEN_QUESTIONS.md`, pick the next unblocked task on the board, build it, then `PATCH /api/admin/plans/tasks/:id` to `in_progress`/`done`. Follow `astro-cf-redirects-splat-bug` (redirects in `_worker.ts`) and the drizzle/deploy discipline in the repo memory.
