# Implementation Plan — 0013 (canonical)

Supersedes the earlier `IMPLEMENTATION_PLAN.md`/`_v2`/`_v3` drafts. Those covered the already-**shipped** first slice (showroom→shopping rebrand, admin-route normalization, collapsible SSR sidebar, dynamic `/sitemap`, prefetch, redirects in `_worker.ts`) — that work is deployed on `main`+`serene-pike`. This doc covers the roadmap going forward and the tracker that monitors it.

## Session 0 — Roadmap + live tracker (this session)

Built the **planning package** (`docs/0013_link_cleanup/`: this file + `ROADMAP`, `SITEMAP`, `OPEN_QUESTIONS`, `RECOVERY`, `PROMPT`, `specs/{GMAIL_COMMS,SHOWROOM_ENRICHMENT}`, `TASKS.json`, and the original `DRAFT_SITEMAP_NOTES.md`) and the **tracker**:

- **D1:** `plans` + `plan_tasks` (`src/backend/db/schema/plans/`), migration `0066`.
- **Seed:** `src/backend/db/seeds/seed-plan-tasks.ts` — canonical list of all 6 initiatives (`0009–0014`) + the full 0013 task breakdown. Idempotent (`onConflictDoNothing` on `(planSlug, taskKey)`), so re-seeding never clobbers a live `status`.
- **API:** `src/backend/api/routes/admin-plans.ts` mounted at `/api/admin/plans` (list / get / `PATCH tasks/:id` / `POST :slug/seed`).
- **UI:** `/admin/plans` (overview) + `/admin/plans/[slug]` (board, polls ~10s, inline status control, URL-persisted filters) + "Plans" in the admin sidebar.

## How the tracker drives execution

`TASKS.json` ⇄ `seed-plan-tasks.ts` are kept in sync by hand (the seed is the runtime source; the JSON is the doc mirror). Future sessions don't re-seed for status — they `PATCH` task rows, and the board reflects it. Adding new tasks: append to the seed (+ JSON), redeploy, `POST .../seed` (idempotent inserts the new keys).

## Out of scope this session
All feature builds (Phases 1–7 and the sibling initiatives). This session establishes the plan + tracker only. See `ROADMAP.md` for sequencing and `PROMPT.md` for the per-session workflow.
