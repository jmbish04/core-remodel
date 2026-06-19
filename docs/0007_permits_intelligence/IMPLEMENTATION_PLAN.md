# Permits Intelligence Expansion — Design

- **Date:** 2026-06-19
- **Status:** Draft for user review
- **Area:** `src/backend/services/dbi/` (permits-sync, contractor-sync, soda), `src/backend/db/schema/home/`, `src/backend/api/routes/admin-permits.ts`, `src/frontend/components/PermitsAdminApp.tsx`, frontend docs.
- **Property of interest:** 126 Colby Street — **Block 5934 / Lot 005** (parcel `5934005`, zip `94134`).

## Context

The permits subsystem already does the hard part well: a daily cron (`0 14 * * *` → `runPermitSync`) pulls 126-Colby permits from SF SODA datasets, stores them in `permits_records`, derives `isClosed`, and scopes contractor "accountability" monitoring to **open** property permits only — contractors no longer on any open anchor are demoted (`is_monitored = false`) and their activity rows cleared. A run audit lives in `permits_sync_runs`.

Three gaps motivate this work:

1. **"Active" is too loose.** Old permits with no SODA status (the SF *plumbing* dataset carries none) or a stale non-terminal status read as active forever. Live example: `202307172359` (filed 2023‑07, still `issued` in SODA) is really dead — Mr. Roofing let it expire and re-filed as `202409241521` (now `complete`). It still shows active and would still anchor a contractor.
2. **Only permits + contacts are monitored.** The homeowner also wants eyes on violations, fire inspections, fire permits, planning-review triggers, richer contractor identity, and how their permit's review pace compares to DBI's citywide performance.
3. **A reliability bug.** Several sync sub-runs error with `D1_ERROR: ... use transaction() ... instead of SQL BEGIN TRANSACTION or SAVEPOINT` (D1 forbids SQL transactions) plus an occasional storage-timeout. Stale permit data is a symptom.

## Goals

- Keep **all** permits (history is valuable); never delete.
- Auto-flag a derived **`SUSPECTED_EXPIRED`** state at > 365 days for non-terminal permits; let the homeowner **close it with a required note**.
- Add tabbed UX to `/admin/permits`: **Scans** (property permits) and **Runs** (pipeline history).
- Fix the D1-transaction ingestion bug so the daily sync stops failing.
- Introduce a **generic DataSF source registry** so new datasets are config, not bespoke code.
- Integrate new datasets in phases: **monitoring → contractor enrichment → benchmark**.
- Benchmark group: snapshot DBI performance every run, flag anomalies vs prior snapshots, flag our permits lagging the citywide average, and cross-reference each active 126-Colby contractor's *other* projects' DBI pace.
- Update the frontend docs to describe monitoring, snapshot benchmarking, and contractor enrichment.

## Non-goals

- Deleting or hiding historical permits.
- The image-tags overhaul (SP1) and code tidy-ups (SP0) — tracked separately.
- Rebuilding the existing contractor map/insights UI beyond additive enrichment.

## Migration & deploy constraint (applies throughout)

The Drizzle migration **journal is broken** (`pnpm run deploy` runs `migrate:remote` which is unsafe). Every schema change here is **additive** (new nullable columns / new tables). For each: generate SQL with `drizzle-kit`, but **apply it manually** to remote D1 via a reviewed `wrangler d1 execute --remote` of the exact `ALTER TABLE`/`CREATE TABLE`, then `wrangler deploy` (never `migrate:remote`). No destructive changes.

---

## Phase 0 — Foundation (active lifecycle + tabs + sync-bug fix)

### 0a. Fix the D1-transaction ingestion bug

Locate the code path raising `BEGIN TRANSACTION`/`SAVEPOINT` (a Drizzle `db.transaction(...)` or raw SQL transaction in `permits-sync.ts` / `contractor-sync.ts` persistence). D1 does not support SQL transactions; replace with the same best-effort sequential pattern already used in `images.ts` (ordered statements + manual compensation), or D1 batch (`db.batch([...])`) where atomicity is needed. Also investigate the building storage-timeout (likely an oversized write / too many statements per call → chunk it). Verify by a manual `POST /api/admin/permits/sync` returning all sub-runs `success`.

