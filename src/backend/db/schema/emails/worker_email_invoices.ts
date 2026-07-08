import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { workerEmails } from "./worker_emails";
import { workerEmailAttachments } from "./worker_email_attachments";

/**
 * Worker Email Invoices — structured invoice data extracted by AI from
 * inbound email content or attachments (PDFs, images).
 *
 * Each invoice row is FK'd to the originating worker_email and optionally
 * to the specific attachment that contained the invoice. Human reviewers
 * confirm or reject via the HITL inbox.
 */
export const workerEmailInvoices = sqliteTable(
  "worker_email_invoices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    emailId: integer("email_id")
      .notNull()
      .references(() => workerEmails.id, { onDelete: "cascade" }),

    /** The attachment the invoice was extracted from (null if inline in body). */
    attachmentId: integer("attachment_id").references(
      () => workerEmailAttachments.id,
      { onDelete: "set null" },
    ),

    // ── Extracted fields ─────────────────────────────────────────────────

    vendorName: text("vendor_name"),
    invoiceNumber: text("invoice_number"),
    /** ISO date string (YYYY-MM-DD). */
    invoiceDate: text("invoice_date"),
    /** ISO date string (YYYY-MM-DD). */
    dueDate: text("due_date"),

    subtotal: real("subtotal"),
    tax: real("tax"),
    total: real("total"),
    currency: text("currency").notNull().default("USD"),

    /**
     * JSON array of line items:
     * [{ "description": string, "qty": number, "unitPrice": number, "total": number }]
     */
    lineItemsJson: text("line_items_json"),

    /** Full raw AI extraction result for audit / re-extraction. */
    extractedRawJson: text("extracted_raw_json"),

    /** AI confidence in the extraction (0.0 – 1.0). */
    confidence: real("confidence"),

    // ── Lifecycle ────────────────────────────────────────────────────────

    /**
     * draft     → AI extracted, awaiting human review
     * confirmed → human confirmed as accurate
     * rejected  → human rejected (bad extraction / not an invoice)
     */
    status: text("status").notNull().default("draft"),

    confirmedAt: integer("confirmed_at", { mode: "timestamp" }),
    confirmedBy: text("confirmed_by"),
    notes: text("notes"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    emailIdx: index("worker_email_invoices_email_idx").on(table.emailId),
    statusIdx: index("worker_email_invoices_status_idx").on(table.status),
  }),
);

export type WorkerEmailInvoice = typeof workerEmailInvoices.$inferSelect;
export type WorkerEmailInvoiceInsert = typeof workerEmailInvoices.$inferInsert;
