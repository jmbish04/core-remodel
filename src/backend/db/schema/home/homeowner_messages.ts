import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Broadcast notes from homeowners to contractors.
 */
export const homeownerMessages = sqliteTable("homeowner_messages", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  author: text("author").notNull().default("Homeowner"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
