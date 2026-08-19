import type { drizzle } from "drizzle-orm/d1";

/**
 * @fileoverview Resolve a vendor-email recipient — an explicit address passes
 * through (validated); a store + optional contact reference is looked up in
 * showroom_store_contacts. An unresolvable or ambiguous reference returns a
 * structured result with candidates; it NEVER guesses or silently drops one.
 */
import { showroomStores, showroomStoreContacts } from "@backend/db";
import { eq, like } from "drizzle-orm";

export interface ResolvedRecipient {
  email: string;
  name: string | null;
  storeId: number | null;
  storeName: string | null;
  contactType: string | null;
}

export type ResolveResult =
  | { ok: true; recipients: ResolvedRecipient[] }
  | {
      ok: false;
      reason: "no_match" | "ambiguous" | "invalid";
      message: string;
      candidates: ResolvedRecipient[];
    };

/** Pragmatic RFC-ish check: one @, no spaces, a dotted domain with a TLD. */
export function isValidEmail(s: string): boolean {
  if (s !== s.trim() || s.length === 0) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s);
}

function fullName(first: string | null, last: string | null): string | null {
  const n = [first, last].filter(Boolean).join(" ").trim();
  return n.length > 0 ? n : null;
}

export async function resolveRecipient(
  db: ReturnType<typeof drizzle>,
  input: { email?: string; store?: string; contact?: string },
): Promise<ResolveResult> {
  // 1. Explicit address wins.
  if (input.email) {
    if (!isValidEmail(input.email)) {
      return {
        ok: false,
        reason: "invalid",
        message: `not a valid email: ${input.email}`,
        candidates: [],
      };
    }
    return {
      ok: true,
      recipients: [
        { email: input.email, name: null, storeId: null, storeName: null, contactType: null },
      ],
    };
  }

  if (!input.store) {
    return {
      ok: false,
      reason: "invalid",
      message: "provide an email, or a store (+ optional contact)",
      candidates: [],
    };
  }

  // 2. Match the store by exact id or name substring.
  const storeIdNum = Number(input.store);
  const storeRows = await db
    .select({ id: showroomStores.id, name: showroomStores.name })
    .from(showroomStores)
    .where(
      Number.isFinite(storeIdNum)
        ? eq(showroomStores.id, storeIdNum)
        : like(showroomStores.name, `%${input.store}%`),
    )
    .limit(10);

  if (storeRows.length === 0) {
    return {
      ok: false,
      reason: "no_match",
      message: `no store matched "${input.store}"`,
      candidates: [],
    };
  }
  if (storeRows.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      message: `"${input.store}" matched ${storeRows.length} stores; be specific`,
      candidates: storeRows.map((s) => ({
        email: "",
        name: s.name,
        storeId: s.id,
        storeName: s.name,
        contactType: null,
      })),
    };
  }

  const store = storeRows[0];

  // 3. Contacts on that store WITH an email address.
  const contacts = await db
    .select({
      email: showroomStoreContacts.emailAddress,
      firstName: showroomStoreContacts.firstName,
      lastName: showroomStoreContacts.lastName,
      type: showroomStoreContacts.type,
    })
    .from(showroomStoreContacts)
    .where(eq(showroomStoreContacts.storeId, store.id));

  let withEmail = contacts.filter((c) => c.email && isValidEmail(c.email));

  // Narrow by contact name/type substring if given.
  if (input.contact) {
    const needle = input.contact.toLowerCase();
    withEmail = withEmail.filter((c) =>
      [c.firstName, c.lastName, c.type].some((v) => v?.toLowerCase().includes(needle)),
    );
  }

  const toResolved = (c: (typeof withEmail)[number]): ResolvedRecipient => ({
    email: c.email as string,
    name: fullName(c.firstName, c.lastName),
    storeId: store.id,
    storeName: store.name,
    contactType: c.type ?? null,
  });

  if (withEmail.length === 0) {
    return {
      ok: false,
      reason: "no_match",
      message: input.contact
        ? `no contact matching "${input.contact}" with an email at ${store.name}`
        : `no contact with an email at ${store.name}`,
      candidates: [],
    };
  }
  if (withEmail.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      message: `${withEmail.length} contacts at ${store.name} match; name the person`,
      candidates: withEmail.map(toResolved),
    };
  }
  return { ok: true, recipients: [toResolved(withEmail[0])] };
}
