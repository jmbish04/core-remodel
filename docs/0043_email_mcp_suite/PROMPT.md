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

**P2 — search tools** (`READ_ONLY`)
- `search_email({ query?, showroomId?, sender?, keyword?, include?: "meta"|"text"|"files", topK?, live?: bool })`:
  indexed = `searchGmailVectors` (semantic) ∪ D1 (LIKE subject/body, `fromRecipient`,
  or `gmail_message_participants.showroomStoreId`). Then `live !== false` → Gmail
  `searchMessages(q)` (cap 25), diff vs `gmail_messages.messageId`, `ingestAndBridgeMessage`
  each unindexed responsive id, re-read D1, merge+dedup. `include:"text"` returns
  `gmail_message_attachments.ocrText`; `"files"` returns R2-served url + `gmail_message_images.deliveryUrl`.
- `list_showroom_emails({ showroomId, folder?, limit? })` — participants FK.
- `get_email_attachments({ messageId, include: "text"|"files" })` — targeted; upload
  to R2 if `r2Key` NULL, then return links.

**P3 — raw Gmail** (`WRITE`/`WRITE_IDEMPOTENT` for mutating):
`gmail_search`, `gmail_read_message`, `gmail_create_label`, `gmail_add_to_label`,
`gmail_list_label`, `gmail_create_draft`, `gmail_send`, `gmail_draft_reply`,
`gmail_send_reply`, `gmail_extract_attachment` (→R2 + link), `gmail_ingest_message`
(per-message → D1). Reuse `ensureLabel`/`modifyMessageLabels`/`buildComposeRaw`/
`buildReplyAllRaw`/`sendMessage`/`getAttachmentBytes`. Drafts: Gmail `drafts.create`.

**P4 — worker email**: `worker_email_search` (D1 `worker_emails` LIKE/company),
`worker_email_send` / `worker_email_reply` (Gmail-API send from `SENDER_EMAIL`).

**P5 — templates**: `email_templates` definition table in `schema/config/` (key,
display_name, category, subject_template, body_markdown+body_html, is_active);
`/api/config/email-templates` CRUD (mirror store-types in `routes/config.ts`, Zod v4
hand-written, `slugifyKey`); `/admin/config/email-templates.astro` (ConfigShell);
`renderEmailTemplate(templateKey, ctx)` interpolating `{{placeholders}}` from
`project_system_variables` / `properties` / recipient rows / supporting_documents +
inspiration images (FK/JOIN, never denormalized); MCP `list_email_templates` +
`render_email_template`. Seed: cold_quote_request, appointment_scheduling,
project_info_general. Rich text = markdown+html both (`renderNoteHtml`/`sanitizeNoteHtml`).

**Constraints**: getGmailAccessToken once per handler; send = WRITE not READ_ONLY;
per-message ingest idempotent; cap realtime backfill; keep tool modules lean
(startup-CPU near the 10021 limit); ≥1 example per tool; db.batch not transaction;
chunk >100 params; structured-output for any AI; QC + changelog + preview per repo rules.
