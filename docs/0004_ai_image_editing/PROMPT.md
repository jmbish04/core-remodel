# Implementation Prompt — AI Image Editing (Staged Virtual-Staging Render Pipeline)

You are implementing a feature in the **`core-remodel` Cloudflare Worker**. Read these two files first and treat them as the source of truth:

- `docs/0004_ai_image_editing/IMPLEMENTATION_PLAN.md` — architecture, data model, API, phases, fidelity strategy.
- `docs/0004_ai_image_editing/TASKS.json` — the ordered task list with files and acceptance criteria.

Work **phase by phase (P0 → P4)**, task by task in `TASKS.json` order. After each task, run typecheck/build and verify its acceptance criteria before moving on. Do not start a later phase until the earlier one is green.

## What you're building (one paragraph)

A virtual-staging renderer: take a room's **real, furniture-stripped "blank canvas" photos** (multiple angles) and produce photorealistic renders of a configured design — **without hallucinating any architecture** (walls/windows/openings stay exactly as in the real photo), **consistent across angles**, and **cheap to iterate** via a cached **state tree** of staged outputs (base → rough-in → finish) that can branch (swap a finish, move an element, day↔night). The room is the "model"; the design is the "outfit" it tries on.

## Stack conventions (follow the existing repo, the cloudflare-jedi conventions)

- **API:** Hono + `@hono/zod-openapi`, Zod **v4**. Register routes in the API barrel; expose them on the OpenAPI doc.
- **DB:** Drizzle ORM on **D1** (binding `DB`). Put schemas in `src/backend/db/schema/images/`, export from the schema barrel, and generate migrations with **`pnpm run db:generate`** (drizzle-kit). **Never hand-write SQL.**
- **Frontend:** Astro SSR + React islands (`client:load`) + shadcn/ui. Match the existing dark-theme components.
- **Images:** store every canvas/render/snippet in **Cloudflare Images** (`CF_IMAGES_TOKEN`), tracked in D1 — same pattern as the current app. Do **not** rebuild the image store on R2.
- **Models:** call image models **through Cloudflare AI Gateway** via a **per-stage registry** (one config module). **Gemini 3 Pro Image** (`GEMINI_API_KEY`, `AI_GATEWAY_TOKEN`) — reuse the orphaned pattern in `inline-editor.ts` and wire it up; default for structure-critical stages. **Fal** (`FAL_API_KEY` via `getFalApiKey`, gateway `/fal` path): `bria/fibo-edit` (base), `nano-banana-pro/edit` (interaction), `flux-pro/kontext` (finish alt), `flux-2-pro/edit` (synthesis), fast-sdxl (rough-in alt). **Replicate** (`REPLICATE_API_TOKEN` via `getReplicateApiToken`, gateway `/replicate` path, **async** create→poll/`Prefer: wait`): `black-forest-labs/flux-depth-pro` (rough-in), `black-forest-labs/flux-kontext-max` (finish). **Never call raw `https://fal.run` or `https://api.replicate.com`.** Verify slugs against the live catalogs first.
- **Long/multi-angle work:** use **Cloudflare Workflows** (mirror the existing `IMAGE_PROCESSING_WORKFLOW` binding).

## Non-negotiable constraints (these override any pasted snippets you may find)

1. **Do NOT use `sharp`/libvips** — it cannot run in the Workers runtime. Crop/extract regions with **Cloudflare Images transformations**.
2. **D1 has no interactive transactions.** Use **`db.batch([...])`** for atomic multi-row writes (e.g., canvas node + inspiration-reference rows). Do not call `db.transaction()`.
3. **Per-stage provider selection** behind a `StageProvider` interface, **all routed through Cloudflare AI Gateway** via a config-driven model registry (plan §4.1). **Gemini 3 Pro** default for structure-critical stages. **Fal** (`FAL_API_KEY`, `/fal`) for `bria/fibo-edit`, `nano-banana-pro/edit`, `flux-pro/kontext`, `flux-2-pro/edit`, fast-sdxl (+ Seedream v4 edit for try-on). **Replicate** (`REPLICATE_API_TOKEN`, `/replicate`) for the BFL Pro/Max defaults `black-forest-labs/flux-depth-pro` + `black-forest-labs/flux-kontext-max` — these are **not on Fal**, and Replicate is **async** (create prediction → poll `urls.get` / `Prefer: wait` → `output[0]`). **Never raw `https://fal.run` or `https://api.replicate.com`.** Verify slugs first; keep them in one registry module. Add the cross-provider **failover/step-down** wrapper (§4.2). Build the Fal + Replicate providers + registry in Phase 4; do not block earlier phases on it.
4. **Fidelity is the #1 requirement.** Always **edit the real blank-canvas image** (never generate from scratch). On every model call:
   - pin `image_config { aspect_ratio, image_size }` computed from the source dimensions (Gemini 3.x silently re-crops to portrait + downsizes otherwise);
   - include the **preservation block**: preserve walls, windows + grids, openings, ceiling, floor plane, dimensions, and camera angle exactly; add ONLY the requested elements; never invent/move/widen/close a wall or window;
   - scope any reference image to **material/form only** ("ignore its angle, floor, props, lighting, background").
