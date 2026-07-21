import { categories, subcategories } from "@backend/db";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listMaterialCategories = defineTool({
  name: "list_material_categories",
  category: "materials",
  title: "List material categories",
  description:
    "The ACTIVE category vocabulary a material can be tagged with, each with its active subcategories nested (e.g. Plumbing / Toilet, Appliance / Cooktop). This is the authoritative list — pass these ids as `categoryIds` / `subcategoryIds` to create_material or update_material. Never invent an id; anything not listed here is rejected.",
  inputShape: {
    q: z
      .string()
      .optional()
      .describe("Free-text filter — keeps a category whose name/description matches, or which has a matching subcategory"),
  },
  annotations: READ_ONLY,
  outputShape: {
    categories: z.array(
      looseObject({
        id: z.number().int(),
        name: z.string(),
        description: z.string().nullable(),
        subcategories: z.array(
          looseObject({
            id: z.number().int(),
            name: z.string(),
            description: z.string().nullable(),
          }),
        ),
      }),
    ),
    total: z.number().int(),
  },
  examples: [
    { title: "Whole vocabulary", args: {} },
    { title: "Find where a toilet belongs", args: { q: "toilet" } },
  ],
  handler: async ({ db }, input) => {
    const cats = await db
      .select()
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.name))
      .all();
    const subs = await db
      .select()
      .from(subcategories)
      .where(eq(subcategories.isActive, true))
      .orderBy(asc(subcategories.name))
      .all();

    const needle = input.q?.trim().toLowerCase();
    const hit = (...vals: (string | null)[]) =>
      !needle || vals.some((v) => (v ?? "").toLowerCase().includes(needle));

    const shaped = cats
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        subcategories: subs
          .filter((s) => s.categoryId === c.id)
          .map((s) => ({ id: s.id, name: s.name, description: s.description })),
      }))
      // A category survives the filter if it matches, or any of its subcategories does.
      .filter(
        (c) =>
          hit(c.name, c.description) || c.subcategories.some((s) => hit(s.name, s.description)),
      );

    return { categories: shaped, total: shaped.length };
  },
});
