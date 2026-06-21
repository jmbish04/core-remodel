# 0005 — Floor-Plan Page + Room Viewport Overhaul

**Status:** Planning complete — ready for implementation
**Author:** Planning pass (grounded in live D1 `core-remodel` @ `4811af1e-202d-4b96-99e2-d98dc45c597e`)
**Date:** 2026-06-18
**Stack:** Cloudflare Worker + Astro SSR + Hono (`@hono/zod-openapi`) + Drizzle/D1 + Workers AI + R2 + Cloudflare Images. React islands + shadcn/ui (`@base-ui/react`), dark Monolith theme.

> Companion files: [`TASKS.json`](./TASKS.json) (structured, dependency-ordered task list) and [`PROMPT.md`](./PROMPT.md) (coding-agent briefing). Read all three together.

---

## 1. Problem statement

The user reported: *"I uploaded photos for family room and guest bedroom downstairs but the floor-plan page still shows 0 listing and 0 inspiration."*

**Verified root cause (from live DB):** The image upload/mapping flow assigned photos to **drift rooms** with snake_case `room_code`s (`kitchen`, `backyard`, `primary_bathroom`, `living_room`, `family_room`, `guest_bathroom`, `entry_foyer`, `hall_bathroom`, `guest_bedroom` — IDs `2330293`–`2330301`). These rooms:

- Are **not** in the canonical seed ([`src/backend/services/home-catalog.ts`](src/backend/services/home-catalog.ts)).
- Have **no floorplan coordinates** in `ROOM_COORDINATES_BY_CODE` ([`src/frontend/components/FloorplanGalleryApp.tsx:48`](src/frontend/components/FloorplanGalleryApp.tsx)), so they render **no dot**.
- Hold most of the real photos, while the canonical kebab-case rooms that *do* render dots are nearly empty.

> NOTE: the current upload/mapping code paths (`/api/images/upload`, `/api/images/mapping/apply`) **validate** room IDs and do **not** create rooms. The drift rooms were created by some other path (AI agent / earlier import). After reconciliation, see Risk R-3 for hardening so drift cannot recur.

This overhaul does two things: (1) **reconcile** the room data so photos land on correctly-positioned rooms, and (2) **rebuild** the floor-plan page and the room viewport per the detailed UX spec.

---

## 2. Live data snapshot (current production state)

### 2.1 Rooms (canonical = IDs 1–20; drift = IDs 2330293–2330301)

