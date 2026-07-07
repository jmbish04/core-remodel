# Fable 5 Build Prompt — AI Photo Design Workshop (0014)

> **How to use:** Paste the "STARTER PROMPT" (bottom of this file) into a fresh Fable 5 session in the `core-remodel` repo. Fable will read this file and the two plan docs, then build. Everything above the starter is the full brief Fable should treat as source of truth.

---

## Role & mission

You are building the **AI Photo Design Workshop** for `core-remodel` — a Cloudflare Worker app (Hono + zod-openapi → D1 + Drizzle → Astro SSR + React islands + shadcn/ui, Workers AI / Gemini via AI Gateway). The Workshop is an **inspirational, Ann-Sacks-style "sample table"**: an infinite node-canvas where the homeowner sorts inspiration into piles, harvests material clippings with Gemini, and mixes them onto real photos of their house to realize a remodel — everything saved as branchable revisions.

**Read these first and treat them as the source of truth (in order):**
1. `docs/0014_ai_photo_workshop/IMPLEMENTATION_PLAN_v2.md` — the full plan: what exists, recipe coverage, the `/admin/design/*` positioning, the Workstation-canvas front door, the §7 design brief, §8 component kit, critical files, verification, and locked decisions.
2. `docs/0014_ai_photo_workshop/ANIMATION_COMPONENTS.md` — the **curated component kit** (each component annotated with its workshop role: piles, the "drawer," inspiration browsing, waiting-state ambience, 3D viewer). Pull these in per the §8 mapping table. Full source/install/props are in this file.
3. `docs/0004_ai_image_editing/IMPLEMENTATION_PLAN.md` + `PROMPT.md` — the existing render pipeline this builds on, and its non-negotiable constraints.

**Also load the repo skills:** `cloudflare-jedi` (stack conventions), `taste-design` (Monolith design system), `shadcn`/`react-components` (component rebuilds). Apply them throughout.

---

## What to build first — the canvas thin-slice (Slice 1)

Do **NOT** attempt all ~15 recipes at once. Ship one vertical slice that proves the "table feel" end-to-end, then stop for review. Slice 1 (per plan §"Build sequence"):

1. **Canvas shell** — install the `devl.dev` canvas-tools block (`npx shadcn@latest add https://www.devl.dev/r/layouts/canvas-tools.json`) + missing primitives `avatar`, `slider`, `tooltip`. Remap `@orbit/ui/*` → `@/components/ui/*`. Drop the collab bar. Host at `src/frontend/pages/admin/design/workshop.astro` as a `client:only="react"` island.
2. **Image nodes** — add an `image` node type backed by a **Cloudflare Images** URL, rendered via the **already-installed `konva`/`react-konva`**. Seed the board from a chosen room's real artifacts (listing photos, blank canvas, inspiration) via a **room context resolver**.
3. **Persistence** — nodes + canvas position + lineage to **D1**: reuse `render_canvases` (`parentCanvasId` tree) + a new `board_nodes` position layer. Everything Cloudflare-Images-tracked; come-and-go across sessions.
4. **Piles v1** — the `Layered Stack` component (Componentry, adds `gsap`) + new `photo_collections` / `photo_collection_items` tables. Drag inspiration into side-rail stacks, hover to fan out, click a photo → pick a tool. Frictionless (naming optional).
5. **Sample Library v1 (the "drawer")** — extract-a-clipping: `InspirationCanvas` bbox + `stage_0_IP_extraction` + CF Images crop → a saved, reusable clipping node in a drawer (use a §8 drawer/inventory component for the reveal).
6. **3 core recipes as node context-menu actions** — `extract` (harvest clipping), `material-swap` (finish on a node), `mix` (`stage_5_LP_synthesis` of a base node + ≤N clippings). Each output is a **child node with an edge** (revision lineage), streamed live via the existing realtime socket + `PipelineStatusLoader`. Render waits show a **§8 ambient animation tamed to Monolith — never a spinner**.

Stop after Slice 1 and report. Slices 2+ (remaining ~12 recipes, meta-prompt pre-pass, procurement/Decision-Room handoff) come later.

---

## Hard constraints (these override any pasted snippet)

