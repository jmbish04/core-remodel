import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Persistent changelog — the overview at /admin/changelog reads these tables so
 * the record survives across branches (append-only; no merge conflicts on a
 * static file). Every branch/PR of work registers a `changelog_branches` row
 * and one `changelog_entries` row per shipped change, written to D1 by the
 * changelog API / CLI / MCP tool.
 */
export const changelogBranches = sqliteTable(
  "changelog_branches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Git branch name — unique join key for entries. */
    branch: text("branch").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary"),
    /** ISO date (YYYY-MM-DD) shown on the card. */
    date: text("date").notNull(),
    status: text("status", { enum: ["shipped", "staged", "open"] })
      .notNull()
      .default("open"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    /** Branch-level Mermaid diagrams: [{ caption, code }]. */
    diagramsJson: text("diagrams_json", { mode: "json" }).$type<
      Array<{ caption: string; code: string }>
    >(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    createdIdx: index("changelog_branches_created_idx").on(t.createdAt),
  }),
);

export const changelogEntries = sqliteTable(
  "changelog_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stable slug — the detail page URL + dedupe key. */
    slug: text("slug").notNull().unique(),
    /** Branch this entry belongs to (matches changelog_branches.branch). */
    branch: text("branch").notNull(),
    /** Optional phase/version tag, e.g. "Phase 1". */
    tag: text("tag"),
    area: text("area").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    status: text("status", { enum: ["shipped", "staged"] })
      .notNull()
      .default("staged"),
    date: text("date").notNull(),
    /** ChangelogChange[] : [{ kind, text }]. */
    changesJson: text("changes_json", { mode: "json" }).$type<
      Array<{ kind: string; text: string }>
    >(),
    /** drizzle migration tags: string[]. */
    migrationsJson: text("migrations_json", { mode: "json" }).$type<string[]>(),
    /**
     * Scorched-earth detail (PhaseDetail): problem, approach, apiChanges,
     * mcpChanges, filesTouched, migrations[{tag,sql}], code[], diagrams[].
     * Null for a shallow entry.
     */
    detailJson: text("detail_json", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    branchIdx: index("changelog_entries_branch_idx").on(t.branch),
    createdIdx: index("changelog_entries_created_idx").on(t.createdAt),
  }),
);

export type ChangelogBranchRow = typeof changelogBranches.$inferSelect;
export type ChangelogBranchInsert = typeof changelogBranches.$inferInsert;
export type ChangelogEntryRow = typeof changelogEntries.$inferSelect;
export type ChangelogEntryInsert = typeof changelogEntries.$inferInsert;
