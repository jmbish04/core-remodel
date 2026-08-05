# 0043 · PROMPT — Room model overhaul

Read first, in order: `CLAUDE.md` · `PRODUCT.md` · `docs/PLANNING_PACKAGE.md` · this plan · [`SCHEMA_DIAGRAMS.md`](SCHEMA_DIAGRAMS.md).

Run `pnpm run worktree:check` and confirm 0 behind `origin/main` before reading any source file.

**Build this BEFORE 0041 Phase 1.** The Home screen and the room screen both render a room model this plan is about to restructure. Building a UI on `rooms.lengthFeet` weeks before it is deprecated means building it twice.

---

## The one constraint that shapes every migration

**Columns cannot be safely dropped from `rooms`.** A SQLite column drop is a table rebuild, and on D1 rebuilding a parent with children is the documented way child data silently disappears. `rooms` has many children.

Every "move X out of rooms" is: **add the new table → backfill → stop writing the old column → mark it deprecated in the docstring → leave it in place.** Nothing is dropped. If you find yourself generating a migration that recreates `rooms`, stop.

## What goes where

- **`rooms`** keeps identity only: floor, code, name, active, tint, order, floorplan position.
- **`walls` are PROJECT-scoped, not room-scoped.** One wall separates two spaces; per-room storage means two copies that disagree.
- **`measurements`** (the existing table) is kept and extended, not replaced. It is a good as-is ledger. What it could not do is hold a graph — `spanJson` cannot carry a foreign key — which is why walls, segments, openings and ceiling-feature distances become real tables.

## Non-negotiable rules

- **Inches, integers, canonical.** Feet, metres, square footage computed on read. A stored `areaSqFt` is wrong the first time a wall moves and nobody notices.
- **Segments in inches, not percentages.** Percentages silently rescale when a wall is resized.
- **Openings store offset + width.** The right-hand remainder is derived. Storing both sides is the feet-and-inches mistake again.
- **Load-bearing is not a boolean** — it carries a confidence and a source. An `assumed` load-bearing wall is a question, not a fact.
- **Mappings join the right pair.** `note ↔ type`, `problem ↔ type`, `material_type ↔ room_type`. Three instances of the single-value-on-a-many-valued-relationship error were corrected in this plan; do not add a fourth.
- **Photos FK to `images.id`**, never a stored URL. **Documents carry a UNIQUE `sha_hash`** so re-uploads dedupe, and an `ocr_status` so a null `doc_text` can be told from "a document with no text."
- **A ripple is an impact, not a boolean.** Link to the 0041 graph; do not build a second disruption model.
- **Takeoffs are computed, never stored**, and always report their inputs and the confidence of the measurements they rest on. A number from an `assumed` measurement is an estimate, never a quantity to order from.

## Depth is never gated

An earlier draft of this plan gated depth by intent. That was a shortcut and it is corrected. Three states:

- **Required** — gated by intent (`roomReadiness()`). About the trade threshold, not permission.
- **Offered** — gated by context. What the agent or stepper proactively raises.
- **Available** — gated by **nothing**. If a homeowner wants to record acoustic decoupling on a guest closet, record it.

The only hard requirement in the whole model is **measuring walls**, because walls are what make every other question addressable.

## One helper, not six

`resolveRoomScope()` is shared by materials, products, problems, documents, photos and notes. Six bespoke fan-out implementations will drift.

- **Chunk at 20** — this is a fan-out feature by design and 23 rooms exceeds D1's 100-bound-parameter cap in one statement.
- **Idempotent** — UNIQUE `(entity_id, room_id)` + `onConflictDoNothing`.
- **Active rooms only** — otherwise fan-out resurrects merged rooms.
- Write `room_scope_applications` alongside the rows: the mapping rows are the truth, that table is the provenance of the selection.

## One rule engine, not three

`ripple_rules` serves physical ripples, material applicability **and** scoping questions. Add `resolution` ∈ `auto_apply | auto_exclude | must_confirm | must_specify`.

**The value is knowing which branches are questions.** Tile continuing into a bathroom is genuinely ambiguous → confirm. Hardwood continuing into a bathroom almost never is → assume, do not ask. An app that asks both is a nag; one that asks neither is wrong.

## Fix while you are here

**`roomReadiness()` is currently wrong.** It requires every `isRequiredForThreshold` spec on **every** room, so an out-of-scope room sits permanently un-ready demanding a shower valve for a room nobody is touching. Intent must gate the requirement set, and `spec_definitions.appliesToRoomKinds` should be applies-to-**intents**. A room with no intent is not unready — it is not in scope.

## Build order

| Phase | Deliverable |
|---|---|
| **0** | Definition tables + admin pages; `resolveRoomScope()` + `room_scope_applications` |
| **1** | `room_measurements` with perimeter + openings; backfill; conversion API |
| **2** | `room_notes` + note↔type mapping; backfill the six `*Notes` columns |
| **3** | `room_problems` cluster; `room_intents`; the `roomReadiness()` intent fix |
| **4** | `material_type_def`, applicability rules, assemblies, fixtures, requirements, takeoffs |
| **5** | Promote-to-budget, trade assignments, permit↔room, `room_events`, retire `all_levels` |

## Stack constraints

One Cloudflare Worker. Astro SSR + React islands, Hono + zod-openapi, Drizzle on D1. Base UI not Radix.

- **Never import `drizzle-zod` in a schema file** — it breaks `pnpm run build` on the pinned `drizzle-orm@0.33.0` even though `tsc` passes. Hand-write route Zod schemas.
- `db.batch()`, never `db.transaction()`. Chunk at 20 for the 100-param cap.
- Currency as `*_text` + `*_cents`. Rich text as `*_markdown` + `*_html` + `*_plaintext`, captured with PlateJS.
- Definition tables, never hardcoded enums — **except** where adding a member changes logic (`room_stop_state.stop`, `confidence`, `effect`, `resolution`). Those stay enums on purpose.
- Migrations via `pnpm run db:generate` → `pnpm run migrate:remote`. Read the generated SQL before applying; the snapshot can re-emit an already-applied table.
- Validate every Mermaid block with `scripts/documentation/mermaid/validate.mjs`.
- **Run `node scripts/sync-proposal-docs.mjs --apply`** after touching any plan doc, so the preview matches the repo.

## Ask, do not invent

Whether `room_intents` collide with `scenario_room_plans` · whether materials belong to the space or the use across a swap · whether `room_problems` are visible to bidders · multi-room problems vs per-room plus a shared impact.
