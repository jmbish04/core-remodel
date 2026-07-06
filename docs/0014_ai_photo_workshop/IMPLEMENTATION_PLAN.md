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

## Build plan

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

### Phase E — Design Workshop UI (room-first)
Build the surface described in **§7** as a **new `src/frontend/pages/workshop.astro` front door** (keep `builder.astro` working during migration). The entry is **floor-plan-first**: the user clicks a room on the plan and drops into a **room-scoped Workshop viewport** that aggregates everything tied to that room. Reuse the floor-plan room selector (`InteractiveFloorPlan.tsx`, `floorplan/FloorplanDot.tsx`, `floorplan/RoomHoverCard.tsx`, `floorplan/LevelSidebar.tsx`, `LevelRoomSelect.tsx`) and the studio internals (`StudioBuilder` realtime socket, `StageExplorer`, `BranchNavigator`, `MaskConfigurator`, `InspirationCanvas`, `PipelineStatusLoader`).

**Decisions locked (2026-07-04):** build **all ~15 recipes in one sweep** (parallel `/swarm` with cloudflare-jedi engineers), new `workshop.astro` page, and a procurement panel that surfaces **showroom products + the room's materials list as intelligent, room-relevant options** the user chooses from (not an auto buy-list).

**Room→context aggregation (new linking work):** the room-scoped viewport must pull, for the selected `roomId`: listing photos + blank canvases (`listing_photos.roomId`), inspiration (`inspirational_image_rooms`), prior renders/branches (`render_canvases.roomId`), room materials (Materials Schedule — noted as uncommitted in `docs/0008`; may need a real `room_id` linkage), and related showroom products. Products currently map to *showrooms* not rooms (`showroom/product_mappings.ts`), so add a room↔product/material association (via room category → product area/material tags) to make "products that relate to this room" real.

---

## §7 — The design brief for Claude / Stitch (the deliverable)

> Paste the block below into Claude (or the `stitch-design` / `enhance-prompt` flow). It is written to the **Monolith** design system already loaded via `taste-design`, and folds in a user-research (JTBD) and UX-copy voice lens per the invoked skills. It designs the *interface & experience*; the backend recipes above are the engine it drives.

---

**PROJECT:** "Design Workshop" — the inspirational render studio inside `core-remodel` (Cloudflare Worker · Astro SSR + React islands · shadcn/ui · dark **Monolith** theme). It is the creative front door where a homeowner turns real artifacts of their house into photorealistic visions of the remodel — and then into a buy list.

**WHO IT'S FOR (JTBD):** A single, technically-sophisticated homeowner mid-renovation (Justin, 126 Colby). He is *not* a designer and has low patience for tool-fiddling. His jobs-to-be-done, in his words:
- *"Show me what this room could look like — without lying about my walls and windows."*
- *"I have a SketchUp model / a floor plan / a Zillow photo / a napkin sketch — make it real."*
- *"Let me try three versions of the vanity finish and see them side by side, cheaply."*
- *"When I love something, tell me what it is and where to buy it."*
Design for **confidence and momentum**, not feature density. Every screen should feel like a well-lit architecture studio at dusk — calm, editorial, powerful.

**CORE MENTAL MODEL (make it visible in the UI):** *The room is the model; the design is the outfit.* A real artifact comes in → gets prepped to a faithful "blank canvas" → a design is staged onto it (base → rough-in → finish) → branch to try variations → view across angles → extract the buy list. Never let the user feel they're "generating from scratch"; they are *dressing their actual room*.

**INFORMATION ARCHITECTURE — the flow is floor-plan-first, then room-scoped, then recipe. Build these surfaces:**

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

