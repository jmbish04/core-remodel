# Vendor email — core-remodel context layer (Gmail mechanics live on the Workspace worker)

- **Date:** 2026-08-11
- **Status:** design, awaiting approval
- **Slug:** `vendor-email-context-layer`
- **Builds on:** `docs/superpowers/specs/2026-08-08-drive-ingestion-and-vendor-email-design.md` (PR 1, shipped). This is that spec's "PR 2", re-architected by decisions taken 2026-08-11.

---

## 1. What changed, and why this is now small

The original "PR 2" sketch had core-remodel building the whole Gmail send path — MIME, attachments, drafts, scheduled-send queue, rich-text HTML. **That is no longer the plan.** Decisions taken 2026-08-11:

1. **The Gmail mechanics move to the separate `google-workspace-mcp` worker.** That worker already has its own per-user OAuth with **Drive write** (it no longer relies on domain-wide delegation), so it — not core-remodel's Gmail service account — is the right home for: rich-text HTML bodies, attachments (Drive-file blobs + raw blobs, with anyone-with-link fallback past Gmail's 25 MiB cap), and scheduled send (a worker-side queue, because the Gmail API has no native scheduled send). Three prompts were written to build those capabilities there; they are out of scope for THIS repo.
2. **core-remodel therefore keeps only the project CONTEXT** the Workspace worker cannot know: the reusable boilerplate/instructions, resolving a vendor reference to an email address, and the Drive-file catalogue to choose from. The agent (in chat) orchestrates: pull context from core-remodel's MCP, then call the Workspace worker's `gmail_send` / `schedule_email` with the assembled message.
3. **No Drive-write scope in core-remodel.** The write-scope gate the earlier draft of this spec carried is deleted — sharing changes happen on the Workspace worker.

So this PR is a small, self-contained context layer with no dependency on the Workspace worker's timeline: it produces data and payloads; it sends nothing.

## 2. Scope

**In (PR 2a — core-remodel context layer):**

- **Email instructions** — a reusable, editable boilerplate/guidance document the composing agent reads.
- **Recipient resolution** — turn a showroom store / contact reference into an email address from data already in D1.
- **A compose-context tool** — assemble the send-ready payload (recipients + subject + body guidance + chosen Drive files with their share state and a suggested attach-vs-link disposition) for the agent to hand to the Workspace worker. Sends nothing.

**Out (named, not dropped):**

- All Gmail send / draft / attachment / scheduled-send mechanics → the `google-workspace-mcp` worker (the three prompts).
- Rich-text HTML authoring + a frontend compose-and-send surface → deferred until the Workspace worker exposes send/HTML/attachment tools, since a "send" button here would have nothing to call. The instructions editor (below) is the only frontend in this PR.
- Multi-vendor bid blast; mail-merge; multiple named instruction templates (v1 is one instructions doc).

## 3. Components

### 3.1 Email instructions

An `AGENTS.md`-style instruction document the agent READS and follows when composing — guidance and conventions, not a `{{name}}` mail-merge template.

- Table `email_instructions`, single active row: `instructions_markdown` + `instructions_html` (repo convention — markdown canonical, html the render cache; markdown IS the right canonical form here because this is prose guidance, not a formatted email body).
- MCP: `get_email_instructions`, `update_email_instructions` (accept + return both markdown and html; sanitize html on write).
- API: `GET /api/email/instructions`, `PUT /api/email/instructions` (admin-gated).
- Frontend: an admin-gated editor page reusing the existing PlateJS markdown note editor (`OverviewNoteEditor`) — headings/bold/italic/lists, emitting `{ markdown, html }`. Follows the mandatory page shell (BaseLayout, container, header block with icon).

### 3.2 Recipient resolution

- MCP: `resolve_recipient` — input is either an explicit email address (passes through, validated) or a reference (a showroom store id/name + optional contact name/role). Resolves against `showroom_store_contacts` (`store_id`, `email_address`, `first_name`, `last_name`, and the contact role/kind already on that table). Returns the matched address(es) with the contact/store they came from, or a clear "could not resolve / ambiguous — here are the candidates" result. **Never guesses or silently drops** an unresolvable reference.
- API: `GET /api/email/resolve-recipient?store=&contact=` (admin-gated), same logic, for the frontend/debugging.
- Relate by FK + JOIN; no denormalized name columns.

### 3.3 Compose-context tool

