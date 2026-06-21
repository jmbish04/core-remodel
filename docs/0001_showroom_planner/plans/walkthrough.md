# Showroom Shopping Research Suite — Walkthrough

## Overview

Full implementation of the **Showroom Shopping Research Suite** — a procurement intelligence system for tracking Bay Area showroom stores, products, barcode scanning, AI-powered product research, and vendor gap analysis for a San Francisco home renovation.

---

## Wave 1: Database Schema (Complete — Previous Session)

22 new Drizzle ORM tables across [src/backend/db/schema/showroom/](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/showroom/index.ts):

| Table Group | Tables | Purpose |
|---|---|---|
| Core | `showroom_stores`, `showroom_store_products` | Per-location store entities + product catalog |
| Geography | `store_bayarea_cities`, city mappings | 5-hub procurement route system (A–E) |
| Taxonomy | `showroom_store_category`, category mapping | AI-rationale category linking |
| Research | `store_research`, `store_product_research` | Agent-generated findings with sentiment |
| Notes | `store_notes`, `store_product_notes` | Human-authored annotations |
| Ratings | `store_rating`, `store_product_rating`, `showroom_store_ratings` | User + scraped external ratings |
| Tags | `showroom_tag_def`, `store_tag_mapping`, `store_product_tag_mapping` | Flexible tag system |
| Product Areas | `store_product_area_def`, `store_pa_mapping`, `store_product_pa_mapping` | Room → product-type taxonomy for gap analysis |
| Similar | `store_similar_map`, `store_product_similar_model_map` | AI-generated similar product links |
| Scan | `showroom_scan_log` | Durable audit trail for barcode + VLM scans |
| Docs | `store_product_docs` | R2 image/PDF attachments |

Migration: `0038_wooden_captain_britain.sql` (135 total tables).

---

## Wave 2: Seed Data

### [seed-bay-area-cities.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/seeds/seed-bay-area-cities.ts)
23 Bay Area cities across 5 procurement hubs:
- **A**: SF Design District
- **B**: Silicon Valley & South Bay
- **C**: Peninsula / Mid-Market
- **D**: East Bay
- **E**: North Bay

### [seed-showroom-stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/seeds/seed-showroom-stores.ts)
33 store locations with rich metadata (scale, inventory focus, target demographic, price point). Includes:
- Studio Belmont (5 locations)
- Specialty: Tredi Interiors (InvisaCook), Nido Living (Rimadesio), Concreteworks, Insensation
- Closet: California Closets, Poliform, Lema, Avera by TCS, IKEA PAX, Closet Factory

### [seed-store-categories.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/seeds/seed-store-categories.ts)
21 product/service categories from flooring through water filtration.

### [seed-product-areas.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/seeds/seed-product-areas.ts)
35 product area definitions across 6 room types (Bathroom, Kitchen, Closet, Living, Exterior, General).

---

## Wave 3: Backend API + Agent

### [showroom-stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/showroom-stores.ts)
Full CRUD API mounted at `/api/showroom-stores` with access auth:

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | List stores (filters: city, pricePoint, hub, search) |
| `/:id` | GET | Full store detail (products, categories, notes, ratings, research, tags) |
| `/` | POST | Create store |
| `/:id` | PUT | Update store |
| `/:id` | DELETE | Delete store |
| `/:id/products` | GET/POST | List/create products |
| `/:id/products/:pid` | PUT | Update product |
| `/:id/notes` | POST | Add store note |
| `/products/:pid/notes` | POST | Add product note |
| `/:id/rate` | POST | Rate store (replaces active) |
| `/scan` | POST | Barcode/image scan pipeline |
| `/scan/log` | GET | Recent scan log |
| `/meta/categories` | GET | List categories |
| `/meta/cities` | GET | List Bay Area cities |
| `/meta/gaps` | GET | Vendor gap analysis |
| `/meta/product-areas` | GET | List product area definitions |

### [ShowroomResearchAgent](file:///Volumes/Projects/workers/core-remodel/src/backend/ai/agents/ShowroomResearchAgent/index.ts)
Durable Object with 4 callable methods:

1. **`researchStore(storeId)`** — Reputation research via Kimi 2.6, findings persisted to `store_research`, auto-generates `ai_highlights_for_user_renovation`
2. **`researchProduct(productId)`** — Reviews, compatibility checks (InvisaCook porcelain constraint, steam voltage, frameless wall thickness), findings to `store_product_research`
3. **`generateHighlights(storeId)`** — Context-aware renovation relevance highlights
4. **`analyzeGaps()`** — Vendor category gap detection

Wired in:
- [_worker.ts](file:///Volumes/Projects/workers/core-remodel/src/_worker.ts#L25) — DO export
- [wrangler.jsonc](file:///Volumes/Projects/workers/core-remodel/wrangler.jsonc#L203) — `SHOWROOM_RESEARCH_AGENT` binding + v9 migration

---

## Wave 4: Frontend

### [BarcodeScanner.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/BarcodeScanner.tsx)
iOS-compatible barcode scanner in shadcn Dialog:
- `facingMode: "environment"` + `playsInline` for iOS Safari
- Viewfinder overlay with corner markers and scanning line
- 10-second timeout → AI capture fallback
- Dynamic import of `@zxing/library` (code-split, graceful degradation)

### [useOfflineBarcodeSync.ts](file:///Volumes/Projects/workers/core-remodel/src/frontend/hooks/useOfflineBarcodeSync.ts)
localStorage queue with navigator.onLine auto-sync:
- `enqueueScan()` — push immediately if online, queue if offline
- `syncQueue()` — batch push on connectivity restore
- `clearQueue()` — manual purge

### [ClosetResearchApp.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/ClosetResearchApp.tsx)
Full retrofit of `custom-closets.html` into React + shadcn Monolith dark theme:
- 8 interactive layout scenarios with canvas rendering
- 3-tier vendor gallery (Luxury / Premium / Budget)
- Canvas-rendered cost bar chart
- Costco rebate section

### [ShowroomDashboard.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/ShowroomDashboard.tsx)
Store management dashboard:
- Store cards with price point badges, hub badges, AI highlights
- Hub route filtering (A–E) + search
- Barcode scanner integration
- Offline sync status indicator
- Gap analysis tab with actionable search buttons

### Astro Pages
- [/rooms/closets](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/rooms/closets.astro)
- [/admin/showroom](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/admin/showroom.astro)

### [AppSidebar.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/AppSidebar.tsx#L284-L287)
Added "Shopping Research" nav group with both new pages.

---

## Verification

- **TypeScript**: All new files pass `tsc --noEmit` (0 new errors introduced)
- **Pre-existing errors**: BidPortfolioAgent and BudgetAgent have pre-existing type issues unrelated to this work

## Next Steps

1. `pnpm add @zxing/library` — install barcode decoder runtime dependency
2. Run seed scripts against remote D1 via a Hono endpoint or `wrangler d1 execute`
3. Deploy via `pnpm run deploy`
