import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { workerEmails } from "./worker_emails";
import { workerEmailAttachments } from "./worker_email_attachments";

/**
 * Worker Email Contracts — structured contract data extracted by AI from
 * inbound email attachments (PDFs). This is a staging/extraction table,
 * NOT the full contracts system (`contracts`, `contractRevisions`, etc.).
 *
 * The HITL reviewer can inspect the extraction, edit fields, and optionally
 * promote it into the full contracts system.
 */
export const workerEmailContracts = sqliteTable(
  "worker_email_contracts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    emailId: integer("email_id")
      .notNull()
      .references(() => workerEmails.id, { onDelete: "cascade" }),

    /** The attachment the contract was extracted from. */
    attachmentId: integer("attachment_id").references(
      () => workerEmailAttachments.id,
      { onDelete: "set null" },
    ),

    // ── Extracted fields ─────────────────────────────────────────────────

    /** Contract type: "contract" | "change_order" | "addendum" | "proposal" */
    contractType: text("contract_type"),

    /** Contractor / party name. */
    partyName: text("party_name"),
    /** Homeowner / other party. */
    counterpartyName: text("counterparty_name"),

    /** Scope of work summary (AI-generated). */
    scopeSummary: text("scope_summary"),

    /** Total contract value in dollars. */
    totalValue: real("total_value"),
    currency: text("currency").notNull().default("USD"),

    /** ISO date strings. */
    effectiveDate: text("effective_date"),
    completionDate: text("completion_date"),

    /**
     * JSON array of key clauses extracted:
     * [{ "type": "payment"|"warranty"|"lien_waiver"|"cancellation"|...,
     *    "summary": string, "riskLevel": "low"|"medium"|"high",
     *    "fullText": string }]
     */
    clausesJson: text("clauses_json"),

    /**
     * JSON array of payment milestones:
     * [{ "name": string, "amount": number, "trigger": string, "dueDate": string }]
     */
    paymentMilestonesJson: text("payment_milestones_json"),

    /**
     * JSON array of AI recommendations for the homeowner:
     * [{ "category": "negotiate"|"add_clause"|"risk"|"question",
     *    "severity": "info"|"warning"|"critical",
     *    "title": string,
     *    "detail": string,
     *    "suggestedAction": string }]
     *
     * Examples:
     * - "No lien waiver clause found — ask contractor to add one"
     * - "Payment schedule is front-loaded (40% upfront) — negotiate to 20%"
     * - "Warranty is only 1 year — industry standard is 2 years for this trade"
     * - "Ask: What happens if the project extends beyond the completion date?"
     */
    aiRecommendationsJson: text("ai_recommendations_json"),

    /** Full raw AI extraction result for audit. */
    extractedRawJson: text("extracted_raw_json"),

    /** AI confidence in the extraction (0.0 – 1.0). */
    confidence: real("confidence"),

    // ── Lifecycle ────────────────────────────────────────────────────────

    /**
     * draft     → AI extracted, awaiting human review
     * confirmed → human confirmed
     * promoted  → promoted to the full contracts system
     * rejected  → human rejected
     */
    status: text("status").notNull().default("draft"),

    confirmedAt: integer("confirmed_at", { mode: "timestamp" }),
    confirmedBy: text("confirmed_by"),
    /** If promoted, FK to the contracts table (stored as integer, no hard FK to avoid circular deps). */
    promotedContractId: integer("promoted_contract_id"),
    notes: text("notes"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    emailIdx: index("worker_email_contracts_email_idx").on(table.emailId),
    statusIdx: index("worker_email_contracts_status_idx").on(table.status),
  }),
);

export type WorkerEmailContract = typeof workerEmailContracts.$inferSelect;
export type WorkerEmailContractInsert = typeof workerEmailContracts.$inferInsert;
