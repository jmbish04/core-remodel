# Drive ingestion service + vendor email with attachments — design

- **Date:** 2026-08-08
- **Status:** design APPROVED 2026-08-08 — Option B (standalone `drive_documents`)
- **Slug:** `drive-ingestion-vendor-email`
- **Ships as:** three PRs — a reusable ingestion service, then the email feature, then research indexing

---

## 1. What this is

Two things Justin does constantly, neither of which the platform supports today:

- **Onboard a vendor contact and email them project material.** Today this happens through the generic claude.ai Gmail connector, which knows nothing about the project, the boilerplate, or the files. There is no email tool in this repo's MCP registry at all.
- **Get Drive research content into deep research.** A large research corpus sits in Drive and is invisible to the app.

Both need the same substrate: a service that ingests a Drive folder into D1, keyed by what the content is *for*.

### 1.1 Ground truth — what is actually in the two folders

Both were walked in full before this design was written. This materially changed the plan, so it is recorded here rather than assumed.

**Onboarding materials** — `1ZUJ_taFjsdWUusVZtng8ZzUAX5BFVMxU`, 72 nodes, 12 folders:

| Type | Count |
| --- | --- |
| Images (jpg / HEIC / Google pic) | ~55 |
| PDFs | 4 |
| SketchUp `.skp` | 1 |

(An earlier draft said 71; the breakdown sums to 72. The live ingest catalogued 72 — 61 files + 11 subfolders — which reconciles exactly. The stray node was `cabinets/v1`, a PDF with no extension.)
| Google Docs / Sheets / Office | **0** |

Named PDFs: `1971 Blueprints`, `23. Floor Plans with Measurements`, `126 Colby St Design Jul 16 2026`, `cabinets/v1`.

**Deep research findings** — `17R5yV2LnFpsYcjSacIdkHNwZDlpgdjs1`, 87 nodes, 12 folders:

| Type | Count |
| --- | --- |
| Google Docs | ~46 |
| HTML (generated dashboards / mini-apps) | 26 |
| Folders | 12 |
| Presentation / Spreadsheet / `.tsx` | 3 |

Topic folders: product research, brand research, showroom research, Bay Area Showrooms, Building Systems & Utilities, Remodel Strategy & Procurement, Surfaces Finishes & Materials, Sinks Plumbing & Bath Fixtures, Kitchen Appliances & Cooking, Las Vegas Procurement, Business & Industry Research, AI Software & Workspace.

**This corrects an earlier draft**, which pointed at `1E-2gq4xYvKYp_svn13F1Er_PGJzXuuVC` — a different folder that is ~99% machine-generated `processing_json_logs`. That folder is NOT the research root. Per-root exclusions remain in the design (§8.0 `drive_root_exclusions`) because the hazard is real and cheap to guard, but they are no longer load-bearing for day one.

**Live dedupe case:** `Luxury Workstation Sink Market Analysis` exists **6 times** as separate Google Docs in `Sinks, Plumbing & Bath Fixtures`. Google-native files return no `md5Checksum`, so collapsing these needs the exported-text hash — see §3.1.

**Consequences that drive the design:**

1. The onboarding folder has no text documents worth extracting. Its value is *sending photos and 4 PDFs*, so slice A needs a catalogue with **sizes and links**, not an extraction pipeline.
2. The research folder is ~75 real documents — small, cheap and fast to embed. Its content is overwhelmingly Google Docs and generated HTML, so extraction is export-and-read, not OCR.
3. Duplicate Docs are already present, so content hashing has to work for Google-native files, where Drive gives no checksum.

---

## 2. Decisions taken, with the alternatives rejected

### 2.0 DECIDED — Drive documents get their own table (Option B)

**Chosen: Option B, a standalone `drive_documents` table plus a `drive_document_links` bridge.** Full schema in §8.2; the rejected alternative is in §8.1.

