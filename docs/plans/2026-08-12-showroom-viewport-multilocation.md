# Showroom Viewport Overhaul + Multi-Location Frontend — design

**Status:** design (approved phasing 2026-08-12). Frontend owner: this session (`claude/showroom-viewport-updates-14a4e0`).
Backend owner: the normalization session (`claude/database-schema-audit-cleanup-271ac6`).
**Seam:** the HTTP API. **Boundary doc:** [`showroom-location-contract.md`](./showroom-location-contract.md) — read it first; it is the source of truth for what per-location data is live vs Phase-L.

**Golden rule (inherited from the contract): DECOUPLED + DEFENSIVE.** The frontend reads `location_id` /
`locations[]` where they exist today and degrades to store-level when null or not-yet-shipped. Nothing here
hard-requires unshipped backend.

---

## 0. Why

Two forces converge on the store viewport (`StoreViewportApp.tsx`, 2686 lines):

1. **Justin's 12-item viewport overhaul** — restructure the bento, minimize the hero, fix contacts/photos/
   documents/inbox/360. Mostly independent of the data model.
2. **One store → N locations.** Duplicate store rows (Studio Belmont ×5, Daltile ×4, Porcelanosa ×3, …) are
   being merged into ONE keeper store with N `showroom_store_locations` rows; children remap to keeper +
   `location_id`. This ripples across the whole frontend, not just the viewport.

A 4-cluster frontend survey (viewport, directory/map, drive/routing, capture, peripheral) produced the impact
map in §2. Approach locked with Justin: **single stable brand URL (the keeper) + a location selector that
re-scopes only the site-varying widgets; brand + user content stay unified, badged by location; `?loc=<id>` for
deep-linking.** Per-location URLs were rejected — they re-fragment what the merge just unified.

---

## 1. Architecture — the three data buckets

Every design decision follows from which bucket a field is in:

- **Brand-level (shared across all sites, lives on the store row permanently):** name, description, brands,
  products, categories, `overviewNote*`, `ratingContext*`, price point, type. NEVER re-scoped by the selector.
