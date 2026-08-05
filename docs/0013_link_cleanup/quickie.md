# Showroom Partner Brands — Schema, API, Agent Spec & UI

Adds a **brands** dimension to showrooms: each store advertises the brands it carries, the browser agent scrapes and deduplicates them during showroom website research, and the user can click a brand logo on a store page to drill into that brand's viewport (products, rating, website, etc.).

## User Review Required

> [!IMPORTANT]
> **Brand ↔ Store is many-to-many.** A brand like "Kohler" exists once in `showroom_brands`, but can be mapped to many stores via `store_brand_mapping`. The browser agent must check D1 before inserting — only create new brand rows for brands not yet in the system.

> [!IMPORTANT]
> **Brand logo storage via Cloudflare Images.** The agent uploads each brand's icon/logo to CF Images and stores the delivery URL in `showroom_brands.logoCfDeliveryUrl`. This is the same pattern used by `showroom_images` and `product_images`.

> [!WARNING]
> **The ecommerce32 component uses Next.js `Link` and `<img>`.** Both will be adapted to plain `<a>` and `<img>` (no framework router needed in Astro client islands).

## Open Questions

1. **Product count source:** The ecommerce32 template shows a "product count" per brand. Should this count come from `showroom_store_products` rows whose `brand` text column matches the brand name, or should we add a `brandId` FK on `showroom_store_products`? → **Proposed: add an optional `brand_id` FK** on `showroom_store_products` so the count is a real join, not a fuzzy text match.
2. **Brand viewport scope:** When clicking a brand on a *store* page, should the brand viewport show *only products at that store* or *all products across all stores* for that brand? → **Proposed: store-scoped** (URL pattern `/admin/showroom/store/[storeId]/brand/[brandId]`), but with a link to a global brand page later.

---

## Proposed Changes

### D1 Schema — New Tables

#### [NEW] [brands.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/brands.ts)

New `showroom_brands` table — one row per unique brand in the system.

```typescript
showroom_brands {
  id:                   integer PK autoIncrement
  name:                 text NOT NULL           // "Kohler", "Moen", "Delta", etc.
  slug:                 text NOT NULL UNIQUE     // URL-safe: "kohler", "moen"
  logoCfImageId:        text                     // Cloudflare Images ID
  logoCfDeliveryUrl:    text                     // CF Images delivery URL (displayed)
  websiteUrl:           text                     // https://www.kohler.com
  description:          text                     // Short brand description
  pricePoint:           text enum($,$$.$$$.$$$$) // Brand-level price positioning
  avgRating:            real                     // Average online rating (1.0–5.0)
  ratingCount:          integer default 0        // Number of ratings aggregated
  countryOfOrigin:      text                     // "USA", "Germany", etc.
  isActive:             boolean default true
  createdAt:            timestamp default now
  updatedAt:            timestamp default now
}
```

#### [NEW] [store_brand_mapping.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/store_brand_mapping.ts)

Many-to-many: `showroom_stores` ↔ `showroom_brands`.

```typescript
store_brand_mapping {
  id:        integer PK autoIncrement
  storeId:   integer FK → showroom_stores.id ON DELETE CASCADE
  brandId:   integer FK → showroom_brands.id ON DELETE CASCADE
  // UNIQUE(storeId, brandId) — no duplicate mappings
  createdAt: timestamp default now
}
```

#### [MODIFY] [store_products.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/store_products.ts)

Add optional `brandId` FK so products can be linked to brands for accurate counts.

```diff
+ brandId: integer("brand_id").references(() => showroomBrands.id, { onDelete: "set null" })
```

#### [MODIFY] [index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/index.ts)

Export the two new modules.

---

### API Routes

#### [MODIFY] [showroom-stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/showroom-stores.ts)

**1. Extend `GET /:id` response** to include `brands[]` — the store's brand list with logo URLs and product counts at this store.