5. **Pass Cloudflare Images delivery URLs** to the model, not giant base64 strings. Use the global **`crypto.randomUUID()`** (no `crypto` import).
6. Port the proven prompt/`image_config`/nearest-aspect-ratio logic from `proofs/tight/jason_20260615/upper_level/kitchen/ai_renders/batch_image_edit_kitchen.py` — it was validated to produce controlled, faithful renders on `gemini-3-pro-image`.
7. **Storage & realtime specifics:** upload to Cloudflare Images at `https://api.cloudflare.com/client/v4/accounts/{id}/images/v1` (Bearer `getCloudflareImagesToken`, account `getCloudflareAccountId`); pass image/mask **URLs**, not base64. A Worker **WebSocket needs a Durable Object** — otherwise use the existing realtime channel / SSE / polling. If you build Layer-0 prep, use **object-removal/inpainting** that keeps the room shell — **not BiRefNet background removal**. Ignore the pasted `wrangler.toml` samples: `wrangler.jsonc` is already correct and `FAL_API_KEY` is wired.

## Data model (see plan §7 for columns)

New tables: `render_sessions`, `render_canvases` (stage-typed state-tree node — incl. `stage_5_LP_synthesis` — with `parentCanvasId`, `listingPhotoId` = angle, `lightingProfile`), `canvas_inspiration_references` (junction with `referencedRegionBoundingBox` in source pixels **and `referenceIndex` for `@image{n}` ordering**). Reuse `images`, `listing_photos.blankCanvasCfImageId`, `rooms`.

## Staging & branching (see plan §3)

Stages: `stage_1_LP_base` (floor+paint) → `stage_2_LP_rough_in` (spatial placement) → `stage_3_LP_finish` (materials/lighting). **Micro edit** (material/finish swap) branches from the latest stage-3 node; **macro edit** (move an element) rewinds to stage-1/0 and re-runs forward as a new branch. Persist every stage output as a tree node so branches reuse cache.

## Multi-angle consistency (see plan §6)

Build the **hero angle** first, then render each other angle with the **hero's finish attached as a reference** ("same kitchen — render from this viewpoint; match materials/layout/fixtures"). Expect recognizably-identical (not pixel-identical) results. Fan out via a Workflow.

## Frontend (see plan §10)

`DesignConfigPanel` (floor/paint/cabinet/counter/fixtures + day/night), `AngleGallery`, `BranchNavigator` (state tree), `InspirationCanvas` (drag a bounding box; scale display→source pixels before submit), `GalleryViewport` (render + inspiration chips; hover a chip to highlight its source region via CSS punch-out, normalized to a 0–1000 space), and `InspoSortWorkspace` (Stage 5: `@hello-pangea/dnd` drag-ordering of inspiration chips → `referenceIndex` → POST `/api/render/synthesize`; hydrate `client:only="react"`). Replace the broken SD1.5 edit path. **Pages:** `/gallery` (GalleryViewport — two-column render + inspiration chips) and `/builder` (room selector + `stage_0..3` stage-explorer timeline + `MaskConfigurator` canvas-mask/JSON + `PipelineStatusLoader`). Hydrate canvas/DnD/socket islands `client:only="react"`; server-load data via Drizzle (no aggregation in JSX).

## Definition of done

All acceptance criteria in `TASKS.json` pass; `pnpm typecheck` and the build are green; migrations generated via drizzle-kit; the edit page renders end-to-end **through the AI Gateway** (Gemini and/or Fal per the registry; no Stable Diffusion 1.5; no raw `fal.run`); images stored in **Cloudflare Images**; a room with ≥2 blank-canvas angles yields faithful, cross-angle-consistent renders with the structural QA gate passing or clearly flagging drift.

## Before you start

Confirm the exact version pins for `hono`, `@hono/zod-openapi`, `drizzle-orm`, `drizzle-kit`, and `zod` from `package.json`, and the binding names in `wrangler.jsonc` (`DB`, `AI`, `CF_IMAGES_TOKEN`, `GEMINI_API_KEY`, `AI_GATEWAY_TOKEN`, `FAL_API_KEY`, `ARTIFACTS_BUCKET`, the Workflow bindings). Ask the user only if something blocks you; otherwise follow the plan and these constraints.
