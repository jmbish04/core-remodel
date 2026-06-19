import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Room-grouped budget assumptions from the TSV file.
 * Stores min/avg/max cost ranges and phase tags (Phase 1 vs Phase 2).
 */
export const assumptionLineItems = sqliteTable(
  "assumption_line_items",
  {
    id: text("id").primaryKey(),
    sectionName: text("section_name").notNull(),
    itemDescription: text("item_description").notNull(),
    minCost: real("min_cost"),
    avgCost: real("avg_cost"),
    maxCost: real("max_cost"),
    phaseTag: text("phase_tag"),
    variantRiskNotes: text("variant_risk_notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceRow: integer("source_row"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    bySection: index("idx_ali_section").on(t.sectionName),
    byPhaseTag: index("idx_ali_phase_tag").on(t.phaseTag),
  }),
);

export type AssumptionLineItem = typeof assumptionLineItems.$inferSelect;
export type AssumptionLineItemInsert = typeof assumptionLineItems.$inferInsert;
