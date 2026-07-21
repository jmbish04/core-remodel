import { brands } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { reconcileBrandNames } from "@backend/services/brand-reconcile";
import {
  addBrandNameVariation,
  loadBrandsWithNames,
  setPrimaryBrandName,
} from "@backend/services/brand-names";
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
      // Load display names AND every recorded alias. Matching against the alias
      // set is what stops a known-but-differently-spelled brand from forking a
      // new row — an exact lowercase compare is how "DORN BRACHT" landed beside
      // "Dornbracht" and split that brand's showroom mappings in half.
      const known = await loadBrandsWithNames(db);

      const plan = await reconcileBrandNames(
        env,
        known.map((b) => ({
          id: b.id,
          name: b.primaryName,
          websiteUrl: b.websiteUrl,
          aliases: b.variations,
        })),
        [{ name: input.name.trim(), websiteUrl: input.websiteUrl ?? null }],
      );

      const skip = plan.newBrandNamesToSkip[0];
      if (skip) {
        // Record the spelling we were handed, even though it matched. THIS is
        // what makes the registry self-improving: the next caller using this
        // spelling resolves deterministically, with no model call at all.
        await addBrandNameVariation(db, skip.matchedBrandId, input.name);

        // Fold in any rename the reconciler proposed for the matched row, so a
        // degraded stored name gets repaired the first time it is touched.
        const cleanup = plan.existingBrandNamesToCleanup.find(
          (c) => c.brandId === skip.matchedBrandId,
        );
        if (cleanup) {
          await setPrimaryBrandName(db, cleanup.brandId, cleanup.newCleanupBrandName);
        }

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

      // Seed the primary variation. Without this a freshly created brand has no
      // `is_primary` row, so it would render nameless once readers move off
      // `brands.name` — and it would be invisible to alias lookups.
      await setPrimaryBrandName(db, created.id, created.name);

      return {
        created: true,
        brand: brandDto(created),
        url: brandsUrl(env, created.id),
        matchedBy: null,
        renamed: null,
      };
    },
  });
