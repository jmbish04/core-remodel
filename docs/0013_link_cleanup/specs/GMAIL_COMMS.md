# Spec — Gmail Communications Hub (Phase 3, Companies CRM)

Per-company email inbox at `/admin/companies/[id]/emails` — review incoming + send reply-all, backed by a service account and RAG. This is also **groundwork for future email-triggered automation** (agent sends task reminders; contractor replies update the task) — out of scope now, but the data model + agent are built with it in mind.

## Auth — service account, domain-wide delegation
- Use existing secret-store bindings: `GOOGLE_CREDS_SA_PRIVATE_KEY_PT_1`, `GOOGLE_CREDS_SA_PRIVATE_KEY_PT_2` (concatenate), `GOOGLE_CREDS_SA_CLIENT_EMAIL`.
- Impersonate **`justin@126colby.com`** via DWD; Gmail API scopes: read + send.

## Ingestion (cron, every few hours)
1. For each contractor company in D1, build a search string from its contacts' email **domains** (if all contacts share a domain, e.g. `@contractor-acme.com`, search that domain; else search the exact addresses).
2. Query Gmail for messages **to/from** those addresses; **dedupe** against already-indexed threads/messages.
3. Persist to D1 (always capture full content). Run body embeddings → **Vectorize** with metadata `{ rag_uuid, message_id, thread_id }`.

## D1 schema (per user)
```
gmail_threads:  id (pk autoinc), thread_id (gmail native), timestamp_sent, subject
gmail_messages: id (pk autoinc), thread_id (FK on gmail-native thread_id, NOT threads.id),
                message_id (gmail native), timestamp, from_recipient: string,
                to_recipients: string[], subject: string, body: string,
                ai_summary: string, rag_uuid: string
```

## UI (inbox)
- `npx shadcn@latest add sidebar-09` → the two-pane inbox layout (folder rail + thread list + reading pane). Adapt to Monolith dark.
- Routes: `/admin/companies/[id]/emails` (inbox), `/emails/[threadId]` (thread view), `/emails/[threadId]/[messageId]/reply` (reply-all compose), `/emails/new` (compose).
- **User sends** the emails (via Gmail API reply-all); the compose UX is seamless and offers **Workers-AI draft assistance**.

## Agent (Cloudflare Agents SDK)
- An agent studies every email; all content is embedded in Vectorize. It queries Vectorize by the **current `thread_id`** and by the **parties involved**, so responses are grounded in the real conversation history.

## Not in scope now (but the reason for the groundwork)
Email-triggered automation: agent sends reminders on due tasks; when the recipient replies with an update, the agent stages the change so the task updates itself. Built later on top of the above.
