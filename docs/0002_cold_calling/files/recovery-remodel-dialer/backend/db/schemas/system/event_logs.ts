import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * D1 mirrored logging layer — every write that goes through the API also
 * lands here, per the cloudflare-jedi convention (D1 mirrored logging on
 * every service). Never swallow errors silently.
 */
export const eventLogs = sqliteTable("event_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  level: text("level").notNull().default("info"), // info | warn | error
  scope: text("scope").notNull(), // route / action name
  message: text("message").notNull(),
  meta: text("meta"), // JSON string
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});
