import { asc } from "drizzle-orm";
import { showroomStoreType } from "@backend/db";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

/**
 * The showroom business-model TYPE vocabulary (showroom_store_type). This is the
 * single-select axis of HOW a store operates — orthogonal to the many-to-many
 * category axis of WHAT it sells. Hand a returned `id` to create_showroom /
 * update_showroom as `typeId`, or to list_showrooms as its `typeId` filter.
 */
export const listStoreTypes = defineTool({
  name: "list_store_types",
  category: "showrooms",
  title: "List showroom business-model types",
  description:
    "List the showroom business-model TYPES — how a store operates (corporate, authorized_dealer, " +
    "local_boutique, big_box_retail, distributor, manufacturer_factory, specialty_applied_finish, " +
    "specialty_no_showroom, design_build, salvage, made_to_order). Each row: id, key, displayName, " +
    "description, htmlColor, isActive. A store is exactly ONE type — pass a type's `id` as `typeId` when " +
    "creating/updating a showroom, or as the `typeId` filter on list_showrooms. By default only active " +
    "types; pass `includeInactive` to also see retired ones.",
  inputShape: {
    includeInactive: z
      .boolean()
      .optional()
      .describe("Include soft-retired (isActive=false) types too. Default false."),
  },
  annotations: READ_ONLY,
  outputShape: {
    types: z.array(
      looseObject({
        id: z.number().int(),
        key: z.string(),
        displayName: z.string(),
        description: z.string().nullable(),
        htmlColor: z.string().nullable(),
        isActive: z.boolean(),
      }),
    ),
  },
  examples: [
    { title: "All active types", args: {} },
    { title: "Including retired", args: { includeInactive: true } },
  ],
  handler: async ({ db }, input) => {
    const all = await db
      .select()
      .from(showroomStoreType)
      .orderBy(asc(showroomStoreType.displayName))
      .all();
    const types = all
      .filter((t) => input.includeInactive || t.isActive)
      .map((t) => ({
        id: t.id,
        key: t.key,
        displayName: t.displayName,
        description: t.description,
        htmlColor: t.htmlColor,
        isActive: t.isActive,
      }));
    return { types };
  },
});
