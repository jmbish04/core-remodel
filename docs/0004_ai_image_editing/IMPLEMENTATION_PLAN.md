# AI Image Editing — Staged Virtual-Staging Render Pipeline

**Status:** Draft for review
**Owner:** <justin@126colby.com>
**Target Worker:** `core-remodel` (Cloudflare Worker: Hono + zod-openapi → D1 + Drizzle → Astro SSR + shadcn → Workers AI / Gemini via AI Gateway)
**Date:** 2026-06-18

***

## 1. Goal

Let a user take the **real photos of a room** (multiple angles), and produce **photorealistic renders of a new design** that:

1. **Never hallucinate architecture** — walls, windows, and openings in the real photo are preserved exactly. The AI only *adds/changes the requested design elements*; it must not invent, move, or close structural features.
2. **Stay consistent across angles** — the same kitchen/bath layout reads as the *same room* from every camera angle.
3. **Are cheap to iterate** — once a good base is built it is **saved and branched**, so trying a second vanity color, or moving the vanity to the other wall, reuses cached intermediate state instead of regenerating from scratch.

This is the "fashion try-on" model: the **room is the model**, the **design is the outfit**, and the user can re-dress the room (finishes, fixtures, furniture, lighting day/night) and view it from every angle.

***

## 2. Mental model & layers

```
Listing photo ──prep──▶ Blank canvas ──build──▶ Baseline render ──branch──▶ Variations
 (real room)  (Layer 0)  (walls+floor    (Layer 1) (design built,  (Layer 2) (swap finish /
                          only, no         faithful, saved)          move element /
                          furnishings)                               day↔night)
```

* **Layer 0 — Blank canvas:** a listing photo with all furnishings/fixtures stripped, leaving only the true room shell (walls, floor, windows, openings). Already modeled in the DB as `listing_photos.blankCanvasCfImageId`. Treated as **input** for this project (the prep step already exists); we only *consume* and, if missing, *queue* it.

* **Layer 1 — Faithful baseline build:** apply the configured design onto a blank canvas with strict architectural fidelity, save it as a reusable baseline.

* **Layer 2 — Try-it-on variations:** branch from a saved baseline to swap finishes / move elements / change lighting profile, rendered across all angles.

***

## 3. The staged render pipeline

Each render is produced by a sequence of **stages**, and **every stage output is persisted as a node in a state tree** so later edits can reuse it. Stages are typed (the `type` enum on `render_canvases`):

| Stage | Type enum                | Engine job                                                                                                 | Cache key role         |
| ----- | ------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| 0     | `stage_0_LP_unfurnished` | (input) blank canvas                                                                                       | tree root              |
| 1     | `stage_1_LP_base`        | Set **floor material + wall paint** on the blank canvas (global/material swap)                             | reusable backdrop      |
| 2     | `stage_2_LP_rough_in`    | **Spatial layout** — place cabinets/island/vanity/fixtures in correct positions, structure-preserving      | layout branch anchor   |
| 3     | `stage_3_LP_finish`      | **High-fidelity finish** — realistic materials, textures, lighting                                         | final render           |
| —     | `stage_0_IP_extraction`  | Crop a region out of an **inspiration photo** (Cloudflare Images transform)                                | material/style snippet |
| —     | `stage_1_IP_finish`      | Use an extracted inspiration snippet as a styling reference                                                | —                      |
| 5     | `stage_5_LP_synthesis`   | **Multi-image inspo synthesis** — compose from base + up to 9 ordered inspiration refs (`@image` indexing) | composed node          |

**Why staged:** decoupling *placement* (stage 2) from *materials* (stage 3) is what minimizes hallucination and maximizes cache reuse. A material tweak reuses stage 3; a layout move rewinds to stage 1/2. **Stage 4 (interaction)** in the model registry (§4.1) is the micro/macro **branching** operation below — it produces new stage-2/stage-3 nodes, not a new canvas type.

### Branching (state-tree reuse)

* **Micro edit** ("show the vanity in a different stone"): start from the latest **stage 3** node, inpaint just that region → new stage-3 child. Skip stages 1–2.

* **Macro edit** ("move the vanity to the other wall"): rewind to the **stage 1 base** (or stage 0), run a **new stage 2** with the modified layout prompt → new rough-in branch, then stage 3. Produces a sibling branch in the tree.

Lineage is tracked with `parentCanvasId`; each node stores the prompt, provider, model, input image, and output image.

