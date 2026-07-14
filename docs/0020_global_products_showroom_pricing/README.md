# 0020 — Global Products + Per-Showroom Pricing (Subsystem A)

Products are now **global**: a product exists once (unique by `brandId` + normalized
`modelKey`), independent of any showroom. Showrooms carry products via
`showroom_product_mappings`; prices are per-source **observations**.

## What shipped

- **`showroom_store_products`**: dropped `storeId` (a product is never owned by a
  showroom); added `modelNumber`, `modelKey`, `msrp`, `msrpCents`; unique index on
  `(brandId, modelKey)`.
- **`product_price_observations`** (new): the "prices across showrooms" source of
  truth. `sourceType` = `showroom | online_retailer | manufacturer`; text + numeric
  pairs (`price`/`priceCents`, `salePrice`/`salePriceCents`, `discountInfo`/`discountPct`);
  `condition`, `leadTime`, `observedAt`, `sourcePhotoId`, HITL `reviewStatus`.
- **`product_showroom_photos`** (new): D1 half of a Vectorize pairing — unique
  `ragUuid` (shared with the vector's metadata), `attributes` JSON, `category`,
  `status`. A product accumulates photos across showrooms.
- **MCP tools**: `create_product`/`ensure_product` drop `storeId`, accept
  `modelNumber`/`msrp` (derive `modelKey`/`msrpCents`); `ensure_product` dedups on
  `(brandId, modelKey)` first. New `record_price_observation` / `list_price_observations`.
  `get_product` returns carrying showrooms (from mappings) + `priceObservations` + `photos`.
- **API**: product-detail route returns `priceObservations` (with showroom names) + `photos`.
  `/admin/shopping/products` serves the working global-products grid.

## Migration order (0089–0095) — apply via `pnpm run migrate:remote` ONLY

1. `0089` create `product_price_observations`
2. `0090` create `product_showroom_photos` + wire `sourcePhotoId` FK
3. `0091` add `modelNumber`/`modelKey`/`msrp`/`msrpCents`
4. `0092` backfill (model keys, mappings from old `storeId`, one observation per priced product, derive `priceCents`)
5. `0093` dedup by `(brandId, modelKey)`, re-point all 17 child tables
6. `0094` unique index `(brandId, modelKey)`
7. `0095` **cascade-safe** `storeId` drop — see the D1 gotcha below

## ⚠️ D1 gotcha baked into 0095

On D1, `DROP TABLE` fires `ON DELETE CASCADE` and `PRAGMA foreign_keys=OFF` /
`legacy_alter_table` are no-ops in wrangler's exec path — so a drizzle column-drop
rebuild **silently wipes child rows**. An empty local DB hides it. `0095` wraps the
rebuild in backup → rebuild → restore (INSERT for the 14 CASCADE children,
UPDATE-column-back for the 3 SET-NULL children). **Test destructive migrations against
a real `wrangler d1 export` snapshot loaded into local**, never an empty DB.

## Verify locally

`NODE_NO_WARNINGS=1 npx tsx scripts/tests/test_global_products.mjs` — helper units +
real-data backfill/dedup-integrity/0095/schema/observation checks. (Dedup re-pointing
and SET-NULL preservation were verified against injected synthetic fixtures during
Tasks 6 & 8; those asserts needed manual, non-persistent fixtures so they live in git
history + the task reports, not the reproducible smoke test.)

## Not in this subsystem

B (products page revamp: browse-by + dynamic filter sidebar + PDP with per-showroom
prices + similar products) and C (showroom-photo AI extraction + HITL + Vectorize) are
separate specs. `ProductsCatalogApp` is now orphaned (B decides its fate).
