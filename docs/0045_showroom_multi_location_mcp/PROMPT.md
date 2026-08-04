# PROMPT — 0045 Showroom multi-location, wired end to end (MCP first)

You are finishing work that was started and abandoned. Read
`docs/0045_showroom_multi_location_mcp/IMPLEMENTATION_PLAN.md` in full first, then
`docs/0031_showroom_stores_location_refactor/IMPLEMENTATION_PLAN.md` for the original design
decisions (they still hold).

## The situation, stated plainly

- `showroom_store_locations` **exists on prod** (migration `0145`, PR #278) and holds
  **0 rows**. `grep -rn showroomStoreLocations src/` returns **two hits, both schema files**.
- Every read and write in the app still uses the flat `location_*` / `place_id` / `latitude`
  columns on `showroom_stores`. 221 stores, one address each.
- Do **not** assume any part of the 1:many model is live. It is not.

## What to build

### P1 — backfill first, or everything returns `[]`
`scripts/sql/backfill_showroom_store_locations.sql`:

```sql
INSERT INTO showroom_store_locations
  (store_id, place_id, google_maps_link, bay_area_city_id, latitude, longitude,
   street_number, street_name, city, state, zip_code, notes)
SELECT s.id, s.place_id, s.google_maps_link, s.bay_area_city_id, s.latitude, s.longitude,
       s.location_street_number, s.location_street_name, s.location_city, s.location_state,
       COALESCE(s.location_zip_code, s.zip_code), s.location_notes
FROM showroom_stores s
WHERE NOT EXISTS (SELECT 1 FROM showroom_store_locations l WHERE l.store_id = s.id);
```

Apply with `npx wrangler d1 execute core-remodel --remote --file <path>`, then **assert**
`count(locations) == count(stores)`. It is data, not schema — do not turn it into a drizzle
migration, and do not hand-edit `drizzle/`.

### P2 — `src/backend/services/showroom/locations.ts`
- `formatShowroomAddress(parts)` — derive `"123 Main St, San Carlos, CA 94070"`, skip blanks.
  There is **no `location_address` column on the locations table by design**; the display
  address is always derived. Leave one `assert`-based self-check behind.
- `loadStoreLocations(db, storeIds)` → `Map<number, LocationDto[]>`. **Chunk `storeIds` at 20**
  — D1 caps a statement at 100 bound parameters and this list length is not yours to control.
- Derive `cityName` / `hubRoute` / `hubName` with `classifyBayAreaRegion` + `resolveCityName`
  from `src/backend/lib/bay-area-region.ts`. Do **not** add stored hub columns.
- `isPrimary` is **derived** (location `place_id` == store `place_id`, else lowest `id`).
  Never add an `is_primary` column — it drifts.

### P3 — MCP reads
- `get_showroom` → add `locations: LocationDto[]` + `locationCount`.
- `list_showrooms` → add `locationCount` per row + `multiLocationOnly?: boolean`.
- Rewrite both **descriptions** so a chat agent reading the catalog learns the model: one
  store row is a *business*, addresses live on its locations, and adding a site is
  `add_showroom_location` — not an edit to the store's address.

### P4 — three new tools, one file each
`src/backend/mcp/tools/showrooms/{add,update,delete}_showroom_location.ts`, each exporting a
`defineTool({...})`, then one export line each in `tools/showrooms/index.ts`.

- Hand-written Zod v4 `inputShape`. **Never import drizzle-zod** — it breaks `pnpm run build`.
- Annotations: `WRITE`, `WRITE`, `DESTRUCTIVE`.
- ≥1 `example` each.
- `add_showroom_location`: pre-check `place_id` against the unique index and, on collision,
  fail with a message that **names the store that already owns that site**.
- `delete_showroom_location`: refuse to delete a store's **last** location.
- **Dual-write:** when the mutated location is primary, mirror the address/coords/place_id
  back onto `showroom_stores` so every un-migrated reader stays correct. Non-primary rows
  must not touch the store row.
- **No `db.transaction()`** — dead on D1. Use `db.batch([...])`.

### P5 — the sibling-caller fix (do not skip)
`find_known_showrooms` and `search_showrooms` match an inbound `placeId` against
`showroom_stores.place_id` only. New sites will only ever carry a `place_id` on the
**location** row, so a chain's second site reads as "not registered" and an agent creates a
duplicate store — the exact thing this model exists to prevent. Match locations first and
report the **owning store id**.

### P6 — QC
`scripts/qc/pr_<n>.mjs` using `scripts/config.mjs` (`createClient`, `createChecks`,
`assertReachable`) and `scripts/tokens.mjs`. Run against **preview** (`-- --preview`) **and**
prod. Paste the real output into the PR body and the changelog entry — never paraphrase.

## Rules that will bite you here specifically

- **Foreign keys, never denormalized name columns.** Join for a display name.
- **`pnpm run build` does not type-check** — also run `npx tsc --noEmit` and diff against the
  pre-existing baseline, do not compare error counts.
- **Nothing auto-deploys.** After merge, `pnpm run deploy` from `main` (or the
  `Deploy (manual)` Action), then verify.
- Update `plan_tasks` with `update_plan_task` as you go: `in_progress` → `in_review` + PR
  number → `done`. A row left at `pending` after the work merged is a lie.

## Out of scope

0031 Phase B (repoint every API reader/writer + frontend) and Phase C (drop the 20 legacy
columns). This plan deliberately keeps the legacy columns dual-written.
