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

---

## Phase C1 — Candidate table + intake workflow (THIS CHANGELIST)

**Goal:** replace the inline single-product `/process` path with a durable
Workflow that yields **0-N candidate matches** into a dedicated table for later
human review. Design forks confirmed by the owner:
- **Dedicated candidate table** (`bucket_product_candidates`) — real
  `brands` / `showroom_store_products` rows are created ONLY on HITL confirm, so
  unconfirmed junk never touches the products table.
- **Keep every candidate + reaction** — including rejected/disliked ones
  (`status = "rejected"`, never deleted). That's the style-training signal.

### Tasks (done)

- **C1.1 Schema** — `bucket_product_candidates` (`product_photo_candidates.ts`):
  bucket FK (cascade), rank, confidence, extracted identity (brand id/raw,
  product/model/sku/url, category/style, price texts), staged
  `image_source_urls` / `pdf_source_urls` (JSON, NOT downloaded), colors JSON,
  rationale, raw extraction blob, reaction layer (is_match/liked/stars/
  transcript/summary — all nullable, filled in D/E), status enum, confirmed
  product FK. Migration `0130_solid_gunslinger.sql` (single additive CREATE
  TABLE — applied to remote).
- **C1.2 Extraction** — `extractShowroomProductCandidates` +
  `PRODUCT_CANDIDATES_SCHEMA` in `product-extraction.ts`: same two-stage vision
  pipeline, returns `{ candidates: [...] }`, hint-narrowed, `[]` never throws.
- **C1.3 Workflow** — `BucketIntakeWorkflow` (`bucket-intake-workflow.ts`):
  mark-running → describe-photos → extract-candidates → persist-candidates →
  mark-complete. Records into a research-console job + an agent-run. Bound as
  `BUCKET_INTAKE_WORKFLOW` (wrangler + `_worker.ts` re-export).
- **C1.4 API** — `POST /buckets/:id/intake` (pre-creates a research job, kicks
  the workflow, returns `{ queued, researchJobId }`); `GET
  /buckets/:id/candidates` (rank-ASC, JSON columns parsed back). Live status via
  the existing `GET /api/research-jobs/{id}`.

### Deliberately deferred (ponytail)

- **Web scrape per candidate** (grab product-page images/PDFs, stage source
  URLs) — needs Phase B's `scraping_sitemap` table to cache per-brand sitemaps;
  the `*_source_urls` columns exist and stay null until then.
- **HITL walkthrough UI**, voice reaction, star rating, style summary — Phase D/E.
- The inline `/process` endpoint stays for now; the wizard migrates to `/intake`
  when the D/E walkthrough lands.

### Acceptance

- Migration applies clean (no table rebuilds). `tsc --noEmit` adds **0** errors
  vs baseline. `pnpm run build` bundles.
- QC on the preview worker: kick `/buckets/:id/intake` on a seeded bucket, poll
  the research job to completion, assert `/buckets/:id/candidates` returns ≥1
  ranked candidate with a raw extraction.
