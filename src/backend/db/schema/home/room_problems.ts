import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { companies } from "../directory/companies";
import { images } from "../images/images";
import { impacts } from "../impacts/impacts";
import { roomProblemDocumentTypeDef } from "./room_problem_document_type_def";
import { roomProblemFixDef } from "./room_problem_fix_def";
import { roomProblemTypeDef } from "./room_problem_type_def";
import { rooms } from "./rooms";

/**
 * Room problems (0043 §5). The largest cluster, and the one with the most value
 * beyond what was specified.
 *
 * ONE INSTANCE ROW, NOT TWO TABLES. The draft split "a problem this room has"
 * across `room_problem_mapping` and `room_problems`, which creates a "which one
 * is the problem?" question at every join. `room_problems` is the instance; the
 * mapping below joins problem↔TYPE, because a problem can genuinely be more than
 * one type — an active leak is both *Active Water Leak* and *Code Compliance*.
 *
 * A PROBLEM IS A THREAD, NOT A FACT. `status` runs suspected → confirmed →
 * fixing → resolved → accepted, with `wont_fix` as a deliberate, recorded
 * ending. Without it "problems" is a list that only grows, which is how a
 * feature stops being opened.
 *
 * `impact_id` LINKS to the 0041 graph rather than duplicating it. A problem
 * found during demo IS a `demo_discovery` impact, so linking gives it blast
 * radius, blocking, and node health for free. Do not build a second disruption
 * system.
 *
 * `is_safety_hazard` is SEPARATE from `severity` on purpose: a hazard is not
 * merely "very major", it changes what the product is allowed to stay quiet
 * about. The example types span *squeaky floor* and *active water leak*, and a
 * list that sorts those together is one nobody trusts.
 */
export const roomProblems = sqliteTable(
  "room_problems",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),

    overviewMarkdown: text("overview_markdown"),
    overviewHtml: text("overview_html"),
    overviewPlaintext: text("overview_plaintext"),

    /** informational | minor | major | urgent */
    severity: text("severity").notNull().default("minor"),

    /** A hazard changes what the product may stay quiet about — not just "major". */
    isSafetyHazard: integer("is_safety_hazard", { mode: "boolean" }).notNull().default(false),

    /** suspected | confirmed | fixing | resolved | accepted | wont_fix */
    status: text("status").notNull().default("suspected"),

    /** The disruption this raised, if any — the 0041 impact graph. */
    impactId: integer("impact_id").references(() => impacts.id, { onDelete: "set null" }),

    /** inspection | demo | walkthrough | reported | failure — provenance. */
    discoveredDuring: text("discovered_during"),

    discoveredAt: integer("discovered_at", { mode: "timestamp" }),
    /** Time-to-resolve is the metric that says whether a contractor is working the list. */
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    roomStatusIdx: index("room_problems_room_status_idx").on(table.roomId, table.status),
    impactIdx: index("room_problems_impact_idx").on(table.impactId),
  }),
);

/** Problem ↔ type. A problem can be several types at once. */
export const roomProblemTypeMapping = sqliteTable(
  "room_problem_type_mapping",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomProblemId: integer("room_problem_id")
      .notNull()
      .references(() => roomProblems.id, { onDelete: "cascade" }),
    roomProblemTypeId: integer("room_problem_type_id")
      .notNull()
      .references(() => roomProblemTypeDef.id, { onDelete: "cascade" }),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    uniq: uniqueIndex("room_problem_type_mapping_problem_type_uniq").on(
      table.roomProblemId,
      table.roomProblemTypeId,
    ),
  }),
);

/**
 * Problem ↔ fix. Joins a problem to the fixes addressing it, and a fix carries a
 * COST and an OWNING COMPANY — "what will this cost and who does it" is the first
 * question after "what is wrong", and without it the fix list cannot reach the
 * budget. Currency is text + cents, per project law.
 */
export const roomProblemFixMapping = sqliteTable(
  "room_problem_fix_mapping",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomProblemId: integer("room_problem_id")
      .notNull()
      .references(() => roomProblems.id, { onDelete: "cascade" }),
    roomProblemFixId: integer("room_problem_fix_id")
      .notNull()
      .references(() => roomProblemFixDef.id, { onDelete: "cascade" }),

    /** Who will do the fix. */
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),

    /** Verbatim cost string ("$3,200", "TBD"). */
    estimatedCostText: text("estimated_cost_text"),
    /** Integer cents for sort/sum. Paired with the text form. */
    estimatedCostCents: integer("estimated_cost_cents"),

    notesMarkdown: text("notes_markdown"),
    notesHtml: text("notes_html"),
    notesPlaintext: text("notes_plaintext"),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    problemIdx: index("room_problem_fix_mapping_problem_idx").on(table.roomProblemId),
  }),
);

