import { showroomStores, showroomStoreLocations } from "@backend/db";
import {
  loadOneStoreLocations,
  normalizeLocationNotes,
  primaryLocationStorePatch,
  resolveBayAreaCityId,
} from "@backend/services/showroom/locations";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

export const updateShowroomLocation = defineTool({
  name: "update_showroom_location",
  category: "showrooms",
  title: "Update one showroom location",
  description:
    "Patch a SINGLE physical site of a showroom business, by `locationId` (from get_showroom's `locations[]`). " +
    "Only the fields you pass change; everything else is left alone. Use this to correct one branch's address, coordinates, Google placeId or site-specific notes WITHOUT touching the business's other locations. " +
    "To register a site that is not in `locations[]` yet, use add_showroom_location instead. " +
    "Address parts are structured — split the address before calling.",
  inputShape: {
    locationId: z
      .number()
      .int()
      .positive()
      .describe("Location row id — from get_showroom's `locations[]`"),
    streetNumber: z.string().optional(),
    streetName: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    placeId: z.string().optional().describe("Google Places id — must not be in use elsewhere"),
    googleMapsLink: z.string().optional(),
    notes: z.string().optional().describe("Site-specific plaintext notes"),
    notesMarkdown: z.string().optional(),
    notesHtml: z
      .string()
      .optional()
      .describe(
        "Render-ready HTML cache. Sanitized on write; rendered from notesMarkdown when omitted.",
      ),
  },
  annotations: WRITE,
  examples: [
    { title: "Fix a branch's zip", args: { locationId: 87, zipCode: "94070" } },
    {
      title: "Attach a Places id to a manually-added site",
      args: { locationId: 87, placeId: "ChIJexample" },
    },
  ],
  outputShape: {
    updated: z.boolean(),
    location: looseObject({ id: z.number().int(), address: z.string().nullable() }),
    url: urlField,
  },
  handler: async ({ env, db }, input) => {
    const { locationId, ...rest } = input;
    // notesHtml comes from an LLM — sanitize before it is ever persisted as a render cache.
    const safeRest = normalizeLocationNotes(rest);
    const patch = Object.fromEntries(Object.entries(safeRest).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length === 0) {
      toolError("No fields to update — pass at least one field besides `locationId`.");
    }

    const [existing] = await db
      .select()
      .from(showroomStoreLocations)
      .where(eq(showroomStoreLocations.id, locationId))
      .limit(1);
    if (!existing) {
      toolError(`Location ${locationId} not found. Call get_showroom to list a store's locations.`);
    }

    // The placeId unique index spans ALL locations — name the owner rather than surfacing
    // a raw D1 constraint failure.
    if (typeof patch.placeId === "string") {
      const [clash] = await db
        .select({ id: showroomStoreLocations.id, storeId: showroomStoreLocations.storeId })
        .from(showroomStoreLocations)
        .where(
          and(
            eq(showroomStoreLocations.placeId, patch.placeId),
            ne(showroomStoreLocations.id, locationId),
          ),
        )
        .limit(1);
      if (clash) {
        toolError(
          `placeId ${patch.placeId} is already location ${clash.id} of showroom ${clash.storeId}. ` +
            `Two sites cannot share a Google place.`,
        );
      }
    }

    // Keep the region cluster consistent when the city moves.
    if (typeof patch.city === "string") {
      patch.bayAreaCityId = await resolveBayAreaCityId(db, patch.city);
    }

    // Cast per the repo's house pattern: drizzle-orm@0.33's update inference collapses to
    // just the notNull column and rejects every other field, including updatedAt.
    await db
      .update(showroomStoreLocations)
      .set({ ...patch, updatedAt: new Date() } as unknown as Partial<
        typeof showroomStoreLocations.$inferInsert
      >)
      .where(eq(showroomStoreLocations.id, locationId))
      .run();

    const [updated] = await db
      .select()
      .from(showroomStoreLocations)
      .where(eq(showroomStoreLocations.id, locationId))
      .limit(1);

    // Dual-write (0031 Phase A) — only the primary site mirrors to the legacy store columns.
    const locations = await loadOneStoreLocations(db, existing.storeId);
    const dto = locations.find((l) => l.id === locationId);
    if (dto?.isPrimary) {
      await db
        .update(showroomStores)
        .set(primaryLocationStorePatch(updated))
        .where(eq(showroomStores.id, existing.storeId))
        .run();
    }

    return {
      updated: true,
      location: dto ?? updated,
      url: showroomUrl(env, existing.storeId),
    };
  },
});
