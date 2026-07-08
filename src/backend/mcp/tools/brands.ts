/**
 * @fileoverview MCP tools — Brands domain.
 *
 * Read + write access to the global brand registry (`brands`), the many-to-many
 * mapping that records which showroom locations carry which brands
 * (`showroomBrandMappings`), and read-through to the products a brand supplies
 * (`showroomStoreProducts`).
 *
 * A brand is the manufacturer / design house behind products (e.g. "THG Paris",
 * "Waterworks", "The Galley"). Brands are a global leaf registry — they are NOT
 * scoped to a single showroom. The `ensure_brand` tool is the reuse-or-create
 * primitive that reconcile / enrichment flows lean on so we never insert a
 * duplicate brand row for a name that already exists.
 */
import { brands, showroomBrandMappings, showroomStores, showroomStoreProducts } from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { matchesQuery, paginate, toolError } from "../format";
import { defineTool, READ_ONLY, WRITE, WRITE_IDEMPOTENT, DESTRUCTIVE, type RemodelTool } from "../types";

/** Shape a brand row for compact list output. */
function brandListDto(b: typeof brands.$inferSelect) {
  return {
    id: b.id,
    name: b.name,
    pricePoint: b.pricePoint,
    onlineRating: b.onlineRating,
    userRating: b.userRating,
    websiteUrl: b.websiteUrl,
  };
}