### 0b. `SUSPECTED_EXPIRED` lifecycle + manual close

**Schema (additive to `permits_records`):**
- `owner_closed` integer (bool) default 0
- `owner_close_note` text (nullable)
- `owner_closed_at` integer timestamp (nullable)
- `owner_closed_by` text (nullable; actor email/id)

**Derived state (computed at read, not stored):** a property permit is
- `CLOSED` if `is_closed = 1` OR `owner_closed = 1`
- `SUSPECTED_EXPIRED` if not closed AND its newest of (filed/issued) date is > 365 days old AND its status is non-terminal
- `ACTIVE` otherwise

**Anchor behavior (decision — confirm during review):** `SUSPECTED_EXPIRED` and `owner_closed` permits are **excluded from active anchors**, so contractor monitoring stops for permits that have gone dead — serving the core "only track active permits" goal — while the permit stays visible and flagged for the homeowner to formally close. (Alternative if you prefer: keep anchoring until you manually close. Flagging this as the one behavioral choice in this phase.)

**API:** add `POST /api/admin/permits/property/:permitIdentifier/close` accepting `{ note: string }` (note **required**, non-empty); sets `owner_closed=1`, `owner_close_note`, `owner_closed_at`, `owner_closed_by`. Returns updated detail. The existing dashboard/detail responses gain the derived `lifecycleStatus` field.

**UI:** in the permit detail + the Scans list, show a `SUSPECTED_EXPIRED` badge; on the detail page show a "Mark closed" button that opens a modal requiring a note before submit.

### 0c. Permits page tabs (Scans / Runs)

Wrap the existing `HousePermitsSection` content in the existing shadcn `Tabs` (`src/frontend/components/ui/tabs.tsx`):
- **Scans tab:** the "126 Colby Permits" list (Card 2), with the new `lifecycleStatus` badges (Active / Suspected-Expired / Closed) and the close action.
- **Runs tab:** the "Latest Sync Runs" table (Card 3), surfacing failed sub-runs prominently (e.g., the building errors) with their `error_text`.

No new data fetch — `GET /api/admin/permits` already returns `propertyPermits[]` and `latestRuns[]`.

---

## Architecture — generic DataSF source registry

All new datasets share one ingestion shape, so we add a registry instead of bespoke code per dataset.

**`DATASF_SOURCES` config** (one entry per dataset):
```
{
  key: 'notices_of_violation',
  datasetId: 'nbtm-fbw5',
  label: 'Notices of Violation (DBI)',
  category: 'monitoring' | 'contractor' | 'benchmark',
  // SoQL $query template keyed by the property identifiers it supports:
  buildQuery: ({block, lot, parcel, streetNumber, streetName, zip}) => string,
  primaryKeyFields: string[],   // e.g. ['complaint_number','item_sequence_number']
  cadence: 'daily',
}
```

**Storage:** one additive table `permits_external_records` (raw snapshot per source) keyed `(source_key, natural_key)`:
- `id` text PK, `source_key` text, `natural_key` text, `block`/`lot`/`address` text, `data_as_of` text, `raw_data` JSON text, `run_id` FK → `permits_sync_runs`, `datetime_created`, `datetime_updated`, unique `(source_key, natural_key)`.

This keeps schema churn to **one** table for all monitoring/contractor sources; per-source parsing/UI is layered in code (typed accessors over `raw_data`). Benchmark snapshots use their own table (below).

**Run history:** each source fetch writes a `permits_sync_runs` row (extend `run_type` with the new source categories), so the Runs tab shows every dataset's last pull + errors uniformly. The orchestrator iterates `DATASF_SOURCES` for the configured cadence.

**Idempotency / change detection:** reuse the `changeHash` pattern from `permits_records` so we only flag genuinely new/changed rows for the user.

---

## Phase 1 — Monitoring datasets

Add these `DATASF_SOURCES` (all keyed to 126 Colby), store in `permits_external_records`, surface in new UI tabs/cards, and alert on new rows since last view (reuse the `permits_identifier_views` "needs review" idea):

