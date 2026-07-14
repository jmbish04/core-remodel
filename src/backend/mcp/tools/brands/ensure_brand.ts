import { brands } from "@backend/db";
import { z } from "zod";

import { looseObject, urlField } from "../../schemas";
import { brandsUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";
import { brandDto, brandOutputShape, optionalBrandFields } from "./_shared";

export const ensureBrand = defineTool({
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
    outputShape: {
      created: z.boolean(),
      brand: looseObject(brandOutputShape),
      url: urlField,
    },
    examples: [
      { title: "Reuse or create", args: { name: "Waterworks" } },
      {
        title: "Create with fields",
        args: { name: "Bain Ultra", websiteUrl: "https://bainultra.com", pricePoint: "$$$" },
      },
    ],
    handler: async ({ env, db }, input) => {
      const target = input.name.trim().toLowerCase();
      // D1/SQLite LIKE is ASCII-case-insensitive, but do an explicit lowercase
      // compare in JS so the match is unambiguous regardless of collation.
      const all = await db.select().from(brands).all();
      const existing = all.find((b) => b.name.trim().toLowerCase() === target);
      if (existing) {
        return { created: false, brand: brandDto(existing), url: brandsUrl(env, existing.id) };
      }
      const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const [created] = await db
        .insert(brands)
        .values(patch as unknown as typeof brands.$inferInsert)
        .returning();
      return { created: true, brand: brandDto(created), url: brandsUrl(env, created.id) };
    },
  });
