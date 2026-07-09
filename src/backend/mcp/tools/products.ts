/**
 * @fileoverview MCP tools — Products domain.
 *
 * Full CRUD + linking access to the global product catalog
 * (`showroom_store_products`), the reuse-or-create primitive (`ensure_product`),
 * and the two join tables that fan a product out across the model:
 *
 *   - `showroom_product_mappings`   — which showroom LOCATIONS carry a product
 *     (many-to-many; a product is global and may be carried at zero or more
 *     showrooms — there is no owning store).
 *   - `product_material_mappings`   — which material-schedule ITEMS a product
 *     satisfies (many-to-many; the product's legacy `materialId` column is the
 *     denormalized "primary" pointer that `isPrimary` mirrors).
 *
 * Money note: `showroom_store_products.price` is a free-text TEXT column (it may
 * hold "$1,299", "call for pricing", etc.), NOT integer cents — so unlike the
 * budget domain we accept a string here and only coerce numbers to a string.
 *
 * A product is global (no owning store) and optionally references a `brandId`
 * and a primary `materialId`. Link targets (brand / material) are validated to
 * exist before we write, so a tool call never leaves a dangling FK.
 */
import {
  brands,
  materialScheduleItems,
  productMaterialMappings,
  showroomProductMappings,
  showroomStoreProducts,
  showroomStores,
} from "@backend/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { matchesQuery, paginate, toolError } from "../format";
import { defineTool, READ_ONLY, WRITE, WRITE_IDEMPOTENT, type RemodelDb, type RemodelTool } from "../types";

/**
 * Normalize a `price` input to the schema's TEXT column: pass strings through,
 * `String()` any number, and leave `undefined`/`null` untouched so a patch can
 * skip the field entirely.
 */
function normalizePrice(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return String(v);
  return String(v);
}

/**
 * Normalize a `jsonDetails` input to the TEXT column: an object is
 * `JSON.stringify`-ed, a string is passed through as-is (already serialized),
 * and `undefined` is skipped.
 */
