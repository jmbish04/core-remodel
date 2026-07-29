/**
 * Full developer record behind each changelog entry on /admin/changelog.
 * Keyed by the entry `id` (= the detail page slug at /admin/changelog/:id).
 *
 * Standard (see AGENTS.md): every non-trivial change ships a detail entry with
 * the problem, the approach, the exact API surface touched, the files, the
 * migration SQL, representative code, and (where useful) a Mermaid diagram.
 * Seeded/fallback here, then persisted to D1 (changelog_entries.detail_json).
 *
 * Long-form fields are typed `Prose` and hold MARKDOWN — headings, lists,
 * tables, `code`, and ```mermaid fences all render. Author them as one string;
 * single newlines between prose lines are expanded into paragraph breaks by the
 * renderer, so dense model output does not arrive as a wall of text. A few rows
 * store an array of paragraphs from a brief earlier iteration and are folded
 * back into markdown on read.
 */
import type { Prose } from "@/lib/markdown-normalize";

export type { Prose };

export interface CodeCard {
  title: string;
  lang: "ts" | "tsx" | "sql" | "json" | "bash";
  code: string;
}

export interface DiagramCard {
  /**
   * Short label under the diagram. Retained as the required field because every
   * pre-existing entry sets it; `title` supersedes it for new entries.
   */
  caption: string;
  /** Heading above the diagram. Falls back to `caption` when absent. */
  title?: string;
  /** What the diagram shows and what to look for in it. */
  description?: Prose;
  code: string; // Mermaid source
}

/**
 * One migration's REMOTE state. The deploy topology makes this the question a
 * reader actually has: every branch push builds and deploys the worker, but
 * migrations do NOT ride the build. So code can be live in production while its
 * table does not exist — and the endpoints that query it return 500. "Merged"
 * therefore does not imply "applied"; this says which it is.
 */
export interface MigrationStatus {
  tag: string;
  /** Whether `pnpm run migrate:remote` has actually applied this to the remote DB. */
  appliedRemote: boolean;
  /** How that was confirmed, or what is still outstanding. */
  note?: string;
}

/**
 * What was actually run to verify the change — never a paraphrase of it.
 *
 * `output` is pasted verbatim from the QC run. A summarized or reconstructed
 * result is worse than none: it reads as evidence while carrying none, and a
 * reader has no way to tell the difference.
 */
export interface Verification {
  /** Path to the QC harness, e.g. "scripts/qc/pr_162.mjs". */
  qcScript: string;
  /** The exact command that produced `output`, e.g. "pnpm run test:pr 162". */
  command: string;
  /** Representative source from the QC script, so the assertions are visible. */
  source?: string;
  /** REAL output of `command`, pasted verbatim. */
  output: string;
  /** When it ran (YYYY-MM-DD), so stale evidence is recognizable as stale. */
  ranAt?: string;
  /** Remote state of each migration this change introduced. */
  migrations?: MigrationStatus[];
}

export interface PhaseDetail {
  slug: string;

  /**
   * One-line qualifier under the title, set in smaller italic type. The title
   * says what changed; the subtitle says which surface or which phase.
   */
  subtitle?: string;
  /**
   * Opening orientation, before the problem statement — who this is for, why
   * they are reading it, what changes for them. Markdown.
   */
  introduction?: Prose;

  /** Why this change had to happen. Markdown. */
  problem: Prose;
  /** How it was solved. Markdown. */
  approach: Prose;

  apiChanges: string[];
  filesTouched: string[];
  migrations: { tag: string; sql: string }[];
  code: CodeCard[];
  diagrams: DiagramCard[];

  // ── Provenance + evidence (optional: pre-existing entries predate these) ────
  // Stored inside `changelog_entries.detail_json`, so extending this type needs
  // no migration.

  /** Git branch the work landed on. Falls back to the entry's own `branch`. */
  branch?: string;
  /** PR number. Falls back to the `changelog_branches` row for this branch. */
  prNumber?: number;
  prUrl?: string;
  /** What was run to verify this, and what it printed. */
  verification?: Verification;
}

