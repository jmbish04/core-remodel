/**
 * @fileoverview MCP tool — record_price_observation.
 */
import { productPriceObservations, showroomStoreProducts } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { parseDiscountPct, parsePriceCents } from "@backend/lib/money";
import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";

export const recordPriceObservation = defineTool({
  name: "record_price_observation",
  category: "products",
  title: "Record a price observation",
  description:
    "Record ONE price seen for a product from a single source: a showroom (pass showroomId), an online retailer (pass retailerName/retailerUrl), or the manufacturer (MSRP). Prices are free text ('$1,299'). Optionally link the price-card photo it came from via sourcePhotoId.",
  annotations: WRITE,
  inputShape: {
    productId: z.number().int().positive(),
    sourceType: z.enum(["showroom", "online_retailer", "manufacturer"]),
    showroomId: z.number().int().positive().optional(),
    retailerName: z.string().optional(),
    retailerUrl: z.string().optional(),
    price: z.string().optional(),
    salePrice: z.string().optional(),
    discountInfo: z.string().optional(),
    // Explicit numeric overrides; when omitted they are derived from the text.
    priceCents: z.number().int().optional(),
    salePriceCents: z.number().int().optional(),
    discountPct: z.number().optional(),
    condition: z.enum(["new", "floor_model", "clearance", "as_is"]).optional(),
    leadTime: z.string().optional(),
    notes: z.string().optional(),
    sourcePhotoId: z.number().int().positive().optional(),
    reviewStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  },
  examples: [
    {
      title: "Showroom price",
      args: { productId: 12, sourceType: "showroom", showroomId: 3, price: "$1,299" },
    },
    {
      title: "Manufacturer MSRP",
      args: { productId: 12, sourceType: "manufacturer", price: "$1,499" },
    },
  ],
  handler: async ({ db }, input) => {
    const [product] = await db
      .select()
      .from(showroomStoreProducts)
      .where(eq(showroomStoreProducts.id, input.productId))
      .limit(1);
    if (!product) toolError(`Product ${input.productId} not found. Call list_products for valid ids.`);
    if (input.sourceType === "showroom" && input.showroomId == null) {
      toolError("showroomId is required when sourceType='showroom'.");
    }

    // Derive numeric comparison fields from the text when not given explicitly.
    const priceCents = input.priceCents ?? parsePriceCents(input.price);
    const salePriceCents = input.salePriceCents ?? parsePriceCents(input.salePrice);
    const discountPct = input.discountPct ?? parseDiscountPct(input.discountInfo);

    const [row] = await db
      .insert(productPriceObservations)
      .values({
        productId: input.productId,
        sourceType: input.sourceType,
        // Persist source-specific fields only for their matching sourceType, so an
        // online-retailer observation can't carry a stray showroomId (and vice versa).
        showroomId: input.sourceType === "showroom" ? (input.showroomId ?? null) : null,
        retailerName: input.sourceType === "online_retailer" ? (input.retailerName ?? null) : null,
        retailerUrl: input.sourceType === "online_retailer" ? (input.retailerUrl ?? null) : null,
        price: input.price ?? null,
        salePrice: input.salePrice ?? null,
        discountInfo: input.discountInfo ?? null,
        priceCents,
        salePriceCents,
        discountPct,
        condition: input.condition,
        leadTime: input.leadTime ?? null,
        notes: input.notes ?? null,
        sourcePhotoId: input.sourcePhotoId ?? null,
        reviewStatus: input.reviewStatus ?? "approved",
      })
      .returning();
    return { observation: row };
  },
});
