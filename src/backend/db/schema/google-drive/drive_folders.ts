import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { driveRoots } from "./drive_roots";

/**
 * One folder in an ingested tree — ONE table for every use case.
 *
 * Two independent flags, deliberately not merged:
 *   isActive=false  → superseded by a rename or move; a NEW row carries the
 *                     current state and `supersededById` links them.
 *   isDeleted=true  → gone from Drive. Rows are never hard-deleted.
 * A folder can be superseded without being deleted, and deleted without ever
 * having been superseded. Conflating them loses "this moved" vs "this is gone".
 *
 * The display name lives here and NOWHERE else — children reference this row by
 * id and JOIN for the name.
 */
export const driveFolders = sqliteTable(
  "drive_folders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    driveId: text("drive_id").notNull(),
    rootId: integer("root_id")
      .notNull()
      .references(() => driveRoots.id, { onDelete: "cascade" }),
    /** Self-FK. NULL only for the scanned root itself. */
    parentFolderId: integer("parent_folder_id").references((): AnySQLiteColumn => driveFolders.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    webViewUrl: text("web_view_url").notNull(),
    /** ANYONE | ANYONE_WITH_LINK | DOMAIN | DOMAIN_WITH_LINK | PRIVATE */
    sharing: text("sharing").notNull().default("PRIVATE"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    supersededById: integer("superseded_by_id").references((): AnySQLiteColumn => driveFolders.id, {
      onDelete: "set null",
    }),
    driveModifiedAt: integer("drive_modified_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byRootActive: index("drive_folders_root_active_idx").on(t.rootId, t.isActive),
    byDriveId: index("drive_folders_drive_id_idx").on(t.driveId),
    /** Walking a supersede chain backwards was a table scan without this. */
    bySupersededBy: index("drive_folders_superseded_by_idx").on(t.supersededById),
    /**
     * At most ONE live row per Drive id per root. The ingester is written not
     * to duplicate, but the indexes here are non-unique, so any path that ever
     * did would corrupt the tree silently. This makes it fail loudly instead.
     */
    oneActivePerDriveId: uniqueIndex("drive_folders_active_drive_id_uidx")
      .on(t.rootId, t.driveId)
      .where(sql`${t.isActive} = 1`),
  }),
);

export type DriveFolder = typeof driveFolders.$inferSelect;
export type DriveFolderInsert = typeof driveFolders.$inferInsert;