- MCP: `compose_vendor_email` — the convenience that ties the layer together for a chat flow. Inputs: a recipient reference (or explicit address), a subject, a short statement of intent, and an optional list of `drive_document_id`s (from the PR-1 catalogue) to include. It:
  - resolves recipients via §3.2,
  - loads the instructions via §3.1 so the agent has the boilerplate to fold in,
  - for each chosen Drive file, returns `{ driveDocumentId, name, mimeType, sizeBytes, webViewUrl, sharing, suggestedDisposition }` where `suggestedDisposition` is `"attach"` when the running total stays under ~18 MiB of raw bytes (Gmail's 25 MiB cap minus base64 inflation) and `"link"` otherwise — a RECOMMENDATION for the agent/Workspace worker, which makes the final call and does the actual attaching/sharing.
  - returns a single structured payload: `{ to, cc, subject, instructionsMarkdown, attachments[] }`.
  - **Sends nothing, changes no Drive sharing** — it only assembles context. The agent passes this to the Workspace worker's `gmail_send` / `schedule_email`, which performs the attach/link/share/send.
- **Confirmed against the built Workspace tools (2026-08-12).** The `google-workspace-mcp` Gmail tools now exist (rich HTML+markdown+attachments+scheduled). Their real contract: `gmail_send` / `schedule_email` take a single `to` string, `subject`, and `markdown` OR `html` (the worker inlines CSS + renders markdown, so core-remodel authors NO HTML), plus `attachments: [{ driveFileId, as: "attach"|"link" }]` (auto-fallback to an anyone-with-link Drive link over Gmail's 25 MiB cap), and `schedule_email` adds `send_at` (ISO-8601 UTC — the agent resolves "Monday 9am" first). So `compose_vendor_email` emits each attachment as `{ driveFileId, as, ... }` (the Google Drive file id + the `as` enum) to map 1:1 onto that input, and hands `instructionsMarkdown` over as `markdown`. This is why rich-text authoring is correctly OUT of scope here — the worker owns formatting.
- No API route and no persisted draft in v1: nothing here is stateful beyond the instructions doc. A persisted draft only earns its place once the frontend compose-and-send surface exists, which is deferred.

### 3.4 MCP `email` domain

New `src/backend/mcp/tools/email/`, one file per tool: `get_email_instructions`, `update_email_instructions`, `resolve_recipient`, `compose_vendor_email`. Registered in the registry per the repo's one-file-per-tool convention; the `/connect/tools` catalog picks them up.

## 4. Schema

| Table | Purpose |
| --- | --- |
| `email_instructions` | single active row: `instructions_markdown`, `instructions_html`, `updated_at`. |

That is the whole schema. No drafts table, no attachment mapping — those belonged to the send path, which now lives elsewhere. (If §3.3's payload ever needs auditing, a log table can be added when the frontend send surface lands.)

## 5. Error handling

- Unresolvable / ambiguous recipient → structured "cannot resolve, here are candidates," never a guess.
- HTML that fails sanitize on the instructions write → rejected with a message, never stored raw.
- D1 discipline: no `db.transaction()`, `db.batch()` only; relate by FK, no denormalized `*_name`; hand-written Zod (never drizzle-zod).
- The compose tool touches no external system and changes no state, so it cannot half-fail; the Workspace worker owns every failure mode of the actual send.

## 6. Testing

- **Unit (pure):** the attach-vs-link `suggestedDisposition` size logic (a set of files crossing ~18 MiB flips the overflow to `link`); recipient-reference normalization (explicit address passes; store+contact resolves; ambiguous returns candidates).
- **QC (`scripts/qc/pr_<n>.mjs`) against the deployed worker:** `GET`/`PUT /api/email/instructions` round-trip; `resolve_recipient` resolves a known showroom contact and reports a clear miss for an unknown one; `compose_vendor_email` returns a payload with resolved recipients + the instructions + the chosen files' share state and a plausible disposition. Preview + production, new-surface assertions gated on a capability probe so the production run stays a clean regression guard pre-merge.
- No send is exercised from this repo — that is the Workspace worker's test surface.

## 7. Dependencies & sequencing

- **No hard dependency on the Workspace worker.** This layer produces data/payloads and can be built and shipped independently, in parallel with the Workspace-worker email work.
- The end-to-end flow (compose context here → send there) only lights up once the Workspace worker has the send/HTML/attachment tools from the three prompts. Until then this layer is exercised via its own API/MCP + QC, and the payload is validated by shape, not by a real send.
- The deferred frontend compose-and-send surface + rich-text authoring picks up when the Workspace worker is ready; it will call the Workspace worker's tools to send.
