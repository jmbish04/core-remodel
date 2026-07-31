import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { pascalProjects } from "./pascal_projects";
import { pascalStudies } from "./pascal_studies";

/**
 * Pascal variant (0043) — one editable layout = one Pascal scene = its own
 * `/scene/:id` in the editor. `id` is the Pascal `SceneId` (slug <= 64).
 *
 * Column names/semantics mirror the editor's `SceneMeta` (jmbish04/editor#1,
 * packages/mcp/src/storage/types.ts) so this worker's JSON satisfies that client
 * byte-for-byte: `name` (not title), the draft|checkpoint save model, the
 * published/draft/latest/browser-visible version rollup, and `graphHash`.
 *
 * `graphJson` holds the full Pascal `SceneGraph` (@pascal-app/core) — every node
 * and property, not a summary. `renderingJson` is the sanctioned immutable evidence
 * snapshot serialized to the editor's exact `SceneRenderingMetadata`.
 */
export const pascalVariants = sqliteTable("pascal_variants", {
  id: text("id").primaryKey(), // slug <= 64 == sceneId
  // Optional grouping. Our MCP tools always set it; scenes the editor creates
  // directly (its flat project->scenes contract has no study) are ungrouped (null).
  studyId: text("study_id").references(() => pascalStudies.id, {
    onDelete: "set null",
  }),
  projectId: text("project_id")
    .notNull()
    .references(() => pascalProjects.id, { onDelete: "cascade" }),
  // Branch lineage — the scene this variant was derived from. Self-FK.
  parentSceneId: text("parent_scene_id").references(
    (): AnySQLiteColumn => pascalVariants.id,
    { onDelete: "set null" },
  ),
  name: text("name").notNull(),
  // Core-Remodel-only rich description (editor wire has no description field).
  descriptionMarkdown: text("description_markdown"),
  descriptionHtml: text("description_html"),
  // Full Pascal SceneGraph JSON. Empty object until a graph is generated/saved.
  graphJson: text("graph_json").notNull().default("{}"),
  graphHash: text("graph_hash"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  nodeCount: integer("node_count").notNull().default(0),
  // Version model (mirrors the editor SceneStore). `version` is the browser-visible
  // model version; draft saves bump it repeatedly, checkpoints record history.
  version: integer("version").notNull().default(1),
  publishedVersion: integer("published_version"),
  draftVersion: integer("draft_version"),
  latestVersion: integer("latest_version"),
  browserVisibleVersion: integer("browser_visible_version"),
  saveMode: text("save_mode", { enum: ["draft", "checkpoint"] })
    .notNull()
    .default("draft"),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(true),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  // Product lifecycle, distinct from the save model.
  status: text("status", { enum: ["draft", "active", "archived"] })
    .notNull()
    .default("draft"),
  // SceneRenderingMetadata (coreRemodelProjectId, variant, measurements[], confidence,
  // provenance) — immutable evidence snapshot; updating it never touches business records.
  renderingJson: text("rendering_json"),
  thumbnailUrl: text("thumbnail_url"),
  ownerId: text("owner_id"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeLastModified: integer("datetime_last_modified", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
