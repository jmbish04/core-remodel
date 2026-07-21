# Gmail Label Ingest + Attachments — Design

**Date:** 2026-07-18
**Status:** Approved
**Subsystem:** 2 of 4 (sales tax → **Gmail label ingest** → quotes → MCP/comparison)

## Problem

Two gaps make the current Gmail integration unable to feed quote intake.

**Attachments are never fetched.** `src/backend/services/gmail/client.ts` types
`GmailMessagePart` and `GmailMessagePayload` but only ever walks body parts —
there is no `attachmentId` fetch, no R2 write, and no attachments table. Quotes
arrive as attached PDFs, so today they are invisible.

This is an asymmetry with the inbound Worker Email path
(`remodel@hacolby.app`), which already writes attachments to R2 and extracts
their text (`pipeline.ts:351-381`, `:216-287`). Only the Gmail side is missing.

**Search is best-effort.** Ingestion is driven by company-domain matching. A
quote from a showroom with no company record, or from a personal Gmail address,
or forwarded by Jason from his own account, simply never matches. There is no
manual override — nothing a human can do to say "ingest this one".

The fallback label solves the second problem: apply a label in Gmail, and the
worker picks the thread up on its next pass regardless of what search would have
matched.

## Decisions taken

**Extend the existing tables; do not build parallel ones.** `gmail_threads`,
`gmail_messages`, and `gmail_message_participants` already exist and are in use.
`gmail_message_participants` in particular is more capable than a plain contacts
table: it splits `domain` off `email` and indexes both, because company
resolution needs domain-matching for private domains and exact-email matching for
gmail.com/yahoo.com and friends. Replacing it would re-break contractor
resolution.

**`rag_uuid` stays unique per row.** A single thread-wide uuid was considered and
rejected on two counts: `gmail_messages.rag_uuid` is `notNull unique` today, and
ingestion writes vector ids as `gmail:${ragUuid}:${i}` — a shared uuid means
message 2's chunk 0 overwrites message 1's chunk 0, losing data silently.

Thread-scoped retrieval does not need a shared uuid: ingestion already writes
`metadata: { rag_uuid, message_id, thread_id }`, so filtering Vectorize on
`thread_id` gets thread scope while `rag_uuid` still resolves the exact row. A
shared uuid would also destroy the ability to tell *which* message or attachment
matched — exactly what quote intake needs.

**Showrooms and contacts are staged, never auto-created.** See "Forwarded mail"
below.

## Schema

### New: `gmail_labels`

| column | type | notes |
|---|---|---|
| `id` | integer PK autoincrement | |
| `gmail_label_id` | text notNull | Gmail-supplied id; unique index |
| `gmail_label_name` | text notNull | full path, e.g. `Remodel/Quotes` |
| `gmail_label_color` | text | |
| `description` | text | worker-side enrichment, not from Gmail |
| `is_active` | integer boolean notNull default true | false = discovered but ignored |
| `is_fallback_root` | integer boolean notNull default false | the `GMAIL_FALLBACK_LABEL_NAME` row |
| `created_at`, `updated_at` | integer timestamp notNull | |

### New: `gmail_message_attachments`

| column | type | notes |
|---|---|---|
| `id` | integer PK autoincrement | |
| `rag_uuid` | text notNull | its own uuid, unique index |
| `message_id` | integer FK → `gmail_messages.id` | `onDelete: cascade` |
| `gmail_attachment_id` | text notNull | Gmail API `attachmentId` |
| `file_name` | text notNull | |
| `file_mimetype` | text | |
| `file_size` | integer | bytes |
| `extracted_text` | text | |
| `extraction_status` | text enum | `pending` / `complete` / `failed` / `unsupported` |
| `ai_summary` | text | |
| `r2_key` | text notNull | |
| `type` | text enum | `QUOTE` / `INVOICE` / `RECEIPT` / `PERMIT` / `DESIGN` / `CONTRACT` / `PROPOSAL` / `CHANGE_ORDER` / `PLANS` / `OTHER` |
| `type_confidence` | integer | 0–100 |
| `created_at`, `updated_at` | integer timestamp notNull | |

Two fields from the original sketch are deliberately absent: `file_extension`
(derivable from `file_name`) and `r2_url` (derivable from `r2_key`). Both are
values that can drift out of sync with the field they were copied from.

### Additive columns

- `gmail_threads.rag_uuid` — text, nullable. Its own uuid for a thread-level
  summary embedding, distinct from any message uuid.
- `gmail_message_participants.name` — text, nullable. Display name from the
  header, which the table does not currently keep.
- `gmail_message_participants.role` — widen `["from","to"]` to
  `["from","to","cc"]`.

**Migration safety.** Drizzle's `text(col, { enum: [...] })` is a TypeScript-level
type only — it emits no SQL `CHECK` constraint — so widening `role` is a pure
type edit with no migration and no table rebuild. The two new columns are
nullable `ALTER TABLE ADD COLUMN`. Nothing here triggers a drizzle column-drop
rebuild, which on D1 fires `ON DELETE CASCADE` (with `PRAGMA foreign_keys=OFF`
being a no-op under wrangler) and would silently wipe child rows.

Bcc is not modelled: it is not present on received mail.

## Label discovery

`GMAIL_FALLBACK_LABEL_NAME` is a var in `wrangler.jsonc` — the root anchor. The
adminable surface is the `gmail_labels` table, not the var.

On each ingest run:

1. `labels.list` for the impersonated user.
2. Find the root by exact name. If absent, create it (`gmail.labels`, now
   delegated) and mark `is_fallback_root`.