- **Backend:** Hono + `@hono/zod-openapi`, **Zod v4**. Register routes in the API barrel; expose on the OpenAPI doc. Never hand-write SQL — Drizzle schemas in `src/backend/db/schema/images/`, `pnpm run db:generate` for migrations. **D1 has no interactive transactions — use `db.batch([...])`.**
- **Images/models:** store every canvas/render/clipping in **Cloudflare Images** (never rebuild on R2). Crop via **CF Images transforms — no `sharp`/libvips**. Pass CF Images **delivery URLs**, not base64. Route **every** image-model call through **AI Gateway** via the per-stage `model-registry` (never raw `fal.run` / `api.replicate.com`). Default **Gemini 3 Pro Image** for structure-critical stages. Pin `image_config {aspect_ratio, image_size}` computed from source dims. Use global `crypto.randomUUID()`.
- **Fidelity is #1:** always **edit the real image**; include the `PRESERVATION_BLOCK` guardrail (walls/windows/openings/ceiling/floor/camera preserved) where structure-lock applies; scope reference images to **material/form only**. Reuse `src/backend/services/render/prompt-kit.ts`.
- **Frontend:** Astro SSR + React islands + shadcn/ui, **dark Monolith theme** (per `taste-design`): near-black canvas (never `#000`), **no traditional 1px borders** — `ring-1 ring-border/40` + `divide-y`; `Inter` `font-semibold tracking-tight`; `JetBrains Mono` + tabular numerals for ids/dims; spring motion; **respect `prefers-reduced-motion`**. **Anti-slop bans:** no neon/purple glows, no AI gradient headers, no gradient headline text, no fake metrics, no centered hero, no circular spinners, no "Elevate/Seamless/Unleash" copy. **Prompt authoring is PlateJS (markdown).** Reference cap = **10** (Gemini limit).
- **Reuse, don't rebuild** (per plan §"What already exists"): `render/` services (`stage-runner`, `failover`, providers, `cf-images`), `render_canvases`/`canvas_inspiration_references` schema, and the `render/` React components (`StudioBuilder`, `StageExplorer`, `BranchNavigator`, `MaskConfigurator`, `InspirationCanvas`, `PipelineStatusLoader`, `AngleGallery`).
- **Component kit:** apply §8 of the plan. Pull components from `ANIMATION_COMPONENTS.md` for their annotated roles; **Monolith-ize** each (tame the neon WebGL pieces to dark/subtle/low-opacity, lazy-load `three`/`ogl`, honor reduced-motion). The canvas + piles + drawer are the everyday surface; ambient/3D pieces are accents (waiting states, delight) only.

---

## Working method

- Work in a feature branch; small, reviewable commits. Do **not** merge to `main`.
- After schema changes: `pnpm run db:generate` then `pnpm run migrate:local`.
- Verify as you go: `pnpm run build` (esbuild) **and** `tsc --noEmit` filtered to changed files (build does not type-check). Run the app and confirm the slice end-to-end (see plan §Verification): a room's artifacts load as nodes, a pile forms and fans out, a clipping extracts into the drawer, and `mix` produces a child node with lineage + live status. Check Monolith compliance and AA contrast.
- If a decision is genuinely ambiguous, note it inline and pick the plan's recommended default — do not stall.

---

## STARTER PROMPT (paste this into Fable to begin)

```
Build the AI Photo Design Workshop for core-remodel.

Read, in order, and treat as source of truth:
1. docs/0014_ai_photo_workshop/FABLE_PROMPT.md   (your full brief + constraints)
2. docs/0014_ai_photo_workshop/IMPLEMENTATION_PLAN_v2.md   (the plan)
3. docs/0014_ai_photo_workshop/ANIMATION_COMPONENTS.md   (the component kit to make it pop)
Also skim docs/0004_ai_image_editing/{IMPLEMENTATION_PLAN.md,PROMPT.md} for the render pipeline you build on.

Load the repo skills cloudflare-jedi (stack) and taste-design (Monolith dark theme) and apply them throughout.

Scope for THIS run: build only "Slice 1 — the canvas thin-slice" as defined in FABLE_PROMPT.md
(canvas shell at /admin/design/workshop + image nodes on konva + D1 persistence via render_canvases +
board_nodes + piles v1 with Layered Stack/photo_collections + Sample Library v1 clipping extraction +
the 3 core node-action recipes extract/material-swap/mix, with live status and revision-lineage child nodes).
Pull components from ANIMATION_COMPONENTS.md per §8 of the plan and Monolith-ize them.

Honor every hard constraint in FABLE_PROMPT.md (Zod v4, db.batch, AI Gateway registry, CF Images URLs,
no sharp, PRESERVATION_BLOCK, Monolith anti-slop, reuse the existing render/ services & components).
Work on a feature branch with small commits; run pnpm run build + tsc --noEmit on changed files; do not merge to main.
Stop after Slice 1 and give me a summary + how to preview it.
```
