# S1 · Schema additions (blocking first step)

Add THREE new Drizzle tables. Do exactly this and nothing more — other agents wait on this schema.

Repo root (a git worktree; work here, never cd to the main checkout):
`/Volumes/Projects/orca/worktrees/core-remodel/budget-ux-overhaul`

## Read first, in this order
1. `docs/plans/budget-command-center/D1-DRIZZLE-RULES.md` — binding rules for this epic.
2. `src/backend/db/schema/home/budget_tracker_items.ts` — house style for a schema file here (column naming, timestamp defaults, index declaration). Match it exactly.
3. `src/backend/db/schema/estimates/estimates.ts` — especially `estimateLineItems` (~line 139) and `estimateRoomMappings`.
4. `src/backend/db/schema/contracts/contracts.ts` — the existing contracts domain. BUILD ON IT; duplicate nothing.
5. `src/backend/db/schema/index.ts` — the barrel; export your new tables the way the neighbours are exported.

## Hard rules (a violation is a defect)
- Foreign keys only. NEVER a denormalized `*_name` column duplicating another table's data (no `room_name`, no `account_name`). Display names come from a JOIN.
- Money is `integer("..._cents")`. Where the repo currency convention applies, store BOTH `<field>_text` TEXT (verbatim) and `<field>_cents` INTEGER.
- Rich text stores BOTH `<field>_markdown` and `<field>_html`. Never only one.
- NEVER import drizzle-zod in a schema file — it passes tsc but breaks `pnpm run build` on the pinned drizzle-orm.
- Declare every index in the schema file's third `(t) => ({ ... })` argument. Never hand-write an index into migration SQL.
- Timestamps: `integer("...", { mode: "timestamp" })` with ``.default(sql`(unixepoch())`)``, matching neighbouring files.

## Table 1 — `estimate_line_room_candidates`
File: `src/backend/db/schema/estimates/estimate_line_room_candidates.ts` (or inside `estimates.ts` if that better matches the existing layout — read and decide).

Purpose: when an inbound estimate line plausibly belongs to one of several rooms, stage RANKED CANDIDATE ROOMS each carrying its elimination reasoning; a human confirms. Nothing reaches `estimate_line_items.room_id` unconfirmed.

| Column | Type |
| --- | --- |
| `id` | INTEGER PK autoincrement |
| `estimate_line_item_id` | INTEGER NOT NULL FK → `estimate_line_items.id`, cascade |
| `room_id` | INTEGER NOT NULL FK → `rooms.id`, cascade |
| `rank` | INTEGER NOT NULL (1 = best) |
| `verdict` | TEXT NOT NULL (`likely` \| `possible` \| `eliminated`) |
| `reasoning_markdown` | TEXT |
| `reasoning_html` | TEXT |
| `evidence_json` | TEXT (structured facts the reasoning cites) |
| `confidence` | REAL |
| `datetime_created` | timestamp |

Indexes: UNIQUE `(estimate_line_item_id, room_id)`; index `(estimate_line_item_id, rank)`.

## Table 2 — `budget_reallocation_ledger`
File: `src/backend/db/schema/home/budget_reallocation_ledger.ts`

Purpose: append-only record of money moving between funding accounts, rooms, and the contingency reserve.

| Column | Type |
| --- | --- |
| `id` | INTEGER PK autoincrement |
| `occurred_at` | INTEGER timestamp NOT NULL |
| `event_title` | TEXT NOT NULL |
| `event_detail` | TEXT |
| `from_account_id` | INTEGER FK → `budget_funding_accounts.id`, nullable, set null (null = external inflow) |
| `to_account_id` | INTEGER FK → `budget_funding_accounts.id`, nullable, set null |
| `from_room_id` | INTEGER FK → `rooms.id`, nullable, set null |
| `to_room_id` | INTEGER FK → `rooms.id`, nullable, set null |
| `amount_cents` | INTEGER NOT NULL |
| `amount_text` | TEXT |
| `reference_type` | TEXT (`change_order`, `refund`, `heloc_draw`, …) |
| `reference_id` | TEXT (e.g. `CO-14`) |
| `created_by` | TEXT |
| `datetime_created` | timestamp |

Indexes: `(occurred_at)` for the ledger's default DESC ordering; `(from_account_id)`; `(to_account_id)`.

## Table 3 — `contract_compliance_gates`
File: `src/backend/db/schema/contracts/contract_compliance_gates.ts`

Purpose: the payment gates that must pass before money moves on a contract.

| Column | Type |
| --- | --- |
| `id` | INTEGER PK autoincrement |
| `contract_id` | INTEGER NOT NULL FK → `contracts.id`, cascade |
| `gate_type` | TEXT NOT NULL (`down_payment_cap` \| `signed_change_order` \| `lien_release` \| `license_active`) |
| `state` | TEXT NOT NULL (`pass` \| `fail` \| `warn` \| `na`) |
| `evidence_markdown` | TEXT |
| `evidence_html` | TEXT |
| `evaluated_at` | INTEGER timestamp |
| `expires_at` | INTEGER timestamp |
| `source_ref` | TEXT |
| `datetime_created` | timestamp |
| `datetime_updated` | timestamp |

Indexes: UNIQUE `(contract_id, gate_type)`; index `(contract_id, state)`.

## Also
Check whether a CSLB license number and license expiry already exist in the contracts or estimate-companies schema. READ the actual schema files — do not infer a column from a neighbouring call site. Only if they do not exist, add `cslb_license_number` TEXT and `license_expires_at` INTEGER timestamp to whichever existing table is the correct owner (most likely the company/vendor row, not the contract). Say which table you chose and why.

## Then
- Export every new table from `src/backend/db/schema/index.ts`, following the existing pattern.
- Run `pnpm run db:generate`.
- READ the generated `.sql`. Drizzle diffs meta snapshots, not SQL — a behind snapshot re-emits `CREATE TABLE` for tables already applied on production. Report prominently any statement that is not part of YOUR delta; do not silently leave it in.
- Run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` and confirm no NEW errors. The repo has a large pre-existing baseline — compare error lists, never counts.

## Do not
Apply the migration to remote. Deploy. Touch `src/frontend`. Touch any API route. Run `git commit`, `git checkout`, `git stash`, `git reset`, or `git clean` — other sessions share this machine and uncommitted work is unrecoverable.

## Report
Files created/changed; the generated migration tag and its exact SQL; which table got the CSLB columns and why; the tsc before/after comparison.
