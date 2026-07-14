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
      .where(like(showroomStores.emailAddress, `%@${domain}`))
      .limit(1);
    if (byEmail) return byEmail.id;
  }

  if (senderName && senderName.trim().length >= 3) {
    const [byName] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(like(showroomStores.name, `%${senderName.trim()}%`))
      .limit(1);
    if (byName) return byName.id;
  }

  return null;
}

/**
 * Auto-register a showroom contact from an inbound email sender. Maps to a
 * showroom when one matches the domain/name; otherwise saves a DRAFT contact so
 * the HITL inbox can map it. Deduplicates on sender email. Never throws — the
 * caller wraps this so it can never break classification.
 */
export async function registerShowroomContactFromEmail(
  senderEmail: string | null,
  senderName: string | null,
  senderPhone: string | null,
  senderWebsite: string | null,
  env: Env,
): Promise<void> {
  if (!senderEmail) return;
  const db = drizzle(env.DB);

  // Dedup: skip when a contact already carries this email.
  const [existing] = await db
    .select({ id: showroomStoreContacts.id })
    .from(showroomStoreContacts)
    .where(eq(showroomStoreContacts.emailAddress, senderEmail.toLowerCase()))
    .limit(1);
  if (existing) return;

  const storeId = await matchShowroomStore(senderEmail, senderName, env);

  await fieldOutContacts(
    db,
    {
      storeId: storeId ?? undefined,
      match: { name: senderName ?? undefined, website: senderWebsite ?? undefined },
      people: [
        {
          fullName: senderName ?? undefined,
          emailAddress: senderEmail.toLowerCase(),
          phone: senderPhone ?? undefined,
          type: "OTHER",
          notes: `Auto-added from inbound email${senderWebsite ? ` · site ${senderWebsite}` : ""}`,
        },
      ],
      urls: senderWebsite ? [{ url: senderWebsite, type: "WEBSITE" }] : undefined,
    },
    env,
  );
}
