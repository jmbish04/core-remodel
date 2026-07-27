# PROMPT — 0035 Budget / Procurement Graph

Implement `docs/0035_budget_procurement_graph/IMPLEMENTATION_PLAN.md`. Fresh worktree from `origin/main`;
re-verify refs. **Add only the §2 BUILD rows — the DROP rows are redundant and must NOT be added.**

## Non-negotiables
- **Never FK `budget_tracker_items.id`** (it's revision-chained — dangles on next edit). Use a
  `budget_item_track_id` TEXT column, no FK, matching `budget_item_material_mappings`.
- **No second contractor table before the Finding-B decision.** `companies` vs `estimate_companies` must be
  resolved (Phase 0) before any new contractor FK; estimates/contracts already link via `estimate_company_id`.
- **No denormalized `floor_id`** on invoices — add `room_id`, JOIN `rooms.floor_id` for the floor.
- **Trade-term percentages = INTEGER basis points; any dollar term = text + cents** (currency rule).
- **No fabricated data.** Backfill new links only from confident existing text matches (`source_ref`,
  `vendor_name`); flag ambiguous, never guess.
- D1 `db.batch` not `db.transaction`; Drizzle migrations only (no raw SQL / PRAGMA); FK-adds = rebuild → back
  up + validate orphans + read the generated SQL. Deploy is yours; state deploy/migration/QC.

## Phase 0 — DECISION (blocks contractor links only)
Resolve `companies` vs `estimate_companies` (Finding B): unify onto one canonical contractor table (recommend
`companies`, migrate `estimate_company_id` refs) or add a bridge. Document the choice; everything non-contractor
proceeds regardless.

## Phase A — additive links
- `worker_email_invoices.room_id` → `rooms.id`.
- `worker_email_invoice_line_items.contract_payment_milestone_id` → `contract_payment_milestones.id`.
- `budget_expense_entries`: `room_id` → `rooms.id`; `invoice_id` → `worker_email_invoices.id`;
  `budget_item_track_id` TEXT (no FK).
- `budget_tracker_items.primary_service_id` → `services.id`.
- Backfill each from existing loose text links where confident; flag the rest. QC + changelog.

## Phase B — contractor_showroom_trade_terms (new feature)
- New table: `id`, `contractor_company_id` FK (target per Phase 0), `showroom_id` → `showroom_stores.id`,
  `trade_discount_bps`/`homeowner_passthrough_bps`/`contractor_margin_bps` (INTEGER basis points),
  `min_spend_text`+`min_spend_cents` (if any), `terms_and_restrictions`, timestamps; `UNIQUE(contractor_company_id, showroom_id)`.
- CRUD API + admin UI. Add `budget_tracker_items.primary_contractor_company_id` (target per Phase 0).
- QC (pct stored as bps; a passthrough computes vs a product price) + changelog.

## Phase C — (optional) contractor unification
If Phase 0 chose to merge, run the expand/contract migration off `estimate_companies` onto `companies`.

## Do NOT
Add the §2 DROP rows (canonical_* on showroom_product_mappings, bid_portfolios.contractor_company_id,
invoices.floor_id); FK the revisioned budget_tracker_items.id; run raw SQL/PRAGMA.