Rationale: `supporting_documents` was built for **micro-level records** — owner's manuals and tech sheets for purchased products, signed contracts, drawings, per-room and per-scenario artifacts. Drive material is **high-level** and will not carry that granularity. Option A kept them apart with a `documentTier` column, which is a discipline every future query must remember rather than a boundary the schema enforces; the failure mode is two libraries blurring silently. Drive content also changes on a completely different clock from contracts and manuals.

The price accepted: extraction/embedding plumbing is written once for `drive_documents` rather than inherited, and Drive files do not appear on `/docs` or in saved views without explicit wiring. The `drive_document_links` bridge covers the rare Drive file that genuinely IS a record.

#### Why reuse was considered at all (the case FOR Option A — NOT taken)

`supporting_documents` already models nearly everything asked for:

- `isActive`, `revisionNumber`, `revisionOfId`, `replacedById` — the exact supersede-on-change semantics requested
- `extractedText`, `extractionStatus` — the slice B pipeline's storage, already present
- `externalUrl`, `mimeType`, `sourceType`, `metadata`, `visibility`
- `document_entity_associations` (polymorphic links to company/brand/product/showroom/permit/floor) and `document_saved_views` already built on top

Drive-specific provenance goes in a **1:1 sidecar**, `drive_file_sources`, so Drive concerns do not leak into a general-purpose table.

The counter-argument — that `supporting_documents` means *records about specific purchased things*, and high-level Drive material is a different kind of object — is what makes this an open decision rather than a settled one. Both are written out in §8.

### 2.2 Cron run stats reuse `agent_runs`

`agent_runs` is already "one shared, agent-agnostic record of every agent execution, its steps, and every tool call", with statuses `queued | running | needs_approval | succeeded | failed | cancelled`, durable across requests, and a generic monitoring UI at `/admin/system/agents` that picks up new agents for free.

Each nightly scan opens one run and records per-root steps: nodes seen, created, superseded, deleted, skipped-by-exclusion, plus any error.

- **Rejected:** a bespoke `drive_scan_runs` table. It would duplicate a ledger that exists, and would not appear in the existing monitoring UI.

### 2.3 Use case is a code-level registry plus a definition table

The `useCase` value (`EMAIL_ONBOARDING_MATERIALS`, `DEEP_RESEARCH_FINDINGS`) selects **which downstream processor runs**, so it cannot be purely data — a new row cannot add a code path.

- `drive_use_cases` definition table (`id`, `key`, `name`, `description`, `is_active`) per the repo's config-driven-definitions rule, so the UI and API can list and describe them without a deploy.
- A code-side registry keyed by the stable `key` column maps to the processor. Adding a use case = one row + one registry entry.

### 2.4 `is_active` and `is_deleted` are different flags and both are kept

Per the explicit instruction:

- **Renamed or moved** → old row `is_active = false`, new row created under the new relationship, linked via `revision_of_id` / `replaced_by_id`. This is the revision log.
- **Gone from Drive** → `is_deleted = true`. The row is never hard-deleted.

A file can be superseded (`is_active = false`) without being deleted, and deleted without ever having been superseded. Conflating them loses the distinction between "this moved" and "this is gone".

### 2.5 Attach-vs-link is computed by code, never chosen by the model

Gmail caps a message at 25 MB, and base64 transfer-encoding inflates payload by roughly a third, so the usable raw budget is about 18 MB.

The model proposes *what* to send. Code decides *how*, and reports the plan back:

- Files that fit the remaining budget are attached.
- Anything that would exceed it becomes a Drive link.
- A folder selection is always a link plus a generated summary of its contents, drawn from the catalogue.
- `1971 Blueprints.pdf` is the canonical case and will always resolve to a link.

This must not be a model judgment call: the failure mode is a rejected send or a silently truncated email discovered by the vendor, not by us.

### 2.6 Sharing state is captured, and gates link sending

Requested enum, and the reason it matters: **sending a Drive link to a vendor for a `PRIVATE` file gives them a permission wall.** The catalogue stores sharing so compose can refuse or warn.

Drive REST v3 does not return the Apps Script `Access` enum directly. It is derived from the `permissions[]` array:

