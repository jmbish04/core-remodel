/**
 * @fileoverview Showroom contacts API — the phonebook back end.
 *
 * `showroom_store_contacts` (people + a per-store GENERAL_CONTACT), plus the
 * interaction log and business-card records. Callers send a structured payload
 * and the worker "fields it out": people → person rows, a general office
 * number/email/fax → the store's GENERAL_CONTACT (fill-missing, never
 * duplicated), URLs → the links table, an address → the store row. A store can
 * be given explicitly or resolved by fuzzy match; unmatched contacts are saved
 * as drafts for human triage.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";

import {
  showroomStores,
  showroomStoreContacts,
  showroomStoreContactLog,
  showroomStoreContactBusinessCards,
  showroomStoreLinks,
  showroomPocs,
} from "@backend/db/schema/showroom/index";
import { loadStoreLocations } from "@backend/services/showroom/locations";
import {
  CONTACT_TYPES,
  inferContactType,
  parsePhoneField,
  splitFullName,
  type ContactType,
} from "@backend/utils/contact-intake";
import {
  SHOWROOM_LINK_TYPES,
  type ShowroomLinkType,
} from "@backend/utils/showroom-links";
import { businessCardService } from "@backend/services/business-card";

type Db = ReturnType<typeof drizzle>;

// D1 rejects a query with >100 bound params; chunk `inArray` id lists below it.
const D1_IN_CHUNK = 90;

export const showroomContactsRouter = new OpenAPIHono<{ Bindings: Env }>();

// ─── Fuzzy store matching ─────────────────────────────────────────────────────

/**
 * Resolve a store id from whatever hints the caller has. Tries, in order:
 * explicit id, Google place_id, a website domain (via the links table), a
 * phone-number tail match, then a name LIKE. Returns null when nothing matches.
 */
async function matchStore(
  db: Db,
  hints: {
    storeId?: number | null;
    placeId?: string | null;
    website?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    name?: string | null;
  },
): Promise<number | null> {
  if (hints.storeId && Number.isInteger(hints.storeId)) {
    const [s] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(eq(showroomStores.id, hints.storeId))
      .limit(1);
    if (s) return s.id;
  }

  if (hints.placeId) {
    const [s] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(eq(showroomStores.placeId, hints.placeId))
      .limit(1);
    if (s) return s.id;
  }

  if (hints.website) {
    const domain = domainOf(hints.website);
    if (domain) {
      const [l] = await db
        .select({ storeId: showroomStoreLinks.storeId })
        .from(showroomStoreLinks)
        .where(and(eq(showroomStoreLinks.type, "WEBSITE"), like(showroomStoreLinks.url, `%${domain}%`)))
        .limit(1);
      if (l) return l.storeId;
    }
  }

  if (hints.phone) {
    const tail = digitsTail(hints.phone, 7);
    if (tail) {
      // Stored numbers may carry formatting like "(415) 555-0100", so a plain
      // `%5550100%` never matches. Put a `%` between each tail digit so any
      // non-digit separators between them are tolerated.
      // ponytail: over-matches across the string (digits non-contiguous), fine
      // for a 7-digit fuzzy tail; tighten with a normalized column if it misfires.
      const pattern = `%${tail.split("").join("%")}%`;
      const [s] = await db
        .select({ id: showroomStores.id })
        .from(showroomStores)
        .where(
          and(like(showroomStores.phoneNumber, pattern), eq(showroomStores.isActive, true)),
        )
        .limit(1);
      if (s) return s.id;
    }
  }

  if (hints.email) {
    const domain = hints.email.split("@")[1]?.toLowerCase();
    if (domain) {
      const [s] = await db
        .select({ id: showroomStores.id })
        .from(showroomStores)
        .where(
          and(
            like(showroomStores.emailAddress, `%@${domain}`),
            eq(showroomStores.isActive, true),
          ),
        )
        .limit(1);
      if (s) return s.id;
    }
  }

  if (hints.address && hints.address.trim().length >= 6) {
    const [s] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(
        and(
          like(showroomStores.locationAddress, `%${hints.address.trim()}%`),
          eq(showroomStores.isActive, true),
        ),
      )
      .limit(1);
    if (s) return s.id;
  }

  if (hints.name && hints.name.trim().length >= 3) {
    const [s] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(
        and(
          like(showroomStores.name, `%${hints.name.trim()}%`),
          eq(showroomStores.isActive, true),
        ),
      )
      .limit(1);
    if (s) return s.id;
  }

  return null;
}

function domainOf(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function digitsTail(phone: string, n: number): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= n ? digits.slice(-n) : null;
}

// ─── GENERAL_CONTACT upsert ───────────────────────────────────────────────────

/**
 * Ensure the store has a GENERAL_CONTACT row and fill any missing office / fax /
 * email fields on it (never overwrites an existing value). No-op when the store
 * already has all the supplied fields, or nothing was supplied.
 */
