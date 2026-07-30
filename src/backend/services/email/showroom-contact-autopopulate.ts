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
import { isExcludedSender } from "@backend/services/gmail/ingest-gate-domains";
import {
  inferContactType,
  looksLikePersonName,
  parseEmailIdentity,
  titleCaseName,
} from "@backend/utils/contact-intake";

/** Free/public email providers never domain-match a store. */
const PUBLIC_EMAIL_DOMAINS = new Set<string>([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "me.com", "proton.me",
]);

/**
 * Try to match an inbound sender to a showroom store by their email domain
 * (against the store's WEBSITE link domain / email column) or a fuzzy name
 * match. Returns the store id, or null. Public providers never domain-match.
 */
async function matchShowroomStore(
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
  /** The PERSON's name (AI signature read or From display name) — NOT the company. */
  contactName?: string | null;
  /** That person's job title/role, when the AI read one from the signature. */
  contactTitle?: string | null;
  /** The sending COMPANY — used only to match a store, never as the person name. */
  companyName?: string | null;
  senderPhone?: string | null;
  senderWebsite?: string | null;
}

/**
 * Auto-register a showroom contact from an inbound email sender. Maps to a
 * showroom when one matches the domain/name; otherwise saves a DRAFT contact so
 * the HITL inbox can map it. Deduplicates on the sender's clean email. Never
 * throws — the caller wraps this so it can never break classification.
 *
 * The person row stores the PERSON — a title-cased name from the signature/From
 * display and a clean `local@domain` email. The company name only ever feeds
 * store matching (the store owns the company identity); it is never written as
 * the contact's name. When no real person name is present (automated / role
 * mailers) the name is left null so the card falls back to the store name.
 */
export async function registerShowroomContactFromEmail(
  sender: InboundSender,
  env: Env,
): Promise<void> {
  if (!sender.senderEmail) return;

  // Never auto-register OURSELVES as a vendor contact. justin@126colby.com (and
  // our personal Gmail addresses) sit on every vendor thread; without this guard
  // the sender gets added as a "contact" under whichever showroom the thread
  // matched — e.g. Justin logged as a Pietra Fina contact.
  if (isExcludedSender(sender.senderEmail)) return;

  // Split `Name <addr>` into a display name + a clean lowercased address.
  const { displayName, email } = parseEmailIdentity(sender.senderEmail);
  if (!email) return;

  // Person name: prefer the AI-read signature name, else the From display name —
  // but only when it actually looks like a person (not "Kohler Customer Care").
  const rawName = sender.contactName?.trim() || displayName;
  const personName =
    rawName && looksLikePersonName(rawName) ? titleCaseName(rawName) : null;

  const db = drizzle(env.DB);

  // Dedup: skip when a contact already carries this (clean) email.
  const [existing] = await db
    .select({ id: showroomStoreContacts.id })
    .from(showroomStoreContacts)
    .where(eq(showroomStoreContacts.emailAddress, email))
    .limit(1);
  if (existing) return;

  // Match the store by company name / person name / domain (company preferred).
  const storeId = await matchShowroomStore(email, sender.companyName || personName, env);

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
