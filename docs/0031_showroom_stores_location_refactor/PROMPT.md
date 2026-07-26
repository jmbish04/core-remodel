# PROMPT — 0031 Showroom Stores → Location/Contacts Refactor

You are implementing the plan in `IMPLEMENTATION_PLAN.md` (same folder). Read it first, then
re-verify every file/line reference against `origin/main` before editing — the map was made
at plan time and code moves.

## Non-negotiables
- **Flat contract stays flat.** Do NOT change the JSON keys any endpoint or MCP tool returns,
  and do NOT change request-body keys. Reads JOIN the new tables and merge fields back to the
  SAME top-level camelCase keys; writes accept the same flat body and "field out" internally.
  Frontend + all 13 response TS types must not need edits (except the notes-editor swap in B9
  and removing the dead `distance_from_sf_*` field defs in Phase C).
- **`location_address` is NEVER stored.** It is a parse SOURCE only: parse it into structured
  parts, then it is dropped from `showroom_stores` permanently — the new table has no
  `location_address` column. The response `locationAddress` key is REBUILT from the parts via
  a new `formatShowroomAddress(parts)` helper. A submitted free address on write is parsed into
  parts, never persisted raw (AI abuses a free field — e.g. "SF Bay area"). Rows that will not
  parse are flagged for human fix BEFORE the Phase-C drop — never silently lost.
- **`distanceFromSf*` is derived, not stored.** Compute at read from the `/admin/config/address`
  origin → showroom coords. Not hardcoded to SF (the app is built to be sold).
- **Expand → backfill → verify → contract.** Never drop a column before its data is copied
  and row counts are asserted on the REMOTE db. Old columns stay authoritative until Phase B.
- **D1 has no transactions.** Use `db.batch([...])`; sequential + compensating-delete when a
  generated id feeds the next insert. Never `db.transaction()`.
- **Migrations:** `pnpm run db:generate` then `pnpm run migrate:remote` only. Never raw SQL,
  never hand-edit the generated DDL. All *data* movement lives in the Node backfill script,
  not in migration files.
- **Reuse, don't reinvent:** `parseGoogleAddressComponents` (`services/google/maps.ts:90`),
  the region lib (`lib/bay-area-region.ts`), and the existing `main_poc_*→contacts` backfill
  logic in `showroom-contacts.ts`.
- **Deploy is yours** every turn (`pnpm run deploy:preview` on a branch; `pnpm run deploy`
  only from merged `main`). State what you deployed, migration status, and QC results.

## Phase A — expand & backfill (PR-A)
1. `A1` Back up remote D1 FIRST: `npx wrangler d1 export DB --remote --output=backups/DB-<UTC>.sql` and confirm size/table count. This is the Phase-C restore path.
2. `A2` Add `src/backend/db/schema/showroom/store_location.ts` → table `showroom_store_locations` (`store_id` UNIQUE FK cascade; `place_id` unique index nulls-distinct; `bay_area_city_id` FK set-null; `latitude`/`longitude`; `street_number`/`street_name`/`city`/`state`/`zip_code`; `google_maps_link`; **notes triple** `notes` + `notes_markdown` + `notes_html`; timestamps). **NO `location_address` column** — it is never stored (parse-source only). Export from `showroom/index.ts`. `pnpm run db:generate`.
3. `A3` `pnpm run migrate:remote`; verify the empty table exists remotely.
4. `A4` Write `scripts/backfill/showroom-locations.mjs`: copy the structured parts + coords + `place_id` + `google_maps_link` + `bay_area_city_id` (COALESCE `location_zip_code`, `zip_code`), seed the notes triple from the existing plain `location_notes` (`notes`=plain, `notes_markdown`=plain, `notes_html`=`<p>`-escaped), and where street parts are null gap-fill them by parsing `location_address` with a small `parseFormattedUsAddress` (ship an `assert` self-check) — the raw `location_address` is a source only and is NEVER written to the new table. If a row won't parse and parts stay null, flag it (a report or a draft marker) for human fix before Phase C. Migrate `main_poc_*` → contacts (named → `SALES` first/last split + `mobile_phone_number` + email; name-less → upsert `GENERAL_CONTACT`). Idempotent (upsert by `store_id`; guard contact inserts).
5. `A5` Run it against remote; assert `count(locations) == count(stores)`; spot-check 10 parsed addresses + POC rows.
6. `A6` Dual-write: every writer in §5.1 writes the new table alongside the existing old columns (do not remove old writes yet).
7. `A7` `scripts/qc/pr_<A>.mjs` — table exists, counts match, dual-write parity. Changelog rows + PR body link.

