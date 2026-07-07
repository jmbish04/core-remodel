# Photo Edit Sessions — Complete UX Overhaul

The current Photo Edit Sessions page has a broken user journey: it stages edits without auto-processing, exposes raw Workers AI / file upload plumbing to the user, doesn't leverage blank canvas photos, doesn't pre-fill room type from the selected photo, treats the 4 edit categories (furniture, style, wall changes, stitch) as single-select, and has no custom per-category prompt flow or inspiration picker for stitching.

## User Review Required

> [!IMPORTANT]
> **Blank canvas as source:** When a selected listing photo has a `blankCanvasCfImageId`, the editor should automatically offer to use the blank canvas version as the source image for the AI edit (instead of the furnished listing photo). This gives Gemini a cleaner slate for furniture staging, paint visualisation, etc. The user can toggle back to the original photo if they prefer.

> [!IMPORTANT]
> **Multi-select edit categories → step-by-step per-category:** The wizard step 2 currently only allows picking ONE of `layout | paint | staging | inspiration`. The new flow lets the user check multiple, then walks them through each selected category one at a time with a custom prompt area and category-specific UI (e.g. inspiration stitch gets a dropzone + inspiration picker). On final submit, the system queues all edits and auto-processes them back to back.

> [!WARNING]
> **Auto-process on submit:** Currently the revision form says "Upload Revision" or "Generate with Workers AI" — confusing the user about what happens. The new flow fires Gemini immediately on submit with no staging step. The old "Optional Output Upload" dropzone will be removed from the main revision form (it only makes sense for the stitch category, where it becomes the inspo upload).

## Open Questions

> [!IMPORTANT]
> **Should each selected category produce a separate session, or separate revisions within a single session?** My recommendation: separate *revisions* in one session, so the user sees the full progression of a room in one timeline. Let me know if you'd prefer separate sessions per category.

> [!IMPORTANT]
> **For the "inspiration stitch" step — when the user picks from existing inspo photos, should we show ALL inspiration photos or filter to the room?** I'll default to filtering by room (same roomType or roomLabels overlap), with a "Show all" toggle.

## Proposed Changes

### Photo Edit Sessions Frontend

#### [MODIFY] [PhotoEditSessionsApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/PhotoEditSessionsApp.tsx)

**1. Use blank canvas photo as default source**
- When a selected listing photo has `listingPhoto.blankCanvasCfImageId`, add a toggle: "Use blank canvas (recommended)" ↔ "Use original photo"
- Default to blank canvas ON
- Show side-by-side preview: original vs blank canvas so user understands the difference
- The source image ID sent to the revision endpoint will be the blank canvas CF image, not the original listing photo

**2. Auto-fill room override from photo metadata**
- When a source photo is selected in the wizard (step 1), resolve the room name from:
  1. `listingPhoto.roomName` (most specific)
  2. catalog room lookup via `roomId`
  3. `roomType` fallback
- Pre-fill `newSessionRoomType` and `roomType` from this, skip the manual text input
- Change the "Room Override" input to a dropdown of catalog rooms with the detected room pre-selected

**3. Multi-select edit categories (wizard step 2)**
- Replace the single-select radio-style cards with checkbox-style multi-select cards
- Track as `sessionWizardEditTypes: Set<string>` instead of `sessionWizardEditType: string`
- At least one category must be selected to proceed

**4. Per-category prompt walkthrough (new wizard step 3, replaces old step 3)**
- After selecting categories, the wizard shows a sub-step for each selected category, one at a time
- Each category gets:
  - **Wall Layout Change:** Pre-filled prompt template for structural changes + mask editor (same `InlineMaskEditor` from blank canvas)
  - **Paint Color Visuals:** Pre-filled prompt template for paint + color picker (optional hex input)
  - **Staging / Furniture:** Pre-filled prompt template for furniture staging + style selection
  - **Inspirational Stitching:** File upload dropzone for fresh inspo OR a grid picker showing existing `inspirational` photos (filtered to room), with a "Show all" toggle
- Each sub-step has its own prompt textarea pre-filled with a smart default

**5. Session creation + auto-process**
- Old step 3 (confirm session) becomes step 4 (summary + create)
- On submit, the system:
  1. Creates the session
  2. For each selected category, fires a revision request to `/api/photo-edits/sessions/:id/revisions` immediately
  3. Shows a progress indicator per category (spinner → checkmark → error)
  4. No more "Upload Revision" / "Generate with Workers AI" split button — it just processes
- Remove the "Optional Output Upload" dropzone from the main revision area
- The revision form after session creation becomes a simple "prompt + generate" with the InlineMaskEditor

**6. Use same InlineMaskEditor as blank canvas**
- Already imported but under-utilized — surface it more prominently in the per-category steps where masking is relevant (wall layout, paint, staging)
- Show the blank canvas image (when available) inside the mask editor, not the original furnished photo

---

### Photo Edit Sessions Backend

#### [MODIFY] [photo-edits.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/photo-edits.ts)

**1. Accept `blankCanvasImageId` in revision creation**
- Add optional `blankCanvasImageId` field to the revision creation endpoint
- When present, resolve and use the blank canvas image as the source for Gemini instead of the regular source image
- Store in revision metadata so we know which base was used

**2. Batch revision endpoint (optional optimization)**
- Add `POST /api/photo-edits/sessions/:sessionId/revisions/batch` that accepts an array of revision specs (one per category)
- Processes them sequentially and returns results as they complete
- Falls back to the existing per-revision endpoint if the client prefers to fire them individually

**3. Clean up legacy Stable Diffusion references**
- The endpoint still has `model = "@cf/runwayml/stable-diffusion-v1-5-img2img"` as default, `strength`, `numSteps`, `guidance` params — these are dead code since the switch to Gemini 3 Pro. Remove them to avoid confusion.

---

### Source Image Fetching

#### [MODIFY] [photo-edits.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/photo-edits.ts) (sessions endpoint)

- When returning source images for sessions, also include `blankCanvasCfImageId` from the linked listing photo record so the frontend can display the toggle

---

## Verification Plan

### Manual Verification
1. Open Photo Edits, click "New Edit Session"
2. Select a listing photo that has a blank canvas → verify blank canvas toggle appears and is ON by default
3. Verify room override is pre-filled from the photo's room assignment
4. Select multiple edit categories (e.g. "Wall Layout" + "Staging") → verify multi-select works
5. Step through per-category prompts → verify each has its own prompt area and the stitch category shows the inspo picker
6. Submit → verify all revisions process automatically with no manual "Upload" step
7. Verify revisions appear in the timeline with correct before/after