***

## 4. Model strategy (IMPORTANT — read before coding)

We adopt the staged architecture with a **provider-agnostic** **`StageProvider`** **interface** and **per-stage model selection**. Both engines below are reached through the **same Cloudflare AI Gateway** (one place for observability, caching, rate-limiting, BYOK). **Fal is a native AI Gateway provider** — not a separate/uncontrolled vendor — so adding it is a config + secret, not an integration.

**Engines available through the gateway:**

* **Gemini 3 Pro Image** (`GEMINI_API_KEY`, `AI_GATEWAY_TOKEN`) — already wired in [`inline-editor.ts`](../../src/backend/services/image-processor/inline-editor.ts) (currently orphaned; the live edit page is mistakenly on Workers AI **SD1.5** — retire that). Proven in our Python proof: with pinned `image_config` + structure-preserving prompts it yields controlled, architecturally-faithful, multi-reference renders. Strongest for **structure-critical** stages.

* **Fal** (`FAL_API_KEY`, wired in `wrangler.jsonc` + `src/backend/utils/secrets.ts`) via the gateway path `…/fal` (custom targets via the `x-fal-target-url` header; `@fal-ai/client` supports `proxyUrl`). Notable models for us:

  * **Seedream v4 edit** (`fal-ai/bytedance/seedream/v4/edit`) — multi-`image_urls` + prompt editing ("dress the model in the clothes…"). An almost-exact fit for the **try-on / material-swap / fixture-swap** stages.

  * **FLUX** (dev/pro) — state-of-the-art **material finish**.

  * **fast-sdxl + ControlNet** — optional **structural rough-in** pinning.

**Decision — per-stage defaults, all overridable via session/stage config:**

* **Stage 1 base & Stage 2 rough-in** (structure-critical): **Gemini 3 Pro** default (fidelity-proven); `fal fast-sdxl+ControlNet` selectable for A/B.

* **Stage 3 finish & Layer-2 try-on** (material-critical): **Gemini 3 Pro** as the safe default, with **Seedream v4 edit** and **FLUX** as first-class gateway-native options to A/B per look.

Build the interface in Phase 0 with `GeminiStageProvider`; add `FalStageProvider` (Seedream/FLUX/SDXL targets) in Phase 4 once the Gemini path is solid. Because everything routes through one gateway, switching a stage's provider is a config change.

```ts
interface StageProvider {
  name: string;            // "gemini-3-pro-image" | "fal-ai/bytedance/seedream/v4/edit" | "fal-ai/flux/dev" | ...
  run(input: StageInput): Promise<StageOutput>; // returns a Cloudflare Images id + metadata
}
// All providers call through Cloudflare AI Gateway. The stage→provider mapping lives in session/stage config.
```

### 4.1 Per-stage model registry (config-driven, gateway-routed)

The stage→model mapping lives in **one config module**, so any stage's engine is swappable without code changes. Defaults below. **Every call routes through Cloudflare AI Gateway** — the `/fal` path for Fal, the `/replicate` path for Replicate (the official Black Forest Labs *Pro/Max* variants Fal doesn't host), and the google-ai-studio path for Gemini — **never raw** **`https://fal.run`** **or** **`https://api.replicate.com`**, or we lose observability/caching/BYOK.

| Pipeline node                 | Default target (via gateway)                                                                       | Why                                                                  | Indicative cost\*   |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| 1 · Base (floor/paint)        | `bria/fibo-edit/edit` (JSON+mask+text) — or Gemini 3 Pro                                           | Mask/JSON constrains edits to surfaces; resists wall hallucination   | \~$0.04/img         |
| 2 · Rough-in (layout)         | `black-forest-labs/flux-depth-pro` **(Replicate)** — or Gemini 3 Pro                               | Depth map locks room geometry while blocking new shapes              | per inference       |
| 3 · Finish (materials)        | `black-forest-labs/flux-kontext-max` **(Replicate)** — or Gemini 3 Pro / `fal-ai/flux-pro/kontext` | Premium realism; ambient shadows/reflections; multi-turn consistency | \~$0.11/MP          |
| 4 · Interaction (micro/macro) | `fal-ai/nano-banana-pro/edit` (= Gemini 3 Pro Image) — or **direct Gemini**                        | Conversational edits ("move the vanity right"); preserves lighting   | \~$0.15/img via Fal |
| 5 · Inspo synthesis           | `fal-ai/flux-2-pro/edit` (≤9 `image_urls`, `@image` syntax)                                        | Blend layout/material/color from multiple refs by index              | \~$0.03/first MP    |

