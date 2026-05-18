## Expanded Plan: Estimates + Contracts Intelligence System for Core-Remodel

### Summary

Build a new `estimates + contracts` subsystem in the existing single Cloudflare Worker, with:

1. wizard-style intake with autosaving drafts,
2. multi-source ingestion (file, URL, verbal/text),
3. Workers AI structured extraction with user-confirmed values tracking,
4. immutable revision history with latest-head semantics,
5. realtime UI updates over WebSockets,
6. company/contact intelligence and email-driven matching,
7. contract risk analysis, milestone/payment tracking, and monitoring,
8. optional Google Sheets bidirectional sync.

### Implementation Changes

#### 1) Data Model (D1/Drizzle) for Estimates

- `estimate_companies`
  - `id`, `name`, `business_type`, `website`, `email`, `phone`, `address`, `cslb_license_number`, `is_active`, timestamps.
- `estimate_company_contacts`
  - `id`, `estimate_company_id` nullable, `name`, `title`, `email`, `phone`, `source`, `mapping_status`, timestamps.
- `estimate_statuses`
  - `id`, `name`, `description`, `sort_order`, `is_terminal`, timestamps.
- `estimates`
  - `id`, `scenario_id` nullable (hybrid scope), `estimate_company_id`, `current_revision_id`, `is_active`, timestamps.
- `estimate_revisions`
  - `id`, `estimate_id`, `revision_number`, `is_draft`, `is_latest`, `estimate_status_id`, `status_notes`, `date_estimate`, `total_amount_cents`, `total_tax_cents`, `deposit_amount_cents`, `warranty_details`, `cancellation_details`, `ai_rationale`, `change_source`, `created_by`, timestamps.
- `estimate_revision_snapshots`
  - immutable autosave checkpoints for wizard state.
- `estimate_documents`
  - `id`, `estimate_revision_id`, `source_type` (`pdf`,`photo`,`url`,`free_text`,`audio_transcript`), `r2_object_key`, `r2_url`, `source_url`, `raw_text`, `raw_markdown`, `ai_structured_extraction_json`, timestamps.
- `estimate_line_items`
  - `id`, `estimate_revision_id`, `item_code`, `description`, `qty`, `uom`, `unit_cost_cents`, `line_total_cents`, `tax_cents`, `notes`.
- `estimate_room_mappings`
  - many-to-many between `estimate_revision_id` and `room_id`.
- `estimate_source_events`
  - per-revision source provenance trail (important for later revisions and audits).
- `estimate_prop_key_types`
  - `id`, `property` unique, `data_type`, `schema_version`, timestamps.
- `estimate_prop_values`
  - `id`, `estimate_revision_id`, `estimate_document_id`, `property`, `estimate_prop_key_type_id`, `workerai_extracted_value`, `intake_form_value`, `is_user_overridden`, timestamps.

#### 2) Data Model for Contracts (Parallel Family)

- `contracts`
  - `id`, `scenario_id` nullable, `estimate_company_id`, `linked_estimate_id` nullable, `current_revision_id`, `contract_required`, `is_active`, timestamps.
- `contract_statuses`
  - draft, under_review, negotiating, accepted, active, completed, terminated.
- `contract_revisions`
  - revision head + draft semantics aligned to estimates.
- `contract_documents`
  - original contract files, addenda, COs, emails-as-artifacts.
- `contract_clause_findings`
  - AI extracted clauses and risk categories (warranty, indemnity, delay, lien waiver, dispute, cancellation, insurance, scope exclusions).
- `contract_payment_milestones`
  - milestone name, due criteria, amount, due-date/range, completion evidence requirements, approval status.
- `contract_timeline_milestones`
  - planned/actual dates, delay reasons, notice windows.
- `contract_warranty_terms`
  - duration, scope, exclusions, start triggers.
- `contract_negotiation_items`
  - AI recommendation, user decision, disposition notes.
- `contract_monitoring_events`
  - links email/events to contractual obligations and warnings.

#### 3) Worker Bindings and Type Safety

- Add dedicated R2 binding for estimate/contract artifacts in `wrangler.jsonc`.
- Regenerate Cloudflare env types with `pnpm run cf-typegen`.
- Keep all schema exports centralized via `src/backend/db/schema/index.ts`.

#### 4) Intake + Extraction Pipeline

- Step 1 (`Source of estimation`) requires exactly one source mode:
  - document upload,
  - URL input,
  - verbal/text input (with optional speech-to-text via existing Whisper endpoint).
- Processing pipeline:
  - File source: store in R2, extract text/OCR, then Workers AI structured extraction (JSON schema).
  - URL source: Browser Rendering scrape (`markdown`/`snapshot` + optional structured `/json`) then Workers AI normalization to strict schema.
  - Verbal/text source: transcript/raw text to Workers AI structured extraction.
- Save both raw extraction and normalized structured result.
- Auto-register unseen schema properties in `estimate_prop_key_types`.
- Pre-fill Step 2 fields from structured extraction and persist user overrides separately.

#### 5) Estimate Wizard UX

- New Estimates viewport:
  - lists latest submitted estimates,
  - draft intakes in progress,
  - recently updated revisions,
  - filters by status/company/room/scenario.
- New full-page intake screen with left sidebar:
  - back button to viewport,
  - vertical stepper list,
  - autosave state indicator.
