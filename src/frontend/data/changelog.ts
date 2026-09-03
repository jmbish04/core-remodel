/**
 * Project changelog — the bundled seed/fallback for the persistent D1 store.
 *
 * The source of truth is D1 (`changelog_branches` + `changelog_entries`), which
 * accumulates across every branch/PR and is never overwritten. This file is
 * (1) the one-time seed for a fresh DB (POST /api/changelog/seed) and (2) the
 * SSR fallback the overview renders when D1 is empty. Each new branch appends a
 * `ChangelogBranch` + its `ChangelogEntry` rows here, then registers them into
 * D1 (POST /api/changelog/branches + /entries) so the record persists forever.
 */

/** Defines the types of changes that can occur in a changelog entry. */
export type ChangeKind = "added" | "changed" | "removed" | "migration" | "fixed";

/** Represents a single change within a changelog entry. */
export interface ChangelogChange {
  /** The type of change. */
  kind: ChangeKind;
  /** The description of the change. */
  text: string;
}

/** Represents a branch or pull request that introduces changes. */
export interface ChangelogBranch {
  /** The name of the branch. */
  branch: string;
  /** The title of the branch or pull request. */
  title: string;
  /** An optional summary of the changes in the branch. */
  summary?: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** The status of the branch. */
  status: "shipped" | "staged" | "open";
  /** The optional pull request number. */
  prNumber?: number;
  /** The optional pull request URL. */
  prUrl?: string;
}

/** Represents a detailed changelog entry for a specific feature or fix. */
export interface ChangelogEntry {
  /** Slug — the detail-page URL segment. Stable, author-chosen, human-readable. */
  id: string;
  /**
   * `changelog_entries.id` — the D1 autoincrement, shown as `#N` beside the
   * title so two similarly-named entries can be told apart at a glance and
   * referred to in conversation.
   *
   * Optional because the bundled seed is the SSR fallback and has no row ids;
   * when it is serving, the number is omitted rather than invented.
   */
  entryNo?: number;
  /** The branch associated with this entry. */
  branch: string;
  /** The date of the entry (YYYY-MM-DD). */
  date: string;
  /** An optional tag for the entry. */
  tag?: string;
  /** The functional area this entry affects. */
  area: string;
  /** The title of the entry. */
  title: string;
  /** A summary of the entry. */
  summary: string;
  /** The list of changes included in this entry. */
  changes: ChangelogChange[];
  /** Optional migration tags associated with this entry. */
  migrations?: string[];
  /** The status of the entry. */
  status: "shipped" | "staged";
  /** PR that carried this entry, when one exists. */
  prNumber?: number;
  prUrl?: string;
}

/** Branches / PRs, newest first. */
export const BRANCHES: ChangelogBranch[] = [
  {
    branch: "orca/budget-ux-overhaul",
    title: "Budget & Procurement Command Center — /admin/budget rebuilt as one workbench",
    summary:
      "Rebuilds /admin/budget as a single tabbed workbench matching the approved design canvas — Grid, Inbox, Estimates, Rooms, Savings, Compliance behind one KPI header — and wires every tab to a real API. Two documents were written before any code so parallel agents were held to one standard: a D1/Drizzle rules sheet researched against the live Cloudflare docs (row reads are the billed unit, one db.batch round trip per screen, aggregate in SQL, chunk at the 100 bound-parameter cap, db.transaction() is dead on D1), and an API contract pinning every endpoint shape up front. Rule zero throughout: no SQL in frontend code — islands call a typed client, the client calls Hono, Hono runs Drizzle. Adds three tables and eleven covering indexes (0184, 0185, both applied and verified on remote), three new routers, a reworked grid/inbox/rooms-finance, and fixes a silent data-loss bug where a logged expense saved with no date because parseTimestamp rejected numbers.",
    date: "2026-09-03",
    status: "staged",
    prNumber: 412,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/412",
  },
  {
    branch: "worktree-bridge-cse_016Rp7EJTqbFmvTpUX2cUvWw",
    title:
      "System health audit — two false-alarm probes, an abandoned-run sweep, and a KV spend breaker",
    summary:
      "System health reported FAILURE with 5 failing probes. Auditing each against production showed two of the five were measurement artifacts, latched red permanently, masking the rest. (1) The email pipeline probe counted `status='pending'` without excluding `ai_status='pending_approval'` — the 0042 AI trust gate's deliberate parked state — so every Gmail message read as a stalled pipeline; 22 of 26 pending rows on prod were parked, not stuck. (2) The Durable Object runaway watcher counted `running` rows of any age as evidence a DO was awake and billing; the 31 rows were corpses from crashes 6-16 days earlier, and the probe's own message said `Last hour started=0`. Root cause of (2): a run row is opened by `startRun` and closed by the caller, so a dead isolate leaves it `running` forever — `sweepAbandonedRuns` now marks those `failed`/`ABANDONED` on the daily cron. Separately, `DURABLE_OBJECT` had been a declared metered provider since metering shipped with no writer anywhere, so its ceiling summed to $0 and could never trip; `startRun`'s close now prices the run's wall-clock. `generateStructuredOutput` (15 callers) spent on both the Workers AI path and the Gemini fallback with no ceiling check and no usage row. A KV read-through cache now fronts `canSpend`, whose uncached path is two D1 queries including a SUM over an append-only table. No migration.",
    date: "2026-08-12",
    status: "staged",
    prNumber: 382,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/382",
  },
  {
    branch: "claude/budget-workbench-p3",
    title: "Budget workbench P3 — estimate-line reconciliation HITL",
    summary:
      "First workbench phase: map estimate line items to rooms with an AI-staged, human-confirmed loop — schema (migration 0183), AI-suggest + reconcile + queue routes, a HITL UI at /admin/budget/reconcile, and MCP tools. Built via the local-ai-orchestrator (claude) with per-diff review.",
    date: "2026-08-12",
    status: "staged",
    prNumber: 406,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/406",
  },
  {
    branch: "claude/budget-grid-followups",
    title: "Budget grid usability — phase assignment + funding config",
    summary:
      "Two follow-ups that make the shipped budget grid usable: assign a line to a phase from the grid, and set funding accounts (Total Budget) from the UI. Plus a correctness fix — the item PATCH revision insert was dropping phaseId + the variance note.",
    date: "2026-08-12",
    status: "staged",
    prNumber: 400,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/400",
  },
  {
    branch: "feat/vendor-email-context-layer",
    title: "Vendor-email context layer — instructions doc + recipient resolution",
    summary:
      "PR 2a of the vendor-email arc (PR 1 was Drive ingestion, #374). A single reusable email_instructions doc (markdown + sanitized html, one row), resolve_recipient (explicit address or showroom store+contact lookup — never guesses, returns ok:false/candidates on no_match/ambiguous/invalid), and compose_vendor_email which assembles a send-ready payload (recipient + instructions + Drive attachments with an attach-vs-link suggestion against Gmail's ~18 MiB usable budget). Sends nothing and changes no Drive sharing — the actual send is out of scope here and lives on the google-workspace-mcp worker. Migration 0181 (email_instructions), applied to remote.",
    date: "2026-08-11",
    status: "staged",
    prNumber: 379,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/379",
  },
  {
    branch: "fix/drive-ingestion-review-followups",
    title: "Drive ingestion — three review findings from an independent reviewer",
    summary:
      "An independent code review (Cursor, gpt-5.6-sol-high) run over the merged PR #374 found three real defects that the build's own multi-agent review chain missed — two of them interactions between fixes rather than defects in any one change. (1) The scan lease was released unconditionally, so a scan whose stale lease was legitimately stolen would clear the thief's newer lease on exit, letting a third scan run concurrently. (2) The supersede compensating write could no longer run: the partial unique index added in the same fix wave rejects the reactivation once the replacement row is active, so a transient link failure threw out of the catch and aborted the scan. (3) Sharing changes were never detected — the diff compared name, parent and content hash but not sharing, so a Drive permission change with no rename/move/edit left a stale value that decides whether a link can be emailed to a vendor. Also paginated the documents route. No migration.",
    date: "2026-08-10",
    status: "staged",
    prNumber: 377,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/377",
  },
  {
    branch: "claude/database-schema-audit-cleanup-271ac6",
    title: "Showroom stores normalization — audit + migration plan (no code shipped)",
    summary:
      "PLAN ONLY. A 6-agent audit of showroom_stores against live prod: the location→child-table refactor is already 100% mirrored (233/233 stores have location rows; the 16 flat columns are redundant copies), the contact side is barely started (0 GENERAL_CONTACT rows; 72 pocs + 5 main_poc unmigrated), and NOTHING can drop yet because intake writes zero child rows and ~35 placeId + all geo readers still read flat columns. Ships the staged expand→contract plan plus the intake-normalization + 50-mile sibling-discovery feature preview. No source changed except this changelog + the plan doc.",
    date: "2026-08-09",
    status: "staged",
  },
  {
    branch: "feat/jules-clearance-extraction",
    title: "Jules-powered clearance extraction + plain-fetch link discovery (0038 Phase B/C)",
    summary:
      "The weekly showroom sale/clearance sweep now hands its pages to a repoless Google Jules session as the PRIMARY extractor, using the paid subscription's ~1M-token context for the heavy analysis. A new native-alarm Durable Object (JulesClearanceAgent) stands the session up, waits for the VM to boot, then feeds scraped pages in small batches and reads back one JSON reply per batch — so the sweep is no longer bound by the ~15-minute scheduled-invocation wall that was truncating it. Cost is bounded like TeslaStreamDO: job state lives in KV (never DO SQLite), each alarm fire does at most a few pages, and the alarm is deleted the instant the job finishes so the DO goes dormant. Workers-AI is the fallback on any Jules outage or unparseable reply, moved off kimi-k2.6 (a reasoning model that returns empty content for structured output — the reason most snapshots were empty) to kimi-k2.7-code with thinking disabled. The SDK itself can't run on Workers (its bundle statically imports node:fs/os), so we call the Jules REST API directly; @google/jules-sdk stays a dev dependency for its types. Also closes the coverage gap: plain-fetch sitemap/homepage discovery finds and registers clearance links across all stores, not just the 6 a shallow scrape happened to crawl.",
    date: "2026-08-11",
    status: "shipped",
    prNumber: 380,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/380",
  },
  {
    branch: "feat/drive-ingestion-service",
    title: "Drive ingestion service — catalogue any Google Drive folder into D1",
    summary:
      "A generic ingestDriveFolder(env, rootId) service: point it at a Drive folder with a use case and it walks the tree, hashes every file, and keeps D1 in step with Drive — new files created, renames and moves superseded into a revision chain, deletions marked rather than removed, and sharing state (ANYONE / ANYONE_WITH_LINK / DOMAIN / DOMAIN_WITH_LINK / PRIVATE) recorded per node. Adding another folder later is a row insert, not a code change. This is PR 1 of 3; PR 2 is vendor email with Drive attachments and PR 3 is research indexing. The blocker found first: drive.readonly was not in the service account's domain-wide delegation, and requesting it made Google reject the whole token exchange — taking every Gmail call down with it. That was caught on a preview worker before production ever saw it.",
    date: "2026-08-08",
    status: "staged",
    prNumber: 374,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/374",
  },
  {
    branch: "fix/mcp-oauth-one-year-ttls",
    title: "MCP connector fixed: absolute registration_client_uri + one-year OAuth lifetimes",
    summary:
      "Two defects. The connector kept dropping and sometimes could not be repaired by re-authorizing. The OAuthProvider in src/_worker.ts set no TTLs, so @cloudflare/workers-oauth-provider@0.8.1's defaults applied: 1h access tokens, 30d refresh tokens, and — the damaging one — a 90d clientRegistrationTTL that deletes the `client:<id>` record out of OAUTH_KV, leaving a connector holding that client_id unable to refresh its way back. OAUTH_KV showed the churn: 77 dead `client:` records and 70 `grant:` records for one operator, against another worker sharing that namespace whose grants run a year and stay connected. All three lifetimes are now pinned to 365 days. Re-adding the connector then surfaced the second defect: `registration_client_uri` shipped as a relative URI, violating RFC 7591 §3.2.1, so claude.ai's dynamic client registration threw on it and reported \"Couldn't register with core-remodel's sign-in service\" — even though the server returned 201 and wrote the record, which is why every server-side probe looked healthy. It is now rewritten per-request against the request's own origin.",
    date: "2026-08-08",
    status: "staged",
    prNumber: 372,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/372",
  },
  {
    branch: "claude/multi-room-render",
    title: "Multi-room multi-angle render campaigns (0048)",
    summary:
      "Adds render campaigns that apply one design brief across every angle of multiple rooms, tracks progress durably via a Cloudflare Workflow, exposes the tools in the canonical OAuth MCP registry, and surfaces an admin campaign UI.",
    date: "2026-08-07",
    status: "staged",
    prNumber: 370,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/370",
  },
  {
    branch: "claude/0047-p1-schema",
    title: "Collapse chain branches into one business — Tier 2 (0047)",
    summary:
      "0046 detects that some store rows are branches of one business and refuses to merge them (returns branchCandidates); 0047 makes those actionable. A scan stages each branch group as a reviewable candidate; a human approves; apply carries every branch's site across as a location on the keeper and soft-deletes the branch store. Backend shipped + verified on prod: migration 0171 (3 tables + a collapse_state machine + a unit column on locations), branch-detection + branch-collapse services, an extracted shared child-remap (dedup and collapse now share one implementation), and five MCP tools (scan/list/get/resolve/apply_merge_candidate). Proposes and never auto-merges, per the standing decision. The web review UI (P5) remains.",
    date: "2026-08-05",
    status: "shipped",
    prNumber: 363,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/363",
  },
  {
    branch: "claude/budget-backend-frontend-09f91d",
    title: "Budget grid schema foundations (0035)",
    summary:
      "First slice of the 0035 budget grid + workbench umbrella: the time-phasing schema. Adds budget_phases (def table + config page), budget_plan_schedule (the monthly Estimate axis), and the budget_expense_entries → budget line link (stable trackId, no FK) that lets the grid roll actuals up per line and bucket them by month. Migration 0171 is additive-only and applied to remote.",
    date: "2026-08-05",
    status: "staged",
    prNumber: 360,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/360",
  },
  {
    branch: "codex/pascal-core-remodel-continuation",
    title: "Pascal Layout Studio (0043 Phase 4)",
    summary:
      "Completes the Core Remodel-owned management surface for Pascal projects, studies, measured and branched variants, comparison evidence, snapshots, rename/archive lifecycle, and editor deep links. REST and MCP now share generation and comparison workflows, and the Pascal OpenAPIHono registry is merged into the served OpenAPI document.",
    date: "2026-08-02",
    status: "staged",
    prNumber: 342,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/342",
  },
  {
    branch: "claude/0042-p5-product-map",
    title: "Quote line items → products (0042 P5)",
    summary:
      "Completes 0042. Each extracted quote/invoice line is now matched to a product the showroom already carries, or a brand+product are auto-created from the vendor+description, linked to the showroom, and the line price recorded as a dated observation — surfaced in the viewport panel with a 'new from quote' / 'matched' badge. worker_email_invoice_line_items gains product_id (FK→products) (migration 0167; a brand_id column was dropped in 0168 on review — brand derives from products.brandId). The mapping service (map-invoice-products.ts) reuses the shared ensureProductFromExtraction (brand+item dedup) — no reimplementation — links via showroom_product_mappings (idempotent uniq), and records product_price_observations deduped on product+store+cents. It fires in the pipeline after line-item insert, which for Gmail-sourced mail is post-approval (0042 trust gate), so auto-creating catalog rows is human-gated. Guardrails: only quotes attributed to a store are mapped (no catalog fork from unattributed quotes); a prefix heuristic skips tax/delivery/labor/fee/total lines; best-effort per line; product display name JOINs from products (never denormalized).",
    date: "2026-08-02",
    status: "staged",
    prNumber: 337,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/337",
  },
  {
    branch: "claude/0042-showroom-quote-map",
    title: "Showroom pending-quote panel (0042 P4)",
    summary:
      "Extracted quotes/invoices now resolve to the showroom they came from and surface as a pending item inside that store's viewport, not only the global alerts feed. Adds worker_email_invoices.showroom_store_id (FK, migration 0166, additive); the email pipeline stamps it at extraction via the existing matchShowroomStore() (sender domain/name → store) on both the fresh and reprocess paths. GET /api/showroom-stores/:id/pending-quotes returns a store's draft quotes + line items; a PendingQuotesPanel atop the brands-products section shows vendor/total/lines with Confirm/Dismiss (reusing the worker-emails confirm/reject endpoints) and a Review & map link. The alerts aggregator's invoice_review rows now deep-link into the store viewport when the quote resolved to a showroom, else the global receipt-review queue. Nullable by design — an unresolved quote (e.g. a gmail.com sender) stays store-less and shows only in the global feed. Product match/auto-create is P5.",
    date: "2026-08-02",
    status: "staged",
    prNumber: 336,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/336",
  },
  {
    branch: "claude/showroom-360-tour-links-0fd2ac",
    title: "Showroom 360° tour — Photos bento + Street View auto-tour",
    summary:
      "Surfaces a showroom's 360° walkthrough in the Photos bento: the manual SHOWROOM_TOUR link renders as an embed/open card, and when absent a free Street View probe offers an auto-tour whose billable render is quota-gated + logged.",
    date: "2026-07-31",
    status: "staged",
    prNumber: 322,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/322",
  },
  {
    branch: "claude/showroom-inbox-filtering-0294ec",
    title: "Store Inbox + ingestion gating + full-width pages (0041)",
    summary:
      "Three connected workstreams. (1) Full-width viewport/data pages — the store/material/product/compare/showrooms-directory/products-browse islands were pinned to container mx-auto max-w-Nxl; dropped to w-full so they use the page. (2) A standalone full-page inbox at /admin/shopping/store/[id]/inbox (StoreInboxApp) auto-scoped to one showroom: Inbox/Receipts/Spam/Trash folders + counts, delete (soft→Trash), mark read/unread, a PlateJS reply that sends real multipart/alternative HTML, the AI-draft button fixed (was silently 500ing on a raw.response envelope mismatch — now reads choices[0].message.content), attachment cards + embedded-image gallery, a quoted-reply toggle, spam/receipt badges, and an MCP-reply hint; the viewport Inbox button now navigates here. (3) Deterministic (no-AI) ingestion gating: classifyMessage flags spam by phrase AND sender (rejuvenation@e.rejuvenation.com + e./email. bulk subdomains) with a stored rationale, tags receipt|invoice|quote + ($|attachment) (extraction already runs via the Path-B processEmail bridge), and trimQuotedReply collapses reply tails; HTML body is now captured. POST /backfill-classification re-classifies history (idempotent; flagged 28/62 on first run). Also carries buildShowroomMatchSpec — the showroom inbox matches its OWN domain domain-wide and contacts by exact address, fixing the earlier cross-company flood. Migration 0158 (additive): classification/is_spam/spam_rationale/deleted_at on gmail_messages + gmail_message_images.",
    date: "2026-07-30",
    status: "staged",
    prNumber: 310,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/310",
  },
  {
    branch: "claude/sales-clearance-page-b0c752",
    title: "Sales & Clearance · Phase A — sale_items schema + backfill (0038)",
    summary:
      "Foundation for the 0038 Sales & Clearance overhaul: promote clearance items from JSON blobs (showroom_store_sales.clearanceDetailsJson.items[]) to real, queryable rows. Migration 0148 adds sale_cycles, sale_items, sale_item_images, sale_item_colors, sale_watch, sale_scrape_runs, sale_research_clusters, weekly_sale_ad, plus showroom_stores.is_online_only and showroom_store_sales.page_markdown — all additive. Compliance baked in: prices text+cents, colors via the shared colors def + mapping (no comma-joined strings), category/subcategory FKs into the shared config vocab, rich text markdown+html. backfillSaleItems() explodes isCurrent snapshots into sale_items (single-row inserts batched under D1's 100-param cap; idempotent) via POST /api/showroom-sales/backfill. No reads wired yet — Phase B/E follow, and Phase E must reconcile with the 0037 shopping refactor. Bundle numbered 0038 to dodge ordinal collisions.",
    date: "2026-07-27",
    status: "staged",
    prNumber: 284,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/284",
  },
  {
    branch: "claude/api-auth-bearer",
    title: "Auth · accept the raw WORKER_API_KEY as a Bearer token (fix codra API tests)",
    summary:
      "The admin/API auth gate (isRequestAuthenticated) accepted ONLY the remodel_access cookie, whose value is SHA-256(WORKER_API_KEY) — so a server-to-server client that holds the raw key (the codra review bot, QC scripts) could not authenticate and every API test it ran against a PR's impacted endpoints failed with 401. The gate now also accepts the raw key via Authorization: Bearer <key> or an x-worker-api-key header (header channel ONLY), using a constant-time compare, alongside the existing hashed-cookie browser path. The cookie stays SHA-256-only — it never accepts the raw key, so a stolen cookie still can't yield the reusable secret (per the codra security review). One change to the shared gate covers both the SSR admin gate in _worker.ts and the requireAccessAuth API middleware. No schema, no migration.",
    date: "2026-07-27",
    status: "staged",
    prNumber: 285,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/285",
  },
  {
    branch: "claude/showrooms-grouped-table",
    title: "Showrooms · grouped-table rebuild (0037 Phase 2)",
    summary:
      "The Showrooms directory becomes a grouped, space-efficient table wired to live data. Region tabs (SF / South Bay / Peninsula / East Bay / North Bay / Central Valley / All) carry live counts and auto-select the nearest region by geolocation; a group-by switcher (Sales Category default / Rating / Flagship / Closing Time) buckets the active region, open stores first sorted by earliest close, closed stores folded into an expandable 'N closed now' banner. Cards ↔ Rows toggle; a detail modal with full weekly hours + Call / Website / Google Maps / Tesla Nav (POST /api/tesla/navigate) / View full details. The map view is preserved behind a Grouped/Map toggle. Reuses the existing fetch, ShowroomMergedCard, hours-status helpers and Manage/Add modals — no new data endpoints, no migration. Default tab map→grouped; retired list/directory deep-links redirect to grouped.",
    date: "2026-07-26",
    status: "staged",
    prNumber: 282,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/282",
  },
  {
    branch: "claude/shopping-sourcing-sidebar-41f368",
    title: "Shopping · nested collapsible sidebar + IA (0037 Phase 0)",
    summary:
      "Foundation for the 0037 Shopping & Sourcing refactor. The flat 15-item shopping sidebar (tiny text, no submenus, no collapse) becomes a nested, icon'd, collapsible tree. SidebarItem is now recursive (optional href/icon/children/navigateOnExpand); NavNode renders arbitrary-depth submenus that start collapsed and auto-expand the active branch's ancestors — a navigateOnExpand parent both navigates to its section landing and expands, while a separate chevron peeks in place. Per-section + per-item lucide icons; group-header text bumped 10px→xs. New collapse-to-rail: AdminSidebar toggles w-64 ↔ a w-14 icon rail (section icons + expand/home/config), persisted in a remodel_sidebar_collapsed cookie; BaseLayout seeds it server-side and drives the fixed aside AND the content padding off a single --sidebar-w CSS var, so the layout reflows with no SSR flash. The shopping group is re-authored into three submenus (Showrooms / Brands & Products / Purchase Ops → Review); net-new leaves (Review dashboard, Invoices, Deliveries, Concierge) join in later phases so the nav never 404s. No migration, no API — pure frontend. Bundle renamed 0032→0037 to dodge an ordinal collision with concurrent property_origin_config work.",
    date: "2026-07-26",
    status: "staged",
    prNumber: 277,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/277",
  },
  {
    branch: "claude/changelist-phases-live-updates-6cfa61",
    title: "Changelog · phase-grouped, live-updating preview tasks (websocket + poll)",
    summary:
      "The preview changelog (/admin/changelog/preview/<slug>) showed plan tasks as one flat, unreadable list that only refreshed on a full page reload. Tasks now group into collapsible phase sections (per-phase progress bar, PR chips, a 'pending PR' badge) and follow progress LIVE: the viewport polls every 10s and holds a websocket to the plan's room, so as an agent ticks a task's status or attaches a PR the user's open page updates with no refresh. New update_plan_task MCP tool + a shared updatePlanTask() service that fans a realtime poke out of the EstimateCollabHub DO; PATCH /api/admin/plans/tasks/:id gains prNumber/changelogSlug/progressPct and the in_review status (which was in the DB enum but missing from every read/write/render surface). No migration — plan_tasks.prNumber/changelogSlug already existed.",
    date: "2026-07-26",
    status: "staged",
    prNumber: 269,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/269",
  },
  {
    branch: "claude/drive-list-ops-b-notes-rating-skip",
    title: "Drives · schema foundation + drizzle meta repair + HTML-entity cleanup (0031 PR-B0)",
    summary:
      "Foundation for the 0031 drive-list ops overhaul, plus two standalone fixes. HTML-entity cleanup: createDriveList decodes entities (and slugifies the decoded title) so new MCP drives no longer store 'Wall &amp; Floor', and migration 0140 backfills existing rows (0 encoded titles remain). Schema: a drive_list_notes table (drive-global or per-stop, source, read_at) migrating the legacy notes JSON, and drive_list_stops kind/suggested/skipped columns. Cost-safety: enforceStreamWindow now proactively stops the Tesla stream DO at the 20:00 window boundary. Also repaired a forked drizzle meta chain (0137/0138 both off 0136; 0139 missing 0137's rooms columns) that was breaking db:generate repo-wide.",
    date: "2026-07-25",
    status: "staged",
    prNumber: 253,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/253",
  },
  {
    branch: "claude/drive-list-ui-improvements-b58ece",
    title: "Drives · render route map + tighten stop-card actions (PR-A quick fixes)",
    summary:
      "First slice of the drive-list UI overhaul. Fixes the blank route map (it fell back to an empty pin whenever a drive's stops had null lat/lng, even though they linked geocoded showrooms — GET /api/drive-lists/:slug now backfills each stop's missing coords from its linked showroom, 9/23 → 23/23 drives mappable). Also folds the Tesla control into the same rounded container as the address + Navigate bar at matched height, and enlarges the hours badge + turns the phone into a large tap-to-dial button for Tesla/phone touch targets. Larger phases (per-stop notes/ratings/skip, active-drive banner + start-time feasibility, showroom modal, proximity pitstops) follow as separate PRs.",
    date: "2026-07-25",
    status: "staged",
    prNumber: 244,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/244",
  },
  {
    branch: "claude/showroom-location-tagging-ex2ik5",
    title: "Brands · finish ops #4 dedup + durable name-key unique index",
    summary:
      "Merged the last live duplicate brand (Visual Comfort & Co. #221 → Visual Comfort #184) on remote D1, and added a PARTIAL unique index on a normalized name key (lower/trim + strip spaces/dots/commas, WHERE is_active=1) so a bulk import can no longer fork one brand across two rows. Partial scope is required — dedup soft-deletes losers, and 6 active/retired pairs share a name key, so a full index would refuse to create. Index lands on migrate:remote (migration 0138).",
    date: "2026-07-25",
    status: "staged",
    prNumber: 223,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/223",
  },
  {
    branch: "claude/showroom-listing-500-map-6kvtm9",
    title: "Showroom seed is bootstrap-only (stops re-run duplication)",
    summary:
      "seedShowroomStores inserted a fixed store list with no natural key, so a repeated POST /api/showroom-stores/seed cloned every row — production ended up with 213 stores instead of 146 ('Whole Wood' ×3). The seed now bails the moment any store exists, so it only ever populates an empty directory. Cleaning up the already-duplicated rows is a separate destructive step held for sign-off.",
    date: "2026-07-25",
    status: "staged",
  },
  {
    branch: "claude/backend-health-checks-d1-d6df78",
    title: "0029 · Health platform — every module declares its own checks",
    summary:
      "88 probes across 17 backend modules, each carrying its own runbook, catalogued in D1 and run as one session from /admin/system/health, the API or MCP. Includes 16 cost watchers and the data-quality checks from #169, bridged into the same ledger.",
    date: "2026-07-22",
    status: "staged",
    prNumber: 195,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/195",
  },
  {
    branch: "claude/agent-ops-monitoring-plan-957a42",
    title: "0026 · Agent Ops Transparency",
    summary:
      "Finished the agent_runs instrumentation, added /api/admin/agents, and shipped the four Agent Ops screens.",
    date: "2026-07-22",
    status: "shipped",
    prNumber: 193,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/193",
  },
  {
    branch: "claude/markdown-mermaid",
    title: "Render mermaid diagrams in markdown (not raw code)",
    summary:
      "The preview-changelog PRD — and every MarkdownProse surface — showed ```mermaid blocks as raw code instead of rendered diagrams. MarkdownProse now renders mermaid fences through the same client renderer the changelog detail page uses, so the diagram-dense plans the AGENTS.md rule mandates are actually readable.",
    date: "2026-07-21",
    status: "staged",
    prNumber: 187,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/187",
  },
  {
    branch: "claude/tesla-google-quota",
    title: "Per-API Google Maps quota hard-block",
    summary:
      "The Maps quota guard counted one combined total across every API (via two divergent guards, one with a ms-vs-seconds boundary bug). It now blocks PER API — an exhausted Places, Geocoding, or Routes SKU stops on its own while the others keep working — closes the untracked Places-Photo billing bypass, and adds gated reverseGeocode + placesNearby for the location tools.",
    date: "2026-07-21",
    status: "staged",
    prNumber: 185,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/185",
  },
  {
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    title: "0023 P6 · Location AI for the in-car assistant",
    summary:
      "The two MCP tools an in-car assistant needs: get_vehicle_location enriched with heading + compass, a quota-gated reverse-geocoded address, region, and freshness (serverTime/ageSeconds/isStale); and a new whats_near_me that ranks registered showrooms by distance + bearing and can sweep quota-gated Google Places for undiscovered nearby spots. Showroom coordinates read through one helper so the anticipated move off showroom_stores is a one-line change. (The DO circuit breaker that shipped earlier on this branch is PR #181.)",
    date: "2026-07-25",
    status: "staged",
    prNumber: 220,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/220",
  },
  {
    branch: "claude/receipt-review-hitl-4808",
    title: "Receipt Review — a HITL queue for the receipt→room deduction engine",
    summary:
      'The frontend for 0030: /admin/shopping/receipt-review groups staged room proposals by receipt, shows the engine\'s proposed room + confidence + reasoning per line item, and lets the owner swap any room from a dropdown of eligible candidates — plus an "Other room…" entry that opens a full-room modal for when the guess is way off. Confirming resolves each proposal against a roomId FK (never a name), minting the material. No schema or API change; reuses the resolve endpoints from #236.',
    date: "2026-07-25",
    status: "staged",
    prNumber: 246,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/246",
  },
  {
    branch: "claude/health-status-page",
    title: "Public /health page with an on-demand live health screen",
    summary:
      "A public /health page with a Run health checks button that actively probes the worker's core bindings (D1, the Tesla telemetry DB, KV, R2, Workers AI) on demand and renders per-service status + latency — not just a table read.",
    date: "2026-07-21",
    status: "staged",
    prNumber: 182,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/182",
  },
  {
    branch: "claude/drive-lists-activation-ui-6f6e47",
    title: "One active drive list, enforced by D1 — and drive tabs that match real life",
    summary:
      '"Active" was a value of the `status` enum, so six drive lists claimed it at once and the landing page\'s Active/Archived tabs bucketed on that same overloaded field. The single-slot pointer is now its own column (`is_active`) under a partial UNIQUE index, so D1 itself refuses a second active drive; the tabs bucket on what actually happened (Pending / In progress / Finished); and each card carries an Active badge plus a toggle.',
    date: "2026-07-21",
    status: "staged",
    prNumber: 178,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/178",
  },
  {
    branch: "claude/showroom-soft-delete",
    title: "Showroom soft delete — and the 34 read paths that had to learn about it",
    summary:
      "Deleting a showroom used to destroy the row and cascade its notes, photos, ratings and price history. It now flips is_active to 0 and can be restored. The column is the easy half: every query that lists or searches showrooms — directory, map, catalog, drives, field scan, backfill, MCP tools, the clearance cron, gap analysis — was audited and filtered.",
    date: "2026-07-18",
    status: "staged",
    prNumber: 154,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/154",
  },
  {
    branch: "claude/showroom-touch-ux",
    title: "Showroom viewport, usable from a Tesla touchscreen",
    summary:
      "Every control on the showroom page was sized for a mouse: small buttons, smaller hyperlinks, cramped modals. The hero's link row becomes large tap targets (website + one icon per registered link type), the hours card gets a full-width four-state badge, and the hours / links / upload / categories modals all move to ~80% of the viewport with Call, Copy address, and Send-to-Tesla as big buttons at the top.",
    date: "2026-07-18",
    status: "staged",
  },
  {
    branch: "claude/feature-proposals-api-tools-ea0c5c",
    title: "Feature proposals — carry the conversation, not a summary of it",
    summary:
      "An idea worked out with a non-coding AI chat can now be filed as a proposal that travels with the RAW transcript of the conversation behind it, so a coding agent picking it up weeks later inherits the rejected alternatives and the mid-discussion constraints instead of rebuilding a lossy plan from a summary. API + MCP tools + CLI parity, all on one shared service; the transcript lives in R2, never D1.",
    date: "2026-07-18",
    status: "staged",
    prNumber: 152,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/152",
  },
  {
    branch: "claude/changelog-preview",
    title: "Changelog preview — the presser, drafted in advance",
    summary:
      "The changelog list + viewport now render through the four beste blocks they were always meant to use, and gain a /preview twin: every proposed change, reviewable on the deployed worker before it lands. Diagrams render with the shadcn-registry mermaid (zoom/pan).",
    date: "2026-07-16",
    status: "staged",
  },
  {
    branch: "claude/showroom-stores-cleanup-775bb5",
    title: "Showroom stores cleanup (Phases 1–6) + persistent changelog",
    summary:
      "Untangled the overgrown showroom_stores table into normalized child tables and a single-payload write model — hours, address, links, contacts + business-card vision, and email auto-population. One additive migration (0108); the legacy flat columns are retained as deprecated so the one-time backfill can read them, and are dropped in a follow-up migration once that backfill is confirmed on prod.",
    date: "2026-07-14",
    status: "staged",
    prNumber: 128,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/128",
  },
  {
    branch: "claude/email-structured-extraction",
    title: "Structured email extraction (fix the phantom 'total not stated')",
    summary:
      "Inbound-email classification now uses a native Gemini responseSchema instead of a prompt-embedded schema, so receipts/invoices extract every printed field and the model stops hallucinating 'the total is not stated — check your payment method' on receipts whose total is printed.",
    date: "2026-07-14",
    status: "staged",
    prNumber: 129,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/129",
  },
  {
    branch: "claude/worker-inbox-hitl-v2",
    title: "Persistent append-only changelog",
    summary:
      "A durable, D1-backed changelog that accumulates across every branch/PR and is never overwritten by a static file — with a full detail page per entry and an agent-facing standard for keeping it current.",
    date: "2026-07-14",
    status: "staged",
    prNumber: 127,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/127",
  },
];