async function upsertGeneralContact(
  db: Db,
  storeId: number,
  fields: {
    officePhoneNumber?: string | null;
    officePhoneExtension?: string | null;
    faxPhoneNumber?: string | null;
    emailAddress?: string | null;
  },
): Promise<void> {
  const has = Object.values(fields).some((v) => v && String(v).trim());
  if (!has) return;

  const [existing] = await db
    .select()
    .from(showroomStoreContacts)
    .where(and(eq(showroomStoreContacts.storeId, storeId), eq(showroomStoreContacts.type, "GENERAL_CONTACT")))
    .limit(1);

  if (!existing) {
    await db.insert(showroomStoreContacts).values({
      storeId,
      type: "GENERAL_CONTACT",
      officePhoneNumber: fields.officePhoneNumber?.trim() || null,
      officePhoneExtension: fields.officePhoneExtension?.trim() || null,
      faxPhoneNumber: fields.faxPhoneNumber?.trim() || null,
      emailAddress: fields.emailAddress?.trim() || null,
    });
    return;
  }

  const patch: Record<string, string> = {};
  if (!existing.officePhoneNumber && fields.officePhoneNumber?.trim())
    patch.officePhoneNumber = fields.officePhoneNumber.trim();
  if (!existing.officePhoneExtension && fields.officePhoneExtension?.trim())
    patch.officePhoneExtension = fields.officePhoneExtension.trim();
  if (!existing.faxPhoneNumber && fields.faxPhoneNumber?.trim())
    patch.faxPhoneNumber = fields.faxPhoneNumber.trim();
  if (!existing.emailAddress && fields.emailAddress?.trim())
    patch.emailAddress = fields.emailAddress.trim();

  if (Object.keys(patch).length > 0) {
    await db
      .update(showroomStoreContacts)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(showroomStoreContacts.id, existing.id));
  }
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const personSchema = z.object({
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  /** Full name — split into first/last when first/last are absent. */
  fullName: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  type: z.enum(CONTACT_TYPES as [string, ...string[]]).optional(),
  /** Raw phone string (may pack several labeled numbers) — parsed if provided. */
  phone: z.string().optional().nullable(),
  mobilePhoneNumber: z.string().optional().nullable(),
  officePhoneNumber: z.string().optional().nullable(),
  officePhoneExtension: z.string().optional().nullable(),
  faxPhoneNumber: z.string().optional().nullable(),
  emailAddress: z.string().optional().nullable(),
  isTextingOk: z.boolean().optional(),
  bestContactTimesJson: z.record(z.string(), z.unknown()).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const createContactsSchema = z.object({
  storeId: z.number().int().optional().nullable(),
  /** Fuzzy-match hints when storeId is unknown. */
  match: z
    .object({
      placeId: z.string().optional().nullable(),
      website: z.string().optional().nullable(),
      phone: z.string().optional().nullable(),
      name: z.string().optional().nullable(),
    })
    .optional(),
  /** One or more people to create as person contacts. */
  people: z.array(personSchema).optional(),
  /** Store-level general contact info (office line / email / fax). */
  general: z
    .object({
      officePhoneNumber: z.string().optional().nullable(),
      officePhoneExtension: z.string().optional().nullable(),
      faxPhoneNumber: z.string().optional().nullable(),
      emailAddress: z.string().optional().nullable(),
    })
    .optional(),
  /** URLs to attach to the store (website/socials) → links table. */
  urls: z
    .array(z.object({ url: z.string().min(1), type: z.string(), urlNotes: z.string().optional().nullable() }))
    .optional(),
  /** Office address → filled onto the store row when blank. */
  address: z.string().optional().nullable(),
  /**
   * Generic SHOWROOM details that a business card carries but that belong to the
   * store, not the person (name, address, website + socials, phone, email). When
   * present these are used to fuzzy-match the store AND to fill any missing
   * store fields (fill-blanks: never overwrite existing data): address → the
   * store row, website/socials → the links table, phone/email → the store row +
   * the GENERAL_CONTACT. Optional — most contacts won't carry them.
   */
  showroom: z
    .object({
      name: z.string().optional().nullable(),
      address: z.string().optional().nullable(),
      website: z.string().optional().nullable(),
      phone: z.string().optional().nullable(),
      email: z.string().optional().nullable(),
      instagram: z.string().optional().nullable(),
      facebook: z.string().optional().nullable(),
      pinterest: z.string().optional().nullable(),
    })
    .optional(),
  /**
   * Optional business-card images (base64 `data:` URLs). Front and/or back —
   * either may be omitted. Uploaded to Cloudflare Images and attached to the
   * first created person contact as a business_cards row. Lets a Python script
   * or an MCP client bulk-import contacts WITH their card photos.
   */
  businessCardFront: z.string().optional().nullable(),
  businessCardBack: z.string().optional().nullable(),
}).refine(
  (d) => (d.people ?? []).every((p) => Boolean(p.firstName?.trim() || p.fullName?.trim())),
  { message: "Each person contact requires a first name (or a full name to split)." },
);

// ─── Create (smart field-out) ─────────────────────────────────────────────────

showroomContactsRouter.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = createContactsSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const data = parsed.data;

  const result = await fieldOutContacts(db, data, c.env);
  return c.json(result, 201);
});

