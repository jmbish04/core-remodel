# Contractor Activity Map — Spec

**Page:** `/admin/permits/contacts` (Contractor Permit Intelligence)
**Status:** Approved design, in development
**Owner:** Justin
**Date:** 2026-06-16

## Goal

For every contractor currently tied to an **open** 126 Colby permit, surface **how busy they are elsewhere** — so we can reason about why they may be slow to deliver or respond. We pull each contractor's other permits (building + electrical + plumbing), plot them on a map, list them in a table, and generate an AI read on whether they're tied up with work filed **before** ours vs **after** ours.

"Ours" = the 126 Colby permit the contractor is attached to.

## Data sources (SF DBI via SODA `data.sfgov.org`)

| Purpose | Dataset | ID |
|---|---|---|
| Target permits (126 Colby) | Building Permits | `i98e-djp9` |
| | Electrical Permits | `ftty-kx6y` |
| | Plumbing Permits | `a6aw-rudh` |
| Permit → contacts | Building Permit Contacts | `3pee-9qhc` |
| | Electrical Permit Contacts | `fdm7-jqqf` |
| | Plumbing Permit Contacts | `k6kv-9kix` |
| Activity signals | Building Inspections | `vckc-dh2h` |
| | Plumbing Inspections | `fuas-yurr` |
| | Building Addenda | `87xy-gk8d` |

### Field notes
- **Building permits** store address as `street_number` + `street_name` (+ `street_suffix`) — no single text address column; only a geo `location` point. So `street_number`/`street_name` + `block`/`lot` are the real matchers.
- **Identity fields** per contact dataset:
  - Building `3pee-9qhc`: `first_name`, `last_name`, `firm_name`, `firm_address`, `role`, `license1`/`license2`, `sf_business_license_number`, `pts_agent_id`.
  - Electrical `fdm7-jqqf`: `company_name`, `street_number`+`street`+`street_suffix` (firm addr), `license_number`, `sf_business_license_number` — **no person name**.
  - Plumbing `k6kv-9kix`: `firm_name`, `address` (firm addr), `license_number`, `sf_business_license_number` — **no person name**.
- **Inspections** join to a permit via `reference_number = <permit#> AND reference_number_type = 'permit'`; carry `scheduled_date`/`appointment_date`/`result` + their own geo `point`.
- **Addenda** `87xy-gk8d` join via `application_number` (not permit_number); carry `assign_date`/`start_date`/`finish_date`/`approved_date`/`addenda_status`.

## Definitions

- **Open / active permit** — status category is non-terminal. Terminal = `completed` or `cancelled` (via existing `statusToCategory`). `issued`, `approved`, `filed`, in-progress, pending → **open**. An `issued` permit with no recent activity is "open-but-quiet" — the recent-activity field is how you tell it's effectively dormant.
- **Anchor permit** — an **open** 126 Colby permit. Closed 126 Colby permits are dropped from contact extraction.
- **Monitored contractor** — tied to ≥1 anchor permit. (Replaces the hardcoded `CONTACT_EXCLUSIONS` list entirely — exclusion is now automatic via permit status.)
- **`anchorReferenceFiledDate`** — for a contractor, the `filed_date` of the (earliest) anchor permit they're on. The before/after baseline.
- **relationToAnchor** — for each of the contractor's other permits: `before` (its `filed_date` < baseline), `after` (> baseline), or `concurrent` (==).
- **Shown vs hidden** — a contractor's other permit is **shown** if it is open, OR it closed **after** the baseline (recently-closed still matters). Closed-before-we-filed → hidden.
- **Recent activity** — a descriptive field, not a filter. Newest of: latest inspection (scheduled/appointment), latest addenda step, `status_date`/`last_permit_activity_date`, issued/completed. Yields `recentActivityType`, `recentActivityDate`, and a human `recentActivityDetail`.

## Sync pipeline (`runPermitSync` rewrite)

### Phase 1 — Target permits (126 Colby)
Query building/electrical/plumbing permit datasets by `street_number`+`street_name` and `block`+`lot`. Persist to `permits_records` with `status`, `filedDate`, `isClosed`. Identify **anchors** = open ones.

### Phase 2 — Anchor contacts
For each anchor permit, fetch its contacts from the matching trade's contact dataset by `permit_number`. Capture per contact: name, firm_name, firm_address, license, sf_business_license, role. A contractor is **monitored iff** on ≥1 anchor permit. Compute `anchorReferenceFiledDate`.

### Phase 3 — Gather each contractor's other permits (matching cascade)
For each monitored contractor, query the 3 contact datasets with one OR-combined `$where` per (contractor × dataset), then classify each returned row's confidence in JS. Strategies:

| # | Strategy | SoQL shape | Confidence |
|---|---|---|---|
| 1 | CSLB license | `license_number = <anchor license>` | high |
| 2 | SF business license | `sf_business_license_number = <anchor>` | high |
| 3 | first + last name (building only) | `lower(first_name)=… AND lower(last_name)=…` | medium |
| 4 | name tokens → firm name | split contractor name by space; `lower(firm_name) LIKE %tokᵢ%` for **all** tokens | medium-low |
| 5 | address tokens → firm address | split firm_address; **first 2 tokens**; `lower(firm_address) LIKE %tok₁% AND LIKE %tok₂%` | medium-low |

