/**
 * @fileoverview Shared helpers for the Products MCP tools.
 */
import { brands, materialScheduleItems, showroomStoreProducts } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { type RemodelDb } from "../../types";

/** Shared Zod output shape for a full product DTO (mirrors `productDto`). */
export const productOutputShape = {
  id: z.number().int(),
  itemName: z.string(),
  description: z.string().nullable(),
  productType: z.string().nullable(),
  brandId: z.number().int().nullable(),
  materialId: z.number().int().nullable(),
  modelNumber: z.string().nullable(),
  modelKey: z.string().nullable(),
  msrp: z.string().nullable(),
  msrpCents: z.number().int().nullable(),
  sku: z.string().nullable(),
  price: z.string().nullable(),
  colors: z.string().nullable(),
  preferredColor: z.string().nullable(),
  leadTime: z.string().nullable(),
  possibleDiscounts: z.string().nullable(),
  tradeDiscount: z.string().nullable(),
  jsonDetails: z.string().nullable(),
  notes: z.string().nullable(),
};

/**
 * Normalize a `price` input to the schema's TEXT column: pass strings through,
 * `String()` any number, and leave `undefined`/`null` untouched so a patch can
 * skip the field entirely.
 */
export function normalizePrice(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return String(v);
  return String(v);
}

/**
 * Normalize a `jsonDetails` input to the TEXT column: an object is
 * `JSON.stringify`-ed, a string is passed through as-is (already serialized),
 * and `undefined` is skipped.
 */
export function normalizeJsonDetails(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Shape a product row for tool output. */
export function productDto(p: typeof showroomStoreProducts.$inferSelect) {
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
    modelNumber: p.modelNumber,
    modelKey: p.modelKey,
    msrp: p.msrp,
    msrpCents: p.msrpCents,
  };
}

/** Confirm a brand row exists; throw an actionable tool error otherwise. */
export async function assertBrand(db: RemodelDb, brandId: number) {
  const [row] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
  if (!row) toolError(`Brand ${brandId} not found. Call list_brands for valid ids.`);
  return row;
}

/** Confirm a material-schedule item exists. */
export async function assertMaterial(db: RemodelDb, materialId: number) {
  const [row] = await db
    .select()
    .from(materialScheduleItems)
    .where(eq(materialScheduleItems.id, materialId))
    .limit(1);
  if (!row) toolError(`Material ${materialId} not found. Call list_materials for valid ids.`);
  return row;
}
