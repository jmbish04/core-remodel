import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { documents } from "../documents/documents";
import { images } from "../images/images";
import { impacts } from "./impacts";

/**
 * What backs an impact up (0041 Phase 0, load-bearing for 0042).
 *
 * APPEND-ONLY. Rows are never edited and never deleted. `occurredAt` is when the
 * thing happened; `recordedAt` is when it was captured here and is immutable.
 * The gap between them is meaningful, and collapsing them would destroy the one
 * property that makes this record worth anything.
 *
 * CONTEMPORANEOUS BEATS RECONSTRUCTED. A note written the day a contractor
 * refused to return is worth more than the same note assembled four months later
 * from memory — first for the homeowner's own recall, and second for its weight
 * if it is ever read by someone else.
 *
 * THIS IS ALSO THE FORECASTING GATE. An impact with `status = "forecast"` may
 * only render as an alarm if it has at least one evidence row. No evidence, no
 * alarm — a forecast with no basis is not shown, because crying wolf destroys
 * the trust the feature exists to build. Category risks with no project-specific
 * basis belong on the separate watch-list tier, never here.
 *
 * Two hard FKs where the artefact already has a home (documents, images) and a
 * loose `externalRef` for everything else. There is no generic artifacts table
 * in this codebase, so this does not pretend there is one.
 */
export const impactEvidence = sqliteTable(
  "impact_evidence",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    impactId: integer("impact_id")
      .notNull()
      .references(() => impacts.id, { onDelete: "cascade" }),

    /**
     * receipt | invoice | permit_record | email | photo | quote | research |
     * contract | message | note
     */
    kind: text("kind").notNull(),

    /** Hard FK when the evidence is a stored document. */
    documentId: integer("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),

    /** Hard FK when the evidence is a stored image. */
    imageId: integer("image_id").references(() => images.id, { onDelete: "set null" }),

    /**
     * Anything without a table of its own — a permit identifier, a message id, a
     * URL. Free text on purpose; this is a pointer, not a join.
     */
    externalRef: text("external_ref"),

    /** The evidence itself when it is words rather than a file. */
    bodyMarkdown: text("body_markdown"),
    bodyHtml: text("body_html"),

    /** Who captured it. */
    recordedBy: text("recorded_by"),

    /** When the underlying thing happened. */
    occurredAt: integer("occurred_at", { mode: "timestamp" }),

    /** When it landed here. Immutable — never backfilled, never edited. */
    recordedAt: integer("recorded_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    impactIdx: index("impact_evidence_impact_idx").on(table.impactId),
  }),
);
