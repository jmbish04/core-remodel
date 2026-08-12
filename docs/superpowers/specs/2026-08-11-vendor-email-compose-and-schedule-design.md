# Vendor email — compose, attach-as-link, drafts, rich text, scheduled send

- **Date:** 2026-08-11
- **Status:** design, awaiting approval
- **Slug:** `vendor-email-compose-schedule`
- **Builds on:** `docs/superpowers/specs/2026-08-08-drive-ingestion-and-vendor-email-design.md` (PR 1, shipped). This is that spec's "PR 2", refined by decisions taken 2026-08-11.
- **Ships as:** two PRs — **2a** core email (compose / send / draft / link / rich text), then **2b** scheduled send.

---

## 1. What this is

Two things Justin does constantly, still unserved after PR 1:

- **Email a vendor project material** — from a chat ("I onboarded this plumber, send him the floor plan") or by hand — with the platform's own context, boilerplate, and Drive links, instead of the generic claude.ai Gmail connector that knows none of it. **This repo's MCP registry still has zero email tools.**
- **Stage or schedule that email** — save it as a Gmail draft, or approve it late at night and have it go out at 9am tomorrow / Monday morning.

### 1.1 Decisions taken (2026-08-11), with their consequences

These reshape the "PR 2" sketch in the PR-1 spec; where they differ, THIS document governs.

