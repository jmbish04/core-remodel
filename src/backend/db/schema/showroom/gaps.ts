import { sql } from "drizzle-orm";
import { index, uniqueIndex, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Showroom Gaps — AI-detected coverage gaps surfaced per context.
 *
 * "Something you should be tracking / sourcing / covering but aren't":
 *   - context "material"  → implied-but-missing material siblings
 *                           (log "closet" → suggest closet system, lighting, island)
 *   - context "product"   → materials with no sourced products
 *   - context "showroom"  → material/product types with no showroom coverage
 *
 * Lifecycle: open → dismissed (never resurfaced) → researching → closed.
 * Detection upserts by (context, gapKey); dismissed/closed keys are never
 * re-opened so a re-analyze won't resurface them.
 */
export const showroomGaps = sqliteTable(
  "showroom_gaps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    context: text("context").notNull(), // material | product | showroom
    /** Stable identity for dedupe + never-resurface (e.g. "material:closet lighting"). */
    gapKey: text("gap_key").notNull(),

    /** Canonical room this gap targets (AI-disambiguated by floor). roomName is a display cache. */
    roomId: integer("room_id"),
    roomName: text("room_name"),
    name: text("name").notNull(),
    description: text("description"),
    suggestedAction: text("suggested_action"),

    /** JSON snapshot of the signal that triggered this gap (inputs, rationale). */
    sourceSignalJson: text("source_signal_json"),

    status: text("status").notNull().default("open"), // open | dismissed | researching | closed

    /** Material record created when this gap is sent to research (plain column). */
    materialId: integer("material_id"),
    /** Sourcing sweep session triggered for this gap (plain column). */
    sweepSessionId: integer("sweep_session_id"),

    identifiedAt: integer("identified_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    dismissedAt: integer("dismissed_at", { mode: "timestamp" }),
    closedAt: integer("closed_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    ctxKeyIdx: uniqueIndex("showroom_gaps_ctx_key_idx").on(table.context, table.gapKey),
    statusIdx: index("showroom_gaps_status_idx").on(table.status),
  })
);

export type ShowroomGap = typeof showroomGaps.$inferSelect;
export type ShowroomGapInsert = typeof showroomGaps.$inferInsert;
