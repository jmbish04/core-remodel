import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// Direct leaf imports — avoid a circular reference through the showroom barrel.
import { showroomStores } from "./stores";
import { showroomStoreLocations } from "./store_location";

/**
 * Showroom Store Contacts — people and general contact points for a showroom.
 *
 * Replaces the thin `showroom_pocs` table and the denormalized `main_poc_*`
 * columns. A store has:
 *   - at most one `GENERAL_CONTACT` row (the store's front-desk / office line,
 *     email, fax — no person attached), and
 *   - any number of person rows (`SALES`, `ESTIMATOR`, `MANAGER`,
 *     `CUSTOMER_SERVICE`, `OTHER`) with first/last name.
 *
 * The API/MCP write layer "fields out" a submitted payload: person details go
 * to a person row; a supplied office number/email/fax upserts the store's
 * GENERAL_CONTACT row (fill-missing, never duplicated); a website/address go to
 * the links table / store row respectively — the caller never has to know that.
 *
 * When a submission can't be matched to a store even by fuzzy lookup the row is
 * saved with `is_draft = true` and `draft_notes` describing the likely store,
 * for human resolution.
 */
export const showroomStoreContacts = sqliteTable(
  "showroom_store_contacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → showroom_stores.id; nullable so a draft (unmatched) contact can exist. */
    storeId: integer("store_id").references(() => showroomStores.id, {
      onDelete: "cascade",
    }),

    /** When this contact was added to the system. */
    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** What this contact represents. GENERAL_CONTACT = the store itself, no person. */
    type: text("type", {
      enum: [
        "GENERAL_CONTACT",
        "SALES",
        "ESTIMATOR",
        "MANAGER",
        "CUSTOMER_SERVICE",
        "OTHER",
      ],
    }).notNull(),

    /** General notes about the contact. */
    notes: text("notes"),

    /** Given name — blank for GENERAL_CONTACT. */
    firstName: text("first_name"),
    /** Family name — blank for GENERAL_CONTACT. */
    lastName: text("last_name"),

    /** Office / main line. For GENERAL_CONTACT this is the store's main number. */
    officePhoneNumber: text("office_phone_number"),
    /** Extension when the office number is a directory / 1-800 line. */
    officePhoneExtension: text("office_phone_extension"),
    mobilePhoneNumber: text("mobile_phone_number"),
    faxPhoneNumber: text("fax_phone_number"),
    emailAddress: text("email_address"),

    /** Some contacts prefer texting. */
    isTextingOk: integer("is_texting_ok", { mode: "boolean" }).notNull().default(false),

    /**
     * Free-form availability the contact described — arbitrary structure, e.g.
     * `{ "note": "on the floor Mon/Fri, checks email Tue–Thu", "by": { ... } }`.
     * Kept as JSON so complex "call me here on these days" rules survive.
     */
    bestContactTimesJson: text("best_contact_times_json", { mode: "json" }).$type<
      Record<string, unknown>
    >(),

    /** True when this contact could not be matched to a store (needs human triage). */
    isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
    /** Why it's a draft / which store it probably belongs to. */
    draftNotes: text("draft_notes"),

    /**
     * Physical site this contact belongs to — a sales rep / estimator works at ONE
     * location, and a GENERAL_CONTACT front-desk line is per-site. Nullable =
     * brand-level or legacy. ON DELETE SET NULL so merging/closing a site loosens the
     * contact to brand-level rather than deleting it. Backfilled to the store's
     * primary location. FK → showroom_store_locations.
     */
    locationId: integer("location_id").references(() => showroomStoreLocations.id, {
      onDelete: "set null",
    }),
    /**
     * The store's PRIMARY contact for this site (at most one per location — see the
     * partial-unique index) — who a homeowner should reach first. Migrated main POCs
     * carry this.
     */
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    storeIdx: index("showroom_store_contacts_store_idx").on(t.storeId),
    typeIdx: index("showroom_store_contacts_type_idx").on(t.type),
    draftIdx: index("showroom_store_contacts_draft_idx").on(t.isDraft),
    locationIdx: index("showroom_store_contacts_location_idx").on(t.locationId),
    // At most one GENERAL_CONTACT front-desk line per SITE (plan §17.F). A null
    // location_id (brand-level) row is NULL-distinct in SQLite so it is not
    // constrained here — intentional (a brand may keep a general line + per-site ones).
    oneGeneralPerLocation: uniqueIndex("ssc_one_general_per_location")
      .on(t.storeId, t.locationId)
      .where(sql`type = 'GENERAL_CONTACT' AND is_draft = 0`),
    // At most one primary contact per site.
    onePrimaryPerLocation: uniqueIndex("ssc_one_primary_per_location")
      .on(t.storeId, t.locationId)
      .where(sql`is_primary = 1 AND is_draft = 0`),
  }),
);

