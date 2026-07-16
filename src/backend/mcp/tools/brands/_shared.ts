/**
 * @fileoverview Shared helpers for the Brands MCP tools.
 *
 * Used by 2+ tools in this domain: `brandOutputShape` (get/create/update/ensure),
 * `brandDto` (get/create/update/ensure), and `optionalBrandFields`
 * (create/update/ensure).
 */
import { brands } from "@backend/db";
import { z } from "zod";

/** Shared Zod output shape for a full brand DTO (mirrors `brandDto`). */
export const brandOutputShape = {
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  instagramUrl: z.string().nullable(),
  facebookUrl: z.string().nullable(),
  pinterestUrl: z.string().nullable(),
  iconCfImagesUrl: z.string().nullable(),
  personalNotes: z.string().nullable(),
  onlineRating: z.number().nullable(),
  userRating: z.number().nullable(),
  pricePoint: z.string().nullable(),
};

/** Shape a brand row for full detail output. */
export function brandDto(b: typeof brands.$inferSelect) {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    websiteUrl: b.websiteUrl,
    instagramUrl: b.instagramUrl,
    facebookUrl: b.facebookUrl,
    pinterestUrl: b.pinterestUrl,
    iconCfImagesUrl: b.iconCfImagesUrl,
    personalNotes: b.personalNotes,
    onlineRating: b.onlineRating,
    userRating: b.userRating,
    pricePoint: b.pricePoint,
  };
}

/**
 * Optional brand columns accepted on create / ensure. Kept as a shared shape
 * so `create_brand` and `ensure_brand` fill in exactly the same fields.
 */
export const optionalBrandFields = {
  description: z.string().optional(),
  websiteUrl: z.string().optional().describe("Brand's primary website URL"),
  instagramUrl: z.string().optional(),
  facebookUrl: z.string().optional(),
  pinterestUrl: z.string().optional(),
  personalNotes: z.string().optional().describe("Freeform homeowner notes on the brand"),
  onlineRating: z.number().min(0).max(5).optional().describe("Aggregate/consensus rating 0-5"),
  userRating: z.number().min(0).max(5).optional().describe("Homeowner's personal rating 0-5"),
  pricePoint: z.enum(["$", "$$", "$$$", "$$$$"]).optional().describe("Relative price tier"),
} as const;
