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
import { and, desc, eq, like, or, sql } from "drizzle-orm";

import {
  showroomStores,
  showroomStoreContacts,
  showroomStoreContactLog,
  showroomStoreContactBusinessCards,
  showroomStoreLinks,
  showroomPocs,
} from "@backend/db/schema/showroom/index";
import {
  CONTACT_TYPES,
  inferContactType,
  parsePhoneField,
  splitFullName,
  type ContactType,
} from "@backend/utils/contact-intake";
import { businessCardService } from "@backend/services/business-card";

type Db = ReturnType<typeof drizzle>;

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
      const [s] = await db
        .select({ id: showroomStores.id })
        .from(showroomStores)
        .where(like(showroomStores.phoneNumber, `%${tail}%`))
        .limit(1);
      if (s) return s.id;
    }
  }

  if (hints.name && hints.name.trim().length >= 3) {
    const [s] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(like(showroomStores.name, `%${hints.name.trim()}%`))
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
});

// ─── Create (smart field-out) ─────────────────────────────────────────────────

showroomContactsRouter.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = createContactsSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const data = parsed.data;

  const result = await fieldOutContacts(db, data);
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
): Promise<{
  storeId: number | null;
  isDraft: boolean;
  contactIds: number[];
  generalUpserted: boolean;
}> {
  // 1. Resolve the store.
  const storeId = await matchStore(db, {
    storeId: data.storeId ?? null,
    placeId: data.match?.placeId ?? null,
    website: data.match?.website ?? data.urls?.find((u) => u.type === "WEBSITE")?.url ?? null,
    phone: data.match?.phone ?? data.general?.officePhoneNumber ?? null,
    name: data.match?.name ?? null,
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

  // 4. Upsert the store's GENERAL_CONTACT (only when we have a store).
  let generalUpserted = false;
  if (storeId !== null) {
    const before = Object.values(general).some((v) => v && String(v).trim());
    await upsertGeneralContact(db, storeId, general);
    generalUpserted = before;

    // 5. URLs → links table (insert; skip dups by url+type).
    for (const u of data.urls ?? []) {
      const url = u.url.trim();
      if (!url) continue;
      const type = ["WEBSITE", "INSTAGRAM", "PINTEREST", "FACEBOOK", "OTHER"].includes(u.type)
        ? (u.type as "WEBSITE")
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

    // 6. Address → store row when blank.
    if (data.address?.trim()) {
      const [s] = await db
        .select({ locationAddress: showroomStores.locationAddress })
        .from(showroomStores)
        .where(eq(showroomStores.id, storeId))
        .limit(1);
      if (s && !s.locationAddress) {
        await db
          .update(showroomStores)
          .set({ locationAddress: data.address.trim(), updatedAt: new Date() })
          .where(eq(showroomStores.id, storeId));
      }
    }
  }

  return { storeId, isDraft, contactIds, generalUpserted };
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
    })
    .from(showroomStoreContacts)
    .leftJoin(showroomStores, eq(showroomStoreContacts.storeId, showroomStores.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(showroomStoreContacts.lastName, showroomStoreContacts.firstName, showroomStoreContacts.id);

  return c.json({
    contacts: rows.map((r) => ({ ...r.contact, storeName: r.storeName })),
  });
});

// ─── Get / Update / Delete ────────────────────────────────────────────────────

showroomContactsRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
  const [row] = await db
    .select({ contact: showroomStoreContacts, storeName: showroomStores.name })
    .from(showroomStoreContacts)
    .leftJoin(showroomStores, eq(showroomStoreContacts.storeId, showroomStores.id))
    .where(eq(showroomStoreContacts.id, id))
    .limit(1);
  if (!row) return c.json({ error: "Contact not found" }, 404);
  return c.json({ ...row.contact, storeName: row.storeName });
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
      or(
        sql`${showroomStores.mainPocFullname} IS NOT NULL`,
        sql`${showroomStores.mainPocPhoneNumber} IS NOT NULL`,
        sql`${showroomStores.mainPocEmailAddress} IS NOT NULL`,
      ),
    );

  const plan = {
    pocs: pocs.length,
    mainPocs: storesWithMain.length,
    apply,
  };
  if (!apply) return c.json({ ...plan, note: "dry run — pass ?apply=true to write" }, 200);

  let created = 0;
  for (const p of pocs) {
    const res = await fieldOutContacts(db, {
      storeId: p.showroomId,
      people: [
        {
          fullName: p.fullName,
          title: p.title,
          phone: p.phone,
          emailAddress: p.email,
          notes: p.title ? `Title: ${p.title}` : null,
        },
      ],
      urls: p.website ? [{ url: p.website, type: "WEBSITE" }] : undefined,
      address: p.address ?? undefined,
    });
    created += res.contactIds.length;
  }
  for (const s of storesWithMain) {
    const res = await fieldOutContacts(db, {
      storeId: s.id,
      people: [
        {
          fullName: s.mainPocFullname,
          phone: s.mainPocPhoneNumber,
          emailAddress: s.mainPocEmailAddress,
          type: "OTHER",
        },
      ],
    });
    created += res.contactIds.length;
  }

  return c.json({ ...plan, created }, 200);
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
