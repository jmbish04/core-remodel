/**
 * @fileoverview Health probes for the persistence layer: D1 (`DB`, `TESLA_DB`),
 * KV (`CACHE`, `SESSIONS`, `OAUTH_KV`, `AGENT_ADHOC_MEMORY_KV`) and R2
 * (`ARTIFACTS_BUCKET`).
 *
 * Everything here is a bounded read, a tiny KV round trip, or a single-object R2
 * head. No table scans, no paid calls, nothing that fans out.
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

/** Local drizzle journal size at the time this probe was written (`drizzle/*.sql`). */
const MIGRATION_FLOOR = 24;

/**
 * Rough floor for `sqlite_master` tables. The drizzle schema declares ~248
 * tables; a production DB that reports far fewer means a migration did not
 * land (or a probe is pointed at the wrong database).
 */
const TABLE_FLOOR = 200;

/**
 * A sample of tables the app cannot serve a page without. Deliberately spread
 * across domains so one unapplied migration folder shows up here.
 */
const CRITICAL_TABLES = [
  "rooms",
  "material_schedule_items",
  "budget_tracker_items",
  "showroom_stores",
  "images",
  "agent_runs",
  "changelog_entries",
  "system_cron_schedules",
] as const;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "d1_core_reachable",
    displayName: "D1 (DB) reachable within latency envelope",
    description:
      "Runs `SELECT 1` plus a bounded count against the primary D1 binding `DB` and times the round trip. DEGRADED when the round trip exceeds 1500ms, which is well outside D1's normal single-digit-to-low-hundreds millisecond range from a Worker.",
    healthTsFilepath: "src/backend/db/health.ts",
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "The `DB` binding is attached to this deployment, the database exists, and it answered a trivial query quickly. Every API route that reads or writes remodel data can reach its store.",
    whatFailureMeans:
      "Either the `DB` binding is missing from the deployed worker (a wrangler.jsonc/binding problem, not a data problem) or D1 itself is refusing queries. In practice the whole admin surface returns 500s while this is failing — there is no read path that does not go through `DB`.",
    troubleshootingSteps:
      "1. Confirm the binding exists on the LIVE worker: `npx wrangler deployments list` then check `wrangler.jsonc` has the `d1_databases` entry named `DB` with the right `database_id`. 2. Query the DB directly, outside the worker: `npx wrangler d1 execute core-remodel --remote --command \"SELECT 1\"`. If that also fails the fault is D1/account-side, not code. 3. If only the worker fails, the last deploy shipped without the binding — re-run `pnpm run deploy` from `main`. 4. If the query succeeds but is slow, check whether a probe is competing with a large backfill or cron sweep that is holding D1 busy.",
    devOpsPlaybook:
      "1. This is a hard outage — nothing else on /admin/health matters until it is green. 2. Check the Cloudflare status page for D1 in the account's region before touching code. 3. If the last deploy correlates with onset, roll back: `npx wrangler deployments list`, take the previous version id, `npx wrangler rollback <version-id>`. 4. Once restored, re-run `pnpm run test:pr <n>` for the most recent PR to confirm the API surface recovered.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const started = Date.now();
      const one = await scalar(env.DB, "SELECT 1 AS v");
      const rooms = await scalar(env.DB, "SELECT COUNT(*) AS c FROM rooms");
      const elapsed = Date.now() - started;
      if (one !== 1) {
        return failure(`DB answered SELECT 1 with ${one} (expected 1) in ${elapsed}ms`);
      }
      if (elapsed > 1500) {
        return degraded(
          `DB reachable but slow: SELECT 1 + COUNT(rooms) took ${elapsed}ms (envelope is <1500ms). rooms=${rooms}`,
        );
      }
      return ok(`DB reachable in ${elapsed}ms; rooms=${rooms}`);
    },
  }),

  defineProbe({
    name: "d1_tesla_reachable",
    displayName: "Tesla D1 (TESLA_DB) reachable",
    description:
      "Confirms the secondary D1 binding `TESLA_DB` is attached and its `tesla_telemetry_events` table answers a bounded COUNT. This database is migrated by a separate journal (`drizzle-tesla/`) and a separate command, so it drifts independently of the main DB.",
    healthTsFilepath: "src/backend/db/health.ts",
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "The Tesla telemetry/webhook store is reachable and its schema is present. The vehicle-location, drive-detection and Tesla webhook paths have somewhere to write.",
    whatFailureMeans:
      "Tesla ingestion is dark. Inbound webhooks and the poller will 500 and the events they carried are lost — this store is the only record of them. The drives/showroom-visit features that depend on vehicle position silently stop advancing.",
    troubleshootingSteps:
      "1. Missing table rather than missing binding? Run `pnpm run migrate:tesla:remote` — the Tesla journal is applied by its OWN command and `pnpm run migrate:remote` does not touch it. 2. Verify directly: `npx wrangler d1 execute <tesla-db-name> --remote --command \"SELECT COUNT(*) FROM tesla_telemetry_events\"`. 3. If the binding itself is absent, check the second entry in `d1_databases` in `wrangler.jsonc` and redeploy with `pnpm run deploy` (which runs both migrate:remote and migrate:tesla:remote before uploading).",
    devOpsPlaybook:
      "1. Non-fatal for the remodel app — scope the incident to Tesla features and say so. 2. Apply `pnpm run migrate:tesla:remote`, then re-run this probe. 3. Check `tesla_webhook_events` for a gap window and note it; replaying Tesla webhooks is not possible, so the gap is permanent and should be recorded rather than chased.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!env.TESLA_DB) return failure("TESLA_DB binding is not present on this deployment");
      if (!(await tableExists(env.TESLA_DB, "tesla_telemetry_events"))) {
        return failure(
          "TESLA_DB reachable but `tesla_telemetry_events` is missing — run `pnpm run migrate:tesla:remote`",
        );
      }
      const events = await scalar(
        env.TESLA_DB,
        "SELECT COUNT(*) AS c FROM tesla_telemetry_events",
      );
      return ok(`TESLA_DB reachable; tesla_telemetry_events rows=${events}`);
    },
  }),

  defineProbe({
    name: "d1_migrations_applied",
    displayName: "Drizzle migrations applied to remote D1",
    description:
      "Reads the `d1_migrations` journal table that `scripts/d1-migrate.mjs` maintains, checks it exists, that it holds at least as many rows as the local `drizzle/` journal had when this probe was written, and reports the most recently applied tag.",
    healthTsFilepath: "src/backend/db/health.ts",
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "The remote database has a migration journal and it is at or ahead of the known floor. Schema changes shipped by recent deploys were actually applied, not just built.",
    whatFailureMeans:
      "Either nothing has ever been migrated against this database (no `d1_migrations` table) or the journal is behind. Because `pnpm run deploy` runs migrations BEFORE the upload, a behind journal usually means someone deployed with `npx wrangler deploy` directly — new code is live against an old schema and every route touching a new column returns 500.",
    troubleshootingSteps:
      "1. Apply the journal: `pnpm run migrate:remote` (NEVER `npx wrangler d1 execute --file` and never hand-edit a migration). 2. Verify what landed: `npx wrangler d1 execute core-remodel --remote --command \"SELECT name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 10\"`. 3. Confirm the specific column your failing route needs actually exists: `npx wrangler d1 execute core-remodel --remote --command \"PRAGMA table_info(<table>)\"`. 4. Re-deploy the worker with `pnpm run deploy` so build + migrate + upload run in the correct order.",
    devOpsPlaybook:
      "1. When a route starts 500ing right after a schema PR, suspect this probe first — it is the single most common cause in this repo. 2. Run `pnpm run migrate:remote`, then re-run the PR's QC script (`pnpm run test:pr <n>`) against production. 3. If a migration itself errors mid-way, do NOT retry blindly — read the failing statement, check whether it half-applied (`PRAGMA table_info`), and remember that on D1 a DROP TABLE fires ON DELETE CASCADE and can wipe child rows. 4. Record the applied tags in the changelog entry's verification block.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      if (!(await tableExists(env.DB, "d1_migrations"))) {
        return failure(
          "`d1_migrations` table does not exist — this database has never been migrated. Run `pnpm run migrate:remote`.",
        );
      }
      const applied = await scalar(env.DB, "SELECT COUNT(*) AS c FROM d1_migrations");
      const latest = await env.DB.prepare(
        "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1",
      ).first<{ name: string }>();
      const latestName = latest?.name ?? "(none)";
      if (applied < MIGRATION_FLOOR) {
        return degraded(
          `Only ${applied} migrations applied (expected at least ${MIGRATION_FLOOR}); latest="${latestName}". Run \`pnpm run migrate:remote\`.`,
        );
      }
      return ok(`${applied} migrations applied; latest="${latestName}"`);
    },
  }),

  defineProbe({
    name: "d1_critical_tables_present",
    displayName: "Critical D1 tables present",
    description:
      `Checks that a cross-domain sample of load-bearing tables exists in sqlite_master: ${CRITICAL_TABLES.join(", ")}. One missing table pinpoints which migration folder failed to apply.`,
    healthTsFilepath: "src/backend/db/health.ts",
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Every sampled domain (rooms, materials, budget, showroom, images, agents, changelog, cron config) has its base table on the remote database, so their pages and APIs have something to read.",
    whatFailureMeans:
      "A specific domain's schema is missing from production. Its pages will 500 rather than render empty — a missing table is an exception, not a zero-row result. The probe names which table so you do not have to bisect the journal.",
    troubleshootingSteps:
      "1. Read the details string for the missing table name. 2. Grep the schema to find its migration: `grep -rn '<table_name>' drizzle/*.sql | head`. 3. Apply the journal with `pnpm run migrate:remote` and re-run this probe. 4. If the table is in `drizzle/` but never lands, the migration probably errored partway — run it and read the error rather than assuming success: `npx wrangler d1 execute core-remodel --remote --command \"SELECT name FROM sqlite_master WHERE type='table' AND name='<table>'\"`.",
    devOpsPlaybook:
      "1. Treat as a deploy-order incident: code is ahead of schema. 2. `pnpm run migrate:remote`, verify with the sqlite_master query above, then `pnpm run deploy` so the worker and schema are in step. 3. If the table was DROPped by a drizzle column-drop rebuild, check child tables for cascade data loss before restoring — on D1, PRAGMA foreign_keys=OFF is a no-op and a rebuild can silently wipe children.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const missing: string[] = [];
      for (const table of CRITICAL_TABLES) {
        if (!(await tableExists(env.DB, table))) missing.push(table);
      }
      if (missing.length > 0) {
        return failure(
          `${missing.length}/${CRITICAL_TABLES.length} critical tables missing: ${missing.join(", ")}`,
        );
      }
      return ok(`All ${CRITICAL_TABLES.length} sampled critical tables present`);
    },
  }),

  defineProbe({
    name: "d1_schema_table_floor",
    displayName: "sqlite_master table count above floor",
    description:
      `Counts user tables in sqlite_master (excluding sqlite_* internals) and compares against a floor of ${TABLE_FLOOR}. A blunt but effective catch for "this worker is pointed at the wrong / a fresh D1 database".`,
    healthTsFilepath: "src/backend/db/health.ts",
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "The database has roughly the number of tables the drizzle schema declares, so the binding is pointed at the real production database rather than an empty or preview one.",
    whatFailureMeans:
      "The count is far below the schema's size. Almost always this means the `database_id` in wrangler.jsonc points at a different (new/empty) D1 instance, or a squashed baseline was applied to a blank database and the follow-on journal never ran.",
    troubleshootingSteps:
      "1. Print the bound database and compare ids: `npx wrangler d1 list` against the `database_id` in `wrangler.jsonc`. 2. Count directly: `npx wrangler d1 execute core-remodel --remote --command \"SELECT COUNT(*) FROM sqlite_master WHERE type='table'\"`. 3. If ids match but the count is low, run `pnpm run migrate:remote` and re-check. 4. If ids do NOT match, stop — do not migrate the wrong database. Fix wrangler.jsonc and redeploy first.",
    devOpsPlaybook:
      "1. Never 'fix' this by migrating whatever database is currently bound — you can create a convincing decoy production DB that way. 2. Confirm the intended `database_id` from `main`'s wrangler.jsonc, redeploy with `pnpm run deploy`, then re-run the probe. 3. Note that previews share production's D1 by design, so a preview worker showing a low count is a config bug, not expected behaviour.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const tables = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      );
      if (tables < TABLE_FLOOR) {
        return failure(
          `Only ${tables} user tables in sqlite_master (floor ${TABLE_FLOOR}). Check the bound database_id and the migration journal.`,
        );
      }
      return ok(`${tables} user tables present (floor ${TABLE_FLOOR})`);
    },
  }),

  defineProbe({
    name: "d1_material_room_fk_orphans",
    displayName: "material_schedule_items → rooms FK integrity",
    description:
      "Counts `material_schedule_items` rows whose `room_id` does not resolve to a `rooms` row. `room_id` is a required NOT NULL FK (the schema explicitly forbids a denormalized room_name), so any orphan is a write path that bypassed the constraint.",
    healthTsFilepath: "src/backend/db/health.ts",
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Every material on the schedule points at a real room. Budget rollups, room pages and takeoffs that JOIN through `room_id` will account for the full material list.",
    whatFailureMeans:
      "Materials exist that belong to no room. They vanish from every room-scoped view and from any budget total computed with an INNER JOIN, so the project looks cheaper and thinner than it is. Historically this shape came from callers inventing a `roomName` and passing a null/placeholder `room_id`.",
    troubleshootingSteps:
      "1. List the offenders: `npx wrangler d1 execute core-remodel --remote --command \"SELECT id, name, room_id FROM material_schedule_items WHERE room_id NOT IN (SELECT id FROM rooms) LIMIT 20\"`. 2. Find the write path — grep for inserts into the table: `grep -rn 'material_schedule_items' src/backend | grep -i insert`. Check none of them pass a room name instead of an id, or coerce a missing id to null. 3. Fix the caller so it REJECTS the request (400) when it cannot supply a real `room_id`; never insert a placeholder or invent a default room. 4. Re-home the orphans through the HITL confirm step rather than guessing which bathroom they belong to.",
    devOpsPlaybook:
      "1. Do not bulk-assign orphans to a room to make the number go to zero — a wrong mapping propagates into budget, takeoffs and comparisons and nothing downstream can tell it was a guess. 2. Stage them for human confirmation, ranked with the evidence for each candidate room. 3. After fixing the write path, ship it and re-run `pnpm run test:pr <n>` to prove the endpoint now 400s instead of writing an orphan.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "material_schedule_items"))) {
        return failure("`material_schedule_items` table is missing — run `pnpm run migrate:remote`");
      }
      const total = await scalar(env.DB, "SELECT COUNT(*) AS c FROM material_schedule_items");
      const orphans = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM material_schedule_items WHERE room_id IS NULL OR room_id NOT IN (SELECT id FROM rooms)",
      );
      if (orphans > 0) {
        return failure(
          `${orphans} of ${total} material_schedule_items rows have a room_id that does not resolve to a rooms row`,
        );
      }
      return ok(`0 orphans across ${total} material_schedule_items rows`);
    },
  }),

  defineProbe({
    name: "kv_cache_round_trip",
    displayName: "KV CACHE read-after-write",
    description:
      "Writes a single tiny key (`__health/cache-probe`, ~40 bytes, 60s TTL) to the `CACHE` KV namespace, reads it back, then deletes it. One put, one get, one delete — the smallest possible proof that KV is writable and not just bound.",
    healthTsFilepath: "src/backend/db/health.ts",
    bindingTypesTested: ["kv"],
    whatSuccessMeans:
      "`CACHE` is bound, accepts writes, and returns them on read from this colo. Cached lookups (geo matches, catalog fragments, rate-limit counters) will behave.",
    whatFailureMeans:
      "Either the namespace is unbound or KV is rejecting writes. Code paths that treat a cache miss as 'no data' will quietly degrade into wrong-but-plausible results rather than errors, which is the dangerous version of this failure.",
    troubleshootingSteps:
      "1. Confirm the binding: check `kv_namespaces` in `wrangler.jsonc` for `CACHE` and that its `id` matches `npx wrangler kv namespace list`. 2. Test outside the worker: `npx wrangler kv key put --remote --namespace-id <id> healthprobe ok` then `npx wrangler kv key get --remote --namespace-id <id> healthprobe`. 3. A read-back MISS immediately after a write is usually eventual consistency across colos — this probe reads its own write in the same request, so a miss here is a real fault, not consistency lag. 4. Redeploy with `pnpm run deploy` if the binding is absent from the live worker.",
    devOpsPlaybook:
      "1. Scope the blast radius by grepping callers: `grep -rn 'env.CACHE' src/backend`. Anything that falls back to a default on miss is now serving defaults. 2. If KV is down account-wide, prefer failing loudly over serving stale defaults — disable the affected cron sweeps rather than letting them write conclusions drawn from empty caches. 3. Re-run this probe after recovery and confirm the delete also succeeded so the probe key is not left behind.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!env.CACHE) return failure("CACHE KV binding is not present on this deployment");
      const key = "__health/cache-probe";
      const token = `probe-${Date.now()}`;
      await env.CACHE.put(key, token, { expirationTtl: 60 });
      const readBack = await env.CACHE.get(key);
      await env.CACHE.delete(key);
      if (readBack !== token) {
        return failure(`KV CACHE read-after-write mismatch: wrote "${token}", read "${readBack}"`);
      }
      return ok(`KV CACHE put/get/delete round trip succeeded (key=${key})`);
    },
  }),

  defineProbe({
    name: "kv_support_namespaces_bound",
    displayName: "KV SESSIONS / OAUTH_KV / AGENT_ADHOC_MEMORY_KV bound",
    description:
      "Checks the three non-cache KV namespaces are attached and answer a bounded `list({ limit: 1 })`. Read-only: no writes into session, OAuth or agent-memory namespaces.",
    healthTsFilepath: "src/backend/db/health.ts",
    bindingTypesTested: ["kv"],
    whatSuccessMeans:
      "Session storage, the MCP OAuth provider's token store, and the agents' ad-hoc memory namespace are all reachable. Login, the `/mcp` connector handshake, and agent scratch memory have their backing store.",
    whatFailureMeans:
      "A missing `SESSIONS` logs everyone out. A missing `OAUTH_KV` breaks the MCP connector entirely — `@cloudflare/workers-oauth-provider` requires it and `/oauth/token`, `/oauth/register` and the `.well-known` metadata all fail, so Claude cannot connect. A missing `AGENT_ADHOC_MEMORY_KV` makes agents forget within a session.",
    troubleshootingSteps:
      "1. The details string names which namespace is absent. 2. Compare `wrangler.jsonc`'s `kv_namespaces` entries against `npx wrangler kv namespace list` — a namespace deleted in the dashboard leaves a valid-looking config entry. 3. Redeploy: `pnpm run deploy` from `main`. 4. For OAUTH_KV specifically, after restoring the binding, re-authorize the connector from claude.ai — existing grants stored in the lost namespace are gone and cannot be recovered.",
    devOpsPlaybook:
      "1. OAUTH_KV loss is user-visible on the connector, not on the site — check `/connect` and the `/mcp` handshake before declaring recovery. 2. Do not repopulate SESSIONS by hand; let users re-authenticate. 3. Confirm all three with this probe and then run `pnpm run test:pr <n>` for any PR touching auth or MCP.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const namespaces: Array<[string, KVNamespace | undefined]> = [
        ["SESSIONS", env.SESSIONS],
        ["OAUTH_KV", env.OAUTH_KV],
        ["AGENT_ADHOC_MEMORY_KV", env.AGENT_ADHOC_MEMORY_KV],
      ];
      const missing: string[] = [];
      const unreadable: string[] = [];
      const counts: string[] = [];
      for (const [name, ns] of namespaces) {
        if (!ns) {
          missing.push(name);
          continue;
        }
        try {
          const listed = await ns.list({ limit: 1 });
          counts.push(`${name}=${listed.keys.length > 0 ? "has keys" : "empty"}`);
        } catch (e) {
          unreadable.push(`${name} (${e instanceof Error ? e.message : String(e)})`);
        }
      }
      if (missing.length > 0) return failure(`KV bindings missing: ${missing.join(", ")}`);
      if (unreadable.length > 0) return failure(`KV namespaces unreadable: ${unreadable.join("; ")}`);
      return ok(`All 3 support KV namespaces bound and listable (${counts.join(", ")})`);
    },
  }),

  defineProbe({
    name: "r2_artifacts_bucket_reachable",
    displayName: "R2 ARTIFACTS_BUCKET reachable",
    description:
      "Lists at most one object from `ARTIFACTS_BUCKET` (`list({ limit: 1 })`) and, when an object exists, issues a single `head()` on it. Two class-B operations, no body transfer, no enumeration.",
    healthTsFilepath: "src/backend/db/health.ts",
    bindingTypesTested: ["r2"],
    whatSuccessMeans:
      "The artifacts bucket is bound and serving metadata. Large payloads that D1 must not hold — MCP conversation transcripts, feature-proposal context blobs, generated documents — can be written and fetched.",
    whatFailureMeans:
      "Offloaded content is unreachable. Feature proposals render without their stored context, exported conversations 404, and any write path that offloads to R2 will either throw or (worse) drop the payload while the D1 pointer row still claims it exists.",
    troubleshootingSteps:
      "1. Check the binding: `r2_buckets` in `wrangler.jsonc` names `ARTIFACTS_BUCKET`; confirm the bucket still exists with `npx wrangler r2 bucket list`. 2. Probe from the CLI: `npx wrangler r2 object get <bucket>/<known-key> --remote --file /dev/null`. 3. If the bucket is empty this probe reports SUCCESS with 'bucket empty' — that is not a fault on a fresh environment, but on production it means nothing has ever been offloaded and is worth investigating separately. 4. Redeploy with `pnpm run deploy` if the binding is missing from the live worker.",
    devOpsPlaybook:
      "1. Identify dangling pointers before restoring: rows in `mcp_conversations` / `changelog_proposals` referencing R2 keys that no longer resolve. 2. Never delete those D1 rows to clean up the error — the pointer is the only evidence the artifact existed. 3. After the binding is restored, re-run this probe and spot-check one known key with `npx wrangler r2 object get`.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!env.ARTIFACTS_BUCKET) {
        return failure("ARTIFACTS_BUCKET R2 binding is not present on this deployment");
      }
      const listed = await env.ARTIFACTS_BUCKET.list({ limit: 1 });
      const first = listed.objects[0];
      if (!first) {
        return ok("ARTIFACTS_BUCKET reachable; bucket is empty (list returned 0 objects)");
      }
      const head = await env.ARTIFACTS_BUCKET.head(first.key);
      if (!head) {
        return degraded(
          `ARTIFACTS_BUCKET listed key "${first.key}" but head() returned null — listing and object store disagree`,
        );
      }
      return ok(`ARTIFACTS_BUCKET reachable; head("${first.key}") returned ${head.size} bytes`);
    },
  }),

  defineProbe({
    name: "d1_write_volume_growth",
    displayName: "D1 write-volume growth sanity (MCP invocation log)",
    description:
      "Compares rows written to `mcp_tool_invocations` in the last 24h against the mean daily rate over the preceding 7 days. This is the highest-frequency append-only table in the schema, so it is the cheapest early warning that something is looping and burning D1 rows-written.",
    healthTsFilepath: "src/backend/db/health.ts",
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Yesterday's write volume is within an order of magnitude of the recent baseline. No runaway loop is hammering D1, and the rows-written line on the Cloudflare bill should look like last week's.",
    whatFailureMeans:
      "Writes jumped more than 10x over the weekly baseline. Something is retrying without a ceiling — a cron firing far more often than intended, an agent looping over a tool call, or a client reconnecting in a tight loop. D1 bills on rows read and written, so this compounds by the hour and is the same failure shape as the Durable Object billing runaway that cost roughly $50/day before it was caught.",
    troubleshootingSteps:
      "1. Find the culprit tool: `npx wrangler d1 execute core-remodel --remote --command \"SELECT tool_name, COUNT(*) c FROM mcp_tool_invocations WHERE created_at > unixepoch()-86400 GROUP BY tool_name ORDER BY c DESC LIMIT 10\"`. 2. Check whether it is one session looping: same query grouped by `session_id`. 3. Look at the worker logs for the same window (`npx wrangler tail`) to see whether the caller is retrying on error. 4. If a cron is responsible, check `system_cron_schedules` for an `enabled` row whose `cron_expression` was widened, and disable it while you investigate.",
    devOpsPlaybook:
      "1. Stop the bleeding first, diagnose second: disable the offending cron row in `system_cron_schedules` or revoke the looping MCP session before hunting the root cause. 2. Check the Cloudflare dashboard's D1 rows-read/rows-written graph to size the exposure in dollars, not just rows. 3. Remember the invoice lags the fix — after the loop stops, expect one more billing period showing the spike. 4. Land a bounded retry (a max attempt count, not just a delay) and note the fix in the changelog entry so the next spike can be compared against this one.",
    isBillingRisk: true,
    severity: "HIGH",
    run: async (env) => {
      if (!(await tableExists(env.DB, "mcp_tool_invocations"))) {
        return failure("`mcp_tool_invocations` table is missing — run `pnpm run migrate:remote`");
      }
      const last24h = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM mcp_tool_invocations WHERE created_at > unixepoch() - 86400",
      );
      const prior7d = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM mcp_tool_invocations WHERE created_at <= unixepoch() - 86400 AND created_at > unixepoch() - 691200",
      );
      const baseline = prior7d / 7;
      if (baseline < 1) {
        return ok(
          `Insufficient baseline to judge growth: last 24h=${last24h}, prior 7d total=${prior7d}`,
        );
      }
      const ratio = last24h / baseline;
      if (ratio > 10) {
        return failure(
          `MCP invocation writes spiked ${ratio.toFixed(1)}x: last 24h=${last24h} vs baseline ${baseline.toFixed(1)}/day (prior 7d=${prior7d}). Suspect a retry loop or a widened cron.`,
        );
      }
      if (ratio > 4) {
        return degraded(
          `MCP invocation writes up ${ratio.toFixed(1)}x: last 24h=${last24h} vs baseline ${baseline.toFixed(1)}/day. Watch it; not yet runaway.`,
        );
      }
      return ok(
        `Write volume normal: last 24h=${last24h} vs baseline ${baseline.toFixed(1)}/day (${ratio.toFixed(1)}x)`,
      );
    },
  }),
];
