# Showroom Location Contract — schema/API SOT for the viewport

**Purpose:** durable contract between the **normalization** work (schema + backend; owns the data) and the
**viewport** rebuild (`StoreViewportApp.tsx`; pure consumer). If a field or its timing changes, it changes here first.

**Owners:** normalization = schema, `showroom_store_locations`, `location_id` rollout, merge-candidate applies,
intake classifier. viewport = the consuming UI (location selector, per-location badges, `?loc=<id>`).

**Golden rule (both agree): DECOUPLED + DEFENSIVE.** The viewport reads `location_id` **where the column
exists today**, and **degrades to store-level** when it's null or the column hasn't shipped. Neither PR blocks
the other. Nothing in the viewport should hard-require Phase-L schema.

---

## 1. `GET /api/showroom-stores/:id/locations` — LIVE TODAY (PR #375/#376)

This endpoint already exists and is the canonical per-site source. Response:
```
{ locations: LocationDto[], storePhone: string|null, storeWebsite: string|null, pocs: Poc[] }
```
`LocationDto` (from `loadStoreLocations`, `services/showroom/locations.ts`) — **rely on these today:**

| field | notes |
|---|---|
| `id` | the `showroom_store_locations` row id — your `?loc=<id>` key |
| `isPrimary` | **DERIVED, not stored** — the location whose `place_id` matches the parent store, else lowest id. Never assume a stored column. |
| `placeId` | nullable (manual rows) |
| `latitude`, `longitude` | nullable |
| `streetNumber`, `streetName`, `unit`, `city`, `state`, `zipCode` | structured parts |
| `address` | **derived** via `formatShowroomAddress` (no stored formatted string) |
| `googleMapsLink`, `hubName` | |

- `storePhone` = the store's **flat** `phoneNumber` (brand-level, NOT per-location). `storeWebsite` = the WEBSITE link host.
- `pocs` = **legacy `showroom_pocs`** rows (retiring in Phase L → contacts). Treat as store-level for now.
- **Sorted by `city` asc** (contract; primary-first-within-tie not guaranteed — sort yourself if you need it).
- **NOT in this endpoint today:** per-location phone, per-location hours, per-location reviews/rating. See §3.

## 2. `GET /api/showroom-stores/:id` (detail) — store-level today

Returns the whole store row (flat): `phoneNumber`, `emailAddress`, `locationAddress`, `latitude/longitude`,
`hours`/`hoursJson`, `rating`, `googleRating`, `reviewSummary`, `mainPoc*`, `overviewNote*`, `ratingContext*`,
`categories`, `locationCount`, `locationCities`. **Brand + primary-site conflated** — this is the pre-Phase-3d state.
Brand-level fields (`overviewNote*`, `ratingContext*`, `categories`, name) stay here permanently.

---

## 3. `location_id` rollout on child tables — WHAT'S LIVE vs PLANNED

| child read | table | `location_id` today? | when |
|---|---|---|---|
| **hours** | `showroom_store_hours` | ✅ **LIVE** (`hours.ts:48`, nullable = brand-wide) | now — key hours off `location_id` today |
| contacts (`/api/showroom-contacts?storeId=`) | `showroom_store_contacts` | ❌ store-level | **Phase L** (+ `is_primary`, per-location GENERAL_CONTACT) |
| Places photos (`/:id/photos-gallery`) | `showroom_photos_mapping` | ❌ | Phase L (exact `place_id` key) |
| visit photos (`/:id/photos`) | `showroom_images` | ❌ | Phase L |
| notes (`/:id/notes`) | `store_notes` | ❌ | Phase L (null = brand-level note) |
| external reviews / rating | `showroom_store_ratings` | ❌ store-level | Phase L (+ `source=SYSTEM_USER` for the user's own rating, revisable) |
| **visit logs** | `showroom_visit_log` | ❌ | **DEFERRED** — left alone this phase (drive-list owned, unpopulated). Do NOT plan a viewport dep on per-location visit_log yet. |

**So today, only HOURS carries `location_id`.** Everything else is store-level until Phase L ships. Build the
selector to re-scope hours by `location_id` now, and everything else store-level, flipping each to per-location
as its column lands. Badge by `location_id` where present; degrade to a store-level "all sites" group when null.

---

## 4. Source of truth for the site-varying widgets (so we don't double-build)

- **hours** → `showroom_store_hours` filtered by the selected `location_id` **today** (fallback: `location_id IS NULL` brand rows).
- **phone** → today: `storePhone` (brand). Phase L: the selected location's GENERAL_CONTACT `office_phone_number`.
- **reviews / rating / reviewSummary** → today: store-level (`GET /:id`). Phase L: `showroom_store_ratings` by `location_id` (external, exact `place_id`) + the user's `SYSTEM_USER` row per location. Keying off the selected location's `location_id` is the correct TARGET; until Phase L it resolves to the one store-level value.
- **address / coords / map** → the selected `LocationDto` from `/:id/locations` **today** (fully live).
- **contacts** → today: `pocs` (store-level, legacy). Phase L: `showroom_store_contacts` by `location_id`.

Do NOT build a parallel per-location fetch — extend `/:id/locations` (the payload the modal already consumes)
when per-location phone/hours are added, rather than a new endpoint.

---

## 5. Sequencing (answers §4 of the coordination msg)

- **`location_id`-on-children (Phase L) and the 11 merge-candidate applies are NOT scheduled before your
  viewport PR.** They're future/unscheduled. **Do not depend on my merged schema.**
- The merge applies (Studio Belmont ×5, Homewise ×5, …) are staged TBD in `showroom_merge_candidates`, human-gated
  via `resolve_merge_candidate` + `apply_merge_candidate` — they change WHICH store owns which locations, but the
  `/:id/locations` shape is stable across them. Your single-stable-brand-URL design already handles it: after an
  apply, the loser store 302s / the keeper owns the locations; deep-link to the keeper id.
- **Confirmed: DECOUPLED + DEFENSIVE is the right call.** Ship the viewport against §1 (live) + hours-by-location
  (live), degrade everything else to store-level, and flip per-child as Phase L lands.

## 6. Shipped adjacent (may affect your category chips)
Category vocab was cleaned this session (70→28, `ui_group` added, grouped Edit-categories modal). If the viewport
renders category chips, the vocab is now the 28 canonical + `uiGroup`. `GET /:id/categories` semantics unchanged.

---

*Amend freely — viewport session owns §4/§1-consumer detail; normalization owns §1/§2/§3/§5 timing. Ping the other
session on any change to a field name or a rollout date.*
