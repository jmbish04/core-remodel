import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { pascalProjects } from "./pascal_projects";

/**
 * Pascal study (0043) — a Core-Remodel-only grouping of variants a user is comparing,
 * e.g. "Upstairs island placement". The editor's wire contract is flat (project ->
 * scenes); studies are our metadata for grouping + `compare_layout_variants`, carried
 * on each scene's rendering metadata rather than the editor knowing they exist.
 *
 * Rich `description` is stored as both markdown (portable source) and html (render cache)
 * per the repo rich-text convention.
 */
export const pascalStudies = sqliteTable("pascal_studies", {
  id: text("id").primaryKey(), // slug
  projectId: text("project_id")
    .notNull()
    .references(() => pascalProjects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  descriptionMarkdown: text("description_markdown"),
  descriptionHtml: text("description_html"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeLastModified: integer("datetime_last_modified", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
});
