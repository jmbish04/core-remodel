# 0041 — Build prompt

Build the store-inbox feature per `IMPLEMENTATION_PLAN.md` + `DESIGN_SPEC.md`.
Cloudflare Workers + Astro SSR + Hono + Drizzle/D1, Base UI shadcn (NOT Radix).
Ground every change in the real files below; reuse, don't rebuild.

**Order (each its own PR):**

1. **Migration** — add `classification` (text enum), `isSpam` (int bool),
   `spamRationale` (text), `deletedAt` (timestamp) to `gmail_messages`; new
   `gmail_message_images` table (see ERD). `pnpm run db:generate` →
   `migrate:remote` → verify columns on remote BEFORE any reading code deploys.

2. **Ingestion gating** (`services/gmail/client.ts`, `ingestion.ts`,
   `ingest-gate.ts`):
   - `extractMessage` must also return HTML (stop discarding it); store into
     `gmail_messages.bodyHtml`.
   - `trimQuotedReply(body)` — strip Gmail-style quotes: lines from the first
     `On <…> wrote:` / `-----Original Message-----` / leading `>` block onward,
     kept behind the UI toggle (store full + trimmed, or a marker offset).
   - `classifyMessage(subjectLower, bodyLower, hasAttachments)` — deterministic,
     NO AI. Spam phrases → `isSpam=1`, `classification=promotional`,
     `spamRationale=<matched phrase>`. `receipt|invoice|quote` + (`$`|attachment)
     → `classification=receipt` and route into existing
     `processEmail`/`analyzeAndPersist`. Else `normal`.
   - Embedded images → `ImageProcessorService.uploadToCloudflareImages()` +
     `getDeliveryUrl()`; persist to `gmail_message_images`; rewrite `cid:` refs.
   - **Leave one runnable self-check** (`*.test.ts`, `assert`, `npx tsx`) for
     `classifyMessage` + `trimQuotedReply`.

3. **API** (`api/routes/gmail.ts`):
   - `DELETE /threads/:threadId` (soft-delete → `deletedAt`),
     `POST /threads/:threadId/mark-unread`.
   - Extend `GET /threads/:threadId` to return attachments + images.
   - `GET /showrooms/:storeId/threads-by-domain?folder=` with per-folder counts.
   - HTML reply: extend `buildReplyAllRaw` to `multipart/alternative`
     (text + text/html); reply route accepts `{ html, markdown }`.
   - Fix `draft-assist`: read `choices[0].message.content` fallback; stop
     swallowing the error into a bare 500 (log the real cause).

4. **Frontend**: `store/[id]/inbox.astro` shell + `StoreInboxApp` (full-page,
   folders rail incl. Spam, reusing `GmailThreadList`/`GmailThreadView` panes,
   `OverviewNoteEditor` reply, attachment/image strip, MCP-hint line). Store
   viewport **Inbox button navigates** to this route (keep the unread badge).

**Constraints:** D1 `db.batch()` not `transaction()`; chunk lists >100 params;
FKs not denormalized names; structured-output schema for any AI; no
`shadcn add --overwrite`. QC script `scripts/qc/pr_<n>.mjs` per PR; changelog
entry + preview deploy per repo rules.
