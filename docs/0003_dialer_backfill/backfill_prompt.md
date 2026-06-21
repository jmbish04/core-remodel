# Task: backfill the dialer's `prospects` table (90 rows) + enrich from 3pee-9qhc

## Goal
Replace the 12-row prospect set in the Recovery Remodel Dialer with the full **90 independent
design pros** (≥5 matching permits) from the DBI analysis, then enrich every row with verifiable
**mailing address + license number** pulled from the `3pee-9qhc` contacts dataset you already
ingest. Do NOT fabricate phone/email — only 2 of 90 have verified web contact; the rest stay
`needs_research`.

## Conventions (do not deviate)
- `cloudflare-jedi`: Hono + zod-openapi, D1 + Drizzle, modular schemas, `pnpm run deploy` only,
  oxlint/oxfmt, `Bindings: Env`, `pnpm cf-typegen` after binding changes, D1 mirrored logging.
- Migrations via `pnpm run db:generate` — never hand-write migration SQL.
- This seed is **catalog-sourced data**, NOT the classifier. Do not touch
  `dim_design_professionals`; that stays computed by the weekly pipeline.

## STEP 1 — extend the Drizzle `prospects` schema
Add these columns (then `pnpm cf-typegen && pnpm run db:generate`):
```
licenseNo        text   ("license_no")        -- CA license from 3pee-9qhc.license1
distinctLicenses integer("distinct_licenses") -- collision signal
distinctFirms    integer("distinct_firms")    -- collision signal
distinctZips     integer("distinct_zips")     -- collision signal
agentZip         text   ("agent_zip")
agentAddress     text   ("agent_address")      -- filled by STEP 3 enrichment
agentCity        text   ("agent_city")
agentState       text   ("agent_state")
```
Keep existing columns: phone, phone_source, email, email_source, website, contact_status,
license_note, collision_risk, is_unbundled_candidate, call_script, etc.

## STEP 2 — load the data-only seed
Apply `prospects_seed_90.sql` (provided). It `DELETE`s and re-inserts the 90 catalog-sourced
rows. It does NOT touch `prospect_state` / `call_attempts`, so my ratings/notes survive a reseed.
Confirm 90 rows; confirm Aaron Lim (verified email+site) and Katherine Fontaine (verified site,
UNVERIFIED phone) carry `contact_status='partial'`; all others `needs_research`.

## STEP 3 — enrichment join from 3pee-9qhc (real, sourced — no scraping)
The contacts dataset already carries address + license for these people. Backfill the agent_*
columns by joining on normalized name (and license# when present):
- Source: `3pee-9qhc` fields `first_name, last_name, role, license1, agent_address, city, state,
  agent_zipcode`, filtered to design roles `('designer','architect','pmt consultant/expediter')`.
- ⚠️ Dedupe to the latest record per person using `max(data_loaded_at)` (the dataset is
  incremental since 2024-12-10) before selecting an address.
- Match key: `lower(trim(first_name))||'|'||lower(trim(last_name))` == prospects person key
  (derive it from first_name/last_name). Prefer the record whose `license1` == the prospect's
  `license_no` when both exist, to reduce wrong-person joins.
- Fill `agent_address, agent_city, agent_state` (and `agent_zip`/`license_no` if still null).
- If a name maps to multiple conflicting addresses, leave agent_address NULL and ensure
  `collision_risk = 1` — do not pick one arbitrarily.
- Log enriched/!enriched counts to the D1 mirrored log.

## STEP 4 — surface it in the UI (small additions)
- On the prospect detail card, show **License #** and **Mailing address** when present, with a
  "verify on CA Architects Board" link for the license.
- Keep the existing honesty flags: `collision_risk` → "⚠ common name, verify identity" badge;
  `contact_status='needs_research'` → "look up on DBI" link.
- Sort/filter already exist; add a filter for `is_unbundled_candidate` and one for
  `has license# on record`.

## Acceptance criteria
- `prospects` has exactly 90 rows after seeding; `prospect_state` untouched.
- ~52 rows have a `license_no` directly from the seed; STEP 3 raises address coverage further.
- 18 rows carry `collision_risk=1` (e.g. "Tony Lee", 120 permits) and render the warning badge.
- 24 rows are `is_unbundled_candidate=1`.
- Aaron Lim shows verified email+website; Katherine Fontaine shows verified website + a phone
  explicitly labeled UNVERIFIED. No other row has a phone or email.
- Re-running STEP 2 then STEP 3 is idempotent and does not duplicate rows or clobber my notes.

## Out of scope
- No web-scraped phone numbers. No changes to the weekly classifier or geo view.
