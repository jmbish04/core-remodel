import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Key-value store for global project variables (budget cap, active scenario, framing credit %, etc.).
 * Sourced from TSV rows 12-16.
 */
export const projectSystemVariables = sqliteTable("project_system_variables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  variableKey: text("variable_key").notNull().unique(),
  valueText: text("value_text").notNull(),
  unit: text("unit"),
  category: text("category"),
  description: text("description"),
  mappingRefKey: text("mapping_ref_key").notNull().unique(),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ProjectSystemVariable = typeof projectSystemVariables.$inferSelect;
export type ProjectSystemVariableInsert = typeof projectSystemVariables.$inferInsert;
