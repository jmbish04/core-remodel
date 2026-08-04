import { showroomStores, showroomStoreLocations } from "@backend/db";
import {
  loadOneStoreLocations,
  primaryLocationStorePatch,
} from "@backend/services/showroom/locations";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, DESTRUCTIVE } from "../../types";

export const deleteShowroomLocation = defineTool({
  name: "delete_showroom_location",
  category: "showrooms",
  title: "Remove one showroom location",
  description:
    "Permanently remove ONE physical site from a showroom business — for a branch that has closed, or a site added in error. " +
    "The business itself and its other locations are untouched. " +
    "Refuses to remove a store's LAST remaining location: a business with zero sites is not something the directory can represent, so soft-delete the whole store with delete_showroom instead. " +
    "If the removed site was the primary, the next remaining location is promoted and mirrored to the store's legacy address fields.",
  inputShape: {
    locationId: z
      .number()
      .int()
      .positive()
      .describe("Location row id — from get_showroom's `locations[]`"),
  },
  annotations: DESTRUCTIVE,
  examples: [{ title: "Remove a closed branch", args: { locationId: 87 } }],
  outputShape: {
    deleted: z.boolean(),
    storeId: z.number().int(),
    remainingLocations: z.number().int(),
    url: urlField,
  },
  handler: async ({ env, db }, input) => {
    const [existing] = await db
      .select()
      .from(showroomStoreLocations)
      .where(eq(showroomStoreLocations.id, input.locationId))
      .limit(1);
    if (!existing) {
      toolError(
        `Location ${input.locationId} not found. Call get_showroom to list a store's locations.`,
      );
    }

    const before = await loadOneStoreLocations(db, existing.storeId);
    if (before.length <= 1) {
      toolError(
        `Location ${input.locationId} is the only site on showroom ${existing.storeId}. ` +
          `Removing it would leave the business with no address — use delete_showroom to retire the whole store instead.`,
      );
    }
    const wasPrimary = before.find((l) => l.id === input.locationId)?.isPrimary ?? false;

    await db
      .delete(showroomStoreLocations)
      .where(eq(showroomStoreLocations.id, input.locationId))
      .run();

    // Dual-write (0031 Phase A): dropping the primary promotes the next site, and the
    // legacy store columns must follow it or every un-migrated reader points at a closed
    // branch. Read-then-write, so this is deliberately NOT inside the delete's atomic unit.
    const after = await loadOneStoreLocations(db, existing.storeId);
    if (wasPrimary) {
      const [promoted] = await db
        .select()
        .from(showroomStoreLocations)
        .where(eq(showroomStoreLocations.id, after.find((l) => l.isPrimary)?.id ?? 0))
        .limit(1);
      if (promoted) {
        await db
          .update(showroomStores)
          .set(primaryLocationStorePatch(promoted))
          .where(eq(showroomStores.id, existing.storeId))
          .run();
      }
    }

    return {
      deleted: true,
      storeId: existing.storeId,
      remainingLocations: after.length,
      url: showroomUrl(env, existing.storeId),
    };
  },
});
