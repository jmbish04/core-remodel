/**
 * @fileoverview Materials Schedule API
 *
 * CRUD for the master materials list (material_schedule_items) and their
 * required specs (material_required_specs), plus spec-based matching against
 * sourced showroom products. Mounts at /api/materials.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc, and, like, inArray, sql } from "drizzle-orm";

import {
  materialScheduleItems,
  materialRequiredSpecs,
} from "@backend/db/schema/materials/index";
import {
  showroomStoreProducts,
  productSpecs,
} from "@backend/db/schema/showroom/index";
import { z } from "zod";

export const materialsRouter = new Hono<{ Bindings: Env }>();

// ─── Validation Schemas ────────────────────────────────────────────────────────

const specInputSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

const createMaterialSchema = z.object({
  title: z.string().min(1),
  roomName: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  specs: z.array(specInputSchema).optional(),
});

const updateMaterialSchema = z.object({
  title: z.string().min(1).optional(),
  roomName: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const purchasedSchema = z.object({
  isPurchased: z.boolean(),
  purchasedShowroomProductId: z.number().int().positive().optional().nullable(),
});

function parseId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** Split into chunks to stay under Cloudflare D1's ~100 bound-parameter limit. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Material CRUD ──────────────────────────────────────────────────────────────

/**
 * GET / — List material schedule items.
 * Query params: ?search=cooktop&purchased=false&room=Kitchen
 */
materialsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const search = c.req.query("search");
  const purchased = c.req.query("purchased");
  const room = c.req.query("room");

  let query = db
    .select()
    .from(materialScheduleItems)
    .orderBy(desc(materialScheduleItems.dateAdded))
    .$dynamic();

  const conditions = [];
  if (search) conditions.push(like(materialScheduleItems.title, `%${search}%`));
  if (room) conditions.push(eq(materialScheduleItems.roomName, room));
  if (purchased === "true" || purchased === "false") {
    conditions.push(eq(materialScheduleItems.isPurchased, purchased === "true"));
  }
  if (conditions.length > 0) query = query.where(and(...conditions));

  const materials = await query;
  return c.json({ materials });
});

/**
 * GET /:id — Material detail with required specs and the linked purchased product.
 */
materialsRouter.get("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid material id" }, 400);
  const db = drizzle(c.env.DB);

  const [material] = await db
    .select()
    .from(materialScheduleItems)
    .where(eq(materialScheduleItems.id, id));
  if (!material) return c.json({ error: "Material not found" }, 404);

  const specs = await db
    .select()
    .from(materialRequiredSpecs)
    .where(eq(materialRequiredSpecs.materialId, id))
    .orderBy(materialRequiredSpecs.id);

  let purchasedProduct = null;
  if (material.purchasedShowroomProductId) {
    const [product] = await db
      .select()
      .from(showroomStoreProducts)
      .where(eq(showroomStoreProducts.id, material.purchasedShowroomProductId));
    purchasedProduct = product ?? null;
  }

  return c.json({ material, specs, purchasedProduct });
});

/**
 * POST / — Create a material, optionally with initial required specs.
 */
materialsRouter.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = createMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }
  const { specs, ...data } = parsed.data;

  const [material] = await db
    .insert(materialScheduleItems)
    .values(data)
    .returning();

  if (specs && specs.length > 0) {
    // Chunk inserts (3 bound params/row) under D1's ~100-param limit.
    for (const specChunk of chunk(specs, 30)) {
      await db
        .insert(materialRequiredSpecs)
        .values(specChunk.map((s) => ({ materialId: material.id, key: s.key, value: s.value })));
    }
  }

  return c.json({ material }, 201);
});

/**
 * PUT /:id — Update a material's editable fields.
 */
materialsRouter.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid material id" }, 400);
  const db = drizzle(c.env.DB);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = updateMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const [material] = await db
    .update(materialScheduleItems)
    .set({ ...parsed.data, updatedAt: sql`(unixepoch())` })
    .where(eq(materialScheduleItems.id, id))
    .returning();
  if (!material) return c.json({ error: "Material not found" }, 404);

  return c.json({ material });
});

/**
 * DELETE /:id — Delete a material (cascades its required specs).
 */
materialsRouter.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid material id" }, 400);
  const db = drizzle(c.env.DB);

  const [deleted] = await db
    .delete(materialScheduleItems)
    .where(eq(materialScheduleItems.id, id))
    .returning();
  if (!deleted) return c.json({ error: "Material not found" }, 404);

  return c.json({ success: true });
});

/**
 * PUT /:id/purchased — Mark a material purchased and link the showroom product.
 */
materialsRouter.put("/:id/purchased", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid material id" }, 400);
  const db = drizzle(c.env.DB);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = purchasedSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const [material] = await db
    .update(materialScheduleItems)
    .set({
      isPurchased: parsed.data.isPurchased,
      purchasedShowroomProductId: parsed.data.purchasedShowroomProductId ?? null,
      updatedAt: sql`(unixepoch())`,
    })
    .where(eq(materialScheduleItems.id, id))
    .returning();
  if (!material) return c.json({ error: "Material not found" }, 404);

  return c.json({ material });
});

// ─── Required Specs ─────────────────────────────────────────────────────────────

/**
 * GET /:id/specs — List required specs for a material.
 */
materialsRouter.get("/:id/specs", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid material id" }, 400);
  const db = drizzle(c.env.DB);

  const specs = await db
    .select()
    .from(materialRequiredSpecs)
    .where(eq(materialRequiredSpecs.materialId, id))
    .orderBy(materialRequiredSpecs.id);
  return c.json({ specs });
});

