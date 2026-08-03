import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The vocabulary of what a problem document *is* (0043 Phase 0).
 *
 * Seeded: Expert Report, Building Code. A seed, not a closed set —
 * admin-managed at `/admin/config/room/problem-document-types`.
 *
 * TWO AXES, NOT ONE — read this before adding a value. A document attached to
 * a problem is classified twice, and the two classifications are unrelated:
 *
 *  1. **What it is** — this table. Expert Report, Building Code, Inspection
 *     Report, Manufacturer Spec, Insurance Correspondence. Many per document
 *     (an engineer's letter citing a code section is both), so Phase 3 joins
 *     `room_problem_document_id ↔ room_problem_document_type_id`.
 *  2. **Which side of the fix it documents** — `PROBLEM` |
 *     `SOLUTION_TO_BE` | `SOLUTION_AS_BUILT`, which stays a hardcoded enum
 *     column on `room_problem_documents` because adding a member there changes
 *     the code that reads it, not just the picker.
 *
 * Collapsing those two axes into one list is tempting and wrong: it produces
 * entries like "Expert report about the proposed fix", and the moment the same
 * report also covers the as-built work there is no row that fits.
 *
 * WHAT LIVES ON THE DOCUMENT, NOT HERE: `sha_hash` (UNIQUE, so re-uploading
 * the same PDF dedupes instead of producing a second embedding that makes RAG
 * return the same source three times), `rag_uuid`, `r2_key`, `ocr_status` and
 * `extracted_at`. That last pair exists so a null `doc_text` can be told apart
 * from "a document that genuinely has no text" — absence of data and failure
 * to extract are different facts and must not share a representation.
 *
 * NOT the existing `documents` table. That one is `{userId, title, content}`
 * with Slate JSON — a note editor, not a file store.
 */
export const roomProblemDocumentTypeDef = sqliteTable("room_problem_document_type_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Stable slug, e.g. "expert_report". */
  key: text("key").notNull().unique(),

  /** Display name in plain language, e.g. "Expert Report". */
  name: text("name").notNull(),

  /**
   * What this kind of document is and what weight it carries — PlateJS
   * markdown. A homeowner needs to know that an engineer's stamped report and
   * a contractor's emailed opinion are not interchangeable when the argument
   * reaches an insurer.
   */
  descriptionMarkdown: text("description_markdown"),

  /** Render-ready cache of the same explanation. Sanitized on write. */
  descriptionHtml: text("description_html"),

  /** Flattened text for search and embeddings. */
  descriptionPlaintext: text("description_plaintext"),

  /** Display order in the type picker and on the config page. Lowest first. */
  sortOrder: integer("sort_order").notNull().default(0),

  /**
   * Soft-delete. Documents are evidence in a dispute; the classification they
   * were filed under must remain resolvable years later.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type RoomProblemDocumentTypeDef = typeof roomProblemDocumentTypeDef.$inferSelect;
export type RoomProblemDocumentTypeDefInsert =
  typeof roomProblemDocumentTypeDef.$inferInsert;