/** Entries, newest first within a branch. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "budget-command-center",
    branch: "orca/budget-ux-overhaul",
    date: "2026-09-03",
    area: "Budget",
    title: "Budget & Procurement Command Center",
    summary:
      "/admin/budget is now one tabbed workbench — Grid, Inbox, Estimates, Rooms, Savings, Compliance — behind a KPI header that loads in a single D1 round trip. Every tab is backed by a real endpoint; nothing on the page reads a database directly.",
    changes: [
      {
        kind: "added",
        text: "GET /api/budget/workbench-summary fills the entire shell header in ONE D1 round trip — a db.batch of 12 independent SELECTs covering the four KPI cards and all six tab counts. runwayMonths is null, never Infinity, when trailing burn is zero. The inbox tab badge reuses the inbox route's own query builders, so the count cannot drift from what the tab actually shows.",
      },
      {
        kind: "changed",
        text: "GET /api/budget/inbox now ranks in SQL. A UNION ALL over three sources — over-budget rooms, unmapped estimate lines on the latest revision, and failing or warning compliance gates joined to their contract's vendor — ordered by financial exposure descending with a LIMIT. It previously pulled rows and sorted them in JavaScript, which is the shape that quietly burns D1 row reads as the table grows.",
      },
      {
        kind: "changed",
        text: "GET /api/budget/rooms-finance is one grouped query: rooms LEFT JOINed to three aggregated subqueries (committed, spent, open materials), batched with three totals queries computed from the source tables rather than summed from the per-room rows — so an item mapped to several rooms, or a portfolio-level expense, cannot be double-counted. No per-room follow-up query anywhere.",
      },
      {
        kind: "changed",
        text: "GET /api/budget/grid returns the time-phased contract shape: month columns, per-cell planned/actual/editable, row totals and variance, phase subtotals, and a footer with available budget and net burn. The monthly rollup is a FLAT grouped query pivoted in the Worker, not a conditional-SUM pivot in SQL — the pivot scans exactly the same rows either way, so it buys no row reads and only buys dynamic SQL that breaks whenever the month range changes. The pivot lives in budget-grid-math.ts behind an assert-based self-check.",
      },
      {
        kind: "added",
        text: "PATCH /api/budget/plan-schedule accepts a single planned cell ({lineItemId, month, plannedCents}) alongside the existing bulk shape, so the already-shipped BudgetGridApp caller keeps working. plannedCents: null deletes the row rather than writing null into a NOT NULL column.",
      },
      {
        kind: "added",
        text: "budget-reconciliation router: a keyset-paginated queue of unmapped estimate lines with their RANKED candidate rooms, each carrying its elimination reasoning as {markdown, html}. The screen presents an argument, not a guess — nothing is written to estimate_line_items.room_id without an explicit human confirm, and there is deliberately no auto-confirm path for a high-confidence candidate.",
      },
      {
        kind: "added",
        text: "budget-reallocations router: the savings and reallocation ledger, keyset-paginated in SQL on (occurred_at DESC, id DESC), plus a contingency balance. Contingency is an ordinary funding account (accountKey contingency_reserve), not a special null state — the first modelling attempt reserved null/null for it and so could not represent the design's own first ledger row, 'Contingency to Primary Bath'. Balance is opening + inflows - outflows, all summed in SQL, and pctRemaining is 0 rather than NaN when nothing is allotted.",
      },
      {
        kind: "added",
        text: "budget-compliance router: every contract joined to its payment gates in one db.batch, with the block/warn/ok rollup computed in SQL. California's CSLB down-payment cap — the lesser of $1,000 or 10% of the contract price, Bus. & Prof. Code section 7159.5 — is evaluated server-side in integer cents and unit-checked; the frontend renders the verdict and never re-derives the rule. A contract with no recorded down payment reads 'na', never 'pass': an unknown is not a pass on a compliance surface, and an omitted gate row would read as all-clear.",
      },
      {
        kind: "added",
        text: "GET /api/budget-tracker/financial-accounts, returning the accounts and their SUM computed in SQL as the authoritative total budget.",
      },
      {
        kind: "fixed",
        text: "PUT /api/budget-tracker/financial-accounts issued one D1 round trip per account in an await loop, and silently `continue`d past any entry missing a key or amount — reporting success while writing nothing. It now builds the statements into an array, chunks at 20 rows for D1's 100 bound-parameter cap, and sends one db.batch; malformed input 400s naming the bad entry instead of vanishing.",
      },
      {
        kind: "fixed",
        text: "A logged expense saved with no date while looking saved. parseTimestamp early-returned null for anything that was not a string, so the numeric dateIncurred the contract specifies was dropped server-side and the insert succeeded with date_incurred unset. It now accepts Unix seconds, milliseconds (detected by magnitude, so an accidental Date.now() is not read as the year 56000), an all-digit string, or a date string — with a self-check covering each.",
      },
      {
        kind: "added",
        text: "src/frontend/lib/budget-api.ts — one typed client for all fifteen endpoints, with an AbortController per query so switching tabs cancels in-flight requests, a single BudgetApiError carrying HTTP status and the server's message, and one formatCents the whole surface formats money through. Zero SQL in any frontend file; a .tsx that talks to a database is a defect in this repo.",
      },
      {
        kind: "added",
        text: "Six tab components plus the workbench shell and the log-expense dialog. Tab state lives in the URL query string so tabs deep-link and the back button works; only the active tab mounts. Every money input is <CurrencyInput>, every select renders labels and submits ids, and gate and risk states are conveyed by text and icon rather than colour alone.",
      },
      {
        kind: "changed",
        text: "/admin/budget/grid and /admin/budget/inbox now redirect into the workbench. Their islands read the pre-rebuild response shapes for /api/budget/grid, /inbox and /rooms-finance, and those shapes cannot coexist with the new contract on the same endpoints. The island files are left on disk so nothing is lost; a follow-up removes them.",
      },
      {
        kind: "migration",
        text: "0184 adds estimate_line_room_candidates (ranked room candidates with reasoning), budget_reallocation_ledger, and contract_compliance_gates, plus license_expires_at on estimate_companies, along with seven covering indexes (two unique) on those new tables. 0185 adds eleven more covering indexes for the WHERE / JOIN ON / ORDER BY columns the new queries hit on pre-existing tables (estimate_line_items, contracts, budget_expense_entries, budget_tracker_item_rooms, budget_tracker_items, budget_reallocation_ledger, budget_phases, budget_plan_schedule). 0186 adds two more indexes (contract_compliance_gates.state, and an is_active+date_incurred index on budget_expense_entries) that a later query needed. All three are purely additive — three CREATE TABLE, one ADD COLUMN, twenty CREATE INDEX/UNIQUE INDEX statements total — with no drops and no table rebuilds, so no data was at risk.",
      },
    ],
    migrations: ["0184_talented_wendell_vaughn", "0185_magical_rage", "0186_acoustic_rictor"],
    status: "staged",
    prNumber: 412,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/412",
  },
  {
    id: "health-probe-truth-and-spend-breaker",
    branch: "worktree-bridge-cse_016Rp7EJTqbFmvTpUX2cUvWw",
    date: "2026-08-12",
    area: "System health",
    title: "Health probe truth, abandoned-run sweep, and a KV spend circuit breaker",
    summary:
      "Two of the five failing health probes were measuring the wrong thing and had latched red permanently, hiding the three real failures behind them. Fixed the classification, fixed the root cause that produced the stale data, and closed the loop from observing spend to declining it. Prod failures go 5 → 3, and the 3 that remain are real.",
    changes: [
      {
        kind: "fixed",
        text: "False alarm — email pipeline. The liveness probe counted worker_emails.status='pending' without excluding ai_status='pending_approval', which is the 0042 AI trust gate's deliberate parked state (pipeline.ts returns early on deferAiUntilApproval for Gmail-sourced mail). Verified on prod: 22 of 26 pending rows were parked, waiting on a human, not stuck. Parked mail is now reported separately as 'awaiting your approval' instead of counted as a broken pipeline. The FAILURE ratio's denominator excludes parked rows too — leaving it in silently diluted the signal, so 90 parked messages plus 10 genuinely stuck ones scored 10% and read healthy.",
      },
      {
        kind: "fixed",
        text: "False alarm — Durable Object runaway watcher. It counted running/queued rows of ANY age as evidence a DO was awake and billing, so a single crash pinned the probe to FAILURE for ever and every subsequent real runaway would have been hidden behind the stale alarm. The 31 rows on prod were 6-16 days old and the probe's own message read 'Last hour started=0'. Stuck runs are now split by age; only runs younger than 24h can raise a billing FAILURE, because only a recent one can still be spending. Older residue is reported, never hidden.",
      },
      {
        kind: "added",
        text: "sweepAbandonedRuns — the root cause of the above. A run row is opened by startRun and closed by the caller, so an isolate that dies mid-run (Worker exceeded memory limit, an evicted Workflow step) leaves it 'running' for ever. pruneAgentRuns refuses to delete those by design, but 'keep it visible' had been implemented as 'keep it indistinguishable from a live run'. The sweep marks them failed with error_code='ABANDONED' on the daily cron — exactly what the probe's own devOpsPlaybook prescribes, so it needs no migration, no enum change, and inherits the 90-day failed-run retention.",
      },
      {
        kind: "added",
        text: "Durable Object spend is measured for the first time. DURABLE_OBJECT has been a declared metered provider since the metering system shipped, but nothing anywhere wrote a DURABLE_OBJECT usage row — getCycleSpend summed to $0 for ever, so its ceiling could never trip. A budget over an unmeasured number is decoration. startRun's close now prices the run's wall-clock, covering every Agent, DO and Workflow through one writer instead of 26 classes. Verified live on the preview: spend went $0 → $0.000044925 after one real agent run. Scope is stated honestly in the code: this catches a runaway in agent run VOLUME or DURATION, and would NOT have caught the #162 incident, which was 537 billion DO row reads (~$512) and is covered by the separate kill-switch in services/safety/do-circuit-breaker.ts.",
      },
      {
        kind: "added",
        text: "The AI choke point is now metered. generateStructuredOutput (15 callers) spent on BOTH the Workers AI path and the Gemini fallback with no ceiling check and no usage row. It now asserts the breaker before spending and records both the success and the failed-primary outcomes, so a retry storm on the Workers AI path is visible in the ledger instead of looking like Gemini cost.",
      },
      {
        kind: "added",
        text: "KV read-through cache for the circuit breaker (breaker-cache.ts). canSpend's uncached path is two D1 queries, one a SUM over an append-only table — too expensive to sit in front of every AI call, which is exactly where a brake has to be to matter. D1 stays authoritative for both config and spend; KV caches only the DECISION. Nothing is incremented in KV: Workers KV has no atomic increment, and a lost increment under-reports spend, the one direction a spend guard must never err in. TTL is asymmetric (allow 30s, deny 300s) because a stale allow costs money and a stale deny does not. A KV miss or error falls through to D1 rather than deciding policy, read_error is never cached, and every config write invalidates the cache so break-glass controls bite immediately.",
      },
      {
        kind: "fixed",
        text: "Budget stops no longer masquerade as empty results. pascal/ai-edit.ts caught everything and returned a structurally valid EditPlan with zero ops, which the caller reads as success — right for a model failure, wrong for 'you are over your ceiling'. SpendBlockedError now propagates. The three brand batch loops likewise abort instead of grinding the whole 900-brand list logging the same refusal per batch and reporting it as 'skipped'.",
      },
      {
        kind: "changed",
        text: "Durable Object budget enforcement sits in dispatchDueWorkflows, not startRun. startRun is contractually non-throwing — it records work, it does not authorize it — and making it throw would surface a budget stop as a random exception in 26 unrelated agent classes. Declining at dispatch skips the tick and leaves the schedule untouched, so the job simply runs once the budget resets.",
      },
      {
        kind: "changed",
        text: "AGENTS.md: deleting a preview worker is now part of merging a PR, not a later chore, and deploy:preview sweeps orphans automatically. Also documented the rebuilt local agent tooling and its two traps (health is a config check, not an auth check; the starter orchestrator.toml caps claude at 8 turns).",
      },
    ],
    migrations: [],
    // PR number lives on the BRANCHES row (ChangelogEntry has no prNumber field).
    status: "staged",
  },
  {
    id: "budget-workbench-reconciliation-p3",
    branch: "claude/budget-workbench-p3",
    date: "2026-08-12",
    tag: "0035 P3",
    area: "Budget",
    title: "Estimate-line reconciliation HITL (workbench Phase 3)",
    summary:
      "Maps individual estimate line items to rooms with an AI-staged, human-confirmed loop — the first BudgetWorkbench phase. estimate_line_items gains room_id (FK), budget_item_track_id (TEXT no-FK), mapping_status, and ai_suggested_room_id/category + mapping_confidence (migration 0183). POST /ai-suggest calls generateStructured, feeds the model the real room id:name list, validates every returned roomId against live rooms (drops hallucinations), stages the guess and NEVER writes roomId. PATCH /reconcile is the only roomId write (validates the room exists, auto-confirms). A /admin/budget/reconcile HITL page shows the queue with the AI's ranked candidates + confidence + reasoning, a RoomSelect override, and Confirm/Reject; MCP list_reconciliation_queue + reconcile_estimate_line give chat the same confirm path. Built with the local-ai-orchestrator (claude) doing edits under per-diff review + an adversarial review pass (7/7 checks clean, 1 minor summary fix). QC 9/9 preview.",
    changes: [
      {
        kind: "migration",
        text: "0183 (additive): estimate_line_items += room_id (FK rooms set null), budget_item_track_id (TEXT no-FK), mapping_status (default unmapped), ai_suggested_room_id/category, mapping_confidence. Applied + verified on remote.",
      },
      {
        kind: "added",
        text: "POST /api/estimates/line-items/:id/ai-suggest — structured-output room suggestion; validates AI roomIds against live rooms; stages ai_suggested_*, never writes roomId; no {} degrade.",
      },
      {
        kind: "added",
        text: "PATCH /api/estimates/line-items/:id/reconcile (the only roomId write; validates room exists; auto-confirms) + GET /api/estimates/reconcile/queue.",
      },
      {
        kind: "added",
        text: "/admin/budget/reconcile HITL UI — queue + AI candidates (confidence + reasoning) + RoomSelect + Confirm/Reject.",
      },
      {
        kind: "added",
        text: "MCP list_reconciliation_queue (READ) + reconcile_estimate_line (WRITE) — same confirm write as the UI.",
      },
    ],
    migrations: ["0183"],
    status: "staged",
  },
  {
    id: "budget-grid-usability",
    branch: "claude/budget-grid-followups",
    date: "2026-08-12",
    tag: "0035 follow-up",
    area: "Budget",
    title: "Budget grid usability — phase assignment + funding config",
    summary:
      "The shipped grid launched degenerate: every line was Unphased and Total Budget was $0 with no UI to change either. This adds a compact per-line phase-select (PATCH /api/budget-tracker/items/{id} {phaseId} → refetch, line moves into its phase group) and a 'Set budget' funding editor on the Total-budget scorecard (loads /financial-status, edits label + amount per account, saves via PUT /financial-accounts). It also fixes a load-bearing correctness bug: the budget-item PATCH revision insert dropped phaseId and the variance note, so ANY edit silently wiped a line's phase — phaseId + variance md/html are now carried forward across revisions (undefined=keep, null=unassign). QC 11/11 preview; phase-assign persistence + carry-forward verified by round-trip.",
    changes: [
      {
        kind: "added",
        text: "Per-line phase assignment on the grid: ghost phase-select → PATCH /api/budget-tracker/items/{id} {phaseId} → refetch; options from GET /api/config/budget-phases.",
      },
      {
        kind: "added",
        text: "Funding config: 'Set budget' dialog on the Total-budget scorecard (GET /financial-status load, PUT /financial-accounts save, add/remove rows, CurrencyInput, empty-state hint).",
      },
      {
        kind: "fixed",
        text: "budget-item PATCH now carries phaseId + variance-note md/html across revisions (added phaseId to BudgetTrackerPatch) — previously any edit wiped the phase assignment.",
      },
    ],
    status: "staged",
  },
  {
    id: "vendor-email-context-layer",
    branch: "feat/vendor-email-context-layer",
    date: "2026-08-11",
    area: "Email",
    title: "Vendor-email context layer — instructions doc + recipient resolution",
    summary:
      "The context layer a vendor email is composed from, with no send path (that stays on google-workspace-mcp): a single reusable instructions doc, an explicit resolve-or-fail recipient lookup against showroom store contacts, and a compose tool that assembles a send-ready payload from both plus Drive attachments. Every ambiguity — an unmatched store, a store with two contacts, a malformed address — returns a structured ok:false with candidates rather than guessing.",
    changes: [
      {
        kind: "migration",
        text: "0181_new_sunset_bain: email_instructions (id, instructions_markdown, instructions_html, updated_at) — single active row (id=1). Additive; applied and verified on remote D1.",
      },
      {
        kind: "added",
        text: "GET/PUT /api/email/instructions (admin-gated via requireAccessAuth on /api/email/*) and the get_email_instructions / update_email_instructions MCP tools. PUT sanitizes html with the repo's sanitizeNoteHtml on every write — raw html is never stored.",
      },
      {
        kind: "added",
        text: "GET /api/email/resolve-recipient?email=|store=&contact= and the resolve_recipient MCP tool. An explicit email is validated and passed through; a store reference matches by id or name substring against showroom_store_contacts. Always returns 200 — ok:false is a valid resolved result (reason: no_match | ambiguous | invalid), not an HTTP error.",
      },
      {
        kind: "added",
        text: "compose_vendor_email MCP tool (read-only): resolves the recipient, loads the instructions doc, loads the requested Drive documents (chunked at 20 ids for D1's 100-bound-param cap) and suggests attach vs link per file via suggestDispositions against an 18 MiB running budget (Gmail's 25 MiB cap minus base64 inflation). Assembles a payload only — sends nothing, changes no Drive sharing.",
      },
      {
        kind: "added",
        text: "/admin/email/instructions — admin editor page (EmailInstructionsEditor) for the boilerplate doc, following the PlateJS rich-text pattern (markdown + html) used elsewhere in the repo.",
      },
    ],
    migrations: ["0181_new_sunset_bain"],
    status: "staged",
    prNumber: 379,
  },
  {
    id: "drive-ingestion-review-followups",
    branch: "fix/drive-ingestion-review-followups",
    date: "2026-08-10",
    area: "Drive",
    title: "Drive ingestion — three review findings fixed",
    summary:
      "An independent reviewer (Cursor, gpt-5.6-sol-high) over merged PR #374 found three real defects the build's own reviews missed — two are interactions BETWEEN fixes, which a diff-scoped review structurally cannot see. Fixed the scan-lease ownership check, the compensating write that the new unique index had silently disabled, and the missing sharing-change detection. No migration.",
    changes: [
      {
        kind: "fixed",
        text: "Critical — scan lease released unconditionally. A scan that ran past the 30-min staleness window and had its lease legitimately stolen would clear the THIEF's newer lease on exit, letting a third scan run concurrently. acquireScanLease now returns the lease token (the scanStartedAt it wrote, read back to match D1's second granularity) and release is conditional on eq(scanStartedAt, token).",
      },
      {
        kind: "fixed",
        text: "Critical — the supersede compensating write could not run. The partial UNIQUE (root_id, drive_id) WHERE is_active=1 index, added in the SAME fix wave as the compensation, rejects a reactivation once the replacement row is active — so a transient failure of the supersededById link threw out of the catch and aborted the whole scan. Insert-failure (reactivate, safe) and link-failure (leave it, replacement is live) are now handled apart, on both the document and folder supersede paths.",
      },
      {
        kind: "fixed",
        text: "Important — sharing changes were invisible. The diff compared name, parent and content hash but not sharing, so a Drive permission change with no rename/move/edit was classified unchanged and D1 kept the stale value for ever. That value gates whether a Drive link can be emailed to an outside vendor. A new metadata-update action updates the row IN PLACE (no bogus revision, no re-embed) for both documents and folders; a metadataUpdated counter surfaces it in the ingest summary.",
      },
      {
        kind: "changed",
        text: "GET /api/admin/drive/documents is now paginated (limit default 200, max 500; offset) instead of an unbounded read.",
      },
    ],
    status: "staged",
    prNumber: 377,
  },
  {
    id: "showroom-stores-normalization",
    branch: "claude/database-schema-audit-cleanup-271ac6",
    date: "2026-08-09",
    area: "Showroom",
    title: "Showroom stores normalization — audit + zero-loss migration plan",
    summary:
      "PLAN ONLY, no schema shipped. A 6-agent audit measured against live prod: location data is already 100% mirrored into showroom_store_locations (233/233 stores; the 16 flat columns are redundant copies), contacts are barely migrated (0 GENERAL_CONTACT; 72 pocs + 5 flat main_poc pending), and no column can drop until intake writes child rows and ~35 placeId + all geo/drive readers move to JOINs (a dropped column is a silent undefined, not a compile error). Documents the staged expand→contract migration and the intake-normalization + 50-mile sibling-discovery feature (mapped onto our real stack, correcting the Gemini snippet).",
    changes: [
      {
        kind: "added",
        text: "docs/plans/2026-08-09-showroom-stores-normalization.md — the full plan: hard-fact table (233 active; place_id 184, address 207, lat+long 184, phone 219, email 39, main_poc 5; contacts 12/0 GENERAL_CONTACT), 16-column destination map, 5-phase expand→contract sequence with exact API + frontend filepaths, open decisions, and D1 cautions.",
      },
      {
        kind: "added",
        text: "Live prod query exports on disk under docs/plans/2026-08-09-showroom-stores-normalization/data/ (showroom-stores-list, incomplete, showroom-contacts, from-pocs dry-run, computed summary) — the receipts behind every number.",
      },
      {
        kind: "added",
        text: "Intake-normalization + sibling-discovery change-list preview: force Title/Camel Case on store name (new display normalizer, distinct from normName); root-domain dedup via normHost → attach a location under the existing parent instead of a new store; 50-mile Google Places sibling discovery gated by a website-host signal, each sibling an additional showroom_store_locations row (NO isSibling column — isPrimary is derived per #375).",
      },
      {
        kind: "changed",
        text: "Corrected the Gemini reference snippet against this repo: no new UUID-PK tables, no isSibling flag, no OpenAI-via-AI-Gateway path (repo uses Gemini-direct + JSON-schema output and existing review enrichment), extend showroom-bulk-intake-workflow.ts rather than a new ShowroomIntakeWorkflow, and pnpm run db:generate + migrate:remote rather than migrate:db.",
      },
      {
        kind: "added",
        text: "NEW requirement folded in (Phase L): site-specific content re-parents from the store to a showroom_store_location. 8 tables (visit_log, photos_mapping, ratings, contacts, images, notes, product photos/prices, store_rating) gain a nullable location_id; 5 stay brand-level (sitemap, browser_run_pages, photo_buckets, scan_log). Before/after ERD (red=removed/green=added): https://claude.ai/code/artifact/730c49ed-2dc0-42fc-a402-69fc003c3ac8",
      },
      {
        kind: "added",
        text: "Full deliverables added to the plan: exhaustive API-layer walkthrough (companion doc, every endpoint current→new + file:line + phase + breaking? + frontend consumer), frontend walkthrough (directory one-marker-per-location, viewport per-site source badges, uploads/scrape/contacts/notes retargeted to a location picker), 8-dimension agentic review plan, 34-check behavioral smoke plan, and 12 success criteria. Caught a today-broken endpoint: meta/place-exists reads flat placeId only, misses location-only place_ids.",
      },
      {
        kind: "added",
        text: "Full prod DB archive as a restore point (git-ignored, not committed): db-archive/full-dump-20260810.sql (57MB, whole DB via wrangler d1 export) + json/ (25 showroom-cluster tables). Row baselines: 244 stores, 248 locations, 12 contacts vs 72 pocs, 242 images, 479 photo mappings.",
      },
      {
        kind: "changed",
        text: "SHIPPED (data): showroom category vocab cleaned on prod — 70 messy categories → 28 canonical (adopted Gemini's set + AI-optimized descriptions). Renamed survivors, remapped mappings (UPDATE OR IGNORE + dedup), soft-deactivated the 42 dupes (is_active=0, NOT hard-deleted — repo rule; backup in db-archive/category-backup-20260812/). Mappings 225→177 (48 dupes removed).",
      },
      {
        kind: "migration",
        text: "0177_true_deadpool: showroom_store_category.ui_group TEXT NOT NULL DEFAULT 'General' — flat parent grouping for the Edit-categories modal (no recursive parent_id FK). Applied to remote. The 28 categories bucketed into 7 groups (Surfaces & Finishes, Kitchen & Bath, Structural & Openings, Systems & Tech, Outdoor & Exterior, Specialty & Decor, General).",
      },
      {
        kind: "changed",
        text: "Edit-categories modal (CategoryChipsEditor.tsx): the flat 28-checkbox grid now renders grouped by ui_group with section headers in a fixed order, a two-column masonry per group, and a filled highlight on checked rows. Pre-check of applied categories + replace-all save (uncheck removes) were already correct; kept. AI classifier constraint (cap 1–3 + explicit primary) is the next slice.",
      },
    ],
    migrations: ["0177_true_deadpool"],
    status: "staged",
  },
  {
    id: "jules-clearance-extraction",
    branch: "feat/jules-clearance-extraction",
    date: "2026-08-11",
    area: "Shopping",
    title: "Jules-powered clearance extraction + plain-fetch link discovery (0038 Phase B/C)",
    summary:
      "The weekly clearance sweep now uses a repoless Google Jules session as the primary extractor via a native-alarm Durable Object, with Workers-AI (kimi-k2.7-code with thinking disabled, off the broken kimi-k2.6) as the fallback. Job state is in KV, not DO SQLite; the DO goes dormant when done. Also adds plain-fetch sitemap/homepage discovery that registers clearance links across all stores, closing the coverage gap where only 6 of 233 were tracked.",
    changes: [
      {
        kind: "added",
        text: "JulesClearanceAgent Durable Object (DO migration tag v18, native ctx.storage.setAlarm only) — creates a repoless Jules session, polls until the VM is ready (approving a generated plan if one appears), then scrapes + change-detects + batches pages to Jules and persists one snapshot per changed link. Bounded per alarm fire; job document (session id, link queue, results) stored in AGENT_ADHOC_MEMORY_KV, never DO SQLite, per cost directive.",
      },
      {
        kind: "added",
        text: "Jules REST client (services/jules/client.ts) — a thin fetch wrapper over https://jules.googleapis.com/v1alpha (X-Goog-Api-Key auth): createRepolessSession, getSession, sendMessage, approvePlan, listActivities, latestAgentReplyAfter. We do NOT import @google/jules-sdk at runtime: its single ESM bundle statically imports node:fs/os/readline, which Cloudflare nodejs_compat does not polyfill, so it fails to load on Workers (the liteparse trap). The SDK stays a devDependency for types.",
      },
      {
        kind: "added",
        text: "Batch instruction contract (services/jules/clearance-prompts.ts) — a system prompt pinning a linkId-keyed JSON envelope mirroring ClearanceDetails, a per-batch message builder, and a defensive parser (first-brace to last-brace slice) that returns null (never {}) on garbage so the caller falls back instead of blanking a snapshot.",
      },
      {
        kind: "changed",
        text: "Weekly cron (30 13 * * 1) and POST /api/showroom-sales/sweep now route through startClearanceSweep → the Jules DO; the old synchronous Workers-AI sweep is the fallback (also reachable via ?inline=1). New GET /api/showroom-sales/sweep/status?jobId= reads a DO job's progress. Fixed the cron comment: Cloudflare day-of-week is 1=Sunday, so it fires Sunday, not Monday (matching the observed run history).",
      },
      {
        kind: "fixed",
        text: "Fallback clearance extraction model moved from the broken @cf/moonshotai/kimi-k2.6 to @cf/moonshotai/kimi-k2.7-code (262k context, more reliable JSON-schema structured output than gpt-oss-120b). k2.6 returned empty content for structured output (documented in ai/health.ts), which is why 10 of 14 current snapshots had items: [] despite live sales. k2.7-code exposes a configurable thinking mode; the extraction call pins thinking: false so the answer lands in content rather than a reasoning field, which is exactly the trap k2.6 fell into.",
      },
      {
        kind: "changed",
        text: "sales.ts refactored into reusable helpers (scrapeClearanceMarkdown, computeClearanceHash, isClearanceUnchanged, persistSaleSnapshot, collectClearanceLinks, touchClearanceLink, exported extractClearance) so the Jules DO and the Workers-AI sweep share one snapshot-persistence + change-detection path. No behaviour change to the fallback sweep beyond the model swap.",
      },
      {
        kind: "added",
        text: "Clearance-link DISCOVERY (services/showroom/clearance-discovery.ts) — closes the coverage gap where only 6 of 233 stores had a clearance link because discovery was passive. Plain worker fetch (NOT Browser Rendering) of each active store's sitemap.xml (robots.txt Sitemap: lines + conventional guesses, following a sitemap index one level, gunzipping .gz), falling back to fetching the homepage and scanning its <a href> links when a site has no sitemap. Classifies every URL with the shared classifySiteLink (own-domain, matches clearance/sale/outlet/closeout/last-chance, vetoes bot-challenge junk), keeps shallow landing pages (≤2 path segments, not deep product URLs), dedupes against existing links, and registers new WEBSITE_CLEARANCE links. Bounded concurrency 8, idempotent, safe to run weekly.",
      },
      {
        kind: "changed",
        text: "The weekly cron now runs discovery FIRST, then the sweep, so newly-found clearance pages are covered the same run. New POST /api/showroom-sales/discover runs it on demand; POST /sweep stays fast by default (discovery opt-in via ?discover=1).",
      },
      {
        kind: "fixed",
        text: "Spend safety: plugged the clearance sweep's Workers-AI calls into the existing AI-spend circuit breaker (services/usage/metering). The fallback extraction and the snapshot embedding now go through meteredAiRun — which checks the WORKERS_AI ceiling before the call (a tripped breaker throws → extraction returns null → the page is skipped with no spend, embedding is best-effort and skipped) and records usage after. Browser Rendering was already gated inside scrapeUrl (assertCanSpend + recordBrowserRun), so both the per-page scrape and the AI extraction are now under the breaker. Jules itself is an external subscription, not a metered provider — it's bounded instead by the DO's lifetime ceiling and session teardown.",
      },
      {
        kind: "changed",
        text: "Follow-up (0176_wistful migration): gave Jules more time — the per-batch reply budget is now 8 min (was 2.7) and the job lifetime 60 min, after a live run showed Jules doesn't answer inside a few minutes and was losing to the Workers-AI fallback every time. Plus a new jules_clearance_sessions D1 table recording each sweep's session_uuid (crypto.randomUUID), the Jules API session id, timestamps and the final outcome — so a billed Jules run is auditable from D1, not just the DO's ephemeral KV.",
      },
      {
        kind: "fixed",
        text: "Live-run fix (found by QC --sweep against prod right after deploy): the DO went dormant stuck in 'booting' — a fire hard-terminated by the runtime mid-scrape skipped its re-arm, and a hard kill isn't a catchable JS throw so the outer try/catch never re-armed either. Added a liveness guard: every alarm fire re-arms a 90s safety alarm BEFORE any heavy work, which every normal path overwrites with a tighter cadence; only a killed handler lets it survive, so the DO always wakes again. Plus phase logging and a persisted 'running' state before the scrape.",
      },
      {
        kind: "fixed",
        text: "Hardening from an independent code review (local reviewer, codra offline): (1) the Jules reply was detected by comparing the Worker's Date.now() against Jules's server createTime — a cross-clock compare that under skew silently filtered the real reply out and fell back forever; now baselined on Jules's own timeline before the send. (2) The 24s in-alarm reply poll would time out before a Jules VM (which answers in minutes) ever replied, so Jules was primary in name only while still paying for the VM — the reply wait is now ALARM-DRIVEN (send → persist pending → read on a later fire, ~2.7 min budget, then per-page fallback). (3) The Jules session was never torn down — now archived in finish and on the lifetime→fallback flip so a booted VM is never leaked. (4) Concurrent kickoffs on the singleton DO clobbered a running job and leaked its session — /start now returns the in-flight job instead. (5) A lifetime-ceiling job now drains its remaining links through Workers-AI instead of reporting a clean 'done' with nothing extracted. Plus: persistSaleSnapshot supersede+insert is now one db.batch; discovery dedupe normalizes http-vs-https; a private-host guard on discovery fetches.",
      },
    ],
    status: "shipped",
    prNumber: 380,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/380",
  },
  {
    id: "drive-ingestion-service",
    branch: "feat/drive-ingestion-service",
    date: "2026-08-08",
    area: "Drive",
    title: "Drive ingestion service — catalogue any folder into D1",
    summary:
      "One reusable service ingests any Google Drive folder into D1, keyed by what the content is for. Renames and moves supersede into a revision chain, deletions are marked not removed, and per-file sharing state is captured because it decides whether a Drive link can be emailed to an outside vendor at all. Verified against the real folder: 72 nodes catalogued, and a second scan is a genuine no-op.",
    changes: [
      {
        kind: "migration",
        text: "0174_nifty_miek: six new tables — drive_use_cases (definition table), drive_roots, drive_root_exclusions, drive_folders, drive_documents, drive_document_links. Additive; applied and verified on remote D1. drive_documents is deliberately separate from supporting_documents, which keeps its existing meaning (manuals, tech sheets, contracts tied to a purchased thing); drive_document_links bridges the rare file that is both.",
      },
      {
        kind: "added",
        text: "ingestDriveFolder(env, rootId) and ingestAllActiveRoots(env) — recursive Drive v3 walk with exclusions applied DURING descent (an excluded subtree is never traversed), content hashing that falls back to a hash of exported text for Google-native files because Drive returns no md5Checksum for those, and a pure diff classifier covering create / supersede / delete / unchanged.",
      },
      {
        kind: "added",
        text: "Admin API: GET+POST /api/admin/drive/roots, POST /api/admin/drive/ingest (400 on a malformed rootId, 404 on a well-shaped id that matches no row, 200 and ingest-all when omitted), GET /api/admin/drive/documents?rootId=&folderId= with the folder name resolved by JOIN rather than stored.",
      },
      {
        kind: "added",
        text: "Daily 11:00 UTC cron that records each scan in the existing agent_runs ledger — one run, one step per root, with per-root error isolation so one failing root cannot cost the night. No bespoke scan-run table; it shows up at /admin/system/agents for free.",
      },
      {
        kind: "added",
        text: "GET /api/admin/drive-auth-probe — mints a token AND performs a real Drive read, distinguishing a rejected token mint (a delegation problem) from a Drive call that failed after a good mint. This is the retest tool for any future scope change.",
      },
      {
        kind: "changed",
        text: "drive.readonly added to the Gmail service account's requested scopes, after the human granted it in domain-wide delegation. The first attempt proved it was NOT delegated: Google rejects the entire JWT-bearer exchange on one undelegated scope, so every Gmail call failed, not just Drive. Proven and reverted on a preview worker; production never exposed.",
      },
      {
        kind: "migration",
        text: "0175_curved_anthem (review fixes): drive_roots.scan_started_at (the scan lease), a partial UNIQUE index on (root_id, drive_id) WHERE is_active = 1 for both drive_folders and drive_documents, and an index on superseded_by_id for both. Production had ZERO duplicate active rows, so the unique index applied cleanly with no cleanup. Applied and verified on remote D1.",
      },
      {
        kind: "fixed",
        text: "A file that came back created a DUPLICATE active row. Both existing-row queries filtered is_deleted = false, so a delete-marked row was invisible to the next diff and the file re-read as new — and the drive_id indexes were non-unique, so it corrupted silently. Delete-marked rows now stay in the diff and a returning file un-deletes the SAME row; the new partial unique index makes any remaining path fail loudly instead.",
      },
      {
        kind: "fixed",
        text: "Multi-parent items were walked once per parent (listChildren runs per parent, supportsAllDrives is on), yielding two DriveNodes with one Drive id — two creates in one batch, and for folders a nondeterministic drive-id→row-id map. The walk now dedupes by Drive id, first parent wins, with a unit test: QC cannot catch this because neither configured root is a Shared Drive.",
      },
      {
        kind: "fixed",
        text: "Renaming ONE folder superseded every document inside it: the document's stored folderId was resolved through active folder rows only, so the renamed folder's old id vanished from the map and every child read as moved. Resolution now covers every folder row, and a superseded folder's children are repointed at the live row.",
      },
      {
        kind: "fixed",
        text: "revisionNumber was hardcoded to 1 (the column default) on every supersede, so a five-deep chain read 'revision 1' throughout. It now carries the previous row's number + 1.",
      },
      {
        kind: "fixed",
        text: "hashSource was never compared, so a transient Drive export failure fell back to a metadata hash, superseded the doc, and the next good scan superseded it back — revision churn from nothing, on a root that is almost entirely Google-native Docs. A failed export now THROWS instead of degrading: the node is recorded in errors and skipped for that run (and explicitly not read as deleted), and hashes are only ever compared within the same source.",
      },
      {
        kind: "added",
        text: "Scan lease: drive_roots.scan_started_at, taken with one conditional UPDATE ... RETURNING (D1 has no transactions, so read-then-write would leave the race open) and released in a finally. A lease older than 30 minutes is ignored so a crashed run self-heals. POST /ingest returns 409 while a scan is running; the 11:00 cron skips that root and records it in the ledger step rather than counting it as a failure.",
      },
      {
        kind: "changed",
        text: "Folders now supersede on a MOVE as well as a rename, matching the spec and the document path — reparenting in place left no record that the tree changed shape. Also: driveFolderId is charset-validated at the route (it is interpolated into the Drive q parameter), summary.errors is capped at 50 with a trailing count marker because it is written verbatim into the agent-run ledger, and the synchronous-scan subrequest ceiling (~1000 files) is documented on the route with its Workflow upgrade path.",
      },
    ],
    migrations: ["0174_nifty_miek", "0175_curved_anthem"],
    status: "staged",
  },
  {
    id: "mcp-oauth-one-year-ttls",
    branch: "fix/mcp-oauth-one-year-ttls",
    date: "2026-08-08",
    area: "MCP",
    title: "MCP connector fixed: absolute registration_client_uri + one-year OAuth lifetimes",
    summary:
      "Two defects, found in that order. (1) Lifetimes: the OAuthProvider set no TTLs, so the library defaults applied and the 90-day clientRegistrationTTL deletes the client_id itself out of OAUTH_KV — leaving a connector that re-authorizing cannot repair. All three are now 365 days. (2) The reason re-adding the connector then failed too: `registration_client_uri` was a relative URI, which violates RFC 7591 §3.2.1, so claude.ai's dynamic client registration threw on it — \"Couldn't register with core-remodel's sign-in service\" — despite the server returning 201.",
    changes: [
      {
        kind: "fixed",
        text: "The blocker on re-connecting: `registration_client_uri` shipped as a RELATIVE URI (`/oauth/register/<id>`). RFC 7591 §3.2.1 requires a fully qualified URL, and claude.ai does `new URL()` on it — so dynamic client registration failed with \"Couldn't register with core-remodel's sign-in service\" even though the server returned 201 and wrote the record. The library builds the field from the `clientRegistrationEndpoint` option verbatim, and we pass a path so the endpoint works at any hostname. Now rewritten per-request against the request's own origin (withAbsoluteRegistrationUri), so branch previews keep working and it no-ops if the library is fixed upstream.",
      },
      {
        kind: "fixed",
        text: "clientRegistrationTTL was the connector-killer: at 90 days the provider deletes the `client:<id>` record from OAUTH_KV, so a claude.ai connector holding that client_id gets invalid_client on refresh AND on re-auth, and has to be removed and re-added by hand. Now 365 days.",
      },
      {
        kind: "changed",
        text: "accessTokenTTL 3600s → 31,536,000s (365d) and refreshTokenTTL 30d → 365d on the OAuthProvider in src/_worker.ts. Deliberate trade for a single-operator connector behind a password gate: no silent expiry; revocation is via the grant record in OAUTH_KV or the revocation endpoint.",
      },
      {
        kind: "added",
        text: "scripts/qc/pr_372.mjs — drives the whole connector dance (register → authorize → approve → code exchange → MCP initialize → refresh → MCP initialize) against a deployed worker and asserts the token endpoint's expires_in, which is the deployed accessTokenTTL verbatim.",
      },
    ],
    status: "staged",
  },
  {
    id: "multi-room-render",
    branch: "claude/multi-room-render",
    date: "2026-08-07",
    tag: "0048",
    area: "Render",
    title: "Multi-room multi-angle render campaigns + MCP code-mode exposure",
    summary:
      "The render pipeline was room-scoped: one session, one room, one /api/render/looks call. This change adds a render campaign abstraction that groups many (room, listing-photo) angles under one design brief and processes them durably via a Cloudflare Workflow. The hero angle renders first; every remaining angle receives the hero canvas as a ReferenceImage so materials and layout stay consistent across rooms. The campaign surface is exposed through the canonical OAuth MCP registry (create/list/get/cancel/run_room_looks), making it available to the OAuth connector and future Code Mode. An admin UI at /admin/render/campaigns lists campaigns and shows per-angle progress with realtime thumbnails.",
    changes: [
      {
        kind: "migration",
        text: "0173 (additive): CREATE render_campaigns, render_campaign_angles, render_campaign_sessions. No renames/drops.",
      },
      {
        kind: "added",
        text: "services/render/campaign.ts — create/get/list/cancel campaign service with per-room session creation and workflow trigger.",
      },
      {
        kind: "added",
        text: "services/render/render-campaign-workflow.ts — Cloudflare Workflow that processes angles sequentially, hero first, with hero reference propagation.",
      },
      {
        kind: "added",
        text: "GET/POST /api/render/campaigns/* routes for campaign CRUD, cancel, and enriched detail.",
      },
      {
        kind: "added",
        text: "MCP tools in canonical OAuth registry: create_render_campaign, list_render_campaigns, get_render_campaign, cancel_render_campaign, run_room_looks.",
      },
      {
        kind: "added",
        text: "/admin/render/campaigns and /admin/render/campaigns/:id pages with CampaignListApp + CampaignDetailApp.",
      },
      {
        kind: "added",
        text: "scripts/qc/pr_0048.mjs — verifies MCP registry, API surface, and error handling.",
      },
    ],
    migrations: ["0173"],
    status: "staged",
  },
  {
    id: "showroom-branch-collapse",
    branch: "claude/0047-p1-schema",
    date: "2026-08-05",
    area: "Showrooms",
    title: "Collapse chain branches into one business — Tier 2 (0047)",
    summary:
      "After 0045 gave a business many locations and 0046 learned to tell a duplicate STUB from a real BRANCH, 12 branch groups (~30 store rows) sat re-detected every scan with no way to act on one. 0047 makes them actionable, proposing and never auto-merging. A scan stages each branch group (STRONG-signal-gated so co-located different businesses are not staged); a human approves; apply carries every branch's site across as a location on the keeper and soft-deletes the branch store. Collapse is idempotent/resumable via a per-member collapse_state machine, and a branch's location row is REPOINTED to the keeper (it already holds the address) rather than recreated — so a mid-collapse crash never loses an address. The child-remap that both dedup and collapse need was extracted into one shared module. Backend live on prod; the web review UI (P5) remains.",
    changes: [
      {
        kind: "migration",
        text: "0171: showroom_merge_candidates + showroom_merge_candidate_members (per-member collapse_state machine + resulting_location_id) + showroom_merge_exclusions, plus a unit column on showroom_store_locations that closes the #356 suite-collision hole.",
      },
      {
        kind: "added",
        text: "services/showroom/branch-detection.ts — reuses 0046 groupBySignals; a branch group requires a STRONG signal (website/name/place_id) AND 2+ real distinct sites, minus excluded pairs, with unit-qualified location signals. Staged 11 real chains live; the 5 address-only co-located different businesses correctly excluded.",
      },
      {
        kind: "added",
        text: "services/showroom/branch-collapse.ts — collapseCandidate: APPROVED-only, live re-verify, per-member state machine (PENDING→LOCATION_CREATED→CHILDREN_REMAPPED→RETIRED, or SKIPPED_NO_ADDRESS). Branch location repointed to the keeper, never recreated/deleted; branch store soft-deleted only at the end, so a partial failure resumes cleanly.",
      },
      {
        kind: "added",
        text: "services/showroom/store-child-remap.ts — the ~25 FK child-table move maps + remapStoreChildren, extracted from dedup_showroom_stores so tier-1 dedup and tier-2 collapse share ONE implementation. dedup refactored to import it (pr_348 stays 18/18).",
      },
      {
        kind: "added",
        text: "MCP: scan_showroom_merge_candidates (WRITE_IDEMPOTENT), list_merge_candidates + get_merge_candidate (READ_ONLY), resolve_merge_candidate (WRITE — approve/reject/set_keeper/exclude_member), apply_merge_candidate (DESTRUCTIVE, refuses non-APPROVED).",
      },
    ],
    migrations: ["0171_tense_mac_gargan"],
    status: "shipped",
  },
  {
    id: "budget-grid",
    branch: "claude/budget-backend-frontend-09f91d",
    date: "2026-08-05",
    tag: "0035 P1–P2",
    area: "Budget",
    title: "Time-phased budget grid — /admin/budget/grid (API + MCP + UI)",
    summary:
      "The RemodelBudgetGrid ships end to end, on top of the Phase-0 schema. A shared loadBudgetGrid() service aggregates active budget lines into a phase → line-item, month-bucketed grid: plan[] from budget_plan_schedule, actual[] from expenses linked by the stable trackId and bucketed by dateIncurred, variance = plan − actual, per-phase progress + tone, per-line variance flags, whole-project scorecards, and footer rollups. It is exposed three ways off one code path: GET /api/budget/grid, a get_budget_grid MCP tool (same service — no divergence), and the /admin/budget/grid React island rebuilt from the design comp (Estimate/Actuals/Variance tabs computed client-side, inline plan edit via CurrencyInput → PATCH /api/budget/plan-schedule, and a Log-expense dialog that writes a line-linked expense). POST /api/budget/grid/seed spreads real estimate midpoints into the plan schedule and conservatively attributes existing expenses to lines (confident single-match only, never fabricated). Also fixes a latent bug: the expenses POST silently dropped budget_item_track_id, so logged spend never rolled into a line's Actuals. Browser-verified on preview; QC 28/28.",
    changes: [
      {
        kind: "added",
        text: "GET /api/budget/grid — phase→line, month-bucketed plan/actual/variance + scorecards + footer rollups (shared loadBudgetGrid service in services/budget/grid.ts).",
      },
      {
        kind: "added",
        text: "PATCH /api/budget/plan-schedule (upsert on trackId+period) + POST /api/budget/grid/seed (estimate→plan spread, conservative expense attribution, idempotent).",
      },
      {
        kind: "added",
        text: "MCP get_budget_grid (READ_ONLY) — same aggregation service as the route, no logic divergence.",
      },
      {
        kind: "added",
        text: "/admin/budget/grid page + BudgetGridApp island: Estimate/Actuals/Variance (client-side), scorecards, phase rows + progress rings, variance badges, month stepper, filters, expand/collapse, inline plan edit (CurrencyInput), Log-expense dialog.",
      },
      {
        kind: "fixed",
        text: "POST /api/budget-tracker/expenses now persists budget_item_track_id (was silently dropped) — logged expenses roll into the target line's Actuals.",
      },
    ],
    status: "staged",
  },
  {
    id: "budget-grid-foundations",
    branch: "claude/budget-backend-frontend-09f91d",
    date: "2026-08-05",
    tag: "0035 P0",
    area: "Budget",
    title: "Budget grid schema foundations — phases, plan schedule, expense→line link",
    summary:
      "The backend groundwork for the time-phased budget grid (RemodelBudgetGrid), and the first PR of the 0035 grid + workbench umbrella. Three additive pieces: budget_phases — a definition vocabulary the grid groups line items under, with a /admin/config/budget/phases config page and 4 seeded defaults; budget_plan_schedule — the monthly Estimate axis, one planned figure per (budget line, month), keyed on the stable trackId so it survives budget-item revisions; and a budget_item_track_id column on budget_expense_entries (TEXT, no FK) so actual spend attaches to the budget line it belongs to and buckets by month — the join the grid needs but the schema lacked (actuals were attributed by category text only). budget_tracker_items also gains phase_id + a variance note (markdown/html). Migration 0171 is all additive ADD COLUMN + two new tables (no table rebuild), applied and verified on remote. No grid UI yet — that is phases 1–2.",
    changes: [
      {
        kind: "migration",
        text: "0171 (additive): CREATE budget_phases, budget_plan_schedule; ADD budget_expense_entries.{budget_item_track_id, room_id, invoice_id}; ADD budget_tracker_items.{phase_id, variance_note_markdown, variance_note_html}. No rebuild. Applied to remote + verified.",
      },
      {
        kind: "added",
        text: "budget_phases definition table + /api/config/budget-phases CRUD (bare-array panel dialect, key derived from name) + /admin/config/budget/phases config page (new Budget nav group). 4 default phases seeded.",
      },
      {
        kind: "added",
        text: "budget_plan_schedule — monthly planned spend per line (budget_item_track_id, period 'YYYY-MM', planned_cents + planned_text); UNIQUE(track_id, period); no FK (keyed on the revision-independent trackId).",
      },
      {
        kind: "added",
        text: "budget_expense_entries.budget_item_track_id (TEXT, no FK) — attaches an actual to its budget line so the grid rolls actuals per line + by month; + nullable room_id/invoice_id FKs for workbench room rollups.",
      },
      {
        kind: "changed",
        text: "budget_tracker_items: phase_id (FK budget_phases, set null) for grid grouping + variance_note_markdown/html.",
      },
    ],
    migrations: ["0172"],
    status: "staged",
  },
  {
    id: "pascal-layout-studio",
    branch: "codex/pascal-core-remodel-continuation",
    date: "2026-08-02",
    tag: "0043 P4",
    area: "Design",
    title: "Pascal Layout Studio — projects, studies, variants, and evidence",
    summary:
      "Core Remodel now has a complete management surface for the Pascal editor at /admin/pascal. Project cards bind to canonical floor/room scopes; study sections hold rich-text briefs; variants start from measured room data or branch from an existing scene with optional structured AI edits. Every variant exposes measurement evidence, lineage, confidence, snapshots, comparison, rename/archive lifecycle, and a deep link into Pascal. The browser and MCP tools call shared generation/comparison workflows, so there is one behavior path. This phase also restores discoverability in the Plan sidebar and merges Pascal's generated OpenAPI routes into /openapi.json.",
    changes: [
      {
        kind: "added",
        text: "/admin/pascal and /admin/pascal/:projectId Layout Studio pages with loading, empty, error, and populated states.",
      },
      {
        kind: "added",
        text: "Product REST surface for project summaries, studies, variant generation/comparison, snapshots, and scene lifecycle.",
      },
      {
        kind: "changed",
        text: "generate_floorplan_variant and compare_layout_variants now share the same workflow used by the browser UI; branched variants retain measurement evidence.",
      },
      {
        kind: "changed",
        text: "/openapi.json dynamically merges the Pascal OpenAPIHono registry, documenting the frozen editor wire and product routes from their source definitions.",
      },
      {
        kind: "added",
        text: "Plan sidebar entry, refreshed Worker bindings, TASKS.json plan mirror, and PR #342 preview QC (18 assertions).",
      },
    ],
    status: "staged",
  },
  {
    id: "store-quote-product-map",
    branch: "claude/0042-p5-product-map",
    date: "2026-08-02",
    area: "Showrooms",
    title: "Quote line items map to products — match or auto-create (0042 P5)",
    summary:
      "The second half of the quote-ingestion loop, and the last of 0042. Building on P4's showroom_store_id, each extracted quote line is matched to a product the showroom already carries, or a brand+product are auto-created from the vendor+description (deduped via the shared ensureProductFromExtraction), linked to the showroom, and the line's unit price recorded as a dated product_price_observation. The PendingQuotesPanel now shows each mapped line's product under it with a 'new from quote' (created) or 'matched' badge. Mapping fires in the email pipeline after line-item insert — post-extraction, which for Gmail-sourced mail is post-approval per the 0042 trust gate, so auto-creating catalog rows is human-gated. Guardrails: only quotes attributed to a store are mapped (an unattributed quote never forks the catalog); a prefix heuristic skips tax/delivery/labor/fee/total lines; the mapping is idempotent (only unmatched lines processed, price-obs deduped on product+store+cents) and best-effort per line.",
    changes: [
      {
        kind: "migration",
        text: "0167 (additive): worker_email_invoice_line_items.product_id (FK→products) + index. Applied to remote + verified. (0168 drops the brand_id column that 0167 also added — review: brand derives from products.brandId, never denormalized; native DROP COLUMN, no rebuild.)",
      },
      {
        kind: "added",
        text: "services/email/map-invoice-products.ts — mapInvoiceLinesToProducts(): reuses ensureProductFromExtraction (brand+item dedup), links via showroom_product_mappings (idempotent uniq), records product_price_observations (deduped on product+store+cents), stamps line product_id/brand_id/match_status.",
      },
      {
        kind: "changed",
        text: "email pipeline fires product mapping after line-item insert + material deduction; best-effort (a failure never breaks email processing).",
      },
      {
        kind: "changed",
        text: "GET /:id/pending-quotes lines now carry productId/brandId/productName (JOINed from products, never denormalized).",
      },
      {
        kind: "added",
        text: "PendingQuotesPanel: each mapped line shows the product + a 'new from quote' / 'matched' badge.",
      },
    ],
    migrations: ["0167", "0168"],
    status: "staged",
  },
  {
    id: "store-quote-viewport",
    branch: "claude/0042-showroom-quote-map",
    date: "2026-08-02",
    area: "Showrooms",
    title: "Pending quotes surface in the showroom viewport (0042 P4)",
    summary:
      "An extracted quote/invoice now resolves to the showroom it came FROM and shows as a pending item inside that store's viewport — closing the P4 half of the original quote-ingestion request (previously the quote only appeared in the global alerts feed). The email pipeline stamps worker_email_invoices.showroom_store_id at extraction by matching the sender's domain/name to a store via the existing matchShowroomStore(), on both the fresh and reprocess paths. A PendingQuotesPanel atop the brands-products section lists vendor / total / line items with Confirm/Dismiss (reusing the worker-emails confirm/reject endpoints) and a Review & map link; the alerts aggregator deep-links invoice_review rows into the store viewport when scoped. The FK is nullable — a quote from a public domain (gmail.com) stays store-less and shows only globally. Product match/auto-create is P5.",
    changes: [
      {
        kind: "migration",
        text: "0166 (additive): worker_email_invoices.showroom_store_id integer FK → showroom_stores (ON DELETE SET NULL) + index. Applied to remote + verified.",
      },
      {
        kind: "added",
        text: "GET /api/showroom-stores/:id/pending-quotes — draft quotes (status='draft') resolved to this store, each with its line items; { quotes: [...] }.",
      },
      {
        kind: "added",
        text: "PendingQuotesPanel in StoreViewportApp (brands-products section): vendor, total, confidence, line items, Confirm/Dismiss, Review & map. Renders nothing when there are no pending quotes.",
      },
      {
        kind: "changed",
        text: "email pipeline (analyzeAndPersist) resolves sender → store via matchShowroomStore() (now exported from showroom-contact-autopopulate.ts) and stamps showroom_store_id on the invoice — fresh + reprocess.",
      },
      {
        kind: "changed",
        text: "alerts aggregator: invoice_review rows deep-link to /admin/shopping/store/:id/brands-products when the quote resolved to a showroom, else /admin/shopping/receipt-review.",
      },
    ],
    migrations: ["0166"],
    status: "staged",
  },
  {
    id: "showroom-360-tour",
    branch: "claude/showroom-360-tour-links-0fd2ac",
    date: "2026-07-31",
    area: "Showrooms",
    title: "360° tour in the Photos bento + Street View auto-tour",
    summary:
      "A showroom's 360° walkthrough now lives in the Photos bento. When the store has a manual SHOWROOM_TOUR link (already in the link vocab) it renders as a TourCard — Matterport URLs embed inline, other tours open in a new tab — and the Photos tile gets a '· 360° tour' badge. When there is no manual link, a Street View fallback probes the store's coordinates with the FREE StreetViewService.getPanorama() (Google bills only the rendered panorama, never the check) and, if coverage exists, offers an 'Open tour' button. The billable StreetViewPanorama render is deferred behind that click and gated: it first calls POST /api/showroom-stores/:id/streetview-render, which enforces a new count-based street_view SKU cap (4,500/mo, under Google's 5,000 free Pro events) and logs the event into google_maps_usage_log. The browser Maps JS key is served at runtime from the existing GOOGLE_MAPS_API secrets-store binding via an auth-gated GET /api/places/maps-js-key, never baked into the client bundle. No schema change, no migration.",
    changes: [
      {
        kind: "added",
        text: "Photos bento TourCard: renders a manual SHOWROOM_TOUR link (Matterport inline <iframe>; other tours open-in-tab) + a '· 360° tour' badge on the Photos tile.",
      },
      {
        kind: "added",
        text: "StreetViewTour component: free getPanorama() detection at the store's lat/lng (radius 50, source DEFAULT to include indoor photospheres); renders nothing when no coverage; billable StreetViewPanorama deferred behind an explicit click.",
      },
      {
        kind: "added",
        text: "street_view SKU added to the count-based Maps quota (MAPS_API_QUOTAS 4,500/mo) + skuForUsageBucket mapping; POST /api/showroom-stores/:id/streetview-render enforces isUnderApiQuota + logs each render to google_maps_usage_log (403 over cap).",
      },
      {
        kind: "added",
        text: "GET /api/places/maps-js-key serves the browser Maps JS key from the GOOGLE_MAPS_API secrets-store binding at runtime (behind requireAccessAuth), so it is never bundled at build time.",
      },
    ],
    status: "staged",
  },
  {
    id: "0032-discovery-finder-pages",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-31",
    tag: "0032",
    area: "Discovery",
    title: "Discovery-finder pages — the finder UI (0032 D2d, COMPLETES 0032)",
    summary:
      "The frontend for the discovery finder, and the final slice of 0032. /admin/shopping/showrooms/finder is a list page with a one-box 'search near… for…' form that runs a search (POST /api/showroom-searches) and lists recent searches with status/result-count chips. /finder/[slug] is the live search viewport: it reads GET /api/showroom-searches/:slug and renders each result as a card (mini-map via DriveMapThumb, type/rating/distance/relevance badges, tel:/website links) with one-click 'Add to directory' (import) and 'Not interested' (exclude) — and it STREAMS updates from the DiscoveryHub WebSocket (/api/showrooms/discovery/ws?slug=…, with a ping keepalive + a 20s poll fallback), so a search kicked off by voice or a refine shows results landing live. A Refine button adds a revision in place; Finalize marks it done. /exclusions is the not-interested admin list (un-exclude to let a place resurface). Plus a sidebar Finder + Not-interested nav entry under Showrooms. All thin Astro shells mounting client:only React islands over the D2c-1 REST + D2b hub — frontend only, no API/D1 change. With this, 0032 is complete: schema (D2a) → realtime hub (D2b) → engine + REST (D2c-1) → MCP tools (D2c-2) → UI (D2d).",
    changes: [
      {
        kind: "added",
        text: "src/frontend/pages/admin/shopping/showrooms/{finder.astro, finder/[slug].astro, exclusions.astro} — thin shells per studio.astro (class not className, 24px header icon).",
      },
      {
        kind: "added",
        text: "src/frontend/components/finder/ — FinderApp (list + new-search), FinderDetailApp (viewport, DiscoveryHub WS stream + poll fallback + import/exclude/refine/finalize), ResultCard (DriveMapThumb + badges + actions), ExclusionsApp, api.ts, types.ts.",
      },
      {
        kind: "added",
        text: "Sidebar: Finder + Not-interested nav entries under Showrooms (nav-groups.ts).",
      },
    ],
    status: "staged",
  },
  {
    id: "0032-discovery-mcp-tools",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-31",
    tag: "0032",
    area: "Discovery",
    title: "Discovery finder over MCP — voice/chat parity (0032 D2c-2)",
    summary:
      "The voice/chat half of the finder: 10 MCP tools that let a Claude session run and manage a discovery search exactly like the finder UI — find_showrooms (run/refine a search), list_showroom_searches / get_showroom_search / get_search_revisions (read a slug + its results + revision history), finalize_showroom_search, import_search_results (promote picks into the directory), exclude_search_result, and the exclusions CRUD add_/list_/remove_showroom_exclusion. Every tool is a thin defineTool wrapper over the SAME services/showroom/discovery-search.ts functions the D2c-1 REST routes call — the AGENTS.md parity contract, so a voice session and the finder page can never drift. Hand-written Zod v4 input shapes, ≥1 example each, and correct READ_ONLY / WRITE / WRITE_IDEMPOTENT / DESTRUCTIVE annotations; they auto-render on the /connect/tools catalog via the registry. No D1 schema, no new REST — pure MCP surface over the shipped engine.",
    changes: [
      {
        kind: "added",
        text: "10 MCP tools in src/backend/mcp/tools/showrooms/: find_showrooms, list_showroom_searches, get_showroom_search, get_search_revisions, finalize_showroom_search, import_search_results, exclude_search_result, add_showroom_exclusion, list_showroom_exclusions, remove_showroom_exclusion — registered in tools/showrooms/index.ts.",
      },
      {
        kind: "changed",
        text: "Each tool calls the identical discovery-search.ts function its REST twin uses (findShowrooms/listSearches/getSearch/getSearchRevisions/finalizeSearch/importSearchResults/excludeSearchResult/addExclusion/listExclusions/removeExclusion) — one service, two callers.",
      },
    ],
    status: "staged",
  },
  {
    id: "0032-discovery-search-engine",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-31",
    tag: "0032",
    area: "Discovery",
    title: "find_showrooms engine + discovery REST (0032 D2c-1)",
    summary:
      "The worker-orchestrated finder (0022 §14.2): find_showrooms takes a location + optional query (and optional model-submitted aiResults), runs a Google Places text sweep, dedupes candidates (by place_id, else name+address), flags which are already in the directory or on the not-interested list, ranks + classifies them with one best-effort Gemini call (validated place_ids, deterministic Places-type heuristic on any failure), and persists a numbered revision + its result rows — then publishes to the slug's DiscoveryHub so an open finder page streams live. Cost-safe: the Places sweep only runs when usePlaces is set AND the Places SKU is under quota (a MAPS_QUOTA_EXCEEDED throw degrades to AI-only with used_places=false, never a failure). One discovery-search.ts service backs BOTH the REST routes and (in D2c-2) the MCP tools, so the finder page and a voice session never drift. Slug actions with no re-search: list / get / revisions / finalize / import (promote results into showroom_stores, mirroring the HITL PROCESS path) / exclude (add a permanent exclusion off the slug). Plus full exclusions CRUD (add / list / remove). REST only in this slice; MCP parity + finder pages follow.",
    changes: [
      {
        kind: "added",
        text: "services/showroom/discovery-search.ts — findShowrooms orchestration (Places sweep + dedupe + directory/exclusion flag + Gemini rank + revision/result persistence + DiscoveryHub publish) + slug actions (list/get/revisions/finalize/import/exclude) + exclusions CRUD. One service, REST+MCP parity.",
      },
      {
        kind: "added",
        text: "REST /api/showroom-searches (POST create/refine, GET list, GET :slug, GET :slug/revisions, POST :slug/finalize|import|exclude) + /api/showroom-exclusions (GET/POST, DELETE :id). Plain-Hono, admin-gated.",
      },
      {
        kind: "changed",
        text: "Cost-safety: Places sweep gated by usePlaces + the per-SKU quota hard-disable (AI-only fallback); Gemini rank is best-effort with a validated-placeId guard + heuristic fallback; result inserts chunked to ≤3 rows/statement (D1 100-param cap).",
      },
      {
        kind: "fixed",
        text: "Review hardening (codra + graphite): the revision-replace + result-inserts + search-status-update now run as one all-or-nothing db.batch (no half-written revision on a partial failure); reasonHtml is sanitized on write (sanitizeNoteHtml) against stored XSS; import no longer copies always-null address parts onto the new store (address backfills from place_id, as the HITL PROCESS path does); an exclusion now requires a place_id or name; and the revision source is classified from the deduped set. Declined with reasons: single-operator app has no admin-role gate beyond the shared access cookie (isRequestAuthenticated is the authz, as on all 17 admin routes); plain-Hono matches the sibling route convention; list limits are already clamped in the service; addExclusionRow already dedupes by place_id.",
      },
    ],
    status: "staged",
  },
  {
    id: "0032-discovery-realtime-hub",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-31",
    tag: "0032",
    area: "Discovery",
    title: "Discovery-finder realtime hub — DiscoveryHub DO (0032 D2b)",
    summary:
      "The realtime spine for the finder: a new Hibernatable-WebSocket Durable Object (DiscoveryHub, wrangler migration v17) that fans out finder events per search slug, so an open /finder/<slug> page streams the search's progress (status → revision_added → results_ready) live instead of polling. It clones the proven EstimateCollabHub pattern exactly — one DO per room 'search:<slug>', ctx.acceptWebSocket + the webSocket* handlers + ctx.getWebSockets() broadcast, a POST /emit fan-out entrypoint, and an app-level ping→pong keepalive. Wired end to end: the class is exported from _worker.ts, bound as DISCOVERY_HUB in wrangler.jsonc (DO binding + v17 new_sqlite_classes), gets a WS gateway route /api/showrooms/discovery/ws|health?slug= (placed before the Hono block, mirroring the estimates + floorplan gateways), and a publishDiscoveryEvent(env, slug, payload) helper (mirrors publishRealtimeEvent) that the D2c finder engine will call after each write. Carries NO alarm and no growing storage, so it's entirely outside the DO-alarm cost-safety surface. No D1 schema change.",
    changes: [
      {
        kind: "added",
        text: "src/backend/realtime/DiscoveryHub.ts — Hibernatable-WebSocket fan-out DO, one per room 'search:<slug>' (clone of EstimateCollabHub); /emit broadcast + /health + ping→pong.",
      },
      {
        kind: "added",
        text: "publishDiscoveryEvent(env, slug, payload) in realtime/publish.ts — best-effort POST to the slug's DiscoveryHub /emit (the D2c engine publishes status/revision/results here).",
      },
      {
        kind: "added",
        text: "_worker.ts: export DiscoveryHub + WS gateway route /api/showrooms/discovery/ws|health?slug= (before the Hono block, like the estimates/floorplan gateways).",
      },
      {
        kind: "migration",
        text: "wrangler.jsonc: DISCOVERY_HUB DO binding + migration tag v17 (new_sqlite_classes: [DiscoveryHub]). DO migration only — no D1 DDL. worker-configuration.d.ts regenerated.",
      },
    ],
    status: "staged",
  },
  {
    id: "0032-discovery-search-schema",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-31",
    tag: "0032",
    area: "Discovery",
    title: "Discovery-finder schema foundation (0032 D2a)",
    summary:
      "The data spine for the on-demand 'find me showrooms near here' finder (0022 §5.7), landed first as an additive migration so every later D2 slice (the find_showrooms engine, the realtime hub, the finder pages) builds on live tables. Three new tables: showroom_search (one orchestrated search = a shareable slug, status running→ready→refining→final→error), showroom_search_revision (every change to a slug is a numbered revision, unique per search — the model can cite 'revision N'), and showroom_search_result (the result rows for a revision — Places/AI candidates with normalized address, type/rating/hours badges, ai_relevance/reasoning, distance, and in_directory / is_excluded flags + FKs to the store it already is or the exclusion that hid it). Plus showroom_exclusions gains the §5.7 columns it was missing: the 5 normalized address parts + category (so a not-interested place can be matched by name+address when it has no place_id). All additive — 3 CREATE TABLE + 6 ADD COLUMN, no rebuilds; migration 0163.",
    migrations: ["0163_warm_ravenous"],
    changes: [
      {
        kind: "migration",
        text: "0163_warm_ravenous: CREATE showroom_search / showroom_search_revision / showroom_search_result (+ FKs, unique(search_id,revision_number), slug-unique, status/search/revision/place indexes); ALTER showroom_exclusions ADD location_street_number/_street_name/_city/_state/_zip_code + category + zip index. Additive only.",
      },
      {
        kind: "added",
        text: "src/backend/db/schema/showroom/search.ts — the three discovery tables (result rows relate to their store by existing_store_id and to their hiding exclusion by matched_exclusion_id — FK + JOIN, never a denormalized name).",
      },
      {
        kind: "changed",
        text: "showroom_exclusions gains normalized address + category (§5.7). name stays nullable — the PRD's notNull can't be safely retrofitted onto the D1a-shipped populated column under the additive-migration rule; documented in the schema.",
      },
    ],
    status: "staged",
  },
  {
    id: "0041-store-inbox",
    branch: "claude/showroom-inbox-filtering-0294ec",
    date: "2026-07-30",
    area: "Shopping",
    title: "Store inbox + ingestion gating + full-width pages (0041)",
    summary:
      "The per-showroom inbox was a cramped inline panel showing a flood of other companies' mail, replies were plaintext, the AI-draft button silently failed, and marketing blasts had nowhere to go. This ships a standalone full-page inbox scoped to one showroom with folders (Inbox/Receipts/Spam/Trash), delete + read/unread, a PlateJS HTML reply, attachment/embedded-image display, and deterministic (no-AI) spam/receipt gating at ingestion — plus widens the cramped viewport pages to full width.",
    changes: [
      {
        kind: "migration",
        text: "0158_famous_warpath: gmail_messages gains classification (enum), is_spam, spam_rationale, deleted_at; new gmail_message_images table. 0159_skinny_trish_tilby: gmail_messages.images_extracted guard. Additive; applied + verified on remote D1.",
      },
      {
        kind: "added",
        text: "Embedded (cid:) images: on first view of a message, inline image parts are fetched from Gmail and uploaded to Cloudflare Images (ImageProcessorService), cached in gmail_message_images and shown in the reading pane; images_extracted guards it to one fetch+upload per message. Remote-hosted marketing images (external <img src>) are untouched.",
      },
      {
        kind: "added",
        text: "Full-page inbox at /admin/shopping/store/[id]/inbox (StoreInboxApp): Inbox/Receipts/Spam/Trash folders + counts, auto-scoped to the showroom, reusing GmailThreadList; the viewport Inbox button now navigates here.",
      },
      {
        kind: "added",
        text: "Deterministic classifyMessage (no AI): spam by phrase + sender (rejuvenation@e.rejuvenation.com + e./email. bulk subdomains) with stored rationale; receipt|invoice|quote + ($|attachment) tagged; trimQuotedReply collapses reply tails. Wired into both ingest paths; HTML body now captured.",
      },
      {
        kind: "added",
        text: "Routes: DELETE /threads/:id (soft→Trash), POST /threads/:id/mark-unread, ?folder= + counts on the showroom inbox, attachments/images on GET /threads/:id, HTML multipart/alternative reply, POST /backfill-classification (idempotent; flagged 28/62 on first run).",
      },
      {
        kind: "fixed",
        text: "AI-draft button was silently returning 500 on a raw.response envelope mismatch; now reads choices[0].message.content and surfaces the real error.",
      },
      {
        kind: "changed",
        text: "Viewport/data pages (store/material/product/compare/showrooms-directory/products-browse) widened from container mx-auto max-w-Nxl to full width.",
      },
    ],
    migrations: ["0158_famous_warpath"],
    status: "staged",
  },
  {
    id: "0038-sales-schema-phase-a",
    branch: "claude/sales-clearance-page-b0c752",
    date: "2026-07-27",
    area: "Shopping",
    title: "Sale items schema + backfill (0038 Phase A)",
    summary:
      "Clearance items lived as a JSON blob inside one showroom_store_sales row per page, so they could not be filtered by color/size, given per-item images, watched, or diffed across weeks. Phase A promotes each item to a real sale_items row and lands the whole data spine for the overhaul — image + color mapping tables, a per-cycle table, scrape-run logging, watch list, research clusters, and the weekly-ad record — all additive (migration 0148). A backfill route explodes the existing isCurrent snapshots into rows.",
    changes: [
      {
        kind: "migration",
        text: "0148_keen_vance_astro: 8 new tables (sale_cycles, sale_items, sale_item_images, sale_item_colors, sale_watch, sale_scrape_runs, sale_research_clusters, weekly_sale_ad) + showroom_stores.is_online_only + showroom_store_sales.page_markdown. Additive; applied + verified on remote D1.",
      },
      {
        kind: "added",
        text: "sale_items promotes ClearanceItem: brand/category/subcategory FKs into the shared config vocab (+ verbatim *_text fallback when no id matched), prices as text+cents, colors via a colors def + sale_item_colors mapping, size/condition/warranty/qty, damage notes + deal insight as markdown+html, cross-cycle change_status + deal_score/research_tier columns.",
      },
      {
        kind: "added",
        text: "backfillSaleItems() explodes isCurrent showroom_store_sales.clearanceDetailsJson.items[] into sale_items — single-row inserts batched (sale_items is ~40 cols, so multi-row would blow D1's 100 bound-param cap), idempotent (skips snapshots that already have rows).",
      },
      {
        kind: "added",
        text: "POST /api/showroom-sales/backfill (access-gated) runs the one-shot; 14 current snapshots → 29 items on first run, exact count-parity, 0 on re-run.",
      },
    ],
    migrations: ["0148_keen_vance_astro"],
    status: "staged",
  },
  {
    id: "0032-voice-mcp-keepalive",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-31",
    tag: "0032",
    area: "MCP / Infra",
    title: "Voice MCP keepalive — a 15s SSE heartbeat on the connector (0032 K1)",
    summary:
      "MCP tools intermittently report 'down' during Claude real-time VOICE sessions but work in normal text chat. The gaps between voice tool calls are long enough that a cellular NAT or iOS idle-kills the long-lived /mcp/sse (and streamable-HTTP) socket — the same failure PR #313 fixed for the a2a-v2 stream. withSseHeartbeat wraps both OAuth-gated MCP transports and, for any text/event-stream response, splices a `: ping` SSE comment frame into the stream every 15s (well under the ~30s idle window). Comment lines are ignored by every SSE client, so it's invisible to the protocol but keeps the socket warm. Only text/event-stream responses are wrapped — a normal JSON request/response tool call (the text-chat path) passes through untouched, so this can't regress normal-chat MCP. It uses a ReadableStream controller (not a second writer) so the pump and the heartbeat never race on a pending write. No schema change.",
    changes: [
      {
        kind: "added",
        text: "src/backend/mcp/sse-heartbeat.ts — withSseHeartbeat(inner): splices a 15s `: ping` frame into text/event-stream MCP responses via a ReadableStream controller; non-SSE responses pass through verbatim.",
      },
      {
        kind: "changed",
        text: "src/_worker.ts wraps both OAuthProvider apiHandlers (/mcp serve + /mcp/sse serveSSE) with withSseHeartbeat.",
      },
      {
        kind: "fixed",
        text: "Codra hardening: a `cancelled` flag + guarded controller.close()/error() and a trailing .catch() on the pump IIFE prevent an unhandled rejection when the consumer cancels the SSE stream (P1); cancel() now returns the reader.cancel() promise; content-type match is case-insensitive; and Content-Length/Content-Encoding are stripped from the copied headers so the replaced heartbeat body can't be truncated. Declined: restricting the wrapper to /mcp only — it returns the original Response verbatim for non-event-stream types (a provable no-op) and /mcp streamable-HTTP legitimately returns text/event-stream for streaming responses, the transport a voice session rides.",
      },
    ],
    status: "staged",
  },
  {
    id: "0032-nav-multiwaypoint",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-31",
    tag: "0032",
    area: "Tesla / Visits",
    title: "Multi-waypoint 'send drive to car' + reusable NavigateTeslaButton (0032 N1)",
    summary:
      "The nav half of 0022 P5. A reusable NavigateTeslaButton drops onto any surface: single-destination on a showroom hero (send the store's coords to the car), or whole-drive on the drive viewport (send every stop as one route). Backend: sendMultiWaypointNavigation builds a Google Maps directions URL from the drive's ordered stops (skipping skipped stops + un-promoted pitstops, and stops with no coords) and shares it via Tessie — the car opens the routed multi-stop trip; a single waypoint degrades to the existing sendNavigation. New REST POST /api/tesla/navigate-drive and MCP send_drive_to_tesla (voice parity) go through the same service. No schema change. A native Fleet-API navigation_waypoints_request (signed command) is a documented follow-up; the maps-route share is the working fallback the plan calls for.",
    changes: [
      {
        kind: "added",
        text: "services/tesla.ts sendMultiWaypointNavigation(env, waypoints) — Google Maps directions share (maps-route), single-waypoint → sendNavigation.",
      },
      {
        kind: "added",
        text: "POST /api/tesla/navigate-drive { driveListId | slug } + MCP send_drive_to_tesla — resolve ordered drive stops → multi-waypoint send.",
      },
      {
        kind: "added",
        text: "components/tesla/NavigateTeslaButton (reusable) wired onto the showroom hero (single dest) + drive viewport header (whole drive).",
      },
    ],
    status: "staged",
  },
  {
    id: "0032-park-finds-gemini",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-30",
    tag: "0032",
    area: "Tesla / Visits",
    title: "Proximity scan gains a Gemini relevance pass (0032 D1 follow-up)",
    summary:
      "Completes decision 1.d to the plan's 'Places + Gemini' spec. The Places includedTypes filter is a coarse pre-filter (it lets through a furniture_store that's really a mattress outlet); a new best-effort Gemini structured-output pass (via the shared generateStructured service, feature 'proximity_scan_relevance') is the PRECISION gate — it judges whether a homeowner mid-remodel would actually shop there (isRemodelRelevant), and writes the candidate's category + one-liner for the Park-Finds card. A confident 'not relevant' skips staging; anything else is staged as before. Fail-safe: on a 10s timeout / model / parse failure it returns null and the scan falls back to the deterministic Places-type heuristic, so a Gemini outage never breaks a park-find (and the whole call still runs off waitUntil, never throwing). Usage auto-logs to gemini_usage_log. Backend only — the AI one-liner + category flow to the existing card with no frontend change.",
    changes: [
      {
        kind: "added",
        text: "services/tesla/proximity-scan.ts assessRemodelRelevance(): generateStructured Gemini call (JSON schema {isRemodelRelevant, category, oneLiner}), 10s Promise.race timeout, null-on-failure fallback to the Places heuristic.",
      },
      {
        kind: "changed",
        text: "proximityScan: a confident isRemodelRelevant=false returns reason 'not-relevant' (no stage); otherwise the AI category/one-liner replace the Places-type guess on the hitl candidate (description/categoryGuess) + are stored in proximity_scan_json.aiRelevance for the receipts.",
      },
    ],
    status: "staged",
  },
  {
    id: "0032-park-finds-page",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-29",
    tag: "0032",
    area: "Tesla / Visits",
    title: "Park-Finds workspace — the discovery review inbox (0032 D1b)",
    summary:
      "The frontend for D1a's proximity-scan HITL queue: a /admin/shopping/showrooms/hitl page (thin Astro shell mirroring the Visit Logs workspace) mounting a ParkFindsApp island that reads GET /api/showroom-hitl-queue and shows each park-find as a card — guessed name, category chip, AI one-liner, the drive it was found on, a one-marker mini-map (reusing DriveMapThumb), and the scan distance from the park point. Two tabs (Awaiting review = TBD, Decided). Each TBD card carries the three decisions: Add to directory (POST decide PROCESS → promotes to a real store), Not relevant (decide DO_NOT_PROCESS + addExclusion so it never re-surfaces), and Decide later (local dismiss). A sidebar Park-Finds entry under Showrooms shows a live TBD-count badge (fetched in AdminSidebar, threaded through to the nested nav item, refreshed on decision via a window event). Frontend only — no schema/API/MCP change; it's the UI over D1a's shared service.",
    changes: [
      {
        kind: "added",
        text: "src/frontend/pages/admin/shopping/showrooms/hitl.astro + components/park-finds/ (ParkFindsApp, ParkFindCard, api.ts, types.ts).",
      },
      {
        kind: "added",
        text: "Sidebar Park-Finds nav entry under Showrooms with a live TBD-count badge (AdminSidebar fetches /api/showroom-hitl-queue?decision=TBD, threads parkFindsPendingCount to the nested item, refreshes on a 'park-finds-updated' event).",
      },
      {
        kind: "changed",
        text: "Reuses DriveMapThumb for the card mini-map; mirrors the V2c VisitLogsListApp fetch/tab/card structure and ProductPhotoHitl's busy→POST→refetch action pattern.",
      },
    ],
    status: "shipped",
  },
  {
    id: "0032-park-finds-discovery",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-29",
    tag: "0032",
    area: "Tesla / Visits",
    title: "Park-Finds — proximity scan + HITL discovery queue (0032 D1a)",
    summary:
      "Decision 1.d of the park pipeline: when the car parks somewhere that is NOT home/work, NOT a stop on the active drive, and NOT a registered showroom, a proximity scan asks Google Places 'what remodel-relevant business is right here?' and, if it finds a plausible one that isn't already in the directory and isn't excluded, STAGES it for human review instead of guessing a store into existence (the 'resolve an ambiguous parent' rule). The stage is three linked writes: a showroom_store_hitl_queue candidate (TBD), a detour stop on the active drive (is_detour → the candidate), and a discovery soft arrival (visit_log with hitl_queue_id, no store_id). Approve → promotes to a real showroom_stores row (flagged proximity-scan-discovered) and re-points the visit + detour at it; reject → optional showroom_exclusions row so it never re-surfaces. Cost-bounded: the scan runs at most ONCE per park (the detector emits 'park' once) and only when 1.a–1.c all miss, gated by tesla_proximity_scan_enabled AND the Maps per-SKU quota hard-disable; remodel-relevance is the Places includedTypes filter (a Gemini one-liner/relevance pass is a documented follow-up). REST /api/showroom-hitl-queue + MCP list_park_finds/decide_park_find go through one shared service (parity). Backend only — the Park-Finds admin page is D1b.",
    migrations: ["0153", "0154"],
    changes: [
      {
        kind: "added",
        text: "showroom_store_hitl_queue + showroom_exclusions tables (migration 0153); column adds: showroom_visit_log.hitl_queue_id, drive_list_stops.is_detour/hitl_queue_id, showroom_stores.is_identified_by_proximity_scan/proximity_scan_json, park_sessions.hitl_queue_id; drive_lists.status += 'paused' (TEXT, no SQL).",
      },
      {
        kind: "added",
        text: "services/tesla/proximity-scan.ts — decision 1.d: placesNearby (remodel includedTypes) → dedupe vs registered stores / exclusions / open queue → stage hitl candidate + detour stop + discovery soft arrival + link park session. Never throws; runs off waitUntil.",
      },
      {
        kind: "added",
        text: "services/showroom/hitl-queue.ts — shared list/get/count/decide service; PROCESS promotes to showroom_stores (or links by place_id) and re-points the visit + detour, DO_NOT_PROCESS optionally writes an exclusion.",
      },
      {
        kind: "added",
        text: "REST /api/showroom-hitl-queue (list + ?decision filter + pending count, GET :id, POST :id/decide) and MCP list_park_finds / decide_park_find — both through the one service.",
      },
      {
        kind: "changed",
        text: "ingestViaDetector wires decision 1.d: on PARK, when stageSoftArrival returns no-showroom-nearby / no-active-drive, run the proximity scan.",
      },
      {
        kind: "migration",
        text: "0153_wealthy_mephistopheles — 2 CREATE TABLE (hitl_queue, exclusions) + 6 additive ADD COLUMN + indexes incl. partial-unique showroom_exclusions_place_uniq.",
      },
      {
        kind: "fixed",
        text: "Codra follow-ups: proximity-scan dedup queries now filter by the ≤10 candidate place_ids (inArray) instead of full-scanning stores/exclusions/queue on every park (dead-variable bug); decideHitlCandidate short-circuits an already-decided candidate (real idempotency, was only documented); countPending uses count(*) not a row load; place.types?.[0] optional-chained; FK indexes added on hitl_queue.store_id + park_sessions.hitl_queue_id (migration 0154).",
      },
      {
        kind: "migration",
        text: "0154_closed_centennial — CREATE INDEX on park_sessions.hitl_queue_id + showroom_store_hitl_queue.store_id (FK indexes).",
      },
    ],
    status: "shipped",
  },
  {
    id: "0032-park-dwell-detector",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-29",
    tag: "0032",
    area: "Tesla / Visits",
    title: "Source-agnostic park/dwell detector + park_sessions (0032 L1)",
    summary:
      "The piece that lets a poll-only drive (streaming DO off) capture visits like the 500ms stream. A source-agnostic detector turns a fix stream into PARK / DRIVE-AWAY events two ways: a shiftState transition (Tesla, edge-triggered, instant) OR a dwell heuristic (phone/AI, no gear — within PARK_RADIUS_M for ≥ DWELL_MIN is a park; moved > DEPART_RADIUS_M is a drive-away). Hot state is KV (loc:detector:<subjectId>, self-replacing — no growing table, the $700-runaway lesson); a confirmed park also writes a park_sessions anchor row so an in-flight visit survives a worker eviction. Thresholds come from the C1 config keys. The 120s poller now feeds the detector ADDITIVELY (its proven match/home logic is untouched) — so a poll-only drive gets automatic soft-arrival staging AND drive-away finalize, which the poller couldn't do before. The streaming DO keeps its in-memory shift detection for now (its rewire onto the detector is a documented follow-up — it already works).",
    migrations: ["0149"],
    changes: [
      {
        kind: "added",
        text: "park_sessions table (subject_id-keyed, partial-unique one-open-per-subject) — the detector's durable anchor. Migration 0149.",
      },
      {
        kind: "added",
        text: "services/location/park-detector.ts — shiftState-transition OR dwell FSM, KV state, park_sessions lifecycle (open/settle), config-driven thresholds.",
      },
      {
        kind: "added",
        text: "ingestViaDetector — runs the detector, stages a soft arrival on PARK (linked to the park session), finalizes on DRIVE-AWAY.",
      },
      {
        kind: "changed",
        text: "tesla-poller now feeds the detector additively (existing match/home untouched) — poll-only drives get the full visit lifecycle.",
      },
      {
        kind: "migration",
        text: "0149_eager_bishop — CREATE TABLE park_sessions + partial-unique index (status='parked').",
      },
    ],
    status: "shipped",
  },
  {
    id: "0032-locationfix-ingress",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-27",
    tag: "0032",
    area: "Tesla / Visits",
    title: "LocationFix ingress — phone / AI / manual as first-class sources (0032 L0)",
    summary:
      "The decoupling seam: a source-agnostic LocationFix + one ingestLocationFix(env, fix) that records provenance and runs the SAME park pipeline the streaming DO runs — match a drive stop, home/work check, stage a soft arrival near a showroom on the active drive. Now a phone ping, an AI-supplied coordinate, or a manual 'I'm here' stages a visit exactly like a 500ms telemetry frame — the 'make it work off Tessie poll / phone / AI' ask. NEW: POST /api/tesla/manual-here, MCP report_location (ai source → device_location source=ai), and the existing /device-location route additively runs the pipeline in the background. No new table, no migration: provenance reuses device_location (free-text source). SAFELY SCOPED: the live streaming DO and 120s poller are deliberately NOT rewired here — that needs the dwell/park detector (L1, next) which tracks prior state for drive-away. Until L1, a soft arrival staged from a discrete source finalizes via the DO's stream drive-away or manually in the Visit Logs workspace.",
    changes: [
      {
        kind: "added",
        text: "services/location/ingest.ts — LocationFix/LocationSource + ingestLocationFix (record → match → home → stage), no auto-nav.",
      },
      {
        kind: "added",
        text: "POST /api/tesla/manual-here (manual source); MCP report_location (ai source, 122 tools).",
      },
      {
        kind: "changed",
        text: "/api/showroom-stores/device-location additively runs the park pipeline in the background (waitUntil) — phone is now a first-class source; response shape unchanged.",
      },
      {
        kind: "changed",
        text: "visit-sessions GpsSource union widened to the full gps_source enum (+ tesla-poll, phone, ai) to match the V1 column.",
      },
      {
        kind: "fixed",
        text: "Codra follow-ups: coordinate range bounds on manual-here + report_location (lat -90..90 / lng -180..180 / accuracy ≥0); capturedAt finite-guard before new Date; home-check error now fails SAFE (skips staging so a DB blip at home can't log a false showroom visit); QC no longer POSTs manual-here on prod.",
      },
    ],
    status: "shipped",
  },
  {
    id: "0032-tesla-location-config",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-27",
    tag: "0032",
    area: "Tesla / Visits",
    title: "Tesla location config — home/work, proximity & dwell (0032 C1)",
    summary:
      "The settings page the source-agnostic park detector (L1) and proximity scan (D1) will read: /admin/config/tesla, three cards in ConfigShell. Recording (reuses the EXISTING tesla_telemetry_recording_enabled flag via /api/config/tesla — one source of truth, no split-brain with the integrations page). Home & Work (Places-autocomplete address → coordinates via the /api/places proxy; 'use project address as home' pulls the primary property's geocoded coords). Proximity & dwell (scan-enabled switch + proximity/home-work/park/depart radii, dwell-min, stale-seconds). All location keys are KV in project_system_variables via the batch-safe POST /api/admin/config — no schema, no new API, no migration.",
    changes: [
      {
        kind: "added",
        text: "/admin/config/tesla page (ConfigShell) + config-nav 'Tesla Location' entry under Integrations.",
      },
      {
        kind: "added",
        text: "GeocodeAddressField — Places-autocomplete address→coords via /api/places (typeahead + details).",
      },
      {
        kind: "added",
        text: "tesla_* / loc_* config keys (home/work coords+address, proximity/home-work/park/depart radii, dwell_min, stale_seconds, scan_enabled) written via POST /api/admin/config (db.batch).",
      },
      {
        kind: "changed",
        text: "Recording master switch reuses the existing tesla_telemetry_recording_enabled flag (not the spec's unused tesla_record_telemetry) — avoids a split-brain recording flag.",
      },
      {
        kind: "fixed",
        text: "Codra follow-ups: GeocodeAddressField now sequences/aborts autocomplete requests (no stale overwrite), guards state after unmount, and surfaces a resolve failure; QC pr_293 gates the config write on the ACTUAL base (not a CLI flag) with a per-run key + verified cleanup; NumField caps length + label association.",
      },
    ],
    status: "shipped",
  },
  {
    id: "0032-visit-logs-workspace",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-27",
    tag: "0032",
    area: "Tesla / Visits",
    title: "Visit Logs workspace — pages, components & store section (0032 V2c)",
    summary:
      "The human surface for showroom visits, built on the V2a REST + V2b service. A Visit Logs workspace at /admin/shopping/showrooms/visitlogs: Pending (anything not SUBMITTED) vs Completed tabs, a detail/finalize view with a GPS-evidence mini-map (coords + match_distance_m + source + captured-at), and a manual create page. New shared components (VisitStatusBadge, VisitTypeChip, SourceBadge, StarRating, ShowroomAutocomplete, VisitLogEditor) — SourceBadge maps the REAL gps_source enum so every visit shows HOW it was captured. Store viewport gains a Visits section (pending float to the top with a finalize nudge, then history). Sidebar 'Visit Logs' entry. Frontend-only — no schema, no new API (reads the admin-gated ?storeId= filter; ShowroomAutocomplete's OTHER creates a bare store). Also fixed a latent drift: the store [section].astro allow-list was missing 'contacts', so /store/:id/contacts silently fell back.",
    changes: [
      {
        kind: "added",
        text: "Visit Logs workspace — list (pending/completed tabs), detail/finalize (GPS evidence + editor + this-store timeline), and manual new page.",
      },
      {
        kind: "added",
        text: "src/frontend/components/visits/ — Badges (status/type/source), StarRating, ShowroomAutocomplete, VisitLogEditor (PlateJS notes), GpsEvidence (reuses DriveMapThumb), VisitCard, api.ts.",
      },
      {
        kind: "added",
        text: "Store viewport 'visits' section (SectionKey + bento tile) — pending visits float up with a finalize nudge, then history.",
      },
      { kind: "added", text: "Sidebar 'Visit Logs' entry under Showrooms." },
      {
        kind: "fixed",
        text: "store [section].astro allow-list was missing 'contacts' (and now 'visits') — /store/:id/contacts had silently fallen back to brands-products.",
      },
    ],
    status: "shipped",
  },
  {
    id: "0032-visit-log-mcp-crud",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-27",
    tag: "0032",
    area: "Tesla / Visits",
    title: "Visit-log MCP CRUD + shared service (0032 V2b)",
    summary:
      "Adds the MCP twins of the visit-log REST routes and extracts the ONE service both call, so the human surface (V2a #288) and the voice loop can't drift. New MCP 'visits' domain: list/get/create/update/delete_visit_log, stage_showroom_visit (AI_STAGED draft from a note), finalize_visit_log (→SUBMITTED). Rating 1-5 guarded in the service; store name JOINed. No migration.",
    changes: [
      {
        kind: "added",
        text: "services/showroom/visit-log.ts — the single path REST + MCP both call (list/get/create/update/delete + rating guard + dwell).",
      },
      {
        kind: "changed",
        text: "/api/showroom-visit-logs refactored to delegate to the shared service (no duplicated logic).",
      },
      {
        kind: "added",
        text: "MCP 'visits' domain (7 tools) — full CRUD + stage_showroom_visit + finalize_visit_log. 121 tools total; auto-renders on /connect/tools.",
      },
    ],
    status: "shipped",
  },
  {
    id: "0032-visit-log-rest-crud",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-27",
    tag: "0032",
    area: "Tesla / Visits",
    title: "Visit-log REST CRUD — /api/showroom-visit-logs (0032 V2a)",
    summary:
      "The human + API surface over showroom_visit_log — the parity backbone for the Visit Logs workspace (V2b) and the voice loop. Admin-gated CRUD: list (pending/completed + storeId filters, store name JOINed), get, create (defaults DRAFT), patch/finalize (recomputes dwell), delete. Rating 1-5 enforced in the API layer (Zod). Added DRAFT to the status enum — TEXT column, so TS-only, no migration.",
    changes: [
      {
        kind: "added",
        text: "GET/POST/PATCH/DELETE /api/showroom-visit-logs (+ ?status=pending|completed, ?storeId=). Store name JOINed, never denormalized. Admin-gated.",
      },
      {
        kind: "added",
        text: "Rating validated 1-5 at the trust boundary (Zod) — the API-layer guard standing in for the DB CHECK SQLite can't ALTER-ADD.",
      },
      {
        kind: "changed",
        text: "status enum gains DRAFT (human save-draft). TEXT column → TS-only, db:generate confirms no migration.",
      },
      {
        kind: "changed",
        text: "MCP CRUD twins + workspace pages/components deferred to V2b/V2c for reviewability.",
      },
    ],
    status: "shipped",
  },
  {
    id: "0032-visit-log-reconcile",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-26",
    tag: "0032",
    area: "Tesla / Visits",
    title: "Visit-log reconcile — engagement visit_type + GPS provenance (0032 V1)",
    summary:
      "First slice of the location-source-agnostic visits & discovery plan (docs/0032). Reconciles showroom_visit_log toward 0022 §5.1 so the Visit Logs workspace (next) has what it needs: an engagement-depth visit_type (SOFT_ARRIVAL/BROWSED_NO_CONTACT/BRIEF_NO_HELP/FULL_SESSION/APPOINTMENT) distinct from the deprecated contact-axis type, plus match_distance_m + provenance_json for the GPS-attestation story. Widened gps_source for the multi-source ingress. Rating 1-5 enforced in the API layer (SQLite can't ALTER-ADD a CHECK). Migration 0147 = three additive ADD COLUMNs.",
    migrations: ["0147"],
    changes: [
      {
        kind: "migration",
        text: "0147 — showroom_visit_log ADD visit_type (engagement enum, default SOFT_ARRIVAL), match_distance_m, provenance_json. Three additive ADD COLUMNs.",
      },
      {
        kind: "added",
        text: "visit_type = engagement depth of the visit (the quality signal for visit history / future GPS-attested reviews), separate from the contact channel which lives on showroom_store_contact_log.type.",
      },
      {
        kind: "changed",
        text: "stageSoftArrival/finalizeSoftArrivals populate match_distance_m (park-to-store distance) + provenance_json (raw fix + active-drive id); gps_source enum widened (+ tesla-poll, phone, ai).",
      },
      {
        kind: "changed",
        text: "hitl_queue_id + the store/hitl XOR rule deferred to D1 (avoids a dangling FK before the showroom_store_hitl_queue table exists).",
      },
    ],
    status: "shipped",
  },
  {
    id: "api-auth-bearer",
    branch: "claude/api-auth-bearer",
    date: "2026-07-27",
    area: "Auth",
    title: "Accept raw WORKER_API_KEY as a Bearer token",
    summary:
      "The auth gate accepted only the remodel_access cookie (= SHA-256 of WORKER_API_KEY), so server-to-server clients holding the raw key — the codra review bot, QC scripts — couldn't authenticate and their API tests 401'd. The gate now also accepts the raw key via Authorization: Bearer / x-worker-api-key header. No schema.",
    changes: [
      {
        kind: "fixed",
        text: "isRequestAuthenticated now accepts the raw WORKER_API_KEY via 'Authorization: Bearer <key>' or an 'x-worker-api-key' header (header channel only), in addition to the existing remodel_access cookie = SHA-256(key). The cookie remains hash-only — it does not accept the raw key, so a stolen cookie can't reveal the reusable secret (codra security review).",
      },
      {
        kind: "changed",
        text: "Both comparisons use a constant-time compare instead of ===, so the secret-matching paths don't leak via early-exit timing.",
      },
      {
        kind: "added",
        text: "One change to the shared gate covers both the _worker.ts SSR admin gate and the requireAccessAuth API middleware — codra and QC can now hit admin-gated endpoints with just the key.",
      },
    ],
    status: "staged",
  },
  {
    id: "0037-shopping-sidebar-ia",
    branch: "claude/shopping-sourcing-sidebar-41f368",
    date: "2026-07-26",
    area: "Shopping",
    title: "Nested collapsible shopping sidebar + IA (0037 Phase 0)",
    summary:
      "The flat 15-item Shopping & Sourcing sidebar (tiny 10px text, no submenus, no way to collapse it) becomes a nested, icon'd, collapsible tree, and the whole admin sidebar gains a collapse-to-rail toggle that reflows the page with no SSR flash. Pure frontend — no migration, no API.",
    changes: [
      {
        kind: "changed",
        text: "SidebarItem is now a recursive tree: optional href, icon, children[], and navigateOnExpand (a submenu parent that both navigates to its section landing and expands). Additive — existing flat groups are unchanged.",
      },
      {
        kind: "added",
        text: "NavNode renders arbitrary-depth submenus, collapsed by default, auto-expanding the active branch's ancestors from the SSR path (no post-hydration flip). A navigateOnExpand parent is a link; a separate chevron button peeks in place without leaving the page.",
      },
      {
        kind: "added",
        text: "Collapse-to-rail: AdminSidebar toggles w-64 ↔ a w-14 icon rail (one icon per admin section + expand/home/config), persisted in a remodel_sidebar_collapsed cookie.",
      },
      {
        kind: "added",
        text: "BaseLayout seeds the collapse state server-side from the cookie and drives BOTH the fixed aside width AND the content padding off a single --sidebar-w CSS var keyed on <html data-sidebar-collapsed>, so one client toggle reflows the layout with no flash.",
      },
      {
        kind: "changed",
        text: "Per-section and per-item lucide icons added; group-header text bumped from text-[10px] to text-xs for readability.",
      },
      {
        kind: "changed",
        text: "Shopping group re-authored into three nested submenus — Showrooms (Drive Lists, Contacts, Sales & Clearance, Showroom Intake), Brands & Products (Materials, Products, Wishlist, Deep Research, Shopping Journal), Purchase Ops → Review (Price Cards, Product Photos) + Receipt Review — and the /admin/shopping hub landing regrouped to match, on the standard page shell.",
      },
    ],
    status: "staged",
  },
  {
    id: "0037-showrooms-grouped-table",
    branch: "claude/showrooms-grouped-table",
    date: "2026-07-26",
    area: "Shopping",
    title: "Showrooms grouped-table (0037 Phase 2)",
    summary:
      "The Showrooms directory is rebuilt from a card/hub-accordion into a grouped, space-efficient table wired to live data — region tabs with live counts + geolocation, a group-by switcher, closed-store collapse, a cards/rows toggle, and a detail modal with Google Maps + Tesla navigation. No new endpoints, no migration.",
    changes: [
      {
        kind: "added",
        text: "Region tabs (from HUB_LABEL: SF / South Bay / Peninsula / East Bay / North Bay / Central Valley / All) with live badge counts; geolocation auto-selects the nearest region (falls back to SF), with a subtle 'auto-selected by location' note.",
      },
      {
        kind: "added",
        text: "Group-by switcher — Sales Category (default) / Rating / Flagship / Closing Time; each group header shows count + avg rating + open-now count.",
      },
      {
        kind: "added",
        text: "Open stores sort first by earliest closing time; closed stores fold into an expandable 'N closed now — name, name…' banner (dimmed cards/rows on expand).",
      },
      {
        kind: "added",
        text: "Cards ↔ Rows toggle (cards reuse ShowroomMergedCard; rows are a compact keyboard-accessible table). Lean filter bar: search, business-model type chips, Open Now (via hours-status), visit status (All/Unvisited/Visited).",
      },
      {
        kind: "added",
        text: "Detail modal — full 7-day hours (today highlighted) + Call (tel:) / Website / Google Maps nav / Tesla Nav (POST /api/tesla/navigate) / View full details.",
      },
      {
        kind: "changed",
        text: "Default tab map→grouped; view toggle is Grouped/Map (the old list/directory views were superseded by grouping; their deep-links redirect to grouped). Map view preserved. Reuses the existing fetch + meta endpoints — no new data endpoints.",
      },
    ],
    status: "staged",
  },
  {
    id: "changelog-live-phases",
    branch: "claude/changelist-phases-live-updates-6cfa61",
    date: "2026-07-26",
    area: "Changelog",
    title: "Phase-grouped, live-updating preview changelog tasks",
    summary:
      "Plan tasks on the preview changelog were a single flat list that only updated on a full reload. They now group into collapsible phase sections (per-phase progress bar, PR chips, a 'pending PR' badge) and update LIVE — the page polls every 10s and holds a websocket to the plan's room, so as an agent works a task the user's open page reflects it with no refresh. New update_plan_task MCP tool lets agents tick one task at a time (in_progress → in_review+PR → done+PR).",
    changes: [
      {
        kind: "added",
        text: "Preview changelog task list groups by phase into collapsible sections, each with a per-phase progress bar, PR-count, per-task PR chip (#123), and a 'pending PR' badge when a phase's work has all landed but nothing merged.",
      },
      {
        kind: "added",
        text: "Live updates: the viewport polls GET /api/changelog/proposals/:slug every 10s AND holds a websocket to /api/realtime/plans?room=plan:<slug>; any poke triggers an immediate refetch. A Live/Polling indicator shows which is active.",
      },
      {
        kind: "added",
        text: "update_plan_task MCP tool — per-task status/prNumber/notes ticks so a session keeps the board honest (in_progress → in_review+PR → done+PR).",
      },
      {
        kind: "added",
        text: "updatePlanTask() service + /api/realtime/plans gateway — every task write fans a poke out of the shared EstimateCollabHub DO (room plan:<slug>). Best-effort; a downed hub never fails the write.",
      },
      {
        kind: "changed",
        text: "PATCH /api/admin/plans/tasks/:id now accepts prNumber/changelogSlug/progressPct and the in_review status, and routes through the shared service so it publishes too.",
      },
      {
        kind: "fixed",
        text: "in_review was in the plan_tasks DB enum (0028) but missing from rollup(), admin validation, the proposal schema, and the frontend — now consistent across every read/write/render surface.",
      },
    ],
    status: "staged",
  },
  {
    id: "delete-showroom-mcp-include-inactive",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    date: "2026-07-25",
    area: "Showrooms",
    title: "delete_showroom MCP tool (soft delete) + includeInactive list param",
    summary:
      "An AI cleaning up junk showrooms in chat couldn't remove them — there was no MCP delete. Added delete_showroom, a soft delete that flips is_active=0 (row + history kept, restorable via restore:true), for genuine junk (not duplicates — those go through dedup_showroom_stores). list_showrooms (MCP) and GET /api/showroom-stores now take includeInactive (default false), so inactive rows are hidden unless explicitly requested.",
    changes: [
      {
        kind: "added",
        text: "delete_showroom MCP tool — soft delete (is_active=0) of a junk store; restore:true un-deletes. Idempotent, DESTRUCTIVE annotation, returns {id,name,isActive,changed,url}.",
      },
      {
        kind: "added",
        text: "includeInactive param (default false) on list_showrooms (MCP) and GET /api/showroom-stores; each list row now carries isActive. Default behavior unchanged — active-only.",
      },
    ],
    status: "staged",
  },
  {
    id: "tesla-live-ticker",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-26",
    tag: "0023",
    area: "Tesla / Ingest",
    title: "Drive-scoped matching + opt-in auto-nav + live parsed-event ticker",
    summary:
      "Three fixes from a real drive where the system mis-attributed a stop and pushed the car a navigation command to a place the driver never chose. The stop matcher is now scoped to THE active drive (is_active) instead of every status=active list — a week-old list was false-checking a stop 190m away on the same block and auto-navigating the car to that list's next stop. Auto-navigation is now OPT-IN (default off). And while telemetry is live, the global admin alert rotates the newest PARSED frames (gear · speed · battery · coords) across the top of every page.",
    changes: [
      {
        kind: "fixed",
        text: "drive-geo-match.loadActiveStops scoped to is_active=true (THE active drive), not status=active (many stale lists). No active drive → no candidates → no false match. This is what mis-attributed a Fourth-St-Berkeley park to Farrow & Ball off a week-old list.",
      },
      {
        kind: "changed",
        text: "Auto-navigation is OPT-IN — new tesla_auto_navigate config flag (default false), gated in both the poller and the stream DO. Commanding the vehicle to a next stop the driver didn't choose must be explicit.",
      },
      {
        kind: "added",
        text: "GET /api/tesla/stream/events — newest parsed telemetry frames (TESLA_DB), pre-formatted (gear/speed/battery/coords) for display.",
      },
      {
        kind: "added",
        text: "AdminTeslaAlert: while telemetry is live, polls parsed frames every 5s and rotates them (~3s each) across the top of every admin page.",
      },
      {
        kind: "changed",
        text: "POST /api/tesla/stream/control accepts + returns autoNavigate. No schema change (flag in project_system_variables) → no migration.",
      },
      {
        kind: "fixed",
        text: "Ticker polish (#264): dropped aria-live from the rotating line (screen-reader spam), paused rotation while the tab is hidden, and guarded loadEvents so a late fetch can't repopulate frames after telemetry goes inactive. gating single-key lookup uses eq() + JSDoc.",
      },
    ],
    status: "staged",
  },
  {
    id: "tesla-visit-sessions",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-25",
    tag: "0023",
    area: "Tesla / Ingest",
    title: "Visit sessions — park → soft arrival, drive-away → finalize",
    summary:
      "The IFTTT core: a new showroom_visit_log table (two-row model) and the pipeline wired into the stream DO. On a park at a registered showroom during an active drive, a TESLA_SOFT_ARRIVAL draft is staged; on drive-away it's finalized into a TESLA_STAGED row with departure + dwell, linked by a UNIQUE soft_arrival_id so finalize is idempotent.",
    migrations: ["0140"],
    changes: [
      {
        kind: "migration",
        text: "0140 — showroom_visit_log: store_id/drive_list_id/stop_id FKs, arrival/departure/dwell, status + type enums, rating, notes_markdown+html, GPS provenance, and a partial-UNIQUE soft_arrival_id self-reference. Validated on local D1.",
      },
      {
        kind: "added",
        text: "services/tesla/visit-sessions.ts — stageSoftArrival (park, deduped) + finalizeSoftArrivals (drive-away, idempotent via onConflictDoNothing on the unique index).",
      },
      {
        kind: "changed",
        text: "TeslaStreamDO: onPark stages a soft arrival (unless home); the shift P→moving transition finalizes. Private connect() renamed connectStream() (fixes a latent DO-RPC tsc collision from #242).",
      },
      {
        kind: "added",
        text: "GET /api/tesla/visits — list the visit log with the store name JOINed (?status/?limit).",
      },
      {
        kind: "fixed",
        text: "worker-configuration.d.ts regenerated so Env carries the TESLA_STREAM binding (#242 added it but never regenerated types).",
      },
    ],
    status: "staged",
  },
  {
    id: "tesla-admin-alert",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-25",
    tag: "0023",
    area: "Tesla / Ingest",
    title: "Global admin telemetry alert + vehicle compositor image",
    summary:
      "A banner across every /admin page that appears only when a drive list is active. It shows whether telemetry is live, offers a one-click Enable button when a drive is active and it's inside the 7 AM–8 PM window with the toggle off, and — when the stream is live — renders the compositor image of the actual car from Tessie's vehicle_config.",
    changes: [
      {
        kind: "added",
        text: "services/tesla/vehicle-image.ts — builds Tesla's public compositor URL from vehicle_config (car/paint/wheel option-code maps ported from the operator's iOS app), Model 3/Y only, cached in KV for a day.",
      },
      {
        kind: "added",
        text: "GET /api/tesla/stream/banner — one cheap aggregate (D1/KV, no DO round-trip): activeDrive, telemetryActive, withinWindow + a 12-hour window label, canEnable, and vehicleImageUrl when live.",
      },
      {
        kind: "added",
        text: "components/AdminTeslaAlert.tsx mounted in BaseLayout (admin-only) after AppHeader: 'Drive list active' + telemetry state, an Enable-telemetry button, and the car image; polls every 20s, self-hides on 404 / no active drive.",
      },
    ],
    status: "staged",
  },
  {
    id: "drives-schema-foundation-entity-cleanup",
    branch: "claude/drive-list-ops-b-notes-rating-skip",
    date: "2026-07-25",
    area: "Drives",
    title: "Drive schema foundation + HTML-entity cleanup + meta repair",
    summary:
      "Adds the schema the 0031 ops overhaul builds on and fixes the reported 'Wall &amp; Floor' rendering. createDriveList now decodes HTML entities in title/description/notes/stop fields and slugifies the decoded title; migration 0140 backfills existing rows (0 encoded titles remain) and adds the drive_list_notes table (backfilled from the legacy notes JSON) plus drive_list_stops kind/suggested/skipped columns. enforceStreamWindow proactively stops the Tesla stream DO at the 20:00 window close. Also repaired a forked drizzle meta chain that was breaking db:generate repo-wide, and regenerated the TESLA_STREAM binding into worker-configuration.d.ts.",
    changes: [
      {
        kind: "fixed",
        text: "HTML entities in MCP-created drives (e.g. 'Wall &amp; Floor') are decoded at create time and backfilled on existing rows; slugs derive from the decoded title. 0 encoded titles remain on remote.",
      },
      {
        kind: "added",
        text: "drive_list_notes table (drive-global or per-stop; source user|ai; read_at collapse state) — migrates the legacy drive_lists.notes JSON into rows (113).",
      },
      {
        kind: "added",
        text: "drive_list_stops.kind (core|optional|pitstop, backfilled from is_optional), suggested, skipped, skipped_at.",
      },
      {
        kind: "changed",
        text: "enforceStreamWindow proactively POSTs TeslaStreamDO /stop when it deactivates a drive at the 20:00 boundary, closing the duration-billed-socket gap.",
      },
      {
        kind: "fixed",
        text: "Repaired a forked drizzle meta chain (0137/0138 both off 0136; 0139 missing 0137's rooms columns) that broke db:generate repo-wide, and added the TESLA_STREAM binding to worker-configuration.d.ts (#242 missed it).",
      },
      {
        kind: "migration",
        text: "0140_useful_psylocke — drive_list_notes + drive_list_stops columns + entity/notes/kind backfill. Applied to remote.",
      },
    ],
    migrations: ["0140_useful_psylocke"],
    status: "staged",
  },
  {
    id: "showroom-dedup-merge-and-guards",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    date: "2026-07-25",
    area: "Showrooms",
    title: "Dedup = true merge (soft-delete + remap children) + duplicate-creation guards",
    summary:
      "dedup_showroom_stores now MERGES: it remaps every child/support row from a duplicate onto the keeper (deduping links/hours/mappings so a merge never creates a second website link or trips a unique index) and SOFT-DELETES the duplicate (is_active = 0), never a hard delete. And a shared findDuplicateStore guard now blocks creating a store that already exists — by place_id, phone, website host, or normalized address — wired into the create endpoint and the create_showroom / import_showroom_from_place MCP tools. Also removed the unsupported `remote` field from secrets_store_secrets and upgraded wrangler to 4.114.0.",
    changes: [
      {
        kind: "changed",
        text: "dedup_showroom_stores: merge semantics — remap child rows (notes/ratings/pocs/contacts/sales/images/price/drive-stops/journal/research/scan/pages/sitemap/photos + dedup-aware links/hours/tag/category/pa/product/brand mappings) to the keeper, then soft-delete the duplicate store (is_active=0). No hard deletes.",
      },
      {
        kind: "added",
        text: "findDuplicateStore(db, {placeId, phoneNumber, websiteUrl, locationAddress}) — shared guard matching an active store by place_id / phone (digits) / website host / normalized address.",
      },
      {
        kind: "added",
        text: "Duplicate-creation guard wired into POST /api/showroom-stores (409 with matchedOn) and the create_showroom + import_showroom_from_place MCP tools (return the existing row instead of creating a copy).",
      },
      {
        kind: "fixed",
        text: "Removed the `remote` field from 24 secrets_store_secrets bindings (newer wrangler rejects it, failing every wrangler command); upgraded wrangler ^4.100.0 -> ^4.114.0.",
      },
      {
        kind: "added",
        text: "scripts/0119-soft-delete-showroom-duplicates.sql — one-shot SQL to soft-delete the 59 existing re-seed duplicates (superseded by the merge tool for future cleanup).",
      },
      {
        kind: "changed",
        text: "dedup now groups by normalized NAME (not name+city), so a stub filed under a different city than its real record — Concreteworks (Alameda) vs (San Leandro), etc. — is caught. Distinct multi-branch chains stay safe via the >=2-real-rows skip guard.",
      },
      {
        kind: "fixed",
        text: "apply now reports totalActiveAfter from a live COUNT and keeps storesSoftDeleted separate from childRowsMoved, fixing a miscount that summed store + dropped-link rows.",
      },
    ],
    status: "staged",
  },
  {
    id: "tesla-stream-ui",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-25",
    tag: "0023",
    area: "Tesla / Ingest",
    title: "Drive-list streaming toggle + live status pill",
    summary:
      "The on/off button for the streaming DO, on the Showroom Drives page, with a live pill that shows which ingest path is running: Streaming (DO holds the socket), Polling (fallback while a drive is active), or Idle (no active drive) — plus a Tripped state when the circuit breaker is set. The subline always says why, so the mode is never a mystery.",
    changes: [
      {
        kind: "added",
        text: "components/drives/TeslaStreamControl.tsx — a Switch bound to POST /api/tesla/stream/control and a status pill polling /control + /status every 15s (Streaming / Polling / Idle / Tripped, with an explanatory subline). Hides itself when the routes 404 on a not-yet-deployed worker.",
      },
      { kind: "changed", text: "DriveListsApp.tsx mounts the control above the drive tabs." },
    ],
    status: "staged",
  },
  {
    id: "tesla-stream-do",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-25",
    tag: "0023",
    area: "Tesla / Ingest",
    title: "TeslaStreamDO — the outbound Fleet-Telemetry connector",
    summary:
      "The Durable Object that finally fills TESLA_DB, built cost-safe from the first line. An outbound Tessie WebSocket is duration-billed, so the DO holds it ONLY while a drive is active in the 07:00–20:00 window with the toggle on, and drops it the instant that goes false (window close / car home / toggle off / drive end). Native alarms only, circuit breaker on every fire (kill-switch + fire-rate + per-day write budget + max-connected). Idle ⇒ DO evicted ⇒ ~$0.",
    migrations: ["v16"],
    changes: [
      {
        kind: "added",
        text: "durable-objects/tesla-stream.ts — singleton DO dialing streaming.tessie.com/<vin>. Every native-alarm fire re-checks shouldStreamNow and hard-stops on any circuit-breaker trip. Frames parse via the shared extractTelemetryFields; persistence is throttled (always on shift change, else ≤5s) to bound D1 writes; on shift→P it mirrors the poller (match+mark visited, auto-nav next, close the drive on home arrival).",
      },
      {
        kind: "added",
        text: "POST /api/tesla/stream/start|stop, GET /api/tesla/stream/status (admin) via the DO stub; drive activation now signals the DO so ingest is event-driven.",
      },
      {
        kind: "migration",
        text: "v16 — new_sqlite_classes TeslaStreamDO; TESLA_STREAM binding in wrangler.jsonc; exported from _worker.ts (OAuthProvider wrapper untouched).",
      },
      {
        kind: "fixed",
        text: "Poll cadence floored at 60s (KV rejects sub-60 TTL; cron is per-minute) with a defensive Math.max; the connected flag carries a heartbeat so a crashed DO can't suppress the poller fallback (stale >5min → false). (codra follow-ups to #241.)",
      },
    ],
    status: "staged",
  },
  {
    id: "receipt-review-hitl",
    branch: "claude/receipt-review-hitl-4808",
    date: "2026-07-25",
    area: "Shopping",
    title: "Receipt Review HITL page — confirm/correct room placements",
    summary:
      'The human-in-the-loop surface for the receipt→material→room deduction engine (0030). A receipt-grouped queue at /admin/shopping/receipt-review: each card is one receipt (invoiceId), each row a line item with the engine\'s proposed room, confidence, and reasoning. A per-row dropdown offers the eligible candidate rooms plus "Other room…" — which opens a modal (RoomSelect over ALL rooms, floor-grouped) for the cases the engine gets wrong. "Confirm all" resolves each proposal via POST /api/materials/room-proposals/:id/resolve, minting the material against the chosen roomId FK. Frontend-only: no schema, no new endpoints.',
    changes: [
      {
        kind: "added",
        text: "New page /admin/shopping/receipt-review (thin Astro shell + ReceiptReviewApp island), plus a sidebar link under Shopping & Sourcing.",
      },
      {
        kind: "added",
        text: 'Per-line room dropdown of eligible candidates, and an "Other room…" entry opening a full-room RoomSelect modal for way-wrong guesses.',
      },
      {
        kind: "changed",
        text: "Confirm resolves each staged proposal against a roomId FK (never a denormalized room name) via the #236 resolve endpoint; nothing commits to the materials schedule until the owner confirms.",
      },
    ],
    status: "staged",
  },
  {
    id: "drives-map-fix-card-actions",
    branch: "claude/drive-list-ui-improvements-b58ece",
    date: "2026-07-25",
    area: "Drives",
    title: "Route map renders again + tighter stop-card action strip",
    summary:
      "The drive route map (MapLibre, no API key) renders only when a shown stop has coordinates, and falls back to an empty pin icon otherwise. The landing list already coalesced a stop's coords from its linked showroom for markers, but GET /api/drive-lists/:slug did not — so a drive whose stops were created without their own lat/lng showed a blank map even though the linked showrooms are geocoded. Added fillMissingStopCoords (service) and call it in the :slug handler: 9/23 → 23/23 drives now render a map (28 → 94 linked stops carry coords). Also: Tesla control moved inside the same rounded bg-muted container as the address + Navigate bar at matched height (one control strip), and the hours badge enlarged + phone turned into a large min-h-12 tap-to-dial button.",
    changes: [
      {
        kind: "fixed",
        text: "GET /api/drive-lists/:slug now backfills each stop's missing lat/lng from its linked showroom (fillMissingStopCoords). Previously only the landing-list markers did this, so 14 of 23 drives rendered a blank pin icon instead of a route map despite linking geocoded showrooms.",
      },
      {
        kind: "changed",
        text: "Stop-card action row: the Tesla button now sits inside the same rounded bg-muted container as the address + Navigate bar, at matched min-h-14 height, reading as one control strip (was a separate raised secondary button outside the background).",
      },
      {
        kind: "changed",
        text: "Hours badge enlarged to text-base; phone number is now a large min-h-12 rounded tap-to-dial button (tel:) sized for Tesla / phone touch targets, not a small ghost badge.",
      },
    ],
    status: "staged",
  },
  {
    id: "showroom-dedup-hardening",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    date: "2026-07-25",
    area: "Showrooms",
    title: "dedup tool hardening — fix a link-duplication bug + Codra review fixes",
    summary:
      "Hardening the dedup_showroom_stores tool before it is run. The v1 reparented EVERY child FK, but the seed inserts a WEBSITE link per store and showroom_store_links has no unique index — so v1 would have given each kept store a second website link. v2 uses a per-table policy: reparent user data, drop redundant/seeded/scrape/mapping rows via cascade. Also addresses Codra's review: fully-typed Drizzle builders (no raw SQL), db.batch() writes, column-selected load, typed result helper, JSDoc.",
    changes: [
      {
        kind: "fixed",
        text: "dedup would duplicate the kept store's website link: the seed adds a WEBSITE row per store and showroom_store_links has no unique index, so reparenting a shell's link created a second link. Links (and other seeded/scrape/mapping rows) are now DROPPED via ON DELETE CASCADE, not moved.",
      },
      {
        kind: "changed",
        text: "Per-table policy: reparent user data (notes/ratings/pocs/contacts/sales/images/price/drive-stops/journal); drop redundant/scrape/mapping rows; explicit-delete the 4 non-cascade artifact tables before the store delete.",
      },
      {
        kind: "changed",
        text: "Codra review fixes: replaced raw sql.raw with typed Drizzle builders, batched writes via db.batch() in <=90-param chunks, load only the 11 columns needed, single changesOf() result helper, JSDoc on the export.",
      },
    ],
    status: "staged",
  },
  {
    id: "tesla-stream-lifecycle-control",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-25",
    tag: "0023",
    area: "Tesla / Ingest",
    title: "Streaming-ingest lifecycle control + shared frame extractors",
    summary:
      "Foundation for the TeslaStreamDO: the single decision surface for when the outbound Tessie socket may be alive (duration-billed, so it must earn its keep), plus the frame parsing both ingest paths share. The stream is alive only when a drive is active, it's 07:00–20:00 Pacific, recording is on, and the UI toggle is on; otherwise the poller falls back on a configurable cadence. Exactly one of stream/poll ever covers an active drive.",
    changes: [
      {
        kind: "added",
        text: "services/tesla/gating.ts — project_system_variables-backed stream control (toggle, window hours, poll-fallback cadence, DO connected flag) in one batched read; Pacific-aware isWithinStreamWindow (Intl, DST-correct); shouldStreamNow/shouldPollNow decision predicates; enforceStreamWindow deactivates a drive once the window closes.",
      },
      {
        kind: "added",
        text: "GET/POST /api/tesla/stream/control — admin toggle + window + cadence, with inverted-window rejection.",
      },
      {
        kind: "changed",
        text: "services/tesla/frames.ts — extractCoord + extractTelemetryFields lifted verbatim out of routes/tesla.ts so the DO and the compat webhook/telemetry routes parse frames identically (ING-01).",
      },
      {
        kind: "changed",
        text: "tesla-poller.ts is now the explicit FALLBACK path: stands down (reason 'stream-active') when the stream carries ingest, and throttles on the configurable cadence instead of a hardcoded 120s.",
      },
      {
        kind: "changed",
        text: "Drive activation is time-gated — PATCH /api/drive-lists/:slug {isActive:true} returns 409 outside 07:00–20:00; deactivation always allowed. _worker scheduled() runs enforceStreamWindow each minute.",
      },
    ],
    status: "staged",
  },
  {
    id: "showroom-store-dedup-tool",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    date: "2026-07-25",
    area: "Showrooms",
    title: "dedup_showroom_stores — safe, dry-run-first cleanup of re-seed duplicates",
    summary:
      "The bootstrap-only guard stopped NEW duplication; this is the cleanup tool for the ~60 rows already cloned by the seed running 3×. An admin-gated MCP tool groups stores by (name, city), keeps the most-enriched row, and — only after a human approves the dry-run map — reparents every child FK and deletes the duplicates. Distinct chain branches sharing a (name, city) are detected and skipped, never merged.",
    changes: [
      {
        kind: "added",
        text: "dedup_showroom_stores MCP tool (DESTRUCTIVE, dry-run by default). Dry run reports the keep/delete map + child-row counts across all 28 FK columns; apply:true reparents children then deletes losers in db.batch-safe, 90-param-chunked steps.",
      },
      {
        kind: "added",
        text: "Anti-merge guard: a (name, city) group with ≥2 'real' rows (each with its own zip/placeId) is treated as distinct locations and skipped — 'All Natural Stone' in four cities is never collapsed.",
      },
    ],
    status: "staged",
  },
  {
    id: "brands-name-key-dedup",
    branch: "claude/showroom-location-tagging-ex2ik5",
    date: "2026-07-25",
    tag: "ops #4",
    area: "Brands",
    title: "Last duplicate merged + durable name-key guard",
    summary:
      "8 of 9 duplicate brand pairs were already merged; the last (Visual Comfort & Co. #221 → Visual Comfort #184, both visualcomfort.com) was merged on remote D1 — colliding type-mapping dropped, showroom mapping repointed (#184 now carries showrooms 121+136), loser spelling kept as a demoted alias, scalars COALESCE'd, #221 soft-retired. A partial unique index on a normalized name key now stops two ACTIVE brands sharing a case/spacing restatement.",
    status: "staged",
    migrations: ["0138"],
    changes: [
      {
        kind: "fixed",
        text: "Merged the last live duplicate brand pair (Visual Comfort #184 ⟵ Visual Comfort & Co. #221) on remote D1; 0 mechanical name-key collisions remain among active brands (385 → 384).",
      },
      {
        kind: "added",
        text: "brands_name_key_uniq — PARTIAL unique index on replace(replace(replace(lower(trim(name)),' ',''),'.',''),',','') WHERE is_active=1, blocking case/spacing restatements of the same brand.",
      },
      {
        kind: "migration",
        text: "0138 creates the index; applies via migrate:remote (does not ride the build).",
      },
    ],
  },
  {
    id: "showroom-seed-bootstrap-only",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    date: "2026-07-25",
    area: "Showrooms",
    title: "Showroom store seed is bootstrap-only (re-runs can't duplicate rows)",
    summary:
      "seedShowroomStores inserted a fixed list of stores with no natural key, so re-running it against a populated table cloned every row. A repeated POST /api/showroom-stores/seed did exactly that in production — 213 rows where there should be 146, with 'Whole Wood' appearing three times. The seed now skips entirely if any store already exists.",
    changes: [
      {
        kind: "fixed",
        text: "seedShowroomStores now short-circuits (returns { inserted: 0, skipped }) the moment any showroom_stores row exists, so it only ever populates an empty directory. This stops any further duplication from a repeated seed.",
      },
      {
        kind: "changed",
        text: "Documented that the seed is bootstrap-only and carries no natural key, so it must never run against a populated table.",
      },
    ],
    status: "staged",
  },
  {
    id: "tesla-location-ai-p6",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-25",
    tag: "0023",
    area: "Tesla / Location AI",
    title: "Location AI — enriched get_vehicle_location + whats_near_me",
    summary:
      "The two MCP tools an in-car assistant needs to answer 'where am I / which way am I heading / what's worth stopping at?', enriched by the worker and quota-safe. get_vehicle_location now returns heading + compass, a reverse-geocoded address, region, and freshness; whats_near_me ranks registered showrooms by distance and bearing and can sweep Google Places for undiscovered nearby spots.",
    changes: [
      {
        kind: "changed",
        text: "get_vehicle_location enriched in place: heading + headingCompass (Tessie /location now parsed for heading + fix-time, both fail-soft), a resolved street address (Tessie's own, else a quota-gated Geocoding-SKU reverseGeocode that degrades to null rather than billing), Bay Area region, and freshness (serverTime, ageSeconds, isStale — unknown age is treated as stale).",
      },
      {
        kind: "added",
        text: "whats_near_me MCP tool: ranks registered showrooms around the driver by straight-line distance with a compass bearing + miles; includeUndiscovered also sweeps quota-gated placesNearby for spots not yet in the directory (de-duped against known showrooms; an empty return is reported as possibly-quota-blocked). Location resolves explicit → live Tesla GPS → last phone fix.",
      },
      {
        kind: "added",
        text: "initialBearing() + compassFromBearing() geo primitives alongside haversineMeters in drive-geo-match, and loadShowroomCoords() — a single coordinate-source helper so the anticipated move of location data off showroom_stores is a one-line change, not a scattered rewrite.",
      },
      {
        kind: "changed",
        text: "TeslaLocation gains heading + timestampMs (both fail-soft); getLocation() normalizes Tessie's seconds-or-ms fix timestamp.",
      },
    ],
    status: "staged",
  },
  {
    id: "0029-health-platform",
    branch: "claude/backend-health-checks-d1-d6df78",
    date: "2026-07-22",
    tag: "0029",
    area: "System / Health",
    title: "Health platform — 88 probes, a D1 catalogue, and a runbook per test",
    summary:
      "The health surface went from 5 hardcoded binding pings to 88 probes contributed by 17 backend modules. Each probe carries its own documentation — what success means, what failure means, how to troubleshoot it — which is upserted into health_test_def on every run, so the runbook on the page is generated from the code that ran. The first real session found two genuine faults nobody was watching.",
    changes: [
      {
        kind: "added",
        text: "17 module health.ts files (db, api, ai, mcp, realtime, workflows, ai-gateway, usage, render, email, gmail, google, google-photos, tesla, showroom, documents, image-processor) contributing 85 infrastructure probes.",
      },
      {
        kind: "added",
        text: "16 cost watchers comparing the last 24h against the trailing 7-day daily average — AI spend, tokens, Maps calls, agent runs, Durable Object volume — DEGRADED at 2x, FAILURE at 5x.",
      },
      {
        kind: "added",
        text: "/admin/system/health rebuilt as a grouped timeline: sticky section per module group, a runbook inside every row, skeleton rows and a spinner while a session runs, filters for problems and cost watchers. Mobile-first.",
      },
      {
        kind: "added",
        text: "Admin-gated POST /api/health/session, GET /api/health/{session/latest,sessions,catalogue,badge}, and the run_health_session MCP tool.",
      },
      {
        kind: "added",
        text: "A minimal health pip in the desktop header and the mobile sidebar bar, linking to the dashboard. Reads the last persisted session; never triggers a probe.",
      },
      {
        kind: "changed",
        text: "The three data-quality checks from #169 are bridged into the probe pipeline as a Data Quality group, so one run covers both and their scores land in the same session ledger. `unknown` maps to FAILURE, never SUCCESS.",
      },
      {
        kind: "changed",
        text: "/health and /admin/health 301 to /admin/system/health, behind the admin gate. The public GET /api/health is unchanged, so external uptime monitors keep working.",
      },
      {
        kind: "removed",
        text: "The public /health page, the HealthCheckApp island, SystemHealthApp, and two dead non-compiling health.ts files under src/backend/ai.",
      },
      {
        kind: "fixed",
        text: 'The sidebar had two nav groups with id "system" after #169; folded into one.',
      },
      {
        kind: "migration",
        text: "0125_supreme_dust — health_test_def, health_binding_types, health_test_binding_types, health_results (additive; applied and verified on remote).",
      },
    ],
    migrations: ["0125_supreme_dust"],
    status: "staged",
  },
  {
    id: "0026-agent-ops-transparency",
    branch: "claude/agent-ops-monitoring-plan-957a42",
    date: "2026-07-22",
    tag: "0026",
    area: "System / Agents",
    title: "Agent Ops Transparency — 27 autonomous surfaces, one ledger, four screens",
    summary:
      "Every agent execution now records what it did, why it failed and what it cost — visible at /admin/system/agents. Instrumentation went from 1 surface to 12, spend attributes to the run that caused it, and the AI Gateway cross-check immediately exposed a -54% reporting gap.",
    changes: [
      {
        kind: "added",
        text: "/admin/system/agents/queue — every run grouped by status in triage order, with a banner naming every surface that is NOT reporting.",
      },
      {
        kind: "added",
        text: "/admin/system/agents/queue/[id] — step trace, collapsible tool calls, retry lineage, attributed cost, retry/cancel/approve.",
      },
      {
        kind: "added",
        text: "/admin/system/agents/failed — failures grouped by (error_code, agent, operation).",
      },
      {
        kind: "added",
        text: "/admin/system/agents/usage — AI spend per agent and per run, with live breaker state for all 7 metered providers.",
      },
      {
        kind: "added",
        text: "9 endpoints under /api/admin/agents — the first readers of the agent_runs ledger.",
      },
      {
        kind: "added",
        text: "agent-registry.ts — all 27 execution surfaces declared once; the denominator that stops an empty queue reading as a healthy one.",
      },
      {
        kind: "changed",
        text: "Instrumentation went from 1 writer to 12; AI spend attributes to its run via AsyncLocalStorage, leaving ~130 env.AI.run call sites untouched.",
      },
      {
        kind: "migration",
        text: "0123_stormy_sersi — gemini_usage_log.agent_run_id + index (additive, nullable, applied and verified on remote).",
      },
    ],
    migrations: ["0123_stormy_sersi"],
    status: "shipped",
  },
  {
    id: "markdown-mermaid-render",
    branch: "claude/markdown-mermaid",
    date: "2026-07-21",
    tag: "UI",
    area: "Changelog / Markdown",
    title: "Mermaid diagrams render everywhere markdown does",
    summary:
      "Plans and preview changelogs are supposed to be dense with Mermaid diagrams — but the markdown renderer showed the raw ```mermaid code instead of the picture. It now renders the diagram, on every markdown surface at once.",
    status: "staged",
    changes: [
      {
        kind: "fixed",
        text: "MarkdownProse's `pre` renderer detects a `language-mermaid` code fence and renders it via MermaidCn (the changelog detail page's renderer) instead of raw code — so the diagram-dense preview-changelog PRD actually shows diagrams.",
      },
      {
        kind: "changed",
        text: "Fixes every MarkdownProse surface at once (research, brands, products, changelog, mcp-ops). SSR-safe — mermaid is dynamic-imported; the diagram paints client-side where MarkdownProse is hydrated (the preview mounts the proposal bundle client:load).",
      },
    ],
  },
  {
    id: "maps-per-api-quota-hardblock",
    branch: "claude/tesla-google-quota",
    date: "2026-07-21",
    tag: "Safety",
    area: "Google Maps",
    title: "Per-API Google Maps quota hard-block",
    summary:
      "Google Maps billing is now guarded per API, not as one lump. Each SKU — Places, Geocoding, Routes — has its own monthly cap and is blocked independently, so running out of one never blocks the others and nothing spills past the free tier into charges. Two long-standing leaks are closed: a divergent guard with a milliseconds-vs-seconds boundary bug, and Places-Photo fetches that were spending real money with no counter at all.",
    status: "staged",
    changes: [
      {
        kind: "added",
        text: "isUnderApiQuota(sku) + per-SKU caps (MAPS_API_QUOTAS) + getUsageBySku() — Places methods gate on 'places', computeRouteMatrix on 'routes'; an exhausted SKU blocks only itself.",
      },
      {
        kind: "added",
        text: "reverseGeocode(lat,lng) (Geocoding SKU) and placesNearby(...) (Places SKU) — gated + logged, fail-soft (null/[]); back the location / what's-near-me tools.",
      },
      {
        kind: "fixed",
        text: "canUseGoogleMaps() recomputed its month window in milliseconds while the timestamp column is Unix seconds (~1000× off) and used a second divergent 8,000 cap — it now delegates to the SARGABLE seconds-correct count, one source of truth.",
      },
      {
        kind: "fixed",
        text: "The Places-Photo media fetches in showroom onboarding + the ShowroomResearchAgent backfill fetched a billed Places SKU with NO quota guard and NO usage log — they now gate on the Places quota and log every fetch.",
      },
      {
        kind: "changed",
        text: "GET /api/admin/integrations/usage returns by_sku + quotas; the Google Maps usage tab shows a 'Per-API hard blocks' row per SKU with the existing blocked badge.",
      },
    ],
  },
  {
    id: "do-alarm-circuit-breaker",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    date: "2026-07-21",
    tag: "Safety",
    area: "Durable Objects",
    title: "Durable Object alarm circuit breaker — a hard stop before billing runs away",
    summary:
      "A $700 bill came from one Durable Object whose alarm kept re-scheduling itself: the append-only this.schedule() grew an internal table to ~1M rows and every alarm full-scanned it (537 billion row reads). #162 fixed that path; this is the guard so it — or any future alarm DO — can never silently recur. On every alarm fire a cheap self-check runs, and on any runaway signal the breaker hard-stops: deletes the alarm, flips a global kill-switch, and refuses to run. Deliberate downtime over runaway billing.",
    status: "staged",
    changes: [
      {
        kind: "added",
        text: "services/safety/do-circuit-breaker.ts — a D1-backed global kill-switch (project_system_variables.do_circuit_breaker_tripped), a pure fire-rate window, and a schedule-table-bound check. All cheap (single-row read, SARGABLE count) so the guard never becomes the cost.",
      },
      {
        kind: "changed",
        text: "RemodelOrchestrator runs the guard at the top of every alarm fire (kill-switch → schedule-table bound → fire-rate); on a trip it deletes the alarm and hard-stops with no reschedule. onStart() respects the switch too.",
      },
      {
        kind: "added",
        text: "scripts/check-do-alarms.mjs (wired into `pnpm check`) — bans the append-only this.schedule() in new DOs; native ctx.storage.setAlarm() only.",
      },
      {
        kind: "added",
        text: "GET/POST /api/admin/integrations/circuit-breaker(/clear) + a Safety tab on /admin/integrations/usage to see the tripped reason and clear it.",
      },
    ],
  },
  {
    id: "public-health-page",
    branch: "claude/health-status-page",
    date: "2026-07-21",
    tag: "Ops",
    area: "Health",
    title: "A /health page you can actually run checks from",
    summary:
      "The bare /health URL used to 404, and the only health surface just pinged D1 and re-read a table. There is now a public /health page with a Run health checks button that actively probes the worker's core bindings — D1, the Tesla telemetry DB, KV, R2 and Workers AI — times each, and renders per-service status + latency with an overall roll-up.",
    status: "staged",
    changes: [
      {
        kind: "added",
        text: "services/health/screen.ts runHealthScreen(env) — probes each binding with a bounded, free op (SELECT 1, a KV put/get, an R2 head, an AI binding-presence check), writes one health_checks row per service via db.batch, rolls up overall (down > degraded > healthy).",
      },
      {
        kind: "added",
        text: "POST /api/health/run — on-demand trigger (public, like GET /api/health); 200 even when a service is down.",
      },
      {
        kind: "added",
        text: "/health public page + HealthCheckApp island — snapshot on mount, Run button, per-service cards (healthy/degraded/down + latency), overall roll-up.",
      },
    ],
  },
  {
    id: "drive-lists-single-active",
    branch: "claude/drive-lists-activation-ui-6f6e47",
    date: "2026-07-21",
    tag: "Drives",
    area: "Showroom Drives",
    title: "One active drive list — and tabs that match how drives actually go",
    summary:
      "Only one drive can be the active one — the drive this device auto-lands on — and D1 now enforces that with a partial unique index rather than trusting app code. The drives page groups by progress instead of by lifecycle label: Pending (nothing visited yet), In progress, Finished. The active drive wears a badge, every card has a toggle, and pulling into the driveway after 3:30pm ends the drive on its own.",
    status: "staged",
    changes: [
      {
        kind: "added",
        text: "drive_lists.is_active — the single-slot pointer, under a partial UNIQUE index so a second active row is rejected by the database, not just by code.",
      },
      {
        kind: "added",
        text: "PATCH /api/drive-lists/:slug { isActive } — set THE active drive, or clear the slot entirely. Backs the per-card toggle.",
      },
      {
        kind: "added",
        text: "Active badge + ring on the active drive's card; list_drive_lists (MCP) now returns isActive.",
      },
      {
        kind: "changed",
        text: "Landing tabs are Pending / In progress / Finished, bucketed on stops visited — replacing Active / Archived, which read the overloaded status enum.",
      },
      {
        kind: "removed",
        text: "The auto-archive-on-read and un-archive-on-check-off status juggling in GET /api/drive-lists and the stop check-off; progress is now the truth, so neither rewrites status.",
      },
      {
        kind: "added",
        text: "Getting home ends the drive: a Tesla park event — or a phone location fix — at the project address after 3:30pm local, any day of the week, clears the active slot automatically. Driving past the house doesn't count; the fix has to be a stopped one.",
      },
      {
        kind: "added",
        text: "GET /api/drive-lists/home-location — the project's coordinates, geocoded once from the configured permit address and cached in project_system_variables (home_latitude / home_longitude).",
      },
      {
        kind: "fixed",
        text: "The drive automation had no producer: it was built around a Tessie webhook that does not exist (Tessie's telemetry is a WebSocket the client dials, and its REST API is pull-only), so 0 vehicle events had EVER been received while the UI reported a healthy integration. The Worker now polls the car's cached position every 2 minutes — but only while a drive list is active, and never with a call that wakes the car.",
      },
      {
        kind: "added",
        text: "POST /api/tesla/poll — run one vehicle poll on demand (the same function the cron calls), so the path can be exercised without waiting for the schedule.",
      },
      {
        kind: "added",
        text: "/admin/config/integrations/tesla — the vehicle integration page: masked read-only credentials (values never leave the Worker), a switch for whether Fleet Telemetry is written to D1, and a health screening that checks the events already collected still carry coordinates, shift state and a VIN.",
      },
      {
        kind: "added",
        text: "A `tesla` MCP tool domain — get_tesla_status, get_vehicle_location, list_tesla_events, send_vehicle_navigation — so a chat can ask where the car is, what it has been doing, and send it somewhere. The Showroom Scout agent gets the two read tools.",
      },
      {
        kind: "changed",
        text: "Telemetry frames are only recorded when the integration is configured AND recording is switched on; the endpoint reports which gate stopped it instead of a silent success.",
      },
      {
        kind: "migration",
        text: "0119_yellow_micromax — drive_lists.is_active + drive_lists_single_active_uniq. Applied to remote; the newest drive (concord-corridor-sat-jul-18-sf-1pm) holds the slot, all 13 others cleared.",
      },
    ],
    migrations: ["0119_yellow_micromax"],
  },
  {
    id: "showroom-soft-delete",
    branch: "claude/showroom-soft-delete",
    date: "2026-07-18",
    tag: "Showrooms",
    area: "Showrooms",
    title: "Delete a showroom without destroying it",
    summary:
      "A showroom can now be removed from the directory without losing anything — the visit notes, photos, ratings and price history all survive, and it can be restored. Deleted showrooms disappear everywhere at once: the directory, the map, drives, search, the catalog, the clearance feed and the AI tools.",
    status: "staged",
    changes: [
      {
        kind: "added",
        text: "Delete showroom, from the edit modal — behind a confirm that spells out what is and isn't kept.",
      },
      {
        kind: "added",
        text: "Restore a deleted showroom — POST /api/showroom-stores/:id/restore.",
      },
      {
        kind: "changed",
        text: "DELETE /api/showroom-stores/:id is now a soft delete (is_active = 0) instead of destroying the row and everything hanging off it.",
      },
      {
        kind: "changed",
        text: "34 list/search queries now hide deleted showrooms: directory, map, catalog, product + brand pages, clearance feed, field scan, backfills, contacts matching, phonebook, MCP tools, the research agents and the cron sweeps.",
      },
      {
        kind: "migration",
        text: "0113_dapper_white_queen — showroom_stores.is_active, default true. Applied to remote: 134 stores, 134 active.",
      },
    ],
  },
  {
    id: "showroom-touch-ux",
    branch: "claude/showroom-touch-ux",
    date: "2026-07-18",
    tag: "Showrooms",
    area: "Showrooms",
    title: "Showroom viewport, usable from a Tesla touchscreen",
    summary:
      "The showroom page is used standing at the car, from a touchscreen — and everything on it was mouse-sized. The website and social links become large buttons, the open/closed badge goes full-width with a new 'Opening Soon' state, and the hours modal leads with Call / Copy address / Send to Tesla instead of burying them under a scroll.",
    status: "staged",
    changes: [
      {
        kind: "added",
        text: "Hero link row: a large Website button plus one same-size icon button per link type the showroom actually has registered (Instagram, X, LinkedIn, Facebook, Pinterest, Yelp, 360° tour, showroom photos, clearance).",
      },
      {
        kind: "added",
        text: "Links modal — every URL as a tappable hyperlink, with a pencil that flips the same modal into the add/edit form.",
      },
      {
        kind: "added",
        text: "Hours modal now leads with Call, Copy address, and Send to Tesla as large buttons; copy and navigate report success/failure inside the button, and a failed navigate prints the reason.",
      },
      {
        kind: "added",
        text: '"Opening Soon" — a fourth open/closed state for a showroom that is shut right now but opens later today.',
      },
      {
        kind: "added",
        text: "Upload photo now opens a drag-and-drop dropzone (or tap to browse) instead of a hidden file input, and accepts several photos at once.",
      },
      {
        kind: "changed",
        text: "The open/closed badge is full-width and colour-coded across all four states.",
      },
      {
        kind: "changed",
        text: "Hours, links, upload and categories modals all render at ~80% of the viewport; category checkboxes are noticeably larger.",
      },
      {
        kind: "removed",
        text: 'The hero\'s small "Edit hours" and "Edit address" buttons — both now live inside the hours modal.',
      },
    ],
  },
  {
    id: "feature-proposals",
    branch: "claude/feature-proposals-api-tools-ea0c5c",
    date: "2026-07-18",
    area: "Changelog",
    title: "Feature proposals: file an idea with the conversation behind it",
    summary:
      "A proposal bundle (PRD / design brief / PROMPT / TASKS) plus the RAW, unsummarized transcript of the chat that produced it — filed from an AI chat over MCP, from a shell with no MCP, or over HTTP, all through one shared service. Rendered at /admin/changelog/preview/:slug with a copyable PROMPT and the transcript's coverage note beside its link.",
    changes: [
      {
        kind: "added",
        text: "POST/GET /api/changelog/proposals, GET /api/changelog/proposals/:slug and /:slug/context (streams the R2 transcript).",
      },
      {
        kind: "added",
        text: "MCP tools submit_feature_proposal / get_feature_proposal / list_feature_proposals under a new `changelog` category.",
      },
      {
        kind: "added",
        text: "scripts/changelog/{submit,get,list}-proposal.mjs — same three operations for agents with no MCP connection.",
      },
      {
        kind: "added",
        text: "Preview page renders the bundle: PRD, design brief, PROMPT with a copy button, plan tasks with live status, transcript link + size + coverage note.",
      },
      {
        kind: "added",
        text: "PhaseDetail gains optional branch/prNumber/prUrl and a `verification` block (QC script, source, verbatim output, per-migration remote state) — stored in detail_json, so no migration.",
      },
      {
        kind: "changed",
        text: "Every changelog entry now surfaces its git branch AND PR number, reading PR metadata off the changelog_branches row so entries written before this still show it.",
      },
      {
        kind: "changed",
        text: "/api/changelog/proposals* is gated behind requireAccessAuth — the write path takes an arbitrarily large body into R2 and the read path returns a raw transcript.",
      },
      {
        kind: "migration",
        text: "0112_careful_gambit (changelog_proposals) applied to remote D1 and verified — 17 columns.",
      },
    ],
    migrations: ["0112_careful_gambit"],
    status: "staged",
  },
  {
    id: "changelog-preview",
    branch: "claude/changelog-preview",
    date: "2026-07-16",
    tag: "Changelog",
    area: "Changelog",
    title: "Changelog preview — review the release notes before they ship",
    summary:
      "A /admin/changelog/preview twin that lists every proposed (staged) change and renders it through the exact same template the shipped changelog uses — so the presser you sign off on is literally what deploys. The changelog itself now uses the four beste blocks it was specced for, and diagrams render with the shadcn-registry mermaid (zoom/pan).",
    status: "staged",
    changes: [
      {
        kind: "added",
        text: "/admin/changelog/preview — every proposed change, drafted as release notes before deploy",
      },
      {
        kind: "added",
        text: "/admin/changelog/preview/[slug] — full proposal viewport: diagrams, developer changelog, recap",
      },
      { kind: "added", text: "Sidebar: Changelog Preview under System" },
      {
        kind: "changed",
        text: "Changelog list now renders changelog24 (release highlights) + changelog3 (release feed)",
      },
      {
        kind: "changed",
        text: "Changelog viewport now renders changelog19 (developer changelog + code) + changelog21 (Features/Fixes/Improvements recap)",
      },
      {
        kind: "changed",
        text: "Diagrams switched to the shadcn-registry mermaid (mermaidcn) with zoom/pan",
      },
      {
        kind: "changed",
        text: "Changelog + preview share one view + one mapper, so the two can never drift",
      },
      {
        kind: "fixed",
        text: "Sidebar no longer lights up Changelog and Changelog Preview at the same time",
      },
    ],
  },
  {
    id: "showroom-editing",
    branch: "claude/showroom-stores-cleanup-775bb5",
    date: "2026-07-14",
    tag: "Phase 6",
    area: "Showrooms",
    title: "Edit hours, address & links — and smarter contact intake",
    summary:
      "Everything the cleanup normalized can now be corrected after intake — hours, address, and links — from the API, an MCP tool, or the showroom page. And a business card that carries store details now fills the showroom in automatically.",
    status: "staged",
    changes: [
      {
        kind: "added",
        text: "Correct a showroom's hours / address / links after intake — PUT /:id/hours, PUT /:id/address, /:id/links CRUD, plus a Contacts-style editor on the showroom page.",
      },
      {
        kind: "added",
        text: "MCP tools set_showroom_address + set_showroom_links (with set_showroom_hours) so an AI or a script can bulk-fill or fix these.",
      },
      {
        kind: "changed",
        text: "Creating a contact now requires a name and optionally accepts the generic showroom details a business card carries (name/address/website/socials/phone/email) — the worker matches the store and fills any missing store info.",
      },
      {
        kind: "added",
        text: "The intake form collects links; the store viewport lets you add/edit/delete them.",
      },
      {
        kind: "fixed",
        text: "The email-to-contacts flow diagram was malformed — rewritten + validated.",
      },
    ],
  },
  {
    id: "showroom-email-contacts",
    branch: "claude/showroom-stores-cleanup-775bb5",
    date: "2026-07-14",
    tag: "Phase 5",
    area: "Showrooms",
    title: "Emails become contacts automatically",
    summary:
      "When a showroom emails you, the platform reads the signature and files the sender into the phonebook — mapped to the right showroom by email domain or name. Senders it can’t place are saved as drafts for a quick one-tap map.",
    status: "staged",
    changes: [
      {
        kind: "added",
        text: "Inbound worker email (remodel@hacolby.app) auto-registers a showroom contact from the sender’s signature (name, email, phone, website), wired into the email pipeline.",
      },
      {
        kind: "added",
        text: "Domain/name matching maps the contact to the right showroom; unmatched senders are saved as draft contacts for triage in the phonebook.",
      },
      {
        kind: "changed",
        text: "Only runs when the sender isn’t already a known contractor company (those stay in the CRM), and de-duplicates on the sender email.",
      },
    ],
  },
  {
    id: "showroom-contacts",
    branch: "claude/showroom-stores-cleanup-775bb5",
    date: "2026-07-13",
    tag: "Phase 4",
    area: "Showrooms",
    title: "Contacts phonebook + business-card scanning",
    summary:
      "A real contact system for showroom reps: a searchable phonebook you can tap to call or email, a store-level general line, and bulk business-card import that reads the card with vision and files the details into the right place.",
    status: "staged",
    migrations: ["0108"],
    changes: [
      {
        kind: "added",
        text: "Contacts phonebook at Shopping → Contacts: search, type filter, A–Z quick-jump rail, and tap-to-dial / tap-to-email numbers for phone and Tesla screens.",
      },
      {
        kind: "added",
        text: "A Contacts tab on each showroom, showing that store’s general line + people.",
      },
      {
        kind: "added",
        text: "Bulk business-card import: drop in photos, a vision model extracts each card and creates the contact; cards it can’t read are flagged for a quick manual entry.",
      },
      {
        kind: "added",
        text: "Smart intake splits a person’s cell/direct/office numbers, promotes the office line to the store’s general contact, and routes the website + address to the right tables — you just send the raw details.",
      },
      {
        kind: "added",
        text: "Interaction log per contact (what was said, when, follow-ups) + MCP tools so an AI can add contacts and resolve failed cards.",
      },
    ],
  },
  {
    id: "showroom-links",
    branch: "claude/showroom-stores-cleanup-775bb5",
    date: "2026-07-13",
    tag: "Phase 3",
    area: "Showrooms",
    title: "Links table — one home for every showroom URL",
    summary:
      "Website + social URLs moved off the store row into a typed showroom_store_links table. The store viewport, directory, and API keep working unchanged — responses derive the old flat fields from the links.",
    status: "staged",
    migrations: ["0108"],
    changes: [
      {
        kind: "added",
        text: "showroom_store_links table: one row per link, typed WEBSITE / INSTAGRAM / PINTEREST / FACEBOOK / OTHER with url_notes.",
      },
      {
        kind: "added",
        text: "Send a links[] payload on create/update (replace-all), or manage them one at a time via /:id/links CRUD.",
      },
      {
        kind: "changed",
        text: "Favicon + website scrape now source the site from the WEBSITE link; the scrape writes any Instagram it finds as an INSTAGRAM link.",
      },
      {
        kind: "changed",
        text: "Flat website_url / instagram_url / facebook_url / pinterest_url columns are now DEPRECATED (superseded by the links table); kept for the one-time backfill and dropped in a follow-up migration.",
      },
    ],
  },
  {
    id: "showroom-address",
    branch: "claude/showroom-stores-cleanup-775bb5",
    date: "2026-07-13",
    tag: "Phase 2",
    area: "Showrooms",
    title: "Addresses split into real parts",
    summary:
      "City-only stubs like “San Carlos, CA” are replaced with full Google-verified addresses, broken into street number, street, city, state, and ZIP — plus a filled-in Google Maps link.",
    status: "staged",
    migrations: ["0108"],
    changes: [
      {
        kind: "added",
        text: "Granular location_street_number / _street_name / _city / _state / _zip_code columns.",
      },
      {
        kind: "added",
        text: "Address backfill from Google Places (dry-run by default) that overwrites city-only stubs with the full formatted address + maps link.",
      },
    ],
  },
  {
    id: "showroom-hours",
    branch: "claude/showroom-stores-cleanup-775bb5",
    date: "2026-07-13",
    tag: "Phase 1",
    area: "Showrooms",
    title: "Hours untangled to a single source",
    summary:
      "Opening hours were stored three different ways. Now there is ONE: the normalized showroom_store_hours rows. You write a structured hoursJson payload; the worker turns it into rows + the open-weekends flag, and responses rebuild the payload from the rows.",
    status: "staged",
    migrations: ["0108"],
    changes: [
      {
        kind: "changed",
        text: "showroom_store_hours rows are now the SOLE source of truth; the hours_json blob is superseded (kept as deprecated for the one-time backfill, dropped in a follow-up migration).",
      },
      {
        kind: "changed",
        text: "Renamed the normalized table showroom_hours → showroom_store_hours.",
      },
      {
        kind: "changed",
        text: "Redundant free-text weekday_hours / weekend_hours columns are deprecated (backfill source only).",
      },
      {
        kind: "added",
        text: "API create/update accept a hoursJson payload → rows; GET responses derive hoursJson from the rows. New MCP tool set_showroom_hours.",
      },
      { kind: "fixed", text: "Deduplicated the hours parser (two copies) onto one shared util." },
    ],
  },
  {
    id: "email-structured-extraction",
    branch: "claude/email-structured-extraction",
    date: "2026-07-14",
    area: "Inbox",
    title: "Structured email extraction via responseSchema",
    summary:
      "Gemini email analysis now emits structured output against a native responseSchema, capturing merchant type, order number, delivery date, discount, shipping, and per-item brand/model/variant — and a guard drops the phantom 'total not stated' payment flag when a total was actually extracted.",
    changes: [
      {
        kind: "fixed",
        text: "Phantom 'total is not stated — check your payment method' flag on receipts whose total is printed (e.g. the Costco order).",
      },
      {
        kind: "changed",
        text: "classify.ts now passes config.responseSchema (native structured output) instead of a prompt-embedded JSON schema.",
      },
      {
        kind: "added",
        text: "Richer extraction: merchantType, orderNumber, estimatedDeliveryDate, discount, shipping, currency + per-line brand/modelNumber/variant (persisted in extracted_raw_json).",
      },
      {
        kind: "added",
        text: "extraction-schema.ts — the native @google/genai Schema for the full analysis.",
      },
    ],
    status: "staged",
  },
  {
    id: "changelog-persistent-d1",
    branch: "claude/worker-inbox-hitl-v2",
    date: "2026-07-14",
    area: "Platform",
    title: "Persistent append-only changelog",
    summary:
      "D1-backed changelog (changelog_branches + changelog_entries) surfaced at /admin/changelog, with a full detail page per entry and a mandatory agent workflow in AGENTS.md.",
    changes: [
      {
        kind: "added",
        text: "changelog_branches + changelog_entries tables (upsert by branch / slug — append-only, never overwritten).",
      },
      {
        kind: "added",
        text: "/api/changelog write API (POST /branches, /entries, /seed) + read (GET /, /:slug).",
      },
      {
        kind: "added",
        text: "/admin/changelog reads D1 at SSR, falls back to bundled seed data when empty; /admin/changelog/:slug detail pages.",
      },
      {
        kind: "added",
        text: "AGENTS.md 'Changelog discipline (MANDATORY)': agents log entries every code turn + before every PR.",
      },
    ],
    migrations: ["0107_ordinary_hawkeye"],
    status: "staged",
  },
];