The response gains:
```json
{
  "brands": [
    {
      "id": 1,
      "name": "Kohler",
      "slug": "kohler",
      "logoCfDeliveryUrl": "https://imagedelivery.net/…/kohler-logo/public",
      "websiteUrl": "https://www.kohler.com",
      "pricePoint": "$$$",
      "avgRating": 4.5,
      "productCount": 12
    }
  ]
}
```

**2. New endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/:storeId/brands` | List all brands at a store (with product counts) |
| `GET` | `/:storeId/brands/:brandId` | Brand detail + products at this store |
| `GET` | `/brands` | Global brand list (all brands in system) |
| `GET` | `/brands/:brandId` | Global brand detail |
| `POST` | `/brands` | Create a brand (used by agent) |
| `POST` | `/:storeId/brands` | Map a brand to a store (used by agent) |

---

### Agent Behavior Spec

#### [MODIFY] ShowroomResearchAgent — Brand Extraction During Website Scrape

When the `ShowroomResearchAgent` scrapes a showroom's website (during `researchStore()` or sourcing sweep), it should:

1. **Extract brand names** from the showroom page (look for "Brands We Carry", logo grids, brand listing sections, footer brand lists).
2. **For each extracted brand:**
   - Query `showroom_brands` by name (case-insensitive `LIKE` or normalized slug).
   - **If brand exists** → just create `store_brand_mapping` (if not already mapped).
   - **If brand is new** → download/extract the brand logo image → upload to CF Images → `INSERT` into `showroom_brands` with name, slug, logo delivery URL, website, price point, avg rating (from the page context or a quick search) → then create the `store_brand_mapping`.
3. **Deduplication is critical** — the agent must check before inserting. `showroom_brands.slug` has a UNIQUE constraint as the safety net.

This follows the same pattern as `showroom_images` (scrape → upload to CF Images → store delivery URL + metadata in D1).

---

### Frontend Components

#### [NEW] [BrandShowcase.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/BrandShowcase.tsx)

Adapted from the `ecommerce32` shadcn component. Shows a responsive grid of brand cards with:
- Brand logo (grayscale → color on hover)
- Brand name
- Product count at this store
- Click → navigates to `/admin/showroom/store/[storeId]/brand/[brandId]`

Used at the bottom of `StoreViewportApp`.

#### [MODIFY] [StoreViewportApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/StoreViewportApp.tsx)

- Add `brands` to the `StoreDetail` interface
- Fetch brands from the API response (already returned by extended `GET /:id`)
- Render `<BrandShowcase>` at the bottom of the page, below research findings

#### [NEW] [BrandViewportApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/BrandViewportApp.tsx)

Brand detail page showing:
- Brand header (logo, name, website, rating, price point)
- Products at this store for this brand (from `GET /:storeId/brands/:brandId`)
- Back link to the store page

#### [NEW] [brand/[brandId].astro](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/admin/showroom/store/[storeId]/brand/[brandId].astro)

Astro page wrapping `BrandViewportApp`.

#### [DELETE] [LogoCloud.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/LogoCloud.tsx)

The previous placeholder logo cloud with hardcoded SVGs is replaced by the data-driven `BrandShowcase`.

#### [DELETE] [brands.astro](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/admin/showroom/brands.astro)

The standalone brands page is replaced by inline brand showcase on store pages + per-brand viewport.

---

## Verification Plan

### Automated Tests
```bash
pnpm run drizzle:generate   # Generate migration for new tables
pnpm run dev                 # Verify dev server starts
```

### Manual Verification
1. Verify migration generates correctly for `showroom_brands`, `store_brand_mapping`, and the `brand_id` column on `showroom_store_products`
2. Seed a few test brands and mappings, verify the `GET /:storeId` response includes `brands[]`
3. Verify `StoreViewportApp` renders the brand grid at the bottom
4. Click a brand → navigates to brand viewport → shows products filtered by brand
5. Verify empty state when a store has no brands mapped