- Step flow:
  1. Source of estimation (required).
  2. Confirm details (company, status, totals, terms, line items, room mappings, notes).
  3. Review/confirm/submit (save draft, back, submit).
- Revision UI:
  - detail view shows latest revision as primary,
  - “view revisions” modal with full history and source artifacts.

#### 6) Realtime System

- Add dedicated Durable Object channel for estimate/contract collaboration updates.
- Broadcast events:
  - draft autosaved,
  - revision submitted,
  - status changed,
  - AI extraction completed,
  - contract risk findings updated.
- Frontend behavior:
  - patch rows/cells in place,
  - temporary yellow flash for changed cells.

#### 7) APIs (Public Interface Additions)

- Estimates:
  - `GET /api/estimates`
  - `POST /api/estimates/drafts`
  - `PATCH /api/estimates/drafts/:id/autosave`
  - `POST /api/estimates/:id/revisions`
  - `GET /api/estimates/:id/revisions`
  - `GET /api/estimates/:id/revisions/:revisionId`
  - `GET /api/estimate-statuses`
- Source ingestion/extraction:
  - `POST /api/estimates/intake/source`
  - `POST /api/estimates/intake/extract`
  - `POST /api/estimates/intake/confirm`
- Companies/contacts:
  - `GET/POST/PATCH /api/estimate-companies`
  - `GET/POST/PATCH /api/estimate-contacts`
  - mapping queue endpoint for unmatched contacts.
- Contracts:
  - `GET /api/contracts`
  - `POST /api/contracts/drafts`
  - `PATCH /api/contracts/drafts/:id/autosave`
  - `POST /api/contracts/:id/revisions`
  - `GET /api/contracts/:id/revisions`
  - `GET /api/contracts/:id/risks`
  - `GET /api/contracts/:id/payment-milestones`
- Sync:
  - `POST /api/sync/google-sheets/pull`
  - `POST /api/sync/google-sheets/push`
  - `GET /api/sync/google-sheets/status`
- OpenAPI:
  - add operationIds for all new methods, expose in `/openapi.json`, `/docs`, `/scalar`, `/swagger`.

#### 8) Contracts Monitoring + Bad-Faith Risk Guardrails

- Contractor/subcontractor path uses strict contract gating.
- Payment milestone claims must reference milestone completion criteria + evidence.
- AI contract analyzer produces:
  - missing-term findings,
  - risky-term findings,
  - negotiation suggestions,
  - timeline/payment warning signals.
- Email-monitoring hook:
  - parse sender,
  - match contact/company by exact email then domain fallback,
  - if unresolved, create mapping-needed queue entry,
  - attach event to contract/estimate timeline.

#### 9) Google Sheets Interop

- Use explicit mapping columns in sheet:
  - `estimate_id`, `revision_id`, `revision_number`, `is_draft`, `is_latest`, timestamps, sync hash.
- Conflict strategy:
  - if sheet edit targets stale head, create draft revision rather than overwrite.
- Provide both manual sync button and scheduled sync job path.
- Apps Script companion performs pull/push with idempotency keys and last-sync cursor.

### Research Execution Sub-Plan and Leverage

- `Comcast/react-data-grid` and `iddan/react-spreadsheet` for spreadsheet-like editing interaction patterns.
- `cabljac/do-d` for Cloudflare Durable Object websocket/hybrid state coordination pattern.
- `theoephraim/node-google-spreadsheet` for robust TS row/cell sync operations.
- `xuthus/google-apps-script-sync` for practical Apps Script project sync workflow.
- `datadrivenconstruction/OpenConstructionERP` for estimate/BOQ workflow ideas, lifecycle statuses, and revision-heavy operational patterns.
- Not adopted for v1:
  - CRDT-heavy collaborative stacks (`y-sweet`) to keep D1 authoritative revision chain simple.
  - public-read sheet APIs (`opensheet`) for production bidirectional sync.

### Test Plan

- Migration tests:
  - all new tables, FKs, indices, uniqueness, nullable rules.
- Revision invariants:
  - latest-head correctness, revision numbering, draft autosave snapshots, no history loss.
- Extraction tests:
  - source-type coverage (pdf/photo/url/free_text/audio transcript), schema conformance, unknown property registration.
- API tests:
  - draft lifecycle, submit lifecycle, revisions listing, status transitions, contact/company mapping queue.
- Realtime tests:
  - websocket event fanout, cell patching order, yellow flash triggers.
- Contract risk tests:
  - milestone gating, warning generation, unresolved-contact routing.
- Sync tests:
  - D1->Sheets, Sheets->D1, stale-head conflict to draft, idempotent replays.
- End-to-end user journeys:
  - new estimate via PDF,
  - manual verbal estimate intake,
  - revise estimate,
  - contractor contract review + negotiation + payment milestone progression.

### Assumptions and Defaults

- `Hybrid scope` is implemented with optional `scenario_id` and explicit room mappings.
- Autosave uses mutable draft row plus immutable snapshot/event rows.
- Mixed strictness:
  - strict contract enforcement for contractor/subcontractor,
  - advisory contract tracking for material vendors/skilled labor as needed.
- D1 is source of truth; Sheets is interoperable mirror with controlled conflict handling.
- All critical financial/timeline changes are revisioned and auditable.
- New R2 artifact bucket is added for estimate/contract files and extraction payloads.
