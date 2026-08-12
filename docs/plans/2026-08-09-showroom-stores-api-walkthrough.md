# API-Layer Change Walkthrough — showroom_stores Normalization + Content→Location Retarget

Companion to [2026-08-09-showroom-stores-normalization.md](2026-08-09-showroom-stores-normalization.md) §8.
Grounded against `origin/main` (line refs via `git show origin/main:<path>`). PLANNING ONLY — no code edited.

Two overlapping migrations drive every change:
- **Parent (16 flat columns):** location/contact columns leave `showroom_stores` → `showroom_store_locations` + `showroom_store_contacts`, expand→contract over Phases 0–5.
- **Retarget (Phase L):** 8 child CONTENT tables gain a nullable `location_id` FK → `showroom_store_locations`, backfilled to the store's DERIVED primary (`markPrimary`, `locations.ts:137-152`).

Through-line: **a dropped flat column is a silent `undefined` at the API boundary** (whole-row `store: showroomStores` selects + `coalesce()`), so every writer dual-writes and every reader re-aliases to identical keys.

---

## 1. `GET /api/showroom-stores` — directory list
**File:** `showroom-stores.ts:1098`, select `:1114-1128`.
- **Current:** whole-store-row select (`store: showroomStores`, `:1115`), flat spread `...r.store` (`:1316`); map geo from flat `latitude/longitude` (`:1332-1333`); multi-location is **counts + city NAMES only** (`locationCount` `:1346`, `locationCities` `:1347`). **No `locations[]`, no per-site coords** → map plots one pin per store.
- **New:** add `locations[]{id,city,latitude,longitude,isPrimary,placeId}` via `loadStoreLocations` (`locations.ts:154`, DTO `:38-63`). Phase 3d: replace `...r.store` flat spread with child-table JOIN, re-aliasing `latitude/longitude/locationAddress` from the primary location.
- **Contract:** `latitude,longitude,locationCount,locationCities,userRating,onlineRating,hubRoute/Name,links` byte-identical; `locations[]` additive.

## 2. `GET /api/showroom-stores/:id` — store detail
**File:** `:1375`, select `:1377-1393`, spread `...store.store` `:1560`.
- **Current:** whole flat row returned; child loads (`storeNotes:1435`, `storeRating:1440`, `showroomStoreRatings:1446`) keyed on `storeId` only.
- **New:** Phase 3d JOIN to locations (primary → geo/address via `formatShowroomAddress`) + contacts (GENERAL_CONTACT → phone/email; is_primary person → mainPoc*), re-aliased to identical keys. Add `locations[]` with per-site content counts + arrays.
- **Contract (load-bearing):** `latitude,longitude,locationAddress,phoneNumber,emailAddress,mainPoc*,zipCode,hours,hoursJson,links,products,categories,notes,userRating,externalRatings,brands,tags,locationCount,locationCities` identical in name+value. Brand-level (`overviewNote*`, `ratingContext*`, categories, mappings) stay store-scoped.

## 2b. `GET /:id/locations` (exists — the reuse target)
**File:** `:1611`, `loadStoreLocations` `:1622`; returns locations[] incl **isPrimary** + legacy `pocs[]` from `showroom_pocs` (`:1636-1642`).
- **Change:** canonical source for the list endpoint, viewport switcher, and every create control's site-picker — no parallel fetch. Phase 4: repoint `pocs[]` → `showroom_store_contacts`. `isPrimary` stays DERIVED.

## 3. Writers — create / update / address / hours / links
- **`POST /api/showroom-stores`** (`:1746`): today inserts store + hours + links, **no location/contact row**; dup pre-check `findDuplicateStore` (`:1818`) reads flat only. **New (Phase 2):** insert primary location row + GENERAL_CONTACT (dual-write flat until Phase 4); apply cross-table place_id guard (`loadPlaceIdOwners`, `locations.ts:266`). **Validation:** reject a placeId already on a location row.
- **`PUT /:id`** (`:2062`): `update(showroomStores).set(...)` flat (`:2098`) → dual-write primary location when geo in patch.
- **`PUT /:id/address`** (`:2322`): writes flat address parts + **zip dual-write** (`:2337`/`:2358`) → write primary location row as source; Phase 4 stops flat, reader recomposes `locationAddress` (incl `unit`).
- **`PUT /:id/hours`** (`:2270`), **links** (`:2458`/`:2477`/`:2505`): already normalized — no structural change.

## 4. `/api/showroom-contacts` — location scoping + per-location guards
**File:** `showroom-contacts.ts`.
- **Current:** `matchStore` (`:52`) flat reads (placeId `:72`, host `:85`, phone LIKE `:106`, email LIKE `:116`, address LIKE `:131`); `upsertGeneralContact` one-per-**store** (`:199`); create fills flat store columns (`:446-466`); backfill from `showroom_pocs` + flat `mainPoc*` (`:683-685`, `:726-731`). **Schema:** no unique guard, no `location_id`.
- **New:** Phase-0 additive — `is_primary` + partial-unique indexes **PER-LOCATION** (`ssc_one_general_per_location`, `ssc_one_primary_per_location` on `(storeId, locationId)` where `is_draft=0`) + `location_id` FK (SET NULL) **in the same migration**. Create schema accepts `locationId` (default primary); Phase 3c moves phone/email/address predicates to JOINs. Phonebook `GET /` stays store-level (no gmail regression).
- **Validation:** a `locationId` must belong to the same `storeId`.

