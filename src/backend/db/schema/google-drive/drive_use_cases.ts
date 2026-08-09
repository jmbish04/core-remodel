import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * What an ingested Drive root is FOR. Config-driven definition table per
 * AGENTS.md, so the UI and API can list and describe use cases without a
 * deploy.
 *
 * `key` is the stable join to a CODE-side processor registry: a use case
 * selects which downstream pipeline runs, and a database row alone cannot add
 * a code path. Adding a use case = one row here + one registry entry.
 */
export const driveUseCases = sqliteTable("drive_use_cases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** EMAIL_ONBOARDING_MATERIALS | DEEP_RESEARCH_FINDINGS */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type DriveUseCase = typeof driveUseCases.$inferSelect;
export type DriveUseCaseInsert = typeof driveUseCases.$inferInsert;
