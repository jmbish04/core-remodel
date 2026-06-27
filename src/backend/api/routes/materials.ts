/**
 * @fileoverview Materials Schedule API
 *
 * CRUD for material schedule items and their required specs.
 * Includes a spec-match endpoint that finds showroom products matching
 * a material's requirements. Mounts at /api/materials.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc, and, like } from "drizzle-orm";
import { z } from "zod";

import {
  materialScheduleItems,
  materialRequiredSpecs,
} from "@backend/db/schema/materials/index";

import {
  showroomStoreProducts,
  showroomProductSpecs,
  showroomStores,
} from "@backend/db/schema/showroom/index";

export const materialsRouter = new Hono<{ Bindings: Env }>();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createMaterialSchema = z.object({
  title: z.string().min(1),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
});

const createRequiredSpecSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

// ─── SCHEDULE ITEMS CRUD ──────────────────────────────────────────────────────

/**
 * GET / — List all material schedule items with their required specs.
 * Query params: ?search=cooktop&purchased=true|false
 */
materialsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const search = c.req.query("search");
  const purchasedFilter = c.req.query("purchased");

  let query = db
    .select()
    .from(materialScheduleItems)
    .orderBy(desc(materialScheduleItems.dateAdded))
    .$dynamic();

  const conditions = [];
  if (search) {
    conditions.push(like(materialScheduleItems.title, `%${search}%`));
  }
  if (purchasedFilter === "true") {
    conditions.push(eq(materialScheduleItems.isPurchased, true));
  } else if (purchasedFilter === "false") {
    conditions.push(eq(materialScheduleItems.isPurchased, false));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const items = await query;

  // Batch-load specs for all items
  const allSpecs = await db
    .select()
    .from(materialRequiredSpecs)
    .orderBy(materialRequiredSpecs.key);

  const specsByMaterial = new Map<number, typeof allSpecs>();
  for (const spec of allSpecs) {
    const existing = specsByMaterial.get(spec.materialId) ?? [];
    existing.push(spec);
    specsByMaterial.set(spec.materialId, existing);
  }

  return c.json({
    items: items.map((item) => ({
      ...item,
      requiredSpecs: specsByMaterial.get(item.id) ?? [],
    })),
  });
});

/**
 * GET /:id — Get a single material item with its required specs and linked product.
 */
materialsRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const materialId = Number(c.req.param("id"));

  const [item] = await db
    .select()
    .from(materialScheduleItems)
    .where(eq(materialScheduleItems.id, materialId))
    .limit(1);

  if (!item) return c.json({ error: "Material not found" }, 404);

  const [specs, linkedProduct] = await Promise.all([
    db
      .select()
      .from(materialRequiredSpecs)
      .where(eq(materialRequiredSpecs.materialId, materialId))
      .orderBy(materialRequiredSpecs.key),
    item.purchasedShowroomProductId
      ? db
          .select({
            product: showroomStoreProducts,
            storeName: showroomStores.name,
          })
          .from(showroomStoreProducts)
          .innerJoin(
            showroomStores,
            eq(showroomStoreProducts.storeId, showroomStores.id)
          )
          .where(
            eq(showroomStoreProducts.id, item.purchasedShowroomProductId)
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  return c.json({
    ...item,
    requiredSpecs: specs,
    purchasedProduct: linkedProduct[0]
      ? {
          ...linkedProduct[0].product,
          storeName: linkedProduct[0].storeName,
        }
      : null,
  });
});

/**
 * POST / — Create a new material schedule item.
 */
materialsRouter.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();
  const data = createMaterialSchema.parse(body);

  const [inserted] = await db
    .insert(materialScheduleItems)
    .values(data)
    .returning();

  return c.json({ item: inserted }, 201);
});

/**
 * PUT /:id — Update a material schedule item.
 */
materialsRouter.put("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const materialId = Number(c.req.param("id"));
  const body = await c.req.json();
  const data = createMaterialSchema.partial().parse(body);

  const [updated] = await db
    .update(materialScheduleItems)
    .set({
      ...data,
      updatedAt: new Date(),
    } as Partial<typeof materialScheduleItems.$inferInsert>)
    .where(eq(materialScheduleItems.id, materialId))
    .returning();

  if (!updated) return c.json({ error: "Material not found" }, 404);

  return c.json({ item: updated });
});

/**
 * DELETE /:id — Delete a material schedule item (cascades required specs).
 */
materialsRouter.delete("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const materialId = Number(c.req.param("id"));

  await db
    .delete(materialScheduleItems)
    .where(eq(materialScheduleItems.id, materialId));

  return c.json({ success: true });
});

/**
 * PUT /:id/purchased — Mark a material as purchased and link to a showroom product.
 * Body: { isPurchased: boolean, purchasedShowroomProductId?: number }
 */
materialsRouter.put("/:id/purchased", async (c) => {
  const db = drizzle(c.env.DB);
  const materialId = Number(c.req.param("id"));
  const { isPurchased, purchasedShowroomProductId } = await c.req.json<{
    isPurchased: boolean;
    purchasedShowroomProductId?: number;
  }>();

  const [updated] = await db
    .update(materialScheduleItems)
    .set({
      isPurchased,
      purchasedShowroomProductId: purchasedShowroomProductId ?? null,
      updatedAt: new Date(),
    } as Partial<typeof materialScheduleItems.$inferInsert>)
    .where(eq(materialScheduleItems.id, materialId))
    .returning();

  if (!updated) return c.json({ error: "Material not found" }, 404);

  // If purchased + linked, also set materialId on the product side
  if (isPurchased && purchasedShowroomProductId) {
    await db
      .update(showroomStoreProducts)
      .set({
        materialId,
        updatedAt: new Date(),
      } as Partial<typeof showroomStoreProducts.$inferInsert>)
      .where(eq(showroomStoreProducts.id, purchasedShowroomProductId));
  }

  return c.json({ item: updated });
});

