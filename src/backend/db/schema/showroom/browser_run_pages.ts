import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";

/**
 * Browser Run Pages — 1 row per page crawled during a showroom scrape workflow.
 *
 * A "browser run" is one execution of the Browser Rendering scrape pipeline for a
 * specific showroom.  Every page visited during that run gets its own row here,
 * capturing the raw outputs (markdown, screenshot, structured AI extraction) so
 * they can be processed downstream into Vectorize embeddings.
 *
 * The `rag_uuid` column matches `showroom_stores.rag_uuid` — it is the tag applied
 * to every Vectorize embedding so that RAG queries can filter to a single showroom's
 * corpus.  This is a documented soft-link, not a hard FK, because SQLite / D1 does
 * not support unique constraints on the source column needed for a true FK reference
 * to a non-PK text column.
 */
export const browserRunPages = sqliteTable(
  "browser_run_pages",
  {
    /** Auto-increment surrogate PK. */
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * Matches `showroom_stores.rag_uuid`.  Every Vectorize embedding produced
     * from this page is tagged with this value, enabling per-showroom RAG
     * retrieval without a join back to `showroom_stores`.
     */
    ragUuid: text("rag_uuid").notNull(),

    /**
     * Foreign key to `showroom_stores.id`.  Cascade-deletes all page rows when
     * the parent showroom is deleted — safe here because page rows are
     * re-generated on each scrape run and contain no user-authored data.
     */
    showroomId: integer("showroom_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /**
     * Wall-clock time the page was fetched by Browser Rendering.
     * Stored as Unix epoch via SQLite `unixepoch()` default.
     */
    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** Absolute URL of the crawled page. */
    pageUrl: text("page_url").notNull(),

    /**
     * R2 object key (or full URL) pointing to the extracted Markdown
     * representation of the page body.  Null until the markdown extraction
     * step has completed for this page.
     */
    markdownR2Url: text("markdown_r2_url"),

    /**
     * Cloudflare Images delivery URL of the full-page screenshot captured by
     * Browser Rendering.  Null until the screenshot has been uploaded to CF Images.
     * Example: "https://imagedelivery.net/<accountHash>/<imageId>/public"
     */
    fullpageScreenshotCfImagesUrl: text("fullpage_screenshot_cf_images_url"),

    /**
     * The exact prompt string sent to Workers AI for structured content extraction
     * on this page.  Stored for auditability and prompt-iteration analysis.
     */
    workersAiPrompt: text("workers_ai_prompt"),

    /**
     * The JSON Schema object passed to Workers AI alongside the prompt to
     * constrain the structured extraction output shape.
     * Serialized as JSON text; deserialize before use.
     */
    workersAiStructuredSchema: text("workers_ai_structured_schema", {
      mode: "json",
    }).$type<Record<string, unknown>>(),

    /**
     * The structured extraction result returned by Workers AI, conforming to
     * the shape described in `workers_ai_structured_schema`.
     * Serialized as JSON text; deserialize before use.
     */
    workersAiStructuredResponse: text("workers_ai_structured_response", {
      mode: "json",
    }).$type<Record<string, unknown>>(),

    /** Row creation timestamp (Unix epoch via `unixepoch()` default). */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    /** Supports per-showroom Vectorize corpus queries keyed by RAG UUID. */
    ragUuidIdx: index("idx_browser_run_pages_rag_uuid").on(table.ragUuid),
    /** Supports fetching all pages crawled for a given showroom. */
    showroomIdIdx: index("idx_browser_run_pages_showroom_id").on(
      table.showroomId
    ),
  })
);

export type BrowserRunPage = typeof browserRunPages.$inferSelect;
export type BrowserRunPageInsert = typeof browserRunPages.$inferInsert;
