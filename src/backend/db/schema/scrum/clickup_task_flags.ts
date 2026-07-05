import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * AI-generated and algorithmic flags attached to ClickUp tasks.
 * Written by the RemodelOrchestrator agent during its audit cycle.
 *
 * Flag types:
 * - AI_AUDIT:            Workers AI detected missing detail (vendor, dimensions, SKU, budget)
 * - CRITICAL_PATH:       Task is on the critical path and any delay shifts the end date
 * - OVERDUE:             Task is past its due date
 * - DEPENDENCY_BLOCKED:  Upstream dependency is incomplete
 */
export const clickupTaskFlags = sqliteTable("clickup_task_flags", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** The ClickUp task ID this flag is attached to. */
  clickupTaskId: text("clickup_task_id").notNull(),

  /** AI_AUDIT | CRITICAL_PATH | OVERDUE | DEPENDENCY_BLOCKED */
  flagType: text("flag_type").notNull(),

  /** Severity: info | warning | critical */
  severity: text("severity").notNull().default("warning"),

  /** Human-readable explanation (from AI or algorithm). */
  message: text("message").notNull(),

  /** The audit run ID that generated this flag. */
  auditRunId: text("audit_run_id"),

  /** false = active, true = dismissed by user or resolved by re-audit. */
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),

  /** When the flag was resolved. */
  resolvedAt: text("resolved_at"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
