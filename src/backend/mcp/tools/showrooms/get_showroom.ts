import {
  showroomStoreHours,
  showroomPocs,
  showroomStores,
  showroomStoreType,
  storeNotes,
} from "@backend/db";
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
    "Full detail for one showroom by `id`: the complete store row, its ACTIVE points of contact, ALL per-day opening hours, and its ACTIVE notes (newest first). Call list_showrooms first to find the id.",
  inputShape: {
    id: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
  },
  annotations: READ_ONLY,
  outputShape: {
    store: looseObject({ id: z.number().int(), name: z.string().nullable() }),
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

    return {
      store: {
        ...store,
        typeKey: type?.key ?? null,
        typeName: type?.displayName ?? null,
        typeColor: type?.htmlColor ?? null,
      },
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
