import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

import { guestContacts } from "@backend/db";
import { getGuestFromRequest, setGuestCookie } from "@backend/utils/guest-access";

/**
 * Vendor portal guest identity API (0043, P2).
 *
 * `POST /register` is the frictionless "digital business card" gate: a vendor
 * hands over name/email/phone/website, we upsert by email, set the `remodel_guest`
 * cookie, and let them in. A returning email is passed straight through — the
 * response is a 200 with the (updated) guest, never an "already registered" error.
 *
 * NONE of this grants homeowner/admin access — see utils/guest-access.ts.
 */
const guestRouter = new Hono<{ Bindings: Env }>();

/** A company URL must be a real http(s) URL — never a `javascript:` scheme that
 *  could become stored XSS if ever rendered as an <a href>. */
const httpUrl = z
  .string()
  .trim()
  .max(500)
  .url("A valid website URL is required")
  .refine((u) => /^https?:\/\//i.test(u), "Website must start with http:// or https://");

const registerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(120),
  lastName: z.string().trim().min(1, "Last name is required").max(120),
  // Lowercased here so the (case-sensitive) unique index can never hold two rows
  // for the same address; every read below also queries the lowercased value.
  email: z.string().trim().toLowerCase().email("A valid email is required").max(320),
  phone: z.string().trim().max(60).optional().nullable(),
  companyWebsiteUrl: httpUrl.optional().nullable(),
});

/** Keep an existing value when the incoming one is blank (empty string counts as
 *  blank, which `??` would not). Prevents a returning guest wiping their card. */
function preferNonBlank(next: string | null | undefined, existing: string | null): string | null {
  return next && next.trim() ? next : existing;
}

function publicGuest(row: typeof guestContacts.$inferSelect) {
  // Never echo the cookie id back to the client.
  const { cookieId: _cookieId, ...rest } = row;
  return rest;
}

guestRouter.post("/register", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid registration", details: parsed.error.issues.map((i) => i.message) },
      400,
    );
  }
  const input = parsed.data;
  const db = drizzle(c.env.DB);

  const existing = await db
    .select()
    .from(guestContacts)
    .where(eq(guestContacts.email, input.email))
    .get();

  let row: typeof guestContacts.$inferSelect;
  if (existing) {
    // Returning guest — refresh their card + reissue the SAME cookie. No error.
    row =
      (await db
        .update(guestContacts)
        .set({
          firstName: input.firstName,
          lastName: input.lastName,
          phone: preferNonBlank(input.phone, existing.phone),
          companyWebsiteUrl: preferNonBlank(input.companyWebsiteUrl, existing.companyWebsiteUrl),
          lastSeenAt: new Date(),
        })
        .where(eq(guestContacts.id, existing.id))
        .returning()
        .get()) ?? existing;
    setGuestCookie(c, existing.cookieId);
  } else {
    const cookieId = crypto.randomUUID();
    row = await db
      .insert(guestContacts)
      .values({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone ?? null,
        companyWebsiteUrl: input.companyWebsiteUrl ?? null,
        cookieId,
      })
      .returning()
      .get();
    setGuestCookie(c, cookieId);
  }

  return c.json({ success: true, guest: publicGuest(row) });
});

guestRouter.get("/me", async (c) => {
  const guest = await getGuestFromRequest(c.req.raw, c.env);
  if (!guest) return c.json({ success: true, guest: null });
  return c.json({ success: true, guest: publicGuest(guest) });
});

export { guestRouter };