\*Indicative only — **confirm exact slugs, params, and pricing against the live Fal** _**and Replicate**_ **catalogs (through the gateway) before wiring**; catalogs churn. A slug change should be one edit in the registry module.

**Two ways to reach Gemini 3 Pro Image:** **directly** via the gateway google-ai-studio path (already wired, `GEMINI_API_KEY`) or **via Fal** as `nano-banana-pro/edit` (`FAL_API_KEY`). Prefer **direct** for the Stage-4 interaction loop (same model, no Fal per-image markup); keep the Fal wrapper as a fallback target.

**Replicate (BFL Pro/Max):** the official `black-forest-labs/flux-depth-pro` (rough-in) and `black-forest-labs/flux-kontext-max` (finish) are **not hosted on Fal** — route them through the gateway's `/replicate` path with a `REPLICATE_API_TOKEN` secret (wire it like `FAL_API_KEY`: Secrets Store + `wrangler.jsonc` + a `getReplicateApiToken` helper). **Replicate is async**: create a prediction, then poll `urls.get` until `succeeded` (or send `Prefer: wait` to block up to ~60s), then read `output[0]`. A `ReplicateStageProvider` owns this lifecycle behind the same `StageProvider` interface. Fal alternatives stay available for A/B or fallback (`fal-ai/flux-pro/kontext` base; Fal depth via `flux-control-lora-depth`).

### 4.2 Failover / step-down

A transient `429`/`5xx` from a premium model must never dead-end the user. Two complementary layers:

* **Gateway-native** retries + request-level fallback (configured on the AI Gateway) for same-tier resilience.

* **App-level step-down** in the `StageRunner`: on a transient fault, retry once, then step down to a faster/cheaper sibling — **possibly cross-provider** (e.g. Replicate `flux-kontext-max` → `fal-ai/flux-pro/kontext` → `fal-ai/flux-2/turbo/edit`) — recording `resolvedModel` + `provider` + `fallbackTriggered` in `render_canvases.metadata`. **Re-throw** fatal 4xx schema errors (non-429) — never mask a real bug behind a fallback.

***

## 5. Fidelity strategy (the #1 requirement: zero architectural hallucination)

Carry over the hard-won lessons from the Python proof pipeline:

1. **Always EDIT the real blank canvas, never generate from scratch.** Passing the source room image to the image-edit model is what preserves true geometry.
2. **Pin output framing + resolution.** Send `image_config { aspect_ratio, image_size }` matching the source (computed from the source dimensions → nearest supported ratio, e.g. `3:2`, size `2K`). Without this, Gemini 3.x silently re-crops to portrait and downsizes.
3. **Structure-preservation prompt block** on every stage: *"Preserve EXACTLY the walls, windows and their grids, all openings, ceiling, floor plane, room dimensions, and camera angle. Do NOT invent, move, widen, or close any wall or window. Add ONLY the requested elements."*
4. **Reference images are material/form only.** When attaching an inspiration or product photo: *"Use this ONLY for material/color/veining/form; IGNORE its camera angle, floor, props, lighting, and background."* (A reference shot at an angle previously caused the rendered island to copy that angle.)
5. **Optional structural QA gate** (recommended, config-flag): after a stage, run a vision check (Gemini or Workers AI `@cf/llava`/vision) comparing render vs. blank canvas: *"Did any wall/window/opening get added, removed, moved, or closed? Answer yes/no + what changed."* If drift detected, retry once with a strengthened preservation prompt; surface to the user if it still fails. Log the verdict on the canvas node `metadata`.

***

## 6. Multi-angle consistency

* A **render session** applies a design across a room's set of blank-canvas angles.

* **Hero-and-reference:** build the **hero angle** first through the full staged pipeline. For every other angle, run stage 2/3 with the **hero's finish image attached as a consistency reference** ("this is the same kitchen — render it from this viewpoint; match its materials, layout, and fixtures"). Gemini 3 Pro's multi-image referencing keeps the kitchen recognizably identical across angles.

* Honest expectation: **recognizably the same** kitchen across angles (same materials/layout/fixtures), **not pixel-identical** veining — true geometric identity would require a 3D track (out of scope here; noted as future).

* Fan-out across angles runs in a **Cloudflare Workflow** (durable, avoids single-request CPU limits).

