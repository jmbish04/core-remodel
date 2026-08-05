# PROMPT — 0035 Budget Grid + Workbench (coding agent hand-off)

You are implementing the budget program for core-remodel (Astro SSR + Hono + Drizzle/D1 on one Cloudflare
Worker, dark Monolith shadcn/Base-UI). Read `docs/0035_budget_procurement_graph/IMPLEMENTATION_PLAN.md` and
`DESIGN_SPEC.md` first. Build the Claude-Design files `RemodelBudgetGrid.dc.html` (grid) and
`BudgetWorkbench.dc.html` (workbench) from project `f89ef0fb` — parity of layout/interaction, repo primitives
for the actual code.

**Ship one PR per phase.** Order: Phase S → 0 → 1 → 2 (grid), then 3 → 4 → 5 → 6 → 7 → 8 (workbench). Grid
(S–2) is the priority; get it live and reviewed before the workbench phases.

## Non-negotiable repo law
- **Never FK `budget_tracker_items.id`** — it revisions in place. Attach budget links on the stable
  `track_id` TEXT (see `budget_item_material_mappings`). `budget_plan_schedule` and
  `budget_expense_entries.budget_item_track_id` both key on `track_id`, no FK.
- **Finding B gates contractor FKs** — resolve `companies` vs `estimate_companies` before adding any. No
  denormalized `floor_id` on invoices (add `room_id`, JOIN `rooms.floor_id`).
- **D1**: `db.batch` (never `db.transaction`); chunk unbounded inserts/`inArray` at 20 rows; FK-adding
  migrations rebuild the table → back up remote, validate orphans, READ the generated SQL before
  `pnpm run migrate:remote`. `db:generate` diffs snapshots — strip re-emitted already-applied tables.
- **Currency** = `*_cents` INT **and** `*_text` verbatim, entered via `CurrencyInput`. **Rich text** =
  `*_markdown` + `*_html` (PlateJS), sanitize html. **Vocabularies** (phases, categories) = definition +
  FK/mapping, config page under `/admin/config/...`, `ComboboxWithOther`/`MultipleSelector`. Never
  comma-strings, never text-only money.
- **AI** = structured output + JSON schema, return **ids** validated against live rows, never degrade a parse
  to `{}`. Reconciliation suggest is ungrounded → use schema.
- **No fabricated data.** Seed the plan schedule from real estimates (spread), attribute expenses only on a
  confident match, flag the rest.
- Pages follow `studio.astro`: `class` not `className` in `.astro`, `container mx-auto px-4 py-8 pb-12`,
  `mb-8` header with a `size-6` icon + muted `<p>`, island `client:only="react"`.
- MCP tool = one file per tool under `src/backend/mcp/tools/<domain>/`, register in the domain index; verify
  the auto-rendered docs card + example.
- Every PR: changelog branch/entry/detail with QC output + remote-migration status; ERD in `diagrams[]` for
  schema phases; `scripts/qc/pr_<n>.mjs` run against **preview AND prod**; delete the preview worker on merge.
- **Deploy is yours** at end of each shipping turn: `pnpm run deploy` from main (or the Deploy (manual)
  Action), verify the migration landed before the code reads the new column, state what you deployed.

## Phase cheat-sheet
- **S** — original 0035 links (see the Phase-S detail below): `budget_expense_entries.budget_item_track_id`
  (+`room_id`,`invoice_id`), `worker_email_invoices.room_id`,
  `worker_email_invoice_line_items.contract_payment_milestone_id`, `budget_tracker_items.primary_service_id`,
  `contractor_showroom_trade_terms` (bps + text/cents, UNIQUE(contractor,showroom)). Backfill confident text
  links, flag rest. Finding B first for the contractor FK.
- **0** — `budget_phases` def + config page `/admin/config/budget/phases`; `budget_tracker_items.phase_id`;
  `budget_plan_schedule`; item variance-note md+html; contingency funding-account convention; idempotent seed
  (spread estimate → monthly plan; attribute expenses → items by confident match, flag rest).
- **1** — `GET /api/budget/grid` (exact UI shape; params view/from/to/phase/q), `PATCH
  /api/budget/plan-schedule`, MCP `get_budget_grid` read tool, QC fixture assert.
- **2** — `/admin/budget/grid` + `BudgetGridApp` (rebuild `RemodelBudgetGrid.dc.html`): scorecards, tabs,
  phase rows + rings, line flags, month cols, footer rollups, filters, inline plan edit, Log-expense dialog,
  realtime. **Load the `impeccable` skill for this UI.**
- **3** — extend `estimate_line_items` (room_id, budget_item_track_id, mapping_status, ai_suggested_room_id,
  ai_suggested_category, mapping_confidence); reconcile route + AI suggest (schema, ids); staging HITL UI +
  MCP confirm (ambiguous-parent doctrine); consider mounting the unwired `csv-ingestion.ts`.
- **4** — `GET /api/budget/inbox` derived alerts; per-room finance rollup (committed/spent/risk/blocker).
- **5** — `budget_savings_entries` + CRUD; persist applied reallocations as funding movement; UI.
- **6** — services tab (item_type='professional_service', phased), labor/trade rollup compute, surface
  trade-terms + passthrough calc.
- **7** — bid visibility matrix (map bid_portfolios booleans → public/conditional/private) + completeness;
  read-only sync ledger over `google_sheet_sync_events`.
- **8** — `/admin/budget/workbench` shell assembling all tabs (`BudgetWorkbench.dc.html`).

## Phase-S detail (original 0035 links — the substrate)
- `worker_email_invoices.room_id` → `rooms.id`.
- `worker_email_invoice_line_items.contract_payment_milestone_id` → `contract_payment_milestones.id`.
- `budget_expense_entries`: `room_id` → `rooms.id`; `invoice_id` → `worker_email_invoices.id`;
  `budget_item_track_id` TEXT (no FK).
- `budget_tracker_items.primary_service_id` → `services.id`; `primary_contractor_company_id` (target per Finding B).
- NEW `contractor_showroom_trade_terms`: `contractor_company_id` FK (per Finding B), `showroom_id` →
  `showroom_stores.id`, `trade_discount_bps`/`homeowner_passthrough_bps`/`contractor_margin_bps` (bps),
  `min_spend_text`+`min_spend_cents`, `terms_and_restrictions`, `UNIQUE(contractor_company_id, showroom_id)`.
- Do NOT add the redundant DROP rows (canonical_* on showroom_product_mappings,
  bid_portfolios.contractor_company_id, invoices.floor_id) or FK the revisioned `budget_tracker_items.id`.

## Definition of done (grid, the near-term goal)
`/admin/budget/grid` renders real phases and line items with monthly plan (seeded, editable) and actuals
(from linked expenses); Estimate/Actuals/Variance all compute correctly against a QC fixture; scorecards +
footer rollups match; Log-expense writes a line-linked expense; deployed to prod with migrations applied and a
changelog entry linking the QC run.
