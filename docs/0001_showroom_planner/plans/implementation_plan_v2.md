# Showroom Shopping Research Suite — Full D1 Schema + Barcode Scanner + AI Research Agent

Build the complete showroom research database (Drizzle ORM / D1), barcode scanning pipeline with offline sync, a specialized ShowroomResearchAgent DO, seed data from the showroom research doc, and retrofit the closets HTML into Astro + shadcn.

---

## Decisions Resolved (Per User Feedback)

| Question | Decision |
|----------|----------|
| Shopping Journal overlap | **Coexist.** Stores are independent entities. Add `store_id` FK to `shopping_journal_entries` for `store:journal_entries [1:M]`. |
| Barcode scanner scope | **Modal dialog** using `@zxing/library` inside shadcn `Dialog`. iOS-optimized (`playsInline`, `facingMode: "environment"`). Includes offline `localStorage` queue with auto-sync. |
| Research auto-trigger | **New `ShowroomResearchAgent` DO** — specialized for moodboard-aware advice, compatibility checking, review aggregation, cost-saving analysis, and vendor gap detection. |
| Bay Area cities seed | **Yes** — pre-seed from [showroom_research.md](file:///Volumes/Projects/workers/core-remodel/docs/0001_showroom_planner/showroom_research.md) geographic hubs. |

---

## Proposed Changes

### Wave 1: Database Schema (Drizzle ORM)

New schema directory: `src/backend/db/schema/showroom/`

---

#### [NEW] [index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/index.ts)
Barrel export for all showroom schema files.

#### [NEW] [stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/stores.ts)
```
showroom_stores
  id            INTEGER PK autoincrement
  name          TEXT NOT NULL
  description   TEXT
  price_point   TEXT enum [$, $$, $$$, $$$$]
  website_url   TEXT
  address       TEXT
  phone         TEXT
  store_email   TEXT
  poc_name      TEXT
  poc_email     TEXT
  created_at    INTEGER timestamp
  updated_at    INTEGER timestamp
```

#### [NEW] [store_products.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/store_products.ts)
```
showroom_store_products
  id                 INTEGER PK autoincrement
  store_id           INTEGER FK → showroom_stores
  timestamp          INTEGER timestamp
  item_name          TEXT NOT NULL
  description        TEXT
  colors             TEXT
  preferred_color    TEXT
  sku                TEXT
  price              TEXT
  json_details       TEXT (JSON)
  notes              TEXT
  lead_time          TEXT
  possible_discounts TEXT
  trade_discount     TEXT
  created_at         INTEGER timestamp
  updated_at         INTEGER timestamp
```

#### [NEW] [bay_area_cities.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/bay_area_cities.ts)
```
store_bayarea_cities
  id                         INTEGER PK autoincrement
  bay_area_city_name         TEXT NOT NULL UNIQUE
  distance_from_san_francisco TEXT

store_bayarea_city_mapping
  id                     INTEGER PK autoincrement
  store_id               INTEGER FK → showroom_stores
  bay_area_city_id       INTEGER FK → store_bayarea_cities
  weekday_hours          TEXT
  weekend_hours          TEXT
  is_open_saturdays      INTEGER (boolean)
  is_open_sundays        INTEGER (boolean)
  phone                  TEXT
  address                TEXT
  website                TEXT
  zip_code               TEXT
  google_maps_link       TEXT
  distance_from_sf_time  TEXT
  distance_from_sf_miles TEXT
  notes                  TEXT
```

#### [NEW] [product_docs.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/product_docs.ts)
```
store_product_docs
  id                INTEGER PK autoincrement
  store_product_id  INTEGER FK → showroom_store_products
  type              TEXT enum [image, pdf]
  url               TEXT NOT NULL
  created_at        INTEGER timestamp
```

#### [NEW] [research.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/research.ts)
```
store_product_research
  id                INTEGER PK autoincrement
  store_product_id  INTEGER FK → showroom_store_products
  timestamp         INTEGER timestamp
  finding           TEXT NOT NULL
  finding_url       TEXT
  sentiment         TEXT enum [good, bad, neutral]

store_research
  id          INTEGER PK autoincrement
  store_id    INTEGER FK → showroom_stores
  timestamp   INTEGER timestamp
  finding     TEXT NOT NULL
  finding_url TEXT
  sentiment   TEXT enum [good, bad, neutral]
```

#### [NEW] [product_areas.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/product_areas.ts)
```
store_product_area_def
  id          INTEGER PK autoincrement
  room_name   TEXT NOT NULL (kitchen, bathroom, outdoor, closet, etc.)
  name        TEXT NOT NULL (faucet, vanity, tile, cabinet, etc.)
  description TEXT
  is_active   INTEGER (boolean) DEFAULT 1

store_pa_mapping
  id              INTEGER PK autoincrement
  store_id        INTEGER FK → showroom_stores
  product_area_id INTEGER FK → store_product_area_def

store_product_pa_mapping
  id              INTEGER PK autoincrement
  store_product_id INTEGER FK → showroom_store_products
  product_area_id  INTEGER FK → store_product_area_def
```

#### [NEW] [notes.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/notes.ts)
```
store_notes
  id        INTEGER PK autoincrement
  store_id  INTEGER FK → showroom_stores
  timestamp INTEGER timestamp
  note      TEXT NOT NULL
  is_active INTEGER (boolean) DEFAULT 1

store_product_notes
  id               INTEGER PK autoincrement
  store_product_id INTEGER FK → showroom_store_products
  timestamp        INTEGER timestamp
  note             TEXT NOT NULL
  is_active        INTEGER (boolean) DEFAULT 1
```

#### [NEW] [similar_maps.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/similar_maps.ts)
```
store_similar_map
  id                                   INTEGER PK autoincrement
  parent_store_id                      INTEGER FK → showroom_stores
  similar_store_id                     INTEGER FK → showroom_stores
  similar_store_price_point            TEXT
  ai_analysis                          TEXT
  ai_similarity_review_score           INTEGER
  ai_similarity_review_score_rationale TEXT
  user_feedback_notes                  TEXT
  is_liked_by_user                     INTEGER (boolean)
  user_rating_on_similarity            INTEGER [1-5]
  is_user_interested                   INTEGER (boolean)
  user_interest_notes                  TEXT
  timestamp                            INTEGER timestamp

store_product_similar_model_map
  id                                   INTEGER PK autoincrement
  parent_store_product_id              INTEGER FK → showroom_store_products
  similar_store_product_id             INTEGER FK → showroom_store_products
  similar_model_price                  TEXT
  similar_model_price_diff             TEXT
  ai_analysis                          TEXT
  ai_similarity_review_score           INTEGER
  ai_similarity_review_score_rationale TEXT
  user_feedback_notes                  TEXT
  is_liked_by_user                     INTEGER (boolean)
  user_rating_on_similarity            INTEGER [1-5]
  is_user_interested                   INTEGER (boolean)
  user_interest_notes                  TEXT
  timestamp                            INTEGER timestamp
```

#### [NEW] [tags.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/tags.ts)
```
showroom_tag_def
  id                       INTEGER PK autoincrement
  name                     TEXT NOT NULL
  description              TEXT
  color                    TEXT
  parent_id                INTEGER FK → showroom_tag_def (self-ref)
  is_active                INTEGER (boolean) DEFAULT 1
  is_store_tag_only        INTEGER (boolean) DEFAULT 0
  is_store_product_tag_only INTEGER (boolean) DEFAULT 0

store_tag_mapping
  id              INTEGER PK autoincrement
  timestamp       INTEGER timestamp
  showroom_tag_id INTEGER FK → showroom_tag_def
  store_id        INTEGER FK → showroom_stores

store_product_tag_mapping
  id              INTEGER PK autoincrement
  timestamp       INTEGER timestamp
  showroom_tag_id INTEGER FK → showroom_tag_def
  store_product_id INTEGER FK → showroom_store_products
```

#### [NEW] [ratings.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/ratings.ts)
```
store_rating
  id              INTEGER PK autoincrement
  store_id        INTEGER FK → showroom_stores
  rating          INTEGER [1-5]
  rating_notes    TEXT
  is_active       INTEGER (boolean) DEFAULT 1
  replaced_by_id  INTEGER FK → store_rating (self-ref)

store_product_rating
  id              INTEGER PK autoincrement
  store_product_id INTEGER FK → showroom_store_products
  rating          INTEGER [1-5]
  rating_notes    TEXT
  is_active       INTEGER (boolean) DEFAULT 1
  replaced_by_id  INTEGER FK → store_product_rating (self-ref)
```

#### [NEW] [scan_log.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/scan_log.ts)

> [!IMPORTANT]
> **New table per user feedback.** Every barcode scan or product image upload is logged here — whether or not extraction succeeds. This creates a durable audit trail for the AI pipeline.

```
showroom_scan_log
  id                      INTEGER PK autoincrement
  is_barcode              INTEGER (boolean) — was a barcode detected?
  cf_image_url            TEXT — Cloudflare Images URL of the uploaded photo
  r2_key                  TEXT — R2 key if stored as artifact
  barcode_decoded_value   TEXT — raw barcode string (null if image-only)
  price                   TEXT — extracted price (if found)
  json_extracted_data     TEXT (JSON) — full structured extraction from AI
  ai_rationale            TEXT — model's explanation of what it found/couldn't find
  ai_model_used           TEXT — which model processed this scan
  extraction_status       TEXT enum [success, partial, failed]
  matched_store_product_id INTEGER FK → showroom_store_products (null if new)
  auto_created_product_id  INTEGER FK → showroom_store_products (null if matched existing)
  store_id                INTEGER FK → showroom_stores (context: which store scan was taken at)
  scanned_at              INTEGER timestamp DEFAULT (unixepoch())
```

---

#### [MODIFY] [shopping_journal.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/home/shopping_journal.ts)

Add optional FK to link journal entries to showroom stores:

```diff
 // Business/Showroom details
 companyName: text("company_name").notNull(),
+storeId: integer("store_id").references(() => showroomStores.id, { onDelete: "set null" }),
 phoneNumber: text("phone_number"),
```

This establishes the `store:journal_entries [1:M]` relationship.

---

#### [MODIFY] [index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/index.ts)

Add `export * from "./showroom/index"` to the barrel file.

---

### Wave 2: Seed Data

#### [NEW] [seed-bay-area-cities.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/seeds/seed-bay-area-cities.ts)

Pre-seed `store_bayarea_cities` from geographic hubs in [showroom_research.md](file:///Volumes/Projects/workers/core-remodel/docs/0001_showroom_planner/showroom_research.md):

| Hub | Cities |
|-----|--------|
| **A: SF Design District** | San Francisco |
| **B: Silicon Valley** | San Jose, Santa Clara, Menlo Park, Palo Alto |
| **C: Peninsula** | San Carlos, Belmont, San Mateo, Redwood City |
| **D: East Bay** | Oakland, Berkeley, Emeryville, Alameda, Hayward, Fremont, Dublin, Walnut Creek, San Leandro |
| **E: North Bay** | Novato, Mill Valley, San Rafael |
| **Other** | San Bruno, Sausalito |

#### [NEW] [seed-showroom-stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/seeds/seed-showroom-stores.ts)

Seed 30+ stores extracted from `showroom_research.md`:

| Store | Category | Price Point | City |
|-------|----------|-------------|------|
| Whole Wood | Flooring | $$$ | San Carlos |
| Argonaut Window & Door | Windows/Doors | $$$$ | San Carlos |
| Pacific Sash & Design | Windows/Doors | $$$$ | San Carlos |
| Wedlock Windows | Windows/Doors | $$ | San Carlos |
| California Closets | Closets | $$$ | San Carlos |
| Studio Belmont (Flagship) | Plumbing/Hardware | $$$$ | Belmont |
| Studio Belmont (SF) | Plumbing/Hardware | $$$$ | San Francisco |
| Studio Belmont (San Jose) | Plumbing/Hardware | $$$$ | San Jose |
| Studio Belmont (Walnut Creek) | Plumbing/Hardware | $$$ | Walnut Creek |
| Studio Belmont (Novato) | Plumbing/Hardware | $$$ | Novato |
| Lutz Bath & Kitchen | Plumbing/Steam | $$$$ | San Francisco |
| Townsend Showroom | Bath/Vanities | $$$$ | San Francisco |
| Porcelanosa | Tile/Porcelain | $$$$ | San Francisco |
| Nido Living (Rimadesio) | Closets/Luxury | $$$$ | San Francisco |
| Insensation Inc. | Frameless Doors | $$$$ | San Francisco |
| Italdoors | Frameless Doors | $$$ | San Francisco / San Bruno |
| Concreteworks | Precast Concrete | $$$$ | Alameda |
| Tredi Interiors | Kitchen/InvisaCook | $$$$ | Santa Clara |
| America's Dream HomeWorks | Kitchen/PITT Cooking | $$$ | Emeryville |
| Topcret | Microcement | $$$ | San Francisco / San Jose |
| Duraamen | Microcement | $$$ | Hayward |
| Craftex Microcement | Microcement | $$$ | San Francisco |
| Archetype Lighting | Architectural Lighting | $$$$ | San Francisco |
| Petty Masonry Inc. | Deck/Pedestal | $$$ | Bay Area |
| Tile Tech Pavers | Deck/Porcelain | $$$ | San Francisco |
| Archatrak | Deck/Pedestal | $$$ | Bay Area |

Plus closet manufacturers from [custom-closets.html](file:///Volumes/Projects/workers/core-remodel/proofs/research_app/custom-closets.html):

| Store | Category | Price Point |
|-------|----------|-------------|
| Poliform | Closets/Luxury | $$$$ |
| Lema | Closets/Luxury | $$$$ |
| Avera by The Container Store | Closets | $$$ |
| The Container Store | Closets | $$ |
| IKEA PAX | Closets | $ |
| Closet Factory | Closets | $$$ |

Each store gets a `store_bayarea_city_mapping` entry with address, phone, hours, and notes from the research doc.

#### [NEW] [seed-product-areas.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/seeds/seed-product-areas.ts)

Pre-seed `store_product_area_def` with categories from the research doc:

| Room | Product Areas |
|------|--------------|
| Bathroom | Plumbing, Vanities, Toilets, Steam/Shower, Shower Glass, Tile |
| Kitchen | Cabinets, Countertops, Sinks, Faucets, Appliances, Induction, Gas Cooking, Pantry |
| Closet | Walk-in Systems, LED Integration, Custom Millwork |
| Living | Lighting, Architectural Trim, Doors (Interior), Doors (Exterior) |
| Exterior | Windows, Patio Doors, Decking/Pavers, Landscaping, Corten Steel |
| General | Microcement, Concrete, Drywall Reveals, Flooring |

---

### Wave 3: Backend — API Routes + ShowroomResearchAgent

#### [NEW] [showroom-stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/showroom-stores.ts)

Hono router mounted at `/api/showroom-stores`:

| Method | Path | Description |
|--------|------|-------------|
| `GET /` | List stores | With tag counts, product counts, latest rating, city mapping |
| `GET /:id` | Store detail | Full store with products, tags, notes, ratings, locations, research |
| `POST /` | Create store | **Triggers ShowroomResearchAgent** via `waitUntil` |
| `PUT /:id` | Update store | |
| `DELETE /:id` | Soft archive | |
| `GET /:id/products` | List products | For a given store |
| `POST /:id/products` | Add product | **Triggers ShowroomResearchAgent** via `waitUntil` |
| `PUT /:id/products/:pid` | Update product | |
| `POST /scan` | Process scan | Barcode/image upload → AI pipeline → scan_log |
| `GET /scan/log` | Scan history | List all scan_log entries |
| `GET /gaps` | Category gaps | AI-identified missing vendor categories |
| `GET /cities` | Bay Area cities | List all seeded cities |

#### [NEW] [showroom-scan.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/showroom-scan.ts)

Dedicated scan processing endpoint:

```
POST /api/showroom-stores/scan
Body: { images: string[] (base64), store_id?: number }

Pipeline:
1. Try native barcode decode (zxing-wasm on edge)
2. If barcode found → decode SKU → search D1 for existing product match
3. If no barcode → Cloudflare Workers AI VLM (@cf/moonshotai/kimi-k2.6)
   → Extract: product_name, brand, price, dimensions, color_finish, description
4. Query D1 to check if product already exists (fuzzy match on name + store + description)
5. If new → auto-create showroom_store_products row
6. If existing → return matched product
7. ALWAYS log to showroom_scan_log (success, partial, or failed)

Response: { success, scan_log_id, match_type: "barcode"|"ai_vision"|"failed",
            product: {...} | null }
```

#### [NEW] [ShowroomResearchAgent.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/agents/ShowroomResearchAgent.ts)

Specialized Durable Object using `@cloudflare/agents` SDK:

**Capabilities:**

1. **Product Review Aggregation** — Web search for reviews, ratings, warranty info on added products
2. **Compatibility Checking** — Cross-reference products against each other and room plans
   - Example: *"InvisaCook requires a specific 12-20mm porcelain slab (Porcelanosa-certified). It is NOT compatible with marble, granite, or natural stone countertops."*
3. **Moodboard-Aware Style Advice** — Query existing `mood_boards` and `inspirational_image_rooms` tables to understand user style, then advise on how a product fits the intended room
4. **Cost-Saving Analysis** — Suggest trade discounts, Costco rebate programs, bulk purchasing, seasonal sales
5. **Similar Product Discovery** — Find comparable products at different price points, populate `store_product_similar_model_map`
6. **Vendor Category Gap Detection** — Analyze `store_product_area_def` against tracked stores, identify missing categories:
   - *"You have no concrete contractor tracked. Would you like me to search for concrete contractors in the Bay Area?"*
   - Surface gaps in frontend with actionable "Search for this" buttons

**Triggers:**
- `store.created` → Research store reputation, reviews, verify hours/address
- `product.created` → Research product reviews, find similar products, check compatibility
- `scan.processed` → If new product auto-created, run full research pipeline
- `user.request` → Manual "Research this" button on any store/product card

---

### Wave 4: Frontend

#### [NEW] [BarcodeScanner.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/BarcodeScanner.tsx)

iOS-compatible barcode scanner using `@zxing/library` + shadcn Dialog:

- `facingMode: "environment"` for rear camera
- `playsInline`, `muted`, `autoPlay` attributes on `<video>` for iOS Safari
- Viewfinder overlay with scanning markers
- `onScanSuccess` callback → pipes to offline queue or direct API call

#### [NEW] [useOfflineBarcodeSync.ts](file:///Volumes/Projects/workers/core-remodel/src/frontend/hooks/useOfflineBarcodeSync.ts)

localStorage-based offline queue:

- Queue scanned codes/images when offline
- Auto-sync via `navigator.onLine` + `"online"` event listener
- Visual indicator: *"3 scans waiting for internet connectivity..."*
- Batch POST to `/api/showroom-stores/scan`

#### [NEW] [closets.astro](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/rooms/closets.astro)

Astro page wrapper rendering `ClosetResearchApp` inside `BaseLayout`.

#### [NEW] [ClosetResearchApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/ClosetResearchApp.tsx)

Full retrofit of `custom-closets.html` → React + shadcn Monolith dark theme:

- Vision section with floorplan reference
- Layout Explorer: 8 scenarios with interactive selector cards
- Vendor Boutique Gallery: 3-tier vendor cards (Luxury / Premium / Budget)
- ROI & Charts section using Recharts (OKLCH palette)
- All Monolith: zinc base, no traditional borders, ring + divider separation

#### [NEW] [ShowroomDashboard.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/ShowroomDashboard.tsx)

Main showroom management view:

- Store list with search/filter by city, price point, product area
- Add Store form with barcode scanner integration
- Product list per store with scan-to-add
- **Gap Analysis panel** — AI-identified missing categories with "Search for this" CTAs
- Research status indicators per store/product

#### [MODIFY] [AppSidebar.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/AppSidebar.tsx)

Add new **"Shopping Research"** nav section:

```tsx
{
  title: "Shopping Research",
  icon: ShoppingBag,
  items: [
    { href: "/admin/showroom", label: "Showroom Dashboard" },
    { href: "/rooms/closets", label: "Closet Research" },
    // Future: Kitchen Fixtures, Bathroom Tile, etc.
  ]
}
```

---

## Dependency Installation

```bash
pnpm add @zxing/library
```

> [!NOTE]
> `@zxing/library` is the only new runtime dependency. It runs entirely client-side for barcode decoding. The Workers AI VLM pipeline uses the existing `AI` binding — no additional server-side packages needed.

---

## Verification Plan

### Automated Tests
```bash
pnpm drizzle-kit generate   # Verify migration SQL is clean
pnpm drizzle-kit push        # Apply to local D1 (dev)
```

### Manual Verification
1. Verify all ~22 tables created in D1 with correct FK relationships
2. Run seed scripts → confirm stores, cities, product areas populated
3. Navigate to `/rooms/closets` → confirm dark-theme closet research page
4. Navigate to `/admin/showroom` → confirm showroom dashboard renders
5. Open barcode scanner modal on mobile → confirm rear camera activates on iOS
6. Test offline scan queue: disable network → scan barcode → re-enable → verify sync
7. Add a new store → verify ShowroomResearchAgent triggers research
8. Check gap analysis panel → verify missing categories detected
9. Confirm sidebar shows new "Shopping Research" section
