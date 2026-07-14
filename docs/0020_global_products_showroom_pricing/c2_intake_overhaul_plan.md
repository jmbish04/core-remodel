# 0020-C2 — Price-Card Review UX Overhaul

Replaces the flat "one card per photo" review queue with a proper showroom-visit intake + review flow.

## Phase 1 — config foundation ✅ SHIPPED (PR #107, prod migrated 0101)
- `categories` / `subcategories` / `colors` definition tables + 5 mapping tables (`photo_categories`, `photo_subcategories`, `photo_colors`, `brand_categories`, `product_categories`), all with composite UNIQUE mapping indexes.
- `/api/config` CRUD + mapping endpoints.
- `/config/photo/{categories,subcategories,colors}` management pages on reusable `ConfigShell` + `DefinitionTablePanel`.
- Reusable `CurrencyInput` (text+cents), `ComboboxWithOther`; `MultipleSelector` for multi.
- AI extraction fed category/color/brand vocab; AI-proposed colors resolve/create into `colors` + `photo_colors`.
- AGENTS.md rules incl. mandatory planning-phase compliance scan.

## Phase 2 — intake wizard (THIS PHASE)
Multi-step tabbed wizard for a showroom visit's photos.
1. **Showroom select** — city-grouped, checkboxes, reuse the showroom directory UX.
2. **Per-showroom upload** — selected showrooms shown ASC city-grouped in a sidebar; click one → right pane dropzone + Google Photos import (multi). Upload to CF Images first (fast), rows created `status=uploaded` (NOT yet AI-processed).
3. **Ordering + bucketing** — photos ordered by filename ASC (burst shots of one product land adjacent). Bulk-select → "Merge into bucket" → product-info modal. A **bucket = one product in D1**, photos stay grouped (bucketId). Single-product photos can stand alone (implicit 1-photo bucket).
4. **Process with AI** — per bucket, all photos processed TOGETHER → one extraction → one product + observations.

### Backend
- `product_photo_buckets` table (id, showroomId, productId?, kind[single|multi], status, createdAt) + `bucketId` FK on `product_showroom_photos`.
- Upload endpoint: File[] per showroom → CF Images → photo rows (filename kept for ASC sort).
- Bucket endpoints: create/merge (assign photos to a bucket), list buckets for a showroom, set product info.
- Process-bucket endpoint: run extraction over the bucket's images together → product + `photo_categories`/`photo_colors` mappings (reuse Phase-1 vocab wiring).
- Reuse existing Google Photos picker backend (hands File[] to same upload path).

### Frontend
- Wizard shell (tabs/steps) at `/admin/shopping/intake` (or similar).
- Showroom multi-select (reuse showroom list + city grouping).
- Upload pane: dropzone + Google Photos button, thumbnails ordered filename-ASC.
- Bulk-select + Merge-into-bucket + product-info modal.
- Process-with-AI action → routes buckets into the Phase-3 review form.

## Phase 3 — review form rework
Photo-left click-zoom, 1-col form: category multiselect(+subcategory), brand autoselect (category-filtered, stone-optional), N/A model button, style autocomplete, colors multi-select w/ hex, `CurrencyInput` price/sale, discount toggle, reject = red button → modal (common-reason multi-select buttons + conditional-required reason). Bucket collage applies form to all its photos.

## Phase 4 — multiple-products masking
Wide shot with several products → draw a box per product → CF Images crop linked to original → each crop its own product.

**Reuses the Workshop clippings pipeline** (the wheel exists): `InspirationCanvas` (draws a source-px box) → normalize to 0..1 → `cropAndUploadCfImage(env, url, bbox)` (`services/render/cf-images.ts`, uses `env.IMAGES.input().transform({trim}).output()`, re-uploads a new CF asset) → linked DB row. Mirror of `POST /api/workshop/clippings/extract`.

**Design:** masking a `multi` bucket SPAWNS one `single` bucket per crop — each crop child then flows through the existing process + review path unchanged (no changes to process/review). The original wide photo stays as the multi bucket's parent.

- **DB (0104):** add nullable `parent_photo_id` (self-FK) + `crop_region` (json) to `product_showroom_photos`. Additive ADD COLUMN (no rebuild).
- **API:** `POST /api/intake/buckets/:id/regions` `{ sourcePhotoId, regions:[{bbox:{x,y,width,height} 0..1, label?}] }` → per region: `cropAndUploadCfImage` → new `single` bucket + one crop-child photo (`parentPhotoId`, `cropRegion`, same showroom). Returns the new buckets. Mark the multi bucket masked.
- **Frontend:** `MultiProductMasker` — fork `InspirationCanvas` to accumulate N labeled boxes over the wide photo; wired into the intake wizard for `multi`-kind buckets. Mirror `ExtractClippingDialog`.