// ─── REQUIRED SPECS CRUD ──────────────────────────────────────────────────────

/**
 * GET /:id/specs — List required specs for a material.
 */
materialsRouter.get("/:id/specs", async (c) => {
  const db = drizzle(c.env.DB);
  const materialId = Number(c.req.param("id"));

  const specs = await db
    .select()
    .from(materialRequiredSpecs)
    .where(eq(materialRequiredSpecs.materialId, materialId))
    .orderBy(materialRequiredSpecs.key);

  return c.json({ specs });
});

/**
 * POST /:id/specs — Add a required spec to a material.
 */
materialsRouter.post("/:id/specs", async (c) => {
  const db = drizzle(c.env.DB);
  const materialId = Number(c.req.param("id"));
  const body = await c.req.json();
  const data = createRequiredSpecSchema.parse(body);

  const [inserted] = await db
    .insert(materialRequiredSpecs)
    .values({ materialId, ...data })
    .returning();

  return c.json({ spec: inserted }, 201);
});

/**
 * POST /:id/specs/batch — Add multiple required specs at once.
 */
materialsRouter.post("/:id/specs/batch", async (c) => {
  const db = drizzle(c.env.DB);
  const materialId = Number(c.req.param("id"));
  const body = await c.req.json<{ specs: { key: string; value: string }[] }>();
  const validated = z.array(createRequiredSpecSchema).parse(body.specs);

  const inserted = await db
    .insert(materialRequiredSpecs)
    .values(validated.map((s) => ({ materialId, ...s })))
    .returning();

  return c.json({ specs: inserted }, 201);
});

/**
 * PUT /:id/specs/:sid — Update a required spec.
 */
materialsRouter.put("/:id/specs/:sid", async (c) => {
  const db = drizzle(c.env.DB);
  const specId = Number(c.req.param("sid"));
  const body = await c.req.json();
  const data = createRequiredSpecSchema.partial().parse(body);

  const [updated] = await db
    .update(materialRequiredSpecs)
    .set(data)
    .where(eq(materialRequiredSpecs.id, specId))
    .returning();

  if (!updated) return c.json({ error: "Spec not found" }, 404);

  return c.json({ spec: updated });
});

/**
 * DELETE /:id/specs/:sid — Delete a required spec.
 */
materialsRouter.delete("/:id/specs/:sid", async (c) => {
  const db = drizzle(c.env.DB);
  const specId = Number(c.req.param("sid"));

  await db
    .delete(materialRequiredSpecs)
    .where(eq(materialRequiredSpecs.id, specId));

  return c.json({ success: true });
});

// ─── SPEC MATCHING ────────────────────────────────────────────────────────────

/**
 * GET /:id/match — Find showroom products whose specs match this material's
 * required specs. Returns products ranked by how many spec keys overlap.
 *
 * The matching is case-insensitive on the spec key and performs a substring
 * match on the value (so "3" matches "3 zones" or "3").
 */
materialsRouter.get("/:id/match", async (c) => {
  const db = drizzle(c.env.DB);
  const materialId = Number(c.req.param("id"));

  // Load the material's required specs
  const requiredSpecs = await db
    .select()
    .from(materialRequiredSpecs)
    .where(eq(materialRequiredSpecs.materialId, materialId));

  if (requiredSpecs.length === 0) {
    return c.json({
      matches: [],
      message: "No required specs defined for this material.",
    });
  }

  // Load all product specs and their parent products
  const allProductSpecs = await db
    .select({
      spec: showroomProductSpecs,
      product: showroomStoreProducts,
      storeName: showroomStores.name,
    })
    .from(showroomProductSpecs)
    .innerJoin(
      showroomStoreProducts,
      eq(showroomProductSpecs.showroomProductId, showroomStoreProducts.id)
    )
    .innerJoin(
      showroomStores,
      eq(showroomStoreProducts.storeId, showroomStores.id)
    );

  // Score each product by how many required specs it matches
  const productScores = new Map<
    number,
    {
      product: typeof showroomStoreProducts.$inferSelect;
      storeName: string;
      matchedKeys: string[];
      totalRequired: number;
    }
  >();

  for (const reqSpec of requiredSpecs) {
    const normalizedKey = reqSpec.key.toLowerCase();

    for (const row of allProductSpecs) {
      const specKey = row.spec.key.toLowerCase();
      const specValue = row.spec.value.toLowerCase();
      const reqValue = reqSpec.value.toLowerCase();

      if (specKey === normalizedKey && specValue.includes(reqValue)) {
        const existing = productScores.get(row.product.id);
        if (existing) {
          if (!existing.matchedKeys.includes(reqSpec.key)) {
            existing.matchedKeys.push(reqSpec.key);
          }
        } else {
          productScores.set(row.product.id, {
            product: row.product,
            storeName: row.storeName,
            matchedKeys: [reqSpec.key],
            totalRequired: requiredSpecs.length,
          });
        }
      }
    }
  }

  // Sort by match count descending
  const matches = Array.from(productScores.values())
    .sort((a, b) => b.matchedKeys.length - a.matchedKeys.length)
    .map((m) => ({
      ...m.product,
      storeName: m.storeName,
      matchedSpecs: m.matchedKeys,
      matchScore: m.matchedKeys.length,
      totalRequired: m.totalRequired,
      matchPercentage: Math.round(
        (m.matchedKeys.length / m.totalRequired) * 100
      ),
    }));

  return c.json({ matches });
});
