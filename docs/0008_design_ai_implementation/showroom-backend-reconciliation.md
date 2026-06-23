# Showroom Planner — Spec ↔ Code Reconciliation

**Date:** 2026-06-23
**Author:** Claude (session `kind-blackburn-3aabcf`)
**Purpose:** Map the `docs/0001_showroom_planner` spec against what is actually
in the codebase, so the two parallel plans (0001 and the 0008 nav scaffolds)
stop drifting. Verified against source — not against the 0001 walkthroughs,
which over-report completion.

> ⚠️ **Note on the 0001 walkthroughs.** `plans/walkthrough.md` and
> `plans/materials_and_showroom_products_data_api_layer/walkthrough.md` claim
> "Waves 1–4 complete." That is **not** fully true: the Materials Schedule
> domain they describe as done was never landed (see Missing, below).

> 🔀 **Parallel session.** Another session is currently working on the deep
> research agent. Anything under "Deep Research" below is **in flight** —
> coordinate, do not edit blindly.

---

## Legend
- **Built** — exists in code and is migrated/wired.
- **Partial** — schema or entry points exist; logic or UI incomplete.
- **Missing** — specified in 0001 but not in code.

---

## Backend

### Built
| Area | Code | Notes |
|---|---|---|
| Store schema | `src/backend/db/schema/showroom/stores.ts` (`showroom_stores`) | POC, hours, hub, AI highlights |
| Product schema | `…/store_products.ts` (`showroom_store_products`) | FK → stores; **no `materialId` FK** |
| Research findings | `…/research.ts` (`store_research`, `store_product_research`) | + HITL review state |
| Images / specs | `…/product_images.ts`, `product_specs.ts`, `showroom_images.ts` | HITL review state |
| Scan log | `…/scan_log.ts` (`showroom_scan_log`) | VLM extraction audit |
| Sweep / plan-review | `…/sweep_sessions.ts` (`sourcing_sweep_sessions`, `sourcing_plan_revisions`) | plan-gated deep sweeps |
| Similar maps | `…/similar_maps.ts` (`store_similar_map`, `store_product_similar_model_map`) | comparison substrate |
| Cities / hubs, categories, product areas, tags, notes, ratings | respective files | seeded |
| **API** | `src/backend/api/routes/showroom-stores.ts` (~1,358 lines) | mounts at **`/api/showroom-stores`** |
| Seed | `src/backend/api/routes/showroom-seed.ts` | `POST /api/showroom-stores/seed` |
| Migrations | `drizzle/0038`, `0046`, `0049`, `0051` | all showroom tables applied |

**Key API endpoints that already exist** (base `/api/showroom-stores`):
store + product CRUD; `POST …/products/:pid/research/draft-prompt`, `…/plan`,
`…/deep-sweep`; `GET …/research/sweep-sessions/:sid`,
`…/approve-plan`, `…/request-changes`; `PATCH /research/findings|images/:id`
(HITL); `POST /scan` + `GET /scan/log`; `GET /meta/categories|cities|product-areas|gaps`.

### Partial (in flight / incomplete)
| Area | Code | Gap |
|---|---|---|
| Deep research agent | `src/backend/ai/agents/ShowroomResearchAgent/` | `deepSweep*`, `sweep-plan`, `prompt-context` internals partial — **another session is actively working here** |
| Comparison | `store_*_similar_model_map` tables exist | no compare/list endpoints |

### Missing
| Area | Spec source | Status |
|---|---|---|
| **Materials Schedule** (`material_schedule_items`, `material_required_specs`) | `0001/plans/materials_and_showroom_products_data_api_layer/` | **not in code** — no schema, no `materialId` FK, no `/api/materials` route |
| Day-trip routing | 0001 hubs A–E | cities seeded with hub labels; no routing endpoint/algorithm |
| Deals/discounts tracking | 0001 concierge | only free-text `possibleDiscounts`/`tradeDiscount` on products |

---

## Frontend

### Built / working
| Surface | Code | Route |
|---|---|---|
| Showroom Dashboard | `components/showroom/ShowroomDashboard.tsx` | `/admin/showroom` |
| **Sourcing (deep research) app** | `components/showroom/sourcing/` (`SourcingResearchApp`, `SweepPlanReview`, `FindingsLedger`, `ReviewLedger`, `MediaGallery`, `PromptStagingCard`, `RuleOutDialog`, `api.ts`) | *was* `/admin/showroom/sourcing` |
| Barcode scanner | `components/showroom/BarcodeScanner.tsx` | — |
| Closet Research (the pattern) | `components/showroom/ClosetResearchApp.tsx` | `/rooms/closets` |

### Scaffolds added this session (placeholders only)
`PhaseScaffold.tsx` + pages: `schedule`, `showrooms`, `products`, `research`,
`compare`, `scan`, and `material|store|product/[id]`. These are build-plan
cards with **no data**.

### ⚠️ Regression introduced this session
`pages/admin/showroom/sourcing.astro` was converted to a **301 redirect** to the
placeholder `/admin/showroom/research`. Net effect: the **working
`SourcingResearchApp` is currently unreachable**, and the nav's "Deep Research"
shows a placeholder card instead of the real deep-research UI. This should be
restored or re-pointed.

---

## Implication for the 0008 scaffold cards
Most cards describe building backend that already exists. Corrected mapping:

| 0008 card | Card said | Reality |
|---|---|---|
| Materials Schedule | build `materials` + `/api/materials` | ✅ genuinely missing (table is `material_schedule_items`) |
| Showrooms | build `showrooms` + `/api/showrooms` | exists → `showroom_stores`, `/api/showroom-stores` |
| Products | build `products` + `/api/products` | exists → `showroom_store_products`, nested under stores |
| Deep Research | build engine | mostly exists (sweep lifecycle + `SourcingResearchApp`); agent in flight |
| Compare | new `comparisons` tables | `store_product_similar_model_map` exists; needs endpoints + UI |
| Field Scan | build offline scan | `/scan` + `showroom_scan_log` + `BarcodeScanner.tsx` exist; offline-queue UI missing |

The per-surface keep/modify/fork/new decisions are captured in the interactive
proposal: `docs/0008_design_ai_implementation/reconciliation-proposal.html`.
