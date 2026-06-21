import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Primary Bathroom shower micro-variances (A1-F2 grid + Steam/Smart add-ons) from the TSV file.
 * Handles structural approaches (curbless vs mud bed vs step-up) and plumbing configurations.
 */
export const assumptionMicroVariances = sqliteTable(
  "assumption_micro_variances",
  {
    id: text("id").primaryKey(),
    scenarioLetter: text("scenario_letter"),              // "A", "B", "C", "D", "E", "F"
    variantNumber: integer("variant_number"),              // 1 (dual rainhead) or 2 (single)
    wallPosition: text("wall_position"),                   // "center" (A-C: reclaimed footprint) or "side" (D-F: no relocation)
    floorType: text("floor_type"),                         // "curbless_drop_box", "no_pan_mud_bed", "step_up_curb"
    plumbingType: text("plumbing_type"),                   // "dual_rainhead", "single_rainhead"
    isAddon: integer("is_addon", { mode: "boolean" }).notNull().default(false),
    addonCategory: text("addon_category"),                 // "steam", "smart", or NULL
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
    byScenario: index("idx_amv_scenario").on(t.scenarioLetter),
    byAddon: index("idx_amv_addon").on(t.isAddon, t.addonCategory),
    byWallPosition: index("idx_amv_wall_position").on(t.wallPosition),
  }),
);

export type AssumptionMicroVariance = typeof assumptionMicroVariances.$inferSelect;
export type AssumptionMicroVarianceInsert = typeof assumptionMicroVariances.$inferInsert;
