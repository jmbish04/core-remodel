/**
 * @fileoverview Health probes for the showroom module (the store directory and
 * everything hanging off it).
 *
 * `showroom_stores` is the most heavily joined table in the app — the directory,
 * drive planning, scouting, brand mapping and the visit log all key off it. Its
 * failure modes are quiet: orphaned child rows after a bad delete, stores with no
 * lat/lng (which silently vanish from every map and route plan), and scrape jobs
 * that terminated `failed` and were never retried.
 *
 * Cost discipline: every probe here is a bounded `COUNT(*)` aggregate. No model
 * runs, no Places API call, no scrape.
 */
import {
  defineProbe,
  degraded,
  failure,
  ok,
  scalar,
  tableExists,
  type HealthProbe,
} from "@backend/services/health/types";

const FILE = "src/backend/services/showroom/health.ts";

/** Below this, the directory looks like it was truncated rather than merely small. */
const STORE_COUNT_FLOOR = 25;

/** Fraction of stores allowed to be missing lat/lng before this is DEGRADED. */
const GEO_MISSING_DEGRADED_RATIO = 0.15;

/** Failed scrapes above this count means the scrape pipeline needs attention. */
const SCRAPE_FAILED_DEGRADED_AT = 10;

/** Child tables whose FK points at `showroom_stores.id`, with the column name. */
const CHILD_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "store_notes", column: "store_id" },
  { table: "showroom_store_category_mapping", column: "store_id" },
  { table: "showroom_pocs", column: "showroom_id" },
  { table: "showroom_store_hours", column: "showroom_id" },
];

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "showroom_directory_population",
    displayName: "Showroom directory population",
    description:
      "Counts rows in showroom_stores and how many are active, guarding against a truncated or " +
      "never-seeded directory.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      `showroom_stores exists on this D1 and holds at least ${STORE_COUNT_FLOOR} rows with a healthy ` +
      "active count. The directory page, drive planner and scout all have something to work with.",
    whatFailureMeans:
      "FAILURE = the table is missing (a migration was generated but never applied to remote, which makes " +
      "every /api/showroom-stores route 500). A very low count means the directory was truncated — most " +
      "likely a D1 `DROP TABLE` cascade during a drizzle column-drop rebuild, which silently wipes child " +
      "data, or an import that never ran. Every downstream surface (maps, routes, brand mapping) goes empty.",
    troubleshootingSteps:
      "1. If the table is missing: `pnpm run migrate:remote`, then verify with " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT COUNT(*) FROM showroom_stores\"`. " +
      "2. If the count collapsed, check whether a recent migration rebuilt the table — a drizzle column-drop " +
      "on D1 does a create/copy/drop and fires ON DELETE CASCADE on the way through. " +
      "3. Compare against the last known-good count in the changelog entry for the most recent showroom PR. " +
      "4. Inspect the live directory: https://core-remodel.hacolby.workers.dev/showrooms " +
      "5. If data really is gone, restore from the seed/import path rather than hand-inserting rows.",
    devOpsPlaybook:
      "Data-loss class incident if the count dropped. STOP deploying, capture the current counts, and check " +
      "`npx wrangler deployments list | tail -20` plus the migrations applied since the last good count. " +
      "Never 'fix' this with raw `wrangler d1 execute --file` writes — migrations only, via `pnpm run migrate:remote`.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      if (!(await tableExists(env.DB, "showroom_stores"))) {
        return failure(
          "Table showroom_stores does not exist on this D1. Every /api/showroom-stores route will 500 — " +
            "run `pnpm run migrate:remote` and verify the table exists on remote.",
        );
      }
      const total = await scalar(env.DB, "SELECT COUNT(*) AS c FROM showroom_stores");
      const active = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM showroom_stores WHERE is_active = 1",
      );
      const details = `${total} showroom store row(s), ${active} active.`;
      if (total === 0) {
        return failure(`${details} The directory is EMPTY — the table exists but holds no rows.`);
      }
      if (total < STORE_COUNT_FLOOR) {
        return degraded(
          `${details} Below the expected floor of ${STORE_COUNT_FLOOR} — the directory looks truncated.`,
        );
      }
      return ok(details);
    },
  }),

  defineProbe({
    name: "showroom_child_row_orphans",
    displayName: "Showroom child-row orphans",
    description:
      "Left-joins each showroom child table (store_notes, showroom_store_category_mapping, " +
      "showroom_pocs, showroom_store_hours) back to showroom_stores and counts rows whose required " +
      "FK points at a store that no longer exists.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Zero orphans. Every note, category mapping, point of contact and opening-hours row still resolves " +
      "to a live store, so joins on the directory page return complete rows and nothing is quietly dropped " +
      "by an INNER JOIN.",
    whatFailureMeans:
      "Rows exist whose store is gone. All four FKs are declared `ON DELETE CASCADE`, so orphans mean the " +
      "cascade did not run — most likely rows were inserted with a store id that never existed (a caller " +
      "coercing a missing FK instead of rejecting the request), or a table was rebuilt with foreign keys " +
      "effectively off. The rows are invisible in the UI but still counted by aggregates, so totals disagree " +
      "with what a human can see.",
    troubleshootingSteps:
      "1. The details string names each table and its orphan count. List them, e.g. " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT n.id, n.store_id FROM store_notes n LEFT JOIN showroom_stores s ON s.id = n.store_id WHERE s.id IS NULL LIMIT 20\"`. " +
      "2. Decide per row: re-point to the correct store, or delete. Do NOT invent a placeholder store row. " +
      "3. Find the writer: grep the insert path for that table under src/backend/api/routes/ and " +
      "src/backend/services/showroom/, and make it reject with 400 when the store id is missing rather than " +
      "coercing to null/0. 4. Re-run this probe after the cleanup.",
    devOpsPlaybook:
      "Fix the writer first, then the data — cleaning up before the bug is fixed just refills the table. " +
      "Any cleanup is a data change: do it deliberately from a migration or an explicit one-off, note the " +
      "row counts before and after in the changelog entry, and re-run this probe from /admin/system/health to confirm zero.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "showroom_stores"))) {
        return failure("Table showroom_stores is missing — cannot evaluate child-row integrity.");
      }
      const seen: string[] = [];
      const orphaned: string[] = [];
      let totalOrphans = 0;
      for (const { table, column } of CHILD_TABLES) {
        if (!(await tableExists(env.DB, table))) {
          seen.push(`${table}: table missing`);
          continue;
        }
        const count = await scalar(
          env.DB,
          `SELECT COUNT(*) AS c FROM ${table} c LEFT JOIN showroom_stores s ON s.id = c.${column} WHERE s.id IS NULL`,
        );
        totalOrphans += count;
        seen.push(`${table}: ${count}`);
        if (count > 0) orphaned.push(`${table} (${count} via ${column})`);
      }
      const details = `Orphan counts — ${seen.join(", ")}.`;
      return totalOrphans > 0
        ? degraded(`${details} Orphans found in: ${orphaned.join(", ")}.`)
        : ok(details);
    },
  }),

  defineProbe({
    name: "showroom_geo_coverage",
    displayName: "Showroom geo coverage",
    description:
      "Counts active showroom_stores rows with a null latitude or longitude. Geo is what puts a store on " +
      "a map and into a drive route.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      `Fewer than ${Math.round(GEO_MISSING_DEGRADED_RATIO * 100)}% of active stores lack lat/lng, so the ` +
      "map view and drive-route planning see essentially the whole directory.",
    whatFailureMeans:
      "Stores without coordinates are silently excluded from every map, distance sort and route plan. " +
      "Nothing errors — the store just never appears as a candidate stop, which reads as 'the planner " +
      "forgot about that showroom' rather than as a data gap. A sudden jump usually means a batch of " +
      "stores was imported without a Places lookup, or the geo backfill stopped running.",
    troubleshootingSteps:
      "1. List the gaps: " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT id, name, location_address FROM showroom_stores WHERE is_active = 1 AND (latitude IS NULL OR longitude IS NULL) LIMIT 25\"`. " +
      "2. Rows with an address but no coords are backfillable — run the geo backfill (the `backfill_showroom_geo` " +
      "MCP tool, or the backfill route in src/backend/api/routes/showroom-backfill.ts). " +
      "3. Rows with no address either need the address filled first; see src/backend/services/showroom/places-backfill.ts. " +
      "4. Confirm on the map at https://core-remodel.hacolby.workers.dev/showrooms after the backfill. " +
      "5. If new imports keep landing without geo, fix the import path rather than re-running the backfill forever.",
    devOpsPlaybook:
      "Backfill is the remediation, and it calls the Google Places API — that costs money per lookup, so " +
      "scope it to the missing rows rather than re-running over the whole directory. This probe itself never " +
      "calls Places; it only counts. Record the before/after gap counts in the changelog entry for the backfill run.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "showroom_stores"))) {
        return failure("Table showroom_stores is missing — cannot evaluate geo coverage.");
      }
      const active = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM showroom_stores WHERE is_active = 1",
      );
      if (active === 0) return degraded("No active showroom stores to evaluate geo coverage against.");

      const missing = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM showroom_stores WHERE is_active = 1 AND (latitude IS NULL OR longitude IS NULL)",
      );
      const missingWithAddress = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM showroom_stores WHERE is_active = 1 AND (latitude IS NULL OR longitude IS NULL) " +
          "AND location_address IS NOT NULL AND location_address <> ''",
      );
      const pct = ((missing / active) * 100).toFixed(1);
      const details =
        `${missing} of ${active} active stores (${pct}%) have no latitude/longitude; ` +
        `${missingWithAddress} of those DO have an address and are backfillable.`;
      return missing / active > GEO_MISSING_DEGRADED_RATIO ? degraded(details) : ok(details);
    },
  }),

  defineProbe({
    name: "showroom_scrape_failures",
    displayName: "Showroom scrape failures",
    description:
      "Counts showroom_stores by scrape_status, surfacing rows stuck in 'failed' (workflow terminated " +
      "unrecoverably) or stranded in 'running'/'pending'.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      `Fewer than ${SCRAPE_FAILED_DEGRADED_AT} stores in scrape_status='failed' and nothing stranded ` +
      "mid-run. The browser-rendering scrape pipeline is completing, so browser_run_pages rows and the " +
      "product/brand intel derived from them stay fresh.",
    whatFailureMeans:
      "A pile of 'failed' rows means the scrape workflow is dying — a site changed shape, Browser Rendering " +
      "is erroring, or the workflow binding is wrong. Rows stuck in 'running' are worse: the workflow started " +
      "and never reported back, so nothing will ever retry them and the store's intel silently stops updating.",
    troubleshootingSteps:
      "1. List the failures: " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT id, name, scrape_status FROM showroom_stores WHERE scrape_status IN ('failed','running') LIMIT 25\"`. " +
      "2. Watch a live re-run with `npx wrangler tail` and trigger a scrape from " +
      "https://core-remodel.hacolby.workers.dev/admin/showrooms — the error surfaces in the workflow logs, not in D1. " +
      "3. Common cause: the snapshot returns the pre-JS shell — the scraper must wait for networkidle2 and read " +
      "`result.content` (not `.html`). 4. Rows stuck in 'running' with no active workflow instance should be reset " +
      "to 'idle' so they become eligible again. 5. Check the workflow bindings in wrangler.jsonc if EVERY store fails.",
    devOpsPlaybook:
      "Scraping runs on Browser Rendering and burns real quota, so do NOT mass-retry as a first move — fix the " +
      "cause on one store, verify, then re-run the batch. Workflow names are account-scoped and suffixed per " +
      "preview branch; if a preview's scrapes are landing on production rows, check the workflow name suffixing " +
      "in scripts/deploy-preview.mjs before touching data.",
    isBillingRisk: true,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "showroom_stores"))) {
        return failure("Table showroom_stores is missing — cannot evaluate scrape status.");
      }
      const failed = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM showroom_stores WHERE scrape_status = 'failed'",
      );
      const running = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM showroom_stores WHERE scrape_status = 'running'",
      );
      const pending = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM showroom_stores WHERE scrape_status = 'pending'",
      );
      const complete = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM showroom_stores WHERE scrape_status = 'complete'",
      );
      const details = `scrape_status — failed: ${failed}, running: ${running}, pending: ${pending}, complete: ${complete}.`;
      if (failed >= SCRAPE_FAILED_DEGRADED_AT) {
        return degraded(`${details} ${failed} failures is at or above the ${SCRAPE_FAILED_DEGRADED_AT} threshold.`);
      }
      if (running > 0) {
        return degraded(
          `${details} ${running} store(s) stranded in 'running' — a workflow started and never reported back; ` +
            "nothing will retry them.",
        );
      }
      return ok(details);
    },
  }),

  defineProbe({
    name: "showroom_category_mapping_coverage",
    displayName: "Showroom category-mapping coverage",
    description:
      "Counts active stores with no row in showroom_store_category_mapping. Category is the multi-select " +
      "vocabulary the directory filters on, mapped via a definition + mapping table pair.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Most active stores carry at least one category mapping, so category filters on the directory return " +
      "them and the mapping table (not a denormalized string column) is genuinely being populated.",
    whatFailureMeans:
      "Uncategorized stores disappear from every category-filtered view. This has a known history: an " +
      "AI-driven categorization pass lost categories for a large slice of the directory because it " +
      "round-tripped category NAMES instead of ids and needed an exact case-sensitive match. A jump in the " +
      "uncategorized count is the fingerprint of that failure mode recurring.",
    troubleshootingSteps:
      "1. List them: " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT s.id, s.name FROM showroom_stores s LEFT JOIN showroom_store_category_mapping m ON m.store_id = s.id WHERE s.is_active = 1 AND m.id IS NULL LIMIT 25\"`. " +
      "2. Check the definition table is populated too: `SELECT COUNT(*) FROM showroom_store_category`. " +
      "3. If a categorization job is the writer, confirm it hands the model `id: name — description` and " +
      "returns IDS, and that returned ids are validated against the live set before insert — a hallucinated id " +
      "must never reach the FK. 4. Re-categorize the gap only, not the whole directory. " +
      "5. Verify the filters at https://core-remodel.hacolby.workers.dev/showrooms",
    devOpsPlaybook:
      "Re-categorization uses a model and therefore costs money — scope any backfill to the uncategorized ids " +
      "from step 1. This probe never calls a model. If the count regressed after a deploy, check what changed " +
      "in the categorization writer before re-running anything.",
    isBillingRisk: false,
    severity: "LOW",
    run: async (env) => {
      const haveStores = await tableExists(env.DB, "showroom_stores");
      const haveMapping = await tableExists(env.DB, "showroom_store_category_mapping");
      if (!haveStores || !haveMapping) {
        return failure(
          `Missing table(s): ${!haveStores ? "showroom_stores " : ""}${!haveMapping ? "showroom_store_category_mapping" : ""}`.trim() +
            " — run `pnpm run migrate:remote`.",
        );
      }
      const active = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM showroom_stores WHERE is_active = 1",
      );
      if (active === 0) return degraded("No active showroom stores to evaluate category coverage against.");

      const uncategorized = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM showroom_stores s LEFT JOIN showroom_store_category_mapping m " +
          "ON m.store_id = s.id WHERE s.is_active = 1 AND m.id IS NULL",
      );
      const definitions = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM showroom_store_category",
      );
      const pct = ((uncategorized / active) * 100).toFixed(1);
      const details =
        `${uncategorized} of ${active} active stores (${pct}%) have no category mapping; ` +
        `${definitions} category definition(s) exist.`;
      if (definitions === 0) {
        return degraded(`${details} The category DEFINITION table is empty — nothing can be mapped.`);
      }
      return uncategorized > active / 2 ? degraded(details) : ok(details);
    },
  }),
];