| Derived value | Derivation from Drive v3 |
| --- | --- |
| `ANYONE` | permission `type: "anyone"`, `allowFileDiscovery: true` |
| `ANYONE_WITH_LINK` | permission `type: "anyone"`, `allowFileDiscovery: false` |
| `DOMAIN` | permission `type: "domain"`, `allowFileDiscovery: true` |
| `DOMAIN_WITH_LINK` | permission `type: "domain"`, `allowFileDiscovery: false` |
| `PRIVATE` | no `anyone` or `domain` permission present |

Stored on both folder and file rows, refreshed every scan.

### 2.7 Auth is settled on a preview worker before anything else is built

The Gmail service account currently requests four scopes, all Gmail. `auth.ts` is explicit that a non-delegated scope means **no token at all** and every Gmail call fails — not just the Drive one.

Justin believes domain-wide delegation already covers Drive. That is plausible but unproven: the separate `google-workspace-mcp` worker reaches Drive successfully, but it can use per-user OAuth *or* DWD, so it does not settle the question.

**Task 1 of implementation** is to add `drive.readonly` to the requested scopes, deploy to a *preview* worker, and call Drive. If DWD lacks Drive, only the preview breaks; production is untouched. This is exactly what previews are for and it removes all guesswork.

`drive.readonly` covers metadata, content and `permissions[]`. The full `drive` scope is only needed for the later organize/rename tools and is deliberately not requested in these three PRs.

---

## 3. Architecture

### 3.1 PR 1 — the ingestion service

A single entry point, deliberately generic:

```ts
ingestDriveFolder(env, { rootId, useCase }): Promise<IngestSummary>
```

Any folder plus a use case can be added later without new code.

**Flow**

1. Recursively walk the root via Drive v3, requesting `id,name,mimeType,parents,size,md5Checksum,modifiedTime,createdTime,webViewLink,trashed,permissions`.
2. Apply the root's exclusions as the walk descends — an excluded subtree is never traversed, so `processing_json_logs` costs one check, not 4,972 reads.
3. Collect every live Drive id, then diff the whole set against D1 in one pass.
4. Classify each node: unchanged, new, superseded (renamed/moved/content-hash-changed), or deleted.
5. Write, chunked.

**Change detection**

- Binary files: `md5Checksum` from Drive.
- Google-native files (Docs/Sheets/Slides): Drive returns **no** `md5Checksum`. Fall back to `modifiedTime` plus a hash of the exported text. This is a real asymmetry and is called out so it is not discovered mid-implementation.

**D1 constraints that shape the writes**

- Never `db.transaction()` — D1 rejects SQL `BEGIN` (error 7500). Use `db.batch([...])`.
- Chunk every write at 20 rows per statement; D1 rejects any statement over 100 bound parameters, and even the 71-node onboarding folder exceeds that in one insert.

**Schema**

| Table | Purpose |
| --- | --- |
| `drive_use_cases` | definition table: `key`, `name`, `description`, `is_active` |
| `drive_roots` | `drive_folder_id`, `label`, `use_case_id` FK, `is_active`, `last_scanned_at` |
| `drive_root_exclusions` | per-root exclusion by subfolder drive id or mime pattern |
| `drive_folders` | `drive_id`, `name`, `parent_folder_id` self-FK, `root_id` FK, `web_view_url`, `sharing`, `is_active`, `is_deleted` |
| `drive_file_sources` | 1:1 sidecar on `supporting_documents`: `drive_id`, `root_id` FK, `folder_id` FK, `size_bytes`, `md5_checksum`, `web_view_url`, `sharing`, `modified_at`, `is_deleted`, `rag_uuid` |

All relationships are integer FKs. No denormalized `folder_name` or `root_name` columns — display names come from joins.

**Cron:** once daily. Opens one `agent_runs` run, one step per root.

### 3.2 PR 2 — vendor email (slice A)

**Email instructions.** Not a mail-merge template — an `AGENTS.md`-style instruction document with `<tags>` and conditionals that the composing agent reads and follows.

