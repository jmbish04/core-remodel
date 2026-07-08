import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { companies } from "../directory/companies";

/**
 * Worker Emails — inbound emails received by the Cloudflare Email Worker
 * at remodel@hacolby.app. NOT to be confused with the Gmail integration
 * tables (gmail_threads / gmail_messages).
 *
 * Every email hitting the email() handler is logged here regardless of
 * classification. AI classifies + routes; humans review via the HITL inbox.
 *
 * Forward-aware: when the homeowner forwards an email from a contractor,
 * the agent peels past the forward headers to identify the real sender
 * and match them to the companies directory.
 */
export const workerEmails = sqliteTable(
  "worker_emails",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** RFC 2822 Message-ID header (globally unique per email). */
    messageId: text("message_id"),

    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject"),

    /** Plain-text body (preferred for AI analysis). */
    bodyText: text("body_text"),
    /** HTML body (for display / fallback). */
    bodyHtml: text("body_html"),

    /** JSON-serialized object of all parsed headers for audit. */
    rawHeaders: text("raw_headers"),

    // ── Forward detection ────────────────────────────────────────────────

    /** True if the email was detected as a forward from the homeowner's inbox. */
    isForwarded: integer("is_forwarded", { mode: "boolean" }).notNull().default(false),

    /** The real sender's email (extracted from forward body/headers). */
    originalFromAddress: text("original_from_address"),
    /** Display name of the real sender. */
    originalFromName: text("original_from_name"),
    /** Date string from the original email within the forward. */
    originalDate: text("original_date"),

    // ── Company matching ─────────────────────────────────────────────────

    /**
     * Matched company from the directory. Set by the AI agent via email
     * domain or fuzzy name match. Null if no match or pending HITL.
     */
    matchedCompanyId: integer("matched_company_id").references(
      () => companies.id,
      { onDelete: "set null" },
    ),
    /** AI confidence in the company match (0.0–1.0). */
    companyMatchConfidence: real("company_match_confidence"),
    /** How the company was matched: "email_domain" | "name_fuzzy" | "manual" | "staged". */
    companyMatchMethod: text("company_match_method"),

    // ── Classification ───────────────────────────────────────────────────

    /**
     * AI classification (expanded):
     *   "invoice" | "contract" | "change_order" | "estimate" |
     *   "receipt" | "shipping" | "general" | "unknown"
     */
    classification: text("classification"),
    /** AI confidence in the classification (0.0 – 1.0). */
    classificationConfidence: real("classification_confidence"),

    // ── AI reviewer flags ────────────────────────────────────────────────

    /**
     * JSON array of structured reviewer flags:
     * [{ "level": "info"|"warning"|"critical", "category": string, "message": string }]
     *
     * Categories: "payment", "clause_risk", "missing_protection",
     * "negotiation_tip", "follow_up_question", "company_match", "general"
     */
    aiReviewerFlags: text("ai_reviewer_flags"),

    // ── Lifecycle ────────────────────────────────────────────────────────

    /**
     * Lifecycle status:
     *   pending    → just received, AI not yet run
     *   classified → AI ran, awaiting human review
     *   processed  → downstream extraction (invoice, contract, etc.) complete
     *   reviewed   → human reviewed and accepted
     *   rejected   → human reviewed and rejected / spam
     */
    status: text("status").notNull().default("pending"),

    /** Human reviewer's free-text notes. */
    reviewNotes: text("review_notes"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    messageIdIdx: uniqueIndex("worker_emails_message_id_idx").on(table.messageId),
    statusIdx: index("worker_emails_status_idx").on(table.status),
    classificationIdx: index("worker_emails_classification_idx").on(table.classification),
    createdAtIdx: index("worker_emails_created_at_idx").on(table.createdAt),
    companyIdx: index("worker_emails_company_idx").on(table.matchedCompanyId),
  }),
);

export type WorkerEmail = typeof workerEmails.$inferSelect;
export type WorkerEmailInsert = typeof workerEmails.$inferInsert;
