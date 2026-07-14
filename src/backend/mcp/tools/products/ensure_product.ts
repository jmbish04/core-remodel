import { showroomStoreProducts } from "@backend/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { normalizeModelKey } from "@backend/lib/normalize-model";
import { parsePriceCents } from "@backend/lib/money";
import { looseObject, urlField } from "../../schemas";
import { productsUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";
import {
  assertBrand,
  assertMaterial,
  normalizeJsonDetails,
  normalizePrice,
  productDto,
  productOutputShape,
} from "./_shared";

export const ensureProduct = defineTool({
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
      modelNumber: z.string().optional().describe("Manufacturer model number/name"),
      msrp: z.string().optional().describe("Manufacturer core/list price (MSRP), free text"),
      msrpCents: z
        .number()
        .int()
        .optional()
        .describe("MSRP in integer cents (else derived from msrp text)"),
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      created: z.boolean(),
      product: looseObject(productOutputShape),
      url: urlField,
    },
    examples: [
      { title: "By sku", args: { itemName: "Litze Faucet", sku: "63221LF-PC" } },
      { title: "By brand+name", args: { itemName: "Litze Faucet", brandId: 4 } },
    ],
    handler: async ({ env, db }, input) => {
      if (input.brandId != null) await assertBrand(db, input.brandId);
      if (input.materialId != null) await assertMaterial(db, input.materialId);

      const modelKey = normalizeModelKey(input.modelNumber);
      const msrpCents = input.msrpCents ?? parsePriceCents(input.msrp);

      // Look up directly in the DB (don't load the whole catalog into memory).
      // 1) Dedup on (brandId, modelKey) first — the canonical unique index.
      let found: typeof showroomStoreProducts.$inferSelect | undefined;
      if (input.brandId != null && modelKey != null) {
        [found] = await db
          .select()
          .from(showroomStoreProducts)
          .where(
            and(
              eq(showroomStoreProducts.brandId, input.brandId),
              eq(showroomStoreProducts.modelKey, modelKey),
            ),
          )
          .limit(1);
      }

      // 2) Exact sku match.
      if (!found && input.sku) {
        [found] = await db
          .select()
          .from(showroomStoreProducts)
          .where(eq(showroomStoreProducts.sku, input.sku))
          .limit(1);
      }

      // 3) Otherwise (brandId + case-insensitive itemName).
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

      if (found) return { created: false, product: productDto(found), url: productsUrl(env, found.id) };

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
        modelNumber: input.modelNumber ?? null,
        modelKey,
        msrp: input.msrp ?? null,
        msrpCents: msrpCents ?? null,
      };
      const [created] = await db.insert(showroomStoreProducts).values(values).returning();
      return { created: true, product: productDto(created), url: productsUrl(env, created.id) };
    },
  });
