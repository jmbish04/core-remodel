import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Saved views over the documents library — either a static hand-picked list of
 * documents (`kind: "static"`, members in `docIdsJson`) or a dynamic filter
 * (`kind: "dynamic"`, criteria in `filtersJson`) that is re-evaluated on read.
 *
 * View-visibility precedence rule: a view's own `visibility` controls whether
 * the *view itself* (and, transitively, its member documents) is exposed on the
 * public `/docs` surface — a `visibility: "public"` view exposes its member docs
 * even when an individual document's own `visibility` is `"private"`. A
 * `visibility: "private"` view is admin-only regardless of the visibility of its
 * member documents. In other words: the view's visibility can widen access for
 * documents it contains, but a private view never leaks through a document's own
 * public visibility (private views are filtered out before /docs ever sees them).
 */
export const documentSavedViews = sqliteTable(
  "document_saved_views",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    slug: text("slug").notNull(),

    name: text("name").notNull(),
    description: text("description"),

    /** 'static' | 'dynamic' */
    kind: text("kind").notNull(),

    /**
     * JSON filter object for dynamic views, e.g.
     * `{ tags?, sourceType?, docType?, visibility?, entityType?, entityId?, search? }`.
     */
    filtersJson: text("filters_json"),

    /** JSON string[] of supporting_documents.id for static views. */
    docIdsJson: text("doc_ids_json"),

    /** 'private' | 'public' — see view-visibility precedence rule above. */
    visibility: text("visibility").notNull().default("private"),

    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    slugUnique: uniqueIndex("document_saved_views_slug_unique").on(table.slug),
  }),
);

export type DocumentSavedView = typeof documentSavedViews.$inferSelect;
export type DocumentSavedViewInsert = typeof documentSavedViews.$inferInsert;
