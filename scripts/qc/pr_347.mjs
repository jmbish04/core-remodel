#!/usr/bin/env node
/**
 * QC — 0045 showroom multi-location (MCP reads, writes, dedupe).
 * Run: node scripts/qc/pr_347.mjs --preview   (or bare for prod)
 *
 * The three new tools live on the OAuth-gated MCP REGISTRY (`/mcp`), which a script
 * cannot bearer-auth into. So this exercises the two surfaces that ARE reachable:
 *
 *   1. GET /api/mcp-docs — the public, registry-driven catalog. If a tool is missing
 *      here it is missing from the MCP server, full stop; the catalog IS the registry.
 *      Asserts the three new tools exist with the right annotations, an example each,
 *      and that the two changed read tools advertise the multi-location model.
 *   2. Remote D1 — the backfill's actual result: one location per store, no duplicate
 *      store_ids, and the primary location's address matching the legacy store columns
 *      that every un-migrated reader still uses (the 0031 Phase A dual-write contract).
 *
 * Regression guard: /api/showroom-stores and /api/mcp-docs must keep answering 200 on
 * BOTH bases, since the changed read tools and the shared service sit behind them.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const isPreview = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC 0045 multi-location against ${BASE}${isPreview ? " (preview)" : ""}\n`);

/**
 * Run one statement against remote D1 and return its `results` rows.
 *
 * wrangler prints a banner and warnings before the `--json` payload, so the JSON is sliced
 * out rather than parsed whole. The slice runs from the FIRST `[` to the LAST `]` on
 * purpose: the payload is one top-level array and the preamble contains no brackets, so a
 * non-greedy match would stop at the first nested `]` and truncate. A parse failure throws
 * instead of degrading to `[]` — a silent empty result would turn every assertion below
 * into a misleading `NaN` comparison rather than an obvious failure.
 *
 * @param {string} sql  A single SQL statement.
 * @returns {Array<Record<string, unknown>>} The statement's result rows.
 */
function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  if (!m) throw new Error(`d1: no JSON payload in wrangler output for: ${sql}`);
  const parsed = JSON.parse(m[0]);
  const results = parsed?.[0]?.results;
  if (!Array.isArray(results)) throw new Error(`d1: no results array for: ${sql}`);
  return results;
}

/** Assert a single-row aggregate actually came back, so a miss fails loudly, not as NaN. */
function d1Row(sql) {
  const [row] = d1(sql);
  if (!row) throw new Error(`d1: expected one row, got none for: ${sql}`);
  return row;
}

const NEW_TOOLS = {
  add_showroom_location: { destructive: false },
  update_showroom_location: { destructive: false },
  delete_showroom_location: { destructive: true },
};

try {
  // ── 1. registry catalog ──────────────────────────────────────────────────
  const docs = await c.get("/api/mcp-docs");
  check("/api/mcp-docs 200", docs.status === 200, `status=${docs.status}`);

  const tools = docs.json?.tools ?? docs.json?.groups?.flatMap((g) => g.tools ?? []) ?? [];
  check("catalog returned tools", tools.length > 0, `count=${tools.length}`);
  const byName = new Map(tools.map((t) => [t.name, t]));

  for (const [name, want] of Object.entries(NEW_TOOLS)) {
    const t = byName.get(name);
    if (!t && !isPreview) {
      info(`${name}: pending merge/deploy (absent from prod catalog)`);
      continue;
    }
    check(`${name} registered`, Boolean(t));
    if (!t) continue;
    check(`${name} has a description`, (t.description ?? "").length > 80);
    check(`${name} has >=1 example`, (t.examples ?? []).length >= 1);
    const destructive = t.annotations?.destructiveHint === true;
    check(
      `${name} destructiveHint=${want.destructive}`,
      destructive === want.destructive,
      `got ${destructive}`,
    );
  }

  // The changed reads must TELL an agent about the model, or it will keep reaching for
  // update_showroom to "fix" an address that is really a second site.
  const get = byName.get("get_showroom");
  const list = byName.get("list_showrooms");
  if (get && list) {
    const getDesc = get.description ?? "";
    const listDesc = list.description ?? "";
    const advertised =
      getDesc.includes("add_showroom_location") && getDesc.toLowerCase().includes("locations");
    if (!advertised && !isPreview) {
      info("get_showroom description: pending merge/deploy (still the single-address copy)");
    } else {
      check("get_showroom points agents at add_showroom_location", advertised);
      check(
        "list_showrooms advertises locationCount / multiLocationOnly",
        listDesc.includes("locationCount") && listDesc.includes("multiLocationOnly"),
      );
    }
  }

  // ── 2. backfill + dual-write parity in D1 ────────────────────────────────
  const counts = d1Row(
    "SELECT (SELECT count(*) FROM showroom_store_locations) locs," +
      " (SELECT count(DISTINCT store_id) FROM showroom_store_locations) distinct_stores," +
      " (SELECT count(*) FROM showroom_stores) stores;",
  );
  const locs = Number(counts?.locs);
  const stores = Number(counts?.stores);
  const distinct = Number(counts?.distinct_stores);
  check("every store has at least one location", locs >= stores, `locs=${locs} stores=${stores}`);
  check("no store has duplicate backfill rows", distinct === stores, `distinct=${distinct}`);

  const orphans = d1Row(
    "SELECT count(*) n FROM showroom_stores s" +
      " WHERE NOT EXISTS (SELECT 1 FROM showroom_store_locations l WHERE l.store_id = s.id);",
  );
  check("no store without a location", Number(orphans?.n) === 0, `orphans=${orphans?.n}`);

  const dupPlaces = d1Row(
    "SELECT count(*) n FROM (SELECT place_id FROM showroom_store_locations" +
      " WHERE place_id IS NOT NULL GROUP BY place_id HAVING count(*) > 1);",
  );
  check("no place_id shared by two locations", Number(dupPlaces?.n) === 0, `dupes=${dupPlaces?.n}`);

  // Dual-write contract: the primary site's city must equal the store's legacy city, or
  // every un-migrated reader (API, frontend, drive routing, Tesla nav) is pointing at the
  // wrong branch. Compared on the place_id-matched primary only.
  const drift = d1Row(
    "SELECT count(*) n FROM showroom_stores s" +
      " JOIN showroom_store_locations l ON l.store_id = s.id AND l.place_id = s.place_id" +
      " WHERE s.place_id IS NOT NULL" +
      " AND IFNULL(TRIM(LOWER(l.city)),'') <> IFNULL(TRIM(LOWER(s.location_city)),'');",
  );
  check("primary location city matches legacy store city", Number(drift?.n) === 0, `drift=${drift?.n}`);

  // ── 3. regression guard ──────────────────────────────────────────────────
  const stores200 = await c.get("/api/showroom-stores");
  check("/api/showroom-stores still 200", stores200.status === 200, `status=${stores200.status}`);
} catch (err) {
  console.error("\nQC threw:", err?.message ?? err);
  process.exitCode = 1;
}

summary();
