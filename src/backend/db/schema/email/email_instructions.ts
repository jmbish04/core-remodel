import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The reusable vendor-email boilerplate/guidance the composing agent reads and
 * folds into a message. AGENTS.md-style prose, NOT a mail-merge template.
 *
 * Single active row (id = 1 by convention). Stored as markdown (canonical, the
 * portable source) + html (the render cache), matching the repo's rich-text
 * storage rule. This is prose guidance, so markdown is the right canonical form
 * here — unlike a formatted email body, which the Workspace worker owns.
 */
export const emailInstructions = sqliteTable("email_instructions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instructionsMarkdown: text("instructions_markdown").notNull().default(""),
  instructionsHtml: text("instructions_html").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type EmailInstructions = typeof emailInstructions.$inferSelect;
export type EmailInstructionsInsert = typeof emailInstructions.$inferInsert;
