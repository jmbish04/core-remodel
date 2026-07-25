# AUDIT FINDINGS — AI Photo Design Workshop, Slice 1 (0014)

**Audited:** PR #75 as merged on `origin/main` (@ #208, commit caffad3). Read-only, evidence-based.
**Date:** 2026-07-24.

## 1. Verdict

**Slice 1 is shippable — and already merged/live.** The canvas thin-slice landed faithfully: infinite konva canvas, image nodes, piles, sample-library clippings, board persistence, room-context seeding, and the 3 core recipes (extract / material-swap / mix) with lineage + realtime status. No P0 defects found. Remaining work is **polish + Slice-2 prep**, not blockers. Two P1s: the §8 "make it pop" component kit is barely used, and the recipe engine isn't generalized yet (needed before fanning out the remaining recipes).

## 2. Scorecard

| Area | Status | Evidence |
|---|---|---|
| A1 Canvas shell (devl.dev + primitives) | **Built** | `admin/designs/workshop.astro`; `avatar`/`slider`/`tooltip` present; `CanvasChrome`/`ToolsPalette`. |
| A2 Image nodes (konva) + room resolver | **Built** | `react-konva` `Stage/Layer/Image` in `canvas/*`; `services/workshop/room-context.ts` resolves CF Images URLs. |
| A3 Persistence (D1) | **Built** | `workstation_boards`/`board_nodes`/`photo_collections`/`sample_clippings`; full CRUD in `routes/workshop.ts`; tables in `0000_baseline`. |
| A4 Piles (Layered Stack + gsap) | **Built** | `piles/LayeredStack.tsx` uses gsap; `gsap@^3.15.0` installed; `photo_collections(+items)`. |
| A5 Sample Library (clipping extract) | **Built** | `drawer/ExtractClippingDialog.tsx`; `sample_clippings` table + route. |
| A6 Recipes as node actions + lineage + live | **Built** | `recipes/RecipeDialog.tsx`; `parentCanvasId` set on outputs (routes/workshop.ts ~1200/1245); `hooks/useRenderRealtime.ts`. |
| B Zod v4 / db.batch / no raw providers / no sharp | **Compliant** | no `fal.run`/`api.replicate.com` calls (comments only); no `sharp`; no `db.transaction`. |
| B AI Gateway via registry | **Built (inherited)** | reuses existing `render/` providers + registry. |
| C Monolith compliance | **Mostly** | no spinners (`animate-spin`/`Loader2` absent); **1** `border border-` in `CanvasChrome` (should be ring). |
| C PlateJS prompt authoring | **Built** | `recipes/RecipePromptEditor.tsx` + `RecipeDialog.tsx`. |
| C §8 component kit ("make it pop") | **Partial** | only `LayeredStack` pulled. Ambient waits, drawer/inspiration browsers, ModelViewer all skipped. |
| Recipe engine generalized (Phase A registry) | **Missing** | no `src/backend/services/render/recipes/`; recipes ad-hoc. Expected — Slice-2 work. |
| D Build / tsc / remote migration | **Unverified** | not run in this throwaway worktree (no deps); PR passed CI. Verify `migrate:remote` applied the tables. |

## 3. Fill-in backlog (ranked)

- **P1 — §8 component kit underused ("make it pop" not delivered).** Only `LayeredStack` used. Add: an ambient waiting-state animation (Circuit Board / Light Rays, tamed to Monolith) on recipe runs; a richer inspiration browser (DomeGallery / Collection Surfer) for the drawer; optional ModelViewer. Files: `components/workshop/` + `docs/0014_ai_photo_workshop/ANIMATION_COMPONENTS.md` §8.
- **P1 — Recipe engine not generalized.** Build `src/backend/services/render/recipes/` (registry + named guardrail blocks per plan Phase A) *before* Slice 2, so the remaining ~12 recipes are config not copy-paste.
- **P2 — Monolith border.** `canvas/CanvasChrome.tsx` uses `border border-` — swap to `ring-1 ring-border/40`.
- **P2 — Verify remote D1.** Confirm the four workshop tables exist on remote (baseline collapse #112 should include them; run `pnpm run smoke` / check `migrate:remote`).
- **P2 — Route naming.** Page is `/admin/designs/workshop` (plural "designs"); plan/`/admin/design/*` suite uses singular. Confirm intended or align.

## 4. Constraint violations

None material. (Only nit: the single `border` in C above.)

## 5. Deviations & bonus (good)

- Slice-1 feedback already folded in: only blank-canvas artifacts seed as `board_nodes`; listing + inspiration live in **drawers** (`room-context.ts`).
- Realtime render status wired via `hooks/useRenderRealtime.ts` (not just a static loader).
- PlateJS recipe prompt editor shipped.

## 6. Ready for Slice 2?

**Yes — after the P1 recipe-registry generalization.** The canvas, persistence, piles, drawer, and recipe-run plumbing are a sound base. Generalize the recipe engine, then fan out the remaining ~12 nano-banana recipes. The §8 kit P1 can run in parallel (pure UI delight).
