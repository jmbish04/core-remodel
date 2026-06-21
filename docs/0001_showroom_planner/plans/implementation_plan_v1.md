# Showroom Shopping Research Suite — Full D1 Schema + Custom Closets Integration

Build the complete showroom research database schema in Drizzle ORM (D1), seed closet manufacturers from `custom-closets.html`, and retrofit the closets HTML into an Astro + shadcn page integrated into the existing frontend.

## User Review Required

> [!IMPORTANT]
> **This is a large multi-phase build.** The schema alone defines ~20 new tables. We should execute in two waves to keep migrations clean and reviews manageable:
> - **Wave 1:** Schema + migrations + seed data
> - **Wave 2:** Frontend closets page + sidebar integration + barcode scanner tool

> [!WARNING]
> **Existing Shopping Journal overlap:** The current `shopping_journal_entries` table has simpler fields (company name, phone, email, etc). The new `showroom_stores` table is a superset. We have two options:
> 1. **Replace** `shopping_journal_entries` with the new `showroom_stores` + migrate existing data
> 2. **Coexist** — keep `shopping_journal_entries` for quick trip logs and add `showroom_stores` as the dedicated research-grade store database
>
> **Recommendation:** Option 2 (coexist). The journal is a lightweight capture tool; the new showroom stores system is a structured research database. They serve different purposes and can cross-link via `store_id` on journal entries later.

## Open Questions

> [!IMPORTANT]
> 1. **Barcode Scanner Scope:** Should the barcode scanner be a standalone page (`/admin/barcode-scanner`) or a modal tool accessible from the store product detail view? The mobile camera API integration (MediaDevices + AI vision workflow) is significant — should we defer it to a follow-up ticket?
> 2. **Auto-research trigger:** You mentioned research should kick off when a store or product is added. Should this use the existing `ResearchAgent` DO, or do you want a new `ShowroomResearchAgent` specifically for this domain?
> 3. **Bay Area cities seed data:** Should I pre-seed the `store_bayarea_cities` table with a standard list of Bay Area cities (SF, Oakland, San Jose, Palo Alto, etc.) and their distances from SF?

## Proposed Changes

### Component 1: Drizzle Schema — Showroom Tables

New schema directory: `src/backend/db/schema/showroom/`

#### [NEW] [index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/index.ts)
Barrel export for all showroom schema files.

#### [NEW] [stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/stores.ts)
```
showroom_stores — id, name, description, price_point ($|$$|$$$|$$$$),
  website_url, address, phone, store_email, poc_name, poc_email,
  created_at, updated_at
```

#### [NEW] [store_products.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/store_products.ts)
```
showroom_store_products — id, store_id FK, timestamp, item_name,
  description, colors, preferred_color, sku, price, json_details,
  notes, lead_time, possible_discounts, trade_discount,
  created_at, updated_at
```

#### [NEW] [bay_area_cities.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/bay_area_cities.ts)
```
store_bayarea_cities — id, bay_area_city_name, distance_from_san_francisco
store_bayarea_city_mapping — id, store_id FK, bay_area_city_id FK,
  weekday_hours, weekend_hours, is_open_saturdays, is_open_sundays,
  phone, address, website, zip_code, google_maps_link,
  distance_from_sf_time, distance_from_sf_miles, notes
```

#### [NEW] [product_docs.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/product_docs.ts)
```
store_product_docs — id, store_product_id FK, type (image|pdf),
  url, created_at
```

#### [NEW] [research.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/research.ts)
```
store_product_research — id, store_product_id FK, timestamp, finding,
  finding_url, sentiment (good|bad|neutral)
store_research — id, store_id FK, timestamp, finding, finding_url, sentiment
```

#### [NEW] [product_areas.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/product_areas.ts)
```
store_product_area_def — id, room_name, name, description, is_active
store_pa_mapping — id, store_id FK, product_area_id FK
store_product_pa_mapping — id, store_product_id FK, product_area_id FK
```

#### [NEW] [notes.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/notes.ts)
```
store_notes — id, store_id FK, timestamp, note, is_active
store_product_notes — id, store_product_id FK, timestamp, note, is_active
```

#### [NEW] [similar_maps.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/similar_maps.ts)
```
store_similar_map — id, parent_store_id FK, similar_store_id FK,
  similar_store_price_point, ai_analysis, ai_similarity_review_score,
  ai_similarity_review_score_rationale, user_feedback_notes,
  is_liked_by_user, user_rating_on_similarity [1-5],
  is_user_interested, user_interest_notes, timestamp

store_product_similar_model_map — id, parent_store_product_id FK,
  similar_store_product_id FK, similar_model_price,
  similar_model_price_diff, ai_analysis, ai_similarity_review_score,
  ai_similarity_review_score_rationale, user_feedback_notes,
  is_liked_by_user, user_rating_on_similarity [1-5],
  is_user_interested, user_interest_notes, timestamp
```

