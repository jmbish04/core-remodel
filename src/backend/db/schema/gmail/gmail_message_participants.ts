import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { gmailMessages } from "./gmail_messages";

/**
 * Gmail Comms Hub — Message Participants
 *
 * This is the indexed matching layer that resolves company↔thread relationships.
 * Every "from" and "to"/"cc" participant on an ingested Gmail message gets a
 * normalized row here, split out into a bare lowercased `email` address and its
 * lowercased `domain`. That split exists because contractor identity resolution
 * has two very different matching strategies depending on the provider:
 *
 *   - Private/company domains (e.g. "acmeplumbing.com") — match by DOMAIN.
 *     Any contact at that domain is presumed to belong to the same company, so
 *     a single indexed lookup on `domain` resolves every thread touched by
 *     anyone at that company, even contacts we've never seen before.
 *
 *   - Public/free providers (gmail.com, yahoo.com, hotmail.com, outlook.com,
 *     icloud.com, aol.com, etc.) — domain matching is useless (millions of
 *     unrelated people share the domain), so matching MUST fall back to the
 *     exact `email` address. A contractor may juggle several personal inboxes
 *     across different public providers, so each one needs its own indexed row.
 *
 * A contractor/company can therefore be resolved to a thread via either an
 * exact-email hit or a domain hit, without re-parsing message bodies/headers
 * at query time. Rows are populated at ingest time (as each message's
 * from/to/cc headers are parsed) and can be re-derived in bulk by a backfill
 * endpoint that walks `gmail_messages` for any rows missing their participant
 * rows.
 *
 * `threadId` is denormalized from `gmail_messages.threadId` (the Gmail-native
 * thread id string) so that domain/email matching can resolve straight to
 * distinct threads via an indexed lookup here, without a join back through
 * `gmail_messages` for every match.
 *
 * `messageId` IS a real FK (unlike the thread-id convention used elsewhere in
 * this domain) since these rows are pure provenance/derived data for a single
 * message — cascading delete keeps them from going stale/orphaned if a
 * message is ever purged.
 */
export const gmailMessageParticipants = sqliteTable(
  "gmail_message_participants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK to gmail_messages.id — cascades on delete for provenance cleanup. */
    messageId: integer("message_id")
      .notNull()
      .references(() => gmailMessages.id, { onDelete: "cascade" }),

    /**
     * Gmail-native thread id, denormalized from gmail_messages.threadId.
     * Not FK'd (matches the no-FK convention used for thread ids elsewhere
     * in this domain) — lets matching resolve to a thread without a join.
     */
    threadId: text("thread_id").notNull(),

    /** Lowercased bare email address (no display name / angle brackets). */
    email: text("email").notNull(),

    /** Lowercased domain portion of `email` (the part after "@"). */
    domain: text("domain").notNull(),

    /** "from" for the message sender, "to" for To+Cc recipients. */
    role: text("role", { enum: ["from", "to"] }).notNull(),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    emailIdx: index("gmail_message_participants_email_idx").on(table.email),
    domainIdx: index("gmail_message_participants_domain_idx").on(table.domain),
    threadIdx: index("gmail_message_participants_thread_id_idx").on(table.threadId),
    messageIdx: index("gmail_message_participants_message_id_idx").on(table.messageId),
    messageEmailRoleUnique: uniqueIndex("gmail_message_participants_message_email_role_unique").on(
      table.messageId,
      table.email,
      table.role,
    ),
  }),
);

export type GmailMessageParticipant = typeof gmailMessageParticipants.$inferSelect;
export type GmailMessageParticipantInsert = typeof gmailMessageParticipants.$inferInsert;