export const CHANGELOG_DETAIL: Record<string, PhaseDetail> = {
  "0032-locationfix-ingress": {
    slug: "0032-locationfix-ingress",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 L0 · the source-agnostic location ingress",
    code: [],
    problem:
      "Visit capture was welded to the Tesla streaming DO: only a 500ms telemetry frame that transitioned into Park could stage a soft arrival. A phone GPS ping, an AI-supplied coordinate, or a manual 'I'm here' had no way to drive the same pipeline — so the whole feature depended on a billable always-on socket, exactly the coupling the user asked to remove ('make it work off Tessie poll / phone / AI').",
    approach:
      "One seam: a source-agnostic LocationFix ({lat,lng,when,source,shiftState?,…}) and one ingestLocationFix(env, fix) that records provenance then runs the SAME park pipeline the DO already runs — matchAndMarkVisited (check off a drive stop) → maybeEndActiveDriveOnHomeArrival (home/work ends the drive) → stageSoftArrival (near a registered showroom on the active drive). It never auto-navigates, so a stray phone ping can't command the car. Wired the NEW discrete sources through it: POST /api/tesla/manual-here (manual), MCP report_location (ai → persisted to device_location source=ai for auditability), and the existing /device-location route now additively runs the pipeline in the background (waitUntil; record:false + skipHomeArrival:true so nothing double-writes or double-ends). Deliberately did NOT rewire the live streaming DO or the 120s poller — safely unifying them needs the dwell/park DETECTOR (L1) that tracks prior state to fire a drive-away; doing it here would risk the live park pipeline with no detector to close the dwell. No new table, no migration — provenance reuses device_location (free-text source column).",
    apiChanges: [
      "NEW POST /api/tesla/manual-here — a manual location fix runs the park pipeline; returns the IngestResult.",
      "NEW MCP report_location (ai source) — reports a coordinate, stages a visit, records device_location source=ai. 122 tools.",
      "CHANGED POST /api/showroom-stores/device-location — same response, now also runs the pipeline in the background.",
    ],
    filesTouched: [
      "src/backend/services/location/ingest.ts (new — LocationFix + ingestLocationFix)",
      "src/backend/services/tesla/visit-sessions.ts (widen GpsSource union to the full enum)",
      "src/backend/api/routes/tesla.ts (+POST /manual-here)",
      "src/backend/api/routes/showroom-stores.ts (device-location → additive background ingest)",
      "src/backend/mcp/tools/tesla/report_location.ts (new) + tesla/index.ts (register)",
      "scripts/qc/pr_295.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "Every source normalizes to one LocationFix and calls one ingress",
        code: `flowchart LR
  P["phone · /device-location"] --> ING[[ingestLocationFix]]
  A["ai · report_location MCP"] --> ING
  M["manual · /api/tesla/manual-here"] --> ING
  ST["tesla-stream DO"] -.->|rewired in L1| ING
  PO["tesla-poll 120s"] -.->|rewired in L1| ING
  ING --> REC["record provenance<br/>device_location (phone/ai/manual)"]
  ING --> MAT["matchAndMarkVisited<br/>(check off stop, no auto-nav)"]
  ING --> HOME["home/work → end drive"]
  ING --> STG["stageSoftArrival<br/>near a showroom on the active drive"]
  classDef dim fill:#1e293b,stroke:#475569,color:#94a3b8;
  class ST,PO dim`,
      },
      {
        caption: "L0 lands the ingress + discrete sources; L1 adds the detector then rewires the live paths",
        code: `flowchart TD
  L0["L0 · ingress + phone/ai/manual<br/>(this PR — no migration)"] --> L1["L1 · park/dwell detector<br/>+ park_sessions (migration)<br/>+ rewire DO & poller"]
  L1 --> DONE["all sources unified<br/>+ automatic drive-away from any source"]
  classDef done fill:#1f4d2e,stroke:#4ade80,color:#e2e8f0;
  class L0 done`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_295.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 295 -- --preview",
      ranAt: "2026-07-27",
      output:
        "tsc --noEmit clean on the new ingress + visit-sessions + tesla route + showroom-stores route + the report_location tool. " +
        "pnpm run build green (exit 0). Tool count → 122 (+report_location). No schema change → no migration. " +
        "QC pr_295 (committed): regression on tesla status + visit-logs, the new /api/tesla/manual-here (200 + IngestResult; an " +
        "offshore fix records but matches/stages nothing), and that the additive ingest left /device-location's response shape intact. " +
        "Writes gated preview-only (each records a device_location fix). Runs against preview then prod after deploy.",
      migrations: [],
    },
  },
  "0032-tesla-location-config": {
    slug: "0032-tesla-location-config",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 C1 · Tesla location & proximity config",
    code: [],
    problem:
      "The source-agnostic park detector (L1) and the proximity scan (D1) both need configuration the user can set: where home and work are (so a park there pauses a drive instead of staging a visit), how close counts as 'at' a showroom, how long a stop must last to register, and whether to spend Places quota scanning for undiscovered showrooms on an unexpected park. None of it was settable — the keys existed only in the plan.",
    approach:
      "A /admin/config/tesla page in ConfigShell, three cards, over existing endpoints (no schema, no new API). Recording reuses the EXISTING tesla_telemetry_recording_enabled flag via PATCH /api/config/tesla — the same flag the integrations page toggles, so there is one source of truth and no split-brain (the spec's tesla_record_telemetry key was never implemented; reusing the real one is the right call). Home & Work use a new GeocodeAddressField that resolves a typed address to coordinates through the /api/places autocomplete+details proxy; 'use project address as home' pulls the primary property's already-geocoded coords from /api/admin/properties. Proximity & dwell writes the tesla_* / loc_* numeric + boolean keys as KV into project_system_variables through the batch-safe POST /api/admin/config (the route that was once broken by db.transaction() and is now db.batch()).",
    apiChanges: [
      "None — frontend only. Reads/writes GET+POST /api/admin/config, GET+PATCH /api/config/tesla, GET /api/admin/properties, GET /api/places/autocomplete + /details.",
    ],
    filesTouched: [
      "src/frontend/components/config/TeslaLocationConfigApp.tsx (new — the 3-card island)",
      "src/frontend/components/config/GeocodeAddressField.tsx (new — Places address→coords)",
      "src/frontend/pages/admin/config/tesla.astro (new)",
      "src/frontend/components/config/config-nav.ts (+Tesla Location under Integrations)",
      "scripts/qc/pr_293.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "Two config stores, one page — recording reuses the existing flag; location is new KV",
        code: `flowchart TD
  PAGE["/admin/config/tesla (3 cards)"] --> REC[Recording card]
  PAGE --> HW[Home & Work card]
  PAGE --> PX[Proximity & dwell card]
  REC -->|PATCH| CT["/api/config/tesla<br/>tesla_telemetry_recording_enabled"]
  HW -->|autocomplete+details| PL["/api/places proxy → coords"]
  HW -->|use project address| PR["/api/admin/properties"]
  HW -->|POST| AC["/api/admin/config (KV, db.batch)"]
  PX -->|POST| AC
  AC --> DB[(project_system_variables)]
  classDef n fill:#0f172a,stroke:#38bdf8,color:#e2e8f0;`,
      },
      {
        caption: "The config keys and what reads them (L1/D1, next passes)",
        code: `flowchart LR
  subgraph KEYS["tesla_* / loc_* KV"]
    A[tesla_home_lat/lng<br/>tesla_work_lat/lng]
    B[tesla_home_work_radius_m 150]
    C[tesla_proximity_radius_m 250]
    D[loc_dwell_min_seconds 300]
    E[loc_park_radius_m 60<br/>loc_depart_radius_m 120]
    F[tesla_location_stale_seconds 300]
    G[tesla_proximity_scan_enabled]
  end
  A --> L1[park detector · L1]
  B --> L1
  D --> L1
  E --> L1
  F --> L1
  C --> D1[proximity scan · D1]
  G --> D1`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_293.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 293 -- --preview",
      ranAt: "2026-07-27",
      output:
        "tsc --noEmit clean on the new config components + page + config-nav (filtered from the pre-existing baseline). " +
        "pnpm run build green (exit 0) — the deploy gate for a frontend PR. No schema change → no migration. " +
        "QC pr_293 (committed): regression on the endpoints the page reads (config KV, /api/config/tesla, primary property), " +
        "the new SSR page render (200 on preview; 404-on-prod = pending), and a PREVIEW-ONLY config KV write round-trip " +
        "(scratch key written, read back, blanked — prod config never polluted). Runs against preview then prod after deploy.",
      migrations: [],
    },
  },
  "0032-visit-logs-workspace": {
    slug: "0032-visit-logs-workspace",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 V2c · the Visit Logs workspace (frontend)",
    code: [],
    problem:
      "V1 shipped the schema, V2a the REST CRUD, V2b the MCP twins through one shared service. There was still no human surface: staged visits (a Tesla soft-arrival, an AI-staged note) had nowhere to be reviewed or finalized, and a store's visit history wasn't visible in its viewport. The point of running off many location sources — knowing HOW each visit was captured and how far the fix was — was invisible.",
    approach:
      "Build the workspace on the existing REST + service (no new API, no schema). Shared components first (src/frontend/components/visits/): status/type/source chips (SourceBadge maps the REAL gps_source enum, so provenance is legible), a shared StarRating, a ShowroomAutocomplete (ComboboxWithOther; OTHER creates a bare store), a controlled VisitLogEditor (PlateJS notes → md+html, segmented engagement control, arrival/departure), and a GpsEvidence panel reusing DriveMapThumb for the one-marker fix map. Then the pages: a list with Pending (anything not SUBMITTED) vs Completed tabs, a detail/finalize view (evidence + editor + this-store timeline + sticky Save-draft/Submit/Delete bar), and a manual create page (gps_source=manual). The store viewport gains a 'visits' SectionKey + bento tile whose section floats pending visits to the top with a finalize nudge, then history — reading the admin-gated ?storeId= filter (not a new ungated store sub-route). Sidebar 'Visit Logs' entry. Fixed a latent drift found along the way: the store [section].astro allow-list omitted 'contacts', so /store/:id/contacts silently fell back.",
    apiChanges: [
      "None — frontend only. Reads GET /api/showroom-visit-logs (+ ?status, ?storeId) and GET/POST /api/showroom-stores, all live since V2a/V2b.",
    ],
    filesTouched: [
      "src/frontend/components/visits/* (new — types, api, Badges, StarRating, ShowroomAutocomplete, VisitLogEditor, GpsEvidence, VisitCard, VisitLogsListApp, VisitLogDetailApp, VisitLogNewApp, StoreVisitsSection)",
      "src/frontend/pages/admin/shopping/showrooms/visitlogs.astro, visitlogs/[id].astro, visitlogs/new.astro (new)",
      "src/frontend/components/showroom/StoreViewportApp.tsx (+visits SectionKey, bento tile, render branch)",
      "src/frontend/pages/admin/shopping/store/[id]/[section].astro (allow-list: +contacts +visits)",
      "src/frontend/components/sidebar/nav-groups.ts (+Visit Logs entry), scripts/qc/pr_292.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "Workspace IA — one service, three pages + the store section, all reading the V2a/V2b surface",
        code: `flowchart TD
  NAV[Sidebar · Visit Logs] --> LIST["/visitlogs (list)<br/>Pending | Completed"]
  LIST --> DET["/visitlogs/:id<br/>evidence + finalize"]
  LIST --> NEW["/visitlogs/new<br/>manual create"]
  STORE[Store viewport] --> SEC["visits section<br/>?storeId= filter"]
  DET --> API[[/api/showroom-visit-logs]]
  NEW --> API
  SEC --> API
  LIST --> API
  API --> S[[shared visit-log service]]
  S --> DB[(showroom_visit_log)]
  classDef n fill:#0f172a,stroke:#38bdf8,color:#e2e8f0;`,
      },
      {
        caption: "A staged visit's lifecycle through the finalize UI",
        code: `stateDiagram-v2
  [*] --> PENDING: TESLA_SOFT_ARRIVAL / AI_STAGED / TESLA_STAGED / DRAFT
  PENDING --> PENDING: Save draft (status DRAFT)
  PENDING --> SUBMITTED: Submit (rating + notes + store bound)
  SUBMITTED --> [*]
  PENDING --> [*]: Delete`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_292.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 292 -- --preview",
      ranAt: "2026-07-27",
      output:
        "tsc --noEmit clean on the new visits/ surface + StoreViewportApp + nav-groups (filtered from the pre-existing baseline). " +
        "pnpm run build green (server 113s, client + prerender ✓, exit 0) — the deploy gate for a frontend PR. " +
        "No schema change → no migration. QC pr_292 (committed) exercises: regression on the data endpoints the workspace consumes (visit-logs pending/completed + store directory + ?storeId=), the new SSR pages (200 on preview; 404-on-prod reported as pending merge/deploy), and a full create→get→submit→delete round-trip through the same REST the pages drive. Runs against preview then prod after deploy.",
      migrations: [],
    },
  },
  "0032-visit-log-mcp-crud": {
    slug: "0032-visit-log-mcp-crud",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 V2b · MCP CRUD twins + the one shared service",
    code: [],
    problem:
      "V2a shipped the visit-log REST routes with their DB logic inline. The voice loop needs the same operations as MCP tools — and if MCP re-implemented the queries, the two surfaces would drift (different defaults, different rating guards, the classic split-brain).",
    approach:
      "Extract services/showroom/visit-log.ts as the single path: list (pending/completed/by-store), get, create, update, delete — with the rating 1–5 guard (the API-layer replacement for the DB CHECK SQLite can't add) and dwell computation, store name JOINed on read. Refactor the REST route to delegate to it, then add a new MCP 'visits' domain whose 7 tools are thin wrappers over the SAME service: list/get/create/update/delete_visit_log, stage_showroom_visit (forces AI_STAGED — a draft from a voice note), finalize_visit_log (forces SUBMITTED). Registered in ALL_TOOL_GROUPS (121 tools; auto-renders on /connect/tools).",
    apiChanges: [
      "MCP: list/get/create/update/delete_visit_log, stage_showroom_visit, finalize_visit_log (category 'visits').",
      "REST /api/showroom-visit-logs unchanged externally — now delegates to the shared service.",
    ],
    filesTouched: [
      "src/backend/services/showroom/visit-log.ts (new — shared service)",
      "src/backend/api/routes/showroom-visit-logs.ts (delegate to service)",
      "src/backend/mcp/tools/visits/* (7 tools + _shared + index)",
      "src/backend/mcp/tools/index.ts (register visitTools)",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "REST + MCP through one service — no drift",
        code: `flowchart LR
  UI[Admin UI / REST client] --> R[/api/showroom-visit-logs]
  VOICE[Claude voice + MCP] --> M[visits domain: 7 tools]
  R --> S[[shared visit-log service: rating guard, dwell, JOIN]]
  M --> S
  S --> DB[(showroom_visit_log)]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_290.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 290 -- --preview",
      ranAt: "2026-07-27",
      output:
        "tsc --noEmit clean on the visits domain + service + route + tools/index.ts. " +
        "pnpm run build green. Tool count 114 → 121 (+7 visits). No schema change → no migration. " +
        "QC pr_290 runs the CRUD round-trip (create DRAFT → get → finalize → rating-999 rejected → delete).",
      migrations: [],
    },
  },
  "0038-sales-schema-phase-a": {
    slug: "0038-sales-schema-phase-a",
    branch: "claude/sales-clearance-page-b0c752",
    subtitle: "Sales & Clearance · Phase A of the 0038 overhaul (data spine)",
    introduction:
      "First slice of the /admin/shopping/sales rebuild. Additive-only: it lands the whole data model the later phases (scrape upgrade, cost-aware shopping triage, weekly PDF ad, frontend) hang off, and backfills existing data — but nothing reads the new rows yet, so it is safe to ship alone.",
    problem:
      "Clearance items were stored as a JSON blob: one showroom_store_sales row per page, with an items[] array of ClearanceItem inside clearanceDetailsJson. Because items were not rows, the page could not filter by color/size, attach per-item images, watch a single listing, diff a listing across weeks, or hang a deal score + agent insight off it. Every capability the overhaul wants is blocked on the same thing: the item needs to be a row.",
    approach:
      "Promote ClearanceItem to a real sale_items table and land the mapping/support tables around it, all additive (migration 0148, applied + verified on remote D1). Compliance is built in rather than retrofitted: prices are text+cents pairs, colors go through the shared colors definition + a sale_item_colors mapping (never a comma-joined string), category/type are FKs into the shared config categories/subcategories vocab with verbatim *_text kept only as a fallback when no id could be matched (FK-not-name), and rich text (damage notes, deal insight) is stored as markdown+html. Support tables: sale_cycles (anchors a sweep), sale_scrape_runs (per-source health, incl. failed/low_quality for the Scan Health page), sale_watch, sale_research_clusters (for the cost-aware triage), weekly_sale_ad. Two columns added to existing tables: showroom_stores.is_online_only (web-only clearance sources) and showroom_store_sales.page_markdown. Backfill: backfillSaleItems() reads every isCurrent snapshot, explodes items[] into sale_items with single-row inserts batched — sale_items is ~40 columns, so a multi-row insert would exceed D1's 100 bound-param cap — and is idempotent (skips fully-backfilled snapshots; wipes + re-inserts partial ones). It is invoked once via POST /api/showroom-sales/backfill (access-gated).",
    apiChanges: [
      "POST /api/showroom-sales/backfill (access-gated) — one-shot: explode isCurrent clearanceDetailsJson.items[] into sale_items rows. Idempotent; returns snapshotsSeen/backfilled/skipped + itemsInserted/itemsExpected.",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/sale_cycles.ts, sale_items.ts, sale_item_images.ts, sale_item_colors.ts, sale_watch.ts, sale_scrape_runs.ts, sale_research_clusters.ts, weekly_sale_ad.ts (new)",
      "src/backend/db/schema/showroom/sales.ts (+page_markdown), stores.ts (+is_online_only), index.ts (barrel)",
      "src/backend/services/showroom/sales-backfill.ts (new — backfillSaleItems)",
      "src/backend/api/routes/showroom-sales.ts (+POST /backfill)",
      "drizzle/0148_keen_vance_astro.sql, scripts/qc/pr_284.mjs, docs/0038_sales_clearance_overhaul/",
    ],
    migrations: [
      {
        tag: "0148_keen_vance_astro",
        sql: "CREATE TABLE sale_items ( id INTEGER PRIMARY KEY AUTOINCREMENT, sale_snapshot_id INTEGER NOT NULL REFERENCES showroom_store_sales(id) ON DELETE cascade, store_id INTEGER NOT NULL REFERENCES showroom_stores(id) ON DELETE cascade, ... brand_id INTEGER REFERENCES brands(id) ON DELETE set null, category_id INTEGER REFERENCES categories(id) ON DELETE set null, subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE set null, original_price text, original_price_cents integer, sale_price text, sale_price_cents integer, change_status text NOT NULL DEFAULT 'new', deal_score integer, research_tier text, ... );\n-- + sale_cycles, sale_item_images, sale_item_colors (UNIQUE color_id+sale_item_id), sale_watch, sale_scrape_runs, sale_research_clusters, weekly_sale_ad\n-- + ALTER showroom_stores ADD is_online_only; ALTER showroom_store_sales ADD page_markdown;",
      },
    ],
    code: [
      {
        title: "Wide-table backfill: single-row inserts batched under D1's 100-param cap (sales-backfill.ts)",
        lang: "ts",
        code: "// sale_items is ~40 cols, so a multi-row insert would exceed D1's 100\n// bound-param cap. One row per statement stays well under it, and db.batch\n// runs each chunk atomically.\nfor (let i = 0; i < pending.length; i += BATCH_STATEMENTS) {\n  const chunk = pending.slice(i, i + BATCH_STATEMENTS);\n  const stmts = chunk.map((row) => db.insert(saleItems).values(row));\n  if (stmts.length === 0) continue;\n  await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);\n  result.itemsInserted += stmts.length;\n}",
      },
    ],
    diagrams: [
      {
        caption:
          "Phase A data spine — the JSON blob becomes real rows, with FK-not-name into the shared config vocabularies.",
        code: "erDiagram\n    showroom_store_sales ||--o{ sale_items : \"exploded into\"\n    showroom_stores ||--o{ sale_items : \"sells\"\n    sale_cycles ||--o{ sale_items : \"observed in\"\n    sale_items ||--o{ sale_item_images : \"raw src urls\"\n    sale_items ||--o{ sale_item_colors : \"colors mapping\"\n    colors ||--o{ sale_item_colors : \"definition\"\n    brands ||--o{ sale_items : \"brand_id\"\n    categories ||--o{ sale_items : \"category_id\"\n    subcategories ||--o{ sale_items : \"subcategory_id\"\n    sale_items ||--o| sale_watch : \"watched\"\n    sale_research_clusters ||--o{ sale_items : \"scored together\"\n    sale_cycles ||--o{ sale_scrape_runs : \"per-source health\"\n    sale_cycles ||--o| weekly_sale_ad : \"produces\"",
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_284.mjs",
      command:
        "pnpm run test:pr 284 -- --preview   # branch preview — runs the backfill\npnpm run test:pr 284                # production (regression guard)",
      ranAt: "2026-07-27",
      source:
        "// preview: POST /backfill, assert ok + count parity (itemsInserted === itemsExpected),\n// then a second run must insert 0 (idempotent). prod: existing sales endpoints still 200;\n// /backfill 404 is 'pending merge/deploy'. Preview shares prod D1, so the backfill writes real rows.",
      output:
        "PREVIEW (wcrp-claude-sales-clearance-page-b0c752):\n  ✓ GET /api/showroom-sales → 200 (regression)\n  ✓ GET /api/showroom-sales/facets → 200 (regression)\n  ✓ POST /backfill → 200\n  backfill: {\"snapshotsSeen\":14,\"snapshotsBackfilled\":3,\"snapshotsSkipped\":0,\"itemsInserted\":29,\"itemsExpected\":29}\n  ✓ count parity: itemsInserted === itemsExpected on first run\n  re-run: {\"itemsInserted\":0,\"snapshotsBackfilled\":0,\"snapshotsSkipped\":3}\n  ✓ idempotent: second run inserts 0 items\n  8 passed, 0 failed\n\nPRODUCTION (regression guard, pre-merge):\n  ✓ GET /api/showroom-sales → 200 (regression)\n  ✓ GET /api/showroom-sales/facets → 200 (regression)\n    POST /backfill → 404 on prod (pending merge/deploy) — expected\n  3 passed, 0 failed\n\nAlso: tsc --noEmit clean on all new/edited files; pnpm run build ✓; migration applied via pnpm run migrate:remote and all 8 tables + is_online_only + page_markdown confirmed present on remote D1 via wrangler d1 execute.",
      migrations: [
        {
          tag: "0148_keen_vance_astro",
          appliedRemote: true,
          note: "Applied via pnpm run migrate:remote; 8 tables + 2 columns verified on remote D1.",
        },
      ],
    },
  },
  "api-auth-bearer": {
    slug: "api-auth-bearer",
    branch: "claude/api-auth-bearer",
    subtitle: "Auth · raw-key Bearer path so codra + QC can hit admin-gated APIs",
    prNumber: 285,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/285",
    problem:
      "The single auth gate `isRequestAuthenticated` (used by both the `_worker.ts` SSR admin gate and the `requireAccessAuth` API middleware) accepted ONLY the `remodel_access` cookie, and that cookie's value is `SHA-256(WORKER_API_KEY)`. A browser gets it by logging in; a server-to-server client only has the RAW key and no way to present the hash. So the codra review bot — which holds `WORKER_API_KEY` and tries to exercise the APIs a PR touches — and the QC scripts both failed every admin-gated call with 401.",
    approach:
      "Widen the gate to accept the same secret over a second CHANNEL — a header — without weakening the cookie. A new `getBearerKeyFromRequest` reads `Authorization: Bearer <key>` (case-insensitive) or the `x-worker-api-key` header; if it equals `WORKER_API_KEY` (constant-time compare) the request is authed. The cookie path is unchanged: it still matches ONLY `SHA-256(key)`, never the raw key — so a stolen/exfiltrated cookie still can't be turned back into the reusable secret. (An earlier revision also accepted the raw key in the cookie for 'robustness'; the codra security review correctly flagged that as defeating the hashed-cookie design, so it was removed — raw key is header-only.) `===` on the secret was replaced with a constant-time compare on both paths to avoid an early-exit timing leak. Everything funnels through this one function, so no per-route changes were needed.",
    apiChanges: [
      "isRequestAuthenticated (shared gate) — now also accepts Authorization: Bearer <WORKER_API_KEY> and x-worker-api-key: <WORKER_API_KEY>. No new routes; every admin-gated endpoint gains the header auth path.",
    ],
    filesTouched: ["src/backend/utils/access.ts (getBearerKeyFromRequest + timingSafeEqual; isRequestAuthenticated rewritten)"],
    migrations: [],
    code: [
      {
        title: "The widened gate (access.ts)",
        lang: "ts",
        code: `export async function isRequestAuthenticated(request: Request, env: Env): Promise<boolean> {
  const apiKey = (await env.WORKER_API_KEY.get())?.trim() || "";
  if (!apiKey) return false;
  // 1) raw key via header (codra / QC)
  const bearer = getBearerKeyFromRequest(request);
  if (bearer && timingSafeEqual(bearer, apiKey)) return true;
  // 2) remodel_access cookie = SHA-256(key) ONLY (browser); never the raw key
  const cookie = getAccessCookieFromRequest(request);
  if (cookie && timingSafeEqual(cookie, await hashString(apiKey))) return true;
  return false;
}`,
      },
    ],
    diagrams: [
      {
        caption: "Who authenticates, and how",
        title: "Two credential forms, one gate",
        code: `flowchart LR
  B[Browser]:::b -->|remodel_access cookie<br/>= SHA-256 key| G{isRequestAuthenticated}:::d
  C[codra / QC<br/>holds raw key]:::b -->|Authorization: Bearer key<br/>or x-worker-api-key| G
  G -->|match, constant-time| OK[authed]:::ok
  G -->|no match| NO[401]:::no
  classDef b fill:#0f172a,stroke:#38bdf8,color:#e2e8f0;
  classDef d fill:#3f1e5f,stroke:#c084fc,color:#e2e8f0;
  classDef ok fill:#1f4d2e,stroke:#4ade80,color:#e2e8f0;
  classDef no fill:#4d1f1f,stroke:#f87171,color:#e2e8f0;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_285.mjs",
      command: "pnpm run test:pr 285 -- --preview   # branch preview (fix present)\npnpm run test:pr 285                # production (regression guard)",
      ranAt: "2026-07-27",
      output:
        "PREVIEW (wcrp-claude-api-auth-bearer):\n  ✓ target reachable\n  ✓ WORKER_API_KEY resolved locally\n  ✓ no-credential request is rejected (401)\n  ✓ cookie (hash) path still authenticates (200)\n  ✓ Authorization: Bearer <key> authenticates (200)\n  ✓ x-worker-api-key header authenticates (200)\n  6 passed, 0 failed\n\nPRODUCTION (regression guard, pre-merge):\n  ✓ target reachable\n  ✓ WORKER_API_KEY resolved locally\n  ✓ no-credential request is rejected (401)\n  ✓ cookie (hash) path still authenticates (200)\n    raw-key header auth not on prod yet — Bearer=401, header=401 (expected 401 pre-merge)\n  4 passed, 0 failed\n\nThe prod Bearer=401/header=401 confirms the bug this PR fixes (prod rejects the raw key today); the preview 200s confirm the fix. tsc --noEmit clean on access.ts.",
      migrations: [],
    },
  },
  "0032-visit-log-rest-crud": {
    slug: "0032-visit-log-rest-crud",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 V2a · REST CRUD over showroom_visit_log",
    problem:
      "V1 reconciled the schema, but there was no way to read, create, finalize, or delete a visit log except the telemetry pipeline's internal writes. The Visit Logs workspace and the voice loop both need a real CRUD surface, and the parity rule says REST and MCP go through one service to the same table.",
    approach:
      "A plain-Hono admin-gated router at /api/showroom-visit-logs (matching drive-lists.ts): list with ?status=pending|completed (pending = anything not SUBMITTED) + ?storeId, get, create, patch/finalize, delete. The store name is JOINed from showroom_stores on every read — never denormalized. Rating is validated 1-5 with Zod at the boundary (the API-layer guard that stands in for the CHECK SQLite can't ALTER-ADD). A new DRAFT status supports the human 'save draft' flow; because status is a TEXT column, adding the enum value is TS-only and db:generate emits no migration. MCP twins + the workspace UI follow as V2b/V2c.",
    apiChanges: [
      "GET /api/showroom-visit-logs?status=&storeId=&limit= — list, store name JOINed.",
      "GET /api/showroom-visit-logs/:id — one.",
      "POST /api/showroom-visit-logs — create (defaults DRAFT).",
      "PATCH /api/showroom-visit-logs/:id — update/finalize (recomputes dwell).",
      "DELETE /api/showroom-visit-logs/:id.",
    ],
    filesTouched: [
      "src/backend/api/routes/showroom-visit-logs.ts (new)",
      "src/backend/api/index.ts (mount)",
      "src/backend/db/schema/showroom/visit_log.ts (status += DRAFT, TS-only)",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "One service, two clients (parity)",
        code: `flowchart LR
  UI[Visit Logs workspace - V2b] --> REST["/api/showroom-visit-logs"]
  VOICE[Claude voice/chat - V2b MCP] --> MCP[visit-log MCP tools]
  REST --> T[(showroom_visit_log)]
  MCP --> T
  REST -. JOIN .-> S[(showroom_stores name)]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_288.mjs",
      command: "pnpm run db:generate  &&  pnpm run build  &&  pnpm run test:pr 288 -- --preview",
      ranAt: "2026-07-27",
      output:
        "db:generate → 'No schema changes' (DRAFT enum add is TS-only, no migration).\n" +
        "tsc --noEmit clean on the new route + index.ts + visit_log.ts. pnpm run build\n" +
        "green (exit 0). QC pr_288 exercises list + create→get→patch(finalize)→delete\n" +
        "round-trip incl. the rating=99 → 400 guard; run against preview + prod.",
      migrations: [],
    },
  },
  "0032-visit-log-reconcile": {
    slug: "0032-visit-log-reconcile",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 V1 · reconcile showroom_visit_log toward 0022 §5.1",
    problem:
      "The shipped showroom_visit_log is a subset of the 0022 §5.1 spec: its `type` column holds a CONTACT axis (PHONE/EMAIL/SHOWROOM_IN_PERSON), there's no engagement-depth signal, and no GPS-attestation fields. The Visit Logs workspace (V2) and the future GPS-attested review moat need the visit graded by how deep the visit actually went and how strong the location match was.",
    approach:
      "Add visit_type as the engagement axis — SOFT_ARRIVAL (auto-staged, unclassified), BROWSED_NO_CONTACT (walked through, spoke to no one), BRIEF_NO_HELP (asked, got pointed), FULL_SESSION (on the floor pulling samples), APPOINTMENT — separate from the deprecated contact-axis `type` (which belongs on showroom_store_contact_log). Add match_distance_m (how far the park was from the matched store = attestation strength) and provenance_json (raw fix + active-drive id). Widen gps_source (+ tesla-poll, phone, ai) for the coming multi-source ingress. stageSoftArrival/finalizeSoftArrivals populate the provenance fields. Rating stays 1-5 but is enforced in the API/service layer — SQLite can't ALTER-ADD a CHECK to an existing table without a full rebuild, which drizzle-kit won't auto-generate, so a schema check() would drift from the migration. hitl_queue_id + the store/hitl XOR rule are deferred to D1 (they need the showroom_store_hitl_queue table).",
    apiChanges: ["No new route in V1 (GET /api/tesla/visits gains the columns for V2)."],
    filesTouched: [
      "src/backend/db/schema/showroom/visit_log.ts (visit_type, match_distance_m, provenance_json; widened gps_source)",
      "src/backend/services/tesla/visit-sessions.ts (populate provenance on stage + finalize)",
      "drizzle/0147_lovely_silver_sable.sql",
    ],
    migrations: [
      {
        tag: "0147",
        sql: "ALTER TABLE showroom_visit_log ADD visit_type text DEFAULT 'SOFT_ARRIVAL' NOT NULL; ADD match_distance_m real; ADD provenance_json text;",
      },
    ],
    diagrams: [
      {
        caption: "Two axes: engagement (visit) vs channel (contact)",
        code: `erDiagram
  showroom_visit_log {
    text visit_type "ADD — engagement depth"
    text type "DEPRECATED — contact axis moves out"
    real match_distance_m "ADD — attestation"
    text provenance_json "ADD — raw fix"
  }
  showroom_store_contact_log {
    text type "PHONE|EMAIL|SHOWROOM_IN_PERSON"
    int showroom_visit_log_id "links a contact to a visit (D1)"
  }
  showroom_visit_log ||--o{ showroom_store_contact_log : "in-person contact during a visit"`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_286.mjs",
      command: "pnpm run db:generate  &&  pnpm run build  &&  pnpm run test:pr 286 -- --preview",
      ranAt: "2026-07-26",
      output:
        "db:generate → 0147_lovely_silver_sable.sql (3 ADD COLUMNs; no CHECK emitted —\n" +
        "SQLite ALTER limitation, rating enforced in the API layer). tsc --noEmit clean on\n" +
        "visit_log.ts + visit-sessions.ts. pnpm run build green (server built ~132s).\n" +
        "migrate:local full-chain replay against fresh local D1 run before merge. Remote\n" +
        "migration applied via the Deploy (manual) action (run_migrations:true).",
      migrations: [{ tag: "0147", applied: false }],
    },
  },
  "0037-shopping-sidebar-ia": {
    slug: "0037-shopping-sidebar-ia",
    branch: "claude/shopping-sourcing-sidebar-41f368",
    subtitle: "Shopping & Sourcing · Phase 0 of the 0037 refactor (nav + IA foundation)",
    introduction:
      "For anyone touching the admin sidebar: the nav item model is no longer flat. This is the foundation the rest of the 0037 Shopping refactor (grouped tables, ecommerce, concierge agent) builds on, so it ships alone and additive.",
    problem:
      "The Shopping & Sourcing sidebar had grown into a flat list of 15 links in 10px text, with no grouping, no icons, and no way to tuck it away. The nav data model (`SidebarItem` in shared.tsx) was strictly `{ href, label, badgeCount? }` — one level only — so the desired structure (Showrooms / Brands & Products / Purchase Ops, with Review nested a third level down) was not even expressible. And no sidebar anywhere in the app could collapse: `AdminSidebar` was a hardcoded `w-64` and `BaseLayout` offset the content by a hardcoded `md:pl-64`.",
    approach:
      "Additive, pure-frontend. `SidebarItem` becomes a recursive tree — `href`, `icon`, `children[]`, `navigateOnExpand` all optional — so existing flat groups keep working untouched while shopping gets arbitrary-depth submenus. A new `NavNode` renders each node: a leaf is a `NavLink`; a node with children is a collapsible submenu, seeded open from the SSR path when a descendant is active (no post-hydration flip), collapsed otherwise. A `navigateOnExpand` parent is a link that navigates to its section landing AND expands; a separate chevron button peeks in place without navigating. Collapse-to-rail: `AdminSidebar` gains a toggle between `w-64` and a `w-14` icon rail (one icon per admin section + expand/home/config), persisted in a `remodel_sidebar_collapsed` cookie. The reflow is done without React owning the layout: `BaseLayout` reads the cookie server-side, stamps `data-sidebar-collapsed` on `<html>`, and both the fixed aside width and the content padding read a single `--sidebar-w` CSS var keyed on that attribute — so one client toggle reflows the whole page and the SSR HTML already has the right width (no flash). Icons added per section and per shopping item; group-header text bumped 10px→xs.",
    apiChanges: ["None — pure frontend. No routes, no schema, no migration."],
    filesTouched: [
      "src/frontend/components/sidebar/shared.tsx (recursive SidebarItem/NavGroupDef; isItemActive + sumBadges; NavLink icon; new NavNode; RenderGroup renders NavNodes + group icon + xs header)",
      "src/frontend/components/sidebar/nav-groups.ts (per-section icons; shopping group re-authored into the nested tree)",
      "src/frontend/components/sidebar/AdminSidebar.tsx (collapsed prop + state + cookie; AdminRail; collapse toggle in header; aside width via --sidebar-w)",
      "src/frontend/layouts/BaseLayout.astro (cookie seed → data-sidebar-collapsed on <html>; --sidebar-w CSS var; content padding + aside width off the var)",
      "src/frontend/pages/admin/shopping.astro (hub landing regrouped to the three sections; standard page shell with icon header)",
      "docs/0037_shopping_sourcing_refactor/ (planning bundle; renamed from 0032 to avoid an ordinal collision)",
    ],
    migrations: [],
    code: [
      {
        title: "Recursive item model + active-branch test (shared.tsx)",
        lang: "tsx",
        code: `export type SidebarItem = {
  href?: string;              // optional: a pure grouping node just toggles
  label: string;
  icon?: LucideIcon;
  badgeCount?: number;
  children?: SidebarItem[];   // nesting
  navigateOnExpand?: boolean; // parent link that navigates AND expands
};

export function isItemActive(currentPath: string, item: SidebarItem): boolean {
  if (item.href && isPathActive(currentPath, item.href)) return true;
  return (item.children ?? []).some((c) => isItemActive(currentPath, c));
}`,
      },
      {
        title: "One CSS var drives both the aside and the content padding (BaseLayout.astro)",
        lang: "tsx",
        code: `const sidebarCollapsed =
  isAdmin && Astro.cookies.get("remodel_sidebar_collapsed")?.value === "1";
// <html ... data-sidebar-collapsed={sidebarCollapsed ? "1" : "0"}>
// :root { --sidebar-w: 16rem; }
// :root[data-sidebar-collapsed="1"] { --sidebar-w: 3.5rem; }
// aside:    md:[width:var(--sidebar-w)]
// content:  md:[padding-left:var(--sidebar-w)]  → reflows together, no flash`,
      },
    ],
    diagrams: [
      {
        caption: "Target shopping IA — three nested submenus",
        title: "Information architecture",
        code: `flowchart TD
  S[Shopping & Sourcing]:::grp
  S --> SR[Showrooms<br/>label → /shopping/showrooms]:::sub
  SR --> SR1[Drive Lists]
  SR --> SR2[Contacts]
  SR --> SR3[Sales & Clearance]
  SR --> SR4[Showroom Intake]
  S --> BP[Brands & Products<br/>label → /shopping/brands]:::sub
  BP --> BP1[Materials]
  BP --> BP2[Products]
  BP --> BP3[Wishlist]
  BP --> BP4[Deep Research]
  BP --> BP5[Shopping Journal]
  S --> PO[Purchase Ops]:::sub
  PO --> RV[Review]:::sub
  RV --> RV1[Price Cards]
  RV --> RV2[Product Photos]
  PO --> PO1[Receipt Review]
  classDef grp fill:#1e293b,stroke:#38bdf8,color:#e2e8f0;
  classDef sub fill:#0f172a,stroke:#64748b,color:#e2e8f0;`,
      },
      {
        caption: "Collapse-to-rail state (cookie-persisted, SSR-seeded)",
        title: "Sidebar collapse",
        code: `stateDiagram-v2
  [*] --> Expanded
  Expanded --> Rail: click collapse (cookie=1, --sidebar-w=3.5rem)
  Rail --> Expanded: click expand (cookie=0, --sidebar-w=16rem)
  note right of Rail
    aside + content padding
    both read --sidebar-w,
    so they reflow together
  end note`,
      },
    ],
    prNumber: 277,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/277",
    verification: {
      qcScript: "scripts/qc/pr_277.mjs",
      command: "pnpm run test:pr 277 -- --preview   # branch preview\npnpm run test:pr 277                # production (regression guard)",
      ranAt: "2026-07-26",
      source:
        "// SSR smoke: every shopping page still 200s with the sidebar in the HTML;\n// on --preview the new-IA markers (Purchase Ops, Sourcing Tools, data-sidebar-collapsed)\n// must be present; on prod (pre-merge) they're reported 'pending merge/deploy', not failed.",
      output:
        "PREVIEW (wcrp-claude-shopping-sourcing-sidebar-41f368):\n  ✓ target reachable\n  ✓ GET /admin/shopping → 200\n  ✓ GET /admin/shopping/schedule → 200\n  ✓ GET /admin/shopping/showrooms → 200\n  ✓ GET /admin/shopping/wishlist → 200\n  ✓ hub renders the shopping shell\n  ✓ new IA markers present (Purchase Ops + Sourcing Tools)\n  ✓ collapse-to-rail seed on <html> (data-sidebar-collapsed)\n  8 passed, 0 failed\n\nPRODUCTION (regression guard, pre-merge):\n  ✓ target reachable\n  ✓ GET /admin/shopping → 200\n  ✓ GET /admin/shopping/schedule → 200\n  ✓ GET /admin/shopping/showrooms → 200\n  ✓ GET /admin/shopping/wishlist → 200\n  ✓ hub renders the shopping shell\n    new IA markers not on prod yet — pending merge/deploy (expected pre-merge)\n  6 passed, 0 failed\n\nAlso: tsc --noEmit clean on touched files; pnpm run build '✓ built in 42.40s'; browser preview confirmed nested tree, auto-expand, collapse-to-rail reflow + expand round-trip.",
      migrations: [],
    },
  },
  "0037-showrooms-grouped-table": {
    slug: "0037-showrooms-grouped-table",
    branch: "claude/showrooms-grouped-table",
    subtitle: "Shopping & Sourcing · Phase 2 of the 0037 refactor (Showrooms grouped-table)",
    prNumber: 282,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/282",
    problem:
      "The Showrooms directory was a dense card UI with three overlapping views (map / list-by-category / directory-by-city) grouped behind an accordion. It wasted vertical space, buried the region picker in a chip row, and had no way to regroup or scan stores as a table. The homeowner wanted a single grouped experience: pick a region (tabbed, with counts), group how they like, see what's open right now, and one-tap navigate the car to a store.",
    approach:
      "Reworked `ShowroomsDirectoryApp` in place, wired to the SAME live fetch (`/api/showroom-stores?include=categories,ratings` + the three `meta/*` endpoints) — no mock data, no new endpoints. Region tabs come from the existing `HUB_LABEL` map; a `useDeviceLocation` hook reuses the existing device-location report to auto-select the nearest region (SF fallback). A group-by switcher buckets the active region's stores (Sales Category default / Rating / Flagship / Closing Time), open stores sorted by earliest close via the existing `hours-status` helpers, closed stores folded into one expandable banner. Cards reuse `ShowroomMergedCard`; rows are a new compact accessible table. The detail modal reads `hoursJson` for a full weekly schedule and posts to the real `POST /api/tesla/navigate` for Tesla nav (Google Maps uses the standard dir URL). The map view is preserved behind a Grouped/Map toggle; the retired list/directory tabs redirect to grouped.",
    apiChanges: ["None — pure frontend. Reuses existing /api/showroom-stores + meta/* and POST /api/tesla/navigate. No schema, no migration."],
    filesTouched: [
      "src/frontend/components/showroom/ShowroomsDirectoryApp.tsx (region tabs, group-by switcher, closed-collapse, cards/rows, detail modal + Tesla nav; downlevel-iteration spreads → Array.from)",
      "src/frontend/pages/admin/shopping/showrooms.astro (default tab map → grouped)",
      "src/frontend/pages/admin/shopping/showrooms/[tab].astro (valid tabs grouped|map; retired list/directory redirect to grouped)",
    ],
    migrations: [],
    code: [],
    diagrams: [
      {
        caption: "Region tab → group → render pipeline",
        title: "Grouped-table data flow",
        code: `flowchart LR
  F[fetch /api/showroom-stores + meta/*]:::b --> R{active region tab}:::d
  R --> FL[filters: search / type / open-now / visit]:::b
  FL --> G{group by}:::d
  G --> GC[Sales Category default]
  G --> GR[Rating]
  G --> GF[Flagship]
  G --> GT[Closing Time]
  GC --> S[open first, earliest close;<br/>closed → collapse banner]:::b
  S --> V{cards / rows}:::d
  V --> MODAL[detail modal:<br/>hours · Maps · Tesla nav]:::b
  classDef b fill:#0f172a,stroke:#38bdf8,color:#e2e8f0;
  classDef d fill:#3f1e5f,stroke:#c084fc,color:#e2e8f0;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_282.mjs",
      command: "pnpm run test:pr 282 -- --preview   # branch preview\npnpm run test:pr 282                # production (regression guard)",
      ranAt: "2026-07-26",
      output:
        "tsc --noEmit: 0 errors in ShowroomsDirectoryApp.tsx. pnpm run build: ✓ Complete. Preview deploy verified against production D1 (wcrp-claude-showrooms-grouped-table): region tabs with live counts (All 158 / SF 30 / South Bay 24 / Peninsula 19 / East Bay 75 / North Bay 8 / Central Valley 1), Sales-Category grouping with per-group avg rating + open-now, and closed-collapse banners ('12 closed now — SCIC SAN FRANCISCO, …') all render; no console errors on mount. QC harness pr_282 runs preview + prod (see PR).",
      migrations: [],
    },
  },
  "changelog-live-phases": {
    slug: "changelog-live-phases",
    branch: "claude/changelist-phases-live-updates-6cfa61",
    subtitle: "Changelog · phase-grouped, live-updating preview tasks (websocket + poll)",
    problem:
      "The preview changelog (/admin/changelog/preview/<slug>) is where the user reviews a proposed change and then follows it being built. But its plan-task list rendered as one flat, ungrouped <ul> — a long feature's tasks were an unreadable wall — and it was a one-time SSR snapshot: the only way to see progress was to reload the whole page. There was also no clean, low-friction way for a working agent to tick a single task's status or attach the PR it shipped in, so the board rotted between sessions and the user had no live view of where things stood.",
    approach:
      "Two halves. FRONTEND: the task list now groups by phase into collapsible sections (the exact pattern already proven on /admin/plans PlanBoardApp — lifted, not reinvented), each with a per-phase progress bar, a PR-count, per-task PR chips, and a 'pending PR' badge when every task in a phase has landed (done/in_review) but nothing merged. It stays LIVE by seeding from the SSR snapshot, then polling GET /api/changelog/proposals/:slug every 10s AND holding a websocket to plan:<slug>; any socket message pokes an immediate refetch, with the poll as the fallback (a Live/Polling pill shows which). BACKEND: a shared updatePlanTask() service writes one plan_task (by id or by planSlug+taskKey) and fans a poke out of the existing EstimateCollabHub DO — best-effort, so a downed hub never fails the write. A new update_plan_task MCP tool gives agents the per-task tick (in_progress → in_review+PR → done+PR), and PATCH /api/admin/plans/tasks/:id gains prNumber/changelogSlug/progressPct + the in_review status and routes through the same service so it publishes too. in_review was already in the plan_tasks DB enum (0028) but missing from rollup(), validation, the proposal schema and the frontend — now consistent everywhere. No migration: plan_tasks.prNumber/changelogSlug already existed.",
    apiChanges: [
      "update_plan_task (MCP, changelog domain) — set one task's status/prNumber/changelogSlug/progressPct/notes by planSlug+taskKey; fans a realtime poke.",
      "PATCH /api/admin/plans/tasks/:id — now accepts prNumber/changelogSlug/progressPct and the in_review status; publishes on write.",
      "GET/WS /api/realtime/plans?room=plan:<slug> — gateway to EstimateCollabHub (the preview page subscribes here).",
    ],
    filesTouched: [
      "src/backend/services/plan-tasks.ts (new — updatePlanTask + realtime poke)",
      "src/backend/mcp/tools/changelog/update_plan_task.ts (new MCP tool) + index.ts",
      "src/backend/api/routes/admin-plans.ts (PATCH fields + in_review + publish via service)",
      "src/_worker.ts (/api/realtime/plans gateway)",
      "src/frontend/components/changelog/ProposalBundle.tsx (phase groups, collapse, poll + WS)",
      "src/frontend/components/plans/shared.tsx (in_review across types/badges/rollup)",
      "src/frontend/pages/admin/changelog/preview/[slug].astro (carry prNumber/sortOrder/changelogSlug)",
    ],
    migrations: [],
    code: [],
    diagrams: [
      {
        caption: "An agent ticks a task → the user's open page updates with no refresh",
        code: `sequenceDiagram
  participant A as Agent
  participant W as Worker (update_plan_task / PATCH)
  participant DB as D1 plan_tasks
  participant DO as EstimateCollabHub (room plan:slug)
  participant U as Preview page (open)
  U->>DO: ws connect (room plan:slug)
  A->>W: update_plan_task(status in_review, prNumber)
  W->>DB: update row
  W-->>DO: publish poke (best-effort)
  DO-->>U: message
  U->>W: refetch GET /proposals/slug
  W-->>U: live tasks
  Note over U: 10s poll is the fallback if the socket drops`,
      },
      {
        caption: "Phase grouping + the 'pending PR' state",
        code: `stateDiagram-v2
  [*] --> pending
  pending --> in_progress: pick up
  in_progress --> in_review: open PR (+prNumber)
  in_review --> done: merge (+prNumber)
  note right of in_review
    phase shows "pending PR"
    when every task is done/in_review
    but not all merged
  end note`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_269.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 269 -- --preview   # and prod (regression)",
      ranAt: "2026-07-26",
      output:
        "`npx tsc --noEmit` — zero new errors vs the parent commit (baseline diff clean).\n" +
        "`pnpm run build` — Complete (vite + server built, prerender OK, ~54s).\n" +
        "No schema change → no migration.\n" +
        "PREVIEW QC (pr_269, against wcrp-…-6cfa61): 15 passed, 0 failed — proposal seeds\n" +
        "4 tasks carrying phase+sortOrder+prNumber; PATCH accepts in_review + prNumber 269;\n" +
        "the re-read reflects it (the follow-along path); a websocket client received the\n" +
        "realtime poke after the PATCH; /api/realtime/plans DO health reachable.\n" +
        "PROD QC (regression): 9 passed, 6 failed — the 9 are the pre-existing proposal\n" +
        "round-trip (no regression; prod already returns prNumber/sortOrder). The 6 failures\n" +
        "are the new surface (in_review, PR write, /api/realtime/plans, WS poke), which is\n" +
        "old code on prod — they flip green after merge + `pnpm run deploy`.",
      migrations: [],
    },
  },
  "tesla-live-ticker": {
    slug: "tesla-live-ticker",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · drive-scoped matching, opt-in auto-nav, live ticker",
    problem:
      "On a real drive the operator caught two wrong behaviours. The stop matcher matched against EVERY status='active' drive list, and a week-old list had never been archived — so when the car parked on the Fourth-St-Berkeley shopping strip, the nearest unvisited stop across all lists was Farrow & Ball (190 m, a stop on the stale list, same block). It false-checked that stop AND auto-sent the car a navigation command to that list's next stop (Luxury Flooring) — a place the driver never chose. Separately, there was no way to watch the live telemetry as it arrived.",
    approach:
      "Three changes. (1) loadActiveStops is scoped to is_active=true — THE one active drive (single-active invariant) — not status='active', which many stale lists share; no active drive now means no candidates and no false match. (2) Auto-navigation is gated behind a new tesla_auto_navigate config flag (default false) in BOTH the poller and the stream DO, so the vehicle is never commanded to a stop the driver didn't ask for. (3) A GET /api/tesla/stream/events endpoint returns the newest parsed telemetry frames (gear/speed/battery/coords) pre-formatted for display, and AdminTeslaAlert — while telemetry is live — polls it every 5 s and rotates through the frames (~3 s each) across the top of every admin page. Root-cause note on the earlier 0-frames: shouldStreamNow requires an ACTIVE drive (is_active) + window + toggle; the drive was status:active but never is_active, so the stream was never armed — the Tessie handshake (Authorization: Bearer header) was never the issue.",
    apiChanges: [
      "GET /api/tesla/stream/events?limit= — newest parsed telemetry frames, pre-formatted.",
      "POST /api/tesla/stream/control now accepts + returns autoNavigate.",
    ],
    filesTouched: [
      "src/backend/services/drive-geo-match.ts (loadActiveStops → is_active scope)",
      "src/backend/services/tesla/gating.ts (isAutoNavigateEnabled/setAutoNavigate)",
      "src/backend/services/tesla-poller.ts + durable-objects/tesla-stream.ts (auto-nav gated)",
      "src/backend/api/routes/tesla.ts (stream/events + control autoNavigate)",
      "src/frontend/components/AdminTeslaAlert.tsx (live parsed-event ticker)",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "Parsed frames stream to the ticker",
        code: `flowchart LR
  car[Tesla] -->|wss| DO[TeslaStreamDO]
  DO -->|insert parsed frame| TDB[(TESLA_DB)]
  TDB -->|GET /stream/events| Bar[AdminTeslaAlert]
  Bar -->|rotate ~3s| Screen[top of every /admin page]`,
      },
      {
        caption: "Matcher scope: the one active drive, not every active-status list",
        code: `flowchart TD
  park[Park fix] --> q{is_active drive?}
  q -->|no| none[no candidates → no match]
  q -->|yes| stops[stops of THAT drive only]
  stops --> near{within 250m?}
  near -->|yes| mark[mark visited]
  near -->|no| none`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_263.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 263 -- --preview",
      ranAt: "2026-07-26",
      output:
        "`npx tsc --noEmit` — clean on all six touched files (no additions to the\n" +
        "pre-existing baseline). `pnpm run build` — Complete (vite + server built,\n" +
        "prerender OK in ~96s). No schema change, so no migration. Preview/prod QC\n" +
        "(pr_263: /stream/events shape + /stream/control autoNavigate round-trip)\n" +
        "pending merge + deploy; /stream/events reads TESLA_DB which is empty until a\n" +
        "live in-window drive streams.",
      migrations: [],
    },
  },
  "tesla-visit-sessions": {
    slug: "tesla-visit-sessions",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · the IFTTT core (park → soft arrival → finalize)",
    problem:
      "The whole point of the telemetry stream was to capture visits without any manual logging: when the car parks at a showroom on an active drive, record that a visit started; when it drives away, close it with the real start/stop times. The stream DO already detected the shift-into-P, but there was nowhere to write a visit and no drive-away handling.",
    approach:
      "A new showroom_visit_log table holds visits as a two-row model. On park, stageSoftArrival finds the nearest registered showroom within 250 m (haversine over showroom_stores, behind one module so the anticipated locations move is a one-file change) and, if a drive is active, inserts a TESLA_SOFT_ARRIVAL draft with arrivalAt — deduped, so a repeated frame or a re-park can't stack drafts. On drive-away (shift P → moving), finalizeSoftArrivals closes every still-open soft arrival into a TESLA_STAGED row that copies the arrival, adds departureAt + dwellSeconds, and points softArrivalId back at the draft. That column is a partial UNIQUE, so a second finalize (onConflictDoNothing) inserts nothing — idempotent. Both entry points live in the DO's frame handler and are safe for the poller to reuse. A GET /api/tesla/visits endpoint lists the log with the store name JOINed (never denormalized).",
    apiChanges: [
      "GET /api/tesla/visits?status=&limit= — visit-log rows, newest first, store name JOINed.",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/visit_log.ts (new) + migration drizzle/0140",
      "src/backend/services/tesla/visit-sessions.ts (new)",
      "src/backend/durable-objects/tesla-stream.ts (onPark stage + drive-away finalize; connect→connectStream)",
      "src/backend/api/routes/tesla.ts (GET /visits)",
      "worker-configuration.d.ts (regenerated — TESLA_STREAM in Env)",
    ],
    migrations: [
      {
        tag: "0140",
        sql: "CREATE TABLE showroom_visit_log ( id ..., store_id integer, drive_list_id integer, stop_id integer, arrival_at integer, departure_at integer, dwell_seconds integer, status text DEFAULT 'TESLA_SOFT_ARRIVAL' NOT NULL, type text DEFAULT 'SHOWROOM_IN_PERSON' NOT NULL, rating integer, notes_markdown text, notes_html text, gps_source text, latitude real, longitude real, soft_arrival_id integer, created_at ..., updated_at ..., FKs → showroom_stores/drive_lists/drive_list_stops/self ); CREATE UNIQUE INDEX showroom_visit_log_soft_arrival_uniq ON showroom_visit_log(soft_arrival_id) WHERE soft_arrival_id IS NOT NULL;",
      },
    ],
    diagrams: [
      {
        caption: "Two-row model over a drive",
        code: `stateDiagram-v2
  [*] --> Driving
  Driving --> SoftArrival: park at showroom (active drive)
  SoftArrival --> Staged: drive-away (+ departure + dwell)
  Staged --> Driving
  SoftArrival --> Driving: home (drive ends)`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_258.mjs",
      command: "pnpm run migrate:remote  &&  pnpm run test:pr 258 -- --preview",
      ranAt: "2026-07-25",
      output:
        "Migration 0140 applied to LOCAL D1 (wrangler d1 execute --local): table + 4\n" +
        "indexes created; two-row soft→staged insert succeeded; a duplicate soft_arrival_id\n" +
        "was rejected by the partial UNIQUE index while multiple NULL-soft_arrival_id soft\n" +
        "rows were allowed. `npx tsc --noEmit` — touched files clean (DO connect collision\n" +
        "fixed; no additions to the pre-existing baseline). `pnpm run build` — Complete\n" +
        "(server built in ~130s, prerender OK). REMOTE migration + preview QC pending a\n" +
        "toolchain env / deploy.",
      migrations: [{ tag: "0140", applied: false }],
    },
  },
  "tesla-admin-alert": {
    slug: "tesla-admin-alert",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · the telemetry state, on every admin page",
    problem:
      "Telemetry is only meaningful under two conditions — a drive list is active AND it's inside 7 AM–8 PM — but nothing surfaced that state outside the drives page. The operator wanted a single global alert (alongside the active-drive alert) that says whether a drive is active and whether telemetry is live, offers a one-click enable when it should be on but isn't, and — when live — shows the actual car.",
    approach:
      "One aggregate endpoint, GET /api/tesla/stream/banner, returns everything the alert needs from D1/KV only (no DO round-trip, so it's cheap on every page): the active drive, whether telemetry is live (the DO's heartbeat-backed connected flag), the window state with a 12-hour label, whether an Enable button applies (active ∧ in-window ∧ toggle off), and — only when live — the vehicle image URL. That URL is Tesla's public compositor render of the actual car, built from Tessie's vehicle_config with the car/paint/wheel option-code maps ported from the operator's iOS app (Model 3/Y only; S/X need a longer option string) and cached in KV for a day. The alert is a React island mounted in BaseLayout after AppHeader, admin-only, that renders nothing unless a drive is active, polls every 20s (paused while the tab is hidden), and self-hides if the routes 404.",
    apiChanges: [
      "GET /api/tesla/stream/banner — { activeDrive, telemetryActive, telemetryEnabled, withinWindow, canEnable, windowLabel (12h), vehicleImageUrl }.",
    ],
    filesTouched: [
      "src/backend/services/tesla/vehicle-image.ts (new)",
      "src/backend/api/routes/tesla.ts (banner route + 12h label)",
      "src/frontend/components/AdminTeslaAlert.tsx (new)",
      "src/frontend/layouts/BaseLayout.astro (admin-only mount)",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "What the global alert shows",
        code: `flowchart TD
  A{"drive active?"} -->|no| H["nothing"]
  A -->|yes| T{"telemetry live?"}
  T -->|yes| L["'Telemetry active' + car image"]
  T -->|no| W{"in 7 AM-8 PM?"}
  W -->|yes| E["'Enable telemetry' button"]
  W -->|no| P["'paused - window is 7 AM-8 PM'"]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_251.mjs",
      command: "pnpm run test:pr 251 -- --preview   # and prod (regression)",
      ranAt: undefined,
      output:
        "AUTHORED, NOT YET RUN. Read-only: asserts the banner contract (all fields +\n" +
        "12-hour label), the canEnable and vehicle-image invariants, and that an admin\n" +
        "page still serves the layout the banner mounts in. New route reports PENDING\n" +
        "against prod until merge+deploy.",
      migrations: [],
    },
  },
  "showroom-dedup-merge-and-guards": {
    slug: "showroom-dedup-merge-and-guards",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    subtitle: "Showrooms · merge dedup + creation guards + config",
    problem:
      "Two gaps remained after the bootstrap-only seed guard. (1) The dedup tool DELETED duplicates and dropped/reparented children inconsistently; the ask was a true MERGE — keep one canonical row and move the duplicate's support data onto it, soft-deleting (not hard-deleting) the loser so it stays restorable and every is_active-filtered read path hides it. (2) Nothing stopped a NEW duplicate being created: the create endpoint only checked place_id, and the MCP create/import tools could add a store that already existed under a different place_id but the same phone/website/address. Separately, newer wrangler rejects a `remote` field on secrets_store_secrets, which broke every wrangler command (d1 execute, deploy).",
    approach:
      "dedup_showroom_stores is now a merge: per (name, city) group it picks the most-enriched keeper, remaps every child row from the duplicates onto it, and soft-deletes the duplicate store (is_active = 0). Tables with a (store, key) identity — links (url+type), hours (day), and the tag/category/product-area/product/brand mappings — are dedup-merged: a duplicate's row moves only if the keeper lacks that key, else it is dropped, so the merge never creates a second website link or trips a unique index. A shared findDuplicateStore(db, {placeId, phoneNumber, websiteUrl, locationAddress}) matches an active store by place_id, phone (digits-only), website hostname, or normalized address; it is wired into POST /api/showroom-stores (409) and the create_showroom + import_showroom_from_place MCP tools (return the existing row). And the unsupported `remote` field was stripped from the 24 secret-store bindings, with wrangler bumped to 4.114.0.",
    apiChanges: [
      "MCP dedup_showroom_stores — now MERGE + soft-delete (was delete). Dry-run reports rowsToMerge + per-table child counts.",
      "POST /api/showroom-stores — 409 now fires on place_id / phone / website / address match (was place_id only), with matchedOn.",
      "MCP create_showroom / import_showroom_from_place — return the existing store (created:false, 'exists (matched by …)') instead of creating a duplicate.",
    ],
    filesTouched: [
      "src/backend/mcp/tools/showrooms/dedup_showroom_stores.ts",
      "src/backend/services/showroom/duplicate-check.ts",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/mcp/tools/showrooms/create_showroom.ts",
      "src/backend/mcp/tools/showrooms/import_showroom_from_place.ts",
      "wrangler.jsonc",
      "package.json",
      "scripts/0119-soft-delete-showroom-duplicates.sql",
    ],
    migrations: [],
    code: [
      {
        title: "Merge: move a duplicate's rows onto the keeper, then soft-delete",
        lang: "ts",
        code: `// DEDUP MOVE — move only rows the keeper lacks (by url+type / day / mapping id);
// drop the rest so the merge never duplicates the keeper's data.
if (keeperKeys.has(keyOf(row, t.keyCols))) toDrop.push(id);
else { toMove.push(id); keeperKeys.add(keyOf(row, t.keyCols)); }
// SIMPLE MOVE — repoint per-event child rows (notes, ratings, sales…) to keeper.
await db.update(t.table).set({ [t.key]: keepId }).where(inArray(t.col, dupeIds));
// then SOFT-DELETE the emptied duplicate store — never a hard delete.
await db.update(showroomStores).set({ isActive: false, updatedAt: new Date() })
  .where(inArray(showroomStores.id, dupeIds));`,
      },
      {
        title: "Creation guard shared by the endpoint + MCP tools",
        lang: "ts",
        code: `const dup = await findDuplicateStore(db, {
  placeId, phoneNumber, websiteUrl, locationAddress,
});           // matches active store by place_id | phone-digits | website host | normalized address
if (dup) return existing row (409 on the endpoint; created:false on MCP);`,
      },
    ],
    diagrams: [
      {
        caption: "Create → duplicate guard → insert",
        code: `flowchart TD
  A[create store — endpoint or MCP] --> B[findDuplicateStore]
  B --> C{active match?}
  C -- "place_id / phone / website / address" --> R[reject: return existing row]
  C -- none --> I[insert new store]
  classDef stop fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  classDef ok fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  class R stop
  class I ok`,
      },
    ],
    verification: {
      qcScript: "MCP dedup_showroom_stores (dry-run) + tsc/build",
      command: "npx tsc --noEmit; pnpm run build; dedup_showroom_stores {}",
      ranAt: "2026-07-25",
      output:
        "npx tsc --noEmit — 0 errors in the changed files. Dry-run (pre-merge) reported 33\n" +
        "groups / 54 rows, childRowCounts { showroom_store_links: 26 } — confirming the\n" +
        "duplicates only carry seeded links, which the merge dedups. Apply is human-gated.",
    },
  },
  "drives-map-fix-card-actions": {
    slug: "drives-map-fix-card-actions",
    branch: "claude/drive-list-ui-improvements-b58ece",
    prNumber: 244,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/244",
    subtitle: "Drives · PR-A quick fixes (map render + card action strip)",
    problem:
      "The drive viewport's route map (DriveRouteMap — MapLibre GL with a free CartoCDN basemap, no API key) plots only the stops that carry lat/lng, and renders a single empty MapPinned icon on a muted panel when NONE do. Drive stops are denormalized: a stop can be created with just a showroomStoreId and no coords of its own. The landing list already worked around this — it coalesces each marker's coords from the linked showroom — but GET /api/drive-lists/:slug returned stops verbatim, so any drive whose stops lacked their own lat/lng showed a blank pin even though the linked showrooms are geocoded. In production that was 14 of 23 drives. Two cosmetic issues rode along: the Tesla button sat as a separate raised secondary button OUTSIDE the address+Navigate background, and the hours/phone were small badges — hard to hit on a Tesla or phone screen.",
    approach:
      "A new service helper, fillMissingStopCoords(db, stops), backfills each stop's null lat/lng from its linked showroom in one bounded query (drives cap at 24 stops, so no chunking), mutating in place; the :slug handler calls it before responding. It lives in the service layer, not the route, deliberately — drizzle-orm 0.33's .set() type inference is fragile and degrades from added type-load in a file, so keeping the extra showroom query out of the route file leaves its unrelated PATCH handlers' inference intact. On the frontend, the address+Navigate <a> and the Tesla <button> now share one rounded bg-muted container at matched min-h-14 height (a thin divider between them), reading as a single control strip; the hours badge is enlarged to text-base and the phone becomes a large min-h-12 tap-to-dial button.",
    apiChanges: [
      "GET /api/drive-lists/:slug — unchanged contract; each returned stop's latitude/longitude is now backfilled from its linked showroom when the stop's own value is null.",
    ],
    filesTouched: [
      "src/backend/services/drive-lists.ts (new fillMissingStopCoords helper)",
      "src/backend/api/routes/drive-lists.ts (:slug calls the helper)",
      "src/frontend/components/drives/DriveViewportApp.tsx (action strip + hours/phone)",
      "scripts/qc/pr_244.mjs (new)",
    ],
    migrations: [],
    code: [
      {
        title: "Backfill stop coords from the linked showroom (service)",
        lang: "ts",
        code: `// A stop can be created without lat/lng yet still link a geocoded showroom;
// the map + per-stop navigation key off the stop's OWN coords, so without this
// the whole map falls back to an empty pin. Bounded (<=24 stops) — no chunking.
const need = stops.filter(
  (s) => (s.latitude == null || s.longitude == null) && s.showroomStoreId != null,
);
if (need.length === 0) return stops;
const ids = Array.from(new Set(need.map((s) => s.showroomStoreId)));
const coords = await db
  .select({ id: showroomStores.id, latitude: showroomStores.latitude, longitude: showroomStores.longitude })
  .from(showroomStores)
  .where(inArray(showroomStores.id, ids));
const byId = new Map(coords.map((r) => [r.id, r]));
for (const s of stops) {
  const sr = s.showroomStoreId == null ? null : byId.get(s.showroomStoreId);
  if (!sr) continue;
  if (s.latitude == null) s.latitude = sr.latitude;
  if (s.longitude == null) s.longitude = sr.longitude;
}`,
      },
    ],
    diagrams: [
      {
        caption: "Why the map went blank, and where the fix sits",
        code: `flowchart TD
  A[GET /api/drive-lists/:slug] --> B[load drive_list_stops]
  B --> C{stop has own lat/lng?}
  C -- yes --> P[plot marker]
  C -- "no, but links showroom" --> F[fillMissingStopCoords: coalesce from showroom]
  C -- "no, no showroom" --> N[stop omitted from map]
  F --> P
  P --> M{any plotted stop?}
  M -- yes --> MAP[render MapLibre route map]
  M -- no --> ICON[empty pin fallback — the reported bug]
  classDef fix fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef bug fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  class F,MAP fix
  class ICON bug`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_244.mjs",
      command: "pnpm run test:pr 244 -- --preview   # and bare against prod (regression)",
      ranAt: "2026-07-25",
      output:
        "PREVIEW (fix):  4 passed, 0 failed — 23/23 drives render a map, 94/94 linked stops carry coords,\n" +
        "  'no drive links showrooms yet renders an empty map' assertion PASSES.\n" +
        "PROD (old code): 3 passed, 0 failed — list + detail 200/shape regression guards pass;\n" +
        "  9/23 drives map, 28/94 linked stops with coords; coord-backfill assertion reported\n" +
        "  PENDING merge/deploy (14 offending drives on prod, the bug).\n" +
        "pnpm run build (astro/esbuild — the deploy path) passes. tsc adds two spurious .set()\n" +
        "inference errors on byte-identical unchanged code — the known drizzle-0.33 instability\n" +
        "that already blankets ~50 baseline files; runtime unaffected.",
      migrations: [],
    },
  },
  "tesla-stream-ui": {
    slug: "tesla-stream-ui",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · the operator's on/off switch + live mode",
    problem:
      "The streaming lifecycle (#241) and the DO (#242) are entirely backend — the operator had no way to turn live streaming on/off, and no way to see whether ingest was streaming, polling, or idle at a glance. The spec called for a toggle on the drive-list UI, with polling as the explicit fallback when the toggle is off.",
    approach:
      "A small header card on the Showroom Drives page. A Switch writes the toggle through POST /api/tesla/stream/control; a status pill reads /control + /status every 15s and derives the mode — Streaming when the DO reports connected, Polling when a drive is active but the stream isn't carrying (toggle off / outside window / socket down), Idle otherwise, and Tripped when the circuit breaker is set. Every state carries a one-line reason (the 07:00–20:00 window, the fallback cadence, or 'no active drive') so the mode is self-explanatory. The widget removes itself when the routes 404, so a worker that predates the ingest deploy shows nothing rather than a broken card.",
    apiChanges: ["(none — consumes /api/tesla/stream/control + /status from #241/#242)"],
    filesTouched: [
      "src/frontend/components/drives/TeslaStreamControl.tsx (new)",
      "src/frontend/components/drives/DriveListsApp.tsx",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "The pill's three (plus one) states",
        code: `stateDiagram-v2
  [*] --> Idle
  Idle --> Streaming: toggle ON · drive active · 07-20 · connected
  Streaming --> Polling: toggle OFF (drive active)
  Polling --> Streaming: toggle ON (in window)
  Streaming --> Idle: drive ended / window closed
  Streaming --> Tripped: circuit breaker`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_247.mjs",
      command: "pnpm run test:pr 247 -- --preview   # and prod (regression)",
      ranAt: undefined,
      output:
        "AUTHORED, NOT YET RUN. Regression guard: the drives page serves (200) and the\n" +
        "two endpoints the widget reads are reachable and shaped as the component expects.\n" +
        "Read-only; runs against preview and prod.",
      migrations: [],
    },
  },
  "tesla-stream-do": {
    slug: "tesla-stream-do",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · the outbound socket, built cost-safe",
    problem:
      "TESLA_DB is empty because nothing holds Tessie's real-time telemetry — it's an OUTBOUND WebSocket the client dials, not a webhook. But an outbound socket the worker holds is DURATION-BILLED the whole time, and the $700 DO runaway proved an unbounded alarm loop can bill into the thousands. So the connector can't just 'open a socket' — it has to be incapable of running away and incapable of staying open when it isn't earning its keep.",
    approach:
      "A singleton Durable Object whose every native-alarm tick re-checks shouldStreamNow (active drive ∧ 07:00–20:00 Pacific ∧ recording ∧ toggle) and drops the socket + goes dormant the moment that's false. Alarms are native ctx.storage.setAlarm (single slot, replaces — never the append-only Agents-SDK schedule that caused #162). Every fire also runs the shared circuit breaker: the global kill-switch, a native fire-rate window (reconnect-storm guard), a per-UTC-day TESLA_DB write budget, and a max-continuous-connected backstop — any trip hard-stops with no reschedule. Frames parse through the shared extractTelemetryFields; persistence is throttled (always on a shift change, otherwise ≤ every 5s) so a ~500ms firehose can't become an unbounded D1 write cost; on the shift→P transition it mirrors the poller (match+mark the nearest stop, auto-nav the next, and close the drive on home arrival — which also drops the socket). Drive activation signals the DO start/stop so ingest is event-driven, but the DO's own guard stays the source of truth.",
    apiChanges: [
      "POST /api/tesla/stream/start — arm the DO lifecycle (safe no-op outside the window).",
      "POST /api/tesla/stream/stop — disconnect + stop now.",
      "GET /api/tesla/stream/status — connected, connectedSinceMs, writesToday, breaker, nextAlarmMs.",
    ],
    filesTouched: [
      "src/backend/durable-objects/tesla-stream.ts (new)",
      "wrangler.jsonc (TESLA_STREAM binding + migration v16)",
      "src/_worker.ts (export TeslaStreamDO)",
      "src/backend/api/routes/tesla.ts (stream start/stop/status)",
      "src/backend/api/routes/drive-lists.ts (activation → DO signal)",
      "src/backend/services/tesla/gating.ts + tesla-poller.ts (KV floor + heartbeat)",
    ],
    migrations: [{ tag: "v16", sql: "-- DO migration: new_sqlite_classes [\"TeslaStreamDO\"] (no D1 DDL)" }],
    diagrams: [
      {
        caption: "Every alarm: circuit breaker → lifecycle → connect/heartbeat/dormant",
        code: `flowchart TD
  A["native alarm"] --> CB{"breaker ok?"}
  CB -->|trip| STOP["close · deleteAlarm · dormant"]
  CB -->|ok| LC{"shouldStreamNow?"}
  LC -->|no| STOP
  LC -->|yes| C["connect / heartbeat · re-arm 90s"]
  F["frame → P"] --> H{"home?"}
  H -->|yes| STOP`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_242.mjs",
      command: "pnpm run test:pr 242 -- --preview   # and prod (regression)",
      ranAt: undefined,
      output:
        "AUTHORED, NOT YET RUN. Read-only QC (status contract + control regression + the\n" +
        "60s cadence floor); it never calls /start, which would open a real Tessie socket.\n" +
        "Live connect/disconnect is smoke-tested manually against the preview worker with\n" +
        "Tessie configured. New routes report PENDING against prod until merge+deploy.",
      migrations: [{ tag: "v16", applied: false }],
    },
  },
  "receipt-review-hitl": {
    slug: "receipt-review-hitl",
    branch: "claude/receipt-review-hitl-4808",
    subtitle: "Shopping · 0030 receipt→room deduction, the review surface",
    problem:
      "The 0030 engine (shipped #229/#236) reads an emailed receipt, and for each line item deduces which room the material belongs to — a receipt of three toilets is split across three bathrooms by homogeneity, product-nature, and open-slot signals. But a deduction is an educated guess, and nothing should enter the materials schedule on a guess. Until this PR the proposals sat staged in D1 with no way for the owner to review them: the MCP tools could resolve one conversationally, but there was no visual queue to see a whole receipt at once, read the reasoning, and correct the rooms the engine placed wrong.",
    approach:
      "A receipt-grouped HITL queue at /admin/shopping/receipt-review. Staged room_proposals are fetched and grouped by invoiceId — one card per receipt — and each line item shows the proposed room, the confidence, and the engine's reasoning. The room is editable from a dropdown of the ELIGIBLE candidate rooms the engine considered; for the cases it gets way wrong, the dropdown also carries an \"Other room…\" entry that opens a modal with RoomSelect over ALL rooms (floor-grouped, searchable). \"Confirm all\" walks the receipt's proposals and resolves each via the #236 endpoint, which mints the material against the chosen roomId FK. Frontend-only — no schema change, no new endpoint. The page is the standard thin Astro shell (BaseLayout, icon header, `class` not `className`) mounting one React island.",
    apiChanges: [
      "No new endpoints. Reuses GET /api/materials/room-proposals?status=staged and POST /api/materials/room-proposals/:id/resolve from #236, and GET /api/rooms/catalog for the Other-room modal.",
    ],
    filesTouched: [
      "src/frontend/components/materials/ReceiptReviewApp.tsx (new)",
      "src/frontend/pages/admin/shopping/receipt-review.astro (new)",
      "src/frontend/components/sidebar/nav-groups.ts (+1 link)",
    ],
    migrations: [],
    code: [
      {
        title: "Per-line room picker — eligible candidates + an Other-room escape hatch",
        lang: "tsx",
        code: `<DropdownMenu>
  <DropdownMenuTrigger render={<Button variant="outline" />}>
    {chosenRoomName ?? proposal.proposedRoomName ?? "Pick a room"}
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    {proposal.candidates.map((c) => (
      <DropdownMenuItem key={c.roomId} onClick={() => setRoom(proposal.id, c.roomId)}>
        {c.roomName}
      </DropdownMenuItem>
    ))}
    <DropdownMenuSeparator />
    {/* way-wrong escape hatch → modal over ALL rooms */}
    <DropdownMenuItem onClick={() => setOtherOpen(proposal.id)}>Other room…</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

// Confirm resolves each staged proposal against a roomId FK (never a name).
await api.post(\`/api/materials/room-proposals/\${p.id}/resolve\`, { roomId });`,
      },
    ],
    diagrams: [
      {
        caption: "Review flow — one receipt, per-line room correction",
        code: `flowchart TD
  Q[staged room_proposals] --> G[group by invoiceId]
  G --> C[receipt card: line items + reasoning]
  C --> R{room correct?}
  R -- yes --> K[keep proposed room]
  R -- "wrong, but a candidate" --> D[pick from eligible dropdown]
  R -- "way wrong" --> O["Other room… → RoomSelect over ALL rooms"]
  K --> F[Confirm all]
  D --> F
  O --> F
  F --> P["POST resolve :id {roomId} → mint material vs FK"]
  classDef keep fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  class K,F keep`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_246.mjs",
      command: "pnpm run test:pr 246 -- --preview   # and against prod (regression)",
      ranAt: "2026-07-25",
      output:
        "Preview wcrp-claude-receipt-review-hitl-4808:\n" +
        "  GET /admin/shopping/receipt-review → 200, shell + astro-island present.\n" +
        "  GET /api/materials/room-proposals?status=staged → 3 Toilet proposals under invoiceId 28\n" +
        "    (TOTO→Primary, 2 Kohler→Guest/Hall), each with candidates[] + a numeric proposedRoomId.\n" +
        "  POST /room-proposals/46/resolve {roomId:3284744} → 200, minted material #10\n" +
        "    \"TOTO Washlet G5A\" room=Primary Bathroom; reprocess email 3 re-stages clean.\n" +
        "  pnpm run build green; tsc --noEmit no net-new errors.",
    },
  },
  "showroom-dedup-hardening": {
    slug: "showroom-dedup-hardening",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    subtitle: "Showrooms · dedup tool v2 (bug fix + review fixes)",
    problem:
      "The dedup tool (PR #227) reparented EVERY child FK from a duplicate to the keeper. That is wrong for showroom_store_links: the seed inserts a WEBSITE link per store, and showroom_store_links has NO unique index — so reparenting a shell's seeded link would leave the kept store with two website links. The v1 leaned on `UPDATE OR IGNORE` to skip collisions, but with no unique index there is no collision to skip, so the duplicate link would simply be created. Codra's review also flagged raw sql.raw usage, sequential (non-batched) writes, loading the whole table into memory, brittle result casts, and a missing docstring.",
    approach:
      "A per-table policy replaces the blanket reparent. REPARENT (move loser→keeper) only user data worth keeping — notes, ratings, pocs, contacts, sales, images, price observations, drive stops, journal. DROP everything else — the seeded WEBSITE link, hours, scrape logs, and unique-index join mappings — by leaving it for the loser's ON DELETE CASCADE; four non-cascade artifact tables (photo buckets, product photos, scan log, sitemap) are explicitly deleted first so the store delete isn't blocked by a NO-ACTION FK. The rewrite is fully-typed Drizzle builders (no raw SQL), writes go through db.batch() (D1 has no transactions) in ≤90-param chunks, the store load selects only the 11 columns needed, a single changesOf() helper replaces the ad-hoc casts, and the export carries a JSDoc. The dry-run still prints per-table child counts, so any unexpected data on a shell (e.g. a mapping) is visible before apply.",
    apiChanges: ["MCP dedup_showroom_stores — same contract; corrected apply semantics + typed/batched internals."],
    filesTouched: ["src/backend/mcp/tools/showrooms/dedup_showroom_stores.ts"],
    migrations: [],
    code: [
      {
        title: "Per-table policy — reparent user data, drop the rest",
        lang: "ts",
        code: `// REPARENT (typed, batched) — user data moved to the keeper
db.update(storeRating).set({ storeId: keepId }).where(inArray(storeRating.storeId, ids)),
db.update(showroomPocs).set({ showroomId: keepId }).where(inArray(showroomPocs.showroomId, ids)),
// ...ratings, contacts, sales, images, price, drive-stops, journal

// DROP — links/hours/scrape/mappings are NOT moved. showroom_store_links has no
// unique index, so moving the seeded WEBSITE link would duplicate the keeper's.
// The loser's ON DELETE CASCADE removes them; 4 non-cascade tables deleted first.
const batch = [...reparentStmts, ...dropStmts, db.delete(showroomStores).where(inArray(showroomStores.id, ids))];
await db.batch(batch); // D1 runs a batch as one all-or-nothing unit`,
      },
    ],
    diagrams: [
      {
        caption: "Child-row disposition on apply",
        code: `flowchart TD
  L[loser row + its children] --> R{child table kind?}
  R -- "user data" --> M[reparent -> keeper]
  R -- "seeded link / hours / scrape / mapping (cascade)" --> C[leave — cascade deletes on loser delete]
  R -- "artifact, non-cascade" --> X[explicit delete first]
  M --> D[delete loser store]
  C --> D
  X --> D
  classDef keep fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef stop fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  class M keep
  class C,X,D stop`,
      },
    ],
    verification: {
      qcScript: "MCP dedup_showroom_stores (dry-run)",
      command: "dedup_showroom_stores {}  (dry-run, via the MCP connector)",
      ranAt: "2026-07-25",
      output:
        "npx tsc --noEmit — 0 errors in the rewritten tool. Dry-run runs server-side via the\n" +
        "connector; its per-table child counts are reviewed before any apply. No rows deleted\n" +
        "without approval.",
    },
  },
  "tesla-stream-lifecycle-control": {
    slug: "tesla-stream-lifecycle-control",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · lifecycle gating before the socket exists",
    problem:
      "The next PR adds TeslaStreamDO, which holds an OUTBOUND WebSocket to streaming.tessie.com. Unlike an inbound hibernatable socket, an outbound one the worker dials is DURATION-BILLED the whole time it's held — a DO left connected 24/7 is exactly the always-on cost the $700 incident taught us to fear. So before the DO exists, the lifecycle rules that keep it from running unnecessarily have to be in place and testable, and the poller that #178 shipped (a cron fallback) has to know when to stand down so the two paths never double-process one drive.",
    approach:
      "One decision surface — services/tesla/gating.ts — answers 'should the stream be connected now?' and 'should the poller run instead?' so the DO, the control routes, and the scheduled tick all agree. The stream is alive only when ALL hold: a drive is active, local time is inside the daytime window (default 07:00–20:00 Pacific, computed with Intl so DST is correct on a UTC worker), telemetry recording is on, and the UI toggle is on. shouldStreamNow / shouldPollNow are complementary — exactly one covers an active drive, so there's no gap and no overlap. The frame extractors were lifted verbatim out of routes/tesla.ts into services/tesla/frames.ts so the DO and the compat webhook parse identically. Config lives in project_system_variables (one batched read), the poller stands down on a DO-set connected flag and throttles on a configurable cadence, drive activation is 409'd outside the window, and enforceStreamWindow (run each scheduled minute) deactivates a drive once the window closes.",
    apiChanges: [
      "GET /api/tesla/stream/control — { control, shouldStream, shouldPoll } (admin).",
      "POST /api/tesla/stream/control — set { enabled?, windowStartHour?, windowEndHour?, pollFallbackSeconds? }; inverted window → 400.",
      "PATCH /api/drive-lists/:slug { isActive:true } now → 409 outside the 07:00–20:00 window.",
    ],
    filesTouched: [
      "src/backend/services/tesla/frames.ts (new)",
      "src/backend/services/tesla/gating.ts (new)",
      "src/backend/services/tesla-poller.ts",
      "src/backend/api/routes/tesla.ts",
      "src/backend/api/routes/drive-lists.ts",
      "src/_worker.ts",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "When the streaming DO is alive vs when the poller takes over",
        code: `stateDiagram-v2
  [*] --> Idle
  Idle --> Streaming: drive active AND 07:00-20:00 AND recording AND toggle ON
  Streaming --> Polling: toggle OFF (drive still active)
  Polling --> Streaming: toggle ON (inside window)
  Streaming --> Idle: car home OR 20:00 close
  Polling --> Idle: car home OR 20:00 close`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_241.mjs",
      command: "pnpm run test:pr 241 -- --preview   # and against prod (regression)",
      ranAt: undefined,
      output:
        "AUTHORED, NOT YET RUN. This container has no node_modules / tokens CLI and\n" +
        "cannot reach the deployed worker, so QC runs in a toolchain env against the\n" +
        "branch preview AND prod. The control routes are new, so the prod run reports\n" +
        "them PENDING until this merges and the manual Deploy action runs.",
      migrations: [],
    },
  },
  "showroom-store-dedup-tool": {
    slug: "showroom-store-dedup-tool",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    subtitle: "Showrooms · destructive cleanup, dry-run first",
    problem:
      "The non-idempotent seed ran three times, leaving showroom_stores with 219 rows where ~159 are unique — ~60 city-only duplicate shells, with the earliest stores (Whole Wood = ids 1, 154, 188) tripled. PR #221's guard stops NEW duplication but does nothing about the rows already there. Cleaning them is genuinely dangerous: ~28 child columns across 27 tables carry a FK to showroom_stores, almost all ON DELETE CASCADE, so a blind delete silently cascades away any visit/note/rating a user attached to a duplicate. And a naive 'delete the high ids' would destroy 8 stores that exist ONLY as later-seed rows (Italdoors ×2, Craftex, Tile Tech Pavers, Topcret ×2, The Container Store, IKEA PAX).",
    approach:
      "An admin-gated MCP tool, dry-run by default. It groups rows by (normalized name + city), so distinct chain branches in different cities never share a group. Within a group it keeps the most-enriched row (zip/placeId » coords » icon/hero » phone » lowest id) and marks the rest duplicates. A hard anti-merge guard: if a group has ≥2 'real' rows (each with its own zip or placeId) it is treated as distinct locations and SKIPPED — 'All Natural Stone' in four cities is left untouched. The dry run writes nothing and returns the full keep/delete map plus, per duplicate, the count of child rows in every FK table — the 'is real data attached?' signal a human approves before anything is deleted. apply:true reparents each child FK from loser to keeper (UPDATE OR IGNORE for unique-mapping join tables, whose skipped rows are then swept by ON DELETE CASCADE; plain UPDATE elsewhere so the row definitely moves before its loser is deleted), then deletes the losers — chunked under D1's 100-bound-param cap.",
    apiChanges: [
      "MCP dedup_showroom_stores — DESTRUCTIVE. Dry-run (default) returns {duplicateGroups, rowsToDelete, rowsAfter, ambiguousGroupsSkipped, childRowsToReparent, plan[]}. apply:true performs reparent + delete.",
    ],
    filesTouched: [
      "src/backend/mcp/tools/showrooms/dedup_showroom_stores.ts",
      "src/backend/mcp/tools/showrooms/index.ts",
    ],
    migrations: [],
    code: [
      {
        title: "Anti-merge guard — never collapse two genuine locations",
        lang: "ts",
        code: `const reals = rows.filter(isReal); // isReal = has zip OR placeId
if (reals.length >= 2) {
  // Two distinct genuine locations sharing (name, city). Do NOT merge —
  // that would destroy a real store. Leave the whole group for a human.
  ambiguous.push({ key, ids: rows.map(r => r.id), reason: "distinct locations" });
  continue;
}
// 0 or 1 real row: the rest are city-only shells → safe to collapse.
const sorted = [...rows].sort((a, b) => score(b) - score(a) || a.id - b.id);
const keep = sorted[0];
const deleteIds = sorted.slice(1).map(r => r.id);`,
      },
    ],
    diagrams: [
      {
        caption: "Per-group decision — keep the enriched row, skip ambiguous groups",
        code: `flowchart TD
  A[group rows by name + city] --> B{group size > 1?}
  B -- no --> K[keep single row]
  B -- yes --> C{>= 2 rows have zip/placeId?}
  C -- "yes (distinct branches)" --> S[SKIP group — report ambiguous]
  C -- no --> D[keep highest-scored row]
  D --> E[reparent child FKs loser -> keeper]
  E --> F[delete losers]
  classDef keep fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef stop fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  class K,D,E keep
  class F,S stop`,
      },
      {
        caption: "Reparent-then-delete across the child FK tables",
        code: `sequenceDiagram
  participant T as dedup tool
  participant D as D1
  T->>D: UPDATE (OR IGNORE) child.fk = keepId WHERE fk IN losers
  Note over T,D: plain UPDATE for logs/observations;\\nOR IGNORE for unique-mapping join tables
  T->>D: DELETE FROM showroom_stores WHERE id IN losers
  D-->>T: ON DELETE CASCADE sweeps any OR-IGNORE-skipped rows`,
      },
    ],
    prNumber: 227,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/227",
    verification: {
      qcScript: "MCP dedup_showroom_stores (dry-run)",
      command: "dedup_showroom_stores {}  (dry-run, via the MCP connector)",
      ranAt: "2026-07-25",
      output:
        "npx tsc --noEmit — 0 errors in the new tool + barrel.\n" +
        "Dry-run executes server-side via the MCP connector (this container has no prod DB\n" +
        "access). The keep/delete map + per-table child-row counts are produced by the\n" +
        "dry-run for human approval BEFORE any apply:true call. No rows deleted without that\n" +
        "approval.",
    },
  },
  "brands-name-key-dedup": {
    slug: "brands-name-key-dedup",
    branch: "claude/showroom-location-tagging-ex2ik5",
    subtitle: "Brands · dedup + integrity guard (ops #4)",
    problem:
      "A bulk import forked the brand roster: it inserted ALL-CAPS / respaced restatements of brands that already existed, so a single company appeared as two `brands` rows, each holding half its showroom and type mappings. Nine such pairs were logged in ops issue #4 (e.g. `#188 Newport Brass` / `#302 NEWPORTBRASS`, `#18 Dornbracht` / `#315 DORN BRACHT`, `#184 Visual Comfort` / `#221 Visual Comfort & Co.`). The two mapping tables each carry a UNIQUE pair — `brand_type_mappings(brand_id, type_id)` and `showroom_brand_mappings(showroom_id, brand_id)` — so naively repointing a loser's rows to the survivor hits a unique violation on the pairs that overlap, aborting a merge half-applied. Nothing at the schema level stopped the next import from forking the roster again.",
    approach:
      "Merge in the 0118 order that cannot lose data, then add a schema-level guard. For the last live pair (Visual Comfort): delete the loser's colliding `brand_type_mappings` row (survivor already holds that type), repoint the remaining FK rows to the survivor, carry the loser's spelling across as a demoted (`is_primary=0`) alias, COALESCE any scalar the survivor was missing, and finally soft-retire the loser (`is_active=0`, never DELETE — every brand FK is ON DELETE cascade). Then a PARTIAL unique index enforces the invariant going forward. The normalization strips case + spaces + dots + commas so restatements collapse; `WHERE is_active = 1` is mandatory because dedup keeps losers as soft-deleted rows and 6 active/retired pairs share a name key — a full index would refuse to create. Suffix variants (`& Co.`) still differ after stripping and stay the intake layer's job.",
    apiChanges: [
      "No API surface change. Schema-only: new partial unique index brands_name_key_uniq.",
      "Future create_brand / ensure_brand inserts that would fork an active brand by case/spacing now fail loudly at the DB instead of silently duplicating.",
    ],
    filesTouched: [
      "src/backend/db/schema/brands/brands.ts",
      "drizzle/0138_white_hedge_knight.sql",
      "drizzle/meta/0138_snapshot.json",
    ],
    migrations: [
      {
        tag: "0138",
        sql: `CREATE UNIQUE INDEX \`brands_name_key_uniq\` ON \`brands\` (replace(replace(replace(lower(trim("name")),' ',''),'.',''),',','')) WHERE "brands"."is_active" = 1;`,
      },
    ],
    code: [
      {
        title: "Partial unique index — brands.ts",
        lang: "ts",
        code: `export const brands = sqliteTable("brands", {
  // …columns…
}, (table) => ({
  // Two ACTIVE brands may not share a normalized name key. Strips case + spaces
  // + dots + commas so bulk-import restatements ("Newport Brass" / "NEWPORTBRASS")
  // collapse to one. PARTIAL on is_active=1 — dedup soft-deletes losers, and 6
  // active/retired pairs share a name key, so a full index would refuse to create.
  nameKeyUniq: uniqueIndex("brands_name_key_uniq")
    .on(sql\`replace(replace(replace(lower(trim(\${table.name})),' ',''),'.',''),',','')\`)
    .where(sql\`\${table.isActive} = 1\`),
}));`,
      },
    ],
    diagrams: [
      {
        caption: "The merge — loser's rows repoint to the survivor, then the loser is retired (never deleted)",
        code: `flowchart TD
  L["#221 Visual Comfort & Co.<br/>(loser)"] -->|"drop colliding<br/>type_id=21 row"| T[brand_type_mappings]
  L -->|"repoint showroom 136"| S[showroom_brand_mappings]
  L -->|"carry spelling as<br/>is_primary=0 alias"| V[brand_name_variations]
  L -->|"COALESCE blank scalars"| K["#184 Visual Comfort<br/>(survivor · showrooms 121+136)"]
  L -->|"is_active = 0<br/>(soft-retire, keep FKs)"| R[(retired)]
  classDef keep fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef stop fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  class K keep
  class R stop`,
      },
      {
        caption: "The guard — a partial unique index over the normalized name key of ACTIVE brands only",
        code: `erDiagram
  brands {
    int id PK
    text name
    int is_active "soft-delete flag"
  }
  brands ||--o| brands_name_key_uniq : "UNIQUE(norm(name)) WHERE is_active=1"
  brands_name_key_uniq {
    expr key "replace(...lower(trim(name))...) — strips case/space/dot/comma"
    partial where "is_active = 1 — retired losers exempt"
  }`,
      },
    ],
    prNumber: 223,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/223",
    verification: {
      qcScript: "n/a — data + index change verified directly against remote D1",
      command: "cloudflare D1 /query (read-back after merge)",
      source:
        "SELECT id,name,is_active FROM brands WHERE id IN (184,221);\n" +
        "SELECT showroom_id FROM showroom_brand_mappings WHERE brand_id=184;\n" +
        "SELECT replace(replace(replace(lower(trim(name)),' ',''),'.',''),',','') k, count(*) c\n" +
        "  FROM brands WHERE is_active=1 GROUP BY k HAVING c>1;",
      ranAt: "2026-07-25",
      output:
        "Merge (applied to remote): #184 Visual Comfort active; #221 retired (is_active=0);\n" +
        "#184 now carries showrooms [121, 136]; 0 residual rows point at #221;\n" +
        "active brands 385 -> 384; 0 mechanical name-key collisions remain.\n" +
        "Index migration 0138: `pnpm run db:generate` is a clean no-op (schema <-> snapshot\n" +
        "<-> .sql consistent). NOT yet on remote D1 — applies via `pnpm run migrate:remote`\n" +
        "(schema changes don't ride the build); verify brands_name_key_uniq exists after deploy.",
    },
  },
  "showroom-seed-bootstrap-only": {
    slug: "showroom-seed-bootstrap-only",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    subtitle: "Showrooms · seed hygiene",
    problem:
      "`seedShowroomStores` inserts a FIXED list of ~146 stores straight into `showroom_stores`. The seed rows carry no natural key — no `placeId`, no unique slug — and the function had no guard, so it inserted unconditionally every time it ran. `POST /api/showroom-stores/seed` is meant as a one-shot bootstrap for an empty database, but nothing stopped it being called twice. It was, and production ended up with 213 store rows where there should be 146: 'Whole Wood' appeared three times, dozens of others twice. Because the duplicates are byte-identical to the originals, the directory list and map silently doubled up, and every downstream join (links, hours, visits, ratings) fanned out across the clones.",
    approach:
      "The seed's contract is 'populate an EMPTY directory', so it now enforces that contract. Before inserting anything it does a `SELECT id ... LIMIT 1`; if any store already exists it logs and returns `{ inserted: 0, skipped }` without writing a row. Re-running the seed against a populated table is now a safe no-op instead of a duplication event. This is deliberately the smallest possible change — it stops the bleeding. Removing the rows already duplicated is a destructive operation (choose the best row per store, reparent every child FK, delete the rest) and is held as a separate, sign-off-gated step rather than bundled into this fix.",
    apiChanges: [
      "UNCHANGED surface: POST /api/showroom-stores/seed still returns 200, but on a populated DB it now inserts nothing (was: cloned every store).",
    ],
    filesTouched: ["src/backend/db/seeds/seed-showroom-stores.ts"],
    migrations: [],
    code: [
      {
        title: "Bootstrap-only guard — seed-showroom-stores.ts",
        lang: "ts",
        code: `export async function seedShowroomStores(db: DrizzleD1Database) {
  const stores = getStoreData();

  // Bootstrap-only + idempotent. This seed inserts a FIXED list with no natural
  // key (seed rows carry no placeId), so re-running it on a populated table just
  // clones every store — a repeat POST /api/showroom-stores/seed did exactly
  // that, producing a second and third "Whole Wood" etc. The seed exists only to
  // bootstrap an EMPTY directory, so bail the moment any store already exists.
  const [existing] = await db
    .select({ id: showroomStores.id })
    .from(showroomStores)
    .limit(1);
  if (existing) {
    console.log(
      "Showroom stores already present — skipping seed (bootstrap-only; re-seeding would duplicate rows).",
    );
    return { inserted: 0, skipped: stores.length };
  }
  // …unchanged insert loop below…
}`,
      },
    ],
    diagrams: [
      {
        caption: "Seed decision — the guard turns a re-run into a no-op",
        code: `flowchart TD
  A[POST /api/showroom-stores/seed] --> B{any showroom_stores row exists?}
  B -- "no (empty DB)" --> C[insert fixed list<br/>~146 stores + WEBSITE links]
  C --> D[return inserted: 146]
  B -- "yes (populated)" --> E[skip — return inserted: 0, skipped]
  classDef ok fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef stop fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  class C,D ok
  class E stop`,
      },
    ],
    prNumber: 221,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/221",
    verification: {
      qcScript: "scripts/qc/pr_221.mjs",
      command: "pnpm run test:pr 221",
      source:
        "const before = d1('SELECT COUNT(*) n FROM showroom_stores;')[0]?.n;\n" +
        "const res = await c.post('/api/showroom-stores/seed', {});\n" +
        "const after = d1('SELECT COUNT(*) n FROM showroom_stores;')[0]?.n;\n" +
        "check('re-seed did NOT add rows (bootstrap-only guard held)', after === before);",
      ranAt: "2026-07-25",
      output:
        "npx tsc --noEmit — 0 new errors in seed-showroom-stores.ts.\n" +
        "pnpm run build — Complete (server built, prerender OK).\n" +
        "pnpm run test:pr 221 — AUTHORED, NOT YET RUN. This session runs in a remote\n" +
        "container with no `tokens` CLI and no CLOUDFLARE_API_TOKEN, so it cannot reach\n" +
        "the deployed worker or remote D1. The idempotency regression guard must be run\n" +
        "against prod from a toolchain-equipped environment before merge; result pending.",
    },
  },
  "tesla-location-ai-p6": {
    slug: "tesla-location-ai-p6",
    subtitle: "0023 Phase P6 — the in-car assistant's location tools",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    prNumber: 220,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/220",
    introduction:
      "For an AI riding along in the car. These are the two MCP tools it calls to know where the driver is and what's worth a stop — enriched by the worker so the model gets a heading, a street address and a freshness stamp rather than bare coordinates, and gated so a 'what's near me?' can never quietly spend past Google's free tier.",
    problem:
      "`get_vehicle_location` returned four fields — latitude, longitude, a raw Tessie address, and a map URL. An in-car assistant can't say 'you're heading north-west on El Camino' from that: there was no heading (Tessie reports it, but `getLocation` never parsed it), no way to fill an address when Tessie omitted one, and no freshness signal, so a minutes-old fix read exactly like a live one. And there was no tool at all for the core on-the-road question — 'which showrooms are near me right now, and which way?' — even though the coordinates to answer it already sit on `showroom_stores` and the quota-safe Places/Geocoding methods shipped in #185.",
    approach:
      "get_vehicle_location is enriched in place rather than forked into a second tool. `getLocation` now parses Tessie's `heading` and fix `timestamp` (fail-soft, normalizing the seconds-or-ms the firmware varies on); the tool converts heading to a 16-point compass, fills a missing address via the quota-gated `reverseGeocode` (Geocoding SKU, degrades to null — never bills past free tier, never fails the call), derives the Bay Area region, and stamps serverTime + ageSeconds + isStale, treating an unknown age as stale so a possibly-old fix is never narrated as live. whats_near_me is new: it resolves the origin the same way get_user_location does (explicit coords → live Tesla GPS → last phone fix), then ranks registered showrooms by haversine distance with a bearing + compass to each, and on request sweeps quota-gated placesNearby for undiscovered nearby spots (de-duped against known showrooms by proximity). Crucially, every showroom coordinate is read through ONE helper, loadShowroomCoords — the single seam that survives the anticipated move of location data off showroom_stores. A prior audit confirmed that move is not yet in flight (no such table in any schema, PR, or branch), so reading showroom_stores today is correct, and isolating it means the future move is a one-line change.",
    apiChanges: [
      "MCP get_vehicle_location — enriched output: heading, headingCompass, address (reverse-geocoded fallback), region, serverTime, ageSeconds, isStale, note (was: latitude, longitude, address, mapUrl)",
      "MCP whats_near_me (NEW) — inputs latitude?/longitude?/radiusMeters?/limit?/includeUndiscovered?; returns origin, showrooms[{distance, bearing, compass}], undiscovered[], note",
      "No REST or schema change; both Google paths are the already-shipped quota-gated reverseGeocode/placesNearby",
    ],
    filesTouched: [
      "src/backend/mcp/tools/tesla/get_vehicle_location.ts",
      "src/backend/mcp/tools/showrooms/whats_near_me.ts",
      "src/backend/mcp/tools/showrooms/_shared.ts",
      "src/backend/mcp/tools/showrooms/index.ts",
      "src/backend/services/tesla.ts",
      "src/backend/services/drive-geo-match.ts",
      "scripts/qc/pr_220.mjs",
    ],
    migrations: [],
    code: [
      {
        title: "The single coordinate-source seam (survives the showroom_stores_locations move)",
        lang: "ts",
        code: `// _shared.ts — THE only place showroom coordinates are read for proximity.
// When location data moves off showroom_stores, change this query and every
// proximity caller (whats_near_me, the P4 park-scan) follows automatically.
export async function loadShowroomCoords(db: RemodelDb): Promise<ShowroomCoord[]> {
  const rows = await db
    .select({
      id: showroomStores.id,
      name: showroomStores.name,
      latitude: showroomStores.latitude,
      longitude: showroomStores.longitude,
      address: showroomStores.locationAddress,
      hubName: showroomStores.hubName,
    })
    .from(showroomStores)
    .where(and(isNotNull(showroomStores.latitude), isNotNull(showroomStores.longitude)))
    .all();
  return rows.filter((r): r is ShowroomCoord => r.latitude != null && r.longitude != null);
}`,
      },
      {
        title: "Freshness: an unknown age is treated as stale, never narrated as live",
        lang: "ts",
        code: `const ageSeconds =
  loc.timestampMs != null ? Math.max(0, Math.round((nowMs - loc.timestampMs) / 1000)) : null;
// Unknown age ⇒ stale — better to under-promise freshness than to imply a live fix.
const isStale = ageSeconds == null || ageSeconds > STALE_AFTER_SECONDS;`,
      },
    ],
    diagrams: [
      {
        caption: "Enrichment round-trip",
        title: "get_vehicle_location — enrich, quota-safe, freshness-stamped",
        description:
          "The reverse-geocode only fires when Tessie omitted an address, and it is on the Geocoding SKU so a blown quota degrades to a null address instead of failing the call.",
        code: `sequenceDiagram
  participant AI as In-car AI
  participant V as get_vehicle_location
  participant Tess as Tessie /location
  participant G as GoogleMaps (geocoding SKU)
  AI->>V: where am I / which way?
  V->>Tess: getLocation (fresh)
  Tess-->>V: lat/lng, heading, fix-time
  alt no address on the fix
    V->>G: reverseGeocode (quota-gated)
    G-->>V: address | null (fail-soft)
  end
  V-->>AI: coords + compass + address + region + serverTime/ageSeconds/isStale`,
      },
      {
        caption: "whats_near_me flow",
        title: "whats_near_me — origin resolution, ranking, and the coordinate seam",
        description:
          "Origin falls back explicit → Tesla → phone. Registered showrooms are read through loadShowroomCoords (the one seam); the optional Places sweep is quota-gated and de-duped against known showrooms.",
        code: `flowchart TD
  A(["whats_near_me"]) --> O{"explicit coords?"}
  O -->|yes| ORIG["origin = explicit"]
  O -->|no| T{"live Tesla GPS?"}
  T -->|yes| ORIG2["origin = tesla (+heading)"]
  T -->|no| P{"last phone fix?"}
  P -->|yes| ORIG3["origin = phone"]
  P -->|no| ERR["clean tool error"]:::bad
  ORIG --> LC["loadShowroomCoords(db)<br/>THE coordinate seam"]:::seam
  ORIG2 --> LC
  ORIG3 --> LC
  LC --> RANK["haversine + bearing → sort → limit"]:::ok
  RANK --> U{"includeUndiscovered?"}
  U -->|yes| PLACES["placesNearby (quota-gated)<br/>dedupe vs known"]:::ok
  U -->|no| OUT["showrooms + note"]:::ok
  PLACES --> OUT
  classDef ok fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef bad fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  classDef seam fill:#1f2f4d,stroke:#60a5fa,color:#e6f0ff`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_220.mjs",
      command: "pnpm run test:pr 220 -- --preview  &&  pnpm run test:pr 220",
      source: `// Registry-catalog integrity (the tools are OAuth-gated MCP; the public
// /api/mcp-docs catalog is the honest wire check per AGENTS.md).
const wnm = byName("whats_near_me");
checks.ok("whats_near_me outputs origin/showrooms/undiscovered/note",
  has(fieldNames(wnm), "origin", "showrooms", "undiscovered", "note"));
const gvl = byName("get_vehicle_location");
checks.ok("get_vehicle_location exposes the enriched output fields",
  has(fieldNames(gvl), "heading","headingCompass","address","region","serverTime","ageSeconds","isStale"));`,
      output:
        "NOT YET RUN in this environment — the session container has no node_modules/toolchain (WORKER_API_KEY is a remote-only secrets-store binding with no local fallback). QC must run in a toolchain env against --preview AND prod; the whats_near_me + enriched-field checks report PENDING against prod until this merges and `pnpm run deploy` runs. Real output will be pasted here once executed.",
      ranAt: undefined,
      migrations: [],
    },
  },
  "0029-health-platform": {
    slug: "0029-health-platform",
    branch: "claude/backend-health-checks-d1-d6df78",
    prNumber: 195,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/195",
    problem:
      "The health surface shipped in 0027 was five hardcoded binding pings written into one file: D1, TESLA_DB, KV, R2, and a presence check on the AI binding. Everything else this Worker depends on was unwatched — three Vectorize indexes, nine Workflows, fourteen Durable Object namespaces, roughly thirty Secrets Store credentials, Cloudflare Images, the MCP tool registry, the inbound email pipeline, the Tesla telemetry database, and every relational invariant in the sourcing data. Nothing watched cost at all, on an account that had already burned about $50/day for weeks on a Durable Object doing full table scans and only found out from an invoice. And the output was undiagnosable: a row reading `kv_cache: down` told a reader nothing about what that meant, where the code lived, or what to do next — that knowledge existed only in somebody's head. There was also no notion of a session, so `health_checks` could not answer what the system looked like at a particular moment, and the whole thing was served publicly while being, in substance, a map of internal infrastructure.",
    approach:
      "Ownership moved to the modules. Each backend module now exports HEALTH_PROBES from its own health.ts, and a probe is BOTH the executable check and its own documentation — whatSuccessMeans, whatFailureMeans, troubleshootingSteps, devOpsPlaybook, the bindings it touches, its severity, and whether it watches spend are literal fields on the object. The runner upserts those literals into health_test_def on every run, so the runbook a human reads is generated from the code that ran; there is no seed SQL and no second copy to drift. Cost discipline is a hard rule rather than a preference: a probe may read a binding, read a secret, run a D1 aggregate, do one tiny KV round trip, or head an R2 key — it may never invoke a model, call a paid API, create a Workflow instance, or enumerate a bucket. The whole 88-probe screen costs nothing and finishes in about two seconds, which is what makes it clickable rather than ceremonial. Reconciling with #169, which landed a competing health surface mid-flight, was done by bridging rather than replacing: its data-quality registry keeps its own shape and endpoint, and its checks are wrapped as probes so one run covers both and everything lands in one ledger.",
    apiChanges: [
      "POST /api/health/session — run every registered probe, persist one row per probe under a shared session_uuid (admin)",
      "GET  /api/health/session/latest — the last persisted session, for first paint and the header pip (admin)",
      "GET  /api/health/sessions — recent sessions, newest first, rolled up (admin)",
      "GET  /api/health/catalogue — every test with its full runbook, grouped for the dashboard (admin)",
      "GET  /api/health/badge — status + counts only; returns null rather than 401 for an unauthed request (admin-aware)",
      "MCP run_health_session — the third trigger, with failuresOnly and billingOnly filters",
      "UNCHANGED: GET /api/health and POST /api/health/run stay public — external uptime monitors read them",
    ],
    filesTouched: [
      "src/backend/services/health/types.ts",
      "src/backend/services/health/probes.ts",
      "src/backend/services/health/run.ts",
      "src/backend/db/schema/health/health_tests.ts",
      "src/backend/{db,api,ai,mcp,realtime}/health.ts",
      "src/backend/services/{workflows,ai-gateway,usage,render,email,gmail,google,google-photos,tesla,showroom,documents,image-processor}/health.ts",
      "src/backend/api/routes/health.ts",
      "src/backend/mcp/tools/ops/run_health_session.ts",
      "src/frontend/components/health/HealthDashboardApp.tsx",
      "src/frontend/components/health/HealthStatusBadge.tsx",
      "src/frontend/pages/admin/system/health.astro",
      "src/frontend/components/AppHeader.tsx",
      "src/frontend/components/sidebar/AdminSidebar.tsx",
      "src/frontend/components/sidebar/nav-groups.ts",
      "src/_worker.ts",
      "scripts/qc/pr_195.mjs",
    ],
    migrations: [
      {
        tag: "0125_supreme_dust",
        sql: `CREATE TABLE \`health_test_def\` (
\tid integer PRIMARY KEY AUTOINCREMENT NOT NULL,
\tname text NOT NULL,
\tdisplay_name text NOT NULL,
\tdescription text NOT NULL,
\thealth_ts_filepath text NOT NULL,
\twhat_success_means text NOT NULL,
\twhat_failure_means text NOT NULL,
\ttroubleshooting_steps text NOT NULL,
\tdev_ops_playbook text NOT NULL,
\tis_billing_risk integer DEFAULT false NOT NULL,
\tseverity text DEFAULT 'MEDIUM' NOT NULL,
\tis_active integer DEFAULT true NOT NULL,
\tcreated_at integer DEFAULT (unixepoch()) NOT NULL,
\tupdated_at integer DEFAULT (unixepoch()) NOT NULL
);
CREATE UNIQUE INDEX \`health_test_def_name_idx\` ON \`health_test_def\` (\`name\`);

CREATE TABLE \`health_results\` (
\tid integer PRIMARY KEY AUTOINCREMENT NOT NULL,
\ttimestamp integer DEFAULT (unixepoch()) NOT NULL,
\tsession_uuid text NOT NULL,
\thealth_test_def_id integer NOT NULL,
\thealth_test_result text NOT NULL,
\thealth_test_result_details text,
\tduration_ms integer,
\ttriggered_by text DEFAULT 'api' NOT NULL,
\tFOREIGN KEY (health_test_def_id) REFERENCES health_test_def(id)
);
CREATE INDEX \`health_results_session_idx\` ON \`health_results\` (\`session_uuid\`);

-- The binding-type vocabulary is a definition + mapping pair, never a
-- comma-separated column: the dashboard filters by it.
CREATE TABLE \`health_binding_types\` (
\tid integer PRIMARY KEY AUTOINCREMENT NOT NULL,
\tname text NOT NULL,
\tdescription text,
\tis_active integer DEFAULT true NOT NULL
);
CREATE TABLE \`health_test_binding_types\` (
\tid integer PRIMARY KEY AUTOINCREMENT NOT NULL,
\thealth_test_def_id integer NOT NULL,
\thealth_binding_type_id integer NOT NULL,
\tFOREIGN KEY (health_test_def_id) REFERENCES health_test_def(id) ON DELETE cascade,
\tFOREIGN KEY (health_binding_type_id) REFERENCES health_binding_types(id) ON DELETE cascade
);
CREATE UNIQUE INDEX \`health_test_binding_types_pair_idx\` ON \`health_test_binding_types\` (\`health_test_def_id\`,\`health_binding_type_id\`);`,
      },
    ],
    code: [
      {
        title: "The probe is the runbook — services/health/types.ts",
        lang: "ts",
        code: `export interface HealthProbe {
  /** Stable snake_case id. Also the natural key of \`health_test_def\`. */
  name: string;
  displayName: string;
  description: string;
  /** Repo path of the health.ts that owns this probe — "where do I fix it". */
  healthTsFilepath: string;
  bindingTypesTested: string[];
  whatSuccessMeans: string;
  whatFailureMeans: string;
  troubleshootingSteps: string;
  devOpsPlaybook: string;
  /** True when the probe exists to catch a sudden jump in spend. */
  isBillingRisk: boolean;
  severity: "HIGH" | "MEDIUM" | "LOW";
  /** May throw — the runner turns a throw into FAILURE, so one probe
      can never sink the session. */
  run: (env: Env) => Promise<HealthProbeOutcome>;
}`,
      },
      {
        title: "A spend watcher — last 24h vs the 7 days BEFORE it",
        lang: "ts",
        code: `// The baseline deliberately EXCLUDES the last 24h. Including it would let a
// spike inflate its own baseline and hide itself.
const recent = await scalar(env.DB,
  "SELECT COALESCE(SUM(estimated_cost_usd),0) FROM gemini_usage_log WHERE timestamp >= ?",
  now - 86400);
const baseline = await scalar(env.DB,
  "SELECT COALESCE(SUM(estimated_cost_usd),0)/7 FROM gemini_usage_log WHERE timestamp >= ? AND timestamp < ?",
  now - 8 * 86400, now - 86400);

const ratio = baseline > 0 ? recent / baseline : null;
if (ratio === null) return degraded("NO BASELINE — cannot judge this as normal or not");
if (ratio >= 5) return failure(\`AI spend \${recent.toFixed(2)} USD is \${ratio.toFixed(1)}x the 7-day average\`);
if (ratio >= 2) return degraded(\`AI spend \${recent.toFixed(2)} USD is \${ratio.toFixed(1)}x the 7-day average\`);
return ok(\`AI spend \${recent.toFixed(2)} USD, within \${ratio.toFixed(1)}x of baseline\`);`,
      },
      {
        title: "Persisting a session — db.batch(), never db.transaction()",
        lang: "ts",
        code: `const runs = await Promise.all(ALL_HEALTH_PROBES.map((p) => runProbe(p, env)));

// D1 rejects BEGIN (error 7500), so a batch is the only atomic unit available.
// A persistence failure is logged, never thrown: a broken audit trail must not
// hide a working — or broken — system.
const stmts = runs.map((r) =>
  db.insert(healthResults).values({
    timestamp, sessionUuid,
    healthTestDefId: defIdByName.get(r.name) as number,
    healthTestResult: r.result,
    healthTestResultDetails: r.details.slice(0, 4000),
    durationMs: r.durationMs,
    triggeredBy,
  }),
);
if (stmts.length > 0) {
  await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
}`,
      },
      {
        title: "Bridging the #169 data-quality checks into the same ledger",
        lang: "ts",
        code: `const dataQualityProbes: HealthProbe[] = HEALTH_CHECKS.map((check) =>
  defineProbe({
    name: \`data_quality_\${check.slug.replace(/-/g, "_")}\`,
    // …
    run: async (env: Env) => {
      const r = await check.run(env);
      const stats = r.stats.map((s) => \`\${s.label}=\${s.value}\`).join(", ");
      const details = \`\${r.summary} — score \${r.score}/100; \${stats}\`;
      if (r.status === "healthy") return ok(details);
      if (r.status === "degraded") return degraded(details);
      // "unhealthy" AND "unknown" both fail. A check that THREW must never be
      // mistaken for an all-clear.
      return failure(details);
    },
  }),
);`,
      },
    ],
    diagrams: [
      {
        caption: "Ownership: each module declares its own probes; one registry, one runner, one ledger.",
        code: `flowchart LR
  subgraph modules["17 backend modules — each owns a health.ts"]
    db["db"]
    api["api"]
    ai["ai"]
    rt["realtime"]
    wf["workflows"]
    usage["usage (cost)"]
    integ["email · gmail · google · photos · tesla"]
    media["images · render · documents"]
    mcp["mcp"]
    show["showroom"]
  end
  quality["registry.ts — #169 data-quality checks"]
  modules --> reg["probes.ts<br/>ALL_HEALTH_PROBES (88)"]
  quality -->|bridged as a group| reg
  reg --> run["run.ts — runHealthSession()"]
  run --> d1[("health_test_def<br/>health_results")]
  run --> apis["/api/health/*"]
  apis --> ui["/admin/system/health"]
  apis --> pip["header pip"]
  classDef done fill:#1f4d2e,stroke:#4ade80,color:#e8ffe8
  class reg,run done`,
      },
      {
        caption: "The catalogue: definitions, a binding-type vocabulary, and one result row per probe per session.",
        code: `erDiagram
  health_test_def ||--o{ health_results : "records"
  health_test_def ||--o{ health_test_binding_types : "touches"
  health_binding_types ||--o{ health_test_binding_types : "is used by"

  health_test_def {
    int id PK
    text name UK "snake_case, natural key"
    text health_ts_filepath
    text what_success_means
    text what_failure_means
    text troubleshooting_steps
    text dev_ops_playbook
    bool is_billing_risk
    text severity "HIGH|MEDIUM|LOW"
    bool is_active "soft delete"
  }
  health_binding_types {
    int id PK
    text name UK "d1, kv, r2, workflow, ..."
  }
  health_test_binding_types {
    int id PK
    int health_test_def_id FK
    int health_binding_type_id FK
  }
  health_results {
    int id PK
    int timestamp "session start, shared"
    text session_uuid "shared by one run"
    int health_test_def_id FK
    text health_test_result "SUCCESS|FAILURE|DEGRADED"
    text health_test_result_details
    int duration_ms
    text triggered_by "ui|api|mcp|cron"
  }`,
      },
      {
        caption: "One session, end to end.",
        code: `sequenceDiagram
  actor U as Admin
  participant UI as /admin/system/health
  participant API as POST /api/health/session
  participant R as runHealthSession()
  participant D1 as D1
  U->>UI: click "Run health checks"
  UI->>UI: every row becomes a skeleton, button spins
  UI->>API: POST (admin cookie required)
  API->>R: runHealthSession(env, "ui")
  R->>D1: syncHealthCatalogue() — upsert 88 defs + binding vocab (db.batch)
  par 88 probes, concurrent, each time-boxed at 10s
    R->>R: probe.run(env)
  end
  R->>D1: 88 health_results rows, one session_uuid (db.batch)
  R-->>UI: {overall, counts, runs[]}
  UI->>U: timeline repaints, grouped by module`,
      },
      {
        caption: "Outcome states — DEGRADED is a real state, not a soft failure.",
        code: `stateDiagram-v2
  [*] --> Running
  Running --> SUCCESS: within envelope
  Running --> DEGRADED: up but outside its envelope<br/>(stale data, backlog, 2x spend, optional credential missing)
  Running --> FAILURE: unreachable, throws, required credential absent, 5x spend
  Running --> FAILURE: timed out after 10s
  SUCCESS --> [*]
  DEGRADED --> [*]
  FAILURE --> [*]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_195.mjs",
      command: "pnpm run test:pr 195 -- --preview",
      ranAt: "2026-07-22",
      source: `// The runbook fields are the whole point — an empty one is a defect, not a nit.
const FIELDS = ["description", "whatSuccessMeans", "whatFailureMeans",
  "troubleshootingSteps", "devOpsPlaybook", "healthTsFilepath"];
const bare = catalogueTests.filter((t) => FIELDS.some((f) => !t[f] || String(t[f]).length < 20));
checks.ok("every test has a populated runbook", bare.length === 0, bare.map((t) => t.name).join(", "));

// The session must be PERSISTED, not just returned.
checks.ok("the run we just made is the latest persisted session",
  r.json?.session?.sessionUuid === session.sessionUuid);

// The badge must never leak the system map to an unauthed reader.
checks.ok("badge is null for an unauthed request",
  anon.status === 200 && anon.json?.status === null);`,
      output: `QC pr_195 — health platform
target: https://wcrp-claude-backend-health-checks-d1-d6df78.hacolby.workers.dev

  ✓ target reachable (…) 

Regression — public health endpoints (uptime monitors read these)
  ✓ GET /api/health is public and 200
  ✓ GET /api/health still returns status + services
  ✓ POST /api/health/run (0027 screen) still works
  ✓ …and still returns per-binding checks

Regression — #169 data-quality registry (bridged, must still stand alone)
  ✓ GET /api/system/health/checks → 200
  ✓ …registry is non-empty

Auth — the catalogue is a map of internal infrastructure, so it is gated
  ✓ POST /api/health/session unauthed → 401
  ✓ GET /api/health/catalogue unauthed → 401

Catalogue — every test carries its own runbook
  ✓ GET /api/health/catalogue → 200
  ✓ catalogue is grouped
  ✓ catalogue is substantial
    storage:10 api:5 compute:10 ai:9 cost:7 media:14 integrations:20 connector:5 domain:5 quality:3
  ✓ every test has a populated runbook
  ✓ severity is always a valid enum value
  ✓ test names are unique
  ✓ cost watchers exist
  ✓ the #169 data-quality checks are bridged in

Session — run every probe for real
  ✓ POST /api/health/session → 200 even when probes fail
  ✓ session returns a uuid
  ✓ every catalogued test ran
  ✓ overall is a valid roll-up
  ✓ counts sum to the run count
  ✓ every run carries details
  ✓ the screen is fast (< 20s wall)
    overall=FAILURE counts={"success":74,"degraded":12,"failure":2} wall=2424ms
    FAILURE tesla_telemetry_freshness :: tesla_telemetry_events is empty — no telemetry frame has EVER been recorded.
    FAILURE mcp_tool_registry_integrity :: 100 tools registered, but — no examples[]: create_render_session, list_room_angles, run_render_stage, …
    DEGRADED showroom_scrape_failures :: scrape_status — failed: 49, running: 0, pending: 10, complete: 25.
    DEGRADED showroom_geo_coverage :: 72 of 215 active stores (33.5%) have no latitude/longitude; 72 of those DO have an address.
    DEGRADED image_processor_staging_errors :: 7 staging row(s) with processing_status='failed'; most recent: D1_ERROR: too many SQL variables
    (…8 more DEGRADED)

Ledger — the session must be persisted, not just returned
  ✓ GET /api/health/session/latest → 200
  ✓ the run we just made is the latest persisted session
  ✓ …with every row persisted
  ✓ GET /api/health/sessions → 200
  ✓ history is grouped by session
  ✓ sessions are distinct

Badge — cheap, and never triggers a probe
  ✓ GET /api/health/badge → 200
  ✓ badge reports the latest session's status
  ✓ badge is null for an unauthed request (renders nothing, never leaks)

Pages — the dashboard moved behind the admin gate
  ✓ /admin/system/health renders for an admin
  ✓ …and mounts the dashboard island
  ✓ /health → /admin/system/health
  ✓ /admin/health → /admin/system/health

37 passed, 0 failed

--- production run (pnpm run test:pr 195), pre-merge regression guard ---
  ✓ GET /api/health is public and 200
  ✓ POST /api/health/run (0027 screen) still works
  ✓ GET /api/system/health/checks → 200
  ✓ /admin/system/health renders for an admin
    ⏳ POST /api/health/session — pending merge/deploy (HTTP 404 on production)
    ⏳ /health redirect — pending merge/deploy (HTTP 200)
9 passed, 0 failed`,
      migrations: [
        {
          tag: "0125_supreme_dust",
          appliedRemote: true,
          note: "Applied with `pnpm run migrate:remote` and verified: SELECT name FROM sqlite_master WHERE name LIKE 'health%' returns health_binding_types, health_checks, health_results, health_test_binding_types, health_test_def. First real session then wrote 88 health_results rows under one session_uuid and 88 health_test_def rows with 12 binding types and 91 mappings. Renumbered from 0124 to 0125 after #169 took 0124 — re-applying is safe, the migrate script tolerates \"already exists\".",
        },
      ],
    },
  },
  "0026-agent-ops-transparency": {
    slug: "0026-agent-ops-transparency",
    problem:
      "This Worker runs 27 things that can start work on their own — 9 Workflows, 10 Durable Object agents, 7 cron jobs and MCP — and none of them could be watched. The agent_runs ledger already existed on main with exactly ONE writer and ZERO readers. The cost of that silence is documented: 49 of 145 showroom scrapes sat in `failed` with no reason; RemodelOrchestrator burned roughly $50/day for weeks and was found on a billing invoice; Workers AI 3040 capacity errors land in image_upload_staging.processing_error and are read by nothing. Every failure was discovered by its bill or by a user, days late.",
    approach:
      "A wire-up, not a new monitoring system. P0 closed the writer gap by WRAPPING call sites rather than rewriting them — `startRun` is best-effort by contract and returns a no-op recorder instead of throwing, so instrumentation can never break the work it measures. A `ledgerSteps(step, run)` bridge made instrumenting a Workflow a 3-line change instead of hand-wrapping ~60 `step.do` calls. P1 added one additive nullable column (gemini_usage_log.agent_run_id) plus a read-only query service and a Hono router under the existing /api/admin/* auth gate. Spend attribution uses AsyncLocalStorage rather than a module-level variable, because the image batch coordinator interleaves runs with Promise.all in one isolate and a shared mutable would have misattributed a whole batch's cost to one arbitrary image. P2-P5 retrofitted four shadcn templates onto real columns, cutting every invented field (owner avatars, environment badges, fictional model providers, an editable settings form with nowhere to persist) and adding three things the templates lacked: retry lineage, a runaway detector, and an uninstrumented-surface banner so an empty queue can never read as a healthy one.",
    apiChanges: [
      "GET  /api/admin/agents/overview — counts, cycle spend, breaker state, runaway flags, coverage",
      "GET  /api/admin/agents/runs — status/agent/since/limit, with steps_done + steps_total",
      "GET  /api/admin/agents/runs/:id — run + steps + tool calls + retry lineage + attributed cost",
      "POST /api/admin/agents/runs/:id/retry — inserts a NEW run with parent_run_id; never mutates the failed row",
      "POST /api/admin/agents/runs/:id/cancel — refused (409) for an already-settled run",
      "POST /api/admin/agents/runs/:id/approve — needs_approval → running (HITL)",
      "GET  /api/admin/agents/failures — grouped by (error_code, agent, operation)",
      "GET  /api/admin/agents/usage — spend by agent/provider/model + AI Gateway reconciliation",
      "GET  /api/admin/agents/coverage — which of the 27 declared surfaces are wired",
    ],
    filesTouched: [
      "src/backend/services/agent-registry.ts (new — 27 surfaces)",
      "src/backend/services/agent-run-workflow.ts (new — ledgerSteps bridge)",
      "src/backend/services/agent-run-context.ts (new — AsyncLocalStorage run context)",
      "src/backend/services/agent-runs-query.ts (new — read-only queries)",
      "src/backend/services/agent-run-retention.ts (new — 30d/90d prune)",
      "src/backend/api/routes/admin-agents.ts (new — 9 endpoints)",
      "src/frontend/components/system/agents/{shared,AgentQueueApp,AgentRunDetailApp,AgentFailuresApp,AgentUsageApp}.tsx (new)",
      "src/frontend/pages/admin/system/agents/{queue,failed,usage}.astro + queue/[id].astro (new)",
      "src/frontend/components/ui/{table,progress,collapsible,skeleton}.tsx (shadcn CLI)",
      "instrumented: brand-research, product-research, deep-research-job, image-processor/workflow, image-processor/batch-workflow, checklist-rationale, showroom-onboarding, render/blank-canvas-batch, RemodelOrchestrator, ShowroomResearchAgent",
      "src/backend/db/schema/system/gemini-usage.ts, src/backend/services/usage/metering.ts, src/backend/services/agent-runs.ts, src/_worker.ts, src/frontend/components/sidebar/nav-groups.ts",
      "scripts/qc/pr_193.mjs (new)",
    ],
    migrations: [
      {
        tag: "0123_stormy_sersi",
        sql: "ALTER TABLE `gemini_usage_log` ADD `agent_run_id` integer;--> statement-breakpoint\nCREATE INDEX `gemini_usage_log_agent_run_idx` ON `gemini_usage_log` (`agent_run_id`);",
      },
    ],
    code: [
      {
        title: "The instrumentation contract — wrap, never rewrite",
        lang: "ts",
        code: `const run = await startRun(env, {
  agent: "brand-research",
  operation: "research_brand",
  targetType: "brand",
  targetId: String(brandId),
  triggeredBy: "cron",
});
// Every step.do below now also writes an agent_run_steps row.
const step = ledgerSteps(rawStep, run);

// Do NOT wrap startRun in try/catch. It never throws — on a ledger failure it
// returns a no-op recorder and the real work proceeds unrecorded. Losing real
// work to a telemetry bug is unacceptable; that asymmetry is deliberate.`,
      },
      {
        title: "Why AsyncLocalStorage, not a module-level run id",
        lang: "ts",
        code: `// image-processor/batch-workflow.ts runs a wave of images under Promise.all —
// several runs interleaved in ONE isolate. A shared mutable \`currentRunId\`
// would hand every AI call the id of whichever image started last, and the cost
// page would confidently attribute the whole batch to one arbitrary image.
//
// A wrong number on a cost page is worse than no number, because nobody
// double-checks a number that looks plausible.
export function currentAgentRunId(): number | null {
  return storage.getStore()?.runId ?? null;
}`,
      },
    ],
    diagrams: [
      {
        caption: "Data model — the existing ledger plus one additive column",
        code: `erDiagram
    agent_runs ||--o{ agent_run_steps : "run_id cascade"
    agent_runs ||--o{ agent_run_tool_calls : "run_id cascade"
    agent_runs ||--o{ agent_runs : "parent_run_id retry chain"
    agent_runs ||--o{ gemini_usage_log : "agent_run_id NEW"

    agent_runs {
        integer id PK
        text    agent "showroom-research, remodel-orchestrator"
        text    operation
        text    status "queued running needs_approval succeeded failed cancelled"
        integer attempt
        integer parent_run_id
        text    error_code "groupable: MAPS_QUOTA_EXCEEDED 3040 503"
        text    error_message
        integer duration_ms
    }
    gemini_usage_log {
        integer id PK
        integer agent_run_id "NEW nullable, not a FK"
        text    provider
        integer total_tokens
        real    estimated_cost_usd
    }`,
      },
      {
        caption: "An instrumented run, end to end",
        code: `sequenceDiagram
    autonumber
    participant CR as Cron / User / MCP
    participant WF as Workflow or DO Agent
    participant RR as startRun recorder
    participant D1 as D1 agent_runs
    participant AI as Workers AI / Gemini
    participant UI as /admin/system/agents

    CR->>WF: trigger
    WF->>RR: startRun(...)
    RR->>D1: INSERT agent_runs status=running
    Note over RR: insert fails then nullRecorder,<br/>real work proceeds unrecorded
    WF->>RR: run.step("scrape site")
    RR->>AI: env.AI.run(...)
    AI-->>RR: result + usage
    RR->>D1: INSERT agent_run_tool_calls + gemini_usage_log(agent_run_id)
    WF->>RR: run.succeed(digest) or run.fail(err)
    UI->>D1: GET /api/admin/agents/runs (poll 10s)`,
      },
    ],
    branch: "claude/agent-ops-monitoring-plan-957a42",
    prNumber: 193,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/193",
    verification: {
      qcScript: "scripts/qc/pr_193.mjs",
      command: "pnpm run test:pr 193",
      source:
        "49 assertions across reads, input validation, the auth gate, the retry/cancel/approve state machine, all four pages and a regression guard on plans / mcp-ops / integrations.",
      ranAt: "2026-07-22T14:40:00Z",
      output:
        "49 passed, 0 failed — against production (https://core-remodel.hacolby.workers.dev). Full transcript on the D1-backed entry, which is the source of truth; this bundled copy is the SSR fallback and carries an abridged diagram set.",
      migrations: [
        {
          tag: "0123_stormy_sersi",
          appliedRemote: true,
          note: "Applied with pnpm run migrate:remote and verified on the remote DB — pragma_table_info returned [{'name': 'agent_run_id'}].",
        },
      ],
    },
  },
  "markdown-mermaid-render": {
    slug: "markdown-mermaid-render",
    branch: "claude/markdown-mermaid",
    prNumber: 187,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/187",
    problem:
      "AGENTS.md now mandates that planning artifacts be dense with Mermaid diagrams, and the preview-changelog PRD is authored with ```mermaid fences. But the renderer behind it — MarkdownProse (react-markdown) — mapped fenced code blocks to a plain styled <pre><code>, so every diagram showed as its raw source text. The changelog DETAIL page already rendered diagrams (via MermaidCn), but the proposal/preview PRD did not.",
    approach:
      "Override MarkdownProse's `pre` renderer: when the fenced block's <code> carries class `language-mermaid`, flatten its text and render <MermaidCn code={…} /> — the same client renderer the changelog detail page uses — instead of the code block. Non-mermaid fences render unchanged. Both mermaid components dynamic-import `mermaid`, so importing MermaidCn stays SSR-safe; the SVG paints on the client wherever MarkdownProse is hydrated (the preview mounts ProposalBundle with client:load). One change fixes every MarkdownProse surface (research, brands, products, changelog, mcp-ops).",
    apiChanges: [],
    filesTouched: ["src/frontend/components/research/MarkdownProse.tsx"],
    migrations: [],
    code: [],
    diagrams: [
      {
        caption: "Where a fenced mermaid block gets turned into a diagram",
        code: "flowchart LR\n    MD[\"prdMarkdown / any markdown\"] --> RM[\"ReactMarkdown\"]\n    RM --> PRE{\"pre block:\\nlanguage-mermaid?\"}\n    PRE -->|no| CODE[\"styled pre/code block\"]\n    PRE -->|yes| MC[\"MermaidCn -> import('mermaid') -> SVG\"]",
      },
    ],
    verification: {
      qcScript: "(none — client-only render change)",
      command: "open /admin/changelog/preview/tesla-telemetry-webhooks",
      output:
        "tsc --noEmit clean on the touched file (4 pre-existing repo-wide env/config errors only). Visual: the diagram-dense 0023 preview changelog renders diagrams instead of raw ```mermaid code. Pure client-render change; no API/QC-script surface.",
    },
  },
  "maps-per-api-quota-hardblock": {
    slug: "maps-per-api-quota-hardblock",
    branch: "claude/tesla-google-quota",
    prNumber: 185,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/185",
    problem:
      "Google Maps billing was guarded as one combined total, not per API. Two divergent guards disagreed: isUnderMonthlyQuota() (limit 10,000, seconds-correct) and canUseGoogleMaps() (limit 8,000, but computing the month window with .getTime() MILLISECONDS against a Unix-SECONDS column — a ~1000× boundary error). Worse, several billed calls bypassed the counter entirely: the Places-Photo media fetches in showroom onboarding + the ShowroomResearchAgent backfill fetched a Places SKU with no quota check and no usage log, so they spent real money invisibly. There was also no reverse-geocode or nearby-search method for the location tools.",
    approach:
      "Bucket the already-logged google_maps_usage_log rows into billed SKUs (places / geocoding / routes) via skuForUsageBucket(), sum them with getUsageBySku(), and gate each call with isUnderApiQuota(sku) — an exhausted SKU blocks ONLY itself, and the caps are conservative proxies for the shared $200 free tier so the sum stays under it. canUseGoogleMaps() now delegates to the SARGABLE seconds-correct count (killing the ms bug and the divergent cap). New reverseGeocode + placesNearby methods are gated on their SKU, logged, and fail soft (null/[]) so the location tools degrade instead of throwing. The photo-fetch bypasses now gate + log. The admin usage endpoint + tab surface per-SKU counts and caps.",
    apiChanges: [
      "GET /api/admin/integrations/usage — response gains by_sku { places, geocoding, routes } + quotas (the per-API caps).",
      "GoogleMapsService.isUnderApiQuota(sku) / getUsageBySku() — NEW per-API guard + rollup.",
      "GoogleMapsService.reverseGeocode(lat,lng) / placesNearby(lat,lng,radiusM) — NEW, gated + logged, fail-soft.",
      "canUseGoogleMaps() — reimplemented to delegate to isUnderMonthlyQuota() (bug fix; same signature).",
    ],
    filesTouched: [
      "src/backend/services/google/maps.ts",
      "src/backend/api/routes/admin-integrations.ts",
      "src/frontend/components/admin/usage/MapsUsageSection.tsx",
      "src/backend/services/showroom/onboarding.ts",
      "src/backend/ai/agents/ShowroomResearchAgent/methods/backfill.ts",
      "src/backend/api/routes/shopping-journal.ts",
    ],
    migrations: [],
    code: [],
    diagrams: [],
    verification: {
      qcScript: "scripts/qc/pr_185.mjs",
      command: "pnpm run test:pr 185 -- --preview",
      output:
        "Not yet executed — the authoring sandbox has no toolchain (no node_modules) and the proxy blocks direct HTTP to the worker. Run in a toolchain env against the preview, then production after deploy. tsc --noEmit is clean on all touched files (4 pre-existing repo-wide env/config errors only).",
    },
  },
  "do-alarm-circuit-breaker": {
    slug: "do-alarm-circuit-breaker",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    prNumber: 181,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/181",
    problem:
      "RemodelOrchestrator used the @cloudflare/agents SDK this.schedule(), which is append-only — every call inserts a row into the SDK's internal cf_agents_schedules table. Re-armed unconditionally from onStart() (fires on every DO wake) and audit()'s finally, pending schedules compounded to ~1M rows; every alarm then full-scanned the table, billing 537 BILLION Durable Object row reads in 30 days (~$512+). #162 fixed that code path, but nothing in the running system would catch a recurrence — on that DO or any future alarm DO — until the next invoice.",
    approach:
      "A reusable runtime circuit breaker checked on every alarm fire, before any work: a D1-backed global kill-switch (project_system_variables.do_circuit_breaker_tripped), a schedule-table-bound check (the exact #162 signature), and a fire-rate window. On any runaway signal it TRIPS — deletes the alarm, flips the kill-switch, and hard-stops with no reschedule (deliberate downtime over billing). All checks are cheap (single-row read, SARGABLE count, O(1) compare) so the guard never becomes the cost. New alarm DOs are required to use native ctx.storage.setAlarm() (one self-replacing slot — cannot grow a table); a CI guard bans this.schedule() in DOs.",
    apiChanges: [
      "GET /api/admin/integrations/circuit-breaker — NEW. Current kill-switch state (tripped, reason, doName, at).",
      "POST /api/admin/integrations/circuit-breaker/clear — NEW. Admin clears the breaker.",
      "services/safety/do-circuit-breaker.ts — NEW reusable module (readCircuitBreaker / tripCircuitBreaker / clearCircuitBreaker / evaluateFireWindow / scheduleTableExceeded).",
    ],
    filesTouched: [
      "src/backend/services/safety/do-circuit-breaker.ts",
      "src/backend/ai/agents/RemodelOrchestrator/index.ts",
      "src/backend/api/routes/admin-integrations.ts",
      "src/frontend/components/admin/usage/CircuitBreakerSection.tsx",
      "src/frontend/components/admin/AdminIntegrationsUsageApp.tsx",
      "scripts/check-do-alarms.mjs",
      "package.json",
    ],
    migrations: [],
    code: [],
    diagrams: [],
    verification: {
      qcScript: "scripts/qc/pr_181.mjs",
      command: "pnpm run test:pr 181 -- --preview",
      output:
        "Local checks passed: node scripts/check-do-alarms.mjs → OK (RemodelOrchestrator allowlisted, comment-mentions ignored); fire-window trip logic verified (6 fires in-window ok → 7th trips → resets after window). tsc --noEmit clean on touched files. HTTP QC pending a toolchain env (no node_modules / proxy blocks the worker here).",
    },
  },
  "public-health-page": {
    slug: "public-health-page",
    branch: "claude/health-status-page",
    prNumber: 182,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/182",
    problem:
      "https://core-remodel.hacolby.workers.dev/health returned 404, and the only health surface (GET /api/health) merely pinged D1 and re-read the health_checks table — it never exercised the other bindings, and there was no human-facing page to run a check on demand.",
    approach:
      "A runHealthScreen(env) service that probes each core binding with a real, bounded, free op — D1 + the Tesla telemetry DB (SELECT 1), KV (put/get a short-TTL probe), R2 (head a sentinel), Workers AI (binding presence only; running a model costs) — times each, writes one health_checks row per service via db.batch (D1 has no transactions), and rolls up overall. No probe throws out (a failure is a down result); a persistence failure is logged, not fatal. A public POST /api/health/run triggers it, and a public /health page + island shows per-service cards + latency with an overall roll-up.",
    apiChanges: [
      "POST /api/health/run — NEW. On-demand health screen; 200 even when a service is down (read status from the body).",
      "services/health/screen.ts runHealthScreen(env) — NEW.",
    ],
    filesTouched: [
      "src/backend/services/health/screen.ts",
      "src/backend/api/routes/health.ts",
      "src/frontend/pages/health.astro",
      "src/frontend/components/health/HealthCheckApp.tsx",
    ],
    migrations: [],
    code: [],
    diagrams: [],
    verification: {
      qcScript: "scripts/qc/pr_182.mjs",
      command: "pnpm run test:pr 182 -- --preview",
      output:
        "Not yet executed in a toolchain env (no node_modules / proxy blocks the worker in the authoring sandbox). tsc --noEmit clean on touched files. QC asserts GET /api/health regression, POST /run shape + service coverage, history, and /health HTML.",
    },
  },
  "drive-lists-single-active": {
    slug: "drive-lists-single-active",
    branch: "claude/drive-lists-activation-ui-6f6e47",
    prNumber: 178,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/178",
    problem:
      "\"The active drive\" is a single slot: it is what an admin device auto-lands on (src/_worker.ts → getActiveDriveLandingPath). But it was stored as one value of the drive_lists.status enum — the same column carrying the lifecycle label, and the column's DEFAULT. Nothing in D1 stopped two rows from holding it, and the app-side guard only ran on two paths (create, and un-archiving via a stop check-off), so six drives were active on production at once. The landing page then bucketed its Active/Archived tabs on that same overloaded field, so a drive that had never been touched, one half-driven, and one demoted by an activation all landed in the same tab — while the auto-archive on read quietly rewrote status behind the user's back.",
    approach:
      "Split the pointer from the label. `is_active` is its own boolean column under a PARTIAL unique index (`WHERE is_active = 1`), so a second active row is a database error rather than a bug that shows up six drives later. Writes go through one service function, setActiveDrive(db, id | null), which clears and sets inside a single db.batch() — D1 never observes two active rows, and D1 has no transactions to fall back on. `status` stays as a plain lifecycle label that nothing infers from anymore: the read path and the check-off no longer rewrite it, and the tabs bucket on stops visited (0 → Pending, some → In progress, all → Finished), which is what the user actually asked the page to show.",
    apiChanges: [
      "POST /api/tesla/poll — NEW. Forces one vehicle poll (admin); self-gates on an active drive and the 120s throttle.",
      "GET /api/config/tesla — NEW. Masked credentials + the telemetry-recording flag. Secret values are never returned.",
      "PATCH /api/config/tesla { telemetryRecording } — NEW. The recording consent switch.",
      "POST /api/config/tesla/health — NEW. Integration screening: credentials, a live Tessie position, and whether historical events still carry the fields the automation reads. `?live=0` skips the vehicle call.",
      "POST /api/tesla/telemetry — records only when configured AND recording is on; otherwise returns { recorded: false, reason }.",
      "MCP: new `tesla` domain — get_tesla_status, get_vehicle_location, list_tesla_events, send_vehicle_navigation (the only write).",
      "GET /api/drive-lists/home-location — NEW. The project's coordinates as the home-arrival rule sees them, plus the radius and cutoff. Geocoded once from the configured permit address, cached in project_system_variables.",
      "POST /api/showroom-stores/device-location — response gains `homeArrival` (the rule's verdict for this fix).",
      "PATCH /api/drive-lists/:slug — NEW. Body { isActive: boolean }. true makes this THE active drive (clearing the previous one in the same batch); false leaves none active. 400 without the flag, 404 on an unknown slug.",
      "GET /api/drive-lists — now returns `isActive` per drive, and no longer auto-archives fully-visited drives (progress buckets the tabs, so nothing needs the status rewrite).",
      "PATCH /api/drive-lists/:slug/stops/:stopId — no longer rewrites the drive's status or touches the active slot; returns { ok, visited, stopCount, visitedCount }.",
      "MCP list_drive_lists — output gains `isActive`.",
    ],
    filesTouched: [
      "src/backend/db/schema/drives/drive_lists.ts",
      "src/backend/services/drive-home-arrival.ts",
      "src/backend/services/tesla-integration.ts",
      "src/backend/services/tesla-poller.ts",
      "src/_worker.ts",
      "src/backend/mcp/tools/tesla/*.ts",
      "src/frontend/components/config/TeslaIntegrationApp.tsx",
      "src/frontend/pages/admin/config/integrations/tesla.astro",
      "src/backend/services/drive-home-arrival-rules.ts",
      "src/backend/api/routes/tesla.ts",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/services/google/maps.ts",
      "scripts/tests/test_home_arrival.mjs",
      "src/backend/services/drive-lists.ts",
      "src/backend/api/routes/drive-lists.ts",
      "src/backend/mcp/tools/drives/list_drive_lists.ts",
      "src/frontend/components/drives/DriveListsApp.tsx",
      "scripts/config.mjs",
      "scripts/qc/pr_178.mjs",
      "drizzle/0119_yellow_micromax.sql",
    ],
    migrations: [
      {
        tag: "0119_yellow_micromax",
        sql: `ALTER TABLE \`drive_lists\` ADD \`is_active\` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX \`drive_lists_single_active_uniq\` ON \`drive_lists\` (\`is_active\`) WHERE "drive_lists"."is_active" = 1;`,
      },
    ],
    code: [
      {
        title: "The invariant, enforced by the database",
        lang: "ts",
        code: `singleActive: uniqueIndex("drive_lists_single_active_uniq")
  .on(table.isActive)
  .where(sql\`\${table.isActive} = 1\`),`,
      },
      {
        title: "One write path — clear + set in a single D1 batch",
        lang: "ts",
        code: `export async function setActiveDrive(db: RemodelDb, id: number | null): Promise<void> {
  const clear = db
    .update(driveLists)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(driveLists.isActive, true), id == null ? undefined : ne(driveLists.id, id)));
  if (id == null) {
    await db.batch([clear]);
    return;
  }
  const set = db
    .update(driveLists)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(driveLists.id, id));
  await db.batch([clear, set]);
}`,
      },
      {
        title: "Tessie does not push — so poll, but only while a drive is running",
        lang: "ts",
        code: `// Gate 1: is a drive even running? This is the cheap one, so it goes first.
const activeSlug = await getActiveDriveSlug(db);
if (!activeSlug) return { polled: false, reason: "no-active-drive" };
if (!(await tessieConfigured(env))) return { polled: false, reason: "unconfigured" };

// Gate 2: throttle. KV TTL is the clock — a present key means "polled
// recently", so no timestamp arithmetic and no clock skew to reason about.
if (await env.CACHE.get(THROTTLE_KEY)) return { polled: false, reason: "throttled" };
await env.CACHE.put(THROTTLE_KEY, "1", { expirationTtl: POLL_INTERVAL_SECONDS });

const state = await getVehicleState(env);   // GET /{vin}/state?use_cache=true`,
      },
      {
        title: "Getting home ends the drive — every gate, cheapest first",
        lang: "ts",
        code: `export function homeArrivalReason(facts: {
  hasActiveDrive: boolean;
  stopped: boolean;
  at: Date;
  distanceM: number | null;
}): HomeArrivalReason {
  if (!facts.hasActiveDrive) return "no-active-drive";
  if (!facts.stopped) return "not-stopped";          // driving PAST the house
  if (localMinutesInLA(facts.at) < HOME_ARRIVAL_AFTER_MINUTES) return "before-cutoff";
  if (facts.distanceM == null) return "home-unconfigured";  // never guess
  return facts.distanceM <= HOME_RADIUS_M ? "ended" : "not-home";
}`,
      },
      {
        title: "Tabs bucket on progress, never on status",
        lang: "tsx",
        code: `function bucketOf(d: DriveListSummary): Bucket {
  if (d.stopCount > 0 && d.visitedCount >= d.stopCount) return "finished";
  return d.visitedCount > 0 ? "partial" : "pending";
}`,
      },
    ],
    diagrams: [
      {
        caption: "Ending the drive when the driver gets home",
        code: `flowchart TD
    A[Tesla park webhook] --> C{Active drive?}
    B[Phone / browser location fix] --> C
    C -- no --> X[no-active-drive]
    C -- yes --> D{Stopped fix?<br/>park event, P gear, or a phone fix}
    D -- no --> Y[not-stopped — driving past the house]
    D -- yes --> E{Local time >= 15:30<br/>America/Los_Angeles, any day}
    E -- no --> Z[before-cutoff — this is a lunch break]
    E -- yes --> F{Home coords known?<br/>geocoded from the permit address}
    F -- no --> W[home-unconfigured — never guess]
    F -- yes --> G{Within 150m of the house?}
    G -- no --> V[not-home]
    G -- yes --> H[setActiveDrive null — drive over]`,
      },
      {
        caption: "Activating a drive — the previous holder is cleared in the same batch",
        code: `sequenceDiagram
    participant UI as Drives page (toggle)
    participant API as PATCH /api/drive-lists/:slug
    participant SVC as setActiveDrive()
    participant D1 as D1 (drive_lists)
    UI->>API: { isActive: true }
    API->>SVC: setActiveDrive(db, id)
    SVC->>D1: batch[ clear is_active where id <> keep, set is_active on keep ]
    D1-->>SVC: one row active (partial UNIQUE index holds)
    SVC-->>API: ok
    API-->>UI: { ok: true, isActive: true }`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_178.mjs + scripts/tests/test_home_arrival.mjs",
      command: "pnpm run test:pr 178 -- --preview  &&  pnpm run test:home-arrival",
      ranAt: "2026-07-21",
      source: `const on = await client.patch(\`/api/drive-lists/\${newest.slug}\`, { isActive: true });
checks.ok(\`PATCH \${newest.slug} {isActive:true} → 200\`, on.status === 200, \`got \${on.status}\`);

if (other) {
  const swap = await client.patch(\`/api/drive-lists/\${other.slug}\`, { isActive: true });
  after = await listDrives();
  checks.ok(
    "activating a second drive left exactly one active (no unique-index 500)",
    activeOnes(after.drives).length === 1 && activeOnes(after.drives)[0].id === other.id,
    activeOnes(after.drives).map((d) => d.slug).join(", "),
  );
}`,
      output: `PR #178 QC → https://wcrp-claude-drive-lists-activation-ui-6f6e47.hacolby.workers.dev

  ✓ target reachable (https://wcrp-claude-drive-lists-activation-ui-6f6e47.hacolby.workers.dev)
  ✓ drive-lists rejects an unauthenticated read (401)
  ✓ GET /api/drive-lists → 200
  ✓ at least one drive exists to test with
  ✓ every row exposes isActive (migration 0119 applied to remote)
  ✓ at most ONE drive is active (was 6 before this PR) — now 1
    tabs → pending=14 partial=0 finished=0
  ✓ every drive falls in exactly one progress bucket
  ✓ PATCH concord-corridor-sat-jul-18-sf-1pm {isActive:true} → 200
  ✓ the newest drive is now THE active one
  ✓ PATCH saturday-east-bay-slabs-showroom-sweep-jul-18 {isActive:true} → 200
  ✓ activating a second drive left exactly one active (no unique-index 500)
  ✓ PATCH saturday-east-bay-slabs-showroom-sweep-jul-18 {isActive:false} → 200
  ✓ no drive is active after toggling off
  ✓ PATCH without \`isActive\` → 400
  ✓ PATCH on an unknown slug → 404
  ✓ GET /api/drive-lists/:slug → 200
  ✓ stop check-off still 200
  ✓ check-off returns live progress counts
  ✓ stop restored to its original state
  ✓ checking a stop off never activates a drive
  ✓ GET /api/drive-lists/home-location → 200
  ✓ the project address geocoded to real coordinates (cached in project_system_variables)
      home: 37.728496799999995, -122.41406099999999 (±150m after 930 local minutes)
  ✓ the coordinates are in the Bay Area, not a null-island fallback
  ✓ POST device-location → 200
  ✓ the fix is evaluated against the home-arrival rule
      reason: before-cutoff
  ✓ a fix 120km from the house never ends the drive
  ✓ the active drive survived a far-away fix
  ✓ final state — concord-corridor-sat-jul-18-sf-1pm is the active drive
  ✓ exactly one active drive at rest
  ✓ GET /api/config/tesla → 200
  ✓ all three credentials are described
  ✓ credential VALUES never leave the Worker — masks are dots only
  ✓ the mask still reports a length, so a truncated secret is visible
      configured=true telemetryRecording=true
  ✓ PATCH /api/config/tesla {telemetryRecording:false} → 200
  ✓ recording reads back as off
  ✓ the off state persisted
  ✓ recording restored to on
  ✓ PATCH without \`telemetryRecording\` → 400
  ✓ POST /api/config/tesla/health → 200
  ✓ every probe reports a verdict
      [ok] Credentials present in the Secrets Store — TESSIE_API_TOKEN, TESLA_BETSY_VIN and WORKER_API_KEY are all set.
      [ok] Live position read from Tessie — Vehicle reported 37.5715, -122.3148.
      [ok] Recorded vehicle events carry coordinates — 1 of 1 events have a position. Coordinates are what the auto-visit and home-arrival rules read.
      [warn] Historical telemetry carries position + shift state — Recording is enabled but no frames have arrived. Tessie does not PUSH telemetry — it exposes a WebSocket (streaming.tessie.com/{VIN}) that a client must dial — so nothing will arrive until something pipes that stream into POST /api/tesla/telemetry.
      [ok] Events are still arriving — Last event 0 day(s) ago (2026-07-21T17:23:47.000Z).
      [ok] Position updates reach the Worker — Polled from Tessie's cached state every 120s while a drive is active (cached reads never wake the car). Tessie has no webhook product, so nothing is pushed to us.
  ✓ the screening reads the historical event tables
  ✓ GET /api/mcp-docs → 200
  ✓ the tesla tool domain is registered (status, location, events, navigate)
  ✓ every tesla tool documents an example (registry contract)
  ✓ only the navigation tool is a write — the rest are read-only
  ✓ POST /api/tesla/poll → 200
      polled=false reason=throttled shift=- home=-
  ✓ the poll ran, or said exactly why it didn't
  ✓ a second immediate poll is throttled (or there is no active drive)
  ✓ GET /api/tesla/status → 200
      tessie configured: true

49 passed, 0 failed

$ pnpm run test:home-arrival

(node:49682) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Volumes/Projects/workers/core-remodel/.claude/worktrees/showroom-scout-agent-be625a/src/backend/services/drive-home-arrival-rules.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Volumes/Projects/workers/core-remodel/.claude/worktrees/showroom-scout-agent-be625a/package.json.
(Use \`node --trace-warnings ...\` to show where the warning was created)

distanceMeters

  ✓ zero distance to itself
  ✓ ~111m per 0.001° of latitude
  ✓ a next-door fix is inside the home radius
  ✓ a showroom across town is not

localMinutesInLA (must be a real timezone conversion, not an offset)

  ✓ 16:00 PDT (summer, UTC-7) reads as 960
  ✓ 16:00 PST (winter, UTC-8) also reads as 960
  ✓ midnight local is 0, not 1440

homeArrivalReason

  ✓ parked at home after the cutoff ends the drive
  ✓ no active drive short-circuits first
  ✓ driving PAST the house does not end it
  ✓ home at lunchtime does not end it
  ✓ parked somewhere else does not end it
  ✓ exactly on the radius still counts as home
  ✓ one metre past the radius does not
  ✓ an unknown home position never reads as 'home'
  ✓ the cutoff minute itself qualifies (15:30 exactly)
  ✓ one minute before the cutoff does not
  ✓ the rule applies seven days a week (Sunday)

18 passed`,
      migrations: [
        {
          tag: "0119_yellow_micromax",
          appliedRemote: true,
          note: "Applied 2026-07-21 via pnpm run migrate:remote. Verified on the remote DB: is_active present on all 14 rows; the newest drive (id 14, concord-corridor-sat-jul-18-sf-1pm) holds the slot after the QC run, every other row 0.",
        },
      ],
    },
  },
  "showroom-soft-delete": {
    slug: "showroom-soft-delete",
    problem:
      "DELETE /api/showroom-stores/:id destroyed the row. A showroom is the parent of notes, photos, ratings, price observations, brand/product mappings and drive stops, and on D1 that delete cascades — so removing a store you no longer care about also erased every visit you ever logged there, irreversibly. There was no way to take a showroom out of the directory without losing its history.",
    approach:
      "Add `is_active` (default true) and make DELETE a flag flip, with POST /:id/restore to undo it. The column is the easy half — a flag nothing reads changes nothing, so the substance of this change is an audit of every query that lists or searches showrooms. 34 of them now filter `is_active = 1`, across routes, MCP tools, both research agents and the cron sweeps. Three classes deliberately do NOT filter, because filtering them would itself be a bug: fetch-by-explicit-id (or a deleted store could never be inspected or restored), the placeId dedupe checks (an inactive row still holds the unique index, so skipping it turns a clean 409 into a raw UNIQUE-constraint failure), and joins that read a showroom only for a coordinate or label on a child row (drive stops, historical prices — the child is the entity). Two joins needed more than a WHERE: the catalog filters in its ON clause, because a WHERE on an outer join would have dropped every unmapped product from the catalog entirely; and the phonebook keeps contacts with a null storeId, since a leftJoin yields NULL and NULL never equals true.",
    apiChanges: [
      "DELETE /api/showroom-stores/:id — now a SOFT delete (is_active = 0); returns { success, id, isActive: false }",
      "POST /api/showroom-stores/:id/restore — NEW; flips is_active back to 1",
      "GET /api/showroom-stores — now excludes inactive stores (the filter also applies under search/price/city/hub filters)",
      "GET /api/showroom-stores/:id — unchanged; still resolves an inactive store so it can be inspected and restored",
      "GET /api/showroom-stores/meta/place-exists — unchanged BY DESIGN; still sees inactive rows, because they still hold the unique placeId index",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/stores.ts",
      "drizzle/0113_dapper_white_queen.sql",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/api/routes/showroom-catalog.ts",
      "src/backend/api/routes/showroom-products.ts",
      "src/backend/api/routes/showroom-sales.ts",
      "src/backend/api/routes/showroom-backfill.ts",
      "src/backend/api/routes/showroom-contacts.ts",
      "src/backend/api/routes/brands.ts",
      "src/backend/api/routes/mcp.ts",
      "src/backend/mcp/tools/showrooms/list_showrooms.ts",
      "src/backend/mcp/tools/showrooms/backfill_showroom_geo.ts",
      "src/backend/mcp/tools/drives/analyze_drive_coverage.ts",
      "src/backend/mcp/tools/products/get_product.ts",
      "src/backend/mcp/tools/brands/get_brand.ts",
      "src/backend/ai/agents/ResearchAgent/methods/chat-tools.ts",
      "src/backend/ai/agents/ShowroomResearchAgent/methods/prompt-context.ts",
      "src/backend/services/product-research-workflow.ts",
      "src/backend/services/showroom-sourcing-monitor.ts",
      "src/backend/services/showroom/sales.ts",
      "src/backend/services/showroom/places-backfill.ts",
      "src/backend/services/deep-research-job-workflow.ts",
      "src/backend/services/email/showroom-contact-autopopulate.ts",
      "src/frontend/components/showroom/EditStoreModal.tsx",
      "src/frontend/components/showroom/StoreViewportApp.tsx",
    ],
    migrations: [
      {
        tag: "0113_dapper_white_queen",
        sql: "ALTER TABLE `showroom_stores` ADD `is_active` integer DEFAULT true NOT NULL;",
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_154.mjs",
      command: "pnpm run test:pr 154",
      output: `PR #154 QC → https://core-remodel.hacolby.workers.dev

  ✓ target reachable (https://core-remodel.hacolby.workers.dev)
  ✓ GET /api/showroom-stores → 200 (migration 0113 applied)
  ✓ directory returned real rows to assert against
  ✓ POST /:id/restore exists (this PR is deployed — safe to exercise DELETE)
  ✓ restore reports isActive: true

  … soft-deleting "Excel Plumbing Supply Showroom" (id 141) — will be restored

  ✓ DELETE /api/showroom-stores/141 → 200
  ✓ delete reports isActive: false (soft, not hard)
  ✓ the row survives: GET /:id still returns it (soft delete, nothing erased)
  ✓ …and it reports isActive: false
  ✓ directory no longer lists it
  ✓ directory count dropped by exactly one
  ✓ a FILTERED directory query hides it too (predicate survives and(...))
    (MCP list_showrooms probe returned 404 — skipped)
  ✓ sales/clearance feed hides its rows
  ✓ placeId dedupe STILL sees it (else a re-add hits a UNIQUE constraint)
  ✓ restored "Excel Plumbing Supply Showroom" (id 141)
  ✓ directory count is back to where it started

16 passed, 0 failed`,
      migrations: [{ tag: "0113_dapper_white_queen", appliedRemote: true }],
    },
    code: [
      {
        title: "Soft delete, and its undo",
        lang: "ts",
        code: `showroomStoresRouter.delete("/:id", async (c) => {
  // NOT db.delete(): the row parents notes, photos, ratings, price
  // observations and drive stops, and on D1 that cascade is irreversible.
  await db.update(showroomStores)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(showroomStores.id, storeId));
  return c.json({ success: true, id: storeId, isActive: false });
});`,
      },
      {
        title: "The catalog filters in the ON clause, not the WHERE",
        lang: "ts",
        code: `// A WHERE here would drop every UNMAPPED product from the catalog:
// the outer join yields NULL for them, and NULL never equals true.
.leftJoin(
  showroomStores,
  and(
    eq(showroomProductMappings.showroomId, showroomStores.id),
    eq(showroomStores.isActive, true),
  ),
)`,
      },
      {
        title: "The phonebook keeps contacts that belong to no store",
        lang: "ts",
        code: `conds.push(
  or(
    isNull(showroomStoreContacts.storeId),   // unattached contact — keep
    eq(showroomStores.isActive, true),       // attached — only if live
  ),
);`,
      },
    ],
    diagrams: [
      {
        caption: "What a soft delete does and does not reach",
        code: `flowchart LR
  Del["DELETE /:id — is_active = 0"] --> Hidden
  Del --> Kept
  Del --> Unaffected
  subgraph Hidden["Hidden (34 queries filter)"]
    D1["Directory + map"]
    D2["Catalog / product / brand"]
    D3["Clearance feed + cron"]
    D4["Field scan + backfills"]
    D5["MCP tools + agents"]
  end
  subgraph Kept["Kept on disk"]
    K1["Notes, photos, ratings"]
    K2["Price observations"]
    K3["Brand / product mappings"]
  end
  subgraph Unaffected["Still resolves by design"]
    U1["GET /:id (inspect + restore)"]
    U2["placeId dedupe (holds the unique index)"]
    U3["Drive stops (child is the entity)"]
  end
  Kept --> R["POST /:id/restore — is_active = 1"]`,
      },
    ],
  },
  "showroom-touch-ux": {
    slug: "showroom-touch-ux",
    problem:
      "The showroom viewport is used from a Tesla touchscreen, standing next to the car outside the showroom — and every control on it was sized for a mouse. The website and socials were 13px text hyperlinks; the open/closed badge was a 10px pill; 'Edit hours' and 'Edit address' were 28px-tall buttons crammed under the hours card; the hours modal capped at `max-w-lg` and buried tap-to-call under a scroll; 'Upload photo' fired a hidden file input with no target and no feedback; the categories checkboxes were 16px squares in a two-column grid. Nothing on the page was reliably hittable with a thumb.",
    approach:
      "Push tap targets to 48px+ and give the modals room. The hero's link text row becomes `HeroLinkButtons`: a wide Website button, then one same-size icon button per link type actually present in `showroom_store_links` (absent types render nothing, so the row is built from real data rather than a fixed grid), then the Links button — moved up from under the hours card. The four touch modals (hours, links, upload, categories) share one `TOUCH_DIALOG_CLASS` constant at ~80% of the viewport so 'same size as the hours modal' cannot drift. The hours modal leads with the three things you actually want while parked — Call / Copy address / Send to Tesla — reporting result INSIDE the button (green check, red X + reason), because a toast is easy to miss on a car screen. The open/closed badge goes full-width and picks up a fourth 'Opening Soon' state, retrofitted from the closed PR #135's `computeOpenBadge` (its `computePst`/`hourRowsFromHoursJson` duplicates were dropped in favour of the already-merged `pstNow`/`hoursJsonToRows`).",
    apiChanges: [
      "No new endpoints — the Navigate button reuses the existing POST /api/tesla/navigate ({lat,lng} preferred, {destination} fallback)",
      "GET /api/showroom-stores/:id — no shape change; the client type now models the latitude/longitude the payload already carried",
    ],
    filesTouched: [
      "src/frontend/components/showroom/hours-status.ts",
      "src/frontend/components/showroom/hero/HeroLinkButtons.tsx",
      "src/frontend/components/showroom/hero/UploadPhotoModal.tsx",
      "src/frontend/components/showroom/hero/touch-dialog.ts",
      "src/frontend/components/showroom/hero/HoursContactModal.tsx",
      "src/frontend/components/showroom/hero/HoursMiniCard.tsx",
      "src/frontend/components/showroom/hero/CategoryChipsEditor.tsx",
      "src/frontend/components/showroom/hero/StoreEditModals.tsx",
      "src/frontend/components/showroom/hero/SocialLinks.tsx",
      "src/frontend/components/showroom/hero/index.ts",
      "src/frontend/components/showroom/StoreViewportApp.tsx",
    ],
    migrations: [],
    verification: {
      qcScript: "scripts/qc/pr_153.mjs",
      command: "pnpm run test:pr 153",
      output: `PR #153 QC → https://core-remodel.hacolby.workers.dev

  ── computeOpenBadge (pure) ──
  ✓ open: Wed 12:00 inside 9–17
  ✓ closing-soon: Wed 16:30 is within 60m of the 17:00 close
  ✓ opening-soon: Wed 07:00 is before the 9:00 open (NOT closed)
  ✓ closed: Wed 18:00 is after the 17:00 close
  ✓ closed: Sunday has no window at all
  ✓ open at exactly 9:00 (open is inclusive)
  ✓ closed at exactly 17:00 (close is exclusive)
  ✓ closing-soon at exactly 16:00 (the 60m boundary)
  ✓ null badge when there are no hours
  ✓ hoursJsonToRows drops closed days
  ✓ hoursJsonToRows round-trips into an 'open' badge

  ── deployed API contract ──
  ✓ target reachable (https://core-remodel.hacolby.workers.dev)
  ✓ showroom API rejects an unauthenticated read (401)
  ✓ GET /api/showroom-stores → 200
  ✓ directory returned real rows to assert against
  ✓ at least one store detail carries a non-empty links[] (hero icon row has data)
  ✓ every link row carries { url, type } (the icon row keys off type)
    store 141 links: WEBSITE
  ✓ store detail exposes latitude/longitude (Tesla Navigate payload)
  ✓ POST /api/tesla/navigate rejects an empty body (400)
  ✓ POST /api/tesla/navigate is admin-gated (401 unauthenticated)
    (a real navigate is NOT sent — it would start routing in the car)
  ✓ GET /api/showroom-stores/meta/categories → 200
  ✓ category vocabulary is non-empty (the checkbox grid has rows)

22 passed, 0 failed`,
    },
    code: [
      {
        title: "The fourth state — closed now, but open again later today",
        lang: "ts",
        code: `export function computeOpenBadge(hours: HourRow[], now: PstNow): OpenBadge | null {
  if (!hours || hours.length === 0) return null;
  const row = rowForDay(hours, now.day);
  if (row) {
    const open = openMinutes(row);
    const close = closeMinutes(row);
    if (now.minutes >= open && now.minutes < close) {
      return close - now.minutes <= 60 ? "closing-soon" : "open";
    }
    if (now.minutes < open) return "opening-soon";
  }
  return "closed";
}`,
      },
      {
        title: "One size constant for every touch modal",
        lang: "ts",
        code: `// max-w-none beats DialogContent's sm:max-w-sm (which would clamp w-[80vw]);
// flex flex-col beats its \`grid\` so the body can flex-1 into the height.
export const TOUCH_DIALOG_CLASS =
  "flex h-[80vh] max-h-[80vh] w-[80vw] max-w-none flex-col gap-4 overflow-hidden p-5 sm:max-w-none";`,
      },
      {
        title: "The link row is built from what the store actually has",
        lang: "tsx",
        code: `const iconLinks = ICON_ORDER.flatMap((type) => {
  const href = firstOfType(type);
  const Icon = LINK_ICONS[type];
  if (!href || !Icon) return [];       // absent type → renders nothing
  return [{ type, href, Icon, label: LINK_TYPE_LABELS[type] }];
});`,
      },
    ],
    diagrams: [
      {
        caption: "Hero → modal routing after the rework",
        code: `flowchart TD
  Hero["Showroom hero"] --> Web["Website button (new tab)"]
  Hero --> Icons["Icon button per registered link type"]
  Hero --> LinksBtn["Links"]
  Hero --> Card["Hours card (full-width badge)"]
  LinksBtn --> LinksModal["Links modal — list view"]
  LinksModal -->|pencil| LinksEdit["Add / edit form"]
  Card --> HoursModal["Hours + contact modal"]
  HoursModal --> Call["Call (tel:)"]
  HoursModal --> Copy["Copy address (clipboard)"]
  HoursModal --> Nav["Navigate — POST /api/tesla/navigate"]
  HoursModal --> EditHours["Edit hours"]
  HoursModal --> EditAddr["Edit address"]`,
      },
    ],
  },
  "feature-proposals": {
    slug: "feature-proposals",
    branch: "claude/feature-proposals-api-tools-ea0c5c",
    prNumber: 152,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/152",
    problem:
      "An idea gets worked out in conversation with an AI model — often a non-coding chat, mid-discussion. Weeks later a brand-new coding agent picks it up with zero shared memory. What survives that gap is a summary, and a summary is exactly what loses the alternatives that were considered and rejected, the 'no, because…', the constraints discovered halfway through, and the specific phrasing of a requirement that a paraphrase quietly changes. The coding agent rebuilds a lossy version of the plan from it — the telephone game — and the divergence only surfaces once the wrong thing is built. Second gap: there was no way to submit an idea AS a proposal from a non-coding tool at all; the changelog only documents work after the fact.",
    approach:
      "Let the whole conversation travel with the proposal. A proposal bundle keyed by changelog slug carries the PRD, design brief, and PROMPT in D1 (they get rendered), while the RAW transcript goes to R2 under feature-context/<slug>.md with only its key, size, and SHA-256 in the row. Prod D1 measured 28.3MB during this work; a ~450KB dump per proposal is a real fraction of that, and SQLite reads whole rows, so inlining it would make even `SELECT slug, status` drag every byte off disk. Nothing summarizes the transcript on the way in — the unprocessed text IS the value, so both the MCP tool description and the CLI header say so explicitly, because 'helpfully' condensing it is the one change that would quietly destroy the feature. Three entry points (MCP tool, CLI script, HTTP) all route through one service module, so the R2 + hash + upsert dance exists once. TASKS map onto the EXISTING plan_tasks rather than a second task table, and a re-submit deliberately does not reset task status — progress belongs to whoever is doing the work.",
    apiChanges: [
      "POST /api/changelog/proposals — upsert by slug; context streamed to R2, hashed, size recorded; optionally seeds plans + plan_tasks",
      "GET /api/changelog/proposals — list, ?status= filter",
      "GET /api/changelog/proposals/:slug — bundle metadata + live plan tasks (never the raw blob)",
      "GET /api/changelog/proposals/:slug/context — streams the R2 object",
      "MCP: submit_feature_proposal, get_feature_proposal, list_feature_proposals (new `changelog` category)",
      "All four routes gated behind requireAccessAuth; the rest of /api/changelog stays open",
    ],
    filesTouched: [
      "src/backend/services/changelog-proposals.ts",
      "src/backend/api/routes/changelog.ts",
      "src/backend/api/index.ts",
      "src/backend/mcp/tools/changelog/submit_feature_proposal.ts",
      "src/backend/mcp/tools/changelog/get_feature_proposal.ts",
      "src/backend/mcp/tools/changelog/list_feature_proposals.ts",
      "src/backend/mcp/tools/changelog/_shared.ts",
      "src/backend/mcp/tools/changelog/index.ts",
      "src/backend/mcp/tools/index.ts",
      "src/backend/mcp/types.ts",
      "src/frontend/components/changelog/ProposalBundle.tsx",
      "src/frontend/components/changelog/ChangelogEntryView.astro",
      "src/frontend/pages/admin/changelog/preview/[slug].astro",
      "src/frontend/data/changelog-detail.ts",
      "scripts/changelog/submit-proposal.mjs",
      "scripts/changelog/get-proposal.mjs",
      "scripts/changelog/list-proposals.mjs",
      "scripts/qc/pr_152.mjs",
    ],
    migrations: [
      {
        tag: "0112_careful_gambit",
        sql: `CREATE TABLE \`changelog_proposals\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`slug\` text NOT NULL,
	\`plan_slug\` text,
	\`branch\` text,
	\`pr_number\` integer,
	\`prd_markdown\` text,
	\`design_brief_markdown\` text,
	\`prompt_markdown\` text,
	\`context_r2_key\` text,
	\`context_bytes\` integer,
	\`context_sha256\` text,
	\`context_coverage_note\` text,
	\`source_kind\` text DEFAULT 'ai_chat' NOT NULL,
	\`source_model\` text,
	\`status\` text DEFAULT 'proposed' NOT NULL,
	\`created_at\` integer DEFAULT (unixepoch()) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch()) NOT NULL
);
CREATE UNIQUE INDEX \`changelog_proposals_slug_unique\` ON \`changelog_proposals\` (\`slug\`);
CREATE INDEX \`changelog_proposals_plan_idx\` ON \`changelog_proposals\` (\`plan_slug\`);
CREATE INDEX \`changelog_proposals_status_idx\` ON \`changelog_proposals\` (\`status\`,\`created_at\`);
CREATE INDEX \`changelog_proposals_branch_idx\` ON \`changelog_proposals\` (\`branch\`);`,
      },
    ],
    code: [
      {
        title: "Hash before writing — a re-submitted transcript skips the R2 put",
        lang: "ts",
        code: `// Hash first and compare: a re-submitted conversation is the common case (an
// agent dumps the whole session again after a few more turns), and re-putting
// an identical 450KB blob is pure waste.
const context = input.context;
if (context != null && context.length > 0) {
  const sha = await sha256Hex(context);
  const key = contextKeyFor(slug);
  if (existing?.contextSha256 === sha && existing.contextR2Key === key) {
    contextUnchanged = true;
  } else {
    await env.ARTIFACTS_BUCKET.put(key, context, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: { slug, sha256: sha },
    });
  }
  contextR2Key = key;
  contextBytes = new TextEncoder().encode(context).length;
  contextSha256 = sha;
}`,
      },
      {
        title: "Route order is load-bearing — /proposals must beat /:slug",
        lang: "ts",
        code: `// Registered BEFORE \`GET /:slug\` on purpose: Hono matches in registration
// order, so a \`/:slug\` handler declared first would swallow \`GET /proposals\`.
// Before the fix, GET /api/changelog/proposals returned the entry handler's
// {"error":"Not found"} — a 404 that looks like a missing deploy, not a
// shadowed route.
changelogRouter.get("/proposals", ...);
changelogRouter.post("/proposals", ...);
changelogRouter.get("/proposals/:slug", ...);
changelogRouter.get("/proposals/:slug/context", ...);
changelogRouter.get("/:slug", ...);   // <- pre-existing, must stay last`,
      },
      {
        title: "A re-submit must not reset progress someone already made",
        lang: "ts",
        code: `.onConflictDoUpdate({
  // Re-submitting a proposal must not reset progress a coding session
  // already made, so \`status\` is intentionally NOT in the update set —
  // plan_tasks.status is owned by whoever is doing the work.
  target: [planTasks.planSlug, planTasks.taskKey],
  set: { workstream, phase, title, description, targetRoute,
         changeType, dependsOn, sortOrder, updatedAt: new Date() },
})`,
      },
      {
        title: "An absent coverage note is itself the risk — render it as one",
        lang: "tsx",
        code: `<div className={cn(
  "rounded-lg px-3 py-2 text-xs leading-relaxed ring-1",
  context.coverageNote
    ? "bg-amber-500/8 text-amber-200/90 ring-amber-500/25"
    : "bg-rose-500/8 text-rose-200/90 ring-rose-500/25",
)}>
  <span className="font-semibold uppercase tracking-wide">Coverage — </span>
  {context.coverageNote ??
    "Not recorded. Treat this transcript's completeness as UNKNOWN: it may stop at a compaction boundary or omit earlier discussion."}
</div>`,
      },
    ],
    diagrams: [
      {
        caption: "One service, three entry points — and the D1/R2 split",
        code: `flowchart TD
  chat["Non-coding AI chat"] -->|MCP| tool["submit_feature_proposal"]
  agent["Coding agent (no MCP)"] -->|shell| cli["scripts/changelog/*.mjs"]
  cli -->|HTTP| api["POST /api/changelog/proposals"]
  tool --> svc["services/changelog-proposals.ts<br/>(the only implementation)"]
  api --> svc
  svc -->|"PRD / brief / PROMPT<br/>(rendered, so queryable)"| d1["D1 changelog_proposals"]
  svc -->|"RAW transcript ~450KB<br/>verbatim, never summarized"| r2["R2 feature-context/&lt;slug&gt;.md"]
  svc -->|"TASKS[]"| tasks["D1 plan_tasks<br/>(existing table)"]
  d1 --> page["/admin/changelog/preview/:slug"]
  r2 -.->|"fetched only on click"| page
  tasks -->|"live status"| page`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_152.mjs",
      command:
        "pnpm run test:pr 152 -- --sweep --base https://core-remodel-preview.hacolby.workers.dev",
      ranAt: "2026-07-18",
      source: `// The sweep is where the interesting failures are. A 2KB fixture exercises
// none of what actually makes this feature risky — the payload size on the
// write path, the R2 round-trip, and the hash-based dedupe.
const big = makeTranscript(450_000);
const bigPost = await client.post("/api/changelog/proposals", {
  slug: \`\${SLUG}-large\`, context: big, ...
});
checks.ok("a ~450KB transcript is accepted",
  bigPost.status === 200 || bigPost.status === 201, \`got \${bigPost.status}\`);

const bigCtx = await fetch(\`\${resolveBase()}/api/changelog/proposals/\${SLUG}-large/context\`,
  { headers: { cookie: accessCookie() } });
checks.ok("the large transcript streams back intact", (await bigCtx.text()) === big);`,
      output: `PR #152 QC → https://core-remodel-preview.hacolby.workers.dev

  ✓ target reachable (https://core-remodel-preview.hacolby.workers.dev)
  ✓ unauthenticated GET /api/changelog/proposals is rejected
  ✓ unauthenticated POST /api/changelog/proposals is rejected
  ✓ GET /api/changelog/proposals → 200 (migration 0112 applied)
  ✓ regression: GET /api/changelog/:slug still resolves an entry
  ✓ regression: GET /api/changelog still lists branches
  ✓ POST /api/changelog/proposals accepts a full bundle
  ✓ upsert reports the tasks it seeded
  ✓ upsert stored a context hash
  ✓ GET /api/changelog/proposals/:slug → 200
  ✓ bundle carries the markdown artifacts
  ✓ bundle NEVER inlines the raw transcript
  ✓ coverage note round-trips (it is what stops a reader assuming completeness)
  ✓ TASKS seeded into the EXISTING plan_tasks, with live status
  ✓ the staged changelog entry was upserted alongside the proposal
  ✓ GET …/context streams the R2 object
  ✓ transcript round-trips VERBATIM (nothing summarized it on the way in)
  ✓ re-submitting an identical transcript is detected as unchanged
  ✓ re-submit updates rather than duplicates
  ✓ status-only patch accepted
  ✓ a field omitted from the patch is NOT blanked
  ✓ ?status= filters the list
  ✓ an unknown ?status= is rejected with 400
  ✓ unknown slug → 404
  ✓ preview page renders
  ✓ preview page surfaces the coverage note next to the transcript
  ✓ MCP catalog exposes submit_feature_proposal
  ✓ MCP catalog exposes get_feature_proposal
  ✓ MCP catalog exposes list_feature_proposals

  --sweep: pushing a ~450KB transcript (the size a real dump measured)

    generated 439.5 KB
  ✓ a ~450KB transcript is accepted
    stored 450081 bytes in 246ms
  ✓ stored byte count matches what was sent
  ✓ the large transcript streams back intact
  ✓ listing stays fast with a large transcript stored

33 passed, 0 failed`,
      migrations: [
        {
          tag: "0112_careful_gambit",
          appliedRemote: true,
          note: "pnpm run migrate:remote → 'applied 0112_careful_gambit.sql'; verified with pragma_table_info('changelog_proposals') → 17 columns",
        },
      ],
    },
  },
  "changelog-preview": {
    slug: "changelog-preview",
    problem:
      "Two gaps. (1) The changelog pages were hand-rolled markup — the four installed `beste` blocks were only ever wired into a throwaway chooser page, so the spec'd layout (highlights + feed on the list; developer changelog + recap on the viewport) was never actually live. (2) There was no way to see what a PR WILL say before it deploys: the changelog only documents work after the fact, so stakeholders had no artifact to sign off on while a change was still proposed.",
    approach:
      "Treat the changelog and its preview as the same thing at two lifecycle stages, and render both through one shared view + one shared mapper — so what you approve in preview is literally the code that renders once it ships. `/admin/changelog` shows the full record; `/admin/changelog/preview` filters to `status: staged` (the drafted presser). The list renders changelog24 (highlights) + changelog3 (feed); the viewport renders diagrams, changelog19 (developer changelog + code), then changelog21 as the conclusion recap bucketed into Features / Fixes / Improvements. Diagrams use the shadcn-registry mermaid (mermaidcn) for zoom/pan, since a full architecture diagram is unreadable at fixed size.",
    apiChanges: [
      "No API change — reads the existing changelog_branches + changelog_entries tables",
      "GET /admin/changelog — full record (status-badged)",
      "GET /admin/changelog/[slug] — shipped viewport",
      "GET /admin/changelog/preview — proposed (staged) entries only",
      "GET /admin/changelog/preview/[slug] — proposal viewport",
      "GET /admin/changelog/blocks — the block chooser, moved off /preview",
    ],
    filesTouched: [
      "src/frontend/lib/changelog-blocks.ts",
      "src/frontend/components/changelog/ChangelogListView.astro",
      "src/frontend/components/changelog/ChangelogEntryView.astro",
      "src/frontend/pages/admin/changelog.astro",
      "src/frontend/pages/admin/changelog/[slug].astro",
      "src/frontend/pages/admin/changelog/preview/index.astro",
      "src/frontend/pages/admin/changelog/preview/[slug].astro",
      "src/frontend/pages/admin/changelog/blocks.astro",
      "src/frontend/components/sidebar/nav-groups.ts",
      "src/frontend/components/sidebar/shared.tsx",
    ],
    migrations: [],
    code: [
      {
        title: "One stage flag drives both pages",
        lang: "ts",
        code: `/**
 * - shipped -> /admin/changelog          (full record, status-badged)
 * - staged  -> /admin/changelog/preview  (the drafted presser)
 */
export type ChangelogStage = "shipped" | "staged";

const entries = entryRows
  // Preview = staged only; the changelog = the full record.
  .filter((r) => (stage === "staged" ? r.status === "staged" : true))
  .map(toEntry);`,
      },
      {
        title: "Recap columns — Features / Fixes / Improvements",
        lang: "ts",
        code: `// changelog21's conclusion board. \`removed\` + \`migration\` still exist in the
// data, so they get their own columns rather than being silently dropped;
// empty columns are not rendered.
const RECAP_COLUMNS = [
  { label: "Features",     color: "bg-emerald-500", kinds: ["added"] },
  { label: "Fixes",        color: "bg-blue-500",    kinds: ["fixed"] },
  { label: "Improvements", color: "bg-amber-500",   kinds: ["changed"] },
  { label: "Removed",      color: "bg-rose-500",    kinds: ["removed"] },
  { label: "Migrations",   color: "bg-violet-500",  kinds: ["migration"] },
];`,
      },
      {
        title: "Sidebar: stop Changelog lighting up on its own child",
        lang: "tsx",
        code: `// Changelog and its Preview twin are BOTH sidebar items, and Preview lives
// under /admin/changelog — so prefix-matching lit up both.
if (href === "/admin/changelog") {
  return (
    (currentPath === href || currentPath.startsWith(\`\${href}/\`)) &&
    !currentPath.startsWith("/admin/changelog/preview")
  );
}`,
      },
    ],
    diagrams: [
      {
        caption: "One template, two lifecycle stages — the preview IS the changelog, pre-deploy",
        code: `flowchart LR
    D1[("changelog_entries<br/>status: staged / shipped")]
    D1 --> L{stage}
    L -- "staged" --> P["/admin/changelog/preview<br/>the drafted presser"]
    L -- "shipped" --> C["/admin/changelog<br/>the full record"]
    P --> V["ChangelogListView<br/>SHARED"]
    C --> V
    V --> B24[changelog24<br/>release highlights]
    V --> B3[changelog3<br/>release feed]
    P2["/preview/[slug]"] --> EV["ChangelogEntryView<br/>SHARED"]
    C2["/changelog/[slug]"] --> EV
    EV --> MM[mermaidcn<br/>zoom + pan]
    EV --> B19[changelog19<br/>developer changelog + code]
    EV --> B21[changelog21<br/>Features / Fixes / Improvements]`,
      },
      {
        caption: "An entry's lifecycle — reviewed as a proposal, then kept as the record",
        code: `stateDiagram-v2
    [*] --> staged : branch registers its changelog rows
    staged --> staged : refine the presser (review loop)
    staged --> shipped : PR deploys to prod
    shipped --> [*] : permanent record

    note right of staged
      Visible at /admin/changelog/preview
      Sign off BEFORE it lands.
    end note
    note right of shipped
      Visible at /admin/changelog
      Same template, so the notes you
      approved are the notes that ship.
    end note`,
      },
    ],
  },
  "showroom-editing": {
    slug: "showroom-editing",
    problem:
      "Once normalized, the hours / address / links still needed to be CORRECTABLE — intake misses fields, Google Places is sometimes wrong, and a store can move. And a business card often carries generic store details (name, address, website, socials, phone, email) that belong to the showroom, not the person.",
    approach:
      "Dedicated correction endpoints + MCP tools for each (hours, address, links) so a human, a looping script, or an AI chat can fix them. The contact-create path additionally accepts optional `showroom` details: when present they fuzzy-match the store (id / placeId / website-domain / phone / email-domain / address / name) and FILL-BLANKS the store — address/phone/email onto the store row + GENERAL_CONTACT, website/socials into the links table. Never overwrites existing data.",
    apiChanges: [
      "PUT /api/showroom-stores/:id/hours — hoursJson → rows + is_open_weekends",
      "PUT /api/showroom-stores/:id/address — granular parts + formatted + maps link (zip columns synced)",
      "GET/POST /api/showroom-stores/:id/links + PUT/DELETE /:id/links/:linkId",
      "POST /api/showroom-contacts — person requires a name; accepts optional showroom{name,address,website,phone,email,instagram,facebook,pinterest} → match + fill store",
      "MCP: set_showroom_address (NEW), set_showroom_links (NEW, replace-all), set_showroom_hours; create_showroom_contact takes the same showroom-details field-out",
    ],
    filesTouched: [
      "src/backend/api/routes/showroom-stores.ts (/:id/hours, /:id/address)",
      "src/backend/api/routes/showroom-contacts.ts (matchStore + showroom fill)",
      "src/backend/api/routes/mcp.ts",
      "src/frontend/components/showroom/StoreViewportApp.tsx + intake",
    ],
    migrations: [],
    code: [
      {
        title: "Contact create with a business card's showroom details",
        lang: "json",
        code: `{
  "people": [{ "firstName": "Peter", "lastName": "Huynh", "emailAddress": "peter@davincimarble.com" }],
  "showroom": {
    "name": "DaVinci Marble", "website": "https://davincimarble.com",
    "phone": "(510) 895-4900", "email": "info@davincimarble.com",
    "address": "2000 Marina Blvd, San Leandro, CA", "instagram": "https://instagram.com/davincimarble"
  }
}
// → matches the store, fills its blank address/phone/email + GENERAL_CONTACT,
//   and adds the website + instagram to the links table.`,
      },
    ],
    diagrams: [
      {
        caption: "A business card's showroom details match the store and fill any blanks.",
        code: `flowchart TD
  A["create contact + showroom{...}"] --> B["matchStore (name / website / email / phone / address)"]
  B -- matched --> C["fill-blanks store row (address / phone / email)"]
  B -- matched --> D["upsert GENERAL_CONTACT (office / email)"]
  B -- matched --> E["website + socials to links table"]
  B -- no match --> F["contact saved as draft"]`,
      },
    ],
  },

  "showroom-hours": {
    slug: "showroom-hours",
    problem:
      "Opening hours were stored THREE ways: a `hours_json` blob column, free-text `weekday_hours` / `weekend_hours` columns, and the normalized `showroom_hours` table. They drifted, the hours parser was duplicated in two files, and it was unclear which was authoritative.",
    approach:
      "Collapse to ONE source of truth: the normalized per-day rows, renamed `showroom_store_hours`. The API/MCP accept a structured `hoursJson` PAYLOAD on write and the worker derives the rows + `is_open_weekends`; responses rebuild `hoursJson` from the rows so the frontend keeps a single model. The `hours_json` blob and the free-text columns are superseded — retained as @deprecated so the one-time backfill can read them, and dropped in a follow-up migration once confirmed on prod. The parser is deduped onto one shared util.",
    apiChanges: [
      "POST /api/showroom-stores — accepts hoursJson payload → writes showroom_store_hours rows + is_open_weekends (no blob persisted)",
      "PUT /api/showroom-stores/:id — replace-all hours rows from hoursJson payload",
      "GET /api/showroom-stores + /:id — responses derive hoursJson from the rows (rowsToHoursJson)",
      "POST /api/showroom-stores/backfill/submit — hours fill-blanks now writes rows only",
      "MCP: set_showroom_hours (NEW) — { storeId, hoursJson } → replaces the store's hours rows + derives is_open_weekends",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/hours.ts (rename → showroom_store_hours)",
      "src/backend/db/schema/showroom/stores.ts (hours_json / weekday_hours / weekend_hours → @deprecated)",
      "src/backend/utils/showroom-hours.ts (dedup + parseLegacyHoursText + rowsToHoursJson)",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/api/routes/mcp.ts",
      "src/frontend/components/showroom/hero/*, ShowroomsDirectoryApp.tsx",
    ],
    migrations: [
      {
        tag: "0108",
        sql: "CREATE TABLE `showroom_store_hours` ( ... showroom_id, day, open_hour, open_minute, close_hour, close_minute );\nCREATE UNIQUE INDEX `showroom_hours_showroom_day_unique` ON `showroom_store_hours` (`showroom_id`,`day`);\nDROP TABLE `showroom_hours`;\n-- hours_json / weekday_hours / weekend_hours retained (@deprecated) for the backfill; dropped in a follow-up migration.",
      },
    ],
    code: [
      {
        title: "Derive hoursJson from the rows (response back-compat)",
        lang: "ts",
        code: `export function rowsToHoursJson(rows): HoursJsonColumn {
  const out = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
  for (const r of rows) {
    const key = ENUM_TO_DAY_KEY[r.day];
    if (!key) continue;
    out[key] = {
      open: \`\${pad2(r.openHour)}:\${pad2(r.openMinute)}\`,
      close: \`\${pad2(r.closeHour)}:\${pad2(r.closeMinute)}\`,
    };
  }
  return out;
}`,
      },
      {
        title: "hoursJson payload shape (write)",
        lang: "json",
        code: `{
  "mon": { "open": "09:00", "close": "17:00" },
  "sat": { "open": "10:00", "close": "15:00" },
  "sun": null
}`,
      },
    ],
    diagrams: [
      {
        caption: "showroom_store_hours is now the sole store of truth (one row per open day).",
        code: `erDiagram
  showroom_stores ||--o{ showroom_store_hours : "has (showroom_id->id)"
  showroom_stores {
    integer id PK
    text name
    integer is_open_weekends
  }
  showroom_store_hours {
    integer id PK
    integer showroom_id FK
    text day
    integer open_hour
    integer open_minute
    integer close_hour
    integer close_minute
  }`,
      },
    ],
  },

  "showroom-address": {
    slug: "showroom-address",
    problem:
      "`location_address` held city-only stubs like “San Carlos, CA”; `zip_code` was set on only 85 of 120 stores, and `google_maps_link` was empty everywhere. Nothing was queryable by city/state/street.",
    approach:
      "Add granular `location_*` columns and refresh them (plus the formatted address + maps link) from Google Places `addressComponents` for every place-linked store. Places is authoritative and overwrites the stubs.",
    apiChanges: [
      "POST /api/showroom-stores/backfill/addresses (NEW) — dry-run by default (?apply=true); refreshes granular parts + formatted address + google_maps_link from Places",
      "createStoreSchema accepts location_street_number/_street_name/_city/_state/_zip_code",
      "MCP: (none — address is filled by the backfill route / place-import)",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/stores.ts (add location_* columns)",
      "src/backend/services/google/maps.ts (placeAddressComponents + parseGoogleAddressComponents)",
      "src/backend/api/routes/showroom-backfill.ts",
    ],
    migrations: [
      {
        tag: "0108",
        sql: "ALTER TABLE `showroom_stores` ADD `location_street_number` text;\nALTER TABLE `showroom_stores` ADD `location_street_name` text;\nALTER TABLE `showroom_stores` ADD `location_city` text;\nALTER TABLE `showroom_stores` ADD `location_state` text;\nALTER TABLE `showroom_stores` ADD `location_zip_code` text;",
      },
    ],
    code: [
      {
        title: "Parse Google addressComponents → granular parts",
        lang: "ts",
        code: `export function parseGoogleAddressComponents(data): ParsedAddress {
  const comps = data.addressComponents ?? [];
  const pick = (type, short = false) => {
    const c = comps.find((x) => x.types?.includes(type));
    return c ? (short ? c.shortText : c.longText) : null;
  };
  return {
    formattedAddress: data.formattedAddress ?? null,
    streetNumber: pick("street_number"),
    streetName: pick("route"),
    city: pick("locality") ?? pick("postal_town"),
    state: pick("administrative_area_level_1", true),
    zipCode: pick("postal_code"),
    googleMapsUri: data.googleMapsUri ?? null,
  };
}`,
      },
    ],
    diagrams: [
      {
        caption: "Granular address columns on showroom_stores (blob address kept as the formatted display value).",
        code: `erDiagram
  showroom_stores {
    integer id PK
    text location_address
    text location_street_number
    text location_street_name
    text location_city
    text location_state
    text location_zip_code
    text google_maps_link
  }`,
      },
    ],
  },

  "showroom-links": {
    slug: "showroom-links",
    problem:
      "Website + social URLs lived as flat `website_url` / `instagram_url` / `facebook_url` / `pinterest_url` columns — no room for multiple links, no typing, and the scrape/research/favicon pipeline read the column directly from ~11 files.",
    approach:
      "Introduce `showroom_store_links` (one typed row per URL) as the source of truth. API responses DERIVE the old flat fields from the links so read-side consumers are untouched; the pipeline reads the website via `getStoreWebsiteUrl`. The four flat columns are retained as @deprecated for the one-time backfill and dropped in a follow-up migration.",
    apiChanges: [
      "POST/PUT /api/showroom-stores — accept a links[] payload (replace-all)",
      "GET/POST /api/showroom-stores/:id/links + PUT/DELETE /:id/links/:linkId (NEW) — granular link CRUD",
      "GET responses derive websiteUrl/instagramUrl/facebookUrl/pinterestUrl from links",
      "MCP: create_showroom_contact accepts a urls[] payload → routed to showroom_store_links",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/links.ts (new)",
      "src/backend/utils/showroom-links.ts (getStoreWebsiteUrl, getStoreLinksMap, linksToLegacyUrls, replaceStoreLinks)",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/services/showroom-scrape-workflow.ts + ShowroomResearchAgent/*",
    ],
    migrations: [
      {
        tag: "0108",
        sql: "CREATE TABLE `showroom_store_links` (\n  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n  `store_id` integer NOT NULL,\n  `url` text NOT NULL,\n  `type` text NOT NULL,\n  `url_notes` text,\n  `created_at` integer DEFAULT (unixepoch()) NOT NULL,\n  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,\n  FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON DELETE cascade\n);\n-- website_url / instagram_url / facebook_url / pinterest_url retained (@deprecated); dropped in a follow-up migration.",
      },
    ],
    code: [
      {
        title: "Responses derive the legacy flat fields from links",
        lang: "ts",
        code: `export function linksToLegacyUrls(links: StoreLinkRow[]): LegacyStoreUrls {
  return {
    websiteUrl: firstOfType(links, "WEBSITE"),
    instagramUrl: firstOfType(links, "INSTAGRAM"),
    facebookUrl: firstOfType(links, "FACEBOOK"),
    pinterestUrl: firstOfType(links, "PINTEREST"),
  };
}`,
      },
    ],
    diagrams: [
      {
        caption: "showroom_store_links — the URL source of truth (WEBSITE / INSTAGRAM / PINTEREST / FACEBOOK / OTHER).",
        code: `erDiagram
  showroom_stores ||--o{ showroom_store_links : "has (store_id->id)"
  showroom_stores {
    integer id PK
    text name
  }
  showroom_store_links {
    integer id PK
    integer store_id FK
    text url
    text type
    text url_notes
  }`,
      },
    ],
  },

  "showroom-contacts": {
    slug: "showroom-contacts",
    problem:
      "Contacts were a thin `showroom_pocs` table plus 3 denormalized `main_poc_*` columns. No contact types, no split first/last, no per-store general line, mixed phone strings (“… cell · … direct · … office”), and no interaction history or card scanning.",
    approach:
      "Three new tables. The API/MCP accept a structured payload and “field it out”: people → person rows, an office number/email/fax → the store's single GENERAL_CONTACT (fill-missing), URLs → links, address → the store row. A store is resolved explicitly or by fuzzy match (id/placeId/website-domain/phone/name); unmatched → draft. Business cards (front + back) upload to CF Images, run a vision extractor, and field into a contact; failed cards surface for a closed-loop resolve.",
    apiChanges: [
      "POST /api/showroom-contacts — smart create (people[], general{}, urls[], address, match{}, businessCardFront/Back base64)",
      "GET /api/showroom-contacts?q=&type=&storeId= — phonebook list (+ business card image)",
      "GET/PUT/DELETE /api/showroom-contacts/:id",
      "GET/POST/PUT/DELETE /api/showroom-contacts/contact-log[/:id] — interaction log CRUD",
      "POST /api/showroom-contacts/business-cards — bulk upload → vision → contact (background)",
      "GET /api/showroom-contacts/business-cards?status=failed + POST /:id/resolve — closed loop",
      "POST /api/showroom-contacts/backfill/from-pocs — migrate showroom_pocs + main_poc_*",
      "MCP: create_showroom_contact (field-out payload incl. businessCardFront/Back base64), list_showroom_contacts, list_failed_business_cards, resolve_business_card",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/contacts.ts (new)",
      "src/backend/utils/contact-intake.ts (splitFullName, parsePhoneField, inferContactType)",
      "src/backend/api/routes/showroom-contacts.ts (new)",
      "src/backend/api/routes/mcp.ts",
      "src/frontend/components/showroom/contacts/* + StoreViewportApp.tsx",
    ],
    migrations: [
      {
        tag: "0108",
        sql: "CREATE TABLE `showroom_store_contacts` ( ... type, first_name, last_name, office_phone_number, office_phone_extension, mobile_phone_number, fax_phone_number, email_address, is_texting_ok, best_contact_times_json, is_draft, draft_notes );\nCREATE TABLE `showroom_store_contact_log` ( ... store_contact_id, timestamp_contact_start/end, transcript_json, outcome_of_conversation, is_followup_needed );\nCREATE TABLE `showroom_store_contact_business_cards` ( ... store_id, contact_id, status, cf_image_url, cf_image_url_back, image_json );",
      },
    ],
    code: [
      {
        title: "Split a mixed phone string into labeled numbers",
        lang: "ts",
        code: `// "(510) 809-5741 cell · (510) 447-5016 direct · (510) 236-7960 office"
export function parsePhoneField(raw): LabeledPhones {
  // → mobile: cell/mobile, office: direct/desk, general: office/main (store line), fax
  //   The general number is routed to the store's GENERAL_CONTACT, not the person.
}`,
      },
      {
        title: "Smart create payload (API + MCP)",
        lang: "json",
        code: `{
  "match": { "website": "davincimarble.com", "name": "DaVinci Marble" },
  "people": [{ "fullName": "Peter Huynh", "title": "Sales",
    "phone": "(510) 809-5741 cell · (510) 236-7960 office", "emailAddress": "peter@..." }],
  "general": { "officePhoneNumber": "(510) 236-7960" },
  "urls": [{ "url": "https://davincimarble.com", "type": "WEBSITE" }],
  "businessCardFront": "data:image/jpeg;base64,...",
  "businessCardBack": "data:image/jpeg;base64,..."
}`,
      },
    ],
    diagrams: [
      {
        caption:
          "Contacts, their interaction log, and scanned business cards — generated from the migrations via `pnpm run mermaid:erd` and validated.",
        code: `erDiagram
    showroom_stores ||--o{ showroom_store_contacts : "has (store_id->id)"
    showroom_store_contacts ||--o{ showroom_store_contact_business_cards : "has (contact_id->id)"
    showroom_store_contacts ||--o{ showroom_store_contact_log : "has (store_contact_id->id)"
    showroom_store_contacts {
        integer id PK
        integer store_id
        text type
        text first_name
        text last_name
        text office_phone_number
        text mobile_phone_number
        text email_address
        integer is_draft
    }
    showroom_store_contact_log {
        integer id PK
        integer store_contact_id
        text outcome_of_conversation
        integer is_followup_needed
    }
    showroom_store_contact_business_cards {
        integer id PK
        integer store_id
        integer contact_id
        text status
        text cf_image_url
        text cf_image_url_back
        text image_json
    }`,
      },
    ],
  },

  "showroom-email-contacts": {
    slug: "showroom-email-contacts",
    problem:
      "Inbound email from a showroom went nowhere useful — no contact was created, and there was no way to tie a sender to a showroom.",
    approach:
      "When an inbound worker email does NOT match a directory company, match the sender to a showroom (website-domain / store-email / name) and register a contact from the Gemini-extracted signature; unmatched senders become draft contacts for the phonebook. De-dupes on sender email and never breaks classification. The hook lives in a dedicated module wired into the refactored email pipeline.",
    apiChanges: [
      "email pipeline processEmail → registerShowroomContactFromEmail (reuses the POST /api/showroom-contacts field-out)",
      "MCP: (reuses create_showroom_contact via the shared fieldOutContacts)",
    ],
    filesTouched: [
      "src/backend/services/email/showroom-contact-autopopulate.ts (new)",
      "src/backend/services/email/pipeline.ts (wire-in, company-miss branch)",
    ],
    migrations: [],
    code: [
      {
        title: "Match a sender to a showroom by domain / name",
        lang: "ts",
        code: `async function matchShowroomStore(senderEmail, senderName, env) {
  const domain = senderEmail.split("@")[1]?.toLowerCase();
  if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
    const [link] = await db.select({ storeId: showroomStoreLinks.storeId })
      .from(showroomStoreLinks)
      .where(and(eq(showroomStoreLinks.type, "WEBSITE"),
                 like(showroomStoreLinks.url, \`%\${domain}%\`))).limit(1);
    if (link) return link.storeId;
  }
  // …store email domain, then fuzzy name match
}`,
      },
    ],
    diagrams: [
      {
        caption: "Inbound email → signature extraction → fielded showroom contact (mapped or draft).",
        code: `flowchart TD
  A["Inbound email (worker email)"] --> B{"Matches a directory company?"}
  B -- yes --> C["Company CRM"]
  B -- no --> D["matchShowroomStore (domain / email / name)"]
  D -- matched --> E["showroom_store_contacts (mapped)"]
  D -- no match --> F["showroom_store_contacts (is_draft = true)"]
  F --> G["Phonebook triage"]`,
      },
    ],
  },

  "email-structured-extraction": {
    slug: "email-structured-extraction",
    problem:
      "The inbound-email classifier called Gemini with responseMimeType=application/json but the schema lived only in the prompt text, so the model free-wrote its JSON. On a Costco order that printed the total ($5,105.33), tax, shipping, and discount, it still flagged 'The email does not explicitly state the total… check your payment method for the final charge.' It also captured only description/qty/unitPrice/total per line — no brand, model, discount, shipping, or merchant metadata.",
    approach:
      "Pass a native @google/genai responseSchema (config.responseSchema) so the model must emit exactly the shape we ask for — every total/tax/shipping/discount and per-item brand/model/variant is a first-class property. Enrich the prompt + AiAnalysis interface to match. Add a guard that drops any 'amount unknown / check your payment method' payment flag once a total was actually extracted. The richer fields persist in extracted_raw_json (no migration), ready to surface in the HITL panel later.",
    apiChanges: [
      "No HTTP surface change — internal to the email pipeline (services/email/classify.ts).",
    ],
    filesTouched: [
      "src/backend/services/email/extraction-schema.ts (NEW — native responseSchema)",
      "src/backend/services/email/classify.ts (responseSchema + enriched interface/prompt + flag guard)",
    ],
    migrations: [],
    code: [
      {
        title: "Structured output, not prompt-embedded JSON",
        lang: "ts",
        code: `const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  config: {
    responseMimeType: "application/json",
    responseSchema: ANALYSIS_RESPONSE_SCHEMA, // <- forces every field
    temperature: 0.1,
  },
});
const analysis = JSON.parse(stripJsonFence(response.text || "")) as AiAnalysis;
dropContradictoryPaymentFlags(analysis); // no phantom "total unknown"`,
      },
    ],
    diagrams: [],
  },
  "changelog-persistent-d1": {
    slug: "changelog-persistent-d1",
    problem:
      "A per-branch markdown CHANGELOG.md gets overwritten and merge-conflicts, and there was no durable, shared record of what shipped across branches. Parallel branches would clobber each other's notes.",
    approach:
      "Move the changelog into D1: changelog_branches + changelog_entries, upserted by branch name / entry slug so it accumulates forever and is never clobbered. The overview reads D1 at SSR and falls back to bundled seed data when empty. Each entry carries a full detail_json record surfaced at /admin/changelog/:slug. AGENTS.md makes updating it mandatory every code turn and before every PR.",
    apiChanges: [
      "GET /api/changelog — branches with nested entries",
      "GET /api/changelog/:slug — one entry",
      "POST /api/changelog/branches — upsert branch",
      "POST /api/changelog/entries — upsert entry (append-only across branches)",
      "POST /api/changelog/seed — idempotent seed from bundled data",
    ],
    filesTouched: [
      "src/backend/db/schema/changelog/changelog.ts (NEW)",
      "src/backend/api/routes/changelog.ts (NEW) + api/index.ts mount",
      "src/frontend/data/changelog.ts + changelog-detail.ts (NEW)",
      "src/frontend/pages/admin/changelog.astro + changelog/[slug].astro",
      "AGENTS.md (Changelog discipline)",
    ],
    migrations: [
      {
        tag: "0107_ordinary_hawkeye",
        sql: `CREATE TABLE changelog_branches ( id integer PK, branch text UNIQUE, title, summary, date, status, pr_number, pr_url, created_at, updated_at );
CREATE TABLE changelog_entries ( id integer PK, slug text UNIQUE, branch, tag, area, title, summary, status, date, changes_json, migrations_json, detail_json, created_at, updated_at );`,
      },
    ],
    code: [
      {
        title: "Append-only upsert — a branch never overwrites another's rows",
        lang: "ts",
        code: `await db.insert(changelogEntries)
  .values({ slug: d.slug, branch: d.branch, /* … */ })
  .onConflictDoUpdate({ target: changelogEntries.slug, set: { /* … */ } });`,
      },
    ],
    diagrams: [
      {
        caption: "Branches accumulate in D1; entries append by slug and never overwrite.",
        code: `erDiagram
  changelog_branches ||--o{ changelog_entries : "branch"
  changelog_branches {
    string branch PK
    string title
    string status
  }
  changelog_entries {
    string slug PK
    string branch FK
    string title
    json   detail_json
  }`,
      },
    ],
  },
};
