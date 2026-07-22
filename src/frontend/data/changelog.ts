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
  id: string;
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
    title: "Durable Object alarm circuit breaker (hard-stop)",
    summary:
      "The guard the $700 cf_agents_schedules runaway (#162) never had: a runtime circuit breaker that hard-stops a runaway DO alarm loop — deletes the alarm, flips a global kill-switch, and refuses to run — before it bills into the thousands. Retro-hardens RemodelOrchestrator, bans the append-only this.schedule() in new DOs via a CI guard, and adds an admin Safety tab.",
    date: "2026-07-21",
    status: "staged",
    prNumber: 181,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/181",
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