/**
 * Core "field it out" routine shared by the create endpoint and the pocs
 * backfill. Resolves a store (explicit or fuzzy), creates person contacts,
 * upserts the GENERAL_CONTACT, attaches URLs to the links table, fills the
 * store address when blank, and marks everything draft when no store matched.
 */
export async function fieldOutContacts(
  db: Db,
  data: z.infer<typeof createContactsSchema>,
  env?: Env,
): Promise<{
  storeId: number | null;
  isDraft: boolean;
  contactIds: number[];
  generalUpserted: boolean;
  businessCardId: number | null;
}> {
  const sr = data.showroom;

  // 1. Resolve the store — explicit id, then hints, then the generic showroom
  //    details a business card carries (name / address / website / phone / email).
  const storeId = await matchStore(db, {
    storeId: data.storeId ?? null,
    placeId: data.match?.placeId ?? null,
    website: data.match?.website ?? sr?.website ?? data.urls?.find((u) => u.type === "WEBSITE")?.url ?? null,
    phone: data.match?.phone ?? sr?.phone ?? data.general?.officePhoneNumber ?? null,
    email: sr?.email ?? data.general?.emailAddress ?? null,
    address: sr?.address ?? data.address ?? null,
    name: data.match?.name ?? sr?.name ?? null,
  });
  const isDraft = storeId === null;
  const draftNotes = isDraft
    ? `Unmatched on intake. Hints: ${JSON.stringify(data.match ?? {})}`
    : null;

  // 2. Collect general-contact fields (explicit + any "office/general" numbers
  //    pulled from a person's mixed phone string).
  const general = {
    officePhoneNumber: data.general?.officePhoneNumber ?? null,
    officePhoneExtension: data.general?.officePhoneExtension ?? null,
    faxPhoneNumber: data.general?.faxPhoneNumber ?? null,
    emailAddress: data.general?.emailAddress ?? null,
  };

  // 3. Create person contacts.
  const contactIds: number[] = [];
  for (const p of data.people ?? []) {
    const parsedPhone = parsePhoneField(p.phone);
    // A general/office-labeled number in a person's phone string belongs to the
    // store, not the person — route it to the GENERAL_CONTACT upsert.
    if (parsedPhone.general && !general.officePhoneNumber) general.officePhoneNumber = parsedPhone.general;
    if (parsedPhone.fax && !general.faxPhoneNumber) general.faxPhoneNumber = parsedPhone.fax;

    const name =
      p.firstName || p.lastName
        ? { firstName: p.firstName ?? null, lastName: p.lastName ?? null }
        : splitFullName(p.fullName);

    const type: ContactType =
      (p.type as ContactType | undefined) ?? inferContactType(p.title);

    const [row] = await db
      .insert(showroomStoreContacts)
      .values({
        storeId,
        type,
        firstName: name.firstName,
        lastName: name.lastName,
        notes: p.notes ?? (p.title ? `Title: ${p.title}` : null),
        mobilePhoneNumber: p.mobilePhoneNumber ?? parsedPhone.mobile,
        officePhoneNumber: p.officePhoneNumber ?? parsedPhone.office,
        officePhoneExtension: p.officePhoneExtension ?? parsedPhone.extension,
        faxPhoneNumber: p.faxPhoneNumber ?? null,
        emailAddress: p.emailAddress ?? null,
        isTextingOk: p.isTextingOk ?? false,
        bestContactTimesJson: p.bestContactTimesJson ?? null,
        isDraft,
        draftNotes,
      })
      .returning({ id: showroomStoreContacts.id });
    contactIds.push(row.id);
  }

  // 4. Upsert the store's GENERAL_CONTACT (only when we have a store). A generic
  //    showroom phone/email from a business card fills the general line too.
  if (sr?.phone && !general.officePhoneNumber) general.officePhoneNumber = sr.phone;
  if (sr?.email && !general.emailAddress) general.emailAddress = sr.email;
  let generalUpserted = false;
  if (storeId !== null) {
    const before = Object.values(general).some((v) => v && String(v).trim());
    await upsertGeneralContact(db, storeId, general);
    generalUpserted = before;

    // 5. URLs → links table. Merge the explicit urls[] with any generic showroom
    //    links a business card carries (website + socials). Insert; skip dups.
    const effectiveUrls = [
      ...(data.urls ?? []),
      ...(sr?.website ? [{ url: sr.website, type: "WEBSITE", urlNotes: null }] : []),
      ...(sr?.instagram ? [{ url: sr.instagram, type: "INSTAGRAM", urlNotes: null }] : []),
      ...(sr?.facebook ? [{ url: sr.facebook, type: "FACEBOOK", urlNotes: null }] : []),
      ...(sr?.pinterest ? [{ url: sr.pinterest, type: "PINTEREST", urlNotes: null }] : []),
    ];
    for (const u of effectiveUrls) {
      const url = u.url.trim();
      if (!url) continue;
      const type = (SHOWROOM_LINK_TYPES as readonly string[]).includes(u.type)
        ? (u.type as ShowroomLinkType)
        : "OTHER";
      const [dup] = await db
        .select({ id: showroomStoreLinks.id })
        .from(showroomStoreLinks)
        .where(and(eq(showroomStoreLinks.storeId, storeId), eq(showroomStoreLinks.type, type), eq(showroomStoreLinks.url, url)))
        .limit(1);
      if (!dup) {
        await db.insert(showroomStoreLinks).values({ storeId, url, type, urlNotes: u.urlNotes ?? null });
      }
    }

    // 6. Fill-blanks the store row from the address + generic showroom fields
    //    (address / phone / email) — never overwrites an existing value.
    const [s] = await db
      .select({
        locationAddress: showroomStores.locationAddress,
        phoneNumber: showroomStores.phoneNumber,
        emailAddress: showroomStores.emailAddress,
      })
      .from(showroomStores)
      .where(eq(showroomStores.id, storeId))
      .limit(1);
    if (s) {
      const patch: Record<string, string> = {};
      const address = data.address?.trim() || sr?.address?.trim();
      if (!s.locationAddress && address) patch.locationAddress = address;
      if (!s.phoneNumber && sr?.phone?.trim()) patch.phoneNumber = sr.phone.trim();
      if (!s.emailAddress && sr?.email?.trim()) patch.emailAddress = sr.email.trim();
      if (Object.keys(patch).length > 0) {
        await db
          .update(showroomStores)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(showroomStores.id, storeId));
      }
    }
  }

  // 7. Business-card images (optional) → CF Images + a business_cards row linked
  //    to the first created contact. Front and/or back; either may be omitted.
  let businessCardId: number | null = null;
  if (env && (data.businessCardFront || data.businessCardBack)) {
    const front = data.businessCardFront
      ? await businessCardService.uploadCard(env, "front", data.businessCardFront)
      : null;
    const back = data.businessCardBack
      ? await businessCardService.uploadCard(env, "back", data.businessCardBack)
      : null;
    if (front || back) {
      const [card] = await db
        .insert(showroomStoreContactBusinessCards)
        .values({
          storeId,
          contactId: contactIds[0] ?? null,
          status: "done",
          isDraft,
          cfImageUrl: front,
          cfImageUrlBack: back,
        })
        .returning({ id: showroomStoreContactBusinessCards.id });
      businessCardId = card.id;
    }
  }

  return { storeId, isDraft, contactIds, generalUpserted, businessCardId };
}