- **Site-level (varies per location):** address, coords, `placeId` → Google reviews/rating/review-summary/
  Places-photos/Street-View, hours (`showroom_store_hours.location_id` — LIVE today), phone (Phase-L via the
  location's GENERAL_CONTACT). Re-scoped by the selector.
- **User-generated (attaches to a site, reviewed across the brand):** visit photos, visit notes, contacts.
  Always shown unified; badged/highlighted by `location_id` where present, degrade to an "all sites" group when
  null.

**Location selector behavior** (`?loc=<id>`, default = `isPrimary` location, hidden entirely when
`locationCount <= 1`):

| Widget | Re-scopes to selected location? | Source | Live today? |
|---|---|---|---|
| Address / map / Navigate / Call | Yes | selected `LocationDto` (coords, placeId; phone via location GENERAL_CONTACT) | ✅ address/map/coords; ⏳ per-loc phone (Phase-L) |
| Hours | Yes | `showroom_store_hours.location_id` | ✅ LIVE |
| Google reviews / rating / AI summary | Yes | location `placeId` → `showroom_store_ratings.location_id` | ⏳ Phase-L (resolves to store-level today) |
| Google Places photos / 360 / Street View | Yes | location `placeId` | ✅ Street View (coords); ⏳ per-loc Places photos (Phase-L) |
| Contacts / notes / visit photos | Always all shown, badged by location | child `location_id` | ⏳ Phase-L (degrade to store-level today) |
| Brands / products / categories / wishlist | Never — brand-level | store row | ✅ |

---

## 2. Whole-frontend impact map (ranked)

| # | Surface | Severity | Break today | Fix |
|---|---|---|---|---|
| 1 | Hero "Navigate" / Tesla (`StoreViewportApp.tsx:1279`, `HoursContactModal`) | 🔴 Critical | Routes the car to the PRIMARY site always — wrong showroom for a multi-site brand | Per-location Send-to-Tesla in `LocationsModal.LocationPane`; hero Navigate routes through it when `locationCount>1`. Needs backend #2. |
| 2 | Directory map (`ShowroomsDirectoryApp.tsx:995,1113,883`) | 🔴 High | 5-site brand = one pin; others vanish; "near me" ignores them | One `MapMarker` per location; frame from all coords. Needs backend #1 (`locations[]` on list feed). |
| 3 | Stale links after a merge (~15 call sites; POST-drop hazard) | 🔴 High | Deep-links to a soft-deleted loser 404; POST→loser silently drops (302 downgrades method) | ONE server-side 302 loser→keeper on the page route; `replaceState` URL-heal in `api()`; backend #4 (409/308 on loser mutations) |
| 4 | Region tabs (`ShowroomsDirectoryApp.tsx:3132-3144`, single `hubRoute`) | 🟠 Med | Brand shows in ONE region tab, filtered out of others it has sites in | Set-valued region membership. Needs backend #5 (`hubRoutes[]`). |
| 5 | Detail drawer + list rows (`ShowroomsDirectoryApp.tsx:1392,1587`) | 🟠 Med | Show only the primary city/address | `locationCount>=2` → count + city chips (data already live: `locationCount`/`locationCities`) |
| 6 | Drive stops (`DriveViewportApp.tsx:82-103`) | 🟠 Med | Stop → `storeId`, no `locationId` — ambiguous which site; detail modal shows store-level info | Needs drive-list effort to add `locationId` to `drive_list_stops` (cross-team). Flag. |
| 7 | Capture: visit / photo / contact (`RecordVisitModal`, `UploadPhotoModal`, `ContactsPhonebookApp`, `ManagePocsSection`) | 🟡 Low-now | Pickers buildable today, but writes can't persist `locationId` until Phase-L | Build pickers in lockstep with each Phase-L column. Don't ship dead controls. |
| 8 | Sales / inbox / compare (`SalesApp`, `ShowroomGmailPanel`, `CompareApp`) | 🟡 Low | Flatten to brand-level | Defer (YAGNI); one "multi-location" chip covers the confusion |

**Incidental pre-existing bug (fix in passing):** `BrandViewportApp.tsx:186` links `/admin/showroom/store/${id}`
(singular "showroom") — wrong vs the canonical `/admin/shopping/store/:id`.

**Net-new gap:** there is NO human merge-review UI for the 11 candidates (only MCP tools). In scope as Phase E.

---

## 3. Backend asks (relayed to the normalization session; tracked in contract §7)

- **#1 (P0)** ✅ **LIVE (prod, #389)** — LIST feed `locations: [{id, city, latitude, longitude, isPrimary}]` on
  every row; `locationCount`/`locationCities` untouched. `isPrimary` derived. Wire the map flatMap against it.
- **#2 (P0)** ✅ **LIVE (prod)** — `POST /api/tesla/navigate` accepts `{ storeId, locationId? }`; resolves coords
  from the selected location, else derived primary, else store flat; rejects a foreign `locationId` (400).
  **Pass `{storeId, locationId}`, NOT lat/lng.** ⚠️ Happy-path dispatch fires a REAL navigation to Justin's car —
  do NOT QC the happy path without explicit permission (backend only verified the 400 validation path).
- **#3 (P1)** SPLIT (confirmed): backend adds `keeperStoreId` pointer (at merge-apply) + `GET /:id/keeper`; the
  Astro page owns the 302. Not built yet — lands with merge-apply. Until then a loser id renders the inactive
  store (not a 404).
- **#4 (P1)** Loser API MUTATIONS return **409** (agreed, backend-owned; not built yet).
- **#5 (P1)** ✅ **LIVE (prod)** — `hubRoutes: string[]` (distinct region hubs across the brand's sites) on the
  LIST feed. Filter each region tab by membership so a multi-region brand shows in every tab it has a site in.
- **#6 (P2)** ✅ **LIVE (prod)** — `POST /api/showroom-stores/:id/locations` create verb. Body: address parts +
  coords + `placeId`/`googleMapsLink` + notes triple. Returns 201 `{location}`; 400 empty, 404 no store, 409
  `{ownerStoreId}` on a duplicate placeId. Wire intake's dup-warning "add as a location of {store}" to it.

**Live vs pending:** backend #1/#2/#5/#6 are all live → Phases A, B, C are unblocked. Only #3 (keeper 302) + #4
(loser 409) remain, gating Phase D; backend is checkpointing those + Phase-L with Justin.
- **#7 (semantics)** ANSWERED: `googleRating`/`userRatingCount` = the **primary/keeper site's** Google values,
  NOT a brand aggregate. Render as "primary site's Google rating." Cross-site aggregation is a Phase-L option.
- **Phase-L write params** (future): `locationId` on `POST /:id/photos`, `/:id/image-groups`,
  `/api/showroom-contacts`, `/:id/pocs`(+`/extract-card`, business-cards), `PUT /:id/visit-rating`,
  `showroom_store_ratings`, and (deferred) `POST /api/showroom-visit-logs`.

---

## 4. Phase A — the 12-item viewport overhaul (implementation-ready, ships NOW)

Location-independent except item 12 (→ Phase B). **Also refactors** `StoreViewportApp.tsx` (2686 lines): extract
each section into its own file under `components/showroom/viewport/` (`BrandsProductsSection`, `ContactsSection`,
`NotesVisitsSection`, `View360Section`, `PhotosSection`) + the hero into `viewport/hero/`. No file over ~400 lines.

Final bento card set (was: Brands&Products, Contacts, Showroom-notes, Visits, Photos):
**Brands & Products · Contacts · Visits & Impressions · 360 View · Showroom Photos.**

1. **Merge Visits into Notes → "Visits & Impressions"** — one bento card; content shows visit timeline
   (`StoreVisitsSection`) + notes (`NotesSection`) stacked. Remove the separate Visits card.
2. **Replace the Visits selector slot with "360 View"** — a dedicated card. Content = a toggle between Google
   Street View (`StreetViewTour`, coords) and the interior tour (`SHOWROOM_TOUR` link, `TourCard`/Matterport).
   **Default: interior tour when present, else Street View.** Hide the toggle when only one exists; hide the card
   when neither. Split this out of `PhotosSection`.
3. **Contacts card** — remove the "Store contact" sub-card (duplicative of the header). Rename "Reps & people" →
   "Contacts". Per contact:
   - **Email** = clickable → a small popover menu: (a) open in default client (`mailto:`), (b) send via
     core-remodel UI → route to `/admin/shopping/store/[id]/inbox` with a compose intent (prefilled To:),
     (c) copy to clipboard.
   - **Phone** = `tel:` auto-dial link (exists in `ContactCard`).
   - **Unread badge** = count of unread emails from that contact's address → clicking opens the store inbox.
     Compute by matching the contact's `emailAddress` against the threads from
     `GET /api/gmail/showrooms/:storeId/threads-by-domain` (already fetched for the hero badge).
4. **Inbox page** (`store/[id]/inbox.astro`) — remove the page title + description block; keep only the
   "back to showroom" link; let `StoreInboxApp` take the full height. **Auto-minimize the nav** on this page
   (set `remodel_sidebar_collapsed` cookie + `data-sidebar-collapsed="1"` so `AdminSidebar` SSRs collapsed).
5. **Hero buttons:**
   - Website button → relabel **"Linked Pages"**, opens the links modal (`onOpenLinks`); DELETE the separate
     `Link2` icon button (`HeroLinkButtons.tsx:108`).
   - **Navigate** button → Tesla-branded, forced to the SAME height/width/shape as the Website button.
   - Add a **Call** button next to Navigate, same size/shape, `tel:` auto-dial. Keep the phone number text above
     the buttons.
6. **Showroom Photos card** — beside the "From Google Places" stack, add a user-photo stack: if the store has
   image-groups (`GET /:id/image-groups`), render one stack per group (cover + count); else one combined stack of
   the loose uploaded photos (`/photos` rows with null `group_id`).
7. **Documents** — move `EntityDocumentsPanel` from the page bottom to the top (below header, above the bento).
   **Hidden by default**; a hero **Documents** button (icon + badge count from
   `GET /api/supporting-documents/by-entity?entityType=showroom&entityId=<id>`) toggles it.
8. **Inbox hero button badge** — unread count. NOTE: already implemented (`inboxUnread` via the hidden
   `ShowroomGmailPanel`, `StoreViewportApp.tsx:1370`). Verify it works; treat as a check, not net-new.
9. **Shrink the bento cards** (`ShowroomBento.tsx`) — icon + title on ONE line (currently `flex-col
   justify-between` stacks icon above title). Reduce the anchor span (`SPAN_PATTERN[0]` from
   `col-span-4 row-span-2`) and the min row height (`minmax(120px,auto)`) so less scrolling to reach content
   below.
10. **Move "Visit notes" out of the hero into "Visits & Impressions"** (item 1's card) so the hero stays minimal.
    PLUS: below the Google stars, if ≥1 visit has a non-null rating, show the **average user rating** (purple),
    clickable → selects the Visits & Impressions section + scrolls to it. Avg from
    `GET /api/showroom-visit-logs?storeId=<id>` (per-visit `rating`).
11. **Stretch the AI review summary** to the full hero width (currently inside the left `flex-1` column).
12. **Locations → Phase B.** In Phase A, only move the location count/chips up under the store name (next to the
    city line) as a read-only display; the interactive per-location switching is Phase B.

---

## 5. Phase B — multi-location viewport (item 12 done right)

Needs backend #2 (Tesla `locationId`); address/map/Street-View/hours work today.

- Location selector under the store name: primary + other locations as clickable chips; `?loc=<id>` in the URL,
  default primary, hidden when `locationCount<=1`.
- Selecting a location re-scopes the site-varying widgets per §1 (hours live now; reviews/phone/Places-photos
  flip to per-location as Phase-L lands — write defensively so they auto-upgrade).
- Add per-location **Send-to-Tesla** + **Call** inside `LocationsModal.LocationPane` (live coords already there);
  route the hero's Navigate/Call through the selected location. **This kills the #1 critical bug.**
- Badge contacts/notes/photos by `location_id` where present.

---

## 6. Phase C — directory / map multi-location

Needs backend #1 (`locations[]`) + #5 (`hubRoutes[]`).

- One `MapMarker` per location (flatMap locations, key by `location.id`, primary emphasized); frame/zoom from all
  coords; "near me" computes nearest LOCATION.
- Region membership set-valued (brand appears in every region it has a site in).
- Detail drawer + `StoreRow`: `locationCount>=2` → count + city chips (data already live).
- `ShowroomMergedCard`: suppress the redundant single-`location` line when multi-site (small).

---

## 7. Phase D — merge hygiene

Needs backend #3/#4.

- `replaceState` URL-heal in `StoreViewportApp`'s `api()`: when a GET follows a 302 to the keeper, rewrite the
  URL bar + stop minting loser-id sub-links.
- Fix `BrandViewportApp.tsx:186` wrong path.
- Wire the loser→keeper redirect on the page route (ownership per backend #3).

---

## 8. Phase E — merge-review admin UI (net-new, in scope per Justin)

- Admin-gated page: list `showroom_merge_candidates` → side-by-side diff of the duplicate stores → apply/reject,
  backed by the existing MCP/API (`list_merge_candidates`, `resolve_merge_candidate`, `apply_merge_candidate`).
- Follows the repo's config/admin page shell conventions (BaseLayout + island + header icon per CLAUDE.md).
- Its own spec + coordination pass with the backend session (they own the apply semantics).

---

## 9. Sequencing & PRs

One small PR per phase (CLAUDE.md rule). Order: **A → B → C → D → E.** A ships immediately (no backend dep). B/C/D
gate on their backend asks (P0 #1/#2 first). Each PR carries its QC script + changelog entry per repo discipline.
Rebase on `origin/main` before each (the backend session merges frequently).

**Open Phase-A defaults chosen (flip on review):** 360 default = interior tour; email "send via UI" = store inbox
compose route.
