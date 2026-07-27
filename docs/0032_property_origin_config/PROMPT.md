# PROMPT — 0032 Property / Origin Config

Implement `docs/0032_property_origin_config/IMPLEMENTATION_PLAN.md`. Cut a fresh worktree from
`origin/main`; re-verify all file/line references before editing (the map is from plan time).

## Non-negotiables
- **One first-class `properties` table** is the single source of truth for the property/origin.
  No hardcoded origin strings, no config-KV fallback for the address after this ships.
- **Structured parts, never a raw stored address.** Store `street_number/street_name/city/state/zip_code`;
  derive the display address via the shared `formatShowroomAddress(parts)` (from 0031). A free
  address field gets abused by AI — do not store one.
- **Geocode on write**, cache `latitude`/`longitude` on the row (reuse `GoogleMapsService`).
  Consumers read coords; they never re-geocode per request.
- **Exactly one `is_primary`** — enforce with a write guard / partial unique index.
- **D1:** `db.batch([...])` never `db.transaction()`; migrations via `pnpm run db:generate` +
  `pnpm run migrate:remote`; all data movement in a Node backfill script, not migration DDL.
- **Deploy is yours** each turn (`deploy:preview` on branch; `deploy` from merged `main`). State
  what deployed, migration status, QC.

## Phase A — table + API + backfill (PR-A)
1. `A1` Add `src/backend/db/schema/config/properties.ts` → `properties` (id PK; `is_primary` bool;
   `label`; street parts; `zip_code`; `place_id`; `google_maps_link`; `latitude`/`longitude`;
   `sf_assessor_block`; `sf_assessor_lot`; timestamps). Partial unique index enforcing a single
   `is_primary`. Export from the config barrel. `pnpm run db:generate`.
2. `A2` `pnpm run migrate:remote`; verify the table on remote.
3. `A3` CRUD API `src/backend/api/routes/admin-properties.ts` — `GET /api/admin/properties`,
   `GET /:id`, `POST /`, `PUT /:id`, `GET /primary`. Admin-gated. On create/update, geocode the
   assembled address via `GoogleMapsService` and persist `lat/lng/place_id/google_maps_link`;
   on geocode failure store parts, null coords, and return a warning (never 500).
4. `A4` `scripts/backfill/property-origin.mjs` — read the existing config KV
   (`permits_block`/`permits_lot`/address/zip via `/api/admin/config`) + the hardcoded
   `"126 Colby St, San Francisco, CA"`, parse to parts (`parseGoogleAddressComponents` /
   `parseFormattedUsAddress`), geocode, and upsert ONE `is_primary` row. Idempotent.
5. `A5` `scripts/qc/pr_<A>.mjs` — table exists; one primary row; coords non-null; CRUD round-trips.
   Changelog + PR link. **This unblocks 0031-B10.**

## Phase B — de-hardcode (PR-B)
1. `B1` Add `getPrimaryProperty(env)` service helper (cached). Replace every hardcoded
   `"126 Colby St, …"` origin — `plan_drive_route.ts:132`, `showroom-scout.ts`, `maps.ts`
   `homeAddress` callers, `openapi.ts`/`budget-tracker.ts` (audit each: live vs mere example) —
   with a read of the primary property. Grep must come back clean of the literal afterward.
2. `B2` Repoint `PropertyAddressConfigApp.tsx` to the typed CRUD; **delete the hardcoded
   `DEFAULTS`**; empty state renders from the row (or a blank create form), not a baked-in address.
3. `B3` `scripts/qc/pr_<B>.mjs` on `--preview` AND prod; grep guard for the literal; changelog + link.

## Phase C — relational ties (PR-C, optional / gated on 0033)
1. `C1` Expand/contract: add `permits_records.property_id` FK → `properties`; backfill from the
   denormalized `property_address`; verify parity; then retire the text column. Keep the text
   column until the FK is populated + verified (never a hard swap).
2. `C2` QC + changelog.

## Do NOT
- Store a raw address string, hardcode any origin, add a second config mechanism, or hard-swap the
  permits text column before the FK is verified. Multi-property UI + migrating the rest of the
  config KV are deferred (the latter waits on the 0033 audit).
