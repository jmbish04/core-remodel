import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { workerEmailInvoices } from "./worker_email_invoices";
import { materialScheduleItems } from "../materials/schedule_item";

/**
 * Worker Email Invoice Line Items — individual line items from an extracted
 * invoice, each optionally linked to a `material_schedule_items` row.
 *
 * The raw AI extraction lives in `worker_email_invoices.lineItemsJson`.
 * This table stores the confirmed/editable version that the HITL reviewer
 * can match to existing material schedule items or create new ones from.
 */
export const workerEmailInvoiceLineItems = sqliteTable(
  "worker_email_invoice_line_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => workerEmailInvoices.id, { onDelete: "cascade" }),

    /** Line item description as extracted by AI. */
    description: text("description"),

    quantity: real("quantity"),
    unitPrice: real("unit_price"),
    lineTotal: real("line_total"),

    /**
     * Optional FK to the material schedule item this line item matches.
     * Set via HITL — either matched to an existing item or a newly
     * created one. Null = unmatched.
     */
    materialScheduleItemId: integer("material_schedule_item_id").references(
      () => materialScheduleItems.id,
      { onDelete: "set null" },
    ),

    /** HITL match status: "unmatched" | "matched" | "created" | "skipped". */
    matchStatus: text("match_status").notNull().default("unmatched"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    invoiceIdx: index("worker_email_invoice_line_items_invoice_idx").on(table.invoiceId),
    materialIdx: index("worker_email_invoice_line_items_material_idx").on(table.materialScheduleItemId),
  }),
);

export type WorkerEmailInvoiceLineItem = typeof workerEmailInvoiceLineItems.$inferSelect;
export type WorkerEmailInvoiceLineItemInsert = typeof workerEmailInvoiceLineItems.$inferInsert;