// ─── List (phonebook) ─────────────────────────────────────────────────────────

showroomContactsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const q = c.req.query("q")?.trim();
  const type = c.req.query("type");
  const storeId = c.req.query("storeId");
  const includeDrafts = c.req.query("includeDrafts") === "true";

  const conds = [] as ReturnType<typeof eq>[];
  if (type && CONTACT_TYPES.includes(type as ContactType)) conds.push(eq(showroomStoreContacts.type, type as ContactType));
  if (storeId && Number.isInteger(Number(storeId))) conds.push(eq(showroomStoreContacts.storeId, Number(storeId)));
  if (!includeDrafts) conds.push(eq(showroomStoreContacts.isDraft, false));
  // Hide contacts belonging to a soft-deleted store, but KEEP unattached
  // contacts — storeId is nullable and a plain isActive check would drop them
  // (the leftJoin yields NULL, which never equals true).
  conds.push(
    or(
      isNull(showroomStoreContacts.storeId),
      eq(showroomStores.isActive, true),
    ) as unknown as ReturnType<typeof eq>,
  );
  if (q) {
    conds.push(
      or(
        like(showroomStoreContacts.firstName, `%${q}%`),
        like(showroomStoreContacts.lastName, `%${q}%`),
        like(showroomStoreContacts.emailAddress, `%${q}%`),
      ) as unknown as ReturnType<typeof eq>,
    );
  }

  const rows = await db
    .select({
      contact: showroomStoreContacts,
      storeName: showroomStores.name,
      storeIconUrl: showroomStores.iconCfImagesUrl,
    })
    .from(showroomStoreContacts)
    .leftJoin(showroomStores, eq(showroomStoreContacts.storeId, showroomStores.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(showroomStoreContacts.lastName, showroomStoreContacts.firstName, showroomStoreContacts.id);

  const cardMap = await businessCardImageMap(db, rows.map((r) => r.contact.id));

  return c.json({
    contacts: rows.map((r) => ({
      ...r.contact,
      storeName: r.storeName,
      storeIconUrl: r.storeIconUrl,
      businessCard: cardMap.get(r.contact.id) ?? null,
    })),
  });
});

