import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";

export const googleMapsUsage = sqliteTable("google_maps_usage_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  apiType: text("api_type").notNull(), // e.g., 'places', 'routes'
  apiRequest: text("api_request", { mode: "json" }).notNull(),
  apiResponse: text("api_response", { mode: "json" }).notNull(),
});

export const GOOGLE_MAPS_USAGE_TABLE_DESCRIPTION =
  "Append-only log tracking every usage event of Google Maps APIs to ensure we stay within the $200 free tier.";
export const GOOGLE_MAPS_USAGE_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "Unique identifier for the usage event.",
  timestamp: "Timestamp when the API was called.",
  api_type: "The specific API or endpoint called (e.g., 'places', 'routes').",
  api_request: "The JSON payload or query parameters sent to the API.",
  api_response: "The JSON response payload received from the API.",
};
