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

export type ChangeKind = "added" | "changed" | "removed" | "migration" | "fixed";

export interface ChangelogChange {
  kind: ChangeKind;
  text: string;
}

export interface ChangelogBranch {
  branch: string;
  title: string;
  summary?: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  status: "shipped" | "staged" | "open";
  prNumber?: number;
  prUrl?: string;
}

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
  branch: string;
  date: string;
  tag?: string;
  area: string;
  title: string;
  summary: string;
  changes: ChangelogChange[];
  migrations?: string[];
  status: "shipped" | "staged";
}

/** Branches / PRs, newest first. */
export const BRANCHES: ChangelogBranch[] = [
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
      "The frontend for 0030: /admin/shopping/receipt-review groups staged room proposals by receipt, shows the engine's proposed room + confidence + reasoning per line item, and lets the owner swap any room from a dropdown of eligible candidates — plus an \"Other room…\" entry that opens a full-room modal for when the guess is way off. Confirming resolves each proposal against a roomId FK (never a name), minting the material. No schema or API change; reuses the resolve endpoints from #236.",
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
      "\"Active\" was a value of the `status` enum, so six drive lists claimed it at once and the landing page's Active/Archived tabs bucketed on that same overloaded field. The single-slot pointer is now its own column (`is_active`) under a partial UNIQUE index, so D1 itself refuses a second active drive; the tabs bucket on what actually happened (Pending / In progress / Finished); and each card carries an Active badge plus a toggle.",
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
    id: "0038-sales-schema-phase-a",
    branch: "claude/sales-clearance-page-b0c752",
    date: "2026-07-27",
    area: "Shopping",
    title: "Sale items schema + backfill (0038 Phase A)",
    summary:
      "Clearance items lived as a JSON blob inside one showroom_store_sales row per page, so they could not be filtered by color/size, given per-item images, watched, or diffed across weeks. Phase A promotes each item to a real sale_items row and lands the whole data spine for the overhaul — image + color mapping tables, a per-cycle table, scrape-run logging, watch list, research clusters, and the weekly-ad record — all additive (migration 0148). A backfill route explodes the existing isCurrent snapshots into rows.",
    changes: [
      { kind: "migration", text: "0148_keen_vance_astro: 8 new tables (sale_cycles, sale_items, sale_item_images, sale_item_colors, sale_watch, sale_scrape_runs, sale_research_clusters, weekly_sale_ad) + showroom_stores.is_online_only + showroom_store_sales.page_markdown. Additive; applied + verified on remote D1." },
      { kind: "added", text: "sale_items promotes ClearanceItem: brand/category/subcategory FKs into the shared config vocab (+ verbatim *_text fallback when no id matched), prices as text+cents, colors via a colors def + sale_item_colors mapping, size/condition/warranty/qty, damage notes + deal insight as markdown+html, cross-cycle change_status + deal_score/research_tier columns." },
      { kind: "added", text: "backfillSaleItems() explodes isCurrent showroom_store_sales.clearanceDetailsJson.items[] into sale_items — single-row inserts batched (sale_items is ~40 cols, so multi-row would blow D1's 100 bound-param cap), idempotent (skips snapshots that already have rows)." },
      { kind: "added", text: "POST /api/showroom-sales/backfill (access-gated) runs the one-shot; 14 current snapshots → 29 items on first run, exact count-parity, 0 on re-run." },
    ],
    migrations: ["0148_keen_vance_astro"],
    status: "staged",
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
      { kind: "added", text: "services/location/ingest.ts — LocationFix/LocationSource + ingestLocationFix (record → match → home → stage), no auto-nav." },
      { kind: "added", text: "POST /api/tesla/manual-here (manual source); MCP report_location (ai source, 122 tools)." },
      { kind: "changed", text: "/api/showroom-stores/device-location additively runs the park pipeline in the background (waitUntil) — phone is now a first-class source; response shape unchanged." },
      { kind: "changed", text: "visit-sessions GpsSource union widened to the full gps_source enum (+ tesla-poll, phone, ai) to match the V1 column." },
      { kind: "fixed", text: "Codra follow-ups: coordinate range bounds on manual-here + report_location (lat -90..90 / lng -180..180 / accuracy ≥0); capturedAt finite-guard before new Date; home-check error now fails SAFE (skips staging so a DB blip at home can't log a false showroom visit); QC no longer POSTs manual-here on prod." },
    ],
    status: "staged",
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
      { kind: "added", text: "/admin/config/tesla page (ConfigShell) + config-nav 'Tesla Location' entry under Integrations." },
      { kind: "added", text: "GeocodeAddressField — Places-autocomplete address→coords via /api/places (typeahead + details)." },
      { kind: "added", text: "tesla_* / loc_* config keys (home/work coords+address, proximity/home-work/park/depart radii, dwell_min, stale_seconds, scan_enabled) written via POST /api/admin/config (db.batch)." },
      { kind: "changed", text: "Recording master switch reuses the existing tesla_telemetry_recording_enabled flag (not the spec's unused tesla_record_telemetry) — avoids a split-brain recording flag." },
      { kind: "fixed", text: "Codra follow-ups: GeocodeAddressField now sequences/aborts autocomplete requests (no stale overwrite), guards state after unmount, and surfaces a resolve failure; QC pr_293 gates the config write on the ACTUAL base (not a CLI flag) with a per-run key + verified cleanup; NumField caps length + label association." },
    ],
    status: "staged",
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
      { kind: "added", text: "Visit Logs workspace — list (pending/completed tabs), detail/finalize (GPS evidence + editor + this-store timeline), and manual new page." },
      { kind: "added", text: "src/frontend/components/visits/ — Badges (status/type/source), StarRating, ShowroomAutocomplete, VisitLogEditor (PlateJS notes), GpsEvidence (reuses DriveMapThumb), VisitCard, api.ts." },
      { kind: "added", text: "Store viewport 'visits' section (SectionKey + bento tile) — pending visits float up with a finalize nudge, then history." },
      { kind: "added", text: "Sidebar 'Visit Logs' entry under Showrooms." },
      { kind: "fixed", text: "store [section].astro allow-list was missing 'contacts' (and now 'visits') — /store/:id/contacts had silently fallen back to brands-products." },
    ],
    status: "staged",
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
      { kind: "added", text: "services/showroom/visit-log.ts — the single path REST + MCP both call (list/get/create/update/delete + rating guard + dwell)." },
      { kind: "changed", text: "/api/showroom-visit-logs refactored to delegate to the shared service (no duplicated logic)." },
      { kind: "added", text: "MCP 'visits' domain (7 tools) — full CRUD + stage_showroom_visit + finalize_visit_log. 121 tools total; auto-renders on /connect/tools." },
    ],
    status: "staged",
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
      { kind: "added", text: "GET/POST/PATCH/DELETE /api/showroom-visit-logs (+ ?status=pending|completed, ?storeId=). Store name JOINed, never denormalized. Admin-gated." },
      { kind: "added", text: "Rating validated 1-5 at the trust boundary (Zod) — the API-layer guard standing in for the DB CHECK SQLite can't ALTER-ADD." },
      { kind: "changed", text: "status enum gains DRAFT (human save-draft). TEXT column → TS-only, db:generate confirms no migration." },
      { kind: "changed", text: "MCP CRUD twins + workspace pages/components deferred to V2b/V2c for reviewability." },
    ],
    status: "staged",
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
      { kind: "migration", text: "0147 — showroom_visit_log ADD visit_type (engagement enum, default SOFT_ARRIVAL), match_distance_m, provenance_json. Three additive ADD COLUMNs." },
      { kind: "added", text: "visit_type = engagement depth of the visit (the quality signal for visit history / future GPS-attested reviews), separate from the contact channel which lives on showroom_store_contact_log.type." },
      { kind: "changed", text: "stageSoftArrival/finalizeSoftArrivals populate match_distance_m (park-to-store distance) + provenance_json (raw fix + active-drive id); gps_source enum widened (+ tesla-poll, phone, ai)." },
      { kind: "changed", text: "hitl_queue_id + the store/hitl XOR rule deferred to D1 (avoids a dangling FK before the showroom_store_hitl_queue table exists)." },
    ],
    status: "staged",
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
      { kind: "fixed", text: "isRequestAuthenticated now accepts the raw WORKER_API_KEY via 'Authorization: Bearer <key>' or an 'x-worker-api-key' header (header channel only), in addition to the existing remodel_access cookie = SHA-256(key). The cookie remains hash-only — it does not accept the raw key, so a stolen cookie can't reveal the reusable secret (codra security review)." },
      { kind: "changed", text: "Both comparisons use a constant-time compare instead of ===, so the secret-matching paths don't leak via early-exit timing." },
      { kind: "added", text: "One change to the shared gate covers both the _worker.ts SSR admin gate and the requireAccessAuth API middleware — codra and QC can now hit admin-gated endpoints with just the key." },
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
      { kind: "changed", text: "SidebarItem is now a recursive tree: optional href, icon, children[], and navigateOnExpand (a submenu parent that both navigates to its section landing and expands). Additive — existing flat groups are unchanged." },
      { kind: "added", text: "NavNode renders arbitrary-depth submenus, collapsed by default, auto-expanding the active branch's ancestors from the SSR path (no post-hydration flip). A navigateOnExpand parent is a link; a separate chevron button peeks in place without leaving the page." },
      { kind: "added", text: "Collapse-to-rail: AdminSidebar toggles w-64 ↔ a w-14 icon rail (one icon per admin section + expand/home/config), persisted in a remodel_sidebar_collapsed cookie." },
      { kind: "added", text: "BaseLayout seeds the collapse state server-side from the cookie and drives BOTH the fixed aside width AND the content padding off a single --sidebar-w CSS var keyed on <html data-sidebar-collapsed>, so one client toggle reflows the layout with no flash." },
      { kind: "changed", text: "Per-section and per-item lucide icons added; group-header text bumped from text-[10px] to text-xs for readability." },
      { kind: "changed", text: "Shopping group re-authored into three nested submenus — Showrooms (Drive Lists, Contacts, Sales & Clearance, Showroom Intake), Brands & Products (Materials, Products, Wishlist, Deep Research, Shopping Journal), Purchase Ops → Review (Price Cards, Product Photos) + Receipt Review — and the /admin/shopping hub landing regrouped to match, on the standard page shell." },
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
      { kind: "added", text: "Region tabs (from HUB_LABEL: SF / South Bay / Peninsula / East Bay / North Bay / Central Valley / All) with live badge counts; geolocation auto-selects the nearest region (falls back to SF), with a subtle 'auto-selected by location' note." },
      { kind: "added", text: "Group-by switcher — Sales Category (default) / Rating / Flagship / Closing Time; each group header shows count + avg rating + open-now count." },
      { kind: "added", text: "Open stores sort first by earliest closing time; closed stores fold into an expandable 'N closed now — name, name…' banner (dimmed cards/rows on expand)." },
      { kind: "added", text: "Cards ↔ Rows toggle (cards reuse ShowroomMergedCard; rows are a compact keyboard-accessible table). Lean filter bar: search, business-model type chips, Open Now (via hours-status), visit status (All/Unvisited/Visited)." },
      { kind: "added", text: "Detail modal — full 7-day hours (today highlighted) + Call (tel:) / Website / Google Maps nav / Tesla Nav (POST /api/tesla/navigate) / View full details." },
      { kind: "changed", text: "Default tab map→grouped; view toggle is Grouped/Map (the old list/directory views were superseded by grouping; their deep-links redirect to grouped). Map view preserved. Reuses the existing fetch + meta endpoints — no new data endpoints." },
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
      { kind: "added", text: "Preview changelog task list groups by phase into collapsible sections, each with a per-phase progress bar, PR-count, per-task PR chip (#123), and a 'pending PR' badge when a phase's work has all landed but nothing merged." },
      { kind: "added", text: "Live updates: the viewport polls GET /api/changelog/proposals/:slug every 10s AND holds a websocket to /api/realtime/plans?room=plan:<slug>; any poke triggers an immediate refetch. A Live/Polling indicator shows which is active." },
      { kind: "added", text: "update_plan_task MCP tool — per-task status/prNumber/notes ticks so a session keeps the board honest (in_progress → in_review+PR → done+PR)." },
      { kind: "added", text: "updatePlanTask() service + /api/realtime/plans gateway — every task write fans a poke out of the shared EstimateCollabHub DO (room plan:<slug>). Best-effort; a downed hub never fails the write." },
      { kind: "changed", text: "PATCH /api/admin/plans/tasks/:id now accepts prNumber/changelogSlug/progressPct and the in_review status, and routes through the shared service so it publishes too." },
      { kind: "fixed", text: "in_review was in the plan_tasks DB enum (0028) but missing from rollup(), admin validation, the proposal schema, and the frontend — now consistent across every read/write/render surface." },
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
      { kind: "added", text: "delete_showroom MCP tool — soft delete (is_active=0) of a junk store; restore:true un-deletes. Idempotent, DESTRUCTIVE annotation, returns {id,name,isActive,changed,url}." },
      { kind: "added", text: "includeInactive param (default false) on list_showrooms (MCP) and GET /api/showroom-stores; each list row now carries isActive. Default behavior unchanged — active-only." },
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
      { kind: "fixed", text: "drive-geo-match.loadActiveStops scoped to is_active=true (THE active drive), not status=active (many stale lists). No active drive → no candidates → no false match. This is what mis-attributed a Fourth-St-Berkeley park to Farrow & Ball off a week-old list." },
      { kind: "changed", text: "Auto-navigation is OPT-IN — new tesla_auto_navigate config flag (default false), gated in both the poller and the stream DO. Commanding the vehicle to a next stop the driver didn't choose must be explicit." },
      { kind: "added", text: "GET /api/tesla/stream/events — newest parsed telemetry frames (TESLA_DB), pre-formatted (gear/speed/battery/coords) for display." },
      { kind: "added", text: "AdminTeslaAlert: while telemetry is live, polls parsed frames every 5s and rotates them (~3s each) across the top of every admin page." },
      { kind: "changed", text: "POST /api/tesla/stream/control accepts + returns autoNavigate. No schema change (flag in project_system_variables) → no migration." },
      { kind: "fixed", text: "Ticker polish (#264): dropped aria-live from the rotating line (screen-reader spam), paused rotation while the tab is hidden, and guarded loadEvents so a late fetch can't repopulate frames after telemetry goes inactive. gating single-key lookup uses eq() + JSDoc." },
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
      { kind: "migration", text: "0140 — showroom_visit_log: store_id/drive_list_id/stop_id FKs, arrival/departure/dwell, status + type enums, rating, notes_markdown+html, GPS provenance, and a partial-UNIQUE soft_arrival_id self-reference. Validated on local D1." },
      { kind: "added", text: "services/tesla/visit-sessions.ts — stageSoftArrival (park, deduped) + finalizeSoftArrivals (drive-away, idempotent via onConflictDoNothing on the unique index)." },
      { kind: "changed", text: "TeslaStreamDO: onPark stages a soft arrival (unless home); the shift P→moving transition finalizes. Private connect() renamed connectStream() (fixes a latent DO-RPC tsc collision from #242)." },
      { kind: "added", text: "GET /api/tesla/visits — list the visit log with the store name JOINed (?status/?limit)." },
      { kind: "fixed", text: "worker-configuration.d.ts regenerated so Env carries the TESLA_STREAM binding (#242 added it but never regenerated types)." },
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
      { kind: "added", text: "services/tesla/vehicle-image.ts — builds Tesla's public compositor URL from vehicle_config (car/paint/wheel option-code maps ported from the operator's iOS app), Model 3/Y only, cached in KV for a day." },
      { kind: "added", text: "GET /api/tesla/stream/banner — one cheap aggregate (D1/KV, no DO round-trip): activeDrive, telemetryActive, withinWindow + a 12-hour window label, canEnable, and vehicleImageUrl when live." },
      { kind: "added", text: "components/AdminTeslaAlert.tsx mounted in BaseLayout (admin-only) after AppHeader: 'Drive list active' + telemetry state, an Enable-telemetry button, and the car image; polls every 20s, self-hides on 404 / no active drive." },
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
      { kind: "fixed", text: "HTML entities in MCP-created drives (e.g. 'Wall &amp; Floor') are decoded at create time and backfilled on existing rows; slugs derive from the decoded title. 0 encoded titles remain on remote." },
      { kind: "added", text: "drive_list_notes table (drive-global or per-stop; source user|ai; read_at collapse state) — migrates the legacy drive_lists.notes JSON into rows (113)." },
      { kind: "added", text: "drive_list_stops.kind (core|optional|pitstop, backfilled from is_optional), suggested, skipped, skipped_at." },
      { kind: "changed", text: "enforceStreamWindow proactively POSTs TeslaStreamDO /stop when it deactivates a drive at the 20:00 boundary, closing the duration-billed-socket gap." },
      { kind: "fixed", text: "Repaired a forked drizzle meta chain (0137/0138 both off 0136; 0139 missing 0137's rooms columns) that broke db:generate repo-wide, and added the TESLA_STREAM binding to worker-configuration.d.ts (#242 missed it)." },
      { kind: "migration", text: "0140_useful_psylocke — drive_list_notes + drive_list_stops columns + entity/notes/kind backfill. Applied to remote." },
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
      { kind: "changed", text: "dedup_showroom_stores: merge semantics — remap child rows (notes/ratings/pocs/contacts/sales/images/price/drive-stops/journal/research/scan/pages/sitemap/photos + dedup-aware links/hours/tag/category/pa/product/brand mappings) to the keeper, then soft-delete the duplicate store (is_active=0). No hard deletes." },
      { kind: "added", text: "findDuplicateStore(db, {placeId, phoneNumber, websiteUrl, locationAddress}) — shared guard matching an active store by place_id / phone (digits) / website host / normalized address." },
      { kind: "added", text: "Duplicate-creation guard wired into POST /api/showroom-stores (409 with matchedOn) and the create_showroom + import_showroom_from_place MCP tools (return the existing row instead of creating a copy)." },
      { kind: "fixed", text: "Removed the `remote` field from 24 secrets_store_secrets bindings (newer wrangler rejects it, failing every wrangler command); upgraded wrangler ^4.100.0 -> ^4.114.0." },
      { kind: "added", text: "scripts/0119-soft-delete-showroom-duplicates.sql — one-shot SQL to soft-delete the 59 existing re-seed duplicates (superseded by the merge tool for future cleanup)." },
      { kind: "changed", text: "dedup now groups by normalized NAME (not name+city), so a stub filed under a different city than its real record — Concreteworks (Alameda) vs (San Leandro), etc. — is caught. Distinct multi-branch chains stay safe via the >=2-real-rows skip guard." },
      { kind: "fixed", text: "apply now reports totalActiveAfter from a live COUNT and keeps storesSoftDeleted separate from childRowsMoved, fixing a miscount that summed store + dropped-link rows." },
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
      { kind: "added", text: "components/drives/TeslaStreamControl.tsx — a Switch bound to POST /api/tesla/stream/control and a status pill polling /control + /status every 15s (Streaming / Polling / Idle / Tripped, with an explanatory subline). Hides itself when the routes 404 on a not-yet-deployed worker." },
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
      { kind: "added", text: "durable-objects/tesla-stream.ts — singleton DO dialing streaming.tessie.com/<vin>. Every native-alarm fire re-checks shouldStreamNow and hard-stops on any circuit-breaker trip. Frames parse via the shared extractTelemetryFields; persistence is throttled (always on shift change, else ≤5s) to bound D1 writes; on shift→P it mirrors the poller (match+mark visited, auto-nav next, close the drive on home arrival)." },
      { kind: "added", text: "POST /api/tesla/stream/start|stop, GET /api/tesla/stream/status (admin) via the DO stub; drive activation now signals the DO so ingest is event-driven." },
      { kind: "migration", text: "v16 — new_sqlite_classes TeslaStreamDO; TESLA_STREAM binding in wrangler.jsonc; exported from _worker.ts (OAuthProvider wrapper untouched)." },
      { kind: "fixed", text: "Poll cadence floored at 60s (KV rejects sub-60 TTL; cron is per-minute) with a defensive Math.max; the connected flag carries a heartbeat so a crashed DO can't suppress the poller fallback (stale >5min → false). (codra follow-ups to #241.)" },
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
      "The human-in-the-loop surface for the receipt→material→room deduction engine (0030). A receipt-grouped queue at /admin/shopping/receipt-review: each card is one receipt (invoiceId), each row a line item with the engine's proposed room, confidence, and reasoning. A per-row dropdown offers the eligible candidate rooms plus \"Other room…\" — which opens a modal (RoomSelect over ALL rooms, floor-grouped) for the cases the engine gets wrong. \"Confirm all\" resolves each proposal via POST /api/materials/room-proposals/:id/resolve, minting the material against the chosen roomId FK. Frontend-only: no schema, no new endpoints.",
    changes: [
      { kind: "added", text: "New page /admin/shopping/receipt-review (thin Astro shell + ReceiptReviewApp island), plus a sidebar link under Shopping & Sourcing." },
      { kind: "added", text: "Per-line room dropdown of eligible candidates, and an \"Other room…\" entry opening a full-room RoomSelect modal for way-wrong guesses." },
      { kind: "changed", text: "Confirm resolves each staged proposal against a roomId FK (never a denormalized room name) via the #236 resolve endpoint; nothing commits to the materials schedule until the owner confirms." },
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
      { kind: "fixed", text: "GET /api/drive-lists/:slug now backfills each stop's missing lat/lng from its linked showroom (fillMissingStopCoords). Previously only the landing-list markers did this, so 14 of 23 drives rendered a blank pin icon instead of a route map despite linking geocoded showrooms." },
      { kind: "changed", text: "Stop-card action row: the Tesla button now sits inside the same rounded bg-muted container as the address + Navigate bar, at matched min-h-14 height, reading as one control strip (was a separate raised secondary button outside the background)." },
      { kind: "changed", text: "Hours badge enlarged to text-base; phone number is now a large min-h-12 rounded tap-to-dial button (tel:) sized for Tesla / phone touch targets, not a small ghost badge." },
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
      { kind: "fixed", text: "dedup would duplicate the kept store's website link: the seed adds a WEBSITE row per store and showroom_store_links has no unique index, so reparenting a shell's link created a second link. Links (and other seeded/scrape/mapping rows) are now DROPPED via ON DELETE CASCADE, not moved." },
      { kind: "changed", text: "Per-table policy: reparent user data (notes/ratings/pocs/contacts/sales/images/price/drive-stops/journal); drop redundant/scrape/mapping rows; explicit-delete the 4 non-cascade artifact tables before the store delete." },
      { kind: "changed", text: "Codra review fixes: replaced raw sql.raw with typed Drizzle builders, batched writes via db.batch() in <=90-param chunks, load only the 11 columns needed, single changesOf() result helper, JSDoc on the export." },
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
      { kind: "added", text: "services/tesla/gating.ts — project_system_variables-backed stream control (toggle, window hours, poll-fallback cadence, DO connected flag) in one batched read; Pacific-aware isWithinStreamWindow (Intl, DST-correct); shouldStreamNow/shouldPollNow decision predicates; enforceStreamWindow deactivates a drive once the window closes." },
      { kind: "added", text: "GET/POST /api/tesla/stream/control — admin toggle + window + cadence, with inverted-window rejection." },
      { kind: "changed", text: "services/tesla/frames.ts — extractCoord + extractTelemetryFields lifted verbatim out of routes/tesla.ts so the DO and the compat webhook/telemetry routes parse frames identically (ING-01)." },
      { kind: "changed", text: "tesla-poller.ts is now the explicit FALLBACK path: stands down (reason 'stream-active') when the stream carries ingest, and throttles on the configurable cadence instead of a hardcoded 120s." },
      { kind: "changed", text: "Drive activation is time-gated — PATCH /api/drive-lists/:slug {isActive:true} returns 409 outside 07:00–20:00; deactivation always allowed. _worker scheduled() runs enforceStreamWindow each minute." },
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
      { kind: "added", text: "dedup_showroom_stores MCP tool (DESTRUCTIVE, dry-run by default). Dry run reports the keep/delete map + child-row counts across all 28 FK columns; apply:true reparents children then deletes losers in db.batch-safe, 90-param-chunked steps." },
      { kind: "added", text: "Anti-merge guard: a (name, city) group with ≥2 'real' rows (each with its own zip/placeId) is treated as distinct locations and skipped — 'All Natural Stone' in four cities is never collapsed." },
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
      { kind: "fixed", text: "Merged the last live duplicate brand pair (Visual Comfort #184 ⟵ Visual Comfort & Co. #221) on remote D1; 0 mechanical name-key collisions remain among active brands (385 → 384)." },
      { kind: "added", text: "brands_name_key_uniq — PARTIAL unique index on replace(replace(replace(lower(trim(name)),' ',''),'.',''),',','') WHERE is_active=1, blocking case/spacing restatements of the same brand." },
      { kind: "migration", text: "0138 creates the index; applies via migrate:remote (does not ride the build)." },
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
      { kind: "fixed", text: "seedShowroomStores now short-circuits (returns { inserted: 0, skipped }) the moment any showroom_stores row exists, so it only ever populates an empty directory. This stops any further duplication from a repeated seed." },
      { kind: "changed", text: "Documented that the seed is bootstrap-only and carries no natural key, so it must never run against a populated table." },
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
      { kind: "changed", text: "get_vehicle_location enriched in place: heading + headingCompass (Tessie /location now parsed for heading + fix-time, both fail-soft), a resolved street address (Tessie's own, else a quota-gated Geocoding-SKU reverseGeocode that degrades to null rather than billing), Bay Area region, and freshness (serverTime, ageSeconds, isStale — unknown age is treated as stale)." },
      { kind: "added", text: "whats_near_me MCP tool: ranks registered showrooms around the driver by straight-line distance with a compass bearing + miles; includeUndiscovered also sweeps quota-gated placesNearby for spots not yet in the directory (de-duped against known showrooms; an empty return is reported as possibly-quota-blocked). Location resolves explicit → live Tesla GPS → last phone fix." },
      { kind: "added", text: "initialBearing() + compassFromBearing() geo primitives alongside haversineMeters in drive-geo-match, and loadShowroomCoords() — a single coordinate-source helper so the anticipated move of location data off showroom_stores is a one-line change, not a scattered rewrite." },
      { kind: "changed", text: "TeslaLocation gains heading + timestampMs (both fail-soft); getLocation() normalizes Tessie's seconds-or-ms fix timestamp." },
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
      { kind: "added", text: "17 module health.ts files (db, api, ai, mcp, realtime, workflows, ai-gateway, usage, render, email, gmail, google, google-photos, tesla, showroom, documents, image-processor) contributing 85 infrastructure probes." },
      { kind: "added", text: "16 cost watchers comparing the last 24h against the trailing 7-day daily average — AI spend, tokens, Maps calls, agent runs, Durable Object volume — DEGRADED at 2x, FAILURE at 5x." },
      { kind: "added", text: "/admin/system/health rebuilt as a grouped timeline: sticky section per module group, a runbook inside every row, skeleton rows and a spinner while a session runs, filters for problems and cost watchers. Mobile-first." },
      { kind: "added", text: "Admin-gated POST /api/health/session, GET /api/health/{session/latest,sessions,catalogue,badge}, and the run_health_session MCP tool." },
      { kind: "added", text: "A minimal health pip in the desktop header and the mobile sidebar bar, linking to the dashboard. Reads the last persisted session; never triggers a probe." },
      { kind: "changed", text: "The three data-quality checks from #169 are bridged into the probe pipeline as a Data Quality group, so one run covers both and their scores land in the same session ledger. `unknown` maps to FAILURE, never SUCCESS." },
      { kind: "changed", text: "/health and /admin/health 301 to /admin/system/health, behind the admin gate. The public GET /api/health is unchanged, so external uptime monitors keep working." },
      { kind: "removed", text: "The public /health page, the HealthCheckApp island, SystemHealthApp, and two dead non-compiling health.ts files under src/backend/ai." },
      { kind: "fixed", text: "The sidebar had two nav groups with id \"system\" after #169; folded into one." },
      { kind: "migration", text: "0125_supreme_dust — health_test_def, health_binding_types, health_test_binding_types, health_results (additive; applied and verified on remote)." },
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
      { kind: "added", text: "/admin/system/agents/queue — every run grouped by status in triage order, with a banner naming every surface that is NOT reporting." },
      { kind: "added", text: "/admin/system/agents/queue/[id] — step trace, collapsible tool calls, retry lineage, attributed cost, retry/cancel/approve." },
      { kind: "added", text: "/admin/system/agents/failed — failures grouped by (error_code, agent, operation)." },
      { kind: "added", text: "/admin/system/agents/usage — AI spend per agent and per run, with live breaker state for all 7 metered providers." },
      { kind: "added", text: "9 endpoints under /api/admin/agents — the first readers of the agent_runs ledger." },
      { kind: "added", text: "agent-registry.ts — all 27 execution surfaces declared once; the denominator that stops an empty queue reading as a healthy one." },
      { kind: "changed", text: "Instrumentation went from 1 writer to 12; AI spend attributes to its run via AsyncLocalStorage, leaving ~130 env.AI.run call sites untouched." },
      { kind: "migration", text: "0123_stormy_sersi — gemini_usage_log.agent_run_id + index (additive, nullable, applied and verified on remote)." },
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
      { kind: "fixed", text: "MarkdownProse's `pre` renderer detects a `language-mermaid` code fence and renders it via MermaidCn (the changelog detail page's renderer) instead of raw code — so the diagram-dense preview-changelog PRD actually shows diagrams." },
      { kind: "changed", text: "Fixes every MarkdownProse surface at once (research, brands, products, changelog, mcp-ops). SSR-safe — mermaid is dynamic-imported; the diagram paints client-side where MarkdownProse is hydrated (the preview mounts the proposal bundle client:load)." },
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
      { kind: "added", text: "isUnderApiQuota(sku) + per-SKU caps (MAPS_API_QUOTAS) + getUsageBySku() — Places methods gate on 'places', computeRouteMatrix on 'routes'; an exhausted SKU blocks only itself." },
      { kind: "added", text: "reverseGeocode(lat,lng) (Geocoding SKU) and placesNearby(...) (Places SKU) — gated + logged, fail-soft (null/[]); back the location / what's-near-me tools." },
      { kind: "fixed", text: "canUseGoogleMaps() recomputed its month window in milliseconds while the timestamp column is Unix seconds (~1000× off) and used a second divergent 8,000 cap — it now delegates to the SARGABLE seconds-correct count, one source of truth." },
      { kind: "fixed", text: "The Places-Photo media fetches in showroom onboarding + the ShowroomResearchAgent backfill fetched a billed Places SKU with NO quota guard and NO usage log — they now gate on the Places quota and log every fetch." },
      { kind: "changed", text: "GET /api/admin/integrations/usage returns by_sku + quotas; the Google Maps usage tab shows a 'Per-API hard blocks' row per SKU with the existing blocked badge." },
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
      { kind: "added", text: "services/safety/do-circuit-breaker.ts — a D1-backed global kill-switch (project_system_variables.do_circuit_breaker_tripped), a pure fire-rate window, and a schedule-table-bound check. All cheap (single-row read, SARGABLE count) so the guard never becomes the cost." },
      { kind: "changed", text: "RemodelOrchestrator runs the guard at the top of every alarm fire (kill-switch → schedule-table bound → fire-rate); on a trip it deletes the alarm and hard-stops with no reschedule. onStart() respects the switch too." },
      { kind: "added", text: "scripts/check-do-alarms.mjs (wired into `pnpm check`) — bans the append-only this.schedule() in new DOs; native ctx.storage.setAlarm() only." },
      { kind: "added", text: "GET/POST /api/admin/integrations/circuit-breaker(/clear) + a Safety tab on /admin/integrations/usage to see the tripped reason and clear it." },
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
      { kind: "added", text: "services/health/screen.ts runHealthScreen(env) — probes each binding with a bounded, free op (SELECT 1, a KV put/get, an R2 head, an AI binding-presence check), writes one health_checks row per service via db.batch, rolls up overall (down > degraded > healthy)." },
      { kind: "added", text: "POST /api/health/run — on-demand trigger (public, like GET /api/health); 200 even when a service is down." },
      { kind: "added", text: "/health public page + HealthCheckApp island — snapshot on mount, Run button, per-service cards (healthy/degraded/down + latency), overall roll-up." },
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
      { kind: "added", text: "drive_lists.is_active — the single-slot pointer, under a partial UNIQUE index so a second active row is rejected by the database, not just by code." },
      { kind: "added", text: "PATCH /api/drive-lists/:slug { isActive } — set THE active drive, or clear the slot entirely. Backs the per-card toggle." },
      { kind: "added", text: "Active badge + ring on the active drive's card; list_drive_lists (MCP) now returns isActive." },
      { kind: "changed", text: "Landing tabs are Pending / In progress / Finished, bucketed on stops visited — replacing Active / Archived, which read the overloaded status enum." },
      { kind: "removed", text: "The auto-archive-on-read and un-archive-on-check-off status juggling in GET /api/drive-lists and the stop check-off; progress is now the truth, so neither rewrites status." },
      { kind: "added", text: "Getting home ends the drive: a Tesla park event — or a phone location fix — at the project address after 3:30pm local, any day of the week, clears the active slot automatically. Driving past the house doesn't count; the fix has to be a stopped one." },
      { kind: "added", text: "GET /api/drive-lists/home-location — the project's coordinates, geocoded once from the configured permit address and cached in project_system_variables (home_latitude / home_longitude)." },
      { kind: "fixed", text: "The drive automation had no producer: it was built around a Tessie webhook that does not exist (Tessie's telemetry is a WebSocket the client dials, and its REST API is pull-only), so 0 vehicle events had EVER been received while the UI reported a healthy integration. The Worker now polls the car's cached position every 2 minutes — but only while a drive list is active, and never with a call that wakes the car." },
      { kind: "added", text: "POST /api/tesla/poll — run one vehicle poll on demand (the same function the cron calls), so the path can be exercised without waiting for the schedule." },
      { kind: "added", text: "/admin/config/integrations/tesla — the vehicle integration page: masked read-only credentials (values never leave the Worker), a switch for whether Fleet Telemetry is written to D1, and a health screening that checks the events already collected still carry coordinates, shift state and a VIN." },
      { kind: "added", text: "A `tesla` MCP tool domain — get_tesla_status, get_vehicle_location, list_tesla_events, send_vehicle_navigation — so a chat can ask where the car is, what it has been doing, and send it somewhere. The Showroom Scout agent gets the two read tools." },
      { kind: "changed", text: "Telemetry frames are only recorded when the integration is configured AND recording is switched on; the endpoint reports which gate stopped it instead of a silent success." },
      { kind: "migration", text: "0119_yellow_micromax — drive_lists.is_active + drive_lists_single_active_uniq. Applied to remote; the newest drive (concord-corridor-sat-jul-18-sf-1pm) holds the slot, all 13 others cleared." },
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
      { kind: "added", text: "Delete showroom, from the edit modal — behind a confirm that spells out what is and isn't kept." },
      { kind: "added", text: "Restore a deleted showroom — POST /api/showroom-stores/:id/restore." },
      { kind: "changed", text: "DELETE /api/showroom-stores/:id is now a soft delete (is_active = 0) instead of destroying the row and everything hanging off it." },
      { kind: "changed", text: "34 list/search queries now hide deleted showrooms: directory, map, catalog, product + brand pages, clearance feed, field scan, backfills, contacts matching, phonebook, MCP tools, the research agents and the cron sweeps." },
      { kind: "migration", text: "0113_dapper_white_queen — showroom_stores.is_active, default true. Applied to remote: 134 stores, 134 active." },
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
      { kind: "added", text: "Hero link row: a large Website button plus one same-size icon button per link type the showroom actually has registered (Instagram, X, LinkedIn, Facebook, Pinterest, Yelp, 360° tour, showroom photos, clearance)." },
      { kind: "added", text: "Links modal — every URL as a tappable hyperlink, with a pencil that flips the same modal into the add/edit form." },
      { kind: "added", text: "Hours modal now leads with Call, Copy address, and Send to Tesla as large buttons; copy and navigate report success/failure inside the button, and a failed navigate prints the reason." },
      { kind: "added", text: "\"Opening Soon\" — a fourth open/closed state for a showroom that is shut right now but opens later today." },
      { kind: "added", text: "Upload photo now opens a drag-and-drop dropzone (or tap to browse) instead of a hidden file input, and accepts several photos at once." },
      { kind: "changed", text: "The open/closed badge is full-width and colour-coded across all four states." },
      { kind: "changed", text: "Hours, links, upload and categories modals all render at ~80% of the viewport; category checkboxes are noticeably larger." },
      { kind: "removed", text: "The hero's small \"Edit hours\" and \"Edit address\" buttons — both now live inside the hours modal." },
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
      { kind: "added", text: "POST/GET /api/changelog/proposals, GET /api/changelog/proposals/:slug and /:slug/context (streams the R2 transcript)." },
      { kind: "added", text: "MCP tools submit_feature_proposal / get_feature_proposal / list_feature_proposals under a new `changelog` category." },
      { kind: "added", text: "scripts/changelog/{submit,get,list}-proposal.mjs — same three operations for agents with no MCP connection." },
      { kind: "added", text: "Preview page renders the bundle: PRD, design brief, PROMPT with a copy button, plan tasks with live status, transcript link + size + coverage note." },
      { kind: "added", text: "PhaseDetail gains optional branch/prNumber/prUrl and a `verification` block (QC script, source, verbatim output, per-migration remote state) — stored in detail_json, so no migration." },
      { kind: "changed", text: "Every changelog entry now surfaces its git branch AND PR number, reading PR metadata off the changelog_branches row so entries written before this still show it." },
      { kind: "changed", text: "/api/changelog/proposals* is gated behind requireAccessAuth — the write path takes an arbitrarily large body into R2 and the read path returns a raw transcript." },
      { kind: "migration", text: "0112_careful_gambit (changelog_proposals) applied to remote D1 and verified — 17 columns." },
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
      { kind: "added", text: "/admin/changelog/preview — every proposed change, drafted as release notes before deploy" },
      { kind: "added", text: "/admin/changelog/preview/[slug] — full proposal viewport: diagrams, developer changelog, recap" },
      { kind: "added", text: "Sidebar: Changelog Preview under System" },
      { kind: "changed", text: "Changelog list now renders changelog24 (release highlights) + changelog3 (release feed)" },
      { kind: "changed", text: "Changelog viewport now renders changelog19 (developer changelog + code) + changelog21 (Features/Fixes/Improvements recap)" },
      { kind: "changed", text: "Diagrams switched to the shadcn-registry mermaid (mermaidcn) with zoom/pan" },
      { kind: "changed", text: "Changelog + preview share one view + one mapper, so the two can never drift" },
      { kind: "fixed", text: "Sidebar no longer lights up Changelog and Changelog Preview at the same time" },
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
      { kind: "added", text: "Correct a showroom's hours / address / links after intake — PUT /:id/hours, PUT /:id/address, /:id/links CRUD, plus a Contacts-style editor on the showroom page." },
      { kind: "added", text: "MCP tools set_showroom_address + set_showroom_links (with set_showroom_hours) so an AI or a script can bulk-fill or fix these." },
      { kind: "changed", text: "Creating a contact now requires a name and optionally accepts the generic showroom details a business card carries (name/address/website/socials/phone/email) — the worker matches the store and fills any missing store info." },
      { kind: "added", text: "The intake form collects links; the store viewport lets you add/edit/delete them." },
      { kind: "fixed", text: "The email-to-contacts flow diagram was malformed — rewritten + validated." },
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
      { kind: "added", text: "Inbound worker email (remodel@hacolby.app) auto-registers a showroom contact from the sender’s signature (name, email, phone, website), wired into the email pipeline." },
      { kind: "added", text: "Domain/name matching maps the contact to the right showroom; unmatched senders are saved as draft contacts for triage in the phonebook." },
      { kind: "changed", text: "Only runs when the sender isn’t already a known contractor company (those stay in the CRM), and de-duplicates on the sender email." },
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
      { kind: "added", text: "Contacts phonebook at Shopping → Contacts: search, type filter, A–Z quick-jump rail, and tap-to-dial / tap-to-email numbers for phone and Tesla screens." },
      { kind: "added", text: "A Contacts tab on each showroom, showing that store’s general line + people." },
      { kind: "added", text: "Bulk business-card import: drop in photos, a vision model extracts each card and creates the contact; cards it can’t read are flagged for a quick manual entry." },
      { kind: "added", text: "Smart intake splits a person’s cell/direct/office numbers, promotes the office line to the store’s general contact, and routes the website + address to the right tables — you just send the raw details." },
      { kind: "added", text: "Interaction log per contact (what was said, when, follow-ups) + MCP tools so an AI can add contacts and resolve failed cards." },
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
      { kind: "added", text: "showroom_store_links table: one row per link, typed WEBSITE / INSTAGRAM / PINTEREST / FACEBOOK / OTHER with url_notes." },
      { kind: "added", text: "Send a links[] payload on create/update (replace-all), or manage them one at a time via /:id/links CRUD." },
      { kind: "changed", text: "Favicon + website scrape now source the site from the WEBSITE link; the scrape writes any Instagram it finds as an INSTAGRAM link." },
      { kind: "changed", text: "Flat website_url / instagram_url / facebook_url / pinterest_url columns are now DEPRECATED (superseded by the links table); kept for the one-time backfill and dropped in a follow-up migration." },
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
      { kind: "added", text: "Granular location_street_number / _street_name / _city / _state / _zip_code columns." },
      { kind: "added", text: "Address backfill from Google Places (dry-run by default) that overwrites city-only stubs with the full formatted address + maps link." },
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
      { kind: "changed", text: "showroom_store_hours rows are now the SOLE source of truth; the hours_json blob is superseded (kept as deprecated for the one-time backfill, dropped in a follow-up migration)." },
      { kind: "changed", text: "Renamed the normalized table showroom_hours → showroom_store_hours." },
      { kind: "changed", text: "Redundant free-text weekday_hours / weekend_hours columns are deprecated (backfill source only)." },
      { kind: "added", text: "API create/update accept a hoursJson payload → rows; GET responses derive hoursJson from the rows. New MCP tool set_showroom_hours." },
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
      { kind: "fixed", text: "Phantom 'total is not stated — check your payment method' flag on receipts whose total is printed (e.g. the Costco order)." },
      { kind: "changed", text: "classify.ts now passes config.responseSchema (native structured output) instead of a prompt-embedded JSON schema." },
      { kind: "added", text: "Richer extraction: merchantType, orderNumber, estimatedDeliveryDate, discount, shipping, currency + per-line brand/modelNumber/variant (persisted in extracted_raw_json)." },
      { kind: "added", text: "extraction-schema.ts — the native @google/genai Schema for the full analysis." },
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
      { kind: "added", text: "changelog_branches + changelog_entries tables (upsert by branch / slug — append-only, never overwritten)." },
      { kind: "added", text: "/api/changelog write API (POST /branches, /entries, /seed) + read (GET /, /:slug)." },
      { kind: "added", text: "/admin/changelog reads D1 at SSR, falls back to bundled seed data when empty; /admin/changelog/:slug detail pages." },
      { kind: "added", text: "AGENTS.md 'Changelog discipline (MANDATORY)': agents log entries every code turn + before every PR." },
    ],
    migrations: ["0107_ordinary_hawkeye"],
    status: "staged",
  },
];
