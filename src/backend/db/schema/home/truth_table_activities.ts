import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Truth Table — granular construction activity catalog.
 * One row per "atomic" scope item (e.g. "demo non-load-bearing wall").
 * Costs stored as cents-per-unit so we can scale to any SF/LF/EA count.
 *
 * Revision chain: trackId is the stable identity across revisions.
 * Updates write a new row (revisionNumber + 1, isActive=true) and flip the
 * previous row's isActive=false + replacedByActivityId pointer.
 */
export const truthTableActivities = sqliteTable(
  "truth_table_activities",
  {
    id: text("id").primaryKey(),
    trackId: text("track_id").notNull(),
    revisionNumber: integer("revision_number").notNull().default(1),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    replacedByActivityId: text("replaced_by_activity_id"),
    replacedAt: integer("replaced_at", { mode: "timestamp" }),

    trade: text("trade").notNull(),
    phase: text("phase").notNull(),
    scopeKey: text("scope_key").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    scopeKeywords: text("scope_keywords"),

    unit: text("unit").notNull(),
    baselineLaborCentsPerUnit: integer("baseline_labor_cents_per_unit")
      .notNull()
      .default(0),
    baselineMaterialCentsPerUnit: integer("baseline_material_cents_per_unit")
      .notNull()
      .default(0),
    baselineEquipmentCentsPerUnit: integer("baseline_equipment_cents_per_unit")
      .notNull()
      .default(0),
    marketAdjustmentPct: real("market_adjustment_pct").notNull().default(0),
    insuranceBaselineCentsPerUnit: integer("insurance_baseline_cents_per_unit"),
    notes: text("notes"),

    isFinal: integer("is_final", { mode: "boolean" }).notNull().default(false),
    vendorName: text("vendor_name"),

    sourceType: text("source_type").notNull().default("manual"),
    sourceRef: text("source_ref"),
    confidenceScore: real("confidence_score").default(0.7),
    embeddingId: text("embedding_id"),

    changeSource: text("change_source").notNull().default("manual"),
    changedBy: text("changed_by"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byScopeKey: index("idx_tta_scope_key").on(t.scopeKey),
    byTrade: index("idx_tta_trade").on(t.trade),
    byPhase: index("idx_tta_phase").on(t.phase),
    activeTrackUnique: uniqueIndex("ux_tta_track_revision").on(
      t.trackId,
      t.revisionNumber,
    ),
  }),
);

export type TruthTableActivity = typeof truthTableActivities.$inferSelect;
export type TruthTableActivityInsert = typeof truthTableActivities.$inferInsert;