- Stored as `instructions_markdown` + `instructions_html` (repo convention: markdown is the source of truth, html is the render cache).
- Edited in the frontend with the PlateJS editor; read and written by MCP against the same content.
- Always optional — an input to composition, never a wrapper forced around the message.

**MCP `email` domain**

| Tool | Behaviour |
| --- | --- |
| `list_drive_documents` | browse the catalogue, filter by root/folder/name/mime |
| `get_drive_folder` | one folder with children and a content summary |
| `get_email_instructions` | read the boilerplate |
| `update_email_instructions` | modify it |
| `compose_email` | resolve recipients, compile the body, compute the attach/link plan with sizes and sharing warnings, persist a draft, **send nothing** |
| `send_email` | take a draft id and send |

**Send modes** — `send_email` takes a mode; the model defaults to `confirm` and only uses another when told:

- `confirm` (default) — the draft must be shown and approved first
- `direct` — compose and send in one step
- `gmail_draft` — write a Gmail draft, send by hand from Gmail

**Attachment sets** are a real mapping table, never a comma-separated column.

**Frontend:** compose surface reusing PlateJS plus a Drive picker, so anything doable by chat is doable by hand.

### 3.3 PR 3 — research indexing (slice B)

Runs only on roots whose use case is `DEEP_RESEARCH_FINDINGS`, and only outside exclusions. Root: `17R5yV2LnFpsYcjSacIdkHNwZDlpgdjs1`.

- **Extraction:** plain text and HTML read directly; Google Docs/Sheets via export; PDFs via `env.AI.toMarkdown()` (`@llamaindex/liteparse` cannot run on Workers — it is native-only).
- Text lands in `supporting_documents.extractedText`, with `extractionStatus` tracking progress. A failed parse is logged, never silently degraded to `{}` or `null`.
- **Embeddings** into Vectorize; the returned id is stored as `rag_uuid` on `drive_file_sources`. Vectorize ids cap at 64 bytes.
- Surfaced through the existing deep-research pipeline.
- Images are catalogued but not embedded.

---

## 4. Error handling

- A single file failing extraction marks that row `failed` with the message and continues; one bad PDF must not abort a nightly scan.
- Drive API 5xx/429 gets bounded retry with backoff; exhausted retries fail the step, not the run, so other roots still process.
- Every failure lands in `agent_runs` with its message, visible at `/admin/system/agents`.
- Compose refuses to send a link to a `PRIVATE` file and says so, rather than sending a link the vendor cannot open.
- Insert-then-link sequences that `db.batch()` cannot cover get a compensating delete on failure, and the residual gap is documented rather than papered over.

## 5. Testing

- **Unit:** exclusion matching; attach-vs-link budget maths at boundaries (just under, exactly at, just over 18 MB); sharing derivation from each `permissions[]` shape; rename-vs-move-vs-delete classification.
- **QC per PR** (`scripts/qc/pr_<n>.mjs`) against the deployed worker: PR 1 asserts the catalogue matches a known folder and that a second run is a no-op; PR 2 drives `compose_email` and asserts the attach/link plan for the 50 MB blueprint resolves to a link; PR 3 asserts extraction and a `rag_uuid` for a known doc.
- Every PR runs QC against both its preview and production.

## 6. Out of scope

Named so they are not silently dropped:

- Drive organize/rename/move tools (needs the full `drive` scope)
- Pulling email attachments into the Drive folder
- The multi-vendor bid blast, which should build on `bid_portfolios`
- OCR of photos

## 8. Schema options — pick one

Both options share the same three tables and differ **only** in where the per-file document record lives. Both satisfy the stated requirement of one folder table and one document table reused across every use case; neither creates per-use-case tables.

### 8.0 Shared by both options