- Firm-name field = `firm_name` (building/plumbing) / `company_name` (electrical).
- Firm-address field = `firm_address` (building) / `address` (plumbing) / `street_number || ' ' || street` (electrical).
- Tokens: lowercase, trim, drop empties; for safety drop pure-noise tokens (`inc`, `co`, `llc`, `&`) from name matching but keep ≥1 token; address uses first 2 non-empty tokens.
- Examples: "Don Gee" → `firm_name LIKE '%don%' AND LIKE '%gee%'`; "1340 Donner Av" → `firm_address LIKE '%1340%' AND LIKE '%donner%'`.
- **Precision guards (validated against live data):** `name_tokens` requires **≥2** meaningful tokens (a lone common surname over-matches). **`address_tokens` must co-occur with a name-token overlap** — business addresses are frequently shared (e.g. "1555 Yosemite Av" spans dozens of unrelated firms), so address alone is never sufficient. These keep fuzzy recall while preventing the matcher from attributing strangers' permits to a contractor.

Collect candidate permit_numbers per trade, **dedupe by (trade, permit#)**, keep the **highest-confidence** matchStrategy per permit. Fetch permit details from the permit datasets (batched `permit_number IN (...)`) for status/dates/`location`/block/lot.

**Filter:** keep if open OR (closed AND `completed_date` > baseline). Tag `relationToAnchor`.

### Phase 4 — Recent-activity detection
Per gathered permit, compute the newest activity:
- Building: max of `status_date`, `last_permit_activity_date`, latest addenda date (`87xy-gk8d` by `application_number`), latest inspection (`vckc-dh2h` by permit#).
- Plumbing: latest inspection (`fuas-yurr` by permit#), issued/completed.
- Electrical: issued/completed + status (no electrical inspections dataset provided).

Set `recentActivityType` / `recentActivityDate` / `recentActivityDetail` (e.g. `"Inspection: ROOF — PASSED, 2026-05-12"`).

### Phase 5 — Persist
Write gathered permits to `permits_contact_activity` (extended columns) with lat/long for markers.

### Phase 6 — AI busyness analysis (per contractor)
Extend `generateContactInsight`. Split the contractor's shown permits into **before** vs **after** baseline; feed counts, open counts, recent-activity recency, and match confidence to Workers AI (`@cf/meta/llama-3.1-8b-instruct`). Output:
- `beforeBusyness` ∈ {idle, light, busy}, `afterBusyness` ∈ {idle, light, busy}
- `summary` narrative + `highlights[]`
- weigh high-confidence matches more; note loosely-matched permits so a fuzzy hit doesn't overstate busyness.

**Prompt built as an ES6 template literal** (replaces the current `[...].join("\n")`, which mangles newlines through AI Gateway).

## Data model (Drizzle / D1 — extend existing tables)

**`permits_records`** — add `filedDate: text("filed_date")`.

**`permits_contacts`** — add `licenseNumber`, `sfBusinessLicenseNumber`, `firmName`, `firmAddress`, `role`, `anchorPermitIdentifiers` (JSON), `anchorReferenceFiledDate`. `isMonitored` now means "on ≥1 open anchor."

**`permits_contact_activity`** — add `trade`, `filedDate`, `block`, `lot`, `isOpen` (bool), `isRecentlyClosed` (bool), `relationToAnchor`, `recentActivityType`, `recentActivityDate`, `recentActivityDetail`, `matchStrategy`, `matchConfidence`, `anchorPermitIdentifier`.

**`permits_contact_insights`** — add `beforeBusyness`, `afterBusyness`.

Migrations via `pnpm run db:generate` (never hand-edit).

## API

Extend `GET /api/admin/permits/contacts` (`getPermitContactsInsights`). Per monitored contractor return:
- identity (name, firm, license, role)
- `anchorPermits[]` + `anchorReferenceFiledDate`
- `permits[]`: `{ trade, permitNumber, permitType, status, filedDate, closedDate, latitude, longitude, address, block, lot, relationToAnchor, isOpen, isRecentlyClosed, recentActivity{type,date,detail}, matchStrategy, matchConfidence }`
- `summary`: counts of before / after / open / recentlyClosed
- `insight`: `{ beforeBusyness, afterBusyness, summary, highlights[] }`

## UI (`PermitsAdminApp` section="contacts")

Order: **filters (top of page)** → per-contractor **AI busyness cards** → **map** → **hover-linked table**.

- **Filters (top):** contractor multiselect, trade, relation (before/after), status (open/recently-closed), match-confidence. Drive both map + table.
- **AI cards:** one per contractor — before-busyness vs after-busyness badges (idle/light/busy), narrative, anchor reference date, before/after/open counts.
- **Map** ([ui/map.tsx](src/components/ui/map.tsx), CARTO dark, no API key): one `MapMarker` per shown permit; 126 Colby as a distinct home marker. Marker color = relation (filed-before vs filed-after); shape/opacity can encode open vs recently-closed. `MarkerPopup` emphasizes **filed date** + trade + status + relation badge + recent-activity line + a "loosely matched" note for low confidence.
- **Table:** sortable + filterable (cloudflare-jedi UX rule) — contractor, trade, permit#, address, filed date, status, relation, recent activity, last-activity date, confidence.
- **Bidirectional hover:** table row hover ↔ marker highlight via shared `highlightedId` state.

## Assumptions / boundaries

1. Person-name fallback (#3) and name-token matching (#4) only reach a contractor's **building** permits via person name, because electrical/plumbing contact datasets have no person-name field (they still match via license/firm/address).
2. No electrical inspections dataset provided → electrical activity uses issued/completed + status only.
3. Contact identity keyed by `contactName` (display) for v1; a contractor appearing under two name variants could be two rows (permits dedupe by permit#, so no double markers, but cards could split). Acceptable for v1.
4. Fuzzy strategies (#4/#5) can over-match; mitigated by confidence tagging + AI weighting + a UI "loosely matched" badge.

## Out of scope (v1)

- Electrical inspections, complaints-as-activity beyond what's already pulled.
- Re-keying contacts by a canonical contractor ID.
- Historical timeline view per permit (only the single most-recent activity is surfaced).
