import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { workerEmails } from "./worker_emails";
import { companies } from "../directory/companies";

/**
 * Worker Email Staged Companies — when the AI agent processes an inbound
 * email and identifies a sender (contractor, architect, vendor) that does
 * NOT exist in the `companies` directory, it stages a record here for
 * HITL review.
 *
 * On confirmation, the HITL flow creates a real `companies` row and
 * backfills `worker_emails.matchedCompanyId`.
 *
 * On merge, the user picks an existing company and the staged record is
 * closed out.
 */
export const workerEmailStagedCompanies = sqliteTable(
  "worker_email_staged_companies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** The email that triggered this staging. */
    emailId: integer("email_id")
      .notNull()
      .references(() => workerEmails.id, { onDelete: "cascade" }),

    // ── AI-suggested fields ──────────────────────────────────────────────

    /** AI's best guess at the company name. */
    suggestedName: text("suggested_name"),
    /** Email address extracted from the original sender. */
    suggestedEmail: text("suggested_email"),
    /** Phone number if found in email signature. */
    suggestedPhone: text("suggested_phone"),
    /** Website if found in email signature. */
    suggestedWebsite: text("suggested_website"),
    /**
     * AI guess at the business type: "General Contractor", "Architect",
     * "Plumber", "Electrician", "Cabinet Maker", "Material Vendor", etc.
     */
    suggestedBusinessType: text("suggested_business_type"),
    /** Contractor license number if found in signature or body. */
    suggestedLicenseNumber: text("suggested_license_number"),

    // ── Lifecycle ────────────────────────────────────────────────────────

    /**
     *   staged    → AI created, awaiting human review
     *   confirmed → human confirmed → real company created
     *   merged    → human merged into existing company
     *   rejected  → human rejected (spam / not a real company)
     */
    status: text("status").notNull().default("staged"),

    /** FK to the real company created on confirm, or the existing company on merge. */
    confirmedCompanyId: integer("confirmed_company_id").references(
      () => companies.id,
      { onDelete: "set null" },
    ),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    emailIdx: index("worker_email_staged_companies_email_idx").on(table.emailId),
    statusIdx: index("worker_email_staged_companies_status_idx").on(table.status),
  }),
);

export type WorkerEmailStagedCompany = typeof workerEmailStagedCompanies.$inferSelect;
export type WorkerEmailStagedCompanyInsert = typeof workerEmailStagedCompanies.$inferInsert;
