# PROMPT — 0039 Gmail Ingest Gate

Build a cheap, domain-matched gate that pulls relevant vendor emails from the
synced Gmail inbox into the existing extraction pipeline, spending **zero**
AI/OCR budget until a message is proven relevant.

## Context

- Vendor mail hits `justin@126colby.com` (personal Gmail), not
  `remodel@hacolby.app`, so `src/backend/services/email/pipeline.ts` never sees
  it. Gmail is synced to D1 (`gmail_threads`, `gmail_messages`,
  `gmail_message_participants`) but display-only, with no attachment handling.
- Reuse, do not rebuild: `processEmail()` + `parsePdfToMarkdown` + `AI.toMarkdown`
  already do OCR/classify/route/persist; `splitCandidateEmails`, `domainOf`,
  `brandDomain`, `registerShowroomContactFromEmail` already exist.

## Do

1. **Schema** (`db:generate` → `migrate:remote`, verify on remote):
   - New `gmail_message_attachments` (see IMPLEMENTATION_PLAN ERD): FK
     `gmail_message_id`→`gmail_messages.id` cascade; `rag_uuid`, `file_name`,
     `file_ext`, `file_mimetype`, `file_size_bytes`, `md5`, `r2_key`, `ocr_text`,
     `ai_summary`(json), `ai_confidence`(json), `ai_metadata`(json),
     `remodel_doc_type` enum `INVOICE|RECEIPT|QUOTE|CONTRACT|CHANGE_ORDER|SPEC_SHEET|PRICE_LIST|OTHER`.
   - Extend `gmail_message_participants`: `recipient_type` enum
     `FROM|TO|CC|BCC`, `first_name`, `last_name`, and FKs `showroom_store_id`,
     `showroom_store_contact_id`, `contractor_business_id`(→`companies.id`),
     `contractor_business_contact_id`(→`company_contacts.id`). Keep `role`.
   - `gmail_messages`: add `body_plain_txt`, `body_html` (keep `body`).
2. **Gate service** (`src/backend/services/gmail/ingest-gate.ts`):
   - Scan `gmail_messages` not yet processed; record metadata + body md5 +
     per-attachment md5.
   - Dedup on `message_id`; already-present → stop.
   - Unique domains from FROM/TO/CC/BCC minus the exclusion set
     (`@126colby.com`, `@hacolby.app`, `jmbish04@gmail.com`,
     `jasonowyong87@gmail.com`).
   - Match remaining domains against showroom WEBSITE link domains
     (`showroom_store_links` `type='WEBSITE'`) and `companies.website`. Any hit →
     resolve/create the contact, set the resolution FKs, hand to the pipeline.
     No hit → mark `skipped_no_match`, no AI/OCR.
3. **Bridge**: matched message + attachments → existing pipeline; fill
   attachment rows (r2 key, ocr_text, ai_summary/confidence/metadata, doc_type).
4. **Cron + backfill**: scheduled scan; a backfill mode with no time bound pulls
   existing threads (Pietra Fina `19f4ded890f5e58d`).
5. **QC** `scripts/qc/pr_<n>.mjs`: non-match skipped at $0; match reaches
   pipeline; dedup holds; Pietra Fina → showroom #222, doc `QUOTE`.

## Constraints

- D1: `db.batch` never `db.transaction`; chunk inserts/`inArray` (≤20 / 100-param).
- FKs only — never a denormalized `*_name` column. Join for display names.
- AI calls: structured output + JSON schema; never degrade a failed parse to `{}`.
- Never insert a placeholder into a NOT NULL FK; reject/skip instead.
- Changelog + preview-changelog + `plan_tasks` kept current per AGENTS.md.