3. Select children. **Gmail models nesting purely by name** — a child of
   `Remodel` is a label literally named `Remodel/Quotes`. Match is
   `name === root || name.startsWith(root + "/")`.

   The trailing slash is load-bearing: a bare `startsWith(root)` also matches
   `RemodelArchive`, silently ingesting an unrelated label's threads.
4. Upsert into `gmail_labels` on `gmail_label_id`, **preserving `description` and
   `is_active`** on rows that already exist — those are human-authored and must
   survive every sync.
5. Ingest threads carrying any label where `is_active`.

New child labels are therefore picked up with no configuration, which is the
behaviour the admin page's help text promises.

## Ingest pipeline

Extends the existing `15 */4 * * *` cron rather than adding a trigger — same job,
one more source.

1. Resolve active label ids (above).
2. `messages.list` filtered by those `labelIds`, plus the existing
   company-domain search. Union, deduped by `message_id`.
3. Per new message: upsert the thread (minting `rag_uuid` on insert), insert the
   message (own `rag_uuid`), write participant rows.
4. Per attachment: `messages.attachments.get` → R2 → extract → classify → embed.
5. Embed message body and each attachment separately.

### Attachments

R2 key follows the existing `<plural-domain>/<owning-id>/<name>` convention:
`gmail-attachments/${messageId}/${fileName}` in `ARTIFACTS_BUCKET`, mirroring
`emails/${emailId}/${filename}`.

Text extraction reuses the Worker Email logic (`pipeline.ts:216-287`) rather than
reimplementing it — PDF via liteparse WASM with `env.AI.toMarkdown` as fallback,
DOCX/XLSX straight to `toMarkdown`. This is the first shared consumer, so that
function moves to a shared module and both callers import it. Extraction failure
sets `extraction_status: "failed"` and is never fatal to the run.

### Embeddings

Vector ids, against `VECTOR_INDEX` with the existing chunked pattern:

- message: `gmail:${ragUuid}:${i}` — 42 + index
- attachment: `gmail-att:${ragUuid}:${i}` — 46 + index

**Vectorize caps ids at 64 bytes** and rejects longer with
`VECTOR_UPSERT_ERROR (40008)`; a prefix once pushed the showroom-scrape id to 71
bytes and broke every scrape. Both prefixes above leave >15 bytes of headroom.
A test asserts the byte length rather than trusting the arithmetic.

Metadata uses `rag_uuid` (snake_case) to match the existing Gmail writer at
`gmail/ingestion.ts:181`. Casing is inconsistent across the codebase — the sales
writer uses `ragUuid` — so read paths must match their writer, and this one
follows Gmail's.

## Forwarded mail

Jason forwards a vendor invoice from his own account. The `From` header is
Jason; the real vendor is inside the body.

Auto-creating a showroom from `From` would produce a showroom named after Jason
with him as its point of contact — and would do it silently, on a cron, at
whatever rate mail arrives.

The Worker Email path already solved this: `worker_emails` carries `is_forwarded`,
`original_from_address`, `original_from_name`, `original_from_date`. The Gmail
path gets the same four columns on `gmail_messages` and the same header-parsing
step, applied **before** any identity inference.

Even with correct attribution, showroom and contact creation is **staged, not
committed**. The repo already has the pattern —
`showroom_store_contacts.is_draft` / `draft_notes`, and
`worker_email_staged_companies`. The worker proposes; spec 4's MCP tool surfaces
the proposal; a human confirms; only then does a row enter `showroom_stores`.

The alternative — auto-create on ingest — was the original request. It is
rejected because cron-rate silent writes into the showroom directory cannot be
reviewed before they accumulate, near-duplicates ("PGKB" vs "P G K B") are far
cheaper to prevent than to merge afterward, and it contradicts the confirm-first
flow specified for quote intake. This is reversible: if staging proves to be
friction, promoting high-confidence matches to auto-commit is a small change,
whereas un-polluting the directory is not.

## Admin — `/admin/config/gmail`

`gmail.astro` + `GmailConfigApp.tsx`, matching the `address.astro` →
`PropertyAddressConfigApp` pattern.

- Label table from D1: name, color, description (editable), `is_active` (toggle),
  last-seen count
- "Create label" → creates in Gmail, then writes the D1 row
- Help text: child labels under the root are discovered automatically on the next
  run; no action needed
- Last ingest run: timestamp, messages and attachments ingested

## API — `/api/gmail` (additions)

| Method | Path | Purpose |
|---|---|---|
| GET | `/labels` | D1 rows, joined with last-seen counts |
| POST | `/labels` | create in Gmail + D1 |
| PATCH | `/labels/{id}` | edit `description` / `is_active` |
| POST | `/labels/sync` | manual re-discovery |
| GET | `/messages/{id}/attachments` | attachment rows for a message |

## Verification

`src/backend/services/gmail/labels.test.ts`:

1. Child matching — root matches, `Root/Child` matches, `RootOther` does **not**.
2. Sync preserves `description` and `is_active` on an existing row.
3. Vector id byte length stays under 64 for both prefixes.

## Out of scope

- Sending or replying (existing routes unchanged)
- Gmail filters or forwarding rules (`gmail.settings.basic` is delegated but
  unused here)
- Quote parsing — spec 3 consumes `extracted_text`; this spec only produces it
- Attachment dedup across messages

## Consumers

Spec 3 reads `gmail_message_attachments` where `type = "QUOTE"` and turns
`extracted_text` into quote rows and line items. Spec 4's MCP tools search these
tables by keyword, sender name, and sender address.
