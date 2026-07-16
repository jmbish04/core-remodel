# 0022 — Coding Agent Kickoff Prompt

You are implementing **0022 — GPS Showroom Drives & Visit Logs** in the `core-remodel` Cloudflare Worker. Read these first, in order, and treat them as the contract:
1. `docs/0022_gps_showroom_drives/PRD.md` — what & why, data model, pipeline, API/MCP surface, phases, acceptance criteria.
2. `docs/0022_gps_showroom_drives/UX.md` — the frontend spec (hand this to Claude AI Design; see §"Frontend orchestration" below).
3. `docs/0022_gps_showroom_drives/TASKS.json` — the ordered task list (mirrors the D1 board at `/admin/plans/0022_gps_showroom_drives`; update task status there as you go via `PATCH /api/admin/plans/tasks/:id`).
4. `AGENTS.md` — absolute repo rules (esp. the **PlateJS markdown+html** rule added for this feature).

## Ground rules (non-negotiable)
- **Stack:** Hono + `@hono/zod-openapi` (Zod v4) → Drizzle on D1 → Astro SSR + shadcn (Monolith dark) → Agents/MCP. `pnpm` only.
- **Migrations:** `pnpm run db:generate` (app `DB`) — never hand-write SQL migrations. Apply remote with `pnpm run migrate:remote`. The Tesla telemetry DB (`TESLA_DB`) has its own config/dir (`drizzle.tesla.config.ts` / `drizzle-tesla/`, `pnpm run migrate:tesla:remote`) — the new **app-DB** tables (`showroom_visit_log`, `showroom_store_hitl_queue`, and the `showroom_stores`/`contact_log`/`drive_lists` alters) go in the **app schema barrel** (`src/backend/db/schema/index.ts`), NOT the tesla barrel.
- **Deploy:** `pnpm run deploy` only (build + migrate:remote + migrate:tesla:remote + wrangler deploy). Never `wrangler deploy` directly. After any `wrangler.jsonc` binding change run `pnpm run types`.
- **Secrets:** none new expected. Tesla creds already bound (`TESSIE_API_TOKEN`, `TESLA_BETSY_VIN`); webhook auth uses `WORKER_API_KEY`.
- **PlateJS rule:** every user note persists BOTH `*_markdown` and `*_html`. Reuse `OverviewNoteEditor`. Enforce in schema, API, MCP, and UI. No plain textareas for notes.
- **Typecheck/build:** `pnpm run build` is esbuild (no types) — also run `npx tsc --noEmit` filtered to changed files (there is a ~178-error pre-existing baseline; keep it unchanged, zero new errors in your files).
- **MCP tools:** hand-written Zod v4, `READ_ONLY`/`WRITE` annotations, `examples`, `url` fields; wire the new `tools/tesla.ts` (or extend `showrooms`/`drives`) into `src/backend/mcp/tools/index.ts` and add any new category to `types.ts`.
- **PR discipline:** stack the work in phase-sized PRs (see below). Poll the Workers Build to green before merging — do NOT use `gh pr merge --auto` (it merges before the build gate on this repo). Address the Gemini review bot's comments, then merge manually. (See project memory: secrets-store-binding-deploy-validation.)

## Build order (backend-first)
Work the phases in `TASKS.json`. **P0 is already shipped** (marked `done`). Recommended PR slicing:

- **PR-A (P1 data + workspace):** `showroom_visit_log` + `contact_log` alter → visit-log REST + store endpoint → visit-log MCP tools → Visit Logs pages + store-viewport Visits section + shared visit components. *Ships value even with GPS off — do this first and get it usable.*
- **PR-B (P2 config + gating):** `/admin/config/tesla`, config keys + geocode, recording master-gate, `shouldProcessLocation`.
- **PR-C (P3 park pipeline):** `paused` status + active PATCH, park detection, decision tree 1.a–1.c, drive-away two-row staging, drive-viewport active toggle + record-visit slide-over.
- **PR-D (P4 discovery):** `showroom_store_hitl_queue` + store proximity flags, `proximityScan`, decision 1.d, discoveries page + REST + MCP, drive detour forks.
- **PR-E (P5 navigation):** `NavigateTeslaButton` shared, showroom button, waypoints **spike** (`P5-SPIKE-01`) → multi-waypoint navigate-drive + send-to-car UI.
- **PR-F (P6 AI surface):** `get_current_vehicle_location`, `whats_near_me`, staging/nav MCP tools.

Do `P5-SPIKE-01` (verify `navigation_waypoints_request` payload against a live vehicle) **before** building `P5-API-01`; if it can't be verified, implement the documented fallback (sequential single `share` + park auto-advance, which already exists) and leave the waypoint path behind a flag.

## Frontend orchestration (parallel, to Claude AI Design)
The frontend is designed by **Claude AI Design** in parallel with your backend work:
1. As soon as PR-A's schema + endpoints exist (real contracts), hand `docs/0022_gps_showroom_drives/UX.md` to Claude AI Design and ask it to produce the screens listed in UX §8, reusing existing Monolith components.
2. The **user reviews iterations directly with the design agent.** Do not rebuild screens until the user has approved.
3. When the user tells the design agent **"design approved,"** the design agent notifies you (the orchestrator) that the frontend is ready.
4. Then rebuild the approved screens as Astro + React islands wired to the live endpoints — no throwaway Stitch/HTML — matching AGENTS.md conventions and the Monolith rules.
5. Keep `AGENTS.md` updated if the rebuild introduces a new convention.

While you wait on design approval, keep moving on backend phases (P2–P6 are mostly backend).

## Definition of done (per PRD §11)
All acceptance criteria A1–A9 pass; notes store markdown+html everywhere (A8); the Visit Logs empty state, staged prefill, discovery HITL, Tesla config gating, and multi-waypoint nav (or fallback) are all live; `/admin/plans/0022_gps_showroom_drives` reflects real task status; `pnpm run build` + filtered `tsc` clean; each phase deployed green.

## First actions
1. Confirm you're on a fresh branch off `origin/main` (which already has P0).
2. Read PRD + UX + TASKS + AGENTS.md.
3. Start PR-A: generate the `showroom_visit_log` Drizzle schema per PRD §5.1, `pnpm run db:generate`, review the migration, then build the REST layer. Update `TASKS.json`/the D1 board as each task moves.
