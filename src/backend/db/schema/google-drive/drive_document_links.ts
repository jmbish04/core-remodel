import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { supportingDocuments } from "../documents/supporting_documents";
import { driveDocuments } from "./drive_documents";

/**
 * Bridge for the rare Drive file that IS a micro-level record — a signed
 * contract or tech sheet that happens to live in Drive. Keeps `drive_documents`
 * from being a silo without collapsing the two libraries into one table.
 */
export const driveDocumentLinks = sqliteTable(
  "drive_document_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    driveDocumentId: integer("drive_document_id")
      .notNull()
      .references(() => driveDocuments.id, { onDelete: "cascade" }),
    supportingDocumentId: text("supporting_document_id")
      .notNull()
      .references(() => supportingDocuments.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    linkUnique: uniqueIndex("drive_document_link_unique").on(
      t.driveDocumentId,
      t.supportingDocumentId,
    ),
  }),
);

export type DriveDocumentLink = typeof driveDocumentLinks.$inferSelect;
export type DriveDocumentLinkInsert = typeof driveDocumentLinks.$inferInsert;
