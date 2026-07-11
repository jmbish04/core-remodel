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

    /** Optional freeform planning notes for the day. */
    notes: text("notes"),

    /** Lifecycle: draft → active (drivable) → completed → archived. */
    status: text("status", { enum: ["draft", "active", "completed", "archived"] })
      .notNull()
      .default("active"),

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
  }),
);

export type DriveList = typeof driveLists.$inferSelect;
export type DriveListInsert = typeof driveLists.$inferInsert;
