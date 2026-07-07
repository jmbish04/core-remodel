import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { companies } from "./companies";

/**
 * Freeform notes attached to a company (CRM roadmap P3-03).
 */
export const companyNotes = sqliteTable(
  "company_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(), // JSON string of PlateJS Slate nodes
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    /** JSON string[] of free-form tags — selected/created via the note editor's multi-select. */
    tagsJson: text("tags_json"),
  },
  (t) => ({
    byCompanyId: index("idx_company_notes_company_id").on(t.companyId),
  }),
);

export type CompanyNote = typeof companyNotes.$inferSelect;
export type CompanyNoteInsert = typeof companyNotes.$inferInsert;
