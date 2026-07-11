// src/backend/db/schema/config/colors.ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Colors — shared vocabulary for the config-driven multi-select pattern
 * (AGENTS.md "Multi-select & config-driven definitions"). `hexCode` powers a
 * `[▧] Name` swatch in the multi-select UI and the color picker shown when a
 * user creates an "Other" option.
 *
 * Seeded values (0020-C2): White, Black, Matte Black, Chrome, Brushed Nickel,
 * Polished Nickel, Brass, Brushed Gold, Bronze, Stainless, Gray, Beige, Navy,
 * White Oak, Walnut.
 */
export const colors = sqliteTable("colors", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Display name, e.g. "Brushed Nickel". */
  name: text("name").notNull(),

  /** Optional prose describing the color / finish. */
  description: text("description"),

  /** Hex swatch, e.g. "#A5A5A5". Nullable — not every color has a fixed swatch. */
  hexCode: text("hex_code"),

  /** Soft-delete flag — retire a color without breaking existing mappings. */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Color = typeof colors.$inferSelect;
export type ColorInsert = typeof colors.$inferInsert;