***

## 7. Data model (Drizzle on D1)

New tables under `src/backend/db/schema/images/`, added to the schema barrel, generated via `pnpm run db:generate` (drizzle-kit) — **never hand-write SQL**.

### 7.1 `render_sessions`

Groups a room's staging work and holds the configured design.

* `id` (uuid, pk), `roomId` (fk rooms), `name`, `status` (active|archived)

* `designConfig` (JSON: floorMaterial, wallColor, cabinetColor, counterMaterial, fixtures…, OR fk to a future `designs` table)

* `heroCanvasId` (nullable fk render\_canvases), timestamps

### 7.2 `render_canvases` (the state-tree node; generalizes the pasted `image_base_canvas`)

* `id` (uuid, pk), `sessionId` (fk render\_sessions), `roomId` (fk rooms)

* `listingPhotoId` (fk listing\_photos — which **angle** this canvas belongs to)

* `type` (enum: the stage taxonomy in §3)

* `parentCanvasId` (nullable, self-ref — lineage/tree)

* `branchLabel` (text, e.g. "A", "B", "vanity-right")

* `lightingProfile` (enum: default|day|night)

* `prompt` (text), `provider` (text), `model` (text)

* `inputCfImageId` (Cloudflare Images id of the source for this stage)

* `outputCfImageId` (Cloudflare Images id of the result), `outputImageId` (fk images)

* `status` (pending|done|failed), `metadata` (JSON: image\_config used, QA verdict, timings), timestamps

### 7.3 `canvas_inspiration_references` (junction)

* `canvasId` (fk render\_canvases, cascade), `inspirationImageId` (fk images, restrict)

* `extractedCfImageId` (Cloudflare Images id of the cropped snippet, nullable)

* `extractionNotes` (text), `referencedRegionBoundingBox` (JSON: {x,y,width,height} in **source pixels**)

* `referenceIndex` (int) — position in the model's `image_urls` array for `@image{n}` prompting (Stage 5 synthesis). Base/working canvas = index 0 (`@image1`); inspiration refs = 1..N (`@image2`…). User-orderable via the DnD UI.

* pk: (`canvasId`, `inspirationImageId`)

### 7.4 Reused (no change)

* `images`, `listing_photos` (esp. `blankCanvasCfImageId`), `rooms`.

* Storage: **Cloudflare Images** (via `CF_IMAGES_TOKEN`) for every canvas/render/snippet — consistent with the existing app. `ARTIFACTS_BUCKET` (R2) only if a raw intermediate blob ever needs to persist; **do not** rebuild the image store on R2.

> Atomic multi-row writes (canvas + junction rows) use **`db.batch([...])`**, not `db.transaction()` (D1 has no interactive transactions).

***

## 8. API (Hono + @hono/zod-openapi, Zod v4)

All under `src/backend/api/routes/render.ts`, mounted in the API barrel; OpenAPI-registered.

| Method | Path                       | Purpose                                                                                                        |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/render/sessions`     | Create a render session for a room + design config                                                             |
| GET    | `/api/render/sessions/:id` | Session + full canvas tree                                                                                     |
| POST   | `/api/render/stage`        | Run a stage on a canvas → new canvas node (validated by `OrchestrateRequestSchema`)                            |
| POST   | `/api/render/looks`        | Apply design across all angles of a room (hero + reference fan-out via Workflow)                               |
| POST   | `/api/render/extract`      | Extract an inspiration region (Cloudflare Images crop) → snippet + junction row                                |
| POST   | `/api/render/synthesize`   | Multi-image inspo synthesis (`flux-2-pro/edit`) — base canvas + ordered inspiration refs via `@image` indexing |
| GET    | `/api/render/canvases/:id` | Canvas + lineage + inspiration refs (feeds the gallery viewport)                                               |

> All generation routes call models **through the AI Gateway** and are wrapped by the failover/step-down logic (§4.2). Fal routes never hit raw `https://fal.run`.

**Request validation** (corrected from paste — `BoundingBox` in source pixels, action enum drives stage routing):

