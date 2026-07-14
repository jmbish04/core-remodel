import { showroomBrandMappings } from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { urlField } from "../../schemas";
import { brandsUrl } from "../../urls";
import { defineTool, DESTRUCTIVE } from "../../types";

export const unlinkBrandFromShowroom = defineTool({
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
    outputShape: {
      deleted: z.boolean(),
      reason: z.string().optional(),
      url: urlField,
    },
    examples: [{ title: "Stop carrying a brand", args: { brandId: 3, showroomId: 5 } }],
    handler: async ({ env, db }, input) => {
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
        return {
          deleted: false,
          reason: "No mapping existed for that (showroomId, brandId).",
          url: brandsUrl(env, input.brandId),
        };
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
      return { deleted: true, url: brandsUrl(env, input.brandId) };
    },
  });
