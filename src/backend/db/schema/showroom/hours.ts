import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";

/**
 * Showroom Hours — normalized per-day opening hours.
 *
 * ONE ROW PER OPEN DAY. A day with no row is CLOSED. This replaces the old
 * free-text `weekdayHours`/`weekendHours` summaries (and the `hoursJson` blob)
 * as the source of truth the API serves and the frontend uses to compute
 * open/closed status, "closes 5pm", weekend availability, and filtering.
 *
 * Times are stored as 24-HOUR integers (`openHour` 0–23, `openMinute` 0–59,
 * etc.) so all status/filter math is trivial; the frontend formats to 12-hour
 * "8:00 AM" on display. A store open past midnight can have `closeHour` <
 * `openHour` (consumers treat that as wrapping to the next day if needed).
 */
export const showroomHours = sqliteTable(
  "showroom_hours",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → showroom_stores.id; deletes cascade so orphan rows are cleaned up. */
    showroomId: integer("showroom_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /** Day of week this window applies to (one row per open day). */
    day: text("day", {
      enum: [
        "MONDAY",
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
        "SATURDAY",
        "SUNDAY",
      ],
    }).notNull(),

    /** Opening time — 24-hour clock. `openHour` 0–23, `openMinute` 0–59. */
    openHour: integer("open_hour").notNull(),
    openMinute: integer("open_minute").notNull().default(0),

    /** Closing time — 24-hour clock. `closeHour` 0–23, `closeMinute` 0–59. */
    closeHour: integer("close_hour").notNull(),
    closeMinute: integer("close_minute").notNull().default(0),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    // At most one window per (showroom, day) — writers replace-all per store.
    showroomDayUnique: uniqueIndex("showroom_hours_showroom_day_unique").on(
      table.showroomId,
      table.day,
    ),
  }),
);