```ts
export const BoundingBoxSchema = z.object({
  x: z.number().min(0), y: z.number().min(0),
  width: z.number().positive(), height: z.number().positive(),
});
export const StageActionEnum = z.enum(["INITIAL_BASE","STRUCTURAL_MOVE","MATERIAL_TWEAK","FINISH"]);
export const OrchestrateRequestSchema = z.object({
  sessionId: z.string().uuid(),
  canvasId: z.string().uuid().optional(),     // parent node to branch from
  actionType: StageActionEnum,
  branchLabel: z.string().default("A"),
  lightingProfile: z.enum(["default","day","night"]).default("default"),
  prompt: z.string().min(1),
  inspirationReferences: z.array(z.object({
    inspirationImageId: z.string().uuid(),
    extractionNotes: z.string().max(500).optional(),
    referencedRegionBoundingBox: BoundingBoxSchema.optional(),
  })).default([]),
});
```

***

## 9. Orchestration & storage helpers

* **`StageRunner`** service: resolves the `StageProvider`, builds the prompt (preservation block + design tokens + stage-specific instructions), calls the model **with the Cloudflare Images delivery URL** of the input (not base64), uploads the result to Cloudflare Images, writes the canvas node (+ junction via `db.batch`), optionally runs the QA gate.

* **Region extraction without** **`sharp`:** crop via **Cloudflare Images** (named variant or transform request from the source delivery URL) → store the cropped snippet as a new Images id. (Sharp/libvips do not run in the Workers runtime.)

* **Model calls** go through **AI Gateway** (reuse `inline-editor.ts`’s pattern) for caching/observability.

* **Long/multi-angle runs** use a **Cloudflare Workflow** (new binding, mirrors `IMAGE_PROCESSING_WORKFLOW`).

* **Cloudflare Images upload:** POST multipart `FormData` to `https://api.cloudflare.com/client/v4/accounts/{accountId}/images/v1` with `Authorization: Bearer {imagesToken}` — resolve via `getCloudflareAccountId(env)` + `getCloudflareImagesToken(env)` (bindings `CF_IMAGES_TOKEN`/`CLOUDFLARE_IMAGES_STREAM_TOKEN`). Persist the returned image id + delivery URL; request `/thumb`-style variants for gallery chips. *(The pasted* *`https://cloudflare.com{accountId}/images/v1`* *URL is malformed.)*

* **Inpainting masks:** upload the drawn mask as its own Cloudflare Images asset and pass `mask_url` to the model — do not ship base64 masks in the JSON payload.

* **Real-time progress:** a raw `WebSocket` to a Worker must be terminated by a **Durable Object**; reuse the app's existing realtime event channel (the image-processing workflow already publishes events) or fall back to **SSE / polling** of the canvas `status`. Do not hand-roll a bare WS server.

***

## 10. Frontend (Astro SSR + React islands + shadcn)

Replace the broken SD1.5 path; reuse/extend `PhotoEditSessionsApp`.

1. **Design config panel** — floor / wall paint / cabinet / counter / fixtures + lighting day↔night toggle. Writes `render_sessions.designConfig`.
2. **Angle gallery** — shows all of a room's blank-canvas angles and their latest renders for the current look.
3. **State-tree / branch navigator** — visualize baselines and variation branches; pick a node to branch from.
4. **`InspirationCanvas`** — click-drag bounding-box selection over an inspiration photo (the pasted component is good; keep it). Scales display coords → source pixels before submit.
5. **`GalleryViewport`** — final render with an inspiration-chip sidebar. Hovering a chip highlights the clipped region **on that inspiration image** (and/or shows the extracted snippet) via the CSS punch-out overlay — it does **not** claim a location on the generative render, since the model gives us no reliable mapping of where a referenced material landed. Normalize the stored source-pixel box to a 0–1000 space so the overlay is resolution-independent across thumbnail sizes.
6. **`InspoSortWorkspace`** (Stage 5) — drag-and-drop ordering of inspiration chips (`@hello-pangea/dnd`) that sets each ref's `referenceIndex` and live-previews the `@image{n}` tags; the base canvas is the fixed `@image1` anchor. Submits the ordered refs to `/api/render/synthesize`. Hydrate with `client:only="react"` (DnD needs client-only layout).
7. Hydrate the other interactive islands with `client:load`.

**Pages (Astro shells):**

* **`/gallery`** (`src/pages/gallery.astro` → `GalleryViewport`, `client:load`): two-column split — left 2/3 the active `stage_3` render with the hover bounding-box overlay; right 1/3 the scrolling inspiration-chip panel. Gallery data is **server-loaded via Drizzle** (no aggregation loops in JSX).

