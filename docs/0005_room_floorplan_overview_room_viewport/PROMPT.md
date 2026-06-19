# Coding-Agent Briefing — 0005 Floor-Plan + Room Viewport Overhaul

You are implementing feature **0005**. Read these first, in order:
1. [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) — full design, live-data snapshot, exact reconciliation mapping, per-phase specs, risks, acceptance criteria.
2. [`TASKS.json`](./TASKS.json) — dependency-ordered tasks with file targets and acceptance.
3. Project root `AGENTS.md` (if present) and the `cloudflare-jedi` conventions.

Work the tasks in `TASKS.json` order: **P0 → P1 → P5 → P6 → (P2 ∥ P3 ∥ P4) → P7**. P0 alone fixes the user's reported bug — land it first.

---

## What the user actually reported
"Uploaded photos for the downstairs family room and guest bedroom, but `/floor-plan` shows 0 listing / 0 inspiration." **Confirmed cause:** photos were attached to **drift rooms** with snake_case `room_code`s that have no floorplan coordinates, so they render no dot. The canonical kebab-case rooms that *do* have dots are nearly empty. P0 reconciles this.

## Non-negotiable rules (this stack)
- **No mock/placeholder data.** Every number/table/chart is live from the API. The user emphasized this repeatedly ("ABSOLUTELY NO MOCK DATA").
- **No `window.alert/confirm/prompt`.** shadcn `Dialog`/`AlertDialog` only. Success/error = shadcn (`sonner`/Alert), never browser chrome.
- **Dark Monolith theme**, no traditional 1px borders (`ring-1 ring-border/40`, `divide-y divide-border/40`, `bg-card`).
- **Schema migrations** via `pnpm run db:generate` → `pnpm run migrate:remote`. Never hand-edit generated SQL. The room **data fix** is a separate idempotent script run via `wrangler d1 execute DB --remote --file=…` (like the existing `db:seed`).
- **AI prompts** are ES6 template literals with real newlines — never `.join('\n')`.
- **Split monolithic files** (`RoomViewApp.tsx` ~1050 lines, `FloorplanGalleryApp.tsx` ~490 lines) into modules as part of the work, not after. Target <400 lines/file.
- New endpoints use `@hono/zod-openapi` (Zod v4) and must appear in `/openapi.json` + `/scalar`.
- Heavy docstrings on new modules/services/endpoints.

## Safety for the destructive P0 step
1. **Back up first:** `wrangler d1 export DB --remote --output=backup-pre-0005.sql`.
2. Re-point all FK rows **before** any `DELETE`. Wrap in a transaction; make each statement re-runnable.
3. Verify: post-merge `listing + inspiration` totals == pre-merge totals **minus the 2 intentionally-deleted duplicates** (`4a06d3af…`, `1343677a…`).
4. Deleting an image must remove **both** the D1 row and the Cloudflare Images asset — use the existing `DELETE /api/images/:id` path.
5. Per project memory, the `pnpm run deploy` migration journal is unreliable — apply migrations manually, verify, then deploy. Confirm the current convention before shipping.

## Key facts you'll need (verified against live D1 `4811af1e-202d-4b96-99e2-d98dc45c597e`)
- **Drift rooms to merge away:** ids `2330293`–`2330301` (see the table in `IMPLEMENTATION_PLAN.md` §2.1 for each → target).
- **Floors:** `lower_level`(1), `upper_level`(2), `outside`(233121), `all_levels`(233122). `outside-patio`/`outside-backyard` move to floor `233121`.
- **Photo links live in** `images.room_id` (listing/ai_render) and `inspirational_image_rooms.room_id` (inspiration). `listing_photos` is effectively unused.
- **Specific photo moves/deletes** — exact image IDs are in `IMPLEMENTATION_PLAN.md` §2.3 and §4.1.
- **Hero image** = `room_ai_summaries.representativeImageId` via `PATCH /api/rooms/code/:roomCode/profile`.
- **AI room summary** = `POST /api/rooms/code/:roomCode/summary` (supports voice/Whisper).
- **Task data already exists**: `planning_epics`, `planning_tasks` (RACI/deps/status/dates), `/api/planning`. **Extend it** (P5) — don't build a parallel tasks system. `room_action_items` is the lightweight per-room checklist + fallback.
- **Supporting docs** = `/api/supporting-documents` (+ `/upload` to R2 bucket `ARTIFACTS_BUCKET`), room mapping via `supporting_document_room_mappings`.
- **Image URLs:** `https://imagedelivery.net/{cfImageIdOptimized||cfImageIdOriginal}/public`.
- **AI binding** `env.AI` (existing usage: `@cf/meta/llama-3.x-instruct`, `@cf/openai/whisper`).

## File map (primary touch points)
| Area | File |
|---|---|
| Rooms schema | `src/backend/db/schema/home/rooms.ts` |
| Catalog seed/service | `src/backend/services/home-catalog.ts` |
| Reconciliation service (new) | `src/backend/services/reconcile-rooms.ts` |
| Data-fix script (new) | `scripts/0005-reconcile-rooms.sql` (+ `.ts`) |
| Rooms API | `src/backend/api/routes/rooms.ts` |
| Images API | `src/backend/api/routes/images.ts` |
| Planning API | `src/backend/api/routes/planning.ts` |
| Supporting docs API | `src/backend/api/routes/supporting-documents.ts` |
| AI routes / new AI service | `src/backend/api/routes/ai.ts`, `src/backend/services/ai-text.ts` (new) |
| Floor-plan page | `src/frontend/pages/floor-plan.astro`, `src/frontend/components/FloorplanGalleryApp.tsx` (+ new `floorplan/` submodules) |
| Room viewport | `src/frontend/pages/rooms/[slug].astro`, `src/frontend/components/RoomViewApp.tsx` (+ new `room-view/` submodules) |
| Shared Select (bug) | `src/frontend/components/ui/select.tsx` |
| Reusable TOC (new) | `src/frontend/components/ui/scroll-progress.tsx` |
| Bento (delete usage) | `src/frontend/components/ui/grid-bento.tsx` |

## UI building blocks referenced by the spec
Rebuild any external shadcn-registry blocks to the Monolith theme + live data (the user pasted reference snippets — they are starting points, not drop-ins):
- Dot room card (Card + Badge + View Room button).
- Stat cards (`@bundui/stats-section-01` style) + Task Progress (`@hextaui/task-progress`).
- Budget + supporting-materials tables: TanStack (`@coss/p-table-4`) with pagination/sort/search/filter.
- Reusable scroll-progress TOC (siddz `scroll-progress`).
Discover richer components via the `shoogle-mcp` registry where helpful; keep everything dark-Monolith.

## Definition of done
All acceptance criteria in `IMPLEMENTATION_PLAN.md` §15, verified on the deployed worker (Chrome DevTools MCP) — most importantly: the user's downstairs **family room** and **guest bedroom** photos appear, every placed room shows a dot on both levels, and the room viewport matches the restructured layout with zero mock data.

## Coordinate note (resolved)
`upper-dining-room` is user-specified at **(84, 62)** on `upper_level` — same vertical axis as `upper-living-room` (xPct 84), moved up to the middle of "quad 2" so it sits between `upper-stair-landing` (78,49) above and `upper-living-room` (84,72) below. (Coordinate system: yPct 0 = top of image = back bedrooms; yPct 100 = bottom = living/kitchen.) A quick visual confirm of all intentionally-moved dots after P0 is still worthwhile (R-4), but nothing here is a guess anymore — every placement is deterministic.
