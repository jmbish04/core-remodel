# 0015 — showroom_stores cleanup

Untangles the overgrown `showroom_stores` table into normalized child tables and
a single-payload write model. Shipped in two stacks: **Phase 1–3** (hours,
address, links) first, then **Phase 4–5** (contacts + business-card vision,
email auto-populate).

Live prod baseline (2026-07-13): **120 stores**. `hours_json` on 35/120,
`weekday_hours` on 111, `zip_code` on 85, `place_id` on 111, IG/FB/Pinterest ≈ 0,
`main_poc_*` on 3 rows, `showroom_pocs` = 11 rows.

## Design principle (all phases)

API + MCP callers send **one structured payload** and never need to know the D1
table layout. The worker "fields out" the payload into the right tables:
`hours_json` → `showroom_store_hours` rows + `is_open_weekends`; an address blob →
the granular `location_*` columns; URLs → `showroom_store_links`; a business-card
scan → a person contact + an upserted `GENERAL_CONTACT` + store address/links.

## Destructive-migration safety

Column drops on D1 rebuild the table and fire cascades ([d1 cascade gotcha]).
Rule: **backfill + deploy + verify in one migration; DROP in a separate later
migration.** Backfill scripts read a legacy column *before* its drop migration
applies. Table renames use `ALTER TABLE … RENAME TO` (native, non-destructive) —
hand-verified, since `drizzle-kit generate` will emit DROP+CREATE if answered
wrong.

---

## Phase 1 — Hours (DONE, pending prod apply)

Three representations collapsed to one write source (`hours_json`) + one queryable
form (renamed `showroom_store_hours` rows) + one flag (`is_open_weekends`).

- Rename `showroom_hours` → `showroom_store_hours` (migration `0082`).
- Drop `weekday_hours` / `weekend_hours` from `showroom_stores` (migration `0083`).
- Backfill legacy `weekday_hours` free-text → `hours_json` + rows + flag
  (`scripts/0083-backfill-legacy-hours.mjs`; parser mirrored + self-tested).
- Dedup the hours parser: `showroom-stores.ts` now imports
  `@backend/utils/showroom-hours` (private copy deleted). New helpers there:
  `deriveIsOpenWeekends`, `parseLegacyHoursText`.
- Frontend: hero `HoursMiniCard` / `HoursContactModal` + directory `HoursFooter`
  render from `hours_json` / normalized rows only; legacy text paths removed.

### Prod apply order (Phase 1)

```
1. pnpm run migrate:remote          # applies 0082 (rename) [+ later 0083]
   # apply ONLY 0082 first if journal lets you; else 0082 is safe alone
2. node scripts/0083-backfill-legacy-hours.mjs --remote --dry-run   # inspect
   node scripts/0083-backfill-legacy-hours.mjs --remote             # write
3. pnpm run migrate:remote          # applies 0083 (drops legacy cols)
```

If both migrations apply together, run the backfill *before* the `migrate:remote`
that includes 0083, since it reads `weekday_hours`. Simplest safe sequence:
apply through 0082, backfill, then generate/apply 0083.

## Phase 2 — Address split (planned)

Add `location_street_number`, `location_street_name`, `location_city`,
`location_state`, `location_zip_code`; populate `google_maps_link`. Keep
`location_address` (full formatted) + `zip_code` (synced to `location_zip_code`).

- New `GoogleMapsService.placeAddressComponents(placeId)` — minimal fetch
  (fieldmask `formattedAddress,addressComponents,googleMapsUri`, no Gemini).
- Backfill via a **server-side route** (`POST /api/showroom-stores/backfill/addresses`)
  — the Places key is a Worker secret, unreadable from a node script. 111 rows
  have `place_id`; 3 (ids 14/16/17) are manual. Fill-blanks + Maps quota guard.
- API create/update accept the granular fields; place-import auto-fills them.

## Phase 3 — Links table (planned)

New `showroom_store_links` (`id`, `store_id` FK, `url`, `type` enum
WEBSITE/INSTAGRAM/PINTEREST/FACEBOOK/OTHER, `url_notes`).

- Backfill `website_url` / `instagram_url` / `facebook_url` / `pinterest_url` → rows.
- **Rewire favicon** (keys off `website_url`) to read the WEBSITE link, THEN drop
  the 4 URL columns (separate migration).
- API + MCP CRUD; frontend `SocialLinks` + Website button read the links table.

## Phase 4 — Contacts + business cards (planned)

New `showroom_store_contacts` (type enum GENERAL_CONTACT/SALES/ESTIMATOR/MANAGER/
CUSTOMER_SERVICE/OTHER, first/last, office_phone + ext / mobile / fax, email,
is_texting_ok, best_contact_times_json, is_draft, draft_notes) +
`showroom_store_contact_business_cards` (store_id, contact_id, is_draft,
draft_notes, cf_image_url, image_json). Backfill `showroom_pocs` (11) + `main_poc_*`
(3): split mixed phone strings into a person contact + upserted GENERAL_CONTACT;
`pocs.website` → links table, `pocs.address` → store row. Drop `showroom_pocs`.
Fuzzy store match (address/website/phone/placeId/explicit id); unmatched →
`is_draft`. Bulk business-card upload page → worker queue → vision **structured
output** → CF Images → contact upsert; API/MCP list failed cards for closed-loop
reprocessing. Phonebook directory page under the Shopping tools group.

## Phase 5 — Email auto-populate (planned)

`matchShowroomStore(domain)` hook in `email-handler.ts:459` (mirror `matchCompany`
against store website/email domains) upserts a staged contact; HITL box in
`InboxApp.tsx` to map an email to a store / create a store. Reuse the existing
Gemini signature extraction (phone/website/type).

## MCP tools note

The live `create_showroom` / `set_showroom_hours` / `add_showroom_poc` MCP server
is **not in this repo** — it deploys from a different codebase. The in-repo `/mcp`
connector (`src/backend/api/routes/mcp.ts`, render/measurement/research only) is
where new showroom CRUD tools land. MCP tooling is built once, cohesively, after
the Phase 1–3 data model settles (accepts the same single payloads the API does).

[d1 cascade gotcha]: the column-drop → table-rebuild → cascade hazard; test drops
against a prod snapshot, never an empty local DB.
