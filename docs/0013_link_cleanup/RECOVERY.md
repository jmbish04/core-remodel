# RECOVERY — Lost / uncommitted work (Workstream W0)

Several features are **uncommitted** in the `room-floorplan-overview-and-room-viewport-changes` checkout (`/Volumes/Projects/workers/core-remodel`, currently 45 commits behind `main`, ~80 dirty files). Never committed to any branch, not in prod. This is the same uncommitted-drift pattern that "lost" the blank-canvas work — the source is **right there**, it just needs a careful merge.

> ⚠️ **Delicate 3-way merge.** Several dirty files overlap the exact files rewritten + deployed on `serene-pike` (the route reorg): `_worker.ts`, `AppSidebar.tsx`, `showroom-stores.ts`, `api/index.ts`, `ShowroomsDirectoryApp.tsx`. Recover per-file against the current base — **not** a cherry-pick or `git checkout`.

## Inventory (from `git status` in the room-floorplan checkout)

### Blank-canvas suite (the flagged loss) — `recover`
- `src/frontend/components/BlankCanvasAdminApp.tsx` (modified)
- `src/backend/services/render/blank-canvas-generator.ts` (modified)
- `src/backend/services/image-processor/inline-editor.ts` (modified)
- `src/frontend/components/ui/InlineMaskEditor.tsx` (untracked)
- `src/frontend/pages/admin/blank-canvas/` (untracked dir — the missing sub-routes: upload / generate / exclusions / floor / room)
- Lost behaviors to restore: bulk **exclude** photos from rendering; room↔blank **pairing wizard** (dropzone → map blanks to rooms); **generate wizard** (masking + prefilled prompt → Gemini blank → iterate → accept); floor/room tabs; **exclusions** view (list excluded, un-exclude).

### Unmerged features — `recover` (each → its own plan)
- **ClickUp** (plan 0009): `src/backend/api/routes/clickup.ts`, `src/backend/services/clickup-client.ts`, `src/frontend/components/clickup/`, `src/backend/db/schema/scrum/`, `src/frontend/pages/admin/tasks.astro`.
- **Admin Chat / Orchestrator**: `src/backend/ai/agents/AdminChatAgent/`, `src/backend/ai/agents/RemodelOrchestrator/`, `src/frontend/components/AdminChatPanel.tsx`.
- **Saved image searches** (plan 0010): `src/backend/db/schema/images/saved_image_searches.ts`.
- Also dirty: `routes/{images,listing-photos,photo-edits}.ts`, `schema/images/listing_photos.ts`, `PhotoEditSessionsApp.tsx`, `UniversalUploadApp.tsx`, `AdminDashboardApp.tsx`, `secrets.ts`, `wrangler.jsonc`, `worker-configuration.d.ts`, `ResearchAgent/index.ts`, `.agents/*`, SketchUp/python assets.

### Migrations — `investigate` (do NOT blind-apply)
- `drizzle/0055_normal_stone_men.sql` … `0058_thin_franklin_storm.sql` (+ snapshots) are uncommitted, but `main`/serene-pike are already at **0066**. They're almost certainly renumbered/superseded. Diff the intended schema against the applied D1 schema (`drizzle-kit`); recreate as a fresh migration if anything is genuinely missing.

## Restore procedure (recommended)
1. From the current base (serene-pike/main), branch `rescue/uncommitted-room-floorplan`.
2. For **non-overlapping** untracked files (blank-canvas pages, InlineMaskEditor, clickup/*, AdminChatAgent, saved_image_searches): copy in, then `tsc`/build to surface missing deps/schema.
3. For **overlapping** modified files: 3-way merge by hand (diff room-floorplan's version vs the committed base vs current) — keep the reorg changes, re-apply the lost logic.
4. Reconcile migrations (investigate) → regenerate cleanly if needed.
5. Build + deploy; verify each recovered surface.

Tracked as tasks `W0-01…W0-06` on `/admin/plans/0013_link_cleanup`.
