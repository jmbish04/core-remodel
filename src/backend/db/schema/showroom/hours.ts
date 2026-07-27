import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { showroomStoreLocations } from "./store_location";
import { showroomStores } from "./stores";

/**
 * Showroom Store Hours — normalized per-day opening hours.
 *
 * ONE ROW PER OPEN DAY. A day with no row is CLOSED. These rows are the
 * QUERYABLE/DERIVED form the API serves and the frontend uses to compute
 * open/closed status, "closes 5pm", weekend availability, and filtering.
 *
 * The WRITE source of truth is `showroom_stores.hours_json` — callers of the
 * API / MCP tools send only that structured blob; the worker derives these
 * rows (and `is_open_weekends`) from it automatically. The old free-text
 * `weekday_hours` / `weekend_hours` columns have been removed.
 *
 * Times are stored as 24-HOUR integers (`openHour` 0–23, `openMinute` 0–59,
 * etc.) so all status/filter math is trivial; the frontend formats to 12-hour
 * "8:00 AM" on display. These are daytime-business hours: `close` is assumed
 * to be LATER than `open` on the same day — overnight windows that wrap past
 * midnight are not modeled (no showroom in scope operates past midnight), and
 * the status helpers intentionally do not handle wrapping.
 */
export const showroomStoreHours = sqliteTable(
  "showroom_store_hours",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → showroom_stores.id; deletes cascade so orphan rows are cleaned up. */
    showroomId: integer("showroom_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /**
     * Optional FK → showroom_store_locations.id (plan 0031, 1:many). Hours can be
     * brand-wide (locationId null) OR specific to one physical site — a chain's SF
     * store keeps different hours than its Belmont store. Both FKs are kept on
     * purpose (extra-cautious): store_id groups a brand's hours, location_id pins
     * the exact site. Nullable so existing brand-level rows are unaffected.
     */
    locationId: integer("location_id").references(() => showroomStoreLocations.id, {
      onDelete: "cascade",
    }),

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
    // At most one window per (showroom, location, day). Brand-wide rows have a
    // null locationId; per-site rows pin a location. Writers replace-all per scope.
    showroomLocationDayUnique: uniqueIndex("showroom_hours_store_location_day_unique").on(
      table.showroomId,
      table.locationId,
      table.day,
    ),
  }),
);
