import { brands } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { brandsUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";
import { brandDto, brandOutputShape, optionalBrandFields } from "./_shared";

export const updateBrand = defineTool({
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
    outputShape: {
      updated: z.boolean(),
      brand: looseObject(brandOutputShape),
      url: urlField,
    },
    examples: [
      { title: "Set a price tier", args: { id: 3, pricePoint: "$$$" } },
      { title: "Add a personal note", args: { id: 3, personalNotes: "Loved the finish in person." } },
    ],
    handler: async ({ env, db }, input) => {
      const { id, ...rest } = input;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(patch).length === 0) toolError("No fields to update — pass at least one field.");
      const [existing] = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
      if (!existing) toolError(`Brand ${id} not found. Call list_brands for valid ids.`);
      await db.update(brands).set(patch).where(eq(brands.id, id)).run();
      const [updated] = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
      return { updated: true, brand: brandDto(updated), url: brandsUrl(env, id) };
    },
  });
