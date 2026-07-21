import { brands } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  applyBrandCleanups,
  reconcileBrandNames,
} from "@backend/services/brand-reconcile";
import { looseObject, urlField } from "../../schemas";
import { brandsUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";
import { brandDto, brandOutputShape, optionalBrandFields } from "./_shared";

export const ensureBrand = defineTool({
    name: "ensure_brand",
    category: "brands",
    title: "Find or create a brand",
    description:
      "Reuse-or-create primitive for reconcile / enrichment flows. Finds an existing brand even when the spelling differs — exact and normalised match first, then an AI identity check against the closest existing brands, so \"DORN BRACHT\" resolves to \"Dornbracht\" instead of creating a second row. Returns `created:false` with the existing brand, or inserts and returns `created:true`. When the stored name is a degraded form of the one supplied (ALL CAPS, missing spaces) it is also cleaned up, reported in `renamed`. Idempotent — safe to retry.",
    inputShape: {
      name: z.string().min(1).describe("Brand name to find or create (matched case-insensitively)"),
      ...optionalBrandFields,
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      created: z.boolean(),
      brand: looseObject(brandOutputShape),
      url: urlField,
      /** How the existing row was found: "exact", "normalized", or the AI's reason. */
      matchedBy: z.string().nullable(),
      /** Set when a degraded stored name was cleaned up as part of this call. */
      renamed: z
        .object({ from: z.string(), to: z.string() })
        .nullable(),
    },
    examples: [
      { title: "Reuse or create", args: { name: "Waterworks" } },
      {
        title: "Create with fields",
        args: { name: "Bain Ultra", websiteUrl: "https://bainultra.com", pricePoint: "$$$" },
      },
    ],
    handler: async ({ env, db }, input) => {
      const all = await db.select().from(brands).all();

      // Reconcile rather than compare. An exact lowercase match was what let
      // "DORN BRACHT" land beside "Dornbracht" and split that brand's showroom
      // mappings across two rows; this resolves spelling variants first and
      // only inserts when the brand is genuinely new.
      const plan = await reconcileBrandNames(
        env,
        all.map((b) => ({ id: b.id, name: b.name, websiteUrl: b.websiteUrl })),
        [{ name: input.name.trim(), websiteUrl: input.websiteUrl ?? null }],
      );

      const skip = plan.newBrandNamesToSkip[0];
      if (skip) {
        // Fold in any rename the reconciler proposed for the matched row, so a
        // degraded stored name gets repaired the first time it is touched.
        const cleanup = plan.existingBrandNamesToCleanup.find(
          (c) => c.brandId === skip.matchedBrandId,
        );
        if (cleanup) await applyBrandCleanups(db, [cleanup]);

        const [existing] = await db
          .select()
          .from(brands)
          .where(eq(brands.id, skip.matchedBrandId));
        return {
          created: false,
          brand: brandDto(existing),
          url: brandsUrl(env, existing.id),
          matchedBy: skip.reason,
          renamed: cleanup
            ? { from: cleanup.existingBrandName, to: cleanup.newCleanupBrandName }
            : null,
        };
      }

      const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const [created] = await db
        .insert(brands)
        .values(patch as unknown as typeof brands.$inferInsert)
        .returning();
      return {
        created: true,
        brand: brandDto(created),
        url: brandsUrl(env, created.id),
        matchedBy: null,
        renamed: null,
      };
    },
  });
