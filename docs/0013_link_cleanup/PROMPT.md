# PROMPT — Briefing for future coding sessions (0013)

You are picking up the **Site/URL cleanup + two-viewport IA** roadmap. The plan is tracked live at **`/admin/plans/0013_link_cleanup`** (D1-backed).

## Workflow each session
1. **Read** `ROADMAP.md`, `SITEMAP.md` (target routes), and `OPEN_QUESTIONS.md` (answered decisions). Check the relevant `specs/*.md` for the workstream you're touching.
2. **Pick the next unblocked task** on the board (respect `dependsOn`; W0 recovery + P1 IA come first; **P2 documents before P3/P4/P5** because of the shared uploader).
3. `PATCH /api/admin/plans/tasks/:id` → `in_progress` when you start, `done` when shipped (with a `notes` line on how/where).
4. Build it, following the repo conventions below.

## Non-negotiable conventions (repo memory)
- **Cloudflare stack:** Hono + `@hono/zod-openapi`, Drizzle on D1, Astro SSR + shadcn (Monolith dark theme, no 1px borders). Load the `cloudflare-jedi` skill.
- **Routing:** page-route redirects go in **`src/_worker.ts`** (prefix 301s), NOT Astro `redirects` config (the CF adapter mis-generates a splat rule — see `docs`/memory `astro-cf-redirects-splat-bug`).
- **DB:** never hand-write migrations — `pnpm run db:generate`. Never import `drizzle-zod` in schema files (breaks the build). Deploy DB via `pnpm run migrate:remote` only.
- **Deploy:** `pnpm run deploy` (build → migrate:remote → wrangler deploy). Prod worker = `core-remodel`.
- **Auth:** admin is gated by the `remodel_access` cookie (`/api/access/*`, `/access`); `/api/admin/*` is `requireAccessAuth`. Public = root.
- **Prompts/AI:** ES6 template literals (no `.join('\n')`). OCR = `@llamaindex/liteparse` + `@cf/meta/llama-3.2-11b-vision-instruct`.
- **Uncommitted-drift discipline:** COMMIT your work; the whole reason W0 exists is deploy-uncommitted work getting lost. Don't `wrangler deploy` uncommitted.

## Phase order
P0 (done: tracker) → **W0 recovery** + **P1 IA/viewport split** → **P2 documents** → P3 CRM / P4 design / P5 sourcing → P6 bids/budget → P7 floor/rooms. Sibling initiatives `0009–0014` have their own plans/folders.

## Definition of done for a task
Shipped + deployed (or clearly marked `blocked`/`deferred` with why), redirects added for any moved/deleted route, deleted-routes tally updated in `SITEMAP.md`, and the task `PATCH`ed to `done`.
