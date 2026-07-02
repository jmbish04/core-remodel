import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Direct leaf import — avoids circular reference through the showroom barrel
import { showroomStores } from "./stores";

/**
 * Showroom POCs (Points of Contact) — contacts captured during a showroom visit.
 *
 * Typically sourced from a business card scan + Workers AI structured extraction.
 * One showroom may have many POCs (sales reps, design consultants, managers).
 * Soft-deleted via `isActive`.
 */
export const showroomPocs = sqliteTable("showroom_pocs", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /**
   * The showroom location this contact belongs to.
   * Cascades to delete when the store row is removed.
   */
  showroomId: integer("showroom_id")
    .notNull()
    .references(() => showroomStores.id, { onDelete: "cascade" }),

  // ── Contact identity ───────────────────────────────────────────────────
  /** Full name as extracted from the business card (e.g. "Jane Smith"). */
  fullName: text("full_name"),

  /** Job title as printed on the card (e.g. "Senior Design Consultant"). */
  title: text("title"),

  /** Company name as printed on the card. May differ from the store name. */
  company: text("company"),

  /** Phone number as extracted from the card (raw string, no normalization). */
  phone: text("phone"),

  /** Email address as extracted from the card. */
  email: text("email"),

  /** Website URL as extracted from the card. */
  website: text("website"),

  /** Mailing or office address as extracted from the card. */
  address: text("address"),

  // ── Business card media ────────────────────────────────────────────────
  /**
   * Cloudflare Images delivery URL for the front-of-card photo.
   * Example: "https://imagedelivery.net/<accountHash>/<imageId>/public"
   */
  businessCardFrontUrl: text("business_card_front_url"),

  /**
   * Cloudflare Images delivery URL for the back-of-card photo.
   * Null when the card has no meaningful back side.
   */
  businessCardBackUrl: text("business_card_back_url"),

  /**
   * Raw Workers AI structured extraction output from the business card image.
   * Stored verbatim so the UI can surface confidence scores or re-parse if
   * the extraction model is upgraded.
   */
  extractedJson: text("extracted_json", { mode: "json" }),

  // ── Lifecycle ──────────────────────────────────────────────────────────
  /** Soft delete — set false to hide a contact without destroying the row. */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),

  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ShowroomPoc = typeof showroomPocs.$inferSelect;
export type ShowroomPocInsert = typeof showroomPocs.$inferInsert;
