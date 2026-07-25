import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { showroomStores } from "../showroom/stores";
import { driveLists } from "./drive_lists";

/**
 * Drive List Stops — one showroom stop on a drive list.
 *
 * Denormalized on purpose: the display fields (`name`, `city`, `address`, …)
 * are copied onto the row so the drive viewport renders the whole sheet from a
 * single table read (mirroring the self-contained artifact route sheet), and so
 * a stop survives even if its source showroom is later edited/removed.
 *
 * `showroomStoreId` links back to the registered showroom (`showroom_stores`)
 * when the stop is one — this is what lets the coverage-analysis MCP tools
 * cross-reference a stop's drive check-off against the showroom's real visit
 * signal (its denormalized latest-visit `rating`), i.e. "was this stop skipped
 * on the drive but the showroom visited later?"
 *
 * `visited` is the drive's own check-off (toggled in the viewport, persisted
 * here), and is what the landing-page completion bar counts.
 */
export const driveListStops = sqliteTable(
  "drive_list_stops",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    driveListId: integer("drive_list_id")
      .notNull()
      .references(() => driveLists.id, { onDelete: "cascade" }),

    /** Optional link to the registered showroom this stop represents. */
    showroomStoreId: integer("showroom_store_id").references(() => showroomStores.id, {
      onDelete: "set null",
    }),

    /** Ordering within the drive (ascending). */
    sortOrder: integer("sort_order").notNull().default(0),

    /** Leg / cluster label (e.g. "West Berkeley → Oakland"). Groups stops. */
    leg: text("leg"),
    /** Optional time window for the leg (e.g. "morning · via Hwy 24"). */
    legWindow: text("leg_window"),

    // ── Denormalized display fields ───────────────────────────────────────
    name: text("name").notNull(),
    city: text("city"),
    address: text("address"),
    phone: text("phone"),
    hours: text("hours"),
    /** Why this stop is on the list / what to look for. */
    note: text("note"),
    /** Optional "research pick / detour" label (renders as a pick chip). */
    pick: text("pick"),
    websiteUrl: text("website_url"),
    latitude: real("latitude"),
    longitude: real("longitude"),

    /** true = optional "research pick"; false = core numbered stop. */
    isOptional: integer("is_optional", { mode: "boolean" }).notNull().default(false),

    /**
     * Stop classification. `core` = numbered stop; `optional` = an AI research
     * pick (mirrors `isOptional=true`, kept in sync); `pitstop` = a
     * system-suggested proximity stop (0031 Phase D). Backfilled from
     * `isOptional` on migration.
     */
    kind: text("kind", { enum: ["core", "optional", "pitstop"] })
      .notNull()
      .default("core"),

    /**
     * A pitstop suggestion the user has NOT yet promoted. `true` rows render
     * minimized and are excluded from progress, timing, and the map until the
     * user adds them to the drive (which flips this to `false`). Always `false`
     * for core/optional stops.
     */
    suggested: integer("suggested", { mode: "boolean" }).notNull().default(false),

    /** The drive's check-off — counts toward completion. */
    visited: integer("visited", { mode: "boolean" }).notNull().default(false),
    visitedAt: integer("visited_at", { mode: "timestamp" }),

    /** User skipped this stop on the drive — renders minimized + struck; excluded from progress. */
    skipped: integer("skipped", { mode: "boolean" }).notNull().default(false),
    skippedAt: integer("skipped_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    driveIdx: index("drive_list_stops_drive_idx").on(table.driveListId),
    showroomIdx: index("drive_list_stops_showroom_idx").on(table.showroomStoreId),
  }),
);

export type DriveListStop = typeof driveListStops.$inferSelect;
export type DriveListStopInsert = typeof driveListStops.$inferInsert;