/**
 * Map contactId → the card's front/back CF Images URLs (latest card per
 * contact). Lets the phonebook / viewport show a card image when one exists.
 */
async function businessCardImageMap(
  db: Db,
  contactIds: number[],
): Promise<Map<number, { front: string | null; back: string | null }>> {
  const map = new Map<number, { front: string | null; back: string | null }>();
  const ids = contactIds.filter((id): id is number => Number.isInteger(id));
  if (ids.length === 0) return map;
  // D1 caps a query at 100 bound params — chunk the id list so a large phonebook
  // page doesn't blow the limit. inArray([]) is invalid SQL, guarded above.
  for (let i = 0; i < ids.length; i += D1_IN_CHUNK) {
    const cards = await db
      .select({
        contactId: showroomStoreContactBusinessCards.contactId,
        front: showroomStoreContactBusinessCards.cfImageUrl,
        back: showroomStoreContactBusinessCards.cfImageUrlBack,
      })
      .from(showroomStoreContactBusinessCards)
      .where(inArray(showroomStoreContactBusinessCards.contactId, ids.slice(i, i + D1_IN_CHUNK)));
    for (const card of cards) {
      if (card.contactId == null) continue;
      if (!card.front && !card.back) continue;
      // Keep the first card that has an image for this contact.
      if (!map.has(card.contactId)) map.set(card.contactId, { front: card.front, back: card.back });
    }
  }
  return map;
}

// ─── Get / Update / Delete ────────────────────────────────────────────────────

showroomContactsRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
  const [row] = await db
    .select({
      contact: showroomStoreContacts,
      storeName: showroomStores.name,
      storeIconUrl: showroomStores.iconCfImagesUrl,
    })
    .from(showroomStoreContacts)
    .leftJoin(showroomStores, eq(showroomStoreContacts.storeId, showroomStores.id))
    .where(eq(showroomStoreContacts.id, id))
    .limit(1);
  if (!row) return c.json({ error: "Contact not found" }, 404);
  return c.json({ ...row.contact, storeName: row.storeName, storeIconUrl: row.storeIconUrl });
});

const updateContactSchema = personSchema
  .omit({ fullName: true, phone: true })
  .extend({
    storeId: z.number().int().optional().nullable(),
    type: z.enum(CONTACT_TYPES as [string, ...string[]]).optional(),
    isDraft: z.boolean().optional(),
    draftNotes: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  });

showroomContactsRouter.put("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
  const parsed = updateContactSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const d = parsed.data;

  const [row] = await db
    .update(showroomStoreContacts)
    .set({
      ...(d.storeId !== undefined ? { storeId: d.storeId } : {}),
      ...(d.type !== undefined ? { type: d.type as ContactType } : {}),
      ...(d.firstName !== undefined ? { firstName: d.firstName } : {}),
      ...(d.lastName !== undefined ? { lastName: d.lastName } : {}),
      ...(d.mobilePhoneNumber !== undefined ? { mobilePhoneNumber: d.mobilePhoneNumber } : {}),
      ...(d.officePhoneNumber !== undefined ? { officePhoneNumber: d.officePhoneNumber } : {}),
      ...(d.officePhoneExtension !== undefined ? { officePhoneExtension: d.officePhoneExtension } : {}),
      ...(d.faxPhoneNumber !== undefined ? { faxPhoneNumber: d.faxPhoneNumber } : {}),
      ...(d.emailAddress !== undefined ? { emailAddress: d.emailAddress } : {}),
      ...(d.isTextingOk !== undefined ? { isTextingOk: d.isTextingOk } : {}),
      ...(d.bestContactTimesJson !== undefined ? { bestContactTimesJson: d.bestContactTimesJson } : {}),
      ...(d.notes !== undefined ? { notes: d.notes } : {}),
      ...(d.isDraft !== undefined ? { isDraft: d.isDraft } : {}),
      ...(d.draftNotes !== undefined ? { draftNotes: d.draftNotes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(showroomStoreContacts.id, id))
    .returning();
  if (!row) return c.json({ error: "Contact not found" }, 404);
  return c.json({ contact: row });
});

showroomContactsRouter.delete("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
  await db.delete(showroomStoreContacts).where(eq(showroomStoreContacts.id, id));
  return c.json({ success: true });
});

// ─── Store-match helper endpoint ──────────────────────────────────────────────

showroomContactsRouter.get("/match/store", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = await matchStore(db, {
    placeId: c.req.query("placeId") ?? null,
    website: c.req.query("website") ?? null,
    phone: c.req.query("phone") ?? null,
    name: c.req.query("name") ?? null,
  });
  return c.json({ storeId });
});