/**
 * Showroom Store Contact Log — a record of every interaction with a store
 * contact: what was said, when, and the outcome. Emails and texts carry a
 * transcript; phone calls may too.
 */
export const showroomStoreContactLog = sqliteTable(
  "showroom_store_contact_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → showroom_stores.id. */
    storeId: integer("store_id").references(() => showroomStores.id, {
      onDelete: "cascade",
    }),
    /** FK → showroom_store_contacts.id — who was contacted. */
    storeContactId: integer("store_contact_id").references(
      () => showroomStoreContacts.id,
      { onDelete: "set null" },
    ),

    /** When the interaction was recorded in the system. */
    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** When the call/email/text actually started / ended. */
    timestampContactStart: integer("timestamp_contact_start", { mode: "timestamp" }),
    timestampContactEnd: integer("timestamp_contact_end", { mode: "timestamp" }),
    /** Estimated duration (minutes) when exact timestamps aren't known. */
    estimatedCallDuration: integer("estimated_call_duration"),

    /**
     * Transcript — filled for emails/texts, sometimes for calls. Arbitrary
     * structure (array of turns, or a raw thread), kept as JSON.
     */
    transcriptJson: text("transcript_json", { mode: "json" }).$type<unknown>(),

    contextOfConversation: text("context_of_conversation"),
    outcomeOfConversation: text("outcome_of_conversation"),

    isFollowupNeeded: integer("is_followup_needed", { mode: "boolean" })
      .notNull()
      .default(false),
    followupNotes: text("followup_notes"),
    /** Store notes from the call / conversation. */
    notes: text("notes"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    storeIdx: index("showroom_store_contact_log_store_idx").on(t.storeId),
    contactIdx: index("showroom_store_contact_log_contact_idx").on(t.storeContactId),
  }),
);

/**
 * Showroom Store Contact Business Cards — one row per uploaded business-card
 * image processed by the vision pipeline. The image is stored in Cloudflare
 * Images and the structured vision output is retained for audit / re-parse.
 *
 * `is_draft = true` means extraction wasn't enough to create a contact (or the
 * store couldn't be matched); `draft_notes` says why, and an external agent can
 * later re-process the card (from `cf_image_url`) and back-fill `contact_id`.
 */
export const showroomStoreContactBusinessCards = sqliteTable(
  "showroom_store_contact_business_cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** FK → showroom_stores.id (nullable until a store is matched). */
    storeId: integer("store_id").references(() => showroomStores.id, {
      onDelete: "set null",
    }),
    /** FK → showroom_store_contacts.id — the contact created from this card. */
    contactId: integer("contact_id").references(() => showroomStoreContacts.id, {
      onDelete: "set null",
    }),

    /**
     * Processing state:
     * - "pending"    — uploaded, queued for vision extraction.
     * - "processing" — the vision model is running.
     * - "done"       — a contact was created/matched.
     * - "failed"     — extraction couldn't produce a usable contact.
     */
    status: text("status", {
      enum: ["pending", "processing", "done", "failed"],
    })
      .notNull()
      .default("pending"),

    /** True when the card couldn't produce a contact (needs manual entry). */
    isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
    /** Rationale when the card is a draft / failed. */
    draftNotes: text("draft_notes"),

    /** Cloudflare Images delivery URL of the card FRONT image. */
    cfImageUrl: text("cf_image_url"),
    /** Cloudflare Images delivery URL of the card BACK image (optional). */
    cfImageUrlBack: text("cf_image_url_back"),

    /** The raw structured JSON returned by the vision model. */
    imageJson: text("image_json", { mode: "json" }).$type<Record<string, unknown>>(),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    storeIdx: index("showroom_store_contact_cards_store_idx").on(t.storeId),
    statusIdx: index("showroom_store_contact_cards_status_idx").on(t.status),
  }),
);

export type ShowroomStoreContact = typeof showroomStoreContacts.$inferSelect;
export type ShowroomStoreContactInsert = typeof showroomStoreContacts.$inferInsert;
export type ShowroomStoreContactLog = typeof showroomStoreContactLog.$inferSelect;
export type ShowroomStoreContactLogInsert = typeof showroomStoreContactLog.$inferInsert;
export type ShowroomStoreContactBusinessCard =
  typeof showroomStoreContactBusinessCards.$inferSelect;
export type ShowroomStoreContactBusinessCardInsert =
  typeof showroomStoreContactBusinessCards.$inferInsert;
