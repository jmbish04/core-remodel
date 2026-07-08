import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { artifacts } from "./artifacts";

/**
 * Artifact Revisions — the immutable version chain for an artifact (0016).
 *
 * Every `create_artifact` writes revision 1; every `update_artifact` appends a
 * new revision (incrementing `revisionNumber`) and re-points
 * `artifacts.currentRevisionId`. Rows are never mutated, so the full history is
 * always recoverable and the viewer can offer a revision dropdown.
 *
 * `sourceTsx` is the single TSX module that `export default`s a React
 * component; `importsJson` records the allow-listed specifiers the validator
 * extracted (for docs + re-validation). Source is stored in D1 TEXT (artifacts
 * are small); if one ever exceeds the tool's size guard it should be offloaded
 * to R2 (`ARTIFACTS_BUCKET`) — v1 rejects oversize instead.
 */
export const artifactRevisions = sqliteTable(
  "artifact_revisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    artifactId: integer("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),

    /** 1-based version number within this artifact's chain. */
    revisionNumber: integer("revision_number").notNull(),

    /** The component source — a TSX module default-exporting a React component. */
    sourceTsx: text("source_tsx").notNull(),

    /** Named export to render (default "default"). */
    entryExport: text("entry_export").notNull().default("default"),

    /** JSON array of the allow-listed import specifiers found in the source. */
    importsJson: text("imports_json"),

    /** What changed in this revision (free-text). */
    changeNote: text("change_note"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    artifactIdx: index("artifact_revisions_artifact_idx").on(table.artifactId),
  }),
);

export type ArtifactRevision = typeof artifactRevisions.$inferSelect;
export type ArtifactRevisionInsert = typeof artifactRevisions.$inferInsert;
