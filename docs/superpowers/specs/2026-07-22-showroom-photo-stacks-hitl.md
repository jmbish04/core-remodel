# Showroom Photo Stacks + Product-Photo HITL — Plan

**Branch:** `claude/showroom-photo-stacks` (cut fresh from `origin/main`)
**Date:** 2026-07-22

## Reality check (survey against current `origin/main`)

Most of the requested pipeline **already exists** and must be reused, not rebuilt:

| Requested | Already exists |
|---|---|
| Group showroom photos into per-product stacks | `product_photo_buckets` table + intake wizard `/admin/shopping/photo-intake` (upload → group into buckets → process) |
| Process a group together (16 photos → 4 extractions) | `extractShowroomProductFromDescriptions` — one vision pass over all bucket photos |
| HITL review of extracted product | `/admin/shopping/photo-review` → `BucketReviewApp` / `BucketReviewForm` (approve/reject → price observation) |
| Whisper STT, vision model, R2, Vectorize | All wired (`@cf/openai/whisper`, `llama-3.2-11b-vision`, `ARTIFACTS_BUCKET`, `PHOTO_INDEX`) |

**`showroom_store_products` is NOT renamed to `products` on main** — build against `showroom_store_products` / `showroomStoreProducts`.

## Real gaps (the actual work)

1. **A′ — per-stack fields at grouping.** A bucket only carries `kind`+`label`. Missing: brand (autocomplete against existing brands, or free-typed "other"), product name, model number, SKU, product URL. Rule: a bucket is "ready for workflow" only with **brand OR product URL**.
2. **B — sitemap persistence.** No `scraping_sitemap` table; sitemaps fetched then discarded.
3. **C — candidate-match workflow.** Bucket processing is inline in the request handler and produces exactly one product. Need a durable Workflow that yields 0-N candidate matches, scrapes brand-then-product, downloads images/PDFs, comes back for HITL.
4. **D/E — reaction layer + multi-candidate HITL.** No like/dislike, star rating, voice→Whisper→AI-summary, and no walkthrough of multiple candidates.
5. **F — style profile.** Reads D/E's reaction data ("Spotify wrapped" + chat).

## Sequencing (traditional, dependency-ordered)

Each phase is its own commit + preview + PR. A′ ships first — smallest, highest-frequency use, de-risks the data shape C/D/E read.

---

## Phase A′ — Enrich the grouping wizard (THIS CHANGELIST)

**Goal:** capture brand + product hints per stack at grouping time, so the future workflow starts warm.

### Tasks

- **A′.1 Schema** — add nullable columns to `product_photo_buckets`:
  `brand_id` (FK → `brands`, `onDelete set null`), `brand_name_raw` (text; the free-typed brand not yet in the system), `product_name`, `model_number`, `sku`, `product_url`.
  Then `pnpm run db:generate`, inspect the SQL (additive `ALTER ADD` only — no rebuild), `pnpm run migrate:remote`.
- **A′.2 API** — `POST /buckets` and `PATCH /buckets/:id` accept the new fields (all optional). Add a **derived** `readyForWorkflow` boolean to the `GET /buckets` bucket DTO: `true` when `brand_id` OR `brand_name_raw` OR `product_url` is present. No hard block at create (the workflow gate lands in C); this is a visible signal only.
- **A′.3 UI** — in the intake wizard grouping step:
  - Merge-into-bucket dialog gains: brand autocomplete (reuse `EntitySearchSelect`/`BucketReviewForm`'s pattern against `/api/brands?search=`) with an "other — type a new brand" escape, plus product name / model / SKU / product URL inputs. All optional.
  - Each existing bucket card gains an inline "edit details" affordance writing the same fields via `PATCH`.
  - Buckets missing brand-and-URL show a soft amber "needs brand or product URL" badge (not a hard block).

### Acceptance

- Creating/editing a bucket persists all five hint fields.
- `GET /buckets` returns `readyForWorkflow` correctly.
- Existing create-with-just-kind+label flow still works (no regression).
- `tsc --noEmit` adds **0** errors vs the `origin/main` baseline (verified by diffing the error list, not the count).
- QC script hits the endpoints on the preview worker and asserts round-trip + the derived flag.

### Explicitly out of scope for A′

Candidate matching, the workflow, voice/reaction, sitemap table, product files, style profile. Those are Phases B–F, each its own changelist.
