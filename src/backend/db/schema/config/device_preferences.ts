import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Per-device preferences. The app has no user accounts, so a device (identified
 * by the `remodel_device` cookie — a random uuid) IS the unit of preference.
 *
 * Currently holds the default landing page: the in-app path the app root (`/`)
 * redirects an authed device to (set from `/admin/config/device`). Read by the
 * Worker at the root (see `src/_worker.ts`).
 */
export const devicePreferences = sqliteTable("device_preferences", {
  /** The `remodel_device` cookie value (uuid). */
  deviceId: text("device_id").primaryKey(),

  /** Chosen default landing path (absolute in-app path), or null = home/no redirect. */
  landingPath: text("landing_path"),

  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type DevicePreference = typeof devicePreferences.$inferSelect;
export type DevicePreferenceInsert = typeof devicePreferences.$inferInsert;
