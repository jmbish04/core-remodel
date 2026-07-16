import { brands, showroomBrandMappings, showroomStores } from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { brandsUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";

export const linkBrandToShowroom = defineTool({
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
    outputShape: {
      created: z.boolean(),
      mapping: looseObject({
        id: z.number().int(),
        showroomId: z.number().int(),
        brandId: z.number().int(),
      }),
      url: urlField,
    },
    examples: [{ title: "Carry a brand", args: { brandId: 3, showroomId: 5 } }],
    handler: async ({ env, db }, input) => {
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
        return {
          created: false,
          mapping: { id: existing.id, showroomId: existing.showroomId, brandId: existing.brandId },
          url: brandsUrl(env, input.brandId),
        };
      }
      const [mapping] = await db
        .insert(showroomBrandMappings)
        .values({ showroomId: input.showroomId, brandId: input.brandId })
        .returning();
      return {
        created: true,
        mapping: { id: mapping.id, showroomId: mapping.showroomId, brandId: mapping.brandId },
        url: brandsUrl(env, input.brandId),
      };
    },
  });