function normalizeJsonDetails(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Shape a product row for tool output. */
function productDto(p: typeof showroomStoreProducts.$inferSelect) {
  return {
    id: p.id,
    itemName: p.itemName,
    description: p.description,
    productType: p.productType,
    brandId: p.brandId,
    materialId: p.materialId,
    sku: p.sku,
    price: p.price,
    colors: p.colors,
    preferredColor: p.preferredColor,
    leadTime: p.leadTime,
    possibleDiscounts: p.possibleDiscounts,
    tradeDiscount: p.tradeDiscount,
    jsonDetails: p.jsonDetails,
    notes: p.notes,
  };
}

/** Confirm a brand row exists; throw an actionable tool error otherwise. */
async function assertBrand(db: RemodelDb, brandId: number) {
  const [row] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
  if (!row) toolError(`Brand ${brandId} not found. Call list_brands for valid ids.`);
  return row;
}

/** Confirm a showroom (store) row exists. */
async function assertStore(db: RemodelDb, showroomId: number) {
  const [row] = await db.select().from(showroomStores).where(eq(showroomStores.id, showroomId)).limit(1);
  if (!row) toolError(`Showroom ${showroomId} not found. Call list_showrooms for valid ids.`);
  return row;
}

/** Confirm a material-schedule item exists. */
async function assertMaterial(db: RemodelDb, materialId: number) {
  const [row] = await db
    .select()
    .from(materialScheduleItems)
    .where(eq(materialScheduleItems.id, materialId))
    .limit(1);
  if (!row) toolError(`Material ${materialId} not found. Call list_materials for valid ids.`);
  return row;
}

export const productTools: RemodelTool[] = [
  defineTool({
    name: "list_products",
    category: "products",
    title: "List products",
    description:
      "List the global product catalog (`showroom_store_products`). Optional filters: `brandId`, `materialId` (the product's primary/denormalized material pointer), `showroomId` (products carried at a showroom via the showroom_product_mappings join), `productType` (coarse category like 'Faucet'), and free-text `q` over itemName/description/sku. Paginated. Use a product's `id` as the target for get_product, update_product, and the link_* tools.",
    inputShape: {
      brandId: z.number().int().positive().optional().describe("Only products for this brand"),
      materialId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Only products whose primary materialId matches"),
      showroomId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Only products carried at this showroom (via showroom_product_mappings)"),
      productType: z.string().optional().describe("Exact coarse category, e.g. 'Faucet', 'Tile'"),
      q: z.string().optional().describe("Free-text filter over itemName / description / sku"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    examples: [
      { title: "All products", args: {} },
      { title: "Faucets for a brand", args: { brandId: 4, productType: "Faucet" } },
    ],
    handler: async ({ db }, input) => {
      let rows = await db.select().from(showroomStoreProducts).all();

      if (input.brandId != null) rows = rows.filter((r) => r.brandId === input.brandId);
      if (input.materialId != null) rows = rows.filter((r) => r.materialId === input.materialId);
      if (input.productType) rows = rows.filter((r) => r.productType === input.productType);

      if (input.showroomId != null) {
        const links = await db
          .select({ productId: showroomProductMappings.productId })
          .from(showroomProductMappings)
          .where(eq(showroomProductMappings.showroomId, input.showroomId))
          .all();
        const ids = new Set(links.map((l) => l.productId));
        rows = rows.filter((r) => ids.has(r.id));
      }

      if (input.q) {
        rows = rows.filter((r) => matchesQuery([r.itemName, r.description, r.sku], input.q as string));
      }

      return paginate(rows.map(productDto), input.limit ?? 50, input.offset ?? 0);
    },
  }),

  defineTool({
    name: "get_product",
    category: "products",
    title: "Get product detail",
    description:
      "Full detail for one product by `id`: the product row, its brand (name), the material-schedule items it is linked to (both the many-to-many product_material_mappings rows AND the legacy/denormalized primary `materialId`), and the showrooms that carry it (every showroom_product_mappings location, with store names — a product has no owning store).",
    inputShape: {
      id: z.number().int().positive().describe("Product id (from list_products)"),
    },
    annotations: READ_ONLY,
    examples: [{ title: "By id", args: { id: 12 } }],
    handler: async ({ db }, input) => {
      const [product] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, input.id))
        .limit(1);
      if (!product) toolError(`Product ${input.id} not found. Call list_products for valid ids.`);

      // Brand (name) — nullable.
      let brand: { id: number; name: string } | null = null;
      if (product.brandId != null) {
        const [b] = await db.select().from(brands).where(eq(brands.id, product.brandId)).limit(1);
        if (b) brand = { id: b.id, name: b.name };
      }

      // Linked materials: union of the join-table rows + the legacy primary.
      const matLinks = await db
        .select()
        .from(productMaterialMappings)
        .where(eq(productMaterialMappings.productId, product.id))
        .all();
      const matIds = new Set<number>(matLinks.map((m) => m.materialId));
      if (product.materialId != null) matIds.add(product.materialId);
      const matRows =
        matIds.size > 0
          ? await db
              .select()
              .from(materialScheduleItems)
              .where(inArray(materialScheduleItems.id, [...matIds]))
              .all()
          : [];
      const matById = new Map(matRows.map((m) => [m.id, m]));
      const materials = [...matIds].map((mid) => {
        const link = matLinks.find((l) => l.materialId === mid);
        const m = matById.get(mid);
        return {
          materialId: mid,
          title: m?.title ?? null,
          roomName: m?.roomName ?? null,
          isPrimary: link ? link.isPrimary : product.materialId === mid,
          viaJoinTable: Boolean(link),
          viaLegacyPointer: product.materialId === mid,
        };
      });

      // Showrooms carrying the product: purely from showroom_product_mappings
      // (a product has no owning store — it is global).
      const showroomLinks = await db
        .select()
        .from(showroomProductMappings)
        .where(eq(showroomProductMappings.productId, product.id))
        .all();
      const showroomIds = new Set<number>(showroomLinks.map((s) => s.showroomId));
      const storeRows =
        showroomIds.size > 0
          ? await db
              .select()
              .from(showroomStores)
              .where(inArray(showroomStores.id, [...showroomIds]))
              .all()
          : [];
      const storeById = new Map(storeRows.map((s) => [s.id, s]));
      const showrooms = [...showroomIds].map((sid) => ({
        id: sid,
        name: storeById.get(sid)?.name ?? null,
      }));

      return {
        ...productDto(product),
        brand,
        materials,
        showrooms,
      };
    },
  }),

  defineTool({
    name: "create_product",
    category: "products",
    title: "Create product",
    description:
      "Insert a new product into the catalog (`showroom_store_products`). Only `itemName` is required. `brandId` and `materialId` are validated to exist when provided. `price` is free text (a number is coerced to a string). `jsonDetails` accepts an object (JSON.stringify-ed) or a pre-serialized string. Prefer `ensure_product` when you want reuse-or-create semantics. Use link_product_to_showroom to associate the product with showroom locations.",
    inputShape: {
      itemName: z.string().min(1).describe("Product name (required)"),
      brandId: z.number().int().positive().optional().describe("Brand id (validated)"),
      materialId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Primary/denormalized material-schedule item id (validated)"),
      description: z.string().optional(),
      sku: z.string().optional(),
      price: z.union([z.string(), z.number()]).optional().describe("Free-text price; a number is String()-ed"),
      productType: z.string().optional().describe("Coarse category, e.g. 'Faucet', 'Tile'"),
      colors: z.string().optional(),
      preferredColor: z.string().optional(),
      jsonDetails: z
        .union([z.record(z.string(), z.unknown()), z.string()])
        .optional()
        .describe("Object (JSON.stringify-ed) or pre-serialized string of structured details"),
      notes: z.string().optional(),
      leadTime: z.string().optional(),
    },
    annotations: WRITE,
    examples: [
      { title: "Minimal", args: { itemName: "Litze Pull-Down Faucet" } },
      {
        title: "Full",
        args: {
          itemName: "Litze Pull-Down Faucet",
          brandId: 4,
          productType: "Faucet",
          price: "$899",
          sku: "63221LF-PC",
        },
      },
    ],
    handler: async ({ db }, input) => {
      if (input.brandId != null) await assertBrand(db, input.brandId);
      if (input.materialId != null) await assertMaterial(db, input.materialId);

      const values = {
        itemName: input.itemName,
        brandId: input.brandId ?? null,
        materialId: input.materialId ?? null,
        description: input.description ?? null,
        sku: input.sku ?? null,
        price: normalizePrice(input.price) ?? null,
        productType: input.productType ?? null,
        colors: input.colors ?? null,
        preferredColor: input.preferredColor ?? null,
        jsonDetails: normalizeJsonDetails(input.jsonDetails) ?? null,
        notes: input.notes ?? null,
        leadTime: input.leadTime ?? null,
      };

      const [created] = await db.insert(showroomStoreProducts).values(values).returning();
      return { created: true, product: productDto(created) };
    },
  }),

  defineTool({
    name: "update_product",
    category: "products",
    title: "Update product",
    description:
      "Patch any column of an existing product (`showroom_store_products`). Only the fields you pass are changed. `brandId`/`materialId` are validated when passed. `price` is free text (number coerced to string); `jsonDetails` accepts an object (JSON.stringify-ed) or a string. Does NOT touch the join tables — use link_product_to_showroom / link_product_to_material for those.",
    inputShape: {
      id: z.number().int().positive().describe("Product id (from list_products)"),
      itemName: z.string().min(1).optional(),
      brandId: z.number().int().positive().optional().describe("Brand id (validated)"),
      materialId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Primary/denormalized material id (validated)"),
      description: z.string().optional(),
      sku: z.string().optional(),
      price: z.union([z.string(), z.number()]).optional(),
      productType: z.string().optional(),
      colors: z.string().optional(),
      preferredColor: z.string().optional(),
      jsonDetails: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
      notes: z.string().optional(),
      leadTime: z.string().optional(),
      possibleDiscounts: z.string().optional(),
      tradeDiscount: z.string().optional(),
    },
    annotations: WRITE,
    examples: [
      { title: "Set price + sku", args: { id: 12, price: "$1,050", sku: "ABC-123" } },
      { title: "Categorize", args: { id: 12, productType: "Range" } },
    ],
    handler: async ({ db }, input) => {
      const { id, ...rest } = input;
      const [existing] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, id))
        .limit(1);
      if (!existing) toolError(`Product ${id} not found. Call list_products for valid ids.`);

      if (rest.brandId != null) await assertBrand(db, rest.brandId);
      if (rest.materialId != null) await assertMaterial(db, rest.materialId);

      // Build the patch from only the passed fields, normalizing the two
      // special columns.
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined) continue;
        if (k === "price") patch.price = normalizePrice(v);
        else if (k === "jsonDetails") patch.jsonDetails = normalizeJsonDetails(v);
        else patch[k] = v;
      }
      if (Object.keys(patch).length === 0) toolError("No fields to update — pass at least one field.");
      patch.updatedAt = new Date();

      await db.update(showroomStoreProducts).set(patch).where(eq(showroomStoreProducts.id, id)).run();
      const [updated] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, id))
        .limit(1);
      return { updated: true, product: productDto(updated) };
    },
  }),

  defineTool({
    name: "ensure_product",
    category: "products",
    title: "Ensure product (find-or-create)",
    description:
      "Reuse-or-create primitive. Finds an existing product by `sku` (when provided) OR by (`brandId` + case-insensitive `itemName`); if found, returns it with `created:false`. Otherwise inserts a new product from the provided fields and returns it with `created:true`. Ideal for idempotent import/enrichment flows that must not duplicate catalog rows.",
    inputShape: {
      itemName: z.string().min(1).describe("Product name (used for the brand+name match and on create)"),
      brandId: z.number().int().positive().optional().describe("Brand id — pairs with itemName for the lookup"),
      sku: z.string().optional().describe("If provided, an exact sku match wins the find before the name match"),
      materialId: z.number().int().positive().optional(),
      description: z.string().optional(),
      price: z.union([z.string(), z.number()]).optional(),
      productType: z.string().optional(),
      colors: z.string().optional(),
      preferredColor: z.string().optional(),
      jsonDetails: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
      notes: z.string().optional(),
      leadTime: z.string().optional(),
    },
    annotations: WRITE_IDEMPOTENT,
    examples: [
      { title: "By sku", args: { itemName: "Litze Faucet", sku: "63221LF-PC" } },
      { title: "By brand+name", args: { itemName: "Litze Faucet", brandId: 4 } },
    ],
    handler: async ({ db }, input) => {
      if (input.brandId != null) await assertBrand(db, input.brandId);
      if (input.materialId != null) await assertMaterial(db, input.materialId);

      // Look up directly in the DB (don't load the whole catalog into memory).
      // 1) Exact sku match wins first.
      let found: typeof showroomStoreProducts.$inferSelect | undefined;
      if (input.sku) {
        [found] = await db
          .select()
          .from(showroomStoreProducts)
          .where(eq(showroomStoreProducts.sku, input.sku))
          .limit(1);
      }

      // 2) Otherwise (brandId + case-insensitive itemName).
      if (!found) {
        const needle = input.itemName.trim().toLowerCase();
        const conds = [eq(sql`lower(${showroomStoreProducts.itemName})`, needle)];
        conds.push(
          input.brandId == null
            ? isNull(showroomStoreProducts.brandId)
            : eq(showroomStoreProducts.brandId, input.brandId),
        );
        [found] = await db
          .select()
          .from(showroomStoreProducts)
          .where(and(...conds))
          .limit(1);
      }

      if (found) return { created: false, product: productDto(found) };

      const values = {
        itemName: input.itemName,
        brandId: input.brandId ?? null,
        materialId: input.materialId ?? null,
        description: input.description ?? null,
        sku: input.sku ?? null,
        price: normalizePrice(input.price) ?? null,
        productType: input.productType ?? null,
        colors: input.colors ?? null,
        preferredColor: input.preferredColor ?? null,
        jsonDetails: normalizeJsonDetails(input.jsonDetails) ?? null,
        notes: input.notes ?? null,
        leadTime: input.leadTime ?? null,
      };
      const [created] = await db.insert(showroomStoreProducts).values(values).returning();
      return { created: true, product: productDto(created) };
    },
  }),

  defineTool({
    name: "link_product_to_showroom",
    category: "products",
    title: "Link product to showroom",
    description:
      "Record that a showroom LOCATION carries a product — upserts a `showroom_product_mappings` row. Idempotent: if the (showroomId, productId) pair already exists it is a no-op (`linked:false`). Both the product and the showroom are validated to exist.",
    inputShape: {
      productId: z.number().int().positive().describe("Product id (from list_products)"),
      showroomId: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
    },
    annotations: WRITE_IDEMPOTENT,
    examples: [{ title: "Carry a product", args: { productId: 12, showroomId: 3 } }],
    handler: async ({ db }, input) => {
      const [product] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, input.productId))
        .limit(1);
      if (!product) toolError(`Product ${input.productId} not found. Call list_products for valid ids.`);
      await assertStore(db, input.showroomId);

      const [existing] = await db
        .select()
        .from(showroomProductMappings)
        .where(
          and(
            eq(showroomProductMappings.showroomId, input.showroomId),
            eq(showroomProductMappings.productId, input.productId),
          ),
        )
        .limit(1);
      if (existing) return { linked: false, mapping: existing };

      const [mapping] = await db
        .insert(showroomProductMappings)
        .values({ showroomId: input.showroomId, productId: input.productId })
        .returning();
      return { linked: true, mapping };
    },
  }),

  defineTool({
    name: "link_product_to_material",
    category: "products",
    title: "Link product to material",
    description:
      "Record that a product satisfies a material-schedule item — upserts a `product_material_mappings` row. Idempotent: an existing (productId, materialId) pair is a no-op (`linked:false`), though `isPrimary` is still applied if requested. When `isPrimary` is true, ALSO sets the product's denormalized `showroom_store_products.materialId` pointer to this material. Both the product and the material are validated to exist.",
    inputShape: {
      productId: z.number().int().positive().describe("Product id (from list_products)"),
      materialId: z.number().int().positive().describe("Material-schedule item id (from list_materials)"),
      isPrimary: z
        .boolean()
        .optional()
        .describe("Mark this material as the product's principal one; also sets the legacy materialId pointer"),
    },
    annotations: WRITE_IDEMPOTENT,
    examples: [
      { title: "Link", args: { productId: 12, materialId: 7 } },
      { title: "Link as primary", args: { productId: 12, materialId: 7, isPrimary: true } },
    ],
    handler: async ({ db }, input) => {
      const [product] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, input.productId))
        .limit(1);
      if (!product) toolError(`Product ${input.productId} not found. Call list_products for valid ids.`);
      await assertMaterial(db, input.materialId);

      const isPrimary = input.isPrimary === true;

      const [existing] = await db
        .select()
        .from(productMaterialMappings)
        .where(
          and(
            eq(productMaterialMappings.productId, input.productId),
            eq(productMaterialMappings.materialId, input.materialId),
          ),
        )
        .limit(1);

      let mapping = existing;
      let linked = false;
      if (existing) {
        // No-op on the join row, but honor an isPrimary upgrade.
        if (isPrimary && !existing.isPrimary) {
          await db
            .update(productMaterialMappings)
            .set({ isPrimary: true })
            .where(eq(productMaterialMappings.id, existing.id))
            .run();
          mapping = { ...existing, isPrimary: true };
        }
      } else {
        const [created] = await db
          .insert(productMaterialMappings)
          .values({ productId: input.productId, materialId: input.materialId, isPrimary })
          .returning();
        mapping = created;
        linked = true;
      }

      // Denormalized primary pointer on the product row.
      let primarySet = false;
      if (isPrimary && product.materialId !== input.materialId) {
        await db
          .update(showroomStoreProducts)
          .set({ materialId: input.materialId, updatedAt: new Date() })
          .where(eq(showroomStoreProducts.id, input.productId))
          .run();
        primarySet = true;
      }

      return { linked, isPrimary, primaryPointerUpdated: primarySet, mapping };
    },
  }),
];
