import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Catalog of billable services (labor, design, consulting, etc.) offered
 * outside the materials/products catalog. Estimates that bill a service
 * rather than a physical material line item (e.g. "Architect consultation
 * - hourly", "Project management fee", "Permit expediting") reference a
 * row here via `estimate_line_items.service_id`. `defaultUnitCost` is a
 * starting point for new line items and is not authoritative once a line
 * item has been created — the line item owns its own unit cost.
 */
export const services = sqliteTable(
  "services",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"), // free-text tag, e.g. "labor" | "design" | "consulting"
    defaultUnitCost: real("default_unit_cost"),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byName: index("idx_services_name").on(t.name),
    byIsArchived: index("idx_services_is_archived").on(t.isArchived),
  }),
);

export type Service = typeof services.$inferSelect;
export type ServiceInsert = typeof services.$inferInsert;