```ts
// Definition table. Key drives a code-side processor registry —
// a row alone cannot add a code path, so both are needed.
drive_use_cases {
  id            integer PK autoincrement
  key           text NOT NULL UNIQUE   // EMAIL_ONBOARDING_MATERIALS | DEEP_RESEARCH_FINDINGS
  name          text NOT NULL
  description   text
  isActive      integer bool NOT NULL DEFAULT true
}

drive_roots {
  id             integer PK autoincrement
  driveFolderId  text NOT NULL UNIQUE          // Drive's own id for the root
  label          text NOT NULL
  useCaseId      integer NOT NULL FK -> drive_use_cases.id
  isActive       integer bool NOT NULL DEFAULT true
  lastScannedAt  integer timestamp
  createdAt / updatedAt
}

drive_root_exclusions {
  id           integer PK autoincrement
  rootId       integer NOT NULL FK -> drive_roots.id ON DELETE cascade
  kind         text NOT NULL                   // 'folder' | 'mime'
  value        text NOT NULL                   // drive folder id, or a mime pattern
  reason       text                            // why, for the next reader
  UNIQUE (rootId, kind, value)
}

// ONE folder table, every use case.
drive_folders {
  id              integer PK autoincrement
  driveId         text NOT NULL                // Drive folder id
  rootId          integer NOT NULL FK -> drive_roots.id
  parentFolderId  integer FK -> drive_folders.id   // self-FK; NULL at root
  name            text NOT NULL
  webViewUrl      text NOT NULL
  sharing         text NOT NULL                // ANYONE | ANYONE_WITH_LINK | DOMAIN | DOMAIN_WITH_LINK | PRIVATE
  isActive        integer bool NOT NULL DEFAULT true   // false = superseded by a rename/move
  isDeleted       integer bool NOT NULL DEFAULT false  // true  = gone from Drive
  supersededById  integer FK -> drive_folders.id
  driveModifiedAt integer timestamp
  createdAt / updatedAt
  INDEX (rootId, isActive), INDEX (driveId)
}
```

No denormalized `folder_name` / `root_name` anywhere — display names come from joins.

---

### 8.1 Option A — reuse `supporting_documents` + a Drive sidecar

The document record IS a `supporting_documents` row. Drive provenance lives 1:1 alongside it.

```ts
drive_file_sources {
  id                     integer PK autoincrement
  supportingDocumentId   text NOT NULL UNIQUE FK -> supporting_documents.id ON DELETE cascade
  driveId                text NOT NULL
  rootId                 integer NOT NULL FK -> drive_roots.id
  folderId               integer NOT NULL FK -> drive_folders.id
  sizeBytes              integer                    // NULL for Google-native files
  contentHash            text NOT NULL              // md5Checksum, or sha256(exported text)
  hashSource             text NOT NULL              // 'drive_md5' | 'exported_text'
  webViewUrl             text NOT NULL
  sharing                text NOT NULL
  driveModifiedAt        integer timestamp
  isDeleted              integer bool NOT NULL DEFAULT false
  ragUuid                text                       // Vectorize id (<=64 bytes)
  createdAt / updatedAt
  INDEX (rootId), INDEX (folderId), INDEX (driveId), INDEX (contentHash)
}
```

Revision semantics reuse the columns already on `supporting_documents`: `isActive`, `revisionNumber`, `revisionOfId`, `replacedById`. Extraction reuses `extractedText` + `extractionStatus`.

**Keeping the two levels legible.** One added column on `supporting_documents`:

```ts
documentTier  text NOT NULL DEFAULT 'record'   // 'record' | 'reference'
```

- `record` — the existing meaning: manuals, tech sheets, contracts, drawings; tied to a product, room, or scenario.
- `reference` — high-level Drive material; not expected to carry micro-level associations.

Every existing row keeps its meaning via the default. Every list, view and API filters on it, so the manuals surface never fills up with onboarding photos and vice versa.

**Gains**

- Extraction + embedding columns already exist, so PR 3 is nearly free.
- Drive content inherits `document_entity_associations`, `document_saved_views`, and the `/docs` surface immediately.
- A Drive file that IS a micro-level record (a signed contract that lives in Drive) is one row, not two joined ones.
- One document library. No "which table is this document in?" ambiguity, ever.