// ─── Backfill: showroom_pocs + main_poc_* → contacts ──────────────────────────
//
// Dry-run by default; ?apply=true to write. Reads the legacy pocs table + the
// denormalized main_poc_* columns (both still present) and fields them out via
// the same routine the live create path uses.
showroomContactsRouter.post("/backfill/from-pocs", async (c) => {
  const db = drizzle(c.env.DB);
  const apply = c.req.query("apply") === "true" || c.req.query("apply") === "1";

  const pocs = await db.select().from(showroomPocs).where(eq(showroomPocs.isActive, true));
  const storesWithMain = await db
    .select({
      id: showroomStores.id,
      mainPocFullname: showroomStores.mainPocFullname,
      mainPocPhoneNumber: showroomStores.mainPocPhoneNumber,
      mainPocEmailAddress: showroomStores.mainPocEmailAddress,
    })
    .from(showroomStores)
    .where(
      and(
        eq(showroomStores.isActive, true),
        or(
          sql`${showroomStores.mainPocFullname} IS NOT NULL`,
          sql`${showroomStores.mainPocPhoneNumber} IS NOT NULL`,
          sql`${showroomStores.mainPocEmailAddress} IS NOT NULL`,
        ),
      ),
    );

  const plan = { pocs: pocs.length, mainPocs: storesWithMain.length, apply };

  // Resolve each store's PRIMARY location — a migrated contact attaches to the site (Phase L).
  const storeIds = Array.from(
    new Set([...pocs.map((p) => p.showroomId), ...storesWithMain.map((s) => s.id)]),
  );
  const locsByStore = await loadStoreLocations(db, storeIds);
  const primaryLocId = (sid: number): number | null =>
    locsByStore.get(sid)?.find((l) => l.isPrimary)?.id ?? null;

  // Dedup vs contacts that already exist (source pocs are deduped, but an overlapping
  // main_poc / a re-run must never create a second identical person). Key = store +
  // normalized name + phone + email.
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const personKey = (sid: number, name: string | null, phone: string | null, email: string | null) =>
    `${sid}|${norm(name)}|${norm(phone)}|${norm(email)}`;
  const existing = await db
    .select({
      storeId: showroomStoreContacts.storeId,
      firstName: showroomStoreContacts.firstName,
      lastName: showroomStoreContacts.lastName,
      officePhoneNumber: showroomStoreContacts.officePhoneNumber,
      mobilePhoneNumber: showroomStoreContacts.mobilePhoneNumber,
      emailAddress: showroomStoreContacts.emailAddress,
    })
    .from(showroomStoreContacts);
  const seen = new Set(
    existing
      .filter((e) => e.storeId != null)
      .map((e) =>
        personKey(
          e.storeId as number,
          `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
          e.officePhoneNumber ?? e.mobilePhoneNumber,
          e.emailAddress,
        ),
      ),
  );

  const splitName = (full: string | null | undefined) => {
    const t = (full ?? "").trim();
    if (!t) return { firstName: null as string | null, lastName: null as string | null };
    const i = t.lastIndexOf(" ");
    return i === -1
      ? { firstName: t, lastName: null as string | null }
      : { firstName: t.slice(0, i), lastName: t.slice(i + 1) };
  };

  // Stage people, MAIN POCs FIRST so the primary designation wins over a duplicate poc
  // row for the same person (which would otherwise be staged non-primary first).
  const staged: Array<{
    storeId: number;
    fullName: string | null;
    phone: string | null;
    email: string | null;
    isPrimary: boolean;
  }> = [];
  let skippedDupes = 0;
  const stage = (
    storeId: number,
    fullName: string | null,
    phone: string | null,
    email: string | null,
    isPrimary: boolean,
  ) => {
    const k = personKey(storeId, fullName, phone, email);
    if (seen.has(k)) {
      skippedDupes++;
      return;
    }
    seen.add(k);
    staged.push({ storeId, fullName, phone, email, isPrimary });
  };
  for (const s of storesWithMain) {
    stage(s.id, s.mainPocFullname, s.mainPocPhoneNumber, s.mainPocEmailAddress, true);
  }
  for (const p of pocs) {
    stage(p.showroomId, p.fullName, p.phone, p.email, false);
  }

  if (!apply) {
    return c.json(
      {
        ...plan,
        wouldCreate: staged.length,
        wouldSetPrimary: staged.filter((r) => r.isPrimary).length,
        skippedDupes,
        note: "dry run — pass ?apply=true to write",
      },
      200,
    );
  }

  let created = 0;
  for (const r of staged) {
    const name = splitName(r.fullName);
    await db.insert(showroomStoreContacts).values({
      storeId: r.storeId,
      locationId: primaryLocId(r.storeId),
      type: "OTHER",
      firstName: name.firstName,
      lastName: name.lastName,
      officePhoneNumber: r.phone,
      emailAddress: r.email,
      isPrimary: r.isPrimary,
    });
    created++;
  }

  return c.json({ ...plan, created, skippedDupes }, 200);
});

// ─── Contact log CRUD ─────────────────────────────────────────────────────────

const contactLogSchema = z.object({
  storeId: z.number().int().optional().nullable(),
  storeContactId: z.number().int().optional().nullable(),
  timestampContactStart: z.number().int().optional().nullable(),
  timestampContactEnd: z.number().int().optional().nullable(),
  estimatedCallDuration: z.number().int().optional().nullable(),
  transcriptJson: z.unknown().optional().nullable(),
  contextOfConversation: z.string().optional().nullable(),
  outcomeOfConversation: z.string().optional().nullable(),
  isFollowupNeeded: z.boolean().optional(),
  followupNotes: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/** epoch-seconds number → Date (nullable passthrough). */
function toDate(v: number | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return new Date(v * 1000);
}

showroomContactsRouter.get("/contact-log", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = c.req.query("storeId");
  const contactId = c.req.query("contactId");
  const conds = [] as ReturnType<typeof eq>[];
  if (storeId && Number.isInteger(Number(storeId))) conds.push(eq(showroomStoreContactLog.storeId, Number(storeId)));
  if (contactId && Number.isInteger(Number(contactId))) conds.push(eq(showroomStoreContactLog.storeContactId, Number(contactId)));
  if (c.req.query("followupNeeded") === "true") conds.push(eq(showroomStoreContactLog.isFollowupNeeded, true));

  const logs = await db
    .select()
    .from(showroomStoreContactLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(showroomStoreContactLog.timestamp));
  return c.json({ logs });
});

showroomContactsRouter.post("/contact-log", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = contactLogSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const d = parsed.data;
  const [log] = await db
    .insert(showroomStoreContactLog)
    .values({
      storeId: d.storeId ?? null,
      storeContactId: d.storeContactId ?? null,
      timestampContactStart: toDate(d.timestampContactStart) ?? null,
      timestampContactEnd: toDate(d.timestampContactEnd) ?? null,
      estimatedCallDuration: d.estimatedCallDuration ?? null,
      transcriptJson: d.transcriptJson ?? null,
      contextOfConversation: d.contextOfConversation ?? null,
      outcomeOfConversation: d.outcomeOfConversation ?? null,
      isFollowupNeeded: d.isFollowupNeeded ?? false,
      followupNotes: d.followupNotes ?? null,
      notes: d.notes ?? null,
    })
    .returning();
  return c.json({ log }, 201);
});

showroomContactsRouter.get("/contact-log/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
  const [log] = await db.select().from(showroomStoreContactLog).where(eq(showroomStoreContactLog.id, id)).limit(1);
  if (!log) return c.json({ error: "Log not found" }, 404);
  return c.json({ log });
});

showroomContactsRouter.put("/contact-log/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
  const parsed = contactLogSchema.partial().safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const d = parsed.data;
  const [log] = await db
    .update(showroomStoreContactLog)
    .set({
      ...(d.storeId !== undefined ? { storeId: d.storeId } : {}),
      ...(d.storeContactId !== undefined ? { storeContactId: d.storeContactId } : {}),
      ...(d.timestampContactStart !== undefined ? { timestampContactStart: toDate(d.timestampContactStart) } : {}),
      ...(d.timestampContactEnd !== undefined ? { timestampContactEnd: toDate(d.timestampContactEnd) } : {}),
      ...(d.estimatedCallDuration !== undefined ? { estimatedCallDuration: d.estimatedCallDuration } : {}),
      ...(d.transcriptJson !== undefined ? { transcriptJson: d.transcriptJson } : {}),
      ...(d.contextOfConversation !== undefined ? { contextOfConversation: d.contextOfConversation } : {}),
      ...(d.outcomeOfConversation !== undefined ? { outcomeOfConversation: d.outcomeOfConversation } : {}),
      ...(d.isFollowupNeeded !== undefined ? { isFollowupNeeded: d.isFollowupNeeded } : {}),
      ...(d.followupNotes !== undefined ? { followupNotes: d.followupNotes } : {}),
      ...(d.notes !== undefined ? { notes: d.notes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(showroomStoreContactLog.id, id))
    .returning();
  if (!log) return c.json({ error: "Log not found" }, 404);
  return c.json({ log });
});

showroomContactsRouter.delete("/contact-log/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
  await db.delete(showroomStoreContactLog).where(eq(showroomStoreContactLog.id, id));
  return c.json({ success: true });
});

// ─── Business cards (vision intake) ───────────────────────────────────────────

const businessCardsSchema = z.object({
  /** One or more card images as data: URLs. Front side (single-image per card). */
  images: z.array(z.string().min(1)).min(1).max(50),
  /** Optional store hint applied to every card in this batch. */
  storeId: z.number().int().optional().nullable(),
});

/**
 * POST /business-cards — bulk upload. Inserts a pending business_card row per
 * image and returns immediately; each card is uploaded to CF Images + run
 * through the vision extractor + fielded into a contact in the background
 * (waitUntil). Failed cards surface via GET /business-cards?status=failed.
 */
showroomContactsRouter.post("/business-cards", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = businessCardsSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const { images, storeId } = parsed.data;

  const ids: number[] = [];
  for (let i = 0; i < images.length; i++) {
    const [row] = await db
      .insert(showroomStoreContactBusinessCards)
      .values({ storeId: storeId ?? null, status: "pending" })
      .returning({ id: showroomStoreContactBusinessCards.id });
    ids.push(row.id);
  }

  // Process each card in the background so the upload returns immediately.
  c.executionCtx.waitUntil(
    (async () => {
      for (let i = 0; i < images.length; i++) {
        await processBusinessCard(c.env, ids[i], images[i], storeId ?? null);
      }
    })(),
  );

  return c.json({ cardIds: ids, status: "processing" }, 202);
});

/** Upload → vision-extract → field into a contact → update the card row. */
async function processBusinessCard(
  env: Env,
  cardId: number,
  imageDataUrl: string,
  storeId: number | null,
): Promise<void> {
  const db = drizzle(env.DB);
  try {
    await db
      .update(showroomStoreContactBusinessCards)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(showroomStoreContactBusinessCards.id, cardId));

    const cfImageUrl = await businessCardService.uploadCard(env, "front", imageDataUrl);
    const extracted = await businessCardService.extractFromImages(env, { front: imageDataUrl });

    const hasContact = Boolean(extracted.fullName || extracted.phone || extracted.email);
    if (!hasContact) {
      await db
        .update(showroomStoreContactBusinessCards)
        .set({
          status: "failed",
          isDraft: true,
          draftNotes: "Vision extraction found no usable contact fields.",
          cfImageUrl: cfImageUrl ?? null,
          imageJson: extracted as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(showroomStoreContactBusinessCards.id, cardId));
      return;
    }

    const res = await fieldOutContacts(db, {
      storeId,
      match: { website: extracted.website ?? null, name: extracted.company ?? null, phone: extracted.phone ?? null },
      people: [
        {
          fullName: extracted.fullName ?? null,
          title: extracted.title ?? null,
          phone: extracted.phone ?? null,
          emailAddress: extracted.email ?? null,
        },
      ],
      urls: extracted.website ? [{ url: extracted.website, type: "WEBSITE" }] : undefined,
      address: extracted.address ?? undefined,
    });

    await db
      .update(showroomStoreContactBusinessCards)
      .set({
        status: "done",
        storeId: res.storeId,
        contactId: res.contactIds[0] ?? null,
        isDraft: res.isDraft,
        draftNotes: res.isDraft ? "No store matched from card — contact saved as draft." : null,
        cfImageUrl: cfImageUrl ?? null,
        imageJson: extracted as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(showroomStoreContactBusinessCards.id, cardId));
  } catch (err) {
    console.error(`[showroom-contacts] business card ${cardId} failed:`, err);
    await db
      .update(showroomStoreContactBusinessCards)
      .set({
        status: "failed",
        isDraft: true,
        draftNotes: err instanceof Error ? err.message : String(err),
        updatedAt: new Date(),
      })
      .where(eq(showroomStoreContactBusinessCards.id, cardId));
  }
}

/** GET /business-cards — list, optionally filtered by status (e.g. ?status=failed). */
showroomContactsRouter.get("/business-cards", async (c) => {
  const db = drizzle(c.env.DB);
  const status = c.req.query("status");
  const storeId = c.req.query("storeId");
  const conds = [] as ReturnType<typeof eq>[];
  if (status && ["pending", "processing", "done", "failed"].includes(status))
    conds.push(eq(showroomStoreContactBusinessCards.status, status as "pending"));
  if (storeId && Number.isInteger(Number(storeId))) conds.push(eq(showroomStoreContactBusinessCards.storeId, Number(storeId)));

  const cards = await db
    .select()
    .from(showroomStoreContactBusinessCards)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(showroomStoreContactBusinessCards.timestamp));
  return c.json({ cards });
});

/**
 * POST /business-cards/:id/resolve — closed loop for a FAILED card. An external
 * agent re-reads the card image (from cf_image_url), parses it, and submits the
 * contact payload here; we field it out and link the resulting contact back to
 * the card.
 */
showroomContactsRouter.post("/business-cards/:id/resolve", async (c) => {
  const db = drizzle(c.env.DB);
  const cardId = Number(c.req.param("id"));
  if (!Number.isInteger(cardId)) return c.json({ error: "Invalid id" }, 400);
  const parsed = createContactsSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

  const res = await fieldOutContacts(db, parsed.data);
  const [card] = await db
    .update(showroomStoreContactBusinessCards)
    .set({
      status: "done",
      storeId: res.storeId,
      contactId: res.contactIds[0] ?? null,
      isDraft: res.isDraft,
      draftNotes: res.isDraft ? "Resolved but still unmatched to a store." : null,
      updatedAt: new Date(),
    })
    .where(eq(showroomStoreContactBusinessCards.id, cardId))
    .returning();
  if (!card) return c.json({ error: "Card not found" }, 404);
  return c.json({ card, contactIds: res.contactIds });
});
