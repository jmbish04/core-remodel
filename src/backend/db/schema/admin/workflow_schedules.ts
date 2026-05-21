import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Runtime-mutable cron schedule registry for admin-controlled Cloudflare Workflows.
 *
 * `cronExpression` is a 5-field cron string (e.g. "* / 15 * * * *"). The static
 * `* * * * *` master-tick in wrangler.jsonc reads this table each minute and fires
 * any rows whose `enabled = true AND nextRunAt <= now`. Editing rules from the
 * admin panel (`PATCH /api/admin/workflows/schedules/:jobKey`) recomputes
 * `nextRunAt` immediately so the new cadence is in effect on the next tick.
 *
 * `jobKey` maps to a specific Workflow binding in `workflow-dispatcher.ts`:
 *   - "checklist_rationale" → env.CHECKLIST_RATIONALE_WORKFLOW
 */
export const systemCronSchedules = sqliteTable("system_cron_schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobKey: text("job_key").notNull().unique(),
  cronExpression: text("cron_expression").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  nextRunAt: integer("next_run_at", { mode: "timestamp" }),
  description: text("description"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedBy: text("updated_by"),
});

/**
 * Per-invocation audit row for every Workflow execution (both cron-fired and
 * admin-triggered). The admin panel reads the most-recent rows to render run
 * history and pivots live-stream events off `workflowInstanceId`.
 *
 * `summaryJson` carries arbitrary post-run metadata (counts, model used, etc.).
 */
export const workflowRunHistory = sqliteTable("workflow_run_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobKey: text("job_key").notNull(),
  workflowInstanceId: text("workflow_instance_id").notNull(),
  triggerSource: text("trigger_source").notNull(), // cron | manual_admin
  status: text("status").notNull().default("queued"), // queued | running | success | failed
  startedAt: integer("started_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  errorMessage: text("error_message"),
  summaryJson: text("summary_json"),
});
