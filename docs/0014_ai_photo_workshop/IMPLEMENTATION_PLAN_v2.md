# Design Workshop — Bring Every Nano-Banana Spatial-Design Use Case into core-remodel

## Context

**Why this work:** The repo [`qzh3722/awesome-nano-banana-spatial-design`](https://github.com/qzh3722/awesome-nano-banana-spatial-design) catalogs ~24 battle-tested prompt recipes for turning any spatial-design artifact (CAD floor plans, elevations, sketches, clay/SketchUp models, listing photos, inspiration images) into photorealistic, structure-faithful renders — organized as a 6-stage workflow (Concept Ideation → Space Planning → Technical-to-Visual → Material & Styling → Scene Rendering → Documentation).

`core-remodel` already has a **production-grade staged render pipeline** (`docs/0004_ai_image_editing`) that independently converged on the same core idea: edit the *real* image, never hallucinate architecture, cache a state-tree of stages, branch cheaply. It covers roughly **5 of the ~24 nano-banana recipes** (auto-furnish empty room, material replacement, style transfer/synthesis, furniture swap, day↔night). The other ~15 recipes — the ones that consume **floor plans, elevations, sketches, and SketchUp clay renders**, plus the post-production and documentation recipes — are not yet wired, even though the app *already stores all those input image types*.

**Intended outcome:** (1) Extend the existing pipeline into a complete **Recipe Library** covering every applicable nano-banana use case, reusing the `StageProvider` / model-registry / `prompt-kit` / `render_canvases` state-tree machinery that already exists. (2) Wrap it in a single **"Design Workshop"** surface — an inspirational, low-friction studio where Justin picks a room, drops in any artifact (photo, floor plan, sketch, SketchUp render, inspiration), and applies powerful recipes to realize a vision. The centerpiece deliverable is an **extensive design brief (§7)** ready to hand to Claude/Stitch to build that UI.

---

## What already exists (reuse — do not rebuild)

**Backend pipeline** (`src/backend/services/render/`):
- `prompt-kit.ts` — `buildStagePrompt()`, the `PRESERVATION_BLOCK` anti-hallucination guardrail, `referenceScopingNote()` (material/form-only reference scoping), `nearestAspectRatio()`.
- `model-registry.ts` — per-stage `{provider, model}` defaults (Gemini 3 Pro Image) + gateway-native alternates (`fal-ai/nano-banana-pro/edit`, `flux-pro/kontext`, `flux-2-pro/edit`, `flux-depth-pro`, `flux-kontext-max`, `fast-sdxl`).
- `stage-provider.ts` + `providers/{gemini,fal,replicate}-stage-provider.ts`, `stage-runner.ts`, `failover.ts`, `provider-factory.ts`, `cf-images.ts` (Cloudflare Images upload + transform crop — **no sharp**), `mood-board.ts`.
- `types.ts` — `StageType`, `StageInput` (supports `maskUrl`, ordered `imageUrls[]` for `@image{n}` multi-image synthesis, `references[]`), `LightingProfile`.
- `image-processor/` — staging, `auto-heal.ts`, `deduplication.ts`, batch workflow, the wave-of-3 throttle (`test:throttle`), `inline-editor.ts` (Gemini `gemini-3-pro-image-preview`).

**DB schema** (`src/backend/db/schema/images/`): `render_sessions`, `render_canvases` (stage-typed state-tree nodes w/ `parentCanvasId`, `listingPhotoId`, `lightingProfile`), `canvas_inspiration_references` (bbox + `referenceIndex`), `listing_photos` (`blankCanvasCfImageId` = the "blank AI canvas"), `inspirational_image_rooms`, `image_edit_sessions/revisions`, `mood_boards/mood_board_generations`, `image_upload_staging`, `image_reviews/highlights/tags`.

**API routes** (`src/backend/api/routes/`): `render.ts` (`POST /sessions`, `/stage`, `/branch`, `GET /canvases/:id`, `/realtime`), `photo-edits.ts`, `listing-photos.ts`, `images.ts`, `photo-reviews.ts`, `mood-board.ts`, `vision-nodes.ts`.

**Frontend** (`src/frontend/`): the **Renovation Studio** at `pages/builder.astro` → `components/render/StudioBuilder.tsx` (+ `AngleGallery`, `StageExplorer`, `BranchNavigator`, `MaskConfigurator`, `InspirationCanvas`, `DesignConfigPanel`, `InspoSortWorkspace`, `PipelineStatusLoader`, live WebSocket status). Plus `pages/floor-plan.astro`, `inspiration-photos.astro`, `listing-photos.astro`, `moodboards.astro`, `photo-edits.astro`, `rooms/[slug].astro`, `rooms/closets.astro`.

**Non-negotiable constraints** (from `docs/0004/PROMPT.md`, still apply): no `sharp`/libvips (crop via CF Images transforms); D1 has no interactive txns (use `db.batch`); pin `image_config {aspect_ratio,image_size}` per source dims; always edit the real image; pass CF Images URLs not base64; route every model call through **AI Gateway** via the registry; use `crypto.randomUUID()`.

---

## Recipe coverage map (nano-banana → core-remodel)

Legend: ✅ built · 🟡 partial · 🔶 **new recipe to add** · ⬜ out of scope (residential single-home)

| Nano-banana recipe | Input(s) | Status | core-remodel home |
|---|---|---|---|
| 4.4 Declutter / empty room | 1 listing photo | ✅ | `listing_photos.blankCanvasCfImageId` prep |
| 4.5 Auto-furnish empty room | 1 blank canvas | ✅ | `stage_1_LP_base`→`rough_in`→`finish` |
| 4.1 Material replacement | swatch + scene | ✅ | `references[]` + `referenceScopingNote` |
| 4.2 Style transfer | style ref + room | ✅ | `stage_5_LP_synthesis` |
| 4.3 Furniture replacement | product photo + room | 🟡 | interaction/micro-branch — formalize as recipe |
| 5.4 Day → night | 1 render | ✅ | `lightingProfile: night` |
| 5.2 Lighting enhancement | 1 render | 🟡 | extend beyond day/night preset |
| **5.1 Clay model → photorealistic** | 1 clay/SketchUp render (+opt style ref) | 🔶 | **top priority** — consume `base_colby` SketchUp renders |
| **1.1 Auto-furnish floor plan** | 1 CAD floor plan | 🔶 | furnish a floor plan, structure-locked |
| **1.6 CAD layout planning** | 1 as-built plan | 🔶 | add partition walls + program |
| **2.1 Colored floor plan (+JSON meta-prompt)** | 1 CAD plan | 🔶 | photoreal top-down + room-count JSON generator |
| **3.1 2D plan → isometric** | 1 floor plan | 🔶 | dollhouse/isometric view |
| **3.3 Elevation → render** | 1 CAD elevation | 🔶 | cabinet/wall elevations → photoreal |
| **1.5 Sketch → photorealistic** | 1 hand sketch | 🔶 | whiteboard/napkin → render |
| **3.2 Cabinet/closet interior reveal** | 1 closed-cabinet photo | 🔶 | ties to `rooms/closets`, showroom closet research |
| **5.3 Tone unification** | 1 render | 🔶 | white-balance/Kelvin post-production |
| **1.4 Generative evolution grid** | 1 image | 🔶 | 2×2 design-evolution storyboard |
| **6.1 Soft-furnishing extraction → catalog board** | 1 render | 🔶 | procurement bridge → `mood_boards` / showroom products |
| 1.3 Miniature model (delight) | 1 exterior photo | 🔶(low) | shareable novelty |
| 1.2 Text-only build · 2.2–2.5 site/urban/office | — | ⬜ | not applicable to a single residence |

**Cross-cutting capability to add:** the nano-banana repo's **meta-prompt JSON generator** pattern (used by 2.1 colored plan, 3.3 elevation, 5.2 lighting, 5.3 tone) — an AI pre-pass that analyzes the input image and emits a structured JSON spec (room counts, fixtures, light sources, Kelvin targets) that then drives the render prompt. Our `prompt-kit` composes prompts by hand today; adding a `meta-prompt` pre-pass makes the structure-heavy recipes reliable.

---

## Positioning — the Workshop lives inside the `/admin/design/*` suite (updated 2026-07-04)

A route audit clarified the target IA. The Workshop is **not** a standalone root page; it is the render engine at the center of a design pipeline, at **`/admin/design/workshop`** (the front door to the nano-banana recipes). It reuses machinery from its siblings and hands off to them — so the plan must build shared primitives once, not per-surface.

**The design pipeline (upstream → downstream):**

1. **Prepare** (`/admin/prepare/*`) — feeds the Workshop:
   - `/admin/prepare/blank-canvas/*` — pair/upload/**generate** (mask + Gemini "blank a listing photo" flow) / floor+room filters / exclusions. Produces the `listing_photos.blankCanvasCfImageId` inputs.
   - `/admin/prepare/blank-canvas/angles` (today's `/builder`) — per-room **multi-angle camera registration**: position each blank-canvas photo's camera on the floor-plan (field-of-view) + PlateJS context. This is the **consistency substrate** that lets one edit session render a whole room across angles coherently. The Workshop *consumes* this angle metadata.
   - `/admin/prepare/uploads` — the reusable **bulk upload → stage → metadata/OCR/embeddings/vectorize** pipeline; the ingestion path for inspiration photos.
2. **Workshop** (`/admin/design/workshop`) — apply the nano-banana recipe library to a room's artifacts (this plan's engine).
3. **Mood boards** (`/admin/design/moodboards/*`) — grouped by floor/room (`/floors/[id]`, `/floors/[id]/room/[id]`), created via a **Gemini nano-banana reference flow**: select **≤10 inspiration references** (Gemini's cap), attach **per-reference masking + a PlateJS prompt** telling Gemini what to extract from each, iterate in chat, accept → registered board (with `/[id]/revisions`). Also a bulk-**upload** path for externally-made boards. **This reference flow is the same primitive the Workshop's style/synthesis recipes need — build it once, share it.**
4. **Decision Room** (`/admin/design/decision-room`) — per-room finalization: pick the room's **final mood board** (a board may span rooms), then resolve each room's **material todos** (from the materials D1 records, FK'd to room) by mapping each to either a **`product_id`** (plumbing→plumbing product, paint→brand/color) or a **written description + budget** for non-product decisions (e.g. drywall labor). **This is where nano-banana recipe 6.1 (furnishing/material extraction) lands** — extracted items become selectable options against these material todos, sourced from `/admin/shopping/*` products.
5. **Master Plan** (`/planning/design-master-plan`) — the polished, high-touch final proposal, read from the Decision Room (contractor-facing).

**The materials list is the spine (budget ↔ gaps ↔ products) — and the substrate already exists in D1. The remaining work is WIRING, not new construction.** The room↔product link is *materials-driven*; the materials list is drafted **first** as the organizing artifact the whole design/shopping/budget loop turns around. Existing tables:
- **`material_schedule_items`** — the master materials list (its docstring already declares it the seed that "feeds downstream showroom discovery, product sourcing, gap analysis, and deep research"). Has `roomName` (text), `brand`/`model`, `isPurchased`, soft `purchasedShowroomProductId`.
- **`static_budget_items`** — curated **ballpark cost-range library** (min/avg/max, qty, unit, per floor/area/category) → estimation is a *table lookup the user adjusts*, not a fresh AI model.
- **`budget_tracker_items`** (+ `budget_tracker_item_rooms`, `budget_project_info`, `budget_funding_accounts`, `budget_expense_entries`) — revisioned per-room planning with `estimatedLow/HighCents`, scenarios, and **actual spend**.
- **`budget_variance_scenarios`** (+ variance line items) — layout options with deviation totals.

The loop, mapped to what exists:
1. **Draft materials per room** — populate `material_schedule_items`; ballpark from `static_budget_items` ranges. *(exists)*
2. **Showroom gap analysis** — material *types* vs. registered showrooms; reuse the gap engine (`/admin/showroom/gaps`, `showroom-gaps.ts`, 0008 AI gap-intelligence). *(exists, extend)*
3. **Register products against materials** — resolve each material line to a selected product (or description+budget). *(partial — soft single-product link only)*
4. **Budget reconciliation** — chosen product costs roll up vs. the ballpark, per room/overall via `budget-tracker` / `budget-reconciliation` / `truth-table`. *(exists on the budget side; not auto-fed from materials/products)*

**The three missing links to build (this is the actual work):**
- `material_schedule_items.roomName` → a real **`rooms` FK** (room-scoping is loose text today).
- **A join between materials and the budget tables** (`material_schedule_items` ↔ `static_budget_items` / `budget_tracker_items`) so a material line carries its own ballpark and its reconciled actual — today they run in parallel with no FK.
- **Candidate product selections** with prices (not just one `purchasedShowroomProductId`), so "product picks vs. estimate" is computable per material line.

The Workshop's render outputs and recipe 6.1 extraction **feed this spine** — an extracted/decided furnishing becomes a candidate product on a material line. The Decision Room is where stages 1, 3, 4 are worked; the gap engine surfaces stage 2.

**Shared primitives to build once and reuse across Workshop + Mood boards + Blank-canvas generate:**
- The **reference-image composer**: multi-select (≤10) + per-image mask (`MaskConfigurator`/`InspirationCanvas`) + per-image **PlateJS** prompt context, with a browser-cached selection queue so nothing is lost mid-flow.
- The **iterate-with-Gemini chat loop** (propose → refine → accept), persisting accepted outputs as `render_canvases` / mood-board records.
- **PlateJS (markdown)** as the standard prompt/context editor everywhere a prompt is authored.
- The **room context resolver** (a room's photos, blank canvases, angles, inspiration, materials, related products) — used by the Workshop viewport and the Decision Room alike.

**Entry model:** room selection is via the floor plan (`/floor-plan/floors/[id]/rooms/[id]`); the Workshop opens scoped to that room. Photos live at `/photos/listing` and `/photos/inspiration`.

---

## Build plan

### Build sequence (decided 2026-07-05) — canvas thin-slice first
Lead with a **vertical slice that makes the workstation table real**, then broaden. The slice cuts through every layer so the "feel" is validated before scale:

**Slice 1 — The table works (first PR / swarm):**
- Canvas shell: install `devl.dev` canvas-tools + `avatar`/`slider`/`tooltip`, remap imports, drop the collab bar, Monolith-ize borders → host at `admin/design/workshop.astro` as a `client:only` island.
- **Image nodes** (CF Images URL) rendered via `konva`; seed the board from a chosen room's real artifacts (listing photos, blank canvas, inspiration) via the room context resolver.
- **Persistence**: nodes + position + lineage to D1 (`render_canvases` tree + `board_nodes`), Cloudflare-Images-tracked; come-and-go.
- **Piles v1**: `Layered Stack` + `gsap`, `photo_collections` tables — drag inspiration photos into side-rail stacks, hover to fan out, click a photo → pick a tool. Frictionless (optional naming). The natural first act: sort before you harvest/mix. (See §8 for stack/drawer components.)
- **Sample Library v1 (the "drawer")**: extract-a-clipping (`InspirationCanvas` bbox + `stage_0_IP_extraction` + CF Images crop) → saved reusable node in a drawer; surface it with the §8 drawer/inventory components.
- **3 core recipes as node actions**: `extract` (harvest clipping), `material-swap` (finish on a node), `mix` (`stage_5` synthesis of a base node + ≤N clippings) — proving harvest → mix → iterate, each output a child node with an edge (revision lineage) and live status via the realtime socket. Render waits use a §8 ambient animation (tamed to Monolith), never a spinner.

**Slice 2+ — fan out:** the remaining ~12 recipes (Phases A–C below) as parallel node-actions; then the materials/decision-room/master-plan handoff (Phase D) as the quiet output.

### Phase A — Recipe abstraction (backend core)
Generalize `prompt-kit.ts` into a **recipe registry** (`src/backend/services/render/recipes/`). A **Recipe** = `{ id, category, label, inputSpec (which artifact types + how many + whether a mask/refs are allowed), promptBuilder, metaPrompt? (optional AI pre-pass), defaultStageType, defaultModelKey, outputAspectPolicy }`. Each recipe reuses `buildStagePrompt` + `PRESERVATION_BLOCK` where structure-lock applies, and drops it where it doesn't (e.g. clay→photoreal preserves *geometry* not *materials*; isometric intentionally changes the camera). Ship the guardrail variants as named blocks: `GEOMETRY_LOCK`, `CAMERA_LOCK`, `MATERIAL_ONLY_REF`, `PROGRAM_COMPLETE` (every room labeled), `COUNT_LOCK` (from meta-prompt JSON).

- Add the new `StageType`s / recipe ids for the 🔶 rows (floor-plan-furnish, cad-colorize, plan-to-iso, elevation-render, sketch-render, clay-to-photoreal, cabinet-reveal, tone-unify, lighting-enhance, evolution-grid, softgoods-extract, furniture-swap).
- Port verbatim guardrail phrasing from the nano-banana README recipes (geometry lock, "assign every interior area a function", "ignore reference angle/props/lighting", Kelvin ranges 2700–6500K) into the recipe prompt builders.
- Reuse `model-registry` + `failover`; set per-recipe default model (e.g. clay→photoreal and material recipes default Gemini 3 Pro; `nano-banana-pro/edit` as first-class alternate for try-on/material recipes).

### Phase B — Input adapters (feed the recipes)
Recipes need artifacts beyond blank-canvas listing photos. Wire adapters that resolve each input type to a **CF Images delivery URL** (never base64):
- **Floor plans / elevations** — from the floor-plan surface (`pages/floor-plan.astro`, `FloorplanGalleryApp`) and uploaded CAD.
- **SketchUp clay renders** — ingest `base_colby` exports (via supex `view.write_image` / the render outputs under `proofs/` & `r2_resources/`) as a first-class artifact type. This unlocks 5.1 clay→photoreal, the highest-leverage new recipe given the existing SketchUp workflow.
- **Sketches** — accept hand-drawn uploads through the existing `GlobalUploadWidget` / `image_upload_staging` path.
- **Inspiration crops** — already produced by `InspirationCanvas` (bbox → CF Images crop) and `canvas_inspiration_references`.

Add a lightweight `artifactType` discriminator so the Workshop can offer only the recipes valid for the dropped artifact (input-spec gating).

### Phase C — Meta-prompt pre-pass
Add `recipes/meta-prompt.ts`: an LLM pre-pass (Gemini/Workers-AI structured output, Zod v4 schema) that analyzes an input image and returns the JSON spec a structure-heavy recipe consumes (room list + counts for 2.1; light sources for 5.2; measured Kelvin per zone for 5.3). Gated behind the recipes that need it; on-demand, cached on the `render_canvases` node metadata.

### Phase D — Procurement loop (close the vision→buy gap)
Recipe 6.1 (soft-furnishing extraction) outputs a catalog grid; wire its items into the existing **`mood_boards`** + **showroom products** so an extracted piece becomes a shoppable card. This is what turns the workshop from "pretty pictures" into "realize the remodel."

### Phase E — Design Workshop UI (room-first, inside `/admin/design/*`)
Build the surface described in **§7** at **`src/frontend/pages/admin/design/workshop.astro`** (keep `builder.astro` working during migration; it becomes the `/admin/prepare/blank-canvas/angles` prep step). The entry is **floor-plan-first**: click a room (`/floor-plan/floors/[id]/rooms/[id]`) → a **room-scoped Workshop viewport** aggregating everything tied to that room. Reuse the floor-plan room selector (`InteractiveFloorPlan.tsx`, `floorplan/FloorplanDot.tsx`, `floorplan/RoomHoverCard.tsx`, `floorplan/LevelSidebar.tsx`, `LevelRoomSelect.tsx`) and the studio internals (`StudioBuilder` realtime socket, `StageExplorer`, `BranchNavigator`, `MaskConfigurator`, `InspirationCanvas`, `PipelineStatusLoader`).

**Build the shared primitives first** (§ Positioning) — the reference-image composer (≤10 refs + per-ref mask + PlateJS prompt, browser-cached queue), the iterate-with-Gemini loop, and the room context resolver — because Mood Boards and Blank-canvas-generate depend on the same code. The Workshop's style-transfer/synthesis recipes and the `/admin/design/moodboards/new` flow are the *same* composer with different output targets.

**Decisions locked (2026-07-04):** build **all ~15 recipes in one sweep** (parallel `/swarm`); the Workshop is `/admin/design/workshop` within the design suite (not a root page); procurement is **not** an auto buy-list — extracted furnishings/materials surface as **selectable options against the room's material todos in the Decision Room** (`/admin/design/decision-room`), each mapping to a `product_id` (from `/admin/shopping/*`) or a description+budget.

**Room→context aggregation (shared resolver):** for a `roomId`, pull listing photos + blank canvases (`listing_photos.roomId`), **angle registration** metadata, inspiration (`inspirational_image_rooms`), prior renders/branches (`render_canvases.roomId`), room **materials** (materials D1, FK'd to room), and related products. Products currently map to *showrooms* not rooms (`showroom/product_mappings.ts`), so add a room↔product/material association (room category → product-area/material tags) to make "products that relate to this room" real. This resolver is reused by the Decision Room.

---

## Front door: the Workstation canvas (updated 2026-07-05)

**North star — the Ann Sacks sample table.** The Workshop is not a linear pipeline; it is the big art-table in the middle of a high-end showroom. The walls have drawers of samples; the counter is where you pull pieces out, lay them side by side, swap the pale tile for a bolder one, put it back, iterate endlessly until the vision clicks. The system's job is to be the **powerful, flexible set of tools on that table** — reachable in any order, everything saved, come-and-go — not to march the user through steps. The nano-banana recipes are *tools on the wall*, not a workflow.

**The surface is an infinite node-canvas.** Everything is a **node** on an unbounded, pannable/zoomable board: room photos, blank canvases, harvested clippings, generated variants. You drag them around, select one, and invoke a tool ("extract this," "restyle," "mix these two"); the result appears as a **child node** with an edge back to its parent (the revision lineage). This unifies the whole vision on one messy, creative surface.

**Adopt the `devl.dev` canvas-tools shadcn block as the canvas *shell*** (`npx shadcn add https://www.devl.dev/r/layouts/canvas-tools.json`). Assessment:
- **Fit:** dependency-free React + Tailwind + `cn` + lucide + shadcn primitives — *exactly* this stack. Copy-paste code we own (no AGPL, no Ant Design, no SPA router — unlike `basketikun/infinite-canvas`, which is AGPL-3.0 + Vite SPA + Ant Design + IndexedDB-local and must NOT be forked). Drops into an Astro `client:only="react"` island.
- **What it already gives us (the chrome):** infinite pan/zoom (⌘-wheel zoom centered on cursor, wheel-pan, space-to-pan, fit-to-screen), node drag/move, multi-handle selection frame, a **layers panel + inspector** (position/size/fill/opacity/visibility/lock), keyboard shortcuts, dot-grid background, status pill, tools palette. This is ~80% of the canvas UX for free.
- **What we build on top (the domain layer — this is the real work):**
  1. **Image nodes.** The template only has vector shapes (rect/ellipse/text); add an `image` node type backed by a **Cloudflare Images** URL (the "Place image / I" tool is already stubbed in the palette). For an image-heavy board, render nodes via the **already-installed `konva`/`react-konva`** (better than DOM divs for many hi-res images) while keeping the template's chrome.
  2. **Server persistence.** The template is local React state; wire nodes + lineage to **D1 + `render_canvases`** (already a `parentCanvasId` tree) + a small `workstation_boards`/`board_nodes` layer for free-floating canvas position. Everything Cloudflare-Images-tracked, multi-session, come-and-go.
  3. **The Sample Library (the drawers).** A first-class, persistent, growing catalog of **Gemini-extracted clippings** — "surgically cut just the vanity trough onto a blank background" — harvested from inspiration photos and reused across edits (digital scrapbooking). This is the concept the earlier plan under-named: inspiration isn't a live edit-time crop, it's a *saved reusable sample*. Extraction reuses `InspirationCanvas` bbox crop + `stage_0_IP_extraction` + CF Images transforms; storage extends `canvas_inspiration_references`/`images`.
  4. **Recipes as node actions.** The nano-banana Recipe Library (Phases A–D) surfaces as a **right-click / selection context menu on a node** (extract, material-swap, restyle, relight, try-on, mix-with-clipping), gated to what the selected node(s) support. Runs stream via the existing realtime socket + `PipelineStatusLoader`; output lands as a child node.
  5. **Masking on the counter.** Per-node masking for localized Gemini edits — integrate the existing `MaskConfigurator`.

**Reconciling with room scoping (already locked):** the floor plan (`/floor-plan/floors/[id]/rooms/[id]`) is how you **pick which room's table to walk up to**; picking a room opens *that room's* infinite-canvas workstation, pre-seeded with the room's nodes (listing photos, blank canvas, inspiration, prior renders) and its Sample Library drawer. The materials/budget/decision-room spine remains the *quiet output* the table feeds when the user is ready — not the spine of how the Workshop feels.

**Missing shadcn primitives to add:** `avatar`, `slider`, `tooltip` (`shadcn add`). Remap the template's `@orbit/ui/*` imports to `@/components/ui/*`. Drop/repurpose the decorative multi-user "collab bar" (single-user app). Adjust the template's `border border-border` cards to Monolith `ring-1 ring-border/40` per `taste-design`.

---

## Brainstorming primitives — stackable photo collections ("piles")

Everyone brainstorms differently (whiteboards, notebooks, visual, organized). The workstation must offer **tools, not a workflow** — and the first such tool is **stackable photo piles**: a frictionless way to sort inspiration while sifting.

- **Frictionless creation.** Drag photos together → a **pile** forms. **Naming is optional at creation** (the whole point is that starting a pile is instant); it can be named later or never.
- **Fluid membership.** Add to a pile, move a photo to another/new pile at any time. A photo can be re-sorted freely.
- **Docked, hover-to-expand.** Piles live as small **stacks on the side of the screen**; hovering a pile **springs the photos out full-view**; click any photo in the expanded pile → pick a **design tool** to run on it (feeds the canvas / Sample Library / recipes).
- **Backend is automatic.** New D1 mapping tables — `photo_collections` (id, optional `name`, room/floor scope, created) + `photo_collection_items` (collection_id ↔ image_id, order) — the UI just drags; the backend maintains membership. Distinct from `mood_boards` (curated deliverables) and the Sample Library (extracted *clippings*, not whole photos); a pile can later **graduate** into a mood board or feed `InspoSortWorkspace`'s ordered-reference synthesis.

**Visual = the `Layered Stack` component** (Componentry, `componentry add layered-stack`) — a GSAP stack that restacks by default and springs/fans out on `mouseenter`, restacks on `mouseleave`. Exactly the pile behavior. **Adds a `gsap` dependency** (not yet installed). Integrate at `@/components/ui/layered-stack`, Monolith-styled, honor `prefers-reduced-motion` (disable the spring, keep an instant expand). See §8 for stack/pile alternates in `ANIMATION_COMPONENTS.md`.

## Incoming UI components — integration protocol

The user is supplying a **kit of UI components** (`ANIMATION_COMPONENTS.md` + registry blocks like `devl.dev` canvas-tools and Componentry `layered-stack`) to assemble the workshop's toolset, with more to come. Each new component is **accepted and folded into this plan** under a consistent checklist:
1. **License/ownership** — copy-paste registry code we own (avoid copyleft like the AGPL `infinite-canvas`).
2. **Deps** — note any new dependency (`gsap`, `motion`, `three`, `ogl`, `@use-gesture/react`) and confirm it runs in a React island (`client:only` where needed; heavy WebGL libs lazy-loaded).
3. **Import remap** — retarget the component's aliases (`@uitripled/*`, `@orbit/ui/*`) to `@/components/ui/*` / `@/lib/utils`.
4. **Monolith-ize** — dark theme, `ring-1`/`divide-y` not `border`, tabular numerals, `prefers-reduced-motion`. **Tame the flashy ones** (Lightning/LaserFlow/LightRays are neon by default — Monolith bans neon glows; use them only as *subtle, dark, low-opacity* ambient waiting-state texture, never chrome).
5. **Map to a workstation role** — canvas shell, pile stack, clipping drawer, inspiration browser, waiting-state ambience, 3D viewer — and note which existing component it replaces or augments.

## §8 — Component kit: "make it pop" (see [`ANIMATION_COMPONENTS.md`](./ANIMATION_COMPONENTS.md))

`ANIMATION_COMPONENTS.md` is the curated, purpose-annotated component library for this workshop — each component tagged by the user with its intended role. **Fable must read it and pull these in** where the mapping below calls for them. Full source + install + props for each live in that file at the noted headings.

| Workstation role | Component(s) | Where in `ANIMATION_COMPONENTS.md` | Dep | Notes |
|---|---|---|---|---|
| **Infinite canvas shell** | `devl.dev` canvas-tools | (external registry, §"Front door") | none | The table itself: pan/zoom/nodes/inspector/layers. |
| **Piles / stack the photos** | `Layered Stack`, `Stack` (click-&-move), `Orbit Card Stack`, `BounceCards` | "Orbit Card Stack" (~3074), "Stack" (~4016), "BounceCards" (~3797) | gsap / motion | The side-rail brainstorming piles. `Stack` = user physically drags/reorders a pile; `Layered Stack` = hover-to-fan. |
| **The "Drawer" (pull samples out)** | drawer-reveal + inventory patterns | "Pulling things out of the Drawer" (256), "inventory of things" (561), "Another looking inside the drawer" (711), "bento" (747) | motion | The Sample Library drawer of Gemini-extracted clippings. |
| **Browse inspiration to pick from** | `Collection Surfer`, `Sticky Scroll Cards`, `Scroll Split Card`, `DomeGallery`, cards-slider, `Masonry` | "Collection Surfer" (1510), "Sticky Scroll Cards" (1254), "Scroll Split Card" (1455), "DomeGallery" (4871), "Masonry" (3490) | gsap / @use-gesture/react | Grouped, scrollable inspiration browsing — the drawers on the wall. `DomeGallery` for topic-grouped surfing. |
| **Waiting on Gemini (ambient, not a spinner)** | `Circuit Board`, `Particle Typography`, `Laser Flow`, `Lightning`, `Light Rays`, `Light Pillar`, `Magic Rings`, `Orbit Images` | 869, 1943, 5878, 6635, 6874, 7357, 7853, 8210 | three / ogl / motion | Keep the user entertained during renders instead of a spinner. **Tame to Monolith** — dark, subtle, low-opacity; obey `prefers-reduced-motion`; lazy-load the WebGL ones. |
| **Explore/place 3D elements** | `ModelViewer` | "ModelViewer" (4281) | three, @react-three/fiber, @react-three/drei | Preview a 3D fixture the user may want Gemini to place into the room next turn. |

This kit is what turns a functional tool into an *inspirational workshop*. Apply it tastefully: the **canvas + piles + drawer** are the everyday surface; the **ambient/3D pieces** are accents (waiting states, delight) — never let them fight the calm Monolith mood.

## §7 — The design brief for Claude / Stitch (the deliverable)

> Paste the block below into Claude (or the `stitch-design` / `enhance-prompt` flow). It is written to the **Monolith** design system already loaded via `taste-design`, and folds in a user-research (JTBD) and UX-copy voice lens per the invoked skills. It designs the *interface & experience*; the backend recipes above are the engine it drives.

---

**PROJECT:** "Design Workshop" (`/admin/design/workshop`) — the render engine at the heart of `core-remodel`'s **design suite** (Cloudflare Worker · Astro SSR + React islands · shadcn/ui · **PlateJS** for prompt authoring · dark **Monolith** theme). It turns real artifacts of the house (photos, blank canvases, floor plans, SketchUp renders, sketches, inspiration) into photorealistic visions — fed by the **Prepare** step (`/admin/prepare/blank-canvas/*` incl. per-room camera-angle registration) and handing off to **Mood Boards** (`/admin/design/moodboards`), the **Decision Room** (`/admin/design/decision-room`, where visions become material→product decisions), and the contractor-facing **Master Plan** (`/planning/design-master-plan`). The Workshop and Mood-Board creation share one **reference-image composer** (≤10 refs + per-ref mask + PlateJS prompt) and one **iterate-with-Gemini** loop — design them as reusable primitives, not one-offs.

**WHO IT'S FOR (JTBD):** A single, technically-sophisticated homeowner mid-renovation (Justin, 126 Colby). He is *not* a designer and has low patience for tool-fiddling. His jobs-to-be-done, in his words:
- *"Show me what this room could look like — without lying about my walls and windows."*
- *"I have a SketchUp model / a floor plan / a Zillow photo / a napkin sketch — make it real."*
- *"Let me try three versions of the vanity finish and see them side by side, cheaply."*
- *"When I love something, tell me what it is and where to buy it."*
Design for **confidence and momentum**, not feature density. Every screen should feel like a well-lit architecture studio at dusk — calm, editorial, powerful.

**CORE MENTAL MODEL (make it visible in the UI):** *The room is the model; the design is the outfit.* A real artifact comes in → gets prepped to a faithful "blank canvas" → a design is staged onto it (base → rough-in → finish) → branch to try variations → view across angles → extract the buy list. Never let the user feel they're "generating from scratch"; they are *dressing their actual room*.

**INFORMATION ARCHITECTURE — the working surface is the Workstation infinite-canvas (see "Front door" above, built on the `devl.dev` canvas-tools shell). The flow is floor-plan-first → room-scoped canvas → tools-in-any-order. The items below detail the canvas's panels and entry, not a separate linear studio:**

1. **Workshop Home — the interactive floor plan (front door).** The user lands on their actual floor plan (reuse `InteractiveFloorPlan` + `FloorplanDot` + `LevelSidebar` + `RoomHoverCard` + `LevelRoomSelect`). Hovering a room shows a `RoomHoverCard` preview — thumbnail of its chosen render (or blank canvas) + a readiness line ("3 photos · blank canvas ready · 6 inspiration"). **Clicking a room navigates into that room's Workshop viewport.** A left-aligned editorial hero header frames it ("Your house, room by room — pick where to start"), no centered hero. Multi-level nav via the existing `LevelSidebar`.

2. **Room-scoped Workshop viewport (the core screen).** Entered by clicking a room on the plan. This screen is *everything for this room, in one place*, before any recipe runs — a context-rich staging area:
   - **Header:** room name + a "back to plan" breadcrumb, and the room's current *chosen* render as a hero (or an empty state inviting the first render).
   - **Artifact rail:** the room's assets as switchable tabs/chips — 📷 listing photos, 🧱 blank canvases (`listing_photos.roomId`), 💡 inspiration (`inspirational_image_rooms`), 📐 floor plan / 🏛 elevations, 🧊 SketchUp renders, ✏️ sketches, and prior 🌿 render branches (`render_canvases.roomId`). Plus a drop zone ("Add a photo, plan, sketch, or render — or paste a Zillow link") that auto-detects type.
   - **Room context panel (procurement, presented as options):** the **materials list for this room** and **related showroom products**, shown as an intelligent, browsable set of *options* the user can pull into a render or a decision — not an auto-generated buy-list. Source room↔product/material relevance from room category → material/product-area tags.
   - **Recipe launcher:** an asymmetric grid of **Recipe cards** grouped for a homeowner, **gated to what this room's artifacts allow** (a recipe needing a floor plan is dimmed with an "add a plan" nudge until one exists):
     - *Start from a photo* (declutter, auto-furnish, material swap, furniture swap)
     - *Start from a plan* (furnish floor plan, colorize plan, plan → dollhouse/isometric, elevation → render)
     - *Start from a model or sketch* (**SketchUp/clay → photoreal**, sketch → photoreal)
     - *Restyle & relight* (style transfer, day↔night, lighting boost, color-tone cleanup)
     - *Explore* (design-evolution storyboard, miniature-model delight)
     - *Make it real* (extract furnishings → shoppable options for this room)
   - Each card: Lucide line-icon, a one-line plain-English promise, an input hint, and a real before→after example on hover (not lorem). Picking a card + an artifact opens **The Studio**.

3. **Running a tool on the canvas (recipe runtime)** — invoking a recipe on selected node(s) is a canvas action, not a separate screen. The `devl.dev` shell already provides the tools palette, inspector, and layers; the recipe run docks these three panels around the live node. Generalize today's `StudioBuilder` internals into them. Three panels:
   - **Left — Inputs & Recipe config:** the chosen recipe's minimal form. Progressive disclosure: show only the fields this recipe needs (references, mask, lighting, "how many finishes to try"). Reuse `DesignConfigPanel`, `MaskConfigurator`, `InspirationCanvas` (bbox crop) as needed. A live natural-language prompt preview sits under an "Advanced" disclosure — visible but never required.
   - **Center — Canvas:** big before→after with a draggable reveal slider (reuse `StageExplorer`). While rendering, a **calm staged loader** (reuse `PipelineStatusLoader` + realtime socket) narrates the actual stage ("Preserving your walls…", "Placing the island…", "Rendering finishes…") — skeletons matching final dims, **never a spinner**.
   - **Right — State tree & angles:** the `BranchNavigator` lineage tree ("try another finish" spawns a sibling; "move the vanity" rewinds to base) and `AngleGallery` to view the same design across every camera angle. Make branching feel free and encouraged — this is where confidence compounds.

4. **Compare / Decision view** — 2-up or 3-up side-by-side of branches with a "pin the winner" action that promotes a branch to the room's chosen render and can push it into a mood board / decision room.

5. **Furnishings & materials → Decision Room handoff (procurement)** — from a finished render, run *extract furnishings/materials*; each detected piece becomes a **selectable option against this room's material todos** (the materials D1 records FK'd to the room), which live in the **Decision Room** (`/admin/design/decision-room`). The user maps each todo to a **product** (from `/admin/shopping/*`) or a **description + budget** (non-product decisions like drywall labor). Do not present an auto buy-list — present *options tied to the decisions the room actually requires*. Unmatched items show "no match yet — find sourcing?" (sweep deferred). This screen is shared with the Decision Room, not a separate drawer.

**KEY FLOWS to storyboard end-to-end:**
- *Zillow photo → dream room:* paste link → auto-declutter to blank canvas → pick "auto-furnish" → choose a vibe → base/rough-in/finish renders stream in → branch two island stones → compare → pin.
- *SketchUp → photoreal:* drop a `base_colby` clay export → "make it real" → optionally attach an inspiration style ref (material-only) → photoreal render across angles.
- *Floor plan → understanding:* drop the plan → colorize + furnish → plan → dollhouse isometric for spatial intuition.
- *Sketch → render:* photograph a napkin sketch → photoreal, design-intent preserved.

**DESIGN SYSTEM — Monolith (mandatory):**
- Dark canvas `hsl(240 10% 4%)` (never `#000`), off-white foreground, `bg-card` elevation, **no traditional 1px borders** — use `ring-1 ring-border/40` and `divide-y`. `Inter` display `font-semibold tracking-tight` (never `font-bold`), `JetBrains Mono` for ids/timestamps/dimensions, tabular numerals on every measurement.
- Motion: spring physics (`stiffness 200, damping 25`), 40ms stagger on gallery reveal, animate `transform`/`opacity` only, respect `prefers-reduced-motion`. Subtle shimmer on rendering skeletons.
- Layout: CSS Grid, asymmetric heroes, `p-6` cards, `gap-6` sections, `max-w-7xl` shell, `min-h-[100dvh]` (never `h-screen`). Images: `max-w-100%`, wide state-trees scroll in their own `overflow-x-auto`.
- Charts (if any usage/cost meters): Recharts via shadcn `<ChartContainer>` with the Monolith OKLCH `--chart-1..5` overrides only.
- **Anti-slop bans:** no purple/neon glows, no AI gradient headers, no gradient headline text, no emoji in chrome (chips above are content, not chrome — verify), no fake metrics/round numbers, no "Elevate/Seamless/Unleash/Reimagine" copy, no centered hero, no 3-equal-cards row, no circular spinners, no drop shadows on flat cards.

**UX COPY VOICE:** plain, confident, homeowner-first — describe outcomes, not model mechanics. Recipe names are verbs-and-outcomes ("Make my SketchUp real", "Try it in a different stone", "Empty this room"), not jargon ("stage_5 synthesis"). Loading copy narrates the *promise being kept* ("Keeping your windows exactly where they are…"). Empty states always pair an icon + a headline + one supporting line + a real CTA. Error states are honest and recoverable ("That render drifted — retry, or lock the mask tighter"). Never invent statistics.

**ACCESSIBILITY & STATES:** every recipe card is keyboard-reachable with visible `ring-2 ring-ring` focus; before/after slider has keyboard control and an ARIA label; all generated images carry descriptive alt text derived from the recipe + room; color is never the only signal on artifact chips; target WCAG 2.1 AA contrast (Monolith muted-foreground is already boosted for AA).

**DELIVERABLES from Claude/Stitch:** the five surfaces above as shadcn/Astro-island screens, with real example imagery in mockups (use the app's own render examples, not stock), the Recipe Gallery as the hero screen, and a `DESIGN.md` Section-6 block capturing the Workshop's tokens/patterns so future screens stay consistent.

---

## Critical files to modify / create

- **Extend:** `src/backend/services/render/prompt-kit.ts` (→ named guardrail blocks), `model-registry.ts` (per-recipe defaults), `types.ts` (new `StageType`/`artifactType`), `src/backend/api/routes/render.ts` (recipe-aware stage endpoint).
- **Create:** `src/backend/services/render/recipes/` (recipe registry + one module per recipe), `recipes/meta-prompt.ts` (structured pre-pass, Zod v4).
- **Schema (Drizzle → `pnpm run db:generate`, never hand-SQL):** add `recipe_id` / `artifact_type` columns to `render_canvases`; a source-artifact table if SketchUp/sketch inputs need first-class tracking beyond `images`.
- **Canvas shell:** install the `devl.dev` canvas-tools block (`shadcn add https://www.devl.dev/r/layouts/canvas-tools.json`) + missing primitives (`avatar`, `slider`, `tooltip`); remap `@orbit/ui/*`→`@/components/ui/*`; add an **image-node** type (CF Images URL) rendered via the installed `konva`/`react-konva`; wire nodes+lineage to D1 (`render_canvases` tree + a `board_nodes` position layer). New **Sample Library** (clippings catalog) schema + panel. Recipes surface as node context-menu actions.
- **Frontend:** new `src/frontend/pages/admin/design/workshop.astro` (room-scoped Workstation canvas) + `src/frontend/components/render/` additions (RecipeGallery-as-node-menu, ArtifactDropZone, CompareView, SampleLibraryDrawer) + **shared primitives** (ReferenceComposer with ≤10 refs + per-ref mask + PlateJS prompt + browser-cached queue; iterate-with-Gemini loop; room context resolver) reused by `/admin/design/moodboards/new` and `/admin/prepare/blank-canvas/generate`; generalize `StudioBuilder.tsx`; reuse `AngleGallery`, `StageExplorer`, `BranchNavigator`, `MaskConfigurator`, `InspirationCanvas`, `PipelineStatusLoader`. Procurement handoff lives in `/admin/design/decision-room`, not a Workshop drawer.
- **Input adapters:** floor-plan/elevation from `FloorplanGalleryApp` surface; SketchUp render ingest tied to the supex/`base_colby` export path; sketch upload via `GlobalUploadWidget` + `image_upload_staging`.

## Verification

1. **Per-recipe fidelity check:** for each new recipe, run it on a real 126 Colby artifact and confirm the guardrail held — for structure-lock recipes, walls/windows/openings/camera unchanged (overlay diff); for clay→photoreal, geometry unchanged but materials realistic; for isometric, camera intentionally changed but room program intact. Compare against the validated Python proof (`proofs/tight/jason_20260615/.../batch_image_edit_kitchen.py`).
2. **State-tree reuse:** branch a finished render (finish swap → sibling; layout move → rewind to base) and confirm `parentCanvasId` lineage + cached-intermediate reuse in `render_canvases`.
3. **Throttle/auto-heal:** run a multi-angle batch and confirm the wave-of-3 throttle + `auto-heal.ts` still recover (no Workers-AI 3040 storms); errors land in `image_upload_staging.processing_error`.
4. **UI E2E (preview server):** drop each artifact type into the Workshop, confirm the Recipe Gallery gates correctly, a recipe streams staged status over the realtime socket, before/after + branch + angle views work, and the buy-list drawer produces shoppable cards. Check Monolith compliance (no banned patterns) and AA contrast.
5. **Gateway/observability:** confirm every model call routes through AI Gateway via the registry (not raw `fal.run`/`api.replicate.com`) and appears in observability with per-stage model attribution.

## Decisions locked (2026-07-04)
1. **Scope & sequence:** the eventual scope is **all ~15 🔶 recipes**, but the **first build is a canvas thin-slice** (not the full sweep) — prove the Ann-Sacks "table feel" end-to-end, then fan out the remaining recipes via parallel `/swarm`.
2. **UI / IA:** the Workshop is **`/admin/design/workshop`** inside the `/admin/design/*` suite (Prepare → Workshop → Mood Boards → Decision Room → Master Plan), **not** a root page. `builder.astro` becomes the `/admin/prepare/blank-canvas/angles` prep step. Build the **shared reference-composer + Gemini-iterate + room-resolver primitives once** and reuse them in Mood Boards and Blank-canvas-generate.
3. **Entry flow:** **floor-plan-first** — click a room (`/floor-plan/floors/[id]/rooms/[id]`) → room-scoped Workshop viewport aggregating that room's photos, blank canvases, angle registration, inspiration, plans, SketchUp renders, materials, and related products before any recipe runs.
4. **Procurement:** extracted furnishings/materials become **selectable options against the room's material todos in the Decision Room**, each mapped to a `product_id` (`/admin/shopping/*`) or a description+budget; no auto buy-list. Sourcing sweep for unmatched items deferred.
5. **Prompt authoring:** **PlateJS (markdown)** is the standard editor for all recipe/reference prompt context; references are capped at **10** (Gemini nano-banana limit) with a browser-cached selection queue.
6. **Front door = the Workstation infinite-canvas** (Ann Sacks sample-table model): everything is a node, tools run in any order, revisions are child nodes, come-and-go. **Adopt the `devl.dev` canvas-tools shadcn block as the shell** (own the code; NOT the AGPL `basketikun/infinite-canvas`), render image nodes via the already-installed `konva`, and build the **Sample Library** (Gemini-extracted clippings catalog) as first-class. Recipes = node context-menu actions. Materials/budget/decision-room remain the *quiet output*, not the felt spine.
7. **Component kit (`ANIMATION_COMPONENTS.md`) drives the "pop"** (§8): piles/stacks, the drawer, inspiration browsing, ambient waiting-state animations, and a 3D model viewer are pulled from that curated, purpose-annotated file and **Monolith-ized** (flashy WebGL pieces tamed to subtle/dark, reduced-motion honored, heavy libs lazy-loaded). Canvas + piles + drawer are the everyday surface; ambient/3D are accents only. The build prompt for Fable lives in `FABLE_PROMPT.md`.

## Follow-up to confirm during build
- The **room↔material/product association** doesn't fully exist yet (products map to *showrooms*, and the Materials Schedule was uncommitted per `docs/0008`). Confirm the linking strategy (room category → material/product-area tags) or supply an authoritative room→materials mapping.