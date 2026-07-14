# Global Products + Per-Showroom Pricing — Design

**Date:** 2026-07-08
**Status:** Design approved (subsystem A); B and C outlined for follow-on specs
**Author:** Justin + Claude

---

## Problem

Products are currently modeled as **belonging to a showroom**. In
[`showroom_store_products`](../../../src/backend/db/schema/showroom/store_products.ts)
the `storeId` column is `NOT NULL`, so every product row is owned by exactly one
store, and its `price` is a single global value on that row. The
[`showroom_product_mappings`](../../../src/backend/db/schema/showroom/product_mappings.ts)
table that links a product to *additional* showrooms is a bare
`(showroomId, productId)` link carrying no price, discount, or notes.

This is backwards. **A product exists on its own.** A Toto smart toilet (a
specific model #) is one product in the world. Showrooms *sell* products but do
not *own* them — the same model seen at 3 showrooms is still one product. Pricing
is not a property of the product; it is a property of an **observation** made at a
particular source (a showroom price card you photograph, an online retailer, or the
manufacturer's MSRP).

## Goals

- A product exists **once**, independent of any showroom, uniquely identified by
  **brand + model #**.
- A product maps to **many showrooms** (pure "this showroom carries it" relation).
- A product accumulates **many photos** from every showroom visit.
- **Prices are observations** tied to a source (showroom / online retailer /
  manufacturer), each optionally backed by the photo it was read from, and each
  HITL-reviewable.
- **Every money/discount value is stored as a text + numeric pair** — the free-text
  field preserves what was seen ("$1,299", "call for pricing", "15% + floor model")
  and the numeric field (money = integer cents; discount = percent as real) makes
  prices actually comparable and sortable across showrooms.
- The revamped products experience (B) and the showroom-photo AI+HITL pipeline (C)
  build on top of this model.

## Non-goals (this spec)

- Subsystem **B** (products page revamp: browse-by, dynamic filter sidebar,
  purchased/wishlisted badges, PDP with per-showroom prices + similar products) —
  outlined below, gets its own spec.
- Subsystem **C** (showroom-photo AI extraction, Vectorize indexing of product
  visual qualities, HITL review UI + MCP tool) — outlined below, gets its own spec.

## Decomposition & sequencing

Three subsystems with a dependency order:

- **A — Global product model + per-showroom price observations** (this spec, the
  foundation). Ship first.
- **B — Products page revamp.** Depends on A. Parallel with C.
- **C — Showroom-photo AI extraction + HITL + vectorized qualities.** Depends on A.
  Parallel with B.

Decision: **build A first, then B + C in parallel** (separate worktrees / swarm).

## Money & discount convention (applies everywhere below)

Every price/discount is a **pair**:

- **Money** → a display text column (e.g. `price`) **plus** an integer-cents column
  (e.g. `priceCents`). Cents matches the budget domain and avoids float drift.
  Free text that isn't a number ("call for pricing") stores text with a `NULL`
  numeric.
- **Discount** → a display text column (e.g. `discountInfo`) **plus** a numeric
  percent column (`discountPct`, real, 0–100). A dollars-off markdown is captured in
  the text; the comparable percent goes in the numeric when derivable.

Numeric values are derived app-side from the text via `parsePriceCents()` /
`parseDiscountPct()` (see A6) and can be overridden explicitly. They are
best-effort and HITL-correctable.

---

## Subsystem A — Design

### A1. Product table (`showroom_store_products`, repurposed as the global product)

Repurpose the existing table in place (do **not** introduce a new `products`
table — everything downstream already keys on `showroom_store_products.id`:
`product_material_mappings`, `product_images`, `product_specs`,
`store_product_intel`, `store_product_research`, ratings, notes, docs).

Changes:

- **Drop `storeId` entirely.** A product is never owned by a showroom. (This is the
  core thesis — a product must be able to exist with no showroom at all.)
- **Add `modelNumber`** (text, nullable) — the real model identifier, promoted out
  of `jsonDetails`/`sku`.
- **Add `modelKey`** (text, nullable) — normalized model number (uppercased,
  whitespace/dashes stripped) maintained in app code; the field the unique index
  uses. Kept as a persisted column rather than a SQL expression index for
  drizzle-kit portability.
- **Add MSRP as a text + numeric pair** — `msrp` (text, display, nullable) plus
  `msrpCents` (integer cents, nullable) — manufacturer core/list price, comparable.
- The old global pricing columns (`price`, `possibleDiscounts`, `tradeDiscount`,
  `leadTime`) stop being the source of truth for price. They are **migrated down
  into observations** (see A5) and then left nullable/deprecated on the product row
  (kept for one release to avoid a destructive drop; removed in a later cleanup).

Uniqueness:

- **Unique index on `(brandId, modelKey)`.** The same brand + model # is one
  product. SQLite treats `NULL`s as distinct in unique indexes, so products with no
  model # yet (`modelKey IS NULL` — a generic stone slab, a paint chip) never
  collide and are **soft-deduped**: flagged as possible duplicates for HITL merge,
  never hard-blocked.
- Two different brands reusing the same model string are correctly distinct
  products (Toto `MS604` ≠ Kohler `MS604`).

### A2. Showroom ↔ product mapping (`showroom_product_mappings`) — unchanged

Stays exactly `(showroomId, productId)` with the existing unique index. Pure "this
showroom carries this product." No price, no notes. This matches the intended
mental model: the relation is the relation; pricing lives in observations.

### A3. Product photos (`product_showroom_photos`, new table)

The schema C will populate; defined here so A's migration and B's PDP can rely on
it. (We add a new table rather than overload the existing
[`product_images`](../../../src/backend/db/schema/showroom/product_images.ts),
which is scoped to scraped web imagery with its own source-URL uniqueness; field
capture is a different provenance.)

**This table is the D1 half of a Vectorize pairing.** Following the repo's existing
convention (`showroom_stores.ragUuid` ↔ `browser_run_pages.ragUuid` soft-linking D1
rows to Vectorize vectors), each photo row carries a **`ragUuid`** that is written
**both** onto the D1 row **and** onto the Vectorize vector's metadata in
`PHOTO_INDEX`. The vector holds the embedding; this D1 row holds the
AI-returned **structured attributes** (`attributes` JSON) for that same `ragUuid`.
A similar-products / visual-quality query hits Vectorize, gets back `ragUuid`s, and
joins to these rows for the human-readable attributes and status.

Columns:

- `id` (PK, autoincrement)
- **`ragUuid`** (text, **unique, NOT NULL**) — the join key shared with the
  Vectorize vector metadata in `PHOTO_INDEX`. 1:1 (one photo = one vector = one
  uuid).
- `productId` (FK → `showroom_store_products.id`, cascade delete)
- `showroomId` (FK → `showroom_stores.id`, **nullable** — a photo may come from an
  online source), set-null delete
- `imageUrl` (text) — path to the stored asset (Cloudflare Images delivery URL in
  the current pipeline; R2 object URL where originals are retained)
- `cfImageId` (text, nullable) — Cloudflare Images asset id
- `category` (text) — primary material category the photo depicts: `stone` |
  `plumbing` | `cabinet` | `flooring` | `lighting` | `tile` | … (aligned to the
  browse-by categories in B)
- `photoKind` (enum: `product` | `price_card` | `spec_sheet` | `unknown`)
- `attributes` (JSON) — the AI structured-response payload, e.g.
  `{"metal":"nickel","finish":"brushed","dominantColors":["#..."],"brand":"…",
  "modelNumber":"…","style":"…"}`. This is what B filters on and what "similar
  products" reads; per-field confidence included.
- `status` (enum: `pending_review` | `approved` | `rejected`, default
  `pending_review`) — HITL workflow state.
- `reviewReason` (text, nullable), `reviewedAt` (timestamp, nullable)
- `createdAt`, `updatedAt`

A product accumulates photos from every showroom where it was seen. `ragUuid` is
generated app-side at upload time and used as the Vectorize vector id/metadata key
so the two stores stay joinable without storing the embedding in D1.

> Note: `product_price_observations.sourcePhotoId` (A4) references
> `product_showroom_photos.id`; the extracted `price`/`salePrice`/`discountInfo`
> that seed an observation come out of this row's `attributes`.

### A4. Price observations (`product_price_observations`, new table)

The "different prices found across showrooms" source of truth. Per the money &
discount convention, every price/discount is a text + numeric pair.

Columns:

- `id` (PK)
- `productId` (FK → `showroom_store_products.id`, cascade delete)
- `sourceType` (enum: `showroom` | `online_retailer` | `manufacturer`)
- `showroomId` (FK → `showroom_stores.id`, nullable — set when `sourceType =
  showroom`), set-null delete
- `retailerName` (text, nullable), `retailerUrl` (text, nullable) — set when
  `sourceType = online_retailer`
- `price` (text) **+ `priceCents`** (integer cents, nullable)
- `salePrice` (text, nullable) **+ `salePriceCents`** (integer cents, nullable)
- `discountInfo` (text, nullable) **+ `discountPct`** (real percent 0–100, nullable)
- `condition` (enum: `new` | `floor_model` | `clearance` | `as_is`, nullable)
- `leadTime` (text, nullable), `notes` (text, nullable)
- `observedAt` (timestamp) — visit / capture / scrape date
- `sourcePhotoId` (FK → `product_showroom_photos.id`, nullable) — the price-card
  photo this was read from, when there is one
- `confidence` (integer 0–100, default 100 for manual entry)
- `reviewStatus` (enum: `pending` | `approved` | `rejected`, default `pending`) —
  HITL; manual entries may default to `approved`
- `reviewReason` (text, nullable), `reviewedAt` (timestamp, nullable)
- `createdAt`, `updatedAt`

Notes:

- MSRP is stored **both** as `msrp`/`msrpCents` on the product (the canonical
  manufacturer price) and, when captured as a dated observation, as a
  `sourceType=manufacturer` row. The product MSRP is the display default;
  observations are history.
- `priceCents` / `salePriceCents` / `discountPct` are the comparison keys B sorts
  and range-filters on. They are derived from the text via `parsePriceCents()` /
  `parseDiscountPct()` at write time (overridable).
- Product-level *reference/market* pricing (AI retail/wholesale/negotiated + range)
  continues to come from the existing
  [`store_product_intel`](../../../src/backend/db/schema/showroom/product_intel.ts)
  table — unchanged and complementary to observations.

### A5. Migration & backfill

Ordered, best-effort, HITL-cleanupable:

1. Create `product_showroom_photos` and `product_price_observations`; add
   `modelNumber`, `modelKey`, `msrp`, `msrpCents` to `showroom_store_products`.
2. **Backfill `modelNumber`/`modelKey`** from existing `sku`/`jsonDetails` where a
   model # is recoverable; leave null otherwise (those stay un-deduped, flagged).
3. **Backfill observations:** for each existing product with a non-null `price`,
   insert one `product_price_observations` row (`sourceType=showroom`,
   `showroomId = old storeId`, `price`/`possibleDiscounts→discountInfo`/
   `tradeDiscount`/`leadTime` copied, `observedAt = updatedAt`,
   `reviewStatus=approved`), then **derive `priceCents`** from the text price
   (strip `$`/commas, cast, ×100) for the numeric comparison column.
4. **Backfill mappings:** ensure every product's old `storeId` exists as a
   `showroom_product_mappings` row (idempotent upsert).
5. **Dedup by `(brandId, modelKey)`:** where duplicates exist (same brand+model
   across old per-store rows), pick a survivor, re-point child rows
   (mappings/observations/photos/materials/specs/intel/research) to it, delete the
   losers. Products with null `modelKey` are **not** auto-merged — surfaced in the
   HITL merge queue.
6. **Drop `storeId`** from `showroom_store_products` (after 1–5 verified).

Because the project's rule is `pnpm run migrate:remote` only (never
`wrangler d1 execute --file`), schema changes go through drizzle-kit generated
migrations; the data backfill/dedup (steps 2–5) runs as a scripted migration in the
same discipline.

### A6. MCP tool + API surface changes

- `create_product` / `ensure_product` (`src/backend/mcp/tools/products.ts`):
  **remove `storeId` requirement.** `ensure_product` dedups on `(brandId,
  modelKey)` first, then falls back to `(brandId, itemName)`. Accept `modelNumber`,
  `msrp` (and derive `msrpCents` via `parsePriceCents`).
- **New money helpers** (`src/backend/lib/money.ts`): `parsePriceCents(text)` →
  integer cents | null; `parseDiscountPct(text)` → real percent | null. Used by the
  tools and the backfill's app-side equivalents.
- `link_product_to_showroom`: unchanged (stays a bare link).
- **New:** `record_price_observation` MCP tool + `POST` route — create an
  observation (showroom / online / manufacturer) for a product; accepts text
  price/salePrice/discount and derives the numeric pair (or takes explicit
  `priceCents`/`salePriceCents`/`discountPct`); optional `sourcePhotoId`.
- **New:** `list_price_observations` (or fold into `get_product`) so B can render
  "prices across showrooms."
- `get_product` response gains: `msrp`/`msrpCents`, `modelNumber`,
  `priceObservations[]` (grouped by source, with numeric fields), `photos[]`.
- `mark_material_purchased.purchasedShowroomProductId` — still valid; product ids
  are preserved through dedup (survivor id).

### A7. Edge cases & risks

- **Two products, same brand, one has model # and one doesn't** → not auto-merged;
  HITL merge queue.
- **Model # typos across visits** create false distinct products → `modelKey`
  normalization reduces but won't eliminate; HITL merge covers the rest.
- **Unparseable prices** ("call for pricing") → text stored, numeric `NULL`; never
  block the write on a failed parse.
- **Dedup re-pointing** must move *all* child FKs (materials, images, specs, intel,
  research, ratings, notes, docs, wishlist links) — enumerate exhaustively in the
  migration script and assert zero orphans after.
- **`store_product_intel` is 1:1 on product** — on dedup, keep survivor's intel;
  don't create duplicate-key violations.

### A8. Testing

- Migration test on a copy of prod-shaped data: assert row counts before/after,
  zero orphaned child rows, no unique-index violations, `storeId` gone.
- Unit: `modelKey` normalization; `parsePriceCents` / `parseDiscountPct`;
  `ensure_product` dedup precedence.
- Route/MCP: create product without storeId; record observations from all three
  source types with text→numeric derivation; `get_product` returns grouped
  observations (with numeric fields) + photos.
- Vectorize↔D1 pairing: a `ragUuid` written to `PHOTO_INDEX` metadata resolves to
  exactly one `product_showroom_photos` row and back; `attributes` JSON round-trips.

---

## Subsystem B — Products page revamp (outline, own spec)

- Route `/admin/shopping/products` becomes a **browse-by** entry: toggle **by room**
  / **by category** (plumbing, stone, flooring, lighting…) / **by materials still
  needing a registered product** (a material with no linked *purchased* product).
- After a browse selection: product listing + **dynamic filter sidebar** (the
  `ecommerce27` shadcn component + provided `FilterSidebar`), facets derived from
  the underlying products (brand, color/quality, **price range** — driven by the
  numeric `priceCents`, product type, showroom, plus **purchased** and
  **wishlisted** toggles).
- Product cards show **purchased** and **wishlisted** attributes (from
  `mark_material_purchased` / wishlist tables).
- Clicking a product opens the existing
  [ProductViewportApp](../../../src/frontend/components/showroom/ProductViewportApp.tsx)
  PDP, extended to list **showrooms where it was registered + the different prices
  across them** (from `product_price_observations`, sorted by `priceCents`) and
  **similar products** (from Vectorize visual-quality search, provided by C).
  Add-to-wishlist from this view.

## Subsystem C — Showroom-photo AI + HITL + vectorized qualities (outline, own spec)

- Uploading showroom-visit photos (incl. Google Photos Picker import) →
  **Cloudflare Images** → AI processing that extracts **brand, item/model #, color,
  product name, style, price, discount %** from price-card photos, and captures
  **color/visual qualities** + **Vectorize embeddings** (`PHOTO_INDEX`) for
  stone/paint/lighting so products are searchable by visual quality and PDPs can show
  similar products.
- Each processed photo writes a **shared `ragUuid`** onto both the Vectorize vector
  metadata and its `product_showroom_photos` D1 row (A3), storing the AI structured
  response in `attributes` JSON. Similar-products/quality search queries Vectorize,
  then joins returned `ragUuid`s back to D1 for attributes + status. This mirrors the
  existing `browser_run_pages.ragUuid` pattern.
- Extracted prices/discounts flow into `product_price_observations` as the text +
  numeric pair (numeric derived by the same helpers).
- New/unmatched extractions **auto-create the global product** (from A) and queue it
  for **HITL review**; observations and photos land `pending`.
- HITL review surface (extend `/admin/prepare/review` patterns) **and an MCP tool**
  to review/edit/confirm extracted brand/model/color/price/discount per photo.
- Reuses the existing image-processor workflow
  (`src/backend/services/image-processor/*`) and vision/structured models.

---

## Open questions (non-blocking for A)

- Exact facet set + defaults for B's dynamic sidebar (deferred to B spec).
- Whether MSRP capture from manufacturers is manual-only initially or has a research
  step (deferred to C spec).
