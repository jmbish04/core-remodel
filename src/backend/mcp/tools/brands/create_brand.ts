import { brands } from "@backend/db";
import { z } from "zod";

import { looseObject, urlField } from "../../schemas";
import { brandsUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";
import { brandDto, brandOutputShape, optionalBrandFields } from "./_shared";

export const createBrand = defineTool({
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
    outputShape: {
      created: z.boolean(),
      brand: looseObject(brandOutputShape),
      url: urlField,
    },
    examples: [
      { title: "Minimal", args: { name: "The Galley" } },
      {
        title: "With detail",
        args: { name: "THG Paris", websiteUrl: "https://thg-paris.com", pricePoint: "$$$$" },
      },
    ],
    handler: async ({ env, db }, input) => {
      const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const [created] = await db
        .insert(brands)
        .values(patch as unknown as typeof brands.$inferInsert)
        .returning();
      return { created: true, brand: brandDto(created), url: brandsUrl(env, created.id) };
    },
  });
