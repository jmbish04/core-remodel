# Coding Agent Briefing: Showroom & Materials Sourcing Suite

## 1. Context & Architecture
You are building the **Showroom & Materials Sourcing Suite** inside a Cloudflare Workers project utilizing Astro SSR on the frontend and Hono + Drizzle ORM + D1 on the backend.
* **Database Schema**: Definitions live under `src/backend/db/schema/showroom/`.
* **API Endpoints**: CRUD logic is mounted at `src/backend/api/routes/showroom-stores.ts`.
* **AI Processing**: Scrapes, compatibility tests, and clearances are managed by the `ShowroomResearchAgent` Durable Object.
* **Frontend Pages**: Mounted at `src/frontend/pages/admin/` and React components under `src/frontend/components/showroom/`.

## 2. Coding Directives (AGENTS.md Alignment)
* **Design Tone**: Strictly enforce the **Monolith** profile. The background is `#0a0a0c`, card surface is `#111114`, and primary text is `#fafafa`. No light mode styling allowed.
* **Borders**: Banned 1px borders. Card borders must use `ring-1 ring-border/40`.
* **Typography**: Headlines use `Inter` semibold tracking-tight. Numbers use `JetBrains Mono` or `Geist Mono` with `font-feature-settings: "tnum"`.
* **Charts**: Recharts must override standard shadcn themes with:
  * `--chart-1`: `oklch(0.74 0.18 240)` (Electric Blue)
  * `--chart-2`: `oklch(0.78 0.20 145)` (Vivid Green)
  * `--chart-3`: `oklch(0.79 0.18 75)` (Amber Gold)
  * `--chart-4`: `oklch(0.71 0.21 25)` (Hot Coral)
  * `--chart-5`: `oklch(0.69 0.21 320)` (Magenta Purple)
* **Verification**: All modules must pass `tsc --noEmit` and conform to clean code standards. Avoid monolithic components; modularize helpers and styling.

## 3. Implementation Schedule
Proceed systematically according to `docs/0001_showroom_planner/TASKS.json`:
1. Build **Materials Dashboard** (`materials.astro` / `MaterialsDashboard.tsx`).
2. Build **Showroom Directory** (`showrooms.astro` / `ShowroomsDirectory.tsx`).
3. Build **Material Viewport** (`material-viewport.astro` / `MaterialViewportApp.tsx`).
4. Build **Showroom Viewport** (`showroom-viewport.astro` / `ShowroomViewportApp.tsx`).
5. Build **Scanner / Sync Log** (`scans.astro` / `ScanSyncApp.tsx`).

Refer to `docs/0001_showroom_planner/PRD.md` for specific criteria on each page.
