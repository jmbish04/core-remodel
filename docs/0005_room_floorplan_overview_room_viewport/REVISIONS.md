# 0005 — Revision R1 (post-review feedback)

Captured after the user reviewed the live site (which still runs OLD code + un-reconciled data — nothing from 0005 was deployed yet). These supersede/refine the original plan.

## Corrections to existing plan

### C1 — Room merge = SOFT delete (isActive=false), not hard delete
- Add an `is_active` (boolean, default true) column to `rooms`.
- Reconciliation: move ALL photos (listing + inspiration) + all FK rows from the source/ghost room into the single canonical room, THEN set the source room `is_active = false` (do NOT `DELETE`).
- Invariant: an `is_active = false` room must have **zero** photos (listing or inspiration) — everything moved to the active canonical room first.
- Example: merge `lower-patio` + `lower-rear-patio` → `outside-patio`; mark both `lower-patio` and `lower-rear-patio` `is_active = false` with no photos remaining on them.
- All room listings (catalog, floorplan dots, sidebar, pickers) filter to `is_active = true`.

### C2 — ONE source of truth for room IDs (critical)
- There is exactly one canonical, active room set. Listing photos AND inspiration photos may only be associated with rooms in that set.
- Root-cause + STOP the path that creates/uses snake_case "ghost" rooms. Inspiration mapping is currently associating photos to ghost room records — this must be impossible.
- Upload + mapping (`/api/images/upload`, `/api/images/mapping/apply`, photo-edits, any agent path) must resolve to an existing canonical active room or reject — never create a room from a free-text name.

### C3 — Hero image is NEVER an inspiration photo
- Hero = a **listing** photo only (representative listing image, else first listing image).
- If a room has **0 listing photos**, show a **placeholder default image** — do NOT fall back to an inspiration photo.
- Fix the catalog `heroImageUrl` fallback chain (currently representative → listing → **inspiration** → null) to: representative-listing → first-listing → **null/placeholder** (drop the inspiration step). Apply the same rule in HeroHeader and the floorplan dot card.

## New feature — Inspiration photo SCOPE (room / level / home) + categorization

**Problem:** inspiration photos mapped to an entire level (e.g., hardwood flooring → all of upper level) or all levels (e.g., interior doors → whole home) currently (a) get used as hero images, and (b) flood every room's inspiration view with repetitive images (5 interior-door photos drown out a room's 1–2 direct inspo photos).

**Requirements:**
1. **Scope** each inspiration photo: `room` | `level` | `home`.
   - `room` → tied to a specific canonical room (today's per-room mapping).
   - `level` → applies to every room on a floor (e.g., upper-level flooring).
   - `home` → applies to all rooms (e.g., interior doors).
2. **Segregate in per-room inspiration views:** show the room's direct (`room`-scoped) inspiration prominently. Put `level`/`home`-scoped photos in a **collapsible appendix, hidden by default**, at the bottom, clearly labeled "Applies to the whole level / whole home." (Rationale: a room's direct inspo may conflict with a level/home-wide selection — both must be visible but distinguished.)
3. **Dedicated level/home inspiration viewer**, grouping these broad-scope photos into **categories** that naturally apply level/home-wide: Interior Doors, Lighting, Light Switches, Drywall Finishes, Flooring, Paint Colors, etc. (extensible list).
4. Broad-scope (`level`/`home`) inspiration must **not** count toward a room's "inspiration photo" badge in a way that overcrowds, and must never be a hero candidate (already covered by C3).

**Open design decisions (see questions to user):**
- How is `scope` recorded at upload/mapping time vs. how the user "associates with a level/home" today (which creates ghost rooms).
- How is `category` assigned — AI auto-classify, manual, or AI-suggest+confirm.

## Refined design (after code investigation)

### Floors & scope buckets (confirmed)
Floors: `lower_level`, `upper_level`, `outside`, `all_levels`. The uploads page lets the user drag a photo into **Entire Floor (Lower/Upper/Outside)** or **Entire Home (All Levels)**.

### Root cause of inspiration crowding
`UploadsMappingPanel` currently **expands** an "Entire Floor/Home" drop into one `inspirational_image_rooms` row per room (`roomIds = all rooms on floor` / `all rooms`). So a single interior-door photo dropped on "All Levels" becomes N per-room rows → it shows in every room's inspiration view. **Fix: store the scope, don't fan out.**

### Scope storage (design)
Add to `images` (inspiration photos): `inspiration_scope` enum `room | level | home` (default `room`), `scope_floor_id` (FK floors, set when scope=`level`), `inspiration_category` (text, nullable — assigned later on `/review`).
- `room` scope → keep using `inspirational_image_rooms` (multi-room allowed).
- `level` scope → `scope_floor_id` only (no per-room rows).
- `home` scope → scope=`home` (no per-room rows).
Per-room inspiration view query = room-scoped (this room) + level-scoped (this room's floor) + home-scoped; the latter two render in a **collapsed "Applies to whole level/home" appendix**.

### Category assignment = on /review (per user)
At upload the user only sets **scope** (the drag buckets). **Categorization** (Interior Doors, Lighting, Light Switches, Drywall Finishes, Flooring, Paint Colors, …) happens on the **`/review` page** (`src/frontend/pages/review.astro` + `PhotoReviewApp.tsx`), where level/home-scoped photos get special handling: AI-suggest a category, user confirms; group the level/home viewer by category.

### Ghost rooms = data drift, not created by current code
Only the seed inserts rooms (canonical names). The snake_case ghosts are pre-existing drift. C2 prevention = reconcile them (merge→`is_active=false`) + filter **all** room lists/pickers/catalog to `is_active=true`, so inspiration can never be mapped to them again.

### Reconciliation updates
- Soft-delete (`is_active=false`) instead of `DELETE`; ensure 0 photos remain on inactive rooms.
- Convert existing fan-out inspiration into scope: a photo on all rooms of one floor → `level` (scope_floor_id); on all rooms → `home`; then delete the redundant per-room rows.

## C4 — Reusable RoomSelect dropdown (global)
Every room-selection dropdown app-wide (moodboards, uploads/mapping, room-view hero + move, supporting docs, bid portfolios, etc.) must use one reusable `RoomSelect`:
1. **No room selected by default** (no auto-select; placeholder like "Select a room (optional)").
2. **Shows the room display name** in the trigger — never the DB id (the moodboards dropdown currently auto-selects ghost room `2330295` and shows the raw id).
3. **Grouped by floor level** (Lower / Upper / Outside), **alphabetical within each floor**, with a **search** box.
4. **Active rooms only** (`is_active = true`).
Build on the project's existing `@base-ui/react` Select stack (reuse the already-fixed `SelectValue` label resolution + a search field + floor-grouped sections) — do NOT add `react-aria-components`. Reference UX provided by user: grouped sections + autocomplete/search.

## Sequencing note
- User chose **"everything, then deploy"** — build C1–C3 + the full inspiration-scope feature (upload scope storage, per-room appendix, /review categorization, level/home viewer), then deploy + run the updated (soft-delete) reconciliation once.
- Reconciliation has NOT been run; it must be updated for C1 + scope conversion before running.