1. **Drive files are LINKED, never attached.** No binary attachments from Drive. This removes the attach-vs-link-by-size logic, the `multipart/mixed` builder, the 18 MB Gmail cap problem, and the scheduled-send "rebuild the MIME from Drive at fire time" complexity all at once — a link is a few hundred bytes.
2. **Access is guaranteed by setting each linked file to `ANYONE_WITH_LINK`.** The recipient opens it with no sign-in. This is a **write** to Drive.
3. **Guaranteed access therefore needs the full `https://www.googleapis.com/auth/drive` scope** — `drive.readonly` (PR 1) cannot change permissions, and `drive.file` only covers app-created files, not existing ones. This is a **new domain-wide-delegation grant** and, per the PR-1 lesson, an undelegated scope makes Google reject the ENTIRE token exchange and breaks all Gmail — so it is **preview-tested before production**, exactly like `drive.readonly` was.
4. **`ANYONE_WITH_LINK` is public to anyone with the URL** — accepted trade for guaranteed no-sign-in access. (A per-recipient share would be more private but forces a Google sign-in; rejected.)
5. **Gmail's API has no scheduled send.** `messages.send` / `drafts.send` are immediate; "Schedule send" is a Gmail UI-only feature. Scheduled send is therefore built as a D1 queue + a minute-tick dispatcher (modeled on the existing `workflow-dispatcher`), NOT handed to Gmail.
6. **Rich text is HTML with inline styles only.** Gmail strips `<head>`, clips `<style>`, ignores classes and external CSS (per Gmail's behavior and the Mailchimp CSS-in-email guide). The email editor emits inline-`style`-attribute HTML with web-safe font fallbacks. Full mark set: bold, italic, underline, font-family, font-color.

---

## 2. PR 2a — core email

### 2.1 The Drive write scope (gate — do this first)

Task 1 of implementation, mirroring PR 1's Task 1:

- Add `https://www.googleapis.com/auth/drive` to `GOOGLE_SCOPES` in `services/gmail/auth.ts`.
- Deploy a **preview** worker, and via a probe route confirm BOTH: a Drive `permissions.create` succeeds on a throwaway test file, AND an existing Gmail read still returns 200 on that same preview.
- If the token mint fails (`unauthorized_client`), the scope is not delegated: revert, report BLOCKED, and wait for the Workspace Admin grant. Do NOT deploy to production. This is expected and acceptable — the whole point of the gate.

Reuse the PR-1 probe pattern (`GET /api/admin/drive-auth-probe`); extend it (or add a sibling) to exercise a write.

### 2.2 Ensuring a link is openable

A small service, `ensureAnyoneWithLink(env, driveFileId)`:

- Reads the file's current sharing (already derivable from `permissions[]`, PR 1).
- If it is not already `ANYONE` / `ANYONE_WITH_LINK`, calls Drive `permissions.create` with `{ type: "anyone", role: "reader" }`.
- Updates the cached `sharing` on the `drive_documents` / `drive_folders` row so the catalogue stays truthful (and the metadata-update path from the review-followups PR agrees).
- Idempotent: an already-public file is a no-op read.
- Returns the `webViewUrl` to embed.

Failure to set sharing is surfaced to the caller (compose reports it) — never silently sends a link the recipient cannot open.

### 2.3 Email instructions (the boilerplate)

An `AGENTS.md`-style instruction document the composing agent READS and follows — not a `{{name}}` mail-merge template.

- One row in `email_instructions`: `instructions_markdown` + `instructions_html` (repo convention — markdown canonical, html the render cache). This is prose-with-guidance, so markdown IS the right canonical form here (unlike the email body itself — see §2.5).
- Edited in the frontend (PlateJS, the existing markdown editor is fine for instructions) and read/written by MCP against the same content.
- Always optional — an input to composition, never a wrapper forced around the message.

### 2.4 Recipient resolution

`compose_email` accepts recipients as either explicit email addresses or references to resolve:

- Explicit `to`/`cc`/`bcc` email strings pass through.
- A reference like a showroom store + contact resolves against `showroom_store_contacts` (`emailAddress`, `firstName`, `lastName`, `storeId`) — the "I just onboarded this contact, email them" path.
- An unresolvable reference is an error the tool reports, never a silent drop or a guessed address.

### 2.5 Rich-text email body — HTML canonical, inline styles only

The body is authored in a **dedicated email editor** (PlateJS), distinct from the markdown note editor, because the repo's "markdown canonical" convention cannot express underline / font-family / font-color and email renders HTML regardless.

- **HTML is the source of truth** for the email body. A best-effort plaintext alternative is derived for the `multipart/alternative` text part (accessibility + non-HTML clients); markdown is not stored for the body.
- Marks: **bold, italic, underline, font-family, font-color** (needs `@platejs/font`).
- The serializer emits **email-safe HTML**: every style as an inline `style="..."` attribute, no `<style>`/`<head>`/class/external CSS, web-safe font stacks with fallbacks. Supported inline properties limited to the set Gmail honors: `color`, `background-color`, `font-family`, `font-size`, `font-weight`, `font-style`, `text-decoration`, `text-align`.
- The HTML is **sanitized on write** (server-side) before it is ever stored or sent — the author is trusted, but a sanitize pass keeps the stored/sent HTML to the safe subset and strips anything a client would choke on.
- The existing `buildComposeRaw` already emits `multipart/alternative` (text + html); it is reused. No `multipart/mixed` — there are no binary attachments.

### 2.6 MCP `email` domain

New `src/backend/mcp/tools/email/`, one file per tool:

| Tool | Behaviour |
| --- | --- |
| `get_email_instructions` | read the boilerplate |
| `update_email_instructions` | modify it (markdown + html) |
| `resolve_recipient` | turn a store/contact reference into an email address (or report it cannot) |
| `compose_email` | resolve recipients, compile the body from instructions + given content, take a list of Drive file ids to LINK (each run through `ensureAnyoneWithLink`, reporting any that failed), persist a **draft record** in D1, and return it for review. Sends NOTHING. |
| `send_email` | take a draft id + a `mode` and act: `confirm` requires the draft was shown/approved, `direct` composes+sends in one step, `gmail_draft` writes a Gmail draft (via `users.drafts.create`) and returns its id for the user to send by hand. |

`send_email` defaults to `confirm`. The two-step (compose → review → send) exists because sending to a real vendor is outward-facing and irreversible.

### 2.7 Drafts

- **Our draft record** (`email_drafts` in D1) is the compose spec: recipients, subject, body HTML + derived text, the linked Drive file ids, status (`draft` / `sent` / `scheduled`), timestamps. It is what `compose_email` writes and `send_email` reads.
- **A Gmail draft** (mode `gmail_draft`) is a separate thing: `users.drafts.create` writes the built RFC-822 into the mailbox so the user finishes it in Gmail. Staging a draft = this mode.
- The frontend compose surface reads/writes `email_drafts` so anything doable by chat is doable by hand and vice versa.

### 2.8 Frontend

A compose surface (new page + island) reusing the email editor + a Drive picker (browse the PR-1 catalogue, pick files to link) + recipient chips (typed or resolved from contacts). Follows the mandatory page shell (BaseLayout, container, header block with icon). Shows the linked files with their post-`ensureAnyoneWithLink` sharing state so it is visible that access was granted.

### 2.9 Schema (PR 2a)

| Table | Purpose |
| --- | --- |
| `email_instructions` | the boilerplate: `instructions_markdown`, `instructions_html`, `updated_at`. Single-row (or keyed by a name for future multiplicity; v1 single). |
| `email_drafts` | compose spec: `to_json`, `cc_json`, `bcc_json`, `subject`, `body_html`, `body_text`, `status`, `gmail_draft_id?`, `gmail_message_id?`, `sent_at?`, timestamps. |
| `email_draft_links` | mapping: `email_draft_id` FK, `drive_document_id` FK, the `web_view_url` and `sharing` captured at compose time. A real mapping table, never a comma-separated column. |

Money: none. Multi-select (the linked-files set): a real mapping table per the repo rule.

---

## 3. PR 2b — scheduled send

Built on 2a's `email_drafts`. Gmail has no scheduled send (§1.1.5), so:

- `email_drafts.status` gains `scheduled`; add `send_at` (timestamp) and `schedule_error?`.
- A new MCP tool `schedule_email` takes a draft id + an absolute `send_at` (the model resolves "9am Monday" to a concrete UTC instant using Justin's timezone and today's date — the tool receives an ISO timestamp, not a phrase, so the resolution is unambiguous and testable). It sets `status = 'scheduled'`, `send_at = <ts>`. `cancel_scheduled_email` reverts to `draft`.
- **The dispatcher:** the existing `* * * * *` master cron already calls into `src/_worker.ts`. Add `dispatchDueEmails(env)` alongside `dispatchDueWorkflows`: select `email_drafts` where `status='scheduled' AND send_at <= now`, and for each, send it (rebuild the RFC-822 from the stored spec — links are already in the HTML, so no Drive re-fetch is needed; just re-run `ensureAnyoneWithLink` on each linked file so a file that lost its sharing between schedule and send is re-shared), mark `sent`/`sent_at` or record `schedule_error` and leave it for retry/attention. One email's failure must not stop the others (per-row try/catch, like the PR-1 cron).
- Each dispatch is recorded in the existing `agent_runs` ledger (one run per tick that sent anything, a step per email), so it shows at `/admin/system/agents` — no bespoke table.
- **Concurrency:** a due email must be claimed atomically (a conditional `UPDATE ... SET status='sending' WHERE id=? AND status='scheduled' RETURNING`) so an overlapping tick or a manual send cannot double-send it. Same lesson as the PR-1 scan lease.
- Frontend: the compose surface gains a "schedule" control and a list of scheduled emails with cancel.

---

## 4. Error handling

- A linked file whose sharing cannot be set → `compose_email` reports it per-file; the email is not silently sent with a dead link. The user decides (send anyway, fix by hand, drop the file).
- Recipient that cannot be resolved → error, never a guessed address.
- Gmail send failure → surfaced; a scheduled send records `schedule_error` and does not mark `sent`, so it is visible and retryable rather than lost.
- HTML that fails sanitize → rejected on write with a message, never stored/sent raw.
- D1 discipline throughout: no `db.transaction()`, `db.batch()` only; chunk any unbounded multi-row write / `inArray` at 20; relate by FK, no denormalized `*_name`.
- The atomic claim on scheduled sends prevents double-send across overlapping ticks.

## 5. Testing

- **Unit (pure):** the email-HTML serializer (marks → inline-style HTML; underline/color/font each round-trip; a disallowed property is stripped); the plaintext derivation; the "9am tomorrow / Monday" → UTC resolution given a fixed now + tz.
- **QC (`scripts/qc/pr_<n>.mjs`) against the deployed worker:**
  - 2a: `compose_email` produces a draft with the expected recipients and body; a linked PRIVATE file comes back `ANYONE_WITH_LINK` after compose (proves the write scope end to end); `send_email` in `gmail_draft` mode creates a retrievable Gmail draft; `direct`/`confirm` behave per mode.
  - 2b: `schedule_email` sets `send_at`; a due email is claimed exactly once under two concurrent dispatch calls (the double-send guard); `cancel_scheduled_email` reverts.
- Both PRs QC against preview AND production, per repo convention, with new-surface assertions gated on a capability probe so the production run stays a clean regression guard pre-merge.

## 6. Out of scope (named, not dropped)

- Binary attachments (non-Drive files, embedded photos) — everything is a link in v1.
- Multi-vendor bid blast — separate feature, builds on `bid_portfolios`.
- Mail-merge / per-recipient variable substitution — the instructions doc is guidance the agent follows, not templated fields.
- Multiple named instruction templates — v1 is a single instructions doc.
- Reply-into-thread from the composer — the existing `/reply` route covers thread replies; this is new-message composition.

## 7. Open prerequisite (needs Justin)

The full `https://www.googleapis.com/auth/drive` scope must be granted in Workspace Admin → domain-wide delegation for the service account (the same client id that holds the four `gmail.*` scopes + `drive.readonly`). Until then, PR 2a's Task 1 gate will (correctly) report BLOCKED and stop. Everything up to that gate — schema, the editor, recipient resolution, the draft record, the MCP tool skeletons — can be built and unit-tested without it; only the live `ensureAnyoneWithLink` write and its QC need the grant.
