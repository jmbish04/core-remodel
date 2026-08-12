/**
 * @fileoverview Vendor-email context layer HTTP surface (gated by
 * requireAccessAuth on /api/email/*, see index.ts). Sends nothing — resolves
 * recipients only.
 */
import { resolveRecipient } from "@backend/services/email/resolve-recipient";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

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
