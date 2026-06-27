# Product Requirements Document (PRD): Showroom & Materials Sourcing Suite

## 1. Goal & Motivation
The procurement phase of a high-end home remodel involves hundreds of materials (fixtures, tile, doors, framing trim, appliances, cabinetry, lighting) with complex technical dependencies and highly fragmented local sourcing hubs in the SF Bay Area. 
This project builds the **Showroom & Materials Sourcing Suite** to help homeowner Marcus Vance:
* Inventory and categorize remodel materials in an industry-standard schedule format.
* Group and filter showrooms geographically by city/route hubs (Hubs A–E) and specialties.
* Seamlessly scan product barcodes/SKUs in-store (with offline capability for cellular dead-zones).
* Verify technical design compatibility via AI (e.g. induction compatibility with slab materials).
* Retrieve clearance, outlet, and trade discounts via the `ShowroomResearchAgent` Durable Object.

## 2. Scope & Non-Goals
### Scope
* **Materials Schedule & Budget Dashboard**: Table representing the materials list, group by room/product area, budget allocation vs actual spend charts.
* **Showroom Directory & Sourcing Hub Map**: Geographic map using markers for showrooms with category/city filters and listing.
* **Showroom Detail Viewport**: Hours, address, rating selectors, wishlist quick-add, and timeline notes.
* **Material Detail Viewport**: Qty, budget controls, specs upload, and the AI Research Console showing compatibility diagnostics and discount concierge logs.
* **Mobile Scan Log & Sync Panel**: Viewfinder scan interface with offline storage queue to sync once cell service returns.

### Non-Goals
* Managing contractor billing or direct payments.
* Shipping and tracking logistics (shipping company integrations).

## 3. Capabilities Consumed
Based on the backend capabilities audit:
* **Hono Router**: `/api/showroom-stores` GET, POST, PUT, DELETE.
* **Product CRUD**: `/api/showroom-stores/:id/products` GET, POST, PUT.
* **VLM AI Scan**: `/api/showroom-stores/scan` POST (base64 image, barcode value) using `@cf/moonshotai/kimi-k2.6`.
* **Gap Analysis**: `/api/showroom-stores/meta/gaps` GET.
* **Durable Object**: `ShowroomResearchAgent` methods `researchStore`, `researchProduct`, and `analyzeGaps`.

## 4. Page Inventory & States
| Page Route | Description | States | Mobile Variant |
|---|---|---|---|
| `/admin/showroom` | Materials Schedule & Budget Dashboard | DATA, EMPTY, LOADING, ERROR | Table collapses to stacked card list |
| `/admin/showroom/stores` | Showroom Directory & Hub Map | DATA, EMPTY, LOADING, ERROR | Collapsible map drawer + search bar |
| `/admin/showroom/stores/:id` | Showroom Detail Viewport | DATA, EMPTY, LOADING, ERROR | Tabbed notes/wishlist panels |
| `/admin/showroom/materials/:id` | Material Detail Viewport & AI Console | DATA, EMPTY, LOADING, ERROR | Monospaced console scrolls horizontally |
| `/admin/showroom/scans` | Barcode Sync & Upload Audit | DATA, EMPTY, LOADING, ERROR | Full-width scanning logs |

## 5. Acceptance Criteria
* Dark mode is forced globally (`class="dark"` with Monolith HSL values).
* No 1px borders are used; layout uses rings and dividers (`ring-1 ring-border/40`).
* Chart series colors strictly override standard shadcn themes with the Monolith electric/vivid/amber palette.
* Barcode scanner falls back gracefully to a manual text input.
* Offline queue survives page reloads by utilizing local storage.
* Warning logs for critical compatibility faults (e.g. countertop thickness, steam shower enclosure requirements) are surfaced prominently in high-contrast styling.
