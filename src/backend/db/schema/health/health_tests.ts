import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Health test catalogue + result ledger (0029).
 *
 * `health_checks` (the 0027 table) recorded five hardcoded binding pings with no
 * description, no runbook and no session grouping — you could see that KV was
 * down but not what "down" meant, where the code lived, or what to do about it.
 *
 * These tables replace that with a catalogue: every probe declares itself in its
 * module's `health.ts` (`services/health/types.ts` → `HealthProbe`), the runner
 * upserts those declarations into `health_test_def` by `name`, and each run
 * writes one `health_results` row per probe stamped with a shared
 * `session_uuid`. So a "session" is one click of Run, one API call, or one MCP
 * invocation — and the whole session is queryable as a unit.
 *
 * `health_checks` is deliberately left alone: `GET /api/health` and any external
 * uptime monitor still read it.
 */

/** Severity of the checked dependency. Not the outcome — that lives on the result row. */
export const HEALTH_SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;

/** Outcome of one probe. DEGRADED = up, but outside its normal envelope. */
export const HEALTH_TEST_RESULTS = ["SUCCESS", "FAILURE", "DEGRADED"] as const;

/**
 * Definition of a single health test — the catalogue row behind every result.
 * Upserted from code on every run, so the runbook can never drift from the probe.
 */
export const healthTestDef = sqliteTable(
  "health_test_def",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stable snake_case identifier, e.g. `d1_core_connectivity`. Natural key. */
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull(),
    /** Repo path of the module `health.ts` that owns this probe. */
    healthTsFilepath: text("health_ts_filepath").notNull(),
    whatSuccessMeans: text("what_success_means").notNull(),
    whatFailureMeans: text("what_failure_means").notNull(),
    troubleshootingSteps: text("troubleshooting_steps").notNull(),
    devOpsPlaybook: text("dev_ops_playbook").notNull(),
    /** True when this probe watches for sudden jumps in Cloudflare / AI spend. */
    isBillingRisk: integer("is_billing_risk", { mode: "boolean" }).notNull().default(false),
    severity: text("severity", { enum: HEALTH_SEVERITIES }).notNull().default("MEDIUM"),
    /** Soft delete — a probe removed from code is deactivated, never dropped (results FK it). */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    nameIdx: uniqueIndex("health_test_def_name_idx").on(t.name),
    activeIdx: index("health_test_def_active_idx").on(t.isActive),
  }),
);

/**
 * The Cloudflare binding-type vocabulary a test can exercise (`d1`, `kv`, `r2`,
 * `vectorize`, `workers_ai`, `durable_object`, `workflow`, `secrets_store`, …).
 *
 * A definition table + mapping table rather than a comma-separated column: the
 * dashboard groups and filters by binding type, which is exactly the multi-select
 * shape the repo rules require to be relational.
 */
export const healthBindingTypes = sqliteTable(
  "health_binding_types",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => ({ nameIdx: uniqueIndex("health_binding_types_name_idx").on(t.name) }),
);

/** Which binding types a given test touches. M:N mapping, one row per pair. */
export const healthTestBindingTypes = sqliteTable(
  "health_test_binding_types",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    healthTestDefId: integer("health_test_def_id")
      .notNull()
      .references(() => healthTestDef.id, { onDelete: "cascade" }),
    healthBindingTypeId: integer("health_binding_type_id")
      .notNull()
      .references(() => healthBindingTypes.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pairIdx: uniqueIndex("health_test_binding_types_pair_idx").on(
      t.healthTestDefId,
      t.healthBindingTypeId,
    ),
    defIdx: index("health_test_binding_types_def_idx").on(t.healthTestDefId),
  }),
);

/**
 * One row per probe per session. Every row written by a single run shares one
 * `session_uuid` and one session `timestamp`, so a session is a `WHERE
 * session_uuid = ?` away and history is `GROUP BY session_uuid`.
 */
export const healthResults = sqliteTable(
  "health_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Session start time — identical across every row of one session. */
    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    /** Shared across every row produced by one Run click / API call / MCP call. */
    sessionUuid: text("session_uuid").notNull(),
    healthTestDefId: integer("health_test_def_id")
      .notNull()
      .references(() => healthTestDef.id),
    healthTestResult: text("health_test_result", { enum: HEALTH_TEST_RESULTS }).notNull(),
    healthTestResultDetails: text("health_test_result_details"),
    /** How long this probe took, ms. Cheap to record, and latency drift is a signal. */
    durationMs: integer("duration_ms"),
    /** Who ran it: `ui`, `api`, `mcp`, `cron`. */
    triggeredBy: text("triggered_by").notNull().default("api"),
  },
  (t) => ({
    sessionIdx: index("health_results_session_idx").on(t.sessionUuid),
    timestampIdx: index("health_results_timestamp_idx").on(t.timestamp),
    defIdx: index("health_results_def_idx").on(t.healthTestDefId, t.timestamp),
  }),
);