* **`/builder`** (`src/pages/builder.astro`): the Renovation Studio — (1) **room selector** (shadcn `Select`) loading that room's canvas history; (2) **stage-explorer timeline** (`stage_0…stage_3` nodes; click a stage → list its canvases with starting/output images + `ai_title`); (3) the **`MaskConfigurator`**; (4) **`PipelineStatusLoader`** pinned at top. Hydrate interactive parts `client:only="react"` (canvas/DnD/sockets need client-only layout).

**Builder components:**
8. **`MaskConfigurator`** — an HTML5 `<canvas>` over the selected stage image for **inpainting-mask** drawing (Draw / Clear), beside a shadcn `Textarea` that toggles **natural-language prompt ↔ JSON config** (swatches, textures, layout matrices). On submit: upload the mask as its own Images asset and pass its **URL** (not base64), bundle the config, POST to `/api/render/stage`. (Mask drives `bria/fibo-edit` / Flux-fill localized edits.)
9. **`PipelineStatusLoader`** — real-time status / stage / progress / log. See §9: terminate WS via a **Durable Object**, or reuse the existing realtime channel / SSE / polling — **not** a bare Worker WebSocket.

***

## 11. Phases

* **Phase 0 — Foundation:** schema + migration; `StageProvider` interface + `GeminiStageProvider`; connect the orphaned Gemini engine and **retire the SD1.5 path**; Cloudflare Images crop helper; image\_config + preservation prompt utilities (port from the Python proof). **`FAL_API_KEY`** **secret + AI Gateway** **`/fal`** **access are already wired** (`wrangler.jsonc` + `utils/secrets.ts` → `getFalApiKey`).

* **Phase 1 — Single-angle staged pipeline:** stages 1→2→3 with state-tree persistence + branching (micro/macro) on one angle; fidelity guardrails + optional QA gate.

* **Phase 2 — Multi-angle consistency:** hero + reference fan-out via Workflow; Layer 2 try-on variations (finish swap, element move, day/night).

* **Phase 3 — Studio UI (gallery + builder), extraction & synthesis:** the `/gallery` and `/builder` pages; room selector + stage-explorer timeline; `MaskConfigurator`; `PipelineStatusLoader` (realtime via DO/SSE/existing channel); Cloudflare Images upload + mask-upload helpers; bounding-box extraction + crop + junction rows (+ `referenceIndex`); **multi-image synthesis** (`flux-2-pro/edit`, `@image` ordering) with `InspoSortWorkspace`; gallery viewport hover overlays.

* **Phase 4 — Multi-model registry, Fal + Replicate providers & failover:** implement the §4.1 registry, a `FalStageProvider` (`bria/fibo-edit`, `nano-banana-pro/edit`, `flux-pro/kontext`, `flux-2-pro/edit`, fast-sdxl) and a `ReplicateStageProvider` (`black-forest-labs/flux-depth-pro` rough-in + `black-forest-labs/flux-kontext-max` finish — **async**: create → poll `urls.get` / `Prefer: wait`) — **all via the gateway** (`/fal`, `/replicate`) — plus the §4.2 cross-provider failover/step-down. Wire `REPLICATE_API_TOKEN` (Secrets Store + `wrangler.jsonc` + `getReplicateApiToken`), like `FAL_API_KEY`. Per-stage model is config-selectable for A/B against Gemini; verify each slug against the live catalog first.

Each phase ships independently and is verifiable on its own.

***

## 12. Risks & explicit corrections to the pasted research

