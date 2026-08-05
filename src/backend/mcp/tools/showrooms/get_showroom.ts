import {
  showroomStoreHours,
  showroomPocs,
  showroomStores,
  showroomStoreType,
  storeNotes,
} from "@backend/db";
import { loadOneStoreLocations } from "@backend/services/showroom/locations";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const getShowroom = defineTool({
  name: "get_showroom",
  category: "showrooms",
  title: "Get showroom detail",
  description:
    "Full detail for one showroom by `id`: the complete store row, ALL of its physical LOCATIONS, its ACTIVE points of contact, ALL per-day opening hours, and its ACTIVE notes (newest first). " +
    "IMPORTANT — a showroom store row is a BUSINESS, not an address. Bay Area chains have several sites under one store row, so read `locations[]` (each with its own derived `address`, coords, placeId and hub) rather than the store's legacy flat address fields, which only describe the PRIMARY site. " +
    "To register a site you found that is not in `locations[]`, call add_showroom_location — do NOT use update_showroom to overwrite the store's address, that replaces the primary site instead of adding a new one. " +
    "Call list_showrooms first to find the id.",
  inputShape: {
    id: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
  },
  annotations: READ_ONLY,
  outputShape: {
    store: looseObject({ id: z.number().int(), name: z.string().nullable() }),
    locations: z.array(
      looseObject({
        id: z.number().int(),
        address: z.string().nullable(),
        isPrimary: z.boolean(),
      }),
    ),
    locationCount: z.number().int(),
    pocs: z.array(looseObject({ id: z.number().int(), fullName: z.string().nullable() })),
    hours: z.array(looseObject({ id: z.number().int(), day: z.string() })),
    notes: z.array(looseObject({ id: z.number().int(), title: z.string().nullable() })),
  },
  examples: [{ title: "By id", args: { id: 1 } }],
  handler: async ({ db }, input) => {
    const [store] = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.id, input.id))
      .limit(1);
    if (!store) {
      toolError(`Showroom ${input.id} not found. Call list_showrooms for valid ids.`);
    }

    // Resolve the business-model type (single FK) — tiny config table, one row.
    const [type] = store.typeId
      ? await db
          .select()
          .from(showroomStoreType)
          .where(eq(showroomStoreType.id, store.typeId))
          .limit(1)
      : [];

    const pocs = await db
      .select()
      .from(showroomPocs)
      .where(and(eq(showroomPocs.showroomId, input.id), eq(showroomPocs.isActive, true)))
      .all();

    const hours = await db
      .select()
      .from(showroomStoreHours)
      .where(eq(showroomStoreHours.showroomId, input.id))
      .all();

    const notes = await db
      .select()
      .from(storeNotes)
      .where(and(eq(storeNotes.storeId, input.id), eq(storeNotes.isActive, true)))
      .orderBy(desc(storeNotes.timestamp))
      .all();

    // Every physical site for this business. One store row can own many.
    const locations = await loadOneStoreLocations(db, input.id);

    return {
      store: {
        ...store,
        typeKey: type?.key ?? null,
        typeName: type?.displayName ?? null,
        typeColor: type?.htmlColor ?? null,
      },
      locations,
      locationCount: locations.length,
      pocs: pocs.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        title: p.title,
        company: p.company,
        phone: p.phone,
        email: p.email,
        website: p.website,
        address: p.address,
      })),
      hours: hours.map((h) => ({
        id: h.id,
        day: h.day,
        openHour: h.openHour,
        openMinute: h.openMinute,
        closeHour: h.closeHour,
        closeMinute: h.closeMinute,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        contentMarkdown: n.contentMarkdown,
        note: n.note,
        tags: n.tagsJson ? (JSON.parse(n.tagsJson) as string[]) : [],
        timestamp: n.timestamp,
      })),
    };
  },
});
