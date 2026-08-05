# 0043 — Build prompt

Build the email MCP suite per IMPLEMENTATION_PLAN.md. Cloudflare Workers + Hono +
Drizzle/D1; MCP registry in `src/backend/mcp/`. Reuse the existing gmail client +
participant matching + Vectorize pattern; don't reinvent. Order = each phase a PR.

**P1 — scaffold**
- Add `"email"` to `ToolCategory` (`src/backend/mcp/types.ts`).
- Export `ingestAndBridgeMessage` from `services/gmail/ingest-gate.ts` (per-message
  ingest — dedup on `gmail_messages.messageId`; creates thread+message+participants+
  embed). Export `embedMessage` from `ingestion.ts` (or hoist to a shared module).
- Add `searchGmailVectors(env, db, query, topK)` — mirror the `/draft-assist`
  query+hydrate (`VECTOR_INDEX.query(vec,{topK,filter:{kind:"gmail"},returnMetadata})`
  → hydrate `gmail_messages` by `messageId`, chunked at 100 params).
- `tools/email/` folder + `index.ts` barrel (`emailTools: RemodelTool[]`), imported
  into `tools/index.ts` `ALL_TOOL_GROUPS`.

**P2 — search tools** — annotate by real side-effect, NOT by name:
- `search_email({ query?, showroomId?, sender?, keyword?, include?: "meta"|"text"|"files", topK?, live?: bool })`
  — annotation **`WRITE_IDEMPOTENT`**, NOT `READ_ONLY`. `live` defaults to
  **false** (pure read: indexed only). When `live === true` the tool performs
  writes — Gmail `searchMessages(q)` (cap 25), diff vs `gmail_messages.messageId`,
  then `ingestAndBridgeMessage` each unindexed responsive id (inserts thread/
  message/participant rows + vector embeddings) — so a READ_ONLY label would be a
  lie. The ingest is idempotent (dedup on the unique `gmail_messages.messageId`),
  which is why WRITE_IDEMPOTENT is the correct preset. indexed =
  `searchGmailVectors` (semantic) ∪ D1 (LIKE subject/body, `fromRecipient`, or
  `gmail_message_participants.showroomStoreId`). `include:"text"` returns
  `gmail_message_attachments.ocrText`; `"files"` returns R2-served url + `gmail_message_images.deliveryUrl`.
- `list_showroom_emails({ showroomId, folder?, limit? })` (`READ_ONLY`) — participants FK.
- `get_email_attachments({ messageId, include: "text"|"files" })` (`WRITE_IDEMPOTENT`
  — uploads to R2 if `r2Key` NULL, then returns links; a pure read would be `READ_ONLY`).

Every tool input is a **hand-written Zod v4 `inputShape`** (never drizzle-zod)
validated at the trust boundary, with ≥1 example and the correct annotation.

**P3 — raw Gmail** (`WRITE`/`WRITE_IDEMPOTENT` for mutating):
`gmail_search`, `gmail_read_message`, `gmail_create_label`, `gmail_add_to_label`,
`gmail_list_label`, `gmail_create_draft`, `gmail_send`, `gmail_draft_reply`,
`gmail_send_reply`, `gmail_extract_attachment` (→R2 + link), `gmail_ingest_message`
(per-message → D1). Reuse `ensureLabel`/`modifyMessageLabels`/`buildComposeRaw`/
`buildReplyAllRaw`/`sendMessage`/`getAttachmentBytes`. Drafts: Gmail `drafts.create`.

**P4 — worker email**: `worker_email_search` (D1 `worker_emails` LIKE/company),
`worker_email_send` / `worker_email_reply` (Gmail-API send from the `SENDER_EMAIL`
**secrets-store binding**, read at runtime via `env.SENDER_EMAIL.get()` — never a
plaintext var or inline literal).

**P5 — templates**: `email_templates` definition table in `schema/config/` (key,
display_name, category, subject_template, body_markdown+body_html, is_active);
`/api/config/email-templates` CRUD — follow the **existing config-route
convention** (mirror `store-types` in `routes/config.ts`: plain Hono `.get/.post`
with hand-written Zod v4 body validation + `slugifyKey`; the whole config surface
uses this, not zod-openapi — do NOT introduce a lone `createRoute` here). `body_html`
is **sanitized on write with `sanitizeNoteHtml`** and generated from `body_markdown`
via `renderNoteHtml`; the AI template-edit tool is a **`WRITE`** MCP tool gated by
the connector scope, and its edits land as a new revision the user can review (never
a silent overwrite). `/admin/config/email-templates.astro` (ConfigShell);
`renderEmailTemplate(templateKey, ctx)` interpolating `{{placeholders}}` from
`project_system_variables` / `properties` / recipient rows / supporting_documents +
inspiration images (FK/JOIN, never denormalized); MCP `list_email_templates` +
`render_email_template`. Seed: cold_quote_request, appointment_scheduling,
project_info_general. Rich text = markdown+html both (`renderNoteHtml`/`sanitizeNoteHtml`).

**Constraints**: getGmailAccessToken once per handler; send = WRITE not READ_ONLY;
per-message ingest idempotent (dedup on the **unique** `gmail_messages.messageId` —
verify/add the unique index before relying on it, so concurrent live-backfill can't
double-insert); cap realtime backfill; keep tool modules lean (startup-CPU near the
10021 limit); ≥1 example per tool; **use `db.batch([...])` — never `db.transaction()`
(it throws on D1)**; **chunk any unbounded list so no single statement exceeds 100
bound params (≈20 rows/statement)**; structured-output (JSON schema) for any AI;
QC + changelog + preview per repo rules.