| Item                    | Pasted claim                                                                     | Correction in this plan                                                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sharp`                 | "edge-optimized, runs on Workers"                                                | **False.** Native libvips binary; not in Workers runtime. Use **Cloudflare Images transforms** for cropping.                                                                                                                                                             |
| D1 writes               | `db.transaction(async tx => …)`                                                  | D1 has **no interactive transactions**. Use **`db.batch([...])`**.                                                                                                                                                                                                       |
| Models                  | (earlier draft) "Fal = separate external vendor, demote it"                      | **Fal is a native AI Gateway provider** — same observability/caching/BYOK as Gemini, routed through the same gateway. Use **per-stage provider selection**: Gemini default for structure-critical stages; **Seedream v4 edit** / **FLUX** first-class for try-on/finish. |
| Payloads                | base64 data URLs both ways                                                       | Spreading large `Uint8Array` into `btoa` can overflow the stack. **Pass Cloudflare Images URLs** to models; if base64 is unavoidable, chunk it.                                                                                                                          |
| `crypto`                | `import { crypto } from "crypto"`                                                | Use the **global** `crypto.randomUUID()` (Web Crypto); no import.                                                                                                                                                                                                        |
| fal client              | `import { CreativeEngine } from '@fal-ai/client'`                                | No such export. Use `@fal-ai/client`: `fal.config({ credentials: FAL_API_KEY, proxyUrl: "{gateway}/fal" })` then `fal.subscribe(model, { input })`; or raw `fetch` with `Authorization: Key {FAL_API_KEY}` + `x-fal-target-url`.                                         |
| Storage                 | R2 `bucket.get/put` for all images                                               | App standard is **Cloudflare Images + D1**; align with it. R2 (`ARTIFACTS_BUCKET`) only for raw intermediates if ever needed.                                                                                                                                            |
| Fal routing             | `fetch("https://fal.run/...")` direct                                            | Route through **AI Gateway** `…/fal` (or `x-fal-target-url`) for observability/caching/BYOK.                                                                                                                                                                             |
| Pasted save path        | R2 `RENDERING_ASSETS.put` + `https://yourdomain.com{key}`                        | Store renders in **Cloudflare Images**; the pasted URL template is also malformed (missing `/`).                                                                                                                                                                         |
| Model slugs/pricing     | Hardcoded slugs + costs as fact                                                  | **Verify against the live Fal catalog (via the gateway)** before wiring; treat costs as indicative; keep slugs in one config module.                                                                                                                                     |
| Gemini via Fal          | Stage-4 only through `nano-banana-pro/edit`                                      | Same model is reachable **directly** (already wired, no markup) — prefer direct; Fal wrapper as a fallback target.                                                                                                                                                       |
| CF Images URL           | `https://cloudflare.com{accountId}/images/v1`                                    | Malformed. Correct: `https://api.cloudflare.com/client/v4/accounts/{accountId}/images/v1`.                                                                                                                                                                               |
| Image token             | `CLOUDFLARE_IMAGES_TOKEN` as a plain `[vars]` value                              | Repo uses `CF_IMAGES_TOKEN` / `CLOUDFLARE_IMAGES_STREAM_TOKEN` via Secrets Store (`getCloudflareImagesToken`). Never plaintext.                                                                                                                                          |
| Stage-0 prep            | BiRefNet "background eraser" to strip furniture                                  | BiRefNet removes the **background**, keeping the foreground — the opposite. Use **object-removal / inpainting** (Gemini "empty the room" or a Fal object eraser).                                                                                                        |
| Real-time               | bare `new WebSocket(...)` served by the Worker                                   | Worker WS needs a **Durable Object**; reuse the existing realtime channel or use **SSE / polling**.                                                                                                                                                                      |
| `wrangler.toml` samples | `[vars] FAL_API_KEY=…`, R2 `RENDERING_ASSETS`, `name=renovation-studio-pipeline` | Ignore — repo is **`core-remodel`** with `secrets_store_secrets` (FAL\_API\_KEY already wired). Don't add plaintext secrets or rename the worker.                                                                                                                        |

***

## 13. Out of scope (now)

* True interactive **3D** model / photogrammetry (needs camera pose + a non-Worker toolchain). Noted as a future track; the data model does not preclude it.

* Layer 0 blank-canvas **prep** is now **optional in-app** (not required for v1). If built, use **object-removal / inpainting** ("empty the room — remove all furniture and fixtures; keep walls, floor, windows, and openings intact") via a Gemini edit or a Fal object-eraser, writing to `listing_photos.blankCanvasCfImageId`. **Do NOT use BiRefNet background removal** (it isolates the foreground subject and drops the background — the opposite of what we need). If not built, consume the existing blank canvas and show "needs prep" when missing.

***

## 14. Acceptance criteria (whole feature)

1. From a room with ≥2 blank-canvas angles, a user configures a design and gets **faithful** renders on each angle with **no added/closed walls or windows** (QA gate passes or flags).
2. The same design reads as the **same room** across angles.
3. A material tweak reuses the cached finish (fast, localized); a layout move creates a new branch from the base — both visible in the tree.
4. Inspiration regions can be box-selected and appear as chips with hover-highlight in the gallery viewport.
5. All image edits run **through the AI Gateway** (Gemini and/or Fal per the §4.1 stage registry; Fal never via raw `fal.run`); **no SD1.5**; storage in **Cloudflare Images**; migrations via **drizzle-kit**; transient model faults fail over per §4.2.