**Costs**

- `supporting_documents` takes on a second population with different semantics; the `documentTier` discipline must actually be honoured in every query, or the surfaces blur.
- `supporting_documents.id` is a text UUID, so ingestion mints UUIDs rather than using Drive ids as keys.
- Harder to reverse: unpicking later means migrating rows out.

---

### 8.2 Option B — a standalone `drive_documents` table

Drive gets its own document table. `supporting_documents` is untouched.

```ts
drive_documents {
  id               integer PK autoincrement
  driveId          text NOT NULL
  rootId           integer NOT NULL FK -> drive_roots.id
  folderId         integer NOT NULL FK -> drive_folders.id
  name             text NOT NULL
  mimeType         text NOT NULL
  sizeBytes        integer                     // NULL for Google-native files
  contentHash      text NOT NULL
  hashSource       text NOT NULL               // 'drive_md5' | 'exported_text'
  webViewUrl       text NOT NULL
  sharing          text NOT NULL
  driveModifiedAt  integer timestamp
  driveCreatedAt   integer timestamp

  extractedText    text                        // NULL for images / skipped types
  extractionStatus text NOT NULL DEFAULT 'pending'  // pending|processing|complete|failed|skipped
  extractionError  text
  ragUuid          text

  isActive         integer bool NOT NULL DEFAULT true
  isDeleted        integer bool NOT NULL DEFAULT false
  supersededById   integer FK -> drive_documents.id
  revisionNumber   integer NOT NULL DEFAULT 1

  createdAt / updatedAt
  INDEX (rootId, isActive), INDEX (folderId), INDEX (driveId), INDEX (contentHash)
}

// The bridge that stops this being a silo. Only for the rare Drive file
// that IS a micro-level record — a signed contract, a tech sheet.
drive_document_links {
  id                    integer PK autoincrement
  driveDocumentId       integer NOT NULL FK -> drive_documents.id ON DELETE cascade
  supportingDocumentId  text NOT NULL FK -> supporting_documents.id ON DELETE cascade
  UNIQUE (driveDocumentId, supportingDocumentId)
}
```

**Gains**

- Clean separation. `supporting_documents` keeps its exact current meaning; nothing about manuals/contracts changes.
- Drive-shaped columns (`driveId`, `sharing`, `contentHash`) sit on the table that owns them, no sidecar join for the common read.
- Trivially reversible — dropping the feature drops its tables.
- The email feature's hot path (list files, sizes, links, sharing) is one table, no join.

**Costs**

- Two document libraries. A Drive PDF does not appear in `/docs`, saved views, or entity associations without new wiring.
- PR 3 re-implements extraction status and embedding plumbing that `supporting_documents` already has.
- The `drive_document_links` bridge is a second thing to maintain, and it will be forgotten sometimes — meaning a contract in Drive is sometimes linked and sometimes not.
- Two places to look when answering "do we have a document about X?".

---

### 8.3 Decision

**Option B — chosen 2026-08-08.** The stated concern is correct and decisive: `supporting_documents` means *records about specific purchased things*, and high-level onboarding material genuinely is a different kind of object. Option A's `documentTier` column works, but it is a discipline rather than a constraint — it holds only as long as every future query remembers to filter, and the failure mode is silent blurring of two libraries that were deliberately kept apart.

Option B pays a real cost (duplicated extraction plumbing, a bridge table) to buy a boundary the schema enforces rather than a convention that must be remembered. Given Drive content will grow and change independently of the purchase/contract record set, the boundary is worth more than the reuse.

Option A is retained above only as the record of what was rejected and why. Do not partially adopt it: `drive_documents` is the sole document table for Drive content, and `supporting_documents` keeps its exact current meaning, unmodified by this work. No `documentTier` column is added.

## 7. Open risk

Domain-wide delegation may not include Drive. Settled by task 1 on a preview worker before any schema is written. If it turns out Drive is not delegated, the fallback options are a Workspace admin change or a second Drive-only service account, and that becomes a conversation rather than a surprise.
