# Showroom Products + Materials Schedule — Schema & API Buildout

Build new D1 tables for `showroom_product_specs`, `showroom_product_images`, and a new `materials/` schema domain (`schedule_item`, `required_specs`). Update the existing `showroom_store_products` table with missing fields. Wire up full CRUD APIs for all showroom + materials entities.

## Proposed Changes

### 1. Showroom Schema — Update & New Tables

---

#### [MODIFY] [store_products.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/store_products.ts)

The existing table is missing many fields from the spec. The current schema has:
- `id`, `storeId`, `timestamp`, `itemName`, `description`, `colors`, `preferredColor`, `sku`, `price`, `jsonDetails`, `notes`, `leadTime`, `possibleDiscounts`, `tradeDiscount`, `createdAt`, `updatedAt`

**Fields to ADD** (mapping user's spec names to Drizzle columns):

| Spec field | Column name | Type | Notes |
|---|---|---|---|
| `date_scraped` | `dateScraped` | `integer (timestamp)` | Nullable — not all products are scraped |
| `showroom_id` | Already exists as `storeId` | — | FK to `showroomStores` already present |
| `material_id` | `materialId` | `integer` | FK to `materialScheduleItems.id` (new table) — nullable |
| `listed_price_per_unit` | `listedPricePerUnit` | `real` | Numeric price — replaces ambiguous `price` text field |
| `sale_price_per_unit` | `salePricePerUnit` | `real` | Nullable |
| `product_description` | Already exists as `description` | — | Already present |
| `brand_name` | `brandName` | `text` | New |
| `model_no` | `modelNo` | `text` | New |
| `product_url` | `productUrl` | `text` | New |
| `isFavorite` | `isFavorite` | `integer (boolean)` | Default `false` |
| `favorite_reason` | `favoriteReason` | `text` | Nullable |
| `isIgnored` | `isIgnored` | `integer (boolean)` | Default `false` |
| `ignore_reason` | `ignoreReason` | `text` | Nullable |
| `research_findings_json` | `researchFindingsJson` | `text` | JSON blob from Gemini Deep Research |
| `ai_score` | `aiScore` | `integer` | 1-5 range |
| `ai_rationale` | `aiRationale` | `text` | Nullable |

> [!NOTE]
> We'll keep existing columns intact (backwards-compatible). The existing `price` text field stays for legacy data; new numeric `listedPricePerUnit` / `salePricePerUnit` are the go-forward fields. `materialId` FK can't use `.references()` inline due to circular import risk — we'll use a forward reference comment and let Drizzle handle it at migration time.

---

#### [NEW] [product_specs.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/product_specs.ts)

```
showroom_product_specs
├── id (PK, auto)
├── showroom_product_id (FK → showroom_store_products.id, cascade)
├── date_scraped (timestamp, nullable)
├── key (text, not null — e.g. "Burner Zones")
├── value (text, not null — e.g. "3")
├── created_at (timestamp, default now)
```

---

#### [NEW] [product_images.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/product_images.ts)

```
showroom_product_images
├── id (PK, auto)
├── showroom_product_id (FK → showroom_store_products.id, cascade)
├── cf_image_url (text, not null)
├── type (enum: 'full_page_screenshot' | 'extracted_product_image')
├── created_at (timestamp, default now)
```

---

#### [MODIFY] [index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/index.ts)

Add re-exports for `product_specs` and `product_images`.

---

### 2. New Materials Schema Domain

---

#### [NEW] [materials/](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/materials/) (new directory)

#### [NEW] [materials/schedule_item.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/materials/schedule_item.ts)

```
material_schedule_items
├── id (PK, auto)
├── date_added (timestamp, default now)
├── title (text, not null — e.g. "Induction Cooktop")
├── brand (text, nullable)
├── model (text, nullable)
├── is_purchased (boolean, default false)
├── purchased_showroom_product_id (FK → showroom_store_products.id, nullable)
├── created_at (timestamp, default now)
├── updated_at (timestamp, default now)
```

#### [NEW] [materials/required_specs.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/materials/required_specs.ts)

```
material_required_specs
├── id (PK, auto)
├── material_id (FK → material_schedule_items.id, cascade)
├── date_added (timestamp, default now)
├── key (text, not null — e.g. "Burner Zones")
├── value (text, not null — e.g. "3")
├── created_at (timestamp, default now)
```

#### [NEW] [materials/index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/materials/index.ts)

Re-exports both tables.

---

#### [MODIFY] [schema/index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/index.ts)

Add `export * from "./materials/index"`.

---

### 3. API Routes

---

#### [MODIFY] [showroom-stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/showroom-stores.ts)

Add endpoints for product specs, product images, and update existing product CRUD to handle the new fields:

| Method | Path | Description |
|---|---|---|
| `DELETE` | `/:id/products/:pid` | Delete a product |
| `GET` | `/products/:pid/specs` | List specs for a product |
| `POST` | `/products/:pid/specs` | Add a spec to a product |
| `PUT` | `/products/:pid/specs/:sid` | Update a spec |
| `DELETE` | `/products/:pid/specs/:sid` | Delete a spec |
| `GET` | `/products/:pid/images` | List images for a product |
| `POST` | `/products/:pid/images` | Add an image to a product |
| `DELETE` | `/products/:pid/images/:iid` | Delete an image |
| `PUT` | `/products/:pid/favorite` | Toggle favorite with reason |
| `PUT` | `/products/:pid/ignore` | Toggle ignore with reason |

Update existing `createProductSchema` to include new fields.

---

#### [NEW] [materials.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/materials.ts)

Full CRUD + user-journey methods:

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List all material schedule items (with specs) |
| `GET` | `/:id` | Get single item with specs |
| `POST` | `/` | Create a new material item |
| `PUT` | `/:id` | Update a material item |
| `DELETE` | `/:id` | Delete a material item |
| `PUT` | `/:id/purchased` | Mark as purchased, link to showroom product |
| `GET` | `/:id/specs` | List required specs for a material |
| `POST` | `/:id/specs` | Add a required spec |
| `PUT` | `/:id/specs/:sid` | Update a required spec |
| `DELETE` | `/:id/specs/:sid` | Delete a required spec |
| `GET` | `/:id/match` | Find showroom products that match this material's required specs |

---

#### [MODIFY] [api/index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/index.ts)

Mount `materialsRouter` at `/api/materials`.

---

## Verification Plan

### Automated
```bash
pnpm run db:generate   # Verify migration generates cleanly
pnpm run build         # Verify no TypeScript errors
```

### Manual
- Confirm all new tables appear in the generated migration SQL
- Confirm existing `showroom_store_products` migration adds columns (not recreates)
- Spot-check API routes via Scalar/Swagger after deploy
