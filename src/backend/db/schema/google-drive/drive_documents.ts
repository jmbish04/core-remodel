import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { driveFolders } from "./drive_folders";
import { driveRoots } from "./drive_roots";

/**
 * One file in an ingested tree — ONE table for every use case.
 *
 * DELIBERATELY SEPARATE from `supporting_documents`. That table means records
 * about specific purchased things (owner's manuals, tech sheets, signed
 * contracts, drawings) tied to a product, room or scenario. Drive material is
 * high-level and changes on a different clock. Keeping the boundary in the
 * schema beats a `tier` column every future query has to remember to filter.
 * The rare Drive file that IS such a record is linked via
 * `drive_document_links`.
 *
 * Extraction columns are populated by PR 3, not by the ingestion service.
 */
export const driveDocuments = sqliteTable(
  "drive_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    driveId: text("drive_id").notNull(),
    rootId: integer("root_id")
      .notNull()
      .references(() => driveRoots.id, { onDelete: "cascade" }),
    folderId: integer("folder_id")
      .notNull()
      .references(() => driveFolders.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    /** NULL for Google-native files — Drive reports no size for them. */
    sizeBytes: integer("size_bytes"),

    /**
     * Change-detection hash. Drive's md5 for binaries; for Google-native files
     * Drive returns NO md5Checksum, so this is a sha-256 of the exported text.
     * `hashSource` records which, so a hash is never compared across kinds.
     */
    contentHash: text("content_hash").notNull(),
    /** 'drive_md5' | 'exported_text' | 'metadata' */
    hashSource: text("hash_source").notNull(),

    webViewUrl: text("web_view_url").notNull(),
    sharing: text("sharing").notNull().default("PRIVATE"),
    driveModifiedAt: integer("drive_modified_at", { mode: "timestamp" }),
    driveCreatedAt: integer("drive_created_at", { mode: "timestamp" }),

    /** ── PR 3 (research indexing) populates these. ── */
    extractedText: text("extracted_text"),
    /** pending | processing | complete | failed | skipped */
    extractionStatus: text("extraction_status").notNull().default("pending"),
    extractionError: text("extraction_error"),
    /** Vectorize id. Vectorize caps ids at 64 bytes. */
    ragUuid: text("rag_uuid"),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    supersededById: integer("superseded_by_id").references(
      (): AnySQLiteColumn => driveDocuments.id,
      { onDelete: "set null" },
    ),
    revisionNumber: integer("revision_number").notNull().default(1),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byRootActive: index("drive_documents_root_active_idx").on(t.rootId, t.isActive),
    byFolder: index("drive_documents_folder_idx").on(t.folderId),
    byDriveId: index("drive_documents_drive_id_idx").on(t.driveId),
    byHash: index("drive_documents_content_hash_idx").on(t.contentHash),
    /** Walking a supersede chain backwards was a table scan without this. */
    bySupersededBy: index("drive_documents_superseded_by_idx").on(t.supersededById),
    /**
     * At most ONE live row per Drive id per root — see the same index on
     * `drive_folders`. A duplicate active row is silent corruption otherwise.
     */
    oneActivePerDriveId: uniqueIndex("drive_documents_active_drive_id_uidx")
      .on(t.rootId, t.driveId)
      .where(sql`${t.isActive} = 1`),
  }),
);

export type DriveDocument = typeof driveDocuments.$inferSelect;
export type DriveDocumentInsert = typeof driveDocuments.$inferInsert;