/**
 * POST /:id/specs — Add a single required spec.
 */
materialsRouter.post("/:id/specs", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid material id" }, 400);
  const db = drizzle(c.env.DB);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = specInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const [spec] = await db
    .insert(materialRequiredSpecs)
    .values({ materialId: id, key: parsed.data.key, value: parsed.data.value })
    .returning();
  return c.json({ spec }, 201);
});

/**
 * POST /:id/specs/batch — Add multiple required specs at once.
 */
materialsRouter.post("/:id/specs/batch", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid material id" }, 400);
  const db = drizzle(c.env.DB);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = z.object({ specs: z.array(specInputSchema).min(1) }).safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  // Chunk inserts (3 bound params/row) under D1's ~100-param limit.
  const specs: (typeof materialRequiredSpecs.$inferSelect)[] = [];
  for (const specChunk of chunk(parsed.data.specs, 30)) {
    const rows = await db
      .insert(materialRequiredSpecs)
      .values(specChunk.map((s) => ({ materialId: id, key: s.key, value: s.value })))
      .returning();
    specs.push(...rows);
  }
  return c.json({ specs }, 201);
});

/**
 * PUT /:id/specs/:sid — Update a required spec.
 */
materialsRouter.put("/:id/specs/:sid", async (c) => {
  const sid = parseId(c.req.param("sid"));
  if (sid === null) return c.json({ error: "Invalid spec id" }, 400);
  const db = drizzle(c.env.DB);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = specInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const [spec] = await db
    .update(materialRequiredSpecs)
    .set({ key: parsed.data.key, value: parsed.data.value })
    .where(eq(materialRequiredSpecs.id, sid))
    .returning();
  if (!spec) return c.json({ error: "Spec not found" }, 404);

  return c.json({ spec });
});

/**
 * DELETE /:id/specs/:sid — Delete a required spec.
 */
materialsRouter.delete("/:id/specs/:sid", async (c) => {
  const sid = parseId(c.req.param("sid"));
  if (sid === null) return c.json({ error: "Invalid spec id" }, 400);
  const db = drizzle(c.env.DB);

  const [deleted] = await db
    .delete(materialRequiredSpecs)
    .where(eq(materialRequiredSpecs.id, sid))
    .returning();
  if (!deleted) return c.json({ error: "Spec not found" }, 404);

  return c.json({ success: true });
});

// ─── Spec Matching ──────────────────────────────────────────────────────────────

/**
 * GET /:id/match — Find showroom products whose specs satisfy this material's
 * required specs. Ranks products by the number of matching spec keys/values.
 */
materialsRouter.get("/:id/match", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid material id" }, 400);
  const db = drizzle(c.env.DB);

  const required = await db
    .select()
    .from(materialRequiredSpecs)
    .where(eq(materialRequiredSpecs.materialId, id));

  if (required.length === 0) {
    return c.json({ requiredSpecCount: 0, matches: [] });
  }

  const keys = [...new Set(required.map((r) => r.key))];

  // Candidate product specs that share any required key (chunked under D1's limit).
  const candidateSpecs: { storeProductId: number; specKey: string; specValue: string | null }[] = [];
  for (const keyChunk of chunk(keys, 90)) {
    const rows = await db
      .select({
        storeProductId: productSpecs.storeProductId,
        specKey: productSpecs.specKey,
        specValue: productSpecs.specValue,
      })
      .from(productSpecs)
      .where(inArray(productSpecs.specKey, keyChunk));
    candidateSpecs.push(...rows);
  }

  // Required values keyed by lowercased spec key for case-insensitive matching.
  const requiredByKey = new Map<string, string[]>();
  for (const r of required) {
    const k = r.key.toLowerCase();
    requiredByKey.set(k, [...(requiredByKey.get(k) ?? []), r.value.toLowerCase()]);
  }

  // Tally per-product matches: a product spec matches when its key is required
  // and its value contains (or is contained by) a required value.
  const perProduct = new Map<number, Set<string>>();
  for (const ps of candidateSpecs) {
    const wanted = requiredByKey.get(ps.specKey.toLowerCase());
    if (!wanted) continue;
    const val = (ps.specValue ?? "").toLowerCase();
    const hit = wanted.some((w) => val.includes(w) || w.includes(val));
    if (!hit) continue;
    const set = perProduct.get(ps.storeProductId) ?? new Set<string>();
    set.add(ps.specKey.toLowerCase());
    perProduct.set(ps.storeProductId, set);
  }

  if (perProduct.size === 0) {
    return c.json({ requiredSpecCount: keys.length, matches: [] });
  }

  const productIds = [...perProduct.keys()];
  const products: (typeof showroomStoreProducts.$inferSelect)[] = [];
  for (const idChunk of chunk(productIds, 90)) {
    const rows = await db
      .select()
      .from(showroomStoreProducts)
      .where(inArray(showroomStoreProducts.id, idChunk));
    products.push(...rows);
  }

  const matches = products
    .map((p) => ({
      product: p,
      matchedSpecKeys: [...(perProduct.get(p.id) ?? [])],
      matchCount: perProduct.get(p.id)?.size ?? 0,
    }))
    .sort((a, b) => b.matchCount - a.matchCount);

  return c.json({ requiredSpecCount: keys.length, matches });
});
