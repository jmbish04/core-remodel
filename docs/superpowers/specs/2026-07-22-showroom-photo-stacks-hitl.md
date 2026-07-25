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

---

## Phase B — Sitemap persistence (THIS CHANGELIST)

**Goal:** stop discarding discovered sitemaps. Cache a site's page list keyed to
the entity so the intake workflow's per-candidate product-page scrape (deferred
in C1) reuses a recent sitemap instead of re-fetching — Browser Rendering /
plain fetch is the most rate-limited resource in the system.

### Tasks (done)

- **B.1 Schema** — `scraping_sitemap` (`scraping_sitemap.ts`): `scrape_job_type`
  enum (brand|showroom|product), `brand_id`/`showroom_id` FKs + soft `product_id`,
  `website_url`, resolved `sitemap_url` (null on homepage fallback), `page_urls`
  JSON, `page_count`, `status` (ok|empty|error), `fetched_at` freshness key.
  Migration `0134_dark_iron_monger` (single additive CREATE TABLE, applied remote).
- **B.2 Discovery refactor** — extract `discoverSitemap()` from
  `brand-image-harvest.ts` returning `{ pageUrls, sitemapUrl, status }`;
  `discoverPages()` stays as the thin `string[]` wrapper (existing caller
  unchanged, no circular import).
- **B.3 Cache service** — `services/scraping/sitemap-cache.ts`:
  `getFreshSitemap` / `cacheSitemap` / `discoverPagesCached` (reuse within a
  7-day window, persist on miss, never block the result on a write failure).
- **B.4 API** — `POST /api/intake/sitemaps/discover` (reuse-or-fetch, reports
  `cached`), `GET /api/intake/sitemaps` (list an entity's cached rows).

### Deferred (ponytail)

- Wiring `discoverPagesCached` into `harvestBrandImages` — would create a circular
  import (harvest ↔ cache); the cache's real consumer is the Phase C scrape,
  which calls it server-side. The discover endpoint is the producer for now.

### Acceptance

- Migration applies clean; `tsc --noEmit` adds 0 errors; `pnpm run build` bundles.
- QC (`pr_sitemap_cache.mjs`): first discover persists (`cached:false`), second
  reuses (`cached:true`, no dup row), GET lists it, 400 guards — 11/11 on preview.

---

## Phase C2 — Candidate asset enrichment (THIS CHANGELIST)

**Goal:** the intake workflow now stages each top candidate's product-page image
+ PDF **source URLs** (no download — held until HITL confirm), using Phase B's
sitemap cache to resolve the page.

### Tasks (done)

- **C2.1** `scrapePageAssets(pageUrl)` (exported, `brand-image-harvest.ts`) — one
  cheap fetch + HTMLRewriter over `<img>` (src/data-src/srcset) and `<a href>`
  ending `.pdf`; returns `{ imageUrls, pdfUrls }` capped; never throws.
- **C2.2** `services/scraping/candidate-enrich.ts` — resolve a page (candidate
  URL → bucket hint URL → brand website via cached sitemap, fuzzy-matched to
  model/name) then `scrapePageAssets`. Best-effort; never throws.
- **C2.3** New workflow step `enrich-candidates` (top 3 by rank) between extract
  and persist; `persistCandidates` writes `image_source_urls` / `pdf_source_urls`
  JSON and the resolved `product_url`. Job step count 5 → 6.

### Acceptance

- `tsc --noEmit` adds 0 errors; `pnpm run build` bundles.
- QC (`pr_candidate_enrich.mjs`): bucket with a hint productUrl → workflow
  completes → top candidate has a non-empty `imageSourceUrls` array of http
  source links (not downloaded) + `product_url` recorded — 8/8 on preview.

---

## Phase D1 — Candidate reactions + confirm/reject (THIS CHANGELIST)

**Goal:** the backend the HITL walkthrough (Phase E UI) drives — record a
per-candidate reaction and promote a candidate into a real product.

### Tasks (done)

- **D1.1** `PATCH /api/intake/candidates/:id/reaction` — match (y/n), like (y/n),
  stars (1-5 or null); only supplied fields updated. Reactions kept on
  non-matches (style signal).
- **D1.2** `POST /api/intake/candidates/:id/reject` — status 'rejected', kept
  (not deleted).
- **D1.3** `POST /api/intake/candidates/:id/confirm` — the ONLY place the intake
  pipeline creates a product/brand: `ensureProductFromExtraction` (find-or-create
  brand + product) from the candidate fields, map product→showroom, link
  bucket (`product_id`, status 'reviewed'), set `confirmed_product_id` + status
  'confirmed'. 409 if already confirmed.

### Acceptance

- `tsc --noEmit` adds 0 errors; `pnpm run build` bundles.
- QC (`pr_candidate_reaction.mjs`): reaction persists, out-of-range stars 400,
  reject keeps the row, confirm mints product+brand+mapping and links the bucket,
  second confirm 409 — 15/15 on preview.

---

## Phase D2 — Voice reaction → transcript + style summary (THIS CHANGELIST)

**Goal:** capture a spoken (or typed) reaction to a candidate and distill it into
a compact style record — the raw signal Phase F's style profile reads.

### Tasks (done)

- **D2.1** `services/reaction-summary.ts` — `summarizeStyleReaction(env,
  transcript, ctx)` → `{ summary, likes[], dislikes[], sentiment }` via
  gpt-oss-120b; faithful-only prompt (never invents a preference).
- **D2.2** `POST /api/intake/candidates/:id/voice-reaction` — accepts
  `{ audioBase64 }` (Whisper via reused `transcribeAudioBase64`) OR
  `{ transcript }`; stores `reaction_transcript` + `reaction_summary` (JSON).
- **D2.3** `GET /buckets/:id/candidates` now parses `reaction_summary` back to an
  object for the UI.

### Acceptance

- `tsc --noEmit` adds 0 errors; `pnpm run build` bundles.
- QC (`pr_voice_reaction.mjs`): transcript path stores transcript + a parseable
  non-empty AI summary; missing body 400 — 7/7 on preview.

> Note: a fresh preview/prod deploy needs ~10-15s to propagate before new routes
> answer; QC immediately after deploy can see a transient Astro 404.

---

## Phase E — HITL walkthrough UI (THIS CHANGELIST)

**Goal:** the screen where a human reviews a bucket's candidate matches. Flow
(owner pick): **compare then confirm** — a grid to compare candidates, tap one
for a full card to react + confirm.

### Tasks (done)

- **E.1 Backend** — `GET /api/intake/candidate-queue`: every bucket with ≥1
  candidate + total/pending/confirmed counts + showroom name.
- **E.2 Page** — `/admin/shopping/product-photo-hitl` (BaseLayout + island);
  added to the shopping sidebar nav ("Product-Photo Review").
- **E.3 App** — `ProductPhotoHitlApp.tsx`: bucket queue → candidate compare grid
  → per-candidate dialog (image carousel over staged source URLs, details,
  match/like/dislike/stars, typed OR MediaRecorder voice reaction, confirm/
  reject). Monolith dark; sonner toasts; reuses the `api` helper + shadcn.

### Acceptance

- `tsc --noEmit` adds 0 errors; `pnpm run build` bundles.
- QC (`pr_hitl_queue.mjs`): candidate-queue aggregates counts + showroom, page
  returns 200 — 6/6 on preview. Action endpoints covered by the D1/D2 QCs.
