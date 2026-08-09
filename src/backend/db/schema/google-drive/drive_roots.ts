import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { driveUseCases } from "./drive_use_cases";

/** One scanned Drive folder tree. Add a root = insert a row; no code change. */
export const driveRoots = sqliteTable("drive_roots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Google's own folder id for the root of the tree. */
  driveFolderId: text("drive_folder_id").notNull().unique(),
  label: text("label").notNull(),
  useCaseId: integer("use_case_id")
    .notNull()
    .references(() => driveUseCases.id),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastScannedAt: integer("last_scanned_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type DriveRoot = typeof driveRoots.$inferSelect;
export type DriveRootInsert = typeof driveRoots.$inferInsert;
