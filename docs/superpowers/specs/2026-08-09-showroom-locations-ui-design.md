# Showroom locations UI — viewport spot + modal + directory chips

**Date:** 2026-08-09
**Extends:** 0045 (store→locations model), 0047 (branch collapse). Surfaces the multi-location
data on the two homeowner-facing showroom surfaces.

## Problem

A showroom store is one business with N physical sites (0045), but the HTTP frontend still
shows only the primary address — the 0045 Phase-B API cutover was deferred, so the store detail
and directory endpoints never expose `showroom_store_locations`. A user looking at a chain
(Studio Belmont ×5, Jack London ×5) can't see or reach the other branches.

## Scope

Two surfaces + the minimal backend to feed them. NOT the full 0045 Phase-B cutover.

### Backend

1. **`GET /api/showroom-stores/:id/locations`** (auth-gated, existing router) →
   ```
   { locations: LocationDto[], storePhone: string|null, storeWebsite: string|null,
     pocs: Poc[] }
   ```
   - `locations` from the existing `loadStoreLocations(db, [id])` service (0045):
     `{ id, address (derived), streetNumber, streetName, unit, city, state, zipCode,
        latitude, longitude, placeId, googleMapsLink, hubName, isPrimary }`, sorted by
     `city` asc (primary first within a tie is not required — city sort is the contract).
   - `storePhone` = `showroom_stores.phoneNumber`; `storeWebsite` = the WEBSITE link host
     (via the existing links helper) so it matches the card.
   - `pocs` = active `showroom_pocs` for the store: `{ id, fullName, title, company, phone,
     email, website, address }`.
   - Fetched **lazily** by the modal on first open, never on page load.

2. **List enrichment** on `GET /api/showroom-stores` — every store row gains:
   - `locationCount: number` (via the existing chunked `loadStoreLocationCounts`)
   - `locationCities: string[]` — unique non-null `location_city`, sorted asc (one grouped
     query over `showroom_store_locations`, chunked at 90 store ids).
   Additive; no new query when the directory already loads the list.

### Frontend

**A. Store viewport "Locations" spot** — new `LocationsSpot` mounted directly **below the hero
header**, above the section tabs, in `StoreViewportApp`.
- **≥2 locations:** a button — `N locations` + unique city chips (sorted asc) — opening
  `LocationsModal`.
- **exactly 1 location:** static, non-interactive text — "Single location · {City}" (concise,
  no modal, button disabled/absent).
- Location count/cities come from the enriched list data already on the store, OR a light
  head request; simplest is to read `locationCount`/`locationCities` passed into the viewport
  (the detail page can pass them, or the spot derives count from the lazy fetch on open — but
  the count must show WITHOUT opening, so it reads the enriched fields). Detail API also
  returns `locationCount`/`locationCities` for direct navigation.

**B. `LocationsModal`** (Base UI `Dialog`, controlled; dismiss via `onOpenChange`):
- Near-fullscreen, mobile-first: `w-[95vw] max-w-6xl h-[90vh]` on `sm+`; full-bleed sheet on
  mobile.
- **Desktop (`sm+`):** vertical `Tabs orientation="vertical"` — one city tab per location,
  sorted asc — left rail; content right.
- **Mobile:** the same tabs render as a **horizontal scroll strip** across the top (vertical
  rail is unusable narrow); content below.
- **Per active city pane:**
  - Derived address + hub badge.
  - **Phone** — the business phone as a `tel:` link (auto-dial), via the existing
    `telHrefFor`/`formatPhoneDisplay`.
  - **Website** — external link.
  - **Contacts** — POCs whose `address` contains this location's city or street; if none
    match, show all store POCs (labelled "store contacts").
  - **Map** — Google Maps **Embed** iframe, rendered **only for the active tab** (lazy; never
    for inactive tabs, never before the tab is shown). `q` precedence:
    `place_id:<placeId>` → `<lat>,<lng>` → URL-encoded derived address. Key from the existing
    `GET /api/places/maps-js-key`, fetched once and cached.
  - **"Open in Google Maps"** button — the location's `googleMapsLink`, or a maps URL built
    from coords/address as fallback.
- **Graceful degradation:** if the key request fails or the iframe errors, the pane still shows
  address + contacts + the Google Maps link. The map is additive, never required.

**C. Directory card** (`ShowroomMergedCard`): a dedicated placeholder row — `N locations` +
unique `location_city` chips sorted asc, from the enriched list fields. Shown only when
`locationCount ≥ 1` (chips only meaningful when cities exist). The card remains a link to the
store page; no modal from the card.

## Data flow

```
Directory page → GET /api/showroom-stores (enriched: locationCount, locationCities)
                → ShowroomMergedCard renders count + city chips
Store page     → StoreViewportApp (has locationCount/locationCities)
                → LocationsSpot (button if ≥2, static if 1)
                → open → GET /api/showroom-stores/:id/locations (lazy)
                → LocationsModal: vertical/horizontal city tabs
                → active tab → Embed iframe (lazy) + tel/web/POCs
```

## Components (isolation)

- `LocationsSpot` — count + city chips + open control. Props: `{ storeId, locationCount,
  locationCities }`. No data fetch; pure presentation + open trigger.
- `LocationsModal` — owns the lazy `/locations` fetch, tab state, and the active-tab map. Props:
  `{ storeId, open, onOpenChange }`.
- `LocationMap` — the lazy Embed iframe for one location. Props: `{ location, mapsKey }`. Only
  ever mounted for the active tab.
- Backend: one new route handler + a list-enrichment helper `loadStoreLocationCities`.

## Testing / verification

- `scripts/qc/pr_<n>.mjs`: assert `GET /:id/locations` returns the expected shape for a
  multi-location store (Jack London / Studio Belmont) and a single-location store; assert the
  list endpoint returns `locationCount`/`locationCities` sorted asc with no dupes; assert cities
  are unique + sorted. Run against preview + prod.
- Manual: browser check the modal on a real chain at mobile + desktop widths (Embed renders,
  tel: dials, tabs switch, map lazy-loads only on active tab).

## Risks

- **Maps Embed API not enabled on the key** → iframe 403. Mitigated by graceful degradation +
  a build-time check against the live key.
- **POC↔location matching is heuristic** (address substring). Acceptable — falls back to all
  store contacts; never hides a contact.
- No schema change, no migration. Reuses 0045 services end to end.
