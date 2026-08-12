/**
 * @fileoverview Vendor-email context layer HTTP surface (gated by
 * requireAccessAuth on /api/email/*, see index.ts). Sends nothing — resolves
 * recipients only.
 */
import { getInstructions, upsertInstructions } from "@backend/services/email/instructions";
import { resolveRecipient } from "@backend/services/email/resolve-recipient";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

export const emailRouter = new Hono<{ Bindings: Env }>();

emailRouter.get("/resolve-recipient", async (c) => {
  const db = drizzle(c.env.DB);
  const result = await resolveRecipient(db, {
    email: c.req.query("email"),
    store: c.req.query("store"),
    contact: c.req.query("contact"),
  });
  return c.json(result); // ok:false is a valid resolved result, not an HTTP error
});

emailRouter.get("/instructions", async (c) => {
  return c.json(await getInstructions(drizzle(c.env.DB)));
});

const instructionsBody = z.object({ markdown: z.string(), html: z.string() });
emailRouter.put("/instructions", async (c) => {
  const parsed = instructionsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  return c.json(await upsertInstructions(drizzle(c.env.DB), parsed.data));
});