/**
 * Problem photos — FK to images.id, NEVER a stored URL. The `images` table
 * already owns Cloudflare Images ids, dedupe, soft-delete and a room FK; storing
 * a URL would denormalise all of it and break when a variant changes.
 *
 * `SOLUTION_AS_BUILT` is added to the enum: PROBLEM and SOLUTION_TO_BE cover the
 * before and the plan; the AFTER is what proves a fix happened when a defect
 * recurs and the contractor says it was handled.
 *
 * `is_primary` is enforced one-per-problem by a partial unique index — the same
 * pattern `properties.is_primary` uses.
 */
export const roomProblemPhotos = sqliteTable(
  "room_problem_photos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomProblemId: integer("room_problem_id")
      .notNull()
      .references(() => roomProblems.id, { onDelete: "cascade" }),
    /** When the photo documents a specific fix. */
    roomProblemFixId: integer("room_problem_fix_id").references(() => roomProblemFixDef.id, {
      onDelete: "set null",
    }),

    /** PROBLEM | SOLUTION_TO_BE | SOLUTION_AS_BUILT */
    photoType: text("photo_type").notNull().default("PROBLEM"),

    /** images.id — a UUID text FK, not a URL. */
    imageId: text("image_id").references(() => images.id, { onDelete: "set null" }),

    name: text("name"),
    descriptionMarkdown: text("description_markdown"),
    descriptionHtml: text("description_html"),
    descriptionPlaintext: text("description_plaintext"),

    /** The hero shown on a problem card. One per problem (partial unique index). */
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),

    /** Photo capture order matters in a dispute; upload order is not capture order. */
    takenAt: integer("taken_at", { mode: "timestamp" }),

    /** Hide without losing the row — kept in case it is needed later. */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    problemIdx: index("room_problem_photos_problem_idx").on(table.roomProblemId),
    // At most one primary photo per problem.
    primaryUniq: uniqueIndex("room_problem_photos_primary_uniq")
      .on(table.roomProblemId)
      .where(sql`${table.isPrimary} = 1`),
  }),
);

/**
 * Problem documents — expert reports, code excerpts, quotes.
 *
 * `sha_hash` is UNIQUE so re-uploading the same PDF dedupes rather than creating
 * a second row with a second embedding — otherwise RAG returns the same document
 * three times and the homeowner stops trusting search.
 *
 * `ocr_status` exists because a null `doc_text` currently cannot be told apart
 * from "a document with no text" — the same class of bug as treating a missing
 * contract clause as an absent one.
 *
 * The existing `documents` table is NOT reused: it is {userId, title, content}
 * with Slate JSON, a note editor, not a file store.
 */
export const roomProblemDocuments = sqliteTable(
  "room_problem_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomProblemId: integer("room_problem_id")
      .notNull()
      .references(() => roomProblems.id, { onDelete: "cascade" }),
    roomProblemFixId: integer("room_problem_fix_id").references(() => roomProblemFixDef.id, {
      onDelete: "set null",
    }),

    /** PROBLEM | SOLUTION_TO_BE | SOLUTION_AS_BUILT */
    documentType: text("document_type").notNull().default("PROBLEM"),

    /** Vectorize id tying this document to its embedding. Cap: 64 bytes. */
    ragUuid: text("rag_uuid"),

    r2Key: text("r2_key"),
    /** UNIQUE — re-uploads dedupe instead of double-embedding. */
    shaHash: text("sha_hash").unique(),

    docText: text("doc_text"),
    aiSummary: text("ai_summary"),
    /** AI-generated from filename + content, user-editable. */
    docTitle: text("doc_title"),

    filename: text("filename"),
    mimetype: text("mimetype"),
    filesize: integer("filesize"),

    /** pending | ok | failed | unsupported — null doc_text vs "no text". */
    ocrStatus: text("ocr_status").notNull().default("pending"),
    extractedAt: integer("extracted_at", { mode: "timestamp" }),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    problemIdx: index("room_problem_documents_problem_idx").on(table.roomProblemId),
  }),
);

/** Document ↔ type. One document can be several types (a bundled PDF). */
export const roomProblemDocumentTypeMapping = sqliteTable(
  "room_problem_document_type_mapping",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomProblemDocumentId: integer("room_problem_document_id")
      .notNull()
      .references(() => roomProblemDocuments.id, { onDelete: "cascade" }),
    roomProblemDocumentTypeId: integer("room_problem_document_type_id")
      .notNull()
      .references(() => roomProblemDocumentTypeDef.id, { onDelete: "cascade" }),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    uniq: uniqueIndex("room_problem_document_type_mapping_doc_type_uniq").on(
      table.roomProblemDocumentId,
      table.roomProblemDocumentTypeId,
    ),
  }),
);
