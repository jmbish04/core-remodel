import { showroomStoreProducts } from "@backend/db";
import { z } from "zod";

import { normalizeModelKey } from "@backend/lib/normalize-model";
import { parsePriceCents } from "@backend/lib/money";
import { looseObject, urlField } from "../../schemas";
import { productsUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";
import {
  assertBrand,
  assertMaterial,
  normalizeJsonDetails,
  normalizePrice,
  productDto,
  productOutputShape,
} from "./_shared";

export const createProduct = defineTool({
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
      modelNumber: z.string().optional().describe("Manufacturer model number/name"),
      msrp: z.string().optional().describe("Manufacturer core/list price (MSRP), free text"),
      msrpCents: z
        .number()
        .int()
        .optional()
        .describe("MSRP in integer cents (else derived from msrp text)"),
    },
    annotations: WRITE,
    outputShape: {
      created: z.boolean(),
      product: looseObject(productOutputShape),
      url: urlField,
    },
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
    handler: async ({ env, db }, input) => {
      if (input.brandId != null) await assertBrand(db, input.brandId);
      if (input.materialId != null) await assertMaterial(db, input.materialId);

      const modelKey = normalizeModelKey(input.modelNumber);
      const msrpCents = input.msrpCents ?? parsePriceCents(input.msrp);

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
