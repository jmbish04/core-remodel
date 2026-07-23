import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Plans — one row per planning initiative (the `docs/00NN_*` folders).
 *
 * Powers the `/admin/plans` live progress tracker. Each plan groups a set of
 * `plan_tasks`. Seeded idempotently from `src/backend/db/seeds/seed-plan-tasks.ts`
 * (the canonical source of truth, mirrored to each folder's `TASKS.json`).
 */
export const plans = sqliteTable("plans", {
  /** Stable slug — matches the docs folder name, e.g. "0013_link_cleanup". */
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  /** Repo-relative path to the plan's docs folder. */
  docPath: text("doc_path"),
  /**
   * Which project this plan belongs to (0028). `software` plans are the coding
   * roadmap; `remodel` plans are house-renovation phases. Lets one `/admin/plans`
   * surface carry both, split by domain. Defaulted so every existing plan is
   * `software` without a backfill.
   */
  domain: text("domain", { enum: ["software", "remodel"] })
    .notNull()
    .default("software"),
  status: text("status", { enum: ["planning", "active", "done", "archived"] })
    .notNull()
    .default("planning"),
  /** Plan-level schedule (0028). ISO date (YYYY-MM-DD). Nullable. */
  startDate: text("start_date"),
  targetDate: text("target_date"),
  /** Display order on the overview page (lower = first). */
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Plan = typeof plans.$inferSelect;
export type PlanInsert = typeof plans.$inferInsert;
