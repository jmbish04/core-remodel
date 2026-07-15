import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Tesla / Tessie webhook + Fleet API events — discrete state-change notifications
 * (drive state, charging, parked, software update, etc.) as opposed to the
 * continuous telemetry stream. Also in `TESLA_DB`.
 *
 * We persist every inbound webhook verbatim (`data` JSON) plus a few routing
 * fields, so the automation layer and any later backfill can replay them. The
 * drive-list auto-visit logic reads live drive stops from the app DB but records
 * the triggering event here.
 */
export const teslaWebhookEvents = sqliteTable(
  "tesla_webhook_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Vehicle VIN, when the payload carries one. */
    vin: text("vin"),

    /** Coarse event type parsed from the payload (e.g. "drive_state", "parked"). */
    eventType: text("event_type"),

    /** Latitude/longitude if the event carried a position (e.g. a park event). */
    latitude: real("latitude"),
    longitude: real("longitude"),

    /** Outcome of any auto-visit match this event triggered (JSON), else null. */
    matchResult: text("match_result"),

    /** The full webhook payload as received (JSON-encoded). */
    data: text("data"),

    receivedAt: integer("received_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    vinIdx: index("tesla_webhook_vin_idx").on(table.vin),
    typeIdx: index("tesla_webhook_type_idx").on(table.eventType),
    receivedIdx: index("tesla_webhook_received_idx").on(table.receivedAt),
  }),
);

export type TeslaWebhookEvent = typeof teslaWebhookEvents.$inferSelect;
export type TeslaWebhookEventInsert = typeof teslaWebhookEvents.$inferInsert;
