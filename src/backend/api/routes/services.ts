/**
 * @fileoverview Services catalog CRUD — `/api/services` (admin-gated).
 *
 * A `services` row is a billable service (labor / design / consulting) offered
 * outside the materials catalog. Estimate line items reference one via
 * `estimate_line_items.service_id`. Soft-delete via `archive` (never hard-delete
 * — line items may reference it).
 */

import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { services } from "@backend/db/schema/services/services";

export const servicesRouter = new Hono<{ Bindings: Env }>();

const upsertSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  defaultUnitCost: z.number().optional().nullable(),
});

/** GET / — list. ?search= filters name (LIKE); ?includeArchived=true to include archived. */
servicesRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const search = c.req.query("search");
  const includeArchived = c.req.query("includeArchived") === "true";

  const conditions = [];
  if (!includeArchived) conditions.push(eq(services.isArchived, false));
  if (search) conditions.push(like(services.name, `%${search}%`));

  const rows = await db
    .select()
    .from(services)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(services.updatedAt));

  return c.json({ services: rows });
});

/** POST / — create. */
servicesRouter.post("/", async (c) => {
  const parsed = upsertSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

  const db = drizzle(c.env.DB);
  const [row] = await db
    .insert(services)
    .values({
      name: parsed.data.name.trim(),
      description: parsed.data.description ?? null,
      category: parsed.data.category ?? null,
      defaultUnitCost: parsed.data.defaultUnitCost ?? null,
    })
    .returning();

  return c.json({ service: row }, 201);
});

/** PATCH /:id — update fields. */
servicesRouter.patch("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const parsed = upsertSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

  const db = drizzle(c.env.DB);
  const [row] = await db
    .update(services)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(services.id, id))
    .returning();
  if (!row) return c.json({ error: "Service not found" }, 404);

  return c.json({ service: row });
});

/** POST /:id/archive — soft-delete (keeps line-item references intact). */
servicesRouter.post("/:id/archive", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = drizzle(c.env.DB);
  const [row] = await db
    .update(services)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(eq(services.id, id))
    .returning();
  if (!row) return c.json({ error: "Service not found" }, 404);

  return c.json({ service: row });
});
