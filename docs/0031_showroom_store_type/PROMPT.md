# 0031 — Build prompt: Showroom Store Type

Implement the business-model **type** axis for `showroom_stores`. Full plan:
`docs/0031_showroom_store_type/IMPLEMENTATION_PLAN.md`. Design:
`DESIGN_SPEC.md`. Read both first. Read `AGENTS.md` (FK discipline, config-driven
definitions, D1 batch/param rules, page-styling, MCP tool authoring).

## Scope

A definition table + one FK, its CRUD API, MCP exposure, and the config-page /
badge / filter frontend. Type is single-select and **orthogonal** to
`showroom_store_category` — do not touch or merge categories.

## Do

1. **Schema (P1).** `showroom_store_type` already written at
   `src/backend/db/schema/showroom/store_types.ts` and barrelled. Add
   `type_id` INTEGER FK (nullable, `onDelete: "set null"`) to
   `src/backend/db/schema/showroom/stores.ts`, referencing `showroomStoreType`.
   `pnpm run db:generate` → `pnpm run migrate:remote` → verify column on remote.
   Seed the 6 types (table in the plan) and backfill `type_id` from existing
   booleans (`isBespoke`→made_to_order, `isTradeRepRequired`/`accessLevel=STRICT_TRADE_ONLY`
   →design_build, `isAppointmentOnly`→specialty_no_showroom). Backfill FILLS only,
   never overwrites. Seed/backfill via a script or the API — never hand-edit the
   generated migration, never raw SQL.
2. **API (P2).** `GET/POST /api/showroom-store-types`, `PATCH /:id`
   (list-active / create-Other / edit + soft-deactivate). Store read returns the
   joined type object; store create/update accept `typeId`; directory LIST/SEARCH
   gain a `type` filter param. Hand-written Zod v4, never drizzle-zod.
3. **MCP (P3).** New `list_store_types` tool (`tools/showroom/…`, one file,
   snake_case name, `READ_ONLY`, ≥1 example). `get_showroom`/`list_showrooms`
   return type; `update_showroom` accepts `typeId`; `search_showrooms` filters by
   type. Update `/connect/tools` docs render.
4. **Frontend (P4).** `/admin/config/showroom/store-types` on `ConfigShell` with
   color picker. Color-coded type badge (`html_color`) on directory cards + store
   viewport. `ComboboxWithOther` type picker on intake/edit. Type filter chips on
   directory, map, and drive planner. Astro shells use `class` not `className`,
   header block per the `studio.astro` pattern.

## Constraints

- Store a store's type by `type_id` FK — never a denormalized `type_name`; JOIN for the label.
- D1: `db.batch()` not `db.transaction()`; chunk any unbounded insert/`inArray` at 20.
- Single-select → FK on the row, NOT a mapping table.
- `npx tsc --noEmit` on what you touch (build doesn't type-check).

## Verify

`scripts/qc/pr_<n>.mjs`: list types → create "Other" → set a store's type → read
it back joined → filter directory by type → regression-guard the plain store
list. Run `--preview` and prod; paste output into PR + changelog entry. Changelog
branch row + entry + detail page (with the erDiagram) are mandatory.
