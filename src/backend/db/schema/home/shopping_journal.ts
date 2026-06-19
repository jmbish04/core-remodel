import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { researchSessions } from "../admin/research_sessions";
import { showroomStores } from "../showroom/stores";

/**
2026-05-31: Shopping Journal Entry Table
Tracks user shopping trips, contractor showroom visits, and business details.
*/
export const shoppingJournalEntries = sqliteTable("shopping_journal_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  
  // Business/Showroom details
  companyName: text("company_name").notNull(),

  /** Optional FK to a tracked showroom store (store:journal_entries [1:M]). */
  storeId: integer("store_id").references(() => showroomStores.id, { onDelete: "set null" }),

  phoneNumber: text("phone_number"),
  email: text("email"),
  website: text("website"),
  contactPerson: text("contact_person"),
  address: text("address"),
  
  // PlateJS rich text notes (JSON representation or HTML string)
  notes: text("notes"),
  
  // Link to AI Deep Research session (nullable)
  researchSessionId: integer("research_session_id").references(() => researchSessions.id, { onDelete: "set null" }),
  
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
Shopping Journal Attachments Table
Tracks uploaded photos, documents, and other materials.
*/
export const journalAttachments = sqliteTable("journal_attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  
  journalEntryId: integer("journal_entry_id")
    .notNull()
    .references(() => shoppingJournalEntries.id, { onDelete: "cascade" }),
  
  // File details
  type: text("type").notNull(), // 'photo', 'pdf', 'docx', etc.
  hostingService: text("hosting_service", { enum: ["cloudflare_images", "r2"] }).notNull(),
  url: text("url").notNull(), // Delivery URL (cloudflare images variant or /api/artifacts/ key)
  
  // Internal reference IDs
  r2Key: text("r2_key"),
  cfImageId: text("cf_image_id"),
  
  // Workers AI Vision generated description
  aiDescription: text("ai_description"),
  
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ShoppingJournalEntry = typeof shoppingJournalEntries.$inferSelect;
export type ShoppingJournalEntryInsert = typeof shoppingJournalEntries.$inferInsert;

export type JournalAttachment = typeof journalAttachments.$inferSelect;
export type JournalAttachmentInsert = typeof journalAttachments.$inferInsert;