| key | dataset | query key | signal |
|---|---|---|---|
| `notices_of_violation` | `nbtm-fbw5` | block 5934 / lot 005 | inspector violations/comments during reno; sort by complaint_number + item_sequence_number; link to Complaints `gm2e-bten` |
| `fire_inspections` | `wb4c-6hwj` | address contains "126"+"colby" | fire inspections (complaint or routine) |
| `fire_permits` | `893e-xam6` | zip 94134 + address contains "126" | sprinkler-trigger watch |
| `planning_review` | `tyz3-vt28` | parcel `5934005` | window/door/fire-alarm/sprinkler review triggers |

**UI:** a "Monitoring" area on `/admin/permits` (tab or cards) listing recent rows per source with a "new since last view" highlight. **Alerts:** a count of unreviewed monitoring rows in the summary strip.

---

## Phase 2 — Contractor enrichment

Add source `building_permit_contacts` (`cw8k-gwb7`, keyed street_number 126 / street_name Colby). Use it to enrich existing `permits_contacts` rows with firm name/address, license numbers, agent id, and the full contact set per permit — joined on permit number / license. Surface the enriched identity on the existing contractor cards (`ContractorActivityMap`). No new contractor *discovery*; this deepens identity for already-monitored contractors.

---

## Phase 3 — Benchmark metrics (snapshot + anomaly + cross-contractor)

The most analytical phase; will get its own detailed plan. Shape:

**Datasets (snapshot citywide + our rows):** Building Permit **Review** Metrics `5bat-azvb`, **Issuance** Metrics `gzxm-jz5j`, **Completeness** `abh5-gwaq`, Planning metrics `d4jk-jw33` (ref: sf.gov/permit-performance-metrics).

**Snapshot model:** each run computes and stores a **citywide performance snapshot** (median/target review + issuance times, % meeting SLA, per station/permit-type) in a new `permits_benchmark_snapshots` table (time series). Recreates the metrics sf.gov publishes.

**Signals:**
1. **DBI weekly health:** on login, the dashboard shows current-week DBI throughput vs prior snapshots; flag anomalies (spike/regression/improvement) relative to the trailing baseline.
2. **Our-permit lag:** for each active 126-Colby permit (its `bpa`/addenda), compare its review/issuance pace to the citywide median/SLA; flag if it's outside the average.
3. **Cross-contractor accountability:** join permit numbers to these metrics for the **other** active projects of each 126-Colby active contractor. If our permit lags but the contractor's other projects are tracking within the DBI bell curve, surface that contrast ("DBI is fine for their other jobs — why is ours slow?").

**UI:** a "Benchmark" tab with the DBI weekly health, our-permit standing, and the cross-contractor comparison.

---

## Frontend docs

Update the in-app docs (the docs surfaced via `src/frontend/lib/docs.ts` / `docs/` pages) to describe: what we monitor (violations, fire inspections, fire permits, planning review), snapshot benchmarking (DBI weekly health + our-permit standing + cross-contractor comparison), and contractor enrichment — so the homeowner understands each signal.

## Testing / verification

- No unit-test runner in repo (per prior work). Verify via `pnpm run build`, `oxlint`, and **manual prod checks**: trigger `POST /api/admin/permits/sync`, confirm all sub-runs `success` (0a), confirm `202307172359` reads `SUSPECTED_EXPIRED` and closes with a note (0b), confirm tabs render (0c), and per phase confirm `permits_external_records` / snapshot rows populate via D1 queries.
- A small smoke script (like `test:throttle`) can hit `/api/admin/permits` and assert the new fields/sources appear.

## Decisions (locked unless flagged)

- Keep all permits; `SUSPECTED_EXPIRED` is derived (> 365 days, non-terminal, not owner-closed).
- Manual close requires a non-empty note; sets `owner_closed`.
- **Open question for review:** do `SUSPECTED_EXPIRED` permits stop anchoring contractors immediately (recommended), or keep anchoring until you manually close them?
- Build order: Phase 0 → 1 → 2 → 3. Each phase ships independently (own implementation plan).
- One shared `permits_external_records` table for monitoring/contractor sources; separate `permits_benchmark_snapshots` for Phase 3. All migrations applied manually (broken journal).