| id | room_code | room_name | floor | listing | inspiration | notes |
|----|-----------|-----------|-------|--------:|------------:|-------|
| 1 | `lower-bedroom-1` | Bedroom | lower | 4 | 0 | → **lower-guest-bedroom** |
| 2 | `lower-family-room` | Family Room | lower | 0 | 0 | merge `living_room` in |
| 3 | `lower-bath-1` | Bath | lower | 1 | 0 | → **lower-guest-bath** |
| 4 | `lower-laundry` | Laundry | lower | 1 | 0 | keep |
| 5 | `lower-storage` | Storage | lower | 0 | 0 | **DELETE** |
| 6 | `lower-garage` | Garage | lower | 37 | 2 | keep |
| 7 | `lower-entryway` | Entryway | lower | 9 | 3 | → **street-front-door** (split) |
| 8 | `lower-patio` | Patio | lower | 20 | 0 | → **outside-patio** (→ outside floor) |
| 9 | `lower-rear-patio` | Rear Patio | lower | 0 | 1 | merge into outside-patio, **DELETE** |
| 10 | `lower-backyard` | Backyard | lower | 12 | 1 | → **outside-backyard** (→ outside floor) |
| 11 | `upper-primary-bedroom` | Primary Bedroom | upper | 4 | 5 | → **primary-bedroom** |
| 12 | `upper-bedroom-2` | Bedroom | upper | 0 | 0 | → **jason-office** (coord from #13) |
| 13 | `upper-bedroom-3` | Bedroom | upper | 3 | 0 | → **justin-office** (coord from #12) |
| 14 | `upper-living-dining` | Living Room / Dining Room | upper | 20 | 11 | → **upper-living-room** + split out **upper-dining-room** |
| 15 | `upper-kitchen-breakfast` | Kitchen / Breakfast Nook | upper | 8 | 4 | → **upper-kitchen** (merge `kitchen`) |
| 16 | `upper-bath-1` | Bath | upper | 2 | 0 | → **upper-hall-bath** (merge `hall_bathroom`) |
| 17 | `upper-bath-2` | Bath (Second) | upper | 0 | 0 | coord donor → primary-bathroom, **DELETE** |
| 18 | `upper-lightwell` | Lightwell | upper | 6 | 0 | keep (no change) |
| 19 | `upper-workshop` | Workshop | upper | 0 | 0 | → **upper-stair-landing** |
| 20 | `upper-deck` | Deck | upper | 0 | 0 | **DELETE** (does not exist) |
| 2330293 | `primary_bathroom` | Primary Bathroom | upper | 8 | 12 | → **primary-bathroom** (keep, rename) |
| 2330294 | `entry_foyer` | Entry/Foyer | lower | 0 | 2 | → **lower-foyer** (keep, rename) |
| 2330295 | `kitchen` | Kitchen | upper | 0 | 71 | merge into upper-kitchen, **DELETE** |
| 2330296 | `guest_bathroom` | Guest Bathroom | lower | 0 | 1 | merge into lower-guest-bath, **DELETE** |
| 2330297 | `hall_bathroom` | Hall Bathroom | upper | 0 | 0 | merge into upper-hall-bath, **DELETE** |
| 2330298 | `guest_bedroom` | Guest Bedroom | lower | 0 | 0 | merge into lower-guest-bedroom, **DELETE** |
| 2330299 | `living_room` | Living Room | lower | 6 | 2 | merge into lower-family-room, **DELETE** |
| 2330300 | `family_room` | Family Room | upper | 1 | 3 | merge into upper-living-room, **DELETE** |
| 2330301 | `backyard` | Backyard | outside | 7 | 53 | merge into outside-backyard, **DELETE** |

> Listing counts are from `images` where `photo_category='listing'` and `room_id` set. Inspiration counts are from `inspirational_image_rooms`. The `listing_photos` table is effectively unused (1 row, null room). **All photo-room linkage for the merge lives in `images.room_id` and `inspirational_image_rooms.room_id`.**

### 2.2 Floors

| id | key | name | level_order |
|----|-----|------|-------------|
| 1 | `lower_level` | Lower Level | 1 |
| 2 | `upper_level` | Upper Level | 2 |
| 233121 | `outside` | Outside | 3 |
| 233122 | `all_levels` | All Levels | 4 |

### 2.3 Specific photos named in the spec (verified IDs)

| display_name | image id | current room | action |
|---|---|---|---|
| Brick Garage Entrance with For Sale Sign and Succulents | `fd965547-fe96-4d7a-9a2e-321c0e05f852` | 7 | keep on **street-front-door** |
| Minimalist Entryway with Dark Gray Metal Door | `4ce41f86-905a-4efe-babd-98c0c47063d1` | 7 | keep on **street-front-door** |
| Modern Minimalist Dining Room with Blue Upholstered Chairs and Abstract Art | `ce4f317d-a95e-470c-81ba-a1838a75fb4d` | 14 | move → **upper-dining-room** |
| Minimalist LightFilled Living Room with Abstract Art | `4ac13ec3-c491-4662-b87a-1b9d2fd77c63` | 14 | move → **upper-dining-room** |
| Modern Minimalist BlueAccent Dining Room | `4a06d3af-d8ac-4577-87bb-32a228175898` | 14 | **DELETE** (duplicate) |
| Modern Minimalist Dining Room with Blue Chairs and Skylight | `1343677a-db36-4252-85d6-e965dd9c2779` | 14 | **DELETE** (duplicate) |
| Modern Minimalist White Living Room with High Ceilings | `22cef674-571f-4416-b97e-d4b7dc3a4763` | 14 | move → **upper-stair-landing** |
| Minimalist Light Wood Staircase in White Interior | `a2a0d96c-5247-4406-9cc4-c70a857662f7` | 14 | move → **upper-stair-landing** |

---

## 3. Architecture decisions

1. **Floorplan coordinates move into D1.** Today they are hardcoded by `room_code` in the frontend. After the rename storm, hardcoded keys would be a maintenance trap, and the cloudflare-jedi rule bans hardcoded data. **Add `floorplan_floor_key`, `floorplan_x_pct`, `floorplan_y_pct` columns to `rooms`** and seed them (Section 4). The floor-plan page renders dots from `/api/rooms/catalog` (extended to include coordinates). Rooms with null coordinates render no dot and are listed in an "Outside / Unplaced" sidebar group.

2. **Room reconciliation = reusable service + one-off data-fix script.** FK references to `room_id` span many tables; a merge must repoint every one. Build a **`reconcileRooms` service** (`merge`, `rename`, `setFloorplanPosition`, `reassignImages`, `deleteRoom`) used by both an admin API and a single idempotent data-fix script that encodes the exact mapping in Section 4. Do **not** hand-edit drizzle migration files (schema migrations come from `pnpm run db:generate`; the data fix is a separate script run via `wrangler d1 execute --remote --file=`, consistent with the existing `db:seed` script).

3. **Task/Project suite: extend, don't reinvent.** A planning system already exists: `planning_epics`, `planning_tasks` (RACI, deps, status, dates), `planning_task_updates`, `planning_participants`, `planning_logs`, plus `/api/planning`. The spec's "no mock data — use our task API, or build it" is satisfied by **extending** this: add room-scoped task queries, status-count aggregates, and Kanban/Gantt/calendar/search endpoints. `room_action_items` remains the lightweight per-room checklist. The room-viewport **Task Progress** stat reads real `planning_tasks` scoped to the room (fallback to `room_action_items` if the room has no planning tasks).

4. **No new chat/agent surface.** Pure CRUD + Workers AI text generation. Use `getAgentByName` RPC only if touching existing agents (not expected here). Workers AI text helpers (`env.AI.run`) for: improve-description, document↔room summary, room-options quick summary — all via ES6 template-literal prompts.

5. **Reuse existing storage + endpoints.** Hero image = `room_ai_summaries.representativeImageId` via existing `PATCH /api/rooms/code/:roomCode/profile`. AI summary = existing `POST /api/rooms/code/:roomCode/summary`. Supporting docs = existing `/api/supporting-documents` (+ `/upload` to R2). Image delivery = `https://imagedelivery.net/{token}/public`.

---

## 4. Phase 0 — Room data reconciliation (the actual bug fix)

> This phase alone makes the user's photos reappear. Ship it first and independently if desired.

### 4.0 Schema change (coordinates)
Add to [`src/backend/db/schema/home/rooms.ts`](src/backend/db/schema/home/rooms.ts):
```ts
floorplanFloorKey: text("floorplan_floor_key"),      // "lower_level" | "upper_level" | "outside" | null
floorplanXPct: real("floorplan_x_pct"),               // 0–100, null = no dot
floorplanYPct: real("floorplan_y_pct"),
```
Run `pnpm run db:generate`. Update the schema barrel exports if needed (no new file → no barrel change).

### 4.1 Reconciliation mapping (exact, idempotent)

For every **merge**, repoint **all** room-referencing rows from the source room id → target room id, then delete the source. Before writing the script, **enumerate every table with a `room_id` column** to guarantee completeness:
```sql
SELECT m.name AS table_name, p.name AS column_name
FROM sqlite_master m
JOIN pragma_table_info(m.name) p
WHERE m.type='table' AND p.name IN ('room_id','roomId')
ORDER BY 1;
```
Known repoint targets (verify against the query above at execution time): `images.room_id`, `inspirational_image_rooms.room_id`, `listing_photos.room_id`, `supporting_document_room_mappings.room_id`, `room_action_items.room_id`, `room_ai_summaries.room_id`, `scenario_room_plans.room_id`, `budget_tracker_item_rooms.room_id`, `planning_tasks.room_id`.
**Uniqueness guards:** `room_ai_summaries` is one-per-room and `inspirational_image_rooms` has a unique `(image_id, room_id)`. On merge, dedupe: for `inspirational_image_rooms`, skip rows whose `(image_id, target_room)` already exists; for `room_ai_summaries`, keep the target's row (or the most recently generated) and delete the source's.

**LOWER LEVEL**

| # | Operation | Source → Target | Coordinate | Photo moves |
|---|-----------|-----------------|------------|-------------|
| L1 | rename | `lower-bedroom-1` (1) → `lower-guest-bedroom`, name "Guest Bedroom" | keep (33,28, lower) | — |
| L1b | merge+delete | `guest_bedroom` (2330298) → room 1 | — | (none; 0 photos) |
| L2 | merge+delete | `living_room` (2330299) → `lower-family-room` (2) | room 2 keeps existing pos (18,34 lower) | 6 listing + 2 insp repoint to 2 |
| L3 | rename | `lower-bath-1` (3) → `lower-guest-bath`, name "Guest Bath" | keep (34,43 lower) | — |
| L3b | merge+delete | `guest_bathroom` (2330296) → room 3 | — | 1 insp → 3 |
| L4 | rename + move floor | `lower-patio` (8) → `outside-patio`, name "Patio", floor → `outside` (233121) | keep (27,10 lower) **or** clear (see note) | — |
| L4b | merge+delete | `lower-rear-patio` (9) → room 8 | — | 1 insp → 8 |
| L5 | rename + move floor | `lower-backyard` (10) → `outside-backyard`, name "Backyard", floor → `outside` | clear (no interior dot) | — |
| L5b | merge+delete | `backyard` (2330301) → room 10 | — | 7 listing + 53 insp → 10 |
| L6 | rename | `lower-entryway` (7) → `street-front-door`, name "Front Door / Street" | set (7,89 lower) | keep only the 2 named exterior photos; move the rest to lower-foyer (L7) |
| L7 | rename | `entry_foyer` (2330294) → `lower-foyer`, name "Foyer" | set (7,52 lower) — "corner of street-front-door X and lower-storage Y" | receives room-7 interior photos |
| L8 | delete | `lower-storage` (5) | (was 34,52 — its Y informs L7) | none |

> **L4 note:** outside-patio still has a sensible dot at (27,10) — keep it. outside-backyard sits beyond the floorplan footprint → null coordinate (no dot), shown in the sidebar "Outside" group.
>
> **L6/L7 photo split:** Deterministic part — the 2 named photos (`fd965547`, `4ce41f86`) stay on **street-front-door**. The remaining 7 listing + 3 inspiration currently on room 7 are interior entryway/hallway shots and move to **lower-foyer**. Because "interior vs exterior" needs light judgment, the script moves *all* of room 7's photos to lower-foyer **except** the 2 named IDs (allowlist approach → safe + deterministic). If the user later wants more exterior shots on street-front-door, that's a one-line reassign.

**UPPER LEVEL**

| # | Operation | Source → Target | Coordinate | Photo moves |
|---|-----------|-----------------|------------|-------------|
| U1 | rename | `upper-primary-bedroom` (11) → `primary-bedroom` | keep (82,21 upper) | — |
| U2 | rename | `primary_bathroom` (2330293) → `primary-bathroom`, name "Primary Bathroom" | set from upper-bath-2 (88,39 upper) | — |
| U2b | merge+delete | `upper-bath-2` (17) → room 2330293 | (coord donor) | none |
| U3 | rename + recoord | `upper-bedroom-2` (12) → `jason-office`, name "Jason's Office" | set (66,52 upper) — from upper-bedroom-3 | — |
| U4 | rename + recoord | `upper-bedroom-3` (13) → `justin-office`, name "Justin's Office" | set (64,21 upper) — from upper-bedroom-2 | keeps its 3 listing |
| U5 | rename | `upper-living-dining` (14) → `upper-living-room`, name "Living Room" | keep (84,72 upper) | see below |
| U5b | create | `upper-dining-room`, name "Dining Room", floor upper | set (84,62 upper) — same X-axis as upper-living-room, moved up to mid quad-2 (between stair-landing & living-room) | receives `ce4f317d`, `4ac13ec3` from room 14 |
| U5c | merge+delete | `family_room` (2330300) → `upper-living-room` (14) | — | 1 listing + 3 insp → 14 |
| U5d | delete photos | duplicates `4a06d3af`, `1343677a` | — | hard-delete (DB + Cloudflare Images) |
| U6 | rename | `upper-bath-1` (16) → `upper-hall-bath`, name "Hall Bath" | set (64,32 upper) — moved **up** from (64,37) | — |
| U6b | merge+delete | `hall_bathroom` (2330297) → room 16 | — | none |
| U7 | rename | `upper-kitchen-breakfast` (15) → `upper-kitchen`, name "Kitchen" | set (65,76 upper) — moved **left** from (70,76) | — |
| U7b | merge+delete | `kitchen` (2330295) → room 15 | — | 71 insp → 15 |
| U8 | none | `upper-lightwell` (18) | keep (67,39 upper) | — |
| U9 | delete | `upper-deck` (20) | (remove 82,92) | none |
| U10 | rename | `upper-workshop` (19) → `upper-stair-landing`, name "Stair Landing" | keep (78,49 upper) | receives `22cef674`, `a2a0d96c` from room 14 |

> **U3/U4 are a coordinate swap** (offices assigned to swapped physical positions per the spec's "middle bedroom" / "top-left next to primary" descriptions). Implement as rename-in-place + set coordinate; this preserves all FKs and satisfies "delete upper-bedroom-2/3" (the old codes cease to exist).
>
> **U2 target is the drift row `primary_bathroom` (2330293)** because it holds the photos; `upper-bath-2` (17) is only the coordinate donor.
>
> **U5b dining coordinate is user-specified:** `(84, 62)` on `upper_level`. The user placed it on the same vertical axis as `upper-living-room` (xPct 84), moved up from the living-room marker (yPct 72) to the middle of "quad 2" (yPct 50–75 band → ~62), so the dot sits between `upper-stair-landing` (78, 49) above and `upper-living-room` (84, 72) below. (Coordinate system: yPct 0 = top of image = back bedrooms; yPct 100 = bottom = living/kitchen.)

### 4.2 Coordinate seed table (post-reconciliation, all dots)

Final `(room_code → floor_key, xPct, yPct)` to seed into the new columns. `null` xy = no dot (sidebar "Outside/Unplaced").

```
lower-guest-bedroom   lower_level 33 28
lower-family-room     lower_level 18 34
lower-guest-bath      lower_level 34 43
lower-laundry         lower_level 26 49
lower-garage          lower_level 25 77
street-front-door     lower_level  7 89
lower-foyer           lower_level  7 52
outside-patio         outside     27 10   (keep dot near front)
outside-backyard      outside    null null
primary-bedroom       upper_level 82 21
jason-office          upper_level 66 52
justin-office         upper_level 64 21
upper-living-room     upper_level 84 72
upper-dining-room     upper_level 84 62   (user-specified: mid quad-2, same axis as living-room)
upper-kitchen         upper_level 65 76
upper-hall-bath       upper_level 64 32
upper-lightwell       upper_level 67 39
upper-stair-landing   upper_level 78 49
primary-bathroom      upper_level 88 39
```
Deleted (no row): `lower-storage`, `upper-bath-2`, `upper-deck`, and all merged drift rooms.

### 4.3 Hardening (prevent recurrence)
After reconciliation, add a guard so future uploads/mappings cannot silently create snake_case drift rooms (Risk R-3): the mapping apply path already validates room IDs — confirm no other path (`/api/photo-edits/decision-room`, AI agents, importers) auto-creates rooms by free-text name. If one does, route it through a canonical-slug resolver.

---

## 5. Phase 1 — Global Select label fix

**Bug:** [`RoomViewApp.tsx:547`](src/frontend/components/RoomViewApp.tsx) — the representative-photo `<Select>` trigger shows the selected image **id** instead of its display name, because `@base-ui/react`'s `<SelectValue>` renders the raw `value` when it can't resolve a label (unlike Radix).

**Fix (reusable):** Enhance the shared [`src/frontend/components/ui/select.tsx`](src/frontend/components/ui/select.tsx) `SelectValue` wrapper to accept an optional `items`/`getLabel` (or a `renderValue`) prop that maps the current value → display label, OR adopt base-ui's `items`-driven `<Select items=…>` value rendering. Apply the wrapper everywhere a Select's value differs from its visible text. Audit (already mostly clean): the representative-photo select is the only confirmed offender; verify GlobalUploadWidget/SupportingDocuments selects still render correctly after the change. Acceptance: selecting a photo shows its name in the trigger across the app.

---

## 6. Phase 2 — Floor-plan page redesign

File: [`src/frontend/components/FloorplanGalleryApp.tsx`](src/frontend/components/FloorplanGalleryApp.tsx) (split into submodules; current file is ~490 lines and will grow — extract `FloorplanDot`, `RoomHoverCard`, `LevelSidebar`).

1. **Show all dots, always.** Render dots for **both** levels simultaneously from DB coordinates (the floorplan image is upper+lower side-by-side). The level control no longer filters dots.
2. **Dot hover/click card.** On hover → show a room card (shadcn `Card` styled like the spec's pattern: room hero image, room name, # listing, # inspiration, total sq ft + measurements, **View Room** button → `/rooms/{roomCode}`). On click → make the card **sticky** (pinned) until dismissed/another dot clicked. Use `Popover`/`HoverCard` semantics; ensure touch = tap-to-pin on mobile.
3. **Level control → toggle switch in the right sidebar.** Remove the button-group from the floorplan header. Add a shadcn `Switch` (clearly labeled Lower / Upper) to the right sidebar. Toggling it does **not** reload and does **not** change dots — it only switches which level's rooms the sidebar lists. Keep the sidebar otherwise as-is; add an "Outside / Unplaced" group for null-coordinate rooms.
4. **Delete** the "Inspiration Highlights" card ([`FloorplanGalleryApp.tsx:379`](src/frontend/components/FloorplanGalleryApp.tsx)) and the "Room Launch Board" card ([`:424`](src/frontend/components/FloorplanGalleryApp.tsx)).
5. **Mobile.** Add base/`sm` breakpoints (current layout only defines `lg`). Floorplan image scales; sidebar stacks below; dots remain tappable; hover-card becomes tap-to-open sheet/popover. Verify at 375px.
6. **Data.** Extend `GET /api/rooms/catalog` to return `floorplanFloorKey/xPct/yPct`, per-room `listingCount`/`inspirationCount`, `heroImageUrl`, and dimensions so the dot card needs no extra fetch.

---

## 7. Phase 3 — Room viewport restructure

File: [`src/frontend/components/RoomViewApp.tsx`](src/frontend/components/RoomViewApp.tsx) (~1050 lines — **must be split** into section components under `src/frontend/components/room-view/`: `HeroHeader`, `RoomStatsRow`, `RoomOverview`, `RoomOptions`, `BudgetSignals`, `RoomMediaModal`, `SupportingMaterials`, `RoomTableOfContents`).

### 7.1 Hero (top of page)
- **Representative photo: much smaller, top-right.** Below it a **"Change room hero image"** button → opens a modal: vertical card rows (thumbnail left; name/meta right) of the room's **listing** photos; a ✅ marks the current hero on open; selecting a row moves the ✅ and live-updates the top-right thumbnail; **Cancel** + **Save** buttons; Save persists via `PATCH /api/rooms/code/:roomCode/profile` then shows a shadcn (NOT browser) success confirmation and refreshes the thumbnail. The hero dropdown is replaced by this modal (uses the fixed Select only where still needed).
- **Media entry buttons in hero:** two buttons — "Listing photos" (badge = count) and "Inspiration photos" (badge = count) — each opens the Room Media modal (Phase 3.6) pre-filtered to that kind.

### 7.2 Stats row (directly below hero, clickable → smooth-scroll to section)
Three stat cards (shadcn dl/stat pattern), all from **real API data, no mock**:
- **Budget Range** (+ sub-stat: % of total project budget) → scrolls to Budget Signals.
- **Estimate count** (count of estimate revisions in the room detail payload) → scrolls to Estimates.
- **Task Progress** (donut/progress from real `planning_tasks` scoped to room via Phase 5 endpoint; fallback to `room_action_items`) → scrolls to Tasks. Use the `@hextaui/task-progress` block (rebuilt to Monolith) bound to live data.

### 7.3 Room Overview (full width)
- Full-width card. Top-right **Edit / Update** button opens the **Refresh AI summary** UI (prompt textarea + voice record) in a **modal** (existing `POST /api/rooms/code/:roomCode/summary`). Remove the always-visible refresh card — it now lives only in the modal.

### 7.4 Room Options (full width, under overview)
- Source: `scenario_room_plans` + vision nodes (already in detail payload).
- **If no deviations:** show 👍 + "There are no known variations, scope creep, or potential deviations for this room — easy peezy?! 😄".
- **If deviations exist:** tabbed (shadcn `Tabs`). Tab 1 (default) = raw content. Tab 2 = ✨ "AI Quick Summary" = Workers-AI simplified version (Phase 6 helper).

### 7.5 Budget Signals (full width)
- Stat cards + a **paginated, searchable, filterable table** of budget items (rebuild the `@coss/p-table-4` TanStack pattern to Monolith). **Live from API on load, no mock.** Add `GET /api/rooms/:roomId/budget-items?search=&status=&page=&pageSize=` (or paginate client-side over the detail payload if counts are small — prefer a real paginated endpoint).

### 7.6 Room Media modal
- Move the bottom-of-page media into a modal. Hero buttons open it (7.1). Inside: toggle **Gallery / Masonry / List** only — **delete Bento** ([`grid-bento.tsx`](src/frontend/components/ui/grid-bento.tsx) usage + the toggle option; remove component if unused elsewhere). Listing modal shows only listing photos; inspiration modal shows only inspiration. Close **X** top-right + Close button bottom-right.

### 7.7 Table of contents (reusable)
- Right-side sticky **scroll-progress TOC** that scrolls with the user, highlighting the active section. Build as a **reusable** `src/frontend/components/ui/scroll-progress.tsx` (props: `items: {id,title,level}[]`, `className`, `scrollAreaRef`) per the spec; mount on the room viewport with section ids matching the stat anchors. Hidden/collapsible on mobile.

### 7.8 Supporting Materials (full width, bottom)
- **Table** columns: **Filename** (link → modal preview: R2/Cloudflare-Images inline for images, `<iframe>` for Google Drive/Docs, object/embed for PDF; modal has Close + "Open in new tab"), **Document type** (colored shadcn `Badge` per type), **Document date**, **Description**, **AI summary** (room-tailored, generated on load via Phase 6 helper — lazy/streamed, cached in `supporting_documents.aiRationale` or metadata).
- **Upload:** dropzone → stage files → **intake form** (single file = normal form; multiple = table of rows): document name (prefilled from metadata), file type (auto from MIME), date (auto = upload date), description (with ✨ button → Workers-AI improved version the user approves/rejects; approve overwrites). Upload button → per-file progress (circular), ✅ on success; modal **cannot be closed mid-upload** (friendly "please wait — don't close your browser" message). Per-file errors don't block others: show a shadcn error component with a **copy-to-clipboard** button (animated success) wrapping the error in an "AI coding agent fix/troubleshoot" prompt, plus a **Retry** button. Backend: existing `POST /api/supporting-documents/upload` (R2) + room mapping; add the AI-improve and AI-room-summary endpoints (Phase 6).

### 7.9 Image management on the room viewport (NEW)
The reconciliation (Phase 0) fixes today's mis-mapping, but the user needs ongoing tools to cull duplicates and re-home stray photos. Add to the room media modal / image actions:
- **Delete image** (listing or inspiration). Confirmation via shadcn `AlertDialog` (never `window.confirm`). Reuse existing **`DELETE /api/images/:id`** (already removes the D1 row **and** the Cloudflare Images asset). For **inspiration** photos (multi-room via `inspirational_image_rooms`), offer two distinct actions: **"Remove from this room"** (unmap only — `PUT /api/images/:id` with `roomIds` minus the current room) vs **"Delete permanently everywhere"** (`DELETE /api/images/:id`). Surface `images.is_duplicate` as a badge so duplicate clusters (some rooms have many) are easy to spot and cull. Refresh counts/lists on success.
- **Move / reassign photos.** A button opens a modal: thumbnail multi-select of the room's listing OR inspiration photos + a **target-room picker** (from `/api/rooms/catalog`, using the **fixed** Select that renders room display names) + Apply. Listing = single-room reassign (`PUT /api/images/:id` `roomId` or `POST /api/images/mapping/apply`); inspiration = add/replace mappings (`PUT roomIds`). Refresh both source and target counts.
- **Backend is mostly in place** — confirm during the API pass that `DELETE /api/images/:id` deletes the Cloudflare asset and that `PUT /api/images/:id` replaces the full `roomIds` set (needed for unmap). Add a thin convenience endpoint only if those semantics are missing.

> Tasks: **T3.8** (delete) and **T3.9** (move/reassign) in `TASKS.json`.

---

## 8. Phase 4 — Supporting materials backend touchpoints
Mostly reuse `/api/supporting-documents`. Add: room-scoped list (`?roomId=`), and ensure the create/upload accepts `roomIds` mapping (it does). New AI endpoints in Phase 6.

---

## 9. Phase 5 — Project/Task suite (extend existing `planning_*`)
Backed by existing tables. Add to `/api/planning` (or a new `/api/tasks` facade):
- **List/filter/search tasks:** `GET /api/planning/tasks?roomId=&status=&priority=&q=&epicId=&page=&pageSize=`.
- **Status counts:** `GET /api/planning/tasks/stats?roomId=` → `{open,in_progress,blocked,delayed,done,total}` (powers Task Progress + dashboards).
- **Kanban:** `GET /api/planning/board?roomId=` → tasks grouped by status with order.
- **Gantt:** `GET /api/planning/timeline?roomId=` → tasks with `startDate/dueDate/dependsOnTaskIds`.
- **Calendar:** `GET /api/planning/calendar?from=&to=&roomId=` → tasks by date range.
- **Projects:** treat `planning_epics` as projects; add `GET /api/planning/projects` (+ CRUD if missing) with task rollups. CRUD for tasks already exists — fill any gaps (update status, reorder).
- All Zod v4, registered via `@hono/zod-openapi` so they appear in `/openapi.json` + `/scalar`.

> If, at implementation time, the planning tables prove insufficient for a "generic projects + tasks" suite the user wants beyond remodel phases, create a dedicated `projects`/`tasks` domain under `src/backend/db/schema/projects/` (folder-per-domain, `index.ts` barrel) — but first prefer extending `planning_*` to avoid a parallel system.

---

## 10. Phase 6 — Workers AI text helpers
New service `src/backend/services/ai-text.ts` (or extend room-summary service). All prompts via **ES6 template literals** (never `.join('\n')`). Binding `env.AI`.
- `improveDescription(text, context)` → tightened description (supporting-doc ✨ button).
- `summarizeDocumentForRoom(doc, room)` → 1–2 sentence room-tailored relevance (supporting-materials AI summary column). Cache in `supporting_documents.aiRationale`/metadata.
- `summarizeRoomOptions(rawOptions)` → simplified Room Options "AI Quick Summary" tab.
Expose via Hono routes (e.g. `POST /api/ai/improve-description`, `POST /api/supporting-documents/:id/room-summary`, `POST /api/rooms/code/:roomCode/options-summary`). Pick an appropriate Workers AI instruct model (consistent with existing `@cf/meta/llama-3.x-instruct` usage).

---

## 11. Phase 7 — Mobile, accessibility, verification
- Mobile pass on `/floor-plan` and `/rooms/[slug]` at 375/768/1024px.
- Keyboard + screen-reader for new modals/toggles/tabs; dialogs trap focus; stat cards are buttons/links.
- All dialogs = shadcn `Dialog`/`AlertDialog` (no `window.alert/confirm`).
- Errors routed through the global `ErrorLogger`.
- Verify with Chrome DevTools MCP against the deployed preview (the user is on the live worker URL).

---

## 12. Sequencing & dependencies
```
Phase 0 (data + coord schema)  ── unblocks ──> Phase 2 (floorplan) & Phase 3 (viewport)
Phase 1 (Select fix)           ── independent, do early (used by hero modal)
Phase 5 (task API)             ── precedes ──> Phase 3.2 Task Progress stat & 3.5 budget table
Phase 6 (AI helpers)           ── precedes ──> Phase 3.4 options summary, 3.8 doc AI summary/improve
Phase 2, 3, 4 frontend         ── after Phase 0 + (5,6) ready
Phase 7                        ── last
```
Recommended order: **0 → 1 → 5 → 6 → (2 ∥ 3 ∥ 4) → 7**. Phase 0 ships the user-visible fix earliest.

## 13. Migrations & deploy
- Schema migrations: `pnpm run db:generate` then `pnpm run migrate:remote` (per project scripts). **Do not** hand-edit generated SQL.
- Data-fix script: idempotent `.sql` (or TS) run via `npx wrangler d1 execute DB --remote --file=scripts/0005-reconcile-rooms.sql`. **Back up first**: `wrangler d1 export DB --remote --output=backup-pre-0005.sql`. Wrap in a transaction; make each statement re-runnable (guard with `WHERE EXISTS`/`room_code` checks).
- Per memory: the project's `pnpm run deploy` journal is unreliable — apply migrations manually, verify, then `wrangler deploy`. Confirm current deploy convention before shipping.

## 14. Risks
- **R-1 Destructive merges.** Deleting rooms/photos is irreversible. Mitigate: full D1 export backup; transaction; verify counts before/after (post-merge listing+inspiration totals must equal pre-merge totals minus the 2 intentionally-deleted duplicates); soft-stage by re-pointing FKs *before* any DELETE.
- **R-2 Cloudflare Images orphans.** Deleting the 2 duplicate images must remove both the D1 row and the CF Images asset (use existing `DELETE /api/images/:id`).
- **R-3 Drift recurrence.** Confirm/patch the path that created snake_case rooms (Section 4.3).
- **R-4 Coordinate confirm.** `upper-dining-room` is now user-specified at `(84, 62)`; the other intentionally-moved dots (`upper-kitchen` left to 65, `upper-hall-bath` up to 32, office swap U3/U4) still warrant a quick visual confirm pass after P0. Low risk.
- **R-5 Monolith file split.** `RoomViewApp.tsx`/`FloorplanGalleryApp.tsx` must be decomposed (cloudflare-jedi <1000-line rule) — do the split as part of the work, not after.

## 15. Acceptance criteria (high level)
- `/floor-plan`: every placed room shows a dot for **both** levels at once; hover shows the room card; click pins it; "View Room" navigates; sidebar level **switch** toggles only the room list (no reload, dots unchanged); Inspiration Highlights + Room Launch Board gone; works at 375px.
- The user's downstairs **family room** and **guest bedroom** photos appear (post-reconciliation counts non-zero on the correct rooms).
- `/rooms/[slug]`: hero small top-right + working change-hero modal; Select shows names not ids (globally); stat cards live + clickable; overview full-width + edit-in-modal; room options 👍-or-tabbed; budget signals full-width paginated/searchable table (live); media in modal (gallery/masonry/list, no bento); reusable sticky TOC; supporting-materials table + full upload flow with AI description, progress, error/retry; mobile-clean.
- No mock data anywhere; no `window.alert/confirm`; dark Monolith theme; new endpoints in `/openapi.json`.
