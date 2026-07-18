/**
 * Full developer record behind each changelog entry on /admin/changelog.
 * Keyed by the entry `id` (= the detail page slug at /admin/changelog/:id).
 *
 * Standard (see AGENTS.md): every non-trivial change ships a detail entry with
 * the problem, the approach, the exact API surface touched, the files, the
 * migration SQL, representative code, and (where useful) a Mermaid diagram.
 * Seeded/fallback here, then persisted to D1 (changelog_entries.detail_json).
 */

export interface CodeCard {
  title: string;
  lang: "ts" | "tsx" | "sql" | "json" | "bash";
  code: string;
}

export interface DiagramCard {
  caption: string;
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
  problem: string;
  approach: string;
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
