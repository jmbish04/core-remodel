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