#### [NEW] [tags.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/tags.ts)
```
showroom_tag_def — id, name, description, color, parent_id (self-ref FK),
  is_active, is_store_tag_only, is_store_product_tag_only
store_tag_mapping — id, timestamp, showroom_tag_id FK, store_id FK
store_product_tag_mapping — id, timestamp, showroom_tag_id FK,
  store_product_id FK
```

#### [NEW] [ratings.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/ratings.ts)
```
store_rating — id, store_id FK, rating [1-5], rating_notes,
  is_active, replaced_by_id (self-ref FK)
store_product_rating — id, store_product_id FK, rating [1-5],
  rating_notes, is_active, replaced_by_id (self-ref FK)
```

---

### Component 2: Schema Barrel Export Update

#### [MODIFY] [index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/index.ts)
Add `export * from "./showroom/index"` to the barrel file.

---

### Component 3: Drizzle Migration

Run `drizzle-kit generate` to create the SQL migration for the ~20 new tables.

---

### Component 4: Closet Manufacturer Seed Data

Manufacturers extracted from [custom-closets.html](file:///Volumes/Projects/workers/core-remodel/proofs/research_app/custom-closets.html):

| Store | Price Point | Notes |
|-------|-------------|-------|
| **Poliform** | $$$$ | Italian craftsmanship, integrated leather-lined drawers, glass cabinetry, skincare refrigeration |
| **Lema** | $$$$ | Italian craftsmanship, similar to Poliform (luxury/bespoke tier) |
| **Avera by The Container Store** | $$$ | Floor-to-ceiling, specialized shoe storage, integrated LED lighting |
| **The Container Store (general)** | $$ | Premium turnkey systems |
| **IKEA PAX** | $ | Modular strategy, 29"/19" frames, pair with local finish carpenter |
| **Closet Factory** | $$$ | Costco 10% shop card rebate program, custom installation |

#### [NEW] [seed-closet-stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/seeds/seed-closet-stores.ts)
Script to insert the closet manufacturers as `showroom_stores` records with product area mapping to "closets".

---

### Component 5: Frontend — Custom Closets Astro Page

#### [NEW] [closets.astro](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/rooms/closets.astro)
Astro page wrapper that renders `ClosetResearchApp` inside `BaseLayout`.

#### [NEW] [ClosetResearchApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/ClosetResearchApp.tsx)
Full retrofit of `custom-closets.html` → React + shadcn dark theme:

- **Vision Section:** Hero with floorplan reference, spatial transformation description
- **Layout Explorer:** Interactive canvas (8 scenarios), scenario selector cards using `Card` + `Button`, detail panel
- **Vendor Boutique Gallery:** 3-tier vendor cards (Luxury / Premium / Budget) using shadcn `Card`, `Badge`
- **ROI & Charts Section:** Cost bar chart using Recharts (OKLCH palette), Costco rebate info card
- All styled in Monolith dark theme (zinc base, no traditional borders, ring+divider separation)

---

### Component 6: Sidebar Navigation Update

#### [MODIFY] [AppSidebar.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/AppSidebar.tsx)
Add "Shopping Research" section under Admin - Tools with:
- `{ href: "/rooms/closets", label: "Closet Research" }`

Or create a new nav group **"Shopping Research"** with closets as the first entry, extensible for future product areas (kitchen fixtures, bathroom tile, etc).

---

### Component 7: API Routes (Showroom CRUD)

#### [NEW] [showroom-stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/showroom-stores.ts)
Hono router with full CRUD:
- `GET /` — List all stores with tag counts, product counts, latest rating
- `GET /:id` — Store detail with products, tags, notes, ratings, bay area locations
- `POST /` — Create store + auto-trigger research pipeline
- `PUT /:id` — Update store
- `DELETE /:id` — Soft archive store
- `POST /:id/products` — Add product to store
- `GET /:id/products` — List products for store

#### [MODIFY] Main API router to mount `showroom-stores` at `/api/showroom-stores`.

---

## Verification Plan

### Automated Tests
```bash
pnpm drizzle-kit generate   # Verify migration SQL is clean
pnpm drizzle-kit push        # Apply to local D1 (dev)
```

### Manual Verification
- Verify all 20 tables created in D1 with correct FK relationships
- Navigate to `/rooms/closets` and confirm dark-theme closet research page renders
- Confirm sidebar shows new "Closet Research" link
- Verify seed data inserts the 6 closet manufacturers
- Verify the interactive layout canvas and chart render correctly in dark mode