3. **The Studio (recipe runtime)** — the working canvas, generalizing today's `StudioBuilder`, always scoped to the current room. Three zones:
   - **Left — Inputs & Recipe config:** the chosen recipe's minimal form. Progressive disclosure: show only the fields this recipe needs (references, mask, lighting, "how many finishes to try"). Reuse `DesignConfigPanel`, `MaskConfigurator`, `InspirationCanvas` (bbox crop) as needed. A live natural-language prompt preview sits under an "Advanced" disclosure — visible but never required.
   - **Center — Canvas:** big before→after with a draggable reveal slider (reuse `StageExplorer`). While rendering, a **calm staged loader** (reuse `PipelineStatusLoader` + realtime socket) narrates the actual stage ("Preserving your walls…", "Placing the island…", "Rendering finishes…") — skeletons matching final dims, **never a spinner**.
   - **Right — State tree & angles:** the `BranchNavigator` lineage tree ("try another finish" spawns a sibling; "move the vanity" rewinds to base) and `AngleGallery` to view the same design across every camera angle. Make branching feel free and encouraged — this is where confidence compounds.

4. **Compare / Decision view** — 2-up or 3-up side-by-side of branches with a "pin the winner" action that promotes a branch to the room's chosen render and can push it into a mood board / decision room.

5. **Furnishings & materials options panel (procurement, room-scoped)** — from a finished render, run *extract furnishings*; each detected piece is presented as a **selectable option** cross-referenced against this room's **showroom products + materials list**. The user *chooses* which to adopt (into the room's materials/decision/mood board) rather than being handed an auto buy-list. Unmatched items show as "no match yet — find sourcing?" (defer the sourcing sweep to a later phase). Empty state: "Render this room, then pull its furnishings and materials."

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
- **Frontend:** new `src/frontend/pages/workshop.astro` (Recipe Gallery front door) + `src/frontend/components/render/` additions (RecipeGallery, ArtifactDropZone, BuyListDrawer, CompareView); generalize `StudioBuilder.tsx`; reuse `AngleGallery`, `StageExplorer`, `BranchNavigator`, `MaskConfigurator`, `InspirationCanvas`, `PipelineStatusLoader`.
- **Input adapters:** floor-plan/elevation from `FloorplanGalleryApp` surface; SketchUp render ingest tied to the supex/`base_colby` export path; sketch upload via `GlobalUploadWidget` + `image_upload_staging`.

## Verification

1. **Per-recipe fidelity check:** for each new recipe, run it on a real 126 Colby artifact and confirm the guardrail held — for structure-lock recipes, walls/windows/openings/camera unchanged (overlay diff); for clay→photoreal, geometry unchanged but materials realistic; for isometric, camera intentionally changed but room program intact. Compare against the validated Python proof (`proofs/tight/jason_20260615/.../batch_image_edit_kitchen.py`).
2. **State-tree reuse:** branch a finished render (finish swap → sibling; layout move → rewind to base) and confirm `parentCanvasId` lineage + cached-intermediate reuse in `render_canvases`.
3. **Throttle/auto-heal:** run a multi-angle batch and confirm the wave-of-3 throttle + `auto-heal.ts` still recover (no Workers-AI 3040 storms); errors land in `image_upload_staging.processing_error`.
4. **UI E2E (preview server):** drop each artifact type into the Workshop, confirm the Recipe Gallery gates correctly, a recipe streams staged status over the realtime socket, before/after + branch + angle views work, and the buy-list drawer produces shoppable cards. Check Monolith compliance (no banned patterns) and AA contrast.
5. **Gateway/observability:** confirm every model call routes through AI Gateway via the registry (not raw `fal.run`/`api.replicate.com`) and appears in observability with per-stage model attribution.

## Decisions locked (2026-07-04)
1. **Scope:** build **all ~15 🔶 recipes in one sweep** (parallel `/swarm` with the cloudflare-jedi engineers), not phased by input type.
2. **UI:** ship a **new `workshop.astro`** front door; keep `builder.astro` running during migration.
3. **Entry flow:** **floor-plan-first** — click a room on the plan → room-scoped Workshop viewport that aggregates that room's photos, blank canvases, inspiration, plans, SketchUp renders, materials, and related showroom products before any recipe runs.
4. **Procurement:** surface **showroom products + the room's materials list as intelligent, room-relevant options** the user selects from; no auto buy-list. Sourcing sweep for unmatched items deferred to a later phase.

## Follow-up to confirm during build
- The **room↔material/product association** doesn't fully exist yet (products map to *showrooms*, and the Materials Schedule was uncommitted per `docs/0008`). Confirm the linking strategy (room category → material/product-area tags) or supply an authoritative room→materials mapping.
