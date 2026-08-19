/**
 * @fileoverview Auto-populate showroom contacts from inbound email senders.
 *
 * Called by the email pipeline (Phase 6) only when the sender did NOT match a
 * directory company — a matched company is already handled by the company CRM.
 * Maps the sender to a showroom by their email domain (against the store's
 * WEBSITE link or email column) or a fuzzy name match; when nothing matches the
 * contact is saved as a DRAFT (is_draft, via fieldOutContacts) so the HITL inbox
 * can map it to a showroom or spin up a new one. Deduplicates on sender email.
 */

import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  showroomStores,
  showroomStoreLinks,
  showroomStoreContacts,
} from "@backend/db/schema/showroom/index";
import { fieldOutContacts } from "@backend/api/routes/showroom-contacts";
import { inferContactType, parseEmailIdentity } from "@backend/utils/contact-intake";
import { evaluateContactWorthiness } from "@backend/utils/contact-person-gate";

/** Free/public email providers never domain-match a store. */
const PUBLIC_EMAIL_DOMAINS = new Set<string>([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "me.com", "proton.me",
]);

/**
 * Try to match an inbound sender to a showroom store by their email domain
 * (against the store's WEBSITE link domain / email column) or a fuzzy name
 * match. Returns the store id, or null. Public providers never domain-match.
 */
export async function matchShowroomStore(
  senderEmail: string | null,
  senderName: string | null,
  env: Env,
): Promise<number | null> {
  if (!senderEmail) return null;
  const db = drizzle(env.DB);
  const domain = senderEmail.split("@")[1]?.toLowerCase();

  if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
    const [link] = await db
      .select({ storeId: showroomStoreLinks.storeId })
      .from(showroomStoreLinks)
      .where(and(eq(showroomStoreLinks.type, "WEBSITE"), like(showroomStoreLinks.url, `%${domain}%`)))
      .limit(1);
    if (link) return link.storeId;

    // Also match the store's own email column on the same domain.
    const [byEmail] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(
        and(
          like(showroomStores.emailAddress, `%@${domain}`),
          eq(showroomStores.isActive, true),
        ),
      )
      .limit(1);
    if (byEmail) return byEmail.id;
  }

  if (senderName && senderName.trim().length >= 3) {
    const [byName] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(
        and(
          like(showroomStores.name, `%${senderName.trim()}%`),
          eq(showroomStores.isActive, true),
        ),
      )
      .limit(1);
    if (byName) return byName.id;
  }

  return null;
}

/** What the email pipeline hands us about an inbound sender. */
export interface InboundSender {
  /** Raw From value — may be `Name <addr>`; parsed into name + clean address. */
  senderEmail: string | null;
  /** The From display name, when the header carried one (used by the person gate). */
  fromDisplayName?: string | null;
  /** That person's job title/role, when the AI read one from the signature. */
  contactTitle?: string | null;
  /** The sending COMPANY — used only to match a store, never as the person name. */
  companyName?: string | null;
  senderPhone?: string | null;
  senderWebsite?: string | null;
  /** Plain-text body — scanned (no AI) for a signature name + bulk-mail tells. */
  bodyText?: string | null;
  /** True when the message carried a `List-Unsubscribe` header (bulk mail). */
  listUnsubscribe?: boolean;
}

/**
 * Auto-register a showroom contact from an inbound email sender. Maps to a
 * showroom when one matches the domain/name; otherwise saves a DRAFT contact so
 * the HITL inbox can map it. Deduplicates on the sender's clean email. Never
 * throws — the caller wraps this so it can never break classification.
 *
 * A deterministic worker-code gate (`evaluateContactWorthiness`, NO AI) decides
 * whether the sender is worth a contact at all: automated `no-reply@` mailers,
 * bulk/marketing blasts (unsubscribe / List-Unsubscribe / view-in-browser), and
 * senders with no identifiable PERSON are skipped — the email is still captured
 * upstream, we just don't mint a phonebook contact. When it passes, the row
 * stores the PERSON — a title-cased name (From display or body signature) + a
 * clean `local@domain` email. The company name only feeds store matching.
 */
export async function registerShowroomContactFromEmail(
  sender: InboundSender,
  env: Env,
): Promise<void> {
  if (!sender.senderEmail) return;

  // Split `Name <addr>` into a display name + a clean lowercased address.
  const { email } = parseEmailIdentity(sender.senderEmail);
  if (!email) return;

  // Deterministic gate: is this a PERSON worth a contact, and what's their name?
  // Rejects our own addresses, automated senders, bulk mail, and no-person mail.
  const verdict = evaluateContactWorthiness({
    fromEmail: sender.senderEmail,
    fromDisplayName: sender.fromDisplayName,
    bodyText: sender.bodyText,
    listUnsubscribe: sender.listUnsubscribe,
  });
  if (!verdict.create) {
    console.log(`[autopopulate] no contact for ${email}: ${verdict.reason}`);
    return;
  }
  const personName = verdict.personName;

  const db = drizzle(env.DB);

  // Dedup: skip when a contact already carries this (clean) email.
  const [existing] = await db
    .select({ id: showroomStoreContacts.id })
    .from(showroomStoreContacts)
    .where(eq(showroomStoreContacts.emailAddress, email))
    .limit(1);
  if (existing) return;

  // Match the store by email domain, then company name — NEVER the person name
  // (a surname can collide with an unrelated showroom name). personName is for
  // the contact row only.
  const storeId = await matchShowroomStore(email, sender.companyName ?? null, env);

  await fieldOutContacts(
    db,
    {
      storeId: storeId ?? undefined,
      match: { name: sender.companyName ?? undefined, website: sender.senderWebsite ?? undefined },
      people: [
        {
          fullName: personName ?? undefined,
          title: sender.contactTitle ?? undefined,
          emailAddress: email,
          phone: sender.senderPhone ?? undefined,
          type: inferContactType(sender.contactTitle, email),
          notes: `Auto-added from inbound email${sender.senderWebsite ? ` · site ${sender.senderWebsite}` : ""}`,
        },
      ],
      urls: sender.senderWebsite ? [{ url: sender.senderWebsite, type: "WEBSITE" }] : undefined,
    },
    env,
  );
}
