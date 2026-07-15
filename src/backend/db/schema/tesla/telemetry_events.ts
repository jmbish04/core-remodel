import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Tesla Fleet Telemetry events — the ~500ms stream Tessie's hosted Fleet
 * Telemetry forwards to us. This table lives in the dedicated `TESLA_DB` D1
 * (NOT the app DB) so the high write rate stays isolated.
 *
 * Each inbound POST becomes one row. Tessie/Tesla telemetry is a set of
 * field/value updates per frame; we keep the full frame in `data` (JSON) and
 * ALSO hoist the handful of fields the drive/automation logic cares about into
 * typed columns so they're queryable/indexable without JSON extraction. Any
 * field not present in a given frame is left null.
 */
export const teslaTelemetryEvents = sqliteTable(
  "tesla_telemetry_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Vehicle VIN the frame is for. */
    vin: text("vin"),

    /** When the frame was produced by the car (from the payload), if provided. */
    eventTs: integer("event_ts", { mode: "timestamp" }),
    /** When we received/persisted it. Drives retention + newest-first reads. */
    receivedAt: integer("received_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    // ── Hoisted common fields (nullable — present only when in the frame) ──
    latitude: real("latitude"),
    longitude: real("longitude"),
    /** Speed (mph, as the car reports). */
    speed: real("speed"),
    /** Gear/shift state: P/R/N/D (or null when not in the frame). */
    shiftState: text("shift_state"),
    /** Battery state of charge, percent. */
    batteryLevel: integer("battery_level"),
    /** Odometer reading (miles). */
    odometer: real("odometer"),

    /** The full telemetry frame as received (JSON-encoded). */
    data: text("data"),
  },
  (table) => ({
    vinIdx: index("tesla_telemetry_vin_idx").on(table.vin),
    receivedIdx: index("tesla_telemetry_received_idx").on(table.receivedAt),
  }),
);

export type TeslaTelemetryEvent = typeof teslaTelemetryEvents.$inferSelect;
export type TeslaTelemetryEventInsert = typeof teslaTelemetryEvents.$inferInsert;
