# Showroom Partner Brands — Walkthrough

## What was built

Full vertical slice for showroom partner brands: D1 schema → API → frontend → migration.

Updated per user feedback:
- **Product count is global** — counts unique products for a brand across ALL stores
- **Routes are global** — `/admin/brands` + `/admin/brands/[id]` (not store-scoped)
- **One brand per product** — `brandId` FK on products, brand link on product viewport

---

## Schema Changes

| File | Action | Description |
|------|--------|-------------|
| [brands.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/brands.ts) | **NEW** | `showroom_brands` table — UNIQUE slug for dedup, CF Images logo, avg rating, price point, country |
| [store_brand_mapping.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/store_brand_mapping.ts) | **NEW** | `store_brand_mapping` — many-to-many (store ↔ brand), UNIQUE(storeId, brandId) |
| [store_products.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/store_products.ts) | **MODIFIED** | Added optional `brandId` FK (1 brand per product, enforced) |
| [index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/index.ts) | **MODIFIED** | Exports the two new modules |

**Migration:** [0059_blue_mandrill.sql](file:///Volumes/Projects/workers/core-remodel/drizzle/0059_blue_mandrill.sql)

---

## API Changes

### [showroom-stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/showroom-stores.ts)

**Extended `GET /:id`** — response now includes `brands[]` with **global** product counts (count of unique products for each brand across ALL stores).

**New endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/brands` | All brands in system |
| `GET` | `/brands/:brandId` | Brand detail + ALL products + stores carrying it |
| `POST` | `/brands` | Create brand (agent use) |
| `GET` | `/:id/brands` | Brands at a store + global product counts |
| `GET` | `/:id/brands/:brandId` | Brand detail + ALL products (global) |
| `POST` | `/:id/brands` | Map brand to store (agent use, `onConflictDoNothing`) |

---

## Frontend Changes

| File | Action | Description |
|------|--------|-------------|
| [BrandShowcase.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/BrandShowcase.tsx) | **MODIFIED** | Removed `storeId` prop. Href now `/admin/brands/[id]`. Global product counts |
| [StoreViewportApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/StoreViewportApp.tsx) | **MODIFIED** | Renders `<BrandShowcase>` at page bottom (no storeId prop) |
| [BrandsDirectoryApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/BrandsDirectoryApp.tsx) | **NEW** | Global brand directory grid at `/admin/brands` |
| [BrandViewportApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/BrandViewportApp.tsx) | **REWRITTEN** | Global brand viewport at `/admin/brands/[id]`. Shows all products + stores carrying the brand |
| [ProductViewportApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/ProductViewportApp.tsx) | **MODIFIED** | Added `brandId`/`brandName` to Product interface + brand link in header |
| [brands.astro](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/admin/brands.astro) | **NEW** | `/admin/brands` directory page |
| [[id].astro](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/admin/brands/%5Bid%5D.astro) | **NEW** | `/admin/brands/[id]` detail page |
| `store/[storeId]/brand/[brandId].astro` | **DELETED** | Replaced by global brand route |

---

## Routing Map

```
/admin/brands                → BrandsDirectoryApp  (all brands grid)
/admin/brands/[id]           → BrandViewportApp    (brand detail + products + stores)
/admin/showroom/store/[id]   → StoreViewportApp    (store detail, BrandShowcase at bottom)
/admin/showroom/product/[id] → ProductViewportApp  (product detail, brand link in header)
```

Clicking a **brand** anywhere → `/admin/brands/[id]`
Clicking a **product** anywhere → `/admin/showroom/product/[id]`

---

## Verification

- `pnpm run db:generate` → migration `0059_blue_mandrill.sql` generated ✓
