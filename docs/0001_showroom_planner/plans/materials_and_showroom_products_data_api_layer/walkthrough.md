# Walkthrough — Showroom Products + Materials Schedule

## What Changed

### Schema Files (6 files)

#### Updated: [store_products.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/store_products.ts)
Added 14 new columns to `showroom_store_products`:
- `dateScraped`, `materialId` (FK to materials), `brandName`, `modelNo`, `productUrl`
- `listedPricePerUnit` (real), `salePricePerUnit` (real)
- `isFavorite`, `favoriteReason`, `isIgnored`, `ignoreReason`
- `researchFindingsJson`, `aiScore` (1–5), `aiRationale`

All existing columns preserved for backward compatibility.

#### New: [product_specs.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/product_specs.ts)
Key/value pairs for product specifications (e.g. "Burner Zones" → "3"). FK cascades from `showroom_store_products`.

#### New: [product_images.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/product_images.ts)
Product images on Cloudflare Images with type enum: `full_page_screenshot` | `extracted_product_image`.

#### New: [materials/schedule_item.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/materials/schedule_item.ts)
Master list of materials needed for the remodel. Links to showroom products when purchased via `purchasedShowroomProductId`.

#### New: [materials/required_specs.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/materials/required_specs.ts)
Key/value pairs for what specs a material must meet. Used by the spec-match endpoint.

#### New: [materials/index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/materials/index.ts)
Re-exports both materials tables.

---

### API Routes (2 files)

#### Updated: [showroom-stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/showroom-stores.ts)

New endpoints added:

| Method | Path | Description |
|---|---|---|
| `DELETE` | `/:id/products/:pid` | Delete a product |
| `GET` | `/products/:pid/specs` | List specs |
| `POST` | `/products/:pid/specs` | Add a spec |
| `POST` | `/products/:pid/specs/batch` | Batch add specs |
| `PUT` | `/products/:pid/specs/:sid` | Update a spec |
| `DELETE` | `/products/:pid/specs/:sid` | Delete a spec |
| `GET` | `/products/:pid/images` | List images |
| `POST` | `/products/:pid/images` | Add an image |
| `POST` | `/products/:pid/images/batch` | Batch add images |
| `DELETE` | `/products/:pid/images/:iid` | Delete an image |
| `PUT` | `/products/:pid/favorite` | Toggle favorite |
| `PUT` | `/products/:pid/ignore` | Toggle ignore |

Product detail (`GET /products/:pid`) now includes `specs` and `images` in the response.

#### New: [materials.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/materials.ts)

Mounted at `/api/materials` with auth. Full CRUD:

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List items (filterable: `?search=`, `?purchased=`) |
| `GET` | `/:id` | Detail with specs + linked product |
| `POST` | `/` | Create item |
| `PUT` | `/:id` | Update item |
| `DELETE` | `/:id` | Delete item (cascades specs) |
| `PUT` | `/:id/purchased` | Mark purchased + bi-directional link |
| `GET` | `/:id/specs` | List required specs |
| `POST` | `/:id/specs` | Add a required spec |
| `POST` | `/:id/specs/batch` | Batch add specs |
| `PUT` | `/:id/specs/:sid` | Update a spec |
| `DELETE` | `/:id/specs/:sid` | Delete a spec |
| `GET` | `/:id/match` | Find showroom products matching required specs |

---

### Routing: [api/index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/index.ts)
- Added `materialsRouter` import
- Mounted at `/api/materials`
- Added `requireAccessAuth` middleware for `/api/materials` and `/api/materials/*`

---

## Migration

Generated: `drizzle/0046_real_lady_bullseye.sql`
- 4 `CREATE TABLE` — product_specs, product_images, material_schedule_items, material_required_specs
- 14 `ALTER TABLE ADD` — all new columns on showroom_store_products
- All non-destructive, backward-compatible

## Verification

- ✅ `pnpm run build` — Server built in 11.48s
- ✅ `pnpm run db:generate` — Migration 0046 generated

## Next Steps

Run `pnpm run migrate:local` to apply the migration locally, then `pnpm run deploy` to ship.