## 5. Photos — upload, gallery, media backfill, Places scrape
- **`POST /:id/photos`** (`:4122`) inserts `showroom_images` storeId-only (`:4197`); `GET /:id/photos` (`:4081`) filters storeId. **New (Phase L):** `showroom_images` + `location_id` (SET NULL); upload accepts `locationId` (default active site); `GET ?locationId=` filters per-site + badge.
- **`GET /:id/photos-gallery`** (`:4422`) reads `showroom_photos_mapping` by showroomId (`:4444`). **New (EXACT key):** + `location_id` (CASCADE), backfill by exact place_id join.
- **`backfill_showroom_media`**: reads flat `showroomStores.placeId` (`:125-145`) → per-location place_id; stamp `location_id` on new mapping/rating rows.
- **Validation:** supplied `locationId` belongs to the store; scrape place_id already on a store/location row is skipped.

## 6. Notes, ratings, visits — location_id + validation
- **Notes** `GET/POST /:id/notes` (`:3774`/`:3908`), `add_showroom_note`: `store_notes` + `location_id` (SET NULL); **null = brand-level note escape**; editor persists active site. Hero `ratingContext*` overview stays store-level (don't badge).
- **Ratings** `POST /:id/rate` (`:2685`, store_rating), `PUT /:id/visit-rating` (`:3374`, flat `showroomStores.rating` `:3416`), external `showroom_store_ratings` (`:1446`): `store_rating` + `location_id` (SET NULL); `showroom_store_ratings` + `location_id` (CASCADE, EXACT place_id). Directory card + hero **COALESCE to one number**. **OPEN:** store_rating vs visit_log.rating overlap.
- **Visits** `record_showroom_visit`, `create_visit_log`, Tesla telemetry: `showroom_visit_log` + `location_id` (SET NULL), backfill by **nearest-site haversine**; writers stamp `location_id` at insert. (`record_showroom_visit` today writes flat rating + a store_notes row, NOT visit_log — it should stamp both.)
- **Validation:** every accepted `locationId` belongs to the store; null = brand-level (notes) / resolve-to-primary (visits).

## 7. Scraping / rescrape — per-location place_id
**Files:** `GET/POST /:id/scrape` (`:1984`/`:2022`), `places-backfill.ts`, `discovery-search.ts`, `branch-detection.ts`, `dedup_showroom_stores.ts:155,193`.
- Read flat `showroom_stores.placeId` as scrape/dedupe key → Phase 3a repoints to `loadPlaceIdOwners`/per-location place_id. **`scraping_sitemap` + `browser_run_pages` STAY store/brand-scoped — NO `location_id`** (shared brand website + per-brand Vectorize corpus). `showroom_scan_log` unchanged (YAGNI).

## 8. Drive-lists + Tesla nav — resolve a specific location's coords
- **`GET /api/drive-lists`** (`drive-lists.ts:107-109`): markers via `coalesce(driveListStops.latitude, showroomStores.latitude)` (`:108-109`), leftJoin on `showroomStoreId` (`:112`); service fills missing stop coords from flat store (`:125-143`), stop-detail reads flat phone/address/city/lat/lng (`:276-282`).
- **Tesla nav** (`tesla.ts:112-120,176-182`): waypoint coords via `coalesce(driveListStops.lat, showroomStores.latitude)` — a silent-null sends the car to `0,0`.
- **New (Phase 3b — highest-risk geo cutover):** repoint the single seam `loadShowroomCoords` (`_shared.ts:41-58`) to the primary location; change coalesce fallback target `showroomStores` → linked **location** coords; `drive_list_stops` carries `location_id`; geo-match compares against location coords and **stamps `location_id`** on the recorded visit; stop-rating passes `location_id` into visit_log + store_notes.
- **Contract:** marker counts, stop-coord counts, dispatched coords == prod snapshot (behavioral). **Validation:** a stop's `location_id` belongs to its `showroomStoreId`.

## 9. Flat-column reads in peripheral routes
| Reader | file:line | Current flat dep | New |
|---|---|---|---|
| Gmail domain-match | `gmail.ts:808` | flat `emailAddress` + `mainPocEmailAddress` (`:808`) + legacy pocs (`:815`) + contacts (`:821`) | Phase 3c: source store emails from `showroom_store_contacts` keyed by storeId (stays store-level); retire pocs read Phase 4 |
| Brand detail | `brands.ts:837` | `locationAddress: showroomStores.locationAddress` | Phase 3d: compose from primary location |
| Showroom sales | `showroom-sales.ts:92` | `storeCity: showroomStores.locationCity` | Phase 3d: read `city` from primary location |

## 10. Intake normalization §2.5 endpoints
**Files:** `_shared.ts` (`persistPlaceShowroom`, `adoptPlaceLocation`, `intakeOnePlace`), `create_showroom.ts`, `duplicate-signals.ts`, `duplicate-check.ts:74`, `showroom-bulk-intake-workflow.ts`.
- **Current:** `persistPlaceShowroom` writes store+hours+links, **zero location/contact rows**; `adoptPlaceLocation` flat overwrites; `findDuplicateStore` reads flat only; no name-casing / root-domain attach / sibling discovery.
- **New (Phase 2):**
  1. **`toDisplayStoreName()`** — new, beside `normHost`/`normName`; separate from `normName` (matching-only); preserve-list (KOHLER/THG Paris/McX); stage low-confidence; Phase-1 backfill over 233 names → `data/name-casing-diff.json` for approval.
  2. **Root-domain dedup** — lookup `showroom_store_links type='WEBSITE' AND host=normHost(website)` → attach location under existing parent (reuse `add_showroom_location` insert), not a new store; reuse generic-host ignore-list.
  3. **50-mile sibling discovery (server-side)** — Places Text Search 50-mi circle → each candidate: (a) cross-table place_id guard; (b) **website-host gate** (never name+proximity — `MAX_WEAK_FANOUT=2`); (c) insert location row, **no `isSibling`** (primary DERIVED); enrich via existing Places-details/`reviewAiInsight`. Client passes NO siblingPlaceIds.
  4. **Workflow:** extend `showroom-bulk-intake-workflow.ts`, short `step.do()` per sibling, AI summarize as its own short step. No new workflow class.
  5. **`findDuplicateStore`** reads `showroom_store_locations` across all sites.

## Cross-cutting hard gates (not endpoints)
1. **`store-child-remap.ts`** keys 27 child tables on store FK; once content carries `location_id`, a merge that repoints `store_id` but not `location_id` **orphans per-site content** — Phase 3d/4 must remap `location_id` (or fold loser locations first). `D1_IN_CHUNK=90` is safe for single-param inArray but must NOT be copied into multi-column backfills (cap ~20).
2. **`markPrimary`** (`locations.ts:137`) derives off `showroom_stores.place_id`; Phase 4 retires that flat column — re-key the derivation onto the primary **location** row FIRST or every store loses its primary marker.

## Breaking gap that exists TODAY
`GET /api/showroom-stores/meta/place-exists` (`showroom-stores.ts:2761`, reads flat `placeId` only `:2772`) **already misses location-only place_ids** — the dedup 409 path can mint a duplicate for a place that exists only as a location row. Fix with `loadPlaceIdOwners` (Phase 2).

## Endpoint × phase × breaking × frontend consumer
| Endpoint / tool | file:line | Phase | Breaking? | Consumer |
|---|---|---|---|---|
| `GET /showroom-stores` (list) | `:1098` | 3d + L | No (additive locations[]) | ShowroomsDirectoryApp |
| `GET /:id` (detail) | `:1375` | 3d + L | Silent break if a key renamed | StoreViewportApp |
| `GET /:id/locations` | `:1611` | 4 | No | LocationsModal, switcher, create controls |
| `POST /showroom-stores` | `:1746` | 2 | No | intake form |
| `PUT /:id` | `:2062` | 2 | No | EditStoreModal |
| `PUT /:id/address` | `:2322` | 2→4 | No (recomposed) | EditAddressModal |
| `/showroom-contacts` | `contacts.ts:316/501/659/675` | 0/3c | Breaking if guard left per-store | ContactsSection, RecordVisitModal |
| `POST /:id/photos` + GET | `:4122/:4081` | L | No | PhotosSection, UploadPhotoModal |
| `GET /:id/photos-gallery` | `:4422` | L/3a | No | Places gallery |
| `POST /:id/notes` | `:3908` | L | No | NotesSection |
| rate / visit-rating / external | `:2685/:3374/:1446` | L | Breaks card if two numbers | RatingsRow, hero VisitStars |
| `record_showroom_visit` | tool | L | No | StoreVisitsSection |
| scrape / dedup place_id | `:1984`, `dedup:155` | 3a | No | — |
| `GET /drive-lists`, `/:slug`, stop-rating | `drive-lists.ts:107`,`:125-282` | 3b | No (value-diff must hold) | DriveListsApp, DriveViewportApp |
| Tesla nav + proximity | `tesla.ts:112/176`, `_shared.ts:41` | 3b | No (coords non-null) | Tesla nav (live) |
| Gmail threads-by-domain | `gmail.ts:808` | 3c/4 | No (counts hold) | Gmail inbox |
| Brand detail / sales | `brands.ts:837`, `sales.ts:92` | 3d | No | brand/sales pages |
| Intake §2.5 | `_shared.ts`, `create_showroom.ts` | 1/2 | No (store-count-neutral) | intake, bulk intake |
| `meta/place-exists` | `:2761` | 2/4 | **Broken today** — flat placeId only | dedup 409, intake |