/** Shape a brand row for full detail output. */
function brandDto(b: typeof brands.$inferSelect) {
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
const optionalBrandFields = {
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

export const brandTools: RemodelTool[] = [
  defineTool({
    name: "list_brands",
    category: "brands",
    title: "List brands",
    description:
      "List brands from the global registry (id, name, pricePoint, onlineRating, userRating, website). Optional free-text `q` filters by name/description. Use a brand's `id` as the target for get_brand, update_brand, and the showroom-link tools.",
    inputShape: {
      q: z.string().optional().describe("Free-text filter over brand name / description"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    examples: [
      { title: "All brands", args: {} },
      { title: "Find Waterworks", args: { q: "waterworks" } },
    ],
    handler: async ({ db }, input) => {
      const all = await db.select().from(brands).all();
      const filtered = input.q
        ? all.filter((b) => matchesQuery([b.name, b.description], input.q as string))
        : all;
      return paginate(filtered.map(brandListDto), input.limit ?? 50, input.offset ?? 0);
    },
  }),

  defineTool({
    name: "get_brand",
    category: "brands",
    title: "Get brand detail",
    description:
      "Full detail for one brand by `id` or `name` (exact match): the brand row plus the showroom locations that carry it (via showroom_brand_mappings → showroom_stores) and the products attributed to this brand (showroom_store_products where brandId = this brand).",
    inputShape: {
      id: z.number().int().positive().optional(),
      name: z.string().optional().describe("Exact brand name (case-insensitive)"),
    },
    annotations: READ_ONLY,
    examples: [
      { title: "By id", args: { id: 1 } },
      { title: "By name", args: { name: "Waterworks" } },
    ],
    handler: async ({ db }, input) => {
      if (input.id == null && !input.name) {
        toolError("Provide either `id` or `name`.");
      }

      let brand: typeof brands.$inferSelect | undefined;
      if (input.id != null) {
        [brand] = await db.select().from(brands).where(eq(brands.id, input.id)).limit(1);
      } else {
        // Case-insensitive exact-name lookup: pull candidates and compare in JS.
        const target = (input.name as string).trim().toLowerCase();
        const all = await db.select().from(brands).all();
        brand = all.find((b) => b.name.trim().toLowerCase() === target);
      }
      if (!brand) {
        toolError(`Brand not found (${input.id ?? input.name}). Call list_brands for valid ids.`);
      }

      // Showrooms carrying this brand (join mappings → stores).
      const mappings = await db
        .select({ showroomId: showroomBrandMappings.showroomId })
        .from(showroomBrandMappings)
        .where(eq(showroomBrandMappings.brandId, brand.id))
        .all();
      const showroomIds = mappings.map((m) => m.showroomId);
      const showroomRows = showroomIds.length
        ? await db
            .select({ id: showroomStores.id, name: showroomStores.name })
            .from(showroomStores)
            .where(inArray(showroomStores.id, showroomIds))
            .all()
        : [];

      // Products attributed to this brand.
      const products = await db
        .select({ id: showroomStoreProducts.id, itemName: showroomStoreProducts.itemName })
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.brandId, brand.id))
        .all();

      return {
        ...brandDto(brand),
        showrooms: showroomRows.map((s) => ({ id: s.id, name: s.name })),
        products: products.map((p) => ({ id: p.id, itemName: p.itemName })),
      };
    },
  }),

  defineTool({
    name: "create_brand",
    category: "brands",
    title: "Create a brand",
    description:
      "Insert a new brand into the global registry. `name` is required; all other fields are optional. Does NOT dedupe — if you might be re-inserting an existing brand, use ensure_brand instead.",
    inputShape: {
      name: z.string().min(1).describe("Official brand name (required)"),
      ...optionalBrandFields,
    },
    annotations: WRITE,
    examples: [
      { title: "Minimal", args: { name: "The Galley" } },
      {
        title: "With detail",
        args: { name: "THG Paris", websiteUrl: "https://thg-paris.com", pricePoint: "$$$$" },
      },
    ],
    handler: async ({ db }, input) => {
      const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const [created] = await db
        .insert(brands)
        .values(patch as unknown as typeof brands.$inferInsert)
        .returning();
      return { created: true, brand: brandDto(created) };
    },
  }),

  defineTool({
    name: "update_brand",
    category: "brands",
    title: "Update a brand",
    description:
      "Patch any column on an existing brand. Only the fields you pass are changed; omitted fields are left untouched.",
    inputShape: {
      id: z.number().int().positive().describe("Brand id (from list_brands)"),
      name: z.string().min(1).optional(),
      ...optionalBrandFields,
    },
    annotations: WRITE,
    examples: [
      { title: "Set a price tier", args: { id: 3, pricePoint: "$$$" } },
      { title: "Add a personal note", args: { id: 3, personalNotes: "Loved the finish in person." } },
    ],
    handler: async ({ db }, input) => {
      const { id, ...rest } = input;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(patch).length === 0) toolError("No fields to update — pass at least one field.");
      const [existing] = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
      if (!existing) toolError(`Brand ${id} not found. Call list_brands for valid ids.`);
      await db.update(brands).set(patch).where(eq(brands.id, id)).run();
      const [updated] = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
      return { updated: true, brand: brandDto(updated) };
    },
  }),

  defineTool({
    name: "ensure_brand",
    category: "brands",
    title: "Find or create a brand",
    description:
      "Reuse-or-create primitive for reconcile / enrichment flows. Looks up a brand by case-insensitive `name`: if one exists it is returned unchanged with `created:false`; otherwise a new brand is inserted (using the optional fields) and returned with `created:true`. Idempotent — safe to retry.",
    inputShape: {
      name: z.string().min(1).describe("Brand name to find or create (matched case-insensitively)"),
      ...optionalBrandFields,
    },
    annotations: WRITE_IDEMPOTENT,
    examples: [
      { title: "Reuse or create", args: { name: "Waterworks" } },
      {
        title: "Create with fields",
        args: { name: "Bain Ultra", websiteUrl: "https://bainultra.com", pricePoint: "$$$" },
      },
    ],
    handler: async ({ db }, input) => {
      const target = input.name.trim().toLowerCase();
      // D1/SQLite LIKE is ASCII-case-insensitive, but do an explicit lowercase
      // compare in JS so the match is unambiguous regardless of collation.
      const all = await db.select().from(brands).all();
      const existing = all.find((b) => b.name.trim().toLowerCase() === target);
      if (existing) {
        return { created: false, brand: brandDto(existing) };
      }
      const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const [created] = await db
        .insert(brands)
        .values(patch as unknown as typeof brands.$inferInsert)
        .returning();
      return { created: true, brand: brandDto(created) };
    },
  }),

  defineTool({
    name: "link_brand_to_showroom",
    category: "brands",
    title: "Link a brand to a showroom",
    description:
      "Record that a showroom location carries a brand (upsert into showroom_brand_mappings). Both `brandId` and `showroomId` must exist. If the (showroomId, brandId) mapping already exists it is left as-is. Idempotent — safe to retry.",
    inputShape: {
      brandId: z.number().int().positive().describe("Brand id (from list_brands)"),
      showroomId: z.number().int().positive().describe("Showroom store id"),
    },
    annotations: WRITE_IDEMPOTENT,
    examples: [{ title: "Carry a brand", args: { brandId: 3, showroomId: 5 } }],
    handler: async ({ db }, input) => {
      const [brand] = await db.select().from(brands).where(eq(brands.id, input.brandId)).limit(1);
      if (!brand) toolError(`Brand ${input.brandId} not found. Call list_brands for valid ids.`);
      const [store] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.id, input.showroomId))
        .limit(1);
      if (!store) toolError(`Showroom ${input.showroomId} not found.`);

      const [existing] = await db
        .select()
        .from(showroomBrandMappings)
        .where(
          and(
            eq(showroomBrandMappings.showroomId, input.showroomId),
            eq(showroomBrandMappings.brandId, input.brandId)
          )
        )
        .limit(1);
      if (existing) {
        return { created: false, mapping: { id: existing.id, showroomId: existing.showroomId, brandId: existing.brandId } };
      }
      const [mapping] = await db
        .insert(showroomBrandMappings)
        .values({ showroomId: input.showroomId, brandId: input.brandId })
        .returning();
      return {
        created: true,
        mapping: { id: mapping.id, showroomId: mapping.showroomId, brandId: mapping.brandId },
      };
    },
  }),

  defineTool({
    name: "unlink_brand_from_showroom",
    category: "brands",
    title: "Unlink a brand from a showroom",
    description:
      "Delete the mapping row that records a showroom carrying a brand (showroom_brand_mappings). No-op-safe: reports whether a row was actually deleted.",
    inputShape: {
      brandId: z.number().int().positive().describe("Brand id"),
      showroomId: z.number().int().positive().describe("Showroom store id"),
    },
    annotations: DESTRUCTIVE,
    examples: [{ title: "Stop carrying a brand", args: { brandId: 3, showroomId: 5 } }],
    handler: async ({ db }, input) => {
      const [existing] = await db
        .select()
        .from(showroomBrandMappings)
        .where(
          and(
            eq(showroomBrandMappings.showroomId, input.showroomId),
            eq(showroomBrandMappings.brandId, input.brandId)
          )
        )
        .limit(1);
      if (!existing) {
        return { deleted: false, reason: "No mapping existed for that (showroomId, brandId)." };
      }
      await db
        .delete(showroomBrandMappings)
        .where(
          and(
            eq(showroomBrandMappings.showroomId, input.showroomId),
            eq(showroomBrandMappings.brandId, input.brandId)
          )
        )
        .run();
      return { deleted: true };
    },
  }),
];