## Phase B — cutover (PR-B)
1. `B1` Shared read helper `loadStoreWithLocation` — LEFT JOIN `showroom_store_locations`, merge to flat camelCase, derive `hubRoute`/`hubName` from the `bay_area_city` join (falling back to `resolveCityName(signals)`), and derive `locationAddress` from the structured parts via a new `formatShowroomAddress(parts)` helper.
2. `B2`/`B3` Repoint every reader in §5.2 (API + MCP) through the helper. Keep output keys identical.
3. `B4` Shared field-out writer — flat body → `{stores identity, locations, contacts}`; `db.batch`. POC fields fan out to contacts (SALES / GENERAL_CONTACT). Stop writing the old columns.
4. `B5`/`B6` Repoint every writer in §5.1 (API + MCP + services + seed) to the field-out helper.
5. `B7` Hub derivation wired on write (sets `bay_area_city_id` via `resolveStoreGeoPatch`) and at read (helper). No captured hub columns read/written.
6. `B10` Distance derivation — compute `distanceFromSf*` at read from the **property/origin config table** (D1, plan **0032**; lat/lng) → showroom coords (reuse the existing drive/geo distance util). Never stored, never hardcoded to SF. **Blocked until 0032 lands.**
7. `B9` Notes → PlateJS triple end-to-end: the field-out writer accepts `{markdown, html}` (derives plaintext) and the read helper returns `locationNotes`/`locationNotesMarkdown`/`locationNotesHtml`; swap the notes input in `EditStoreModal.tsx` (and the intake notes field) from a plain textarea to the existing `OverviewNoteEditor` (`@/components/showroom/OverviewNoteEditor`). Sanitize html on write.
8. `B8` `scripts/qc/pr_<B>.mjs` on `--preview` AND prod; frontend smoke on preview (notes editor round-trips markdown+html; derived `locationAddress` + `distanceFromSf*` correct). Changelog + link.

## Phase C — contract (PR-C)
1. `C1` Remove the moved/dead columns from `stores.ts` + the `main_poc_*`, `hub_*`, `distance_from_sf_*` columns. `pnpm run db:generate`. **Read the generated SQL:** confirm native `ALTER TABLE showroom_stores DROP COLUMN` (NOT a `__new_` rebuild) and a `DROP INDEX showroom_stores_place_id_uniq` before the `place_id` drop. If it's a rebuild, STOP and hand-author native drops.
2. `C2` `pnpm run migrate:remote`; verify columns gone (`PRAGMA table_info`) and every read endpoint still 200.
3. `C3` Remove the two dead `distance_from_sf_*` field defs from `EditStoreModal.tsx` (and any hero edit-modal stale refs). Nothing else frontend changes.
4. `C4` `scripts/qc/pr_<C>.mjs` regression on prod; `pnpm run smoke`. Changelog + link.
5. `C5` Verify `/connect/tools` catalog cards + MCP input shapes are unchanged (flat inputs preserved).

## Do NOT (this build)
- Nest the contract, rewrite frontend types, or touch legacy `showroom_pocs`.
- Generalize the region classifier beyond the Bay Area. Both are Phase D follow-ups.
