import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { driveRoots } from "./drive_roots";

/**
 * Subtrees and mime types a root's scan must skip.
 *
 * This is load-bearing, not a nicety: a sibling of the research root holds
 * ~5,000 machine-generated processing logs in one subfolder. Ingesting that
 * would fill D1 with debug output and, in PR 3, embed all of it. Exclusions
 * are applied during descent so an excluded subtree is never traversed.
 */
export const driveRootExclusions = sqliteTable(
  "drive_root_exclusions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    rootId: integer("root_id")
      .notNull()
      .references(() => driveRoots.id, { onDelete: "cascade" }),
    /** 'folder' (value = a Drive folder id) | 'mime' (value = 'video/*' etc). */
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    /** Why this is excluded — for the next reader, not for the code. */
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    exclusionUnique: uniqueIndex("drive_root_exclusion_unique").on(t.rootId, t.kind, t.value),
  }),
);

export type DriveRootExclusion = typeof driveRootExclusions.$inferSelect;
export type DriveRootExclusionInsert = typeof driveRootExclusions.$inferInsert;
