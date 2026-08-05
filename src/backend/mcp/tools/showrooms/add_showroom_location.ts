import { showroomStores, showroomStoreLocations } from "@backend/db";
import {
  loadOneStoreLocations,
  normalizeLocationNotes,
  primaryLocationStorePatch,
  resolveBayAreaCityId,
} from "@backend/services/showroom/locations";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

export const addShowroomLocation = defineTool({
  name: "add_showroom_location",
  category: "showrooms",
  title: "Add a physical location to a showroom",
  description:
    "Register an ADDITIONAL physical site for a showroom business that is already in the directory. " +
    "Use this whenever you find a store you already know about at an address it is not yet recorded at — a second branch, a business card from a different city, a Places result for the same chain. " +
    "This is the correct tool for that; update_showroom would OVERWRITE the existing primary address instead of adding a site, and create_showroom would mint a duplicate business. " +
    "Address parts are structured on purpose (there is no free-text address field): split the address yourself before calling, e.g. \"1234 Industrial Rd, San Carlos, CA 94070\" becomes streetNumber \"1234\", streetName \"Industrial Rd\", city \"San Carlos\", state \"CA\", zipCode \"94070\". " +
    "If a Google `placeId` is already held by another site, the call fails and names the store that owns it — check with find_known_showrooms first.",
  inputShape: {
    storeId: z
      .number()
      .int()
      .positive()
      .describe("Showroom store (business) id this site belongs to — from list_showrooms"),
    streetNumber: z.string().optional().describe('e.g. "1234"'),
    streetName: z.string().optional().describe('e.g. "Industrial Rd"'),
    city: z.string().optional().describe('e.g. "San Carlos"'),
    state: z.string().optional().describe('Two-letter state, e.g. "CA"'),
    zipCode: z.string().optional().describe('e.g. "94070"'),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    placeId: z
      .string()
      .optional()
      .describe("Google Places id for THIS site, when known. Must not already be in use."),
    googleMapsLink: z.string().optional(),
    notes: z
      .string()
      .optional()
      .describe('Site-specific plaintext notes, e.g. "the SF site is designer-only"'),
    notesMarkdown: z.string().optional().describe("Markdown source of truth for the notes"),
    notesHtml: z
      .string()
      .optional()
      .describe(
        "Render-ready HTML cache. Sanitized on write — script/style/iframe/object/embed tags and inline event handlers are stripped. Omit it and it is rendered from notesMarkdown server-side.",
      ),
  },
  annotations: WRITE,
  examples: [
    {
      title: "Add the San Carlos branch of a store already registered in Emeryville",
      args: {
        storeId: 42,
        streetNumber: "1234",
        streetName: "Industrial Rd",
        city: "San Carlos",
        state: "CA",
        zipCode: "94070",
      },
    },
  ],
  outputShape: {
    added: z.boolean(),
    location: looseObject({ id: z.number().int(), address: z.string().nullable() }),
    locationCount: z.number().int(),
    url: urlField,
  },
  handler: async ({ env, db }, input) => {
    const { storeId, ...parts } = input;

    const [store] = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.id, storeId))
      .limit(1);
    if (!store) {
      toolError(`Showroom ${storeId} not found. Call list_showrooms for valid ids.`);
    }

    // Refuse to write an address with nothing in it — an empty site is worse than none.
    const hasAddress = [
      parts.streetNumber,
      parts.streetName,
      parts.city,
      parts.zipCode,
      parts.latitude,
      parts.longitude,
      parts.placeId,
    ].some((v) => v !== undefined && v !== null && String(v).trim() !== "");
    if (!hasAddress) {
      toolError(
        "Nothing to locate — pass at least a city, a street, a zipCode, coordinates or a placeId.",
      );
    }

    // The placeId unique index spans ALL locations. Pre-check so the agent gets a message
    // naming the owner instead of a raw D1 constraint error.
    if (parts.placeId) {
      const [clash] = await db
        .select({ id: showroomStoreLocations.id, storeId: showroomStoreLocations.storeId })
        .from(showroomStoreLocations)
        .where(eq(showroomStoreLocations.placeId, parts.placeId))
        .limit(1);
      if (clash) {
        const [owner] = await db
          .select({ name: showroomStores.name })
          .from(showroomStores)
          .where(eq(showroomStores.id, clash.storeId))
          .limit(1);
        toolError(
          `placeId ${parts.placeId} is already location ${clash.id} of showroom ${clash.storeId} (${owner?.name ?? "unknown"}). ` +
            `That site is already registered — use update_showroom_location to correct it instead of adding a duplicate.`,
        );
      }
    }

    const bayAreaCityId = await resolveBayAreaCityId(db, parts.city);
    // notesHtml comes from an LLM — sanitize before it is ever persisted as a render cache.
    const safeParts = normalizeLocationNotes(parts);

    // Cast per the repo's house pattern (see brands/create_brand.ts): drizzle-orm@0.33's
    // insert inference collapses to just the notNull column and rejects the rest.
    const [inserted] = await db
      .insert(showroomStoreLocations)
      .values({ storeId, bayAreaCityId, ...safeParts } as unknown as typeof showroomStoreLocations.$inferInsert)
      .returning();

    // Dual-write (0031 Phase A): every un-migrated reader still uses the store's flat
    // columns, so the PRIMARY site must stay mirrored there. A store whose place_id is
    // unset and which had no site before gets its first location promoted to primary.
    const locations = await loadOneStoreLocations(db, storeId);
    const isPrimary = locations.find((l) => l.id === inserted.id)?.isPrimary ?? false;
    if (isPrimary) {
      await db
        .update(showroomStores)
        .set(primaryLocationStorePatch(inserted))
        .where(eq(showroomStores.id, storeId))
        .run();
    }

    return {
      added: true,
      location: locations.find((l) => l.id === inserted.id) ?? inserted,
      locationCount: locations.length,
      url: showroomUrl(env, storeId),
    };
  },
});
