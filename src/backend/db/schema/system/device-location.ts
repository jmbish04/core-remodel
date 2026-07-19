import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Device Location — the last-known position of the homeowner's devices.
 *
 * The showroom directory (and any other client) reports the browser's granted
 * geolocation here so server-side agents can answer "what's near me?" without a
 * live device round-trip. One row per report, newest-first; the getUserLocation
 * MCP tool reads the most recent `browser`/`phone` fix and combines it with the
 * live Tesla GPS (which is fetched on demand from Tessie, not stored here).
 *
 * `source` distinguishes where a fix came from:
 *   - "browser" — the web app's `navigator.geolocation` (phone or laptop).
 *   - "phone"   — a dedicated phone reporter, if/when one exists.
 *   - "manual"  — a coordinate the user entered by hand.
 * Live Tesla GPS is intentionally NOT persisted here (it's queried fresh).
 */
export const deviceLocation = sqliteTable(
  "device_location",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Where this fix came from: "browser" | "phone" | "manual". */
    source: text("source").notNull().default("browser"),

    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),

    /** Reported accuracy radius in meters, when the device provides it. */
    accuracyMeters: real("accuracy_meters"),

    /** Optional reverse-geocoded / human label for the fix. */
    address: text("address"),

    /** When the fix was captured/reported. Drives newest-first reads + retention. */
    capturedAt: integer("captured_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sourceIdx: index("device_location_source_idx").on(table.source),
    capturedIdx: index("device_location_captured_idx").on(table.capturedAt),
  }),
);

export type DeviceLocation = typeof deviceLocation.$inferSelect;
export type DeviceLocationInsert = typeof deviceLocation.$inferInsert;
