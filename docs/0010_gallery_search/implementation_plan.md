# Implementation Plan — Gallery Search, Saved Searches & Gemini Canvas Editor Refinements

This plan integrates all requests:
1. **Inspiration Gallery Search & Saved Searches**: Semantic/keyword filters, multi-select dropdowns, grouping, and stored searches.
2. **Gemini Blank Canvas Upgrades**: Dynamic prompt rules (ceiling lights, plumbing outline checkbox) and a post-generation review step featuring Tiptap rich-text editing, HTML5 canvas masking, and interactive refinement loops.
3. **Multiple Blank Canvases Support**: Storing multiple blank canvases per listing photo in the database, allowing users to view all versions, select the active primary, upload additional canvases, delete versions, or generate fresh ones.
4. **Blank Canvas Floor/Tab Order & Navigation**:
   - Order the tabs so the **Lower Level** is placed and opened first by default.
   - Sync the active tab key to the `tab` URL query parameter, enabling direct bookmarking, refreshing, and navigation to specific levels or the "excluded" panel.

---

## Proposed Changes

### 1. Database Schema & Migrations

#### [MODIFY] [listing_photos.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/images/listing_photos.ts)
Added and exported the `listingPhotoBlankCanvases` table:
- `id` (integer PK autoincrement)
- `listingPhotoId` (integer FK referencing listingPhotos.id, cascade delete)
- `cfImageId` (text)
- `prompt` (text, records generation or upload context)
- `datetimeCreated` (timestamp)

#### [NEW] [0057_clever_blonde_phantom.sql](file:///Volumes/Projects/workers/core-remodel/drizzle/0057_clever_blonde_phantom.sql)
Migration to create `listing_photo_blank_canvases` table.

---

### 2. Backend API Routes

#### [MODIFY] [images.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/images.ts)
- `POST /api/images/inspiration-search` -> Performs unified vector + keyword + tag + room search, returning enriched listing records.
- Stored searches: `GET`, `POST`, `DELETE` routes for `/api/images/saved-searches`.

#### [MODIFY] [blank-canvas-generator.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/services/render/blank-canvas-generator.ts)
- Dynamically build system prompt with `buildBlankCanvasPrompt(options?: { leaveOutline?: boolean })`.
- Instruct Gemini to remove cabinets, countertops, vanities, and all lighting/ceiling fixtures.
- Add `maskBase64` and `promptOverride` options in `generateBlankCanvas`.

#### [MODIFY] [listing-photos.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/listing-photos.ts)
- `POST /api/listing-photos/:id/blank-canvas`: Modified to batch update `blankCanvasCfImageId` on the listing photo and insert the canvas record to `listingPhotoBlankCanvases`.
- `POST /api/listing-photos/:id/accept-blank-canvas`: Batch updates primary and saves refinement version.
- `GET /api/listing-photos/:id/blank-canvases`: Retrieve all blank canvas versions (including legacy/primary ones) for a listing photo.
- `DELETE /api/listing-photos/:id/blank-canvases/:canvasId`: Delete a specific version. If the deleted version was the active primary pointer, automatically promote the next newest version or clear it.
- `POST /api/listing-photos/:id/set-primary-blank-canvas`: Make a specific version the active primary blank canvas.

---

### 3. Frontend UI Upgrades

#### [MODIFY] [PhotoCollectionApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/photo-collection/PhotoCollectionApp.tsx)
- Unified search panel at the top of the Inspiration Gallery with text input, tags filter, rooms filter, and saved search quick-loading.

#### [MODIFY] [BlankCanvasAdminApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/BlankCanvasAdminApp.tsx)
- **Inline Photo Version Rail**:
  - Display all existing blank canvases for the selected image/room.
  - Render small thumbnail buttons for each blank canvas. Selecting a thumbnail updates the active preview.
  - Buttons next to each canvas version: **Make Primary** (star/highlight icon), and **Delete Version** (trash icon).
- **Refinement Actions**:
  - Allow uploading/adding additional canvases manually.
  - Click **Generate New** to trigger a modal refinement with:
    - Target base select (Start fresh vs. Revise last edit).
    - `MaskConfigurator` canvas.
    - Kibo TipTap editor with a suggested prompt button.
    - Plumbing outline checkbox.
    - Accepting the refinement saves it as a new version.
- **Floor Tab Ordering & URL Sync**:
  - Added a floor key sorting helper (`lower_level` -> `main_level` -> `upper_level` -> `unassigned` -> `excluded`) to make the **Lower Level** tab display first.
  - Read `tab` parameter from query string on mount/tabs sync.
  - Added `handleTabChange` to write selected tabs to the URL using `window.history.replaceState`.

---

## Verification Plan

### Automated Checks
- `pnpm run build` and `npx tsc --noEmit` to ensure type-safety.

### Manual Walkthrough
1. **Gallery Search**: Search "cabinets", verify rooms filter, tag selection, and layout. Save search as "Modern Kitchen", reload page, select "Modern Kitchen" to verify filters.
2. **Floor Tabs Order & URL Sync**: Open `/admin/blank-canvas`. Verify that the **Lower Level** tab is selected first and that the URL has `?tab=lower_level`. Click the **Excluded** tab; verify the URL shifts to `?tab=excluded`. Refresh the page; verify it re-opens on the **Excluded** tab.
3. **Refine / Inpaint**: Open the generated result. Select "Refine", draw a mask over a missed ceiling fixture, fill the Kibo editor with the suggested prompt, add "remove this light", run refinement, and click Accept.
