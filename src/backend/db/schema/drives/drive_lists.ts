import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Showroom Drive Lists — a planned day of showroom stops ("drive sheets").
 *
 * A drive list is the durable, D1-backed version of the hand-built route sheet
 * (see the "East Bay Stone Run" Studio artifact): an ordered set of showroom
 * stops grouped into legs/cities, each with a check-off state so progress
 * (visited vs. not) is tracked as you drive. The landing page at
 * `/admin/shopping/drives` lists these newest-first with a completion bar;
 * clicking one opens the drive viewport (`/admin/shopping/drives/<slug>`).
 *
 * Rows are created via the `create_drive_list` MCP tool (from a chat) and read
 * by both the frontend and the coverage-analysis MCP tools. The stop rows live
 * in `drive_list_stops`, keyed back here.
 */
export const driveLists = sqliteTable(
  "drive_lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** URL slug — unique, used in `/admin/shopping/drives/<slug>`. */
    slug: text("slug").notNull(),

    title: text("title").notNull(),
    description: text("description"),

    /**
     * Optional planning notes — a JSON-encoded array of note strings, each
     * rendered as its own full-width card in the drive viewport. Read/written
     * via `parseDriveNotes`/`serializeDriveNotes` (legacy rows hold one freeform
     * chunk and are split on blank lines on read).
     */
    notes: text("notes"),

    /** Lifecycle label: draft → active (drivable) → completed → archived. */
    status: text("status", { enum: ["draft", "active", "completed", "archived"] })
      .notNull()
      .default("active"),

    /**
     * THE active drive — at most one row in the table may have this true, which
     * the partial unique index below enforces in D1 itself (not just in app
     * code). This is what admin devices auto-land on (`getActiveDriveSlug`) and
     * what the landing page badges + toggles. Separate from `status` on purpose:
     * `status` is a lifecycle label and several drives can legitimately share a
     * value, while "active" is a single-slot pointer.
     */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),

    /** Freeform note on where this came from (the chat context). */
    sourceConversation: text("source_conversation"),

    /** "date registered" — drives the newest-first landing order. */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    slugUniq: uniqueIndex("drive_lists_slug_uniq").on(table.slug),
    statusIdx: index("drive_lists_status_idx").on(table.status),
    createdIdx: index("drive_lists_created_idx").on(table.createdAt),
    // Partial unique index: at most ONE row with is_active = 1. A second
    // activation must clear the first in the same batch or D1 rejects it.
    singleActive: uniqueIndex("drive_lists_single_active_uniq")
      .on(table.isActive)
      .where(sql`${table.isActive} = 1`),
  }),
);

export type DriveList = typeof driveLists.$inferSelect;
export type DriveListInsert = typeof driveLists.$inferInsert;
