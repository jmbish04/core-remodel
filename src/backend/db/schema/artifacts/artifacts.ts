import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Artifacts — chat-built mini-apps captured onto the Worker (0016 "Studio").
 *
 * During a chat, Claude exports an artifact (a report, interactive app, or
 * dashboard) via the `create_artifact` MCP tool; it lands here and is rendered
 * at `/admin/studio/<slug>`. This is the metadata head; the actual component
 * source lives in the immutable `artifact_revisions` chain, with
 * `currentRevisionId` pointing at the live version (mirrors the budget-item
 * revision pattern). Updating an artifact appends a new revision and re-points
 * `currentRevisionId` — old versions are retained.
 *
 * Hard constraint (enforced in `tools/artifacts.ts`): artifact source may only
 * import allow-listed shadcn/ui components + a small sanctioned scope, never
 * bespoke Tailwind restyling or hardcoded colors.
 */
export const artifacts = sqliteTable(
  "artifacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** URL slug — unique, used in `/admin/studio/<slug>` + the source fetch. */
    slug: text("slug").notNull(),

    title: text("title").notNull(),
    description: text("description"),

    /** Artifact kind — a filter/label; all kinds render the same way. */
    kind: text("kind", { enum: ["report", "app", "dashboard"] })
      .notNull()
      .default("app"),

    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("published"),

    /** FK-ish pointer to the live `artifact_revisions.id` (nullable pre-insert). */
    currentRevisionId: integer("current_revision_id"),

    /** Freeform note on where this came from (the chat context). */
    sourceConversation: text("source_conversation"),

    /** Optional usage counter — bumped when the viewer opens the artifact. */
    openCount: integer("open_count").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    slugUniq: uniqueIndex("artifacts_slug_uniq").on(table.slug),
    statusIdx: index("artifacts_status_idx").on(table.status),
    kindIdx: index("artifacts_kind_idx").on(table.kind),
  }),
);

export type Artifact = typeof artifacts.$inferSelect;
export type ArtifactInsert = typeof artifacts.$inferInsert;
