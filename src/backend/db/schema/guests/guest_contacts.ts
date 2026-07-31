import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { showroomStores } from "../showroom/stores";

/**
 * A registered guest of the vendor portal (0043). A vendor/showroom hands over
 * their "digital business card" — first/last name, email, phone, company website
 * — to unlock the photos-only floor plan at remodel.hacolby.app.
 *
 * Identity is deliberately frictionless (no password): `cookieId` is an opaque
 * uuid set as the `remodel_guest` cookie. This grants access to the PUBLIC
 * portal surface ONLY — never any homeowner/admin data. Returning guests are
 * matched by `email` (unique) and passed straight through, no error.
 *
 * `resolvedShowroomId` / `placeId` are filled in later (P7) when we glean the
 * guest's showroom from their company website; both are nullable — a guest is a
 * person, not a store, until that resolution happens. FK, never a denormalized
 * store name.
 */
export const guestContacts = sqliteTable(
  "guest_contacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    /** Lowercased + trimmed on write; the frictionless identity key. */
    email: text("email").notNull(),
    phone: text("phone"),
    companyWebsiteUrl: text("company_website_url"),
    /** Opaque uuid == the `remodel_guest` cookie value. */
    cookieId: text("cookie_id").notNull(),
    /** Gleaned later (P7) from the company website; nullable FK, never a name. */
    resolvedShowroomId: integer("resolved_showroom_id").references(() => showroomStores.id),
    placeId: text("place_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    emailUnique: uniqueIndex("guest_contacts_email_unique").on(table.email),
    cookieIdx: uniqueIndex("guest_contacts_cookie_id_unique").on(table.cookieId),
  }),
);
