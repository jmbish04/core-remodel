import { showroomStores, storeNotes } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

export const recordShowroomVisit = defineTool({
  name: "record_showroom_visit",
  category: "showrooms",
  title: "Record a showroom visit",
  description:
    "Log a completed showroom visit in one call: sets the store's latest-visit `rating` (1-5) and `ratingContextMarkdown` (also mirrored to `ratingContextHtml`) AND appends a `store_notes` visit note with the same Markdown body. Optional `tags` are attached to the note. Validates the showroom exists first.",
  inputShape: {
    showroomId: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
    rating: z.number().int().min(1).max(5).describe("Star rating for this visit, 1-5"),
    note: z.string().describe("Visit note / rating context as Markdown (required)"),
    tags: z.array(z.string()).optional().describe("Free-form tags for the visit note"),
  },
  annotations: WRITE,
  examples: [
    {
      title: "4-star visit",
      args: {
        showroomId: 4,
        rating: 4,
        note: "Great selection but **appointment-only** meant a long wait. Loved the Calacatta slabs.",
        tags: ["slabs", "counters"],
      },
    },
  ],
  outputShape: {
    recorded: z.boolean(),
    store: looseObject({ id: z.number().int(), rating: z.number().nullable() }),
    note: looseObject({ id: z.number().int(), title: z.string().nullable() }),
    url: urlField,
  },
  handler: async ({ env, db }, input) => {
    const note = input.note?.trim();
    if (!note) toolError("`note` is required and cannot be empty.");
    const [store] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(eq(showroomStores.id, input.showroomId))
      .limit(1);
    if (!store) {
      toolError(`Showroom ${input.showroomId} not found. Call list_showrooms for valid ids.`);
    }

    await db
      .update(showroomStores)
      .set({
        rating: input.rating,
        ratingContextMarkdown: note,
        ratingContextHtml: note,
      })
      .where(eq(showroomStores.id, input.showroomId))
      .run();

    const [visitNote] = await db
      .insert(storeNotes)
      .values({
        storeId: input.showroomId,
        title: `Visit — ${input.rating}★`,
        contentMarkdown: note,
        note,
        tagsJson: input.tags ? JSON.stringify(input.tags) : undefined,
      })
      .returning();

    const [updated] = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.id, input.showroomId))
      .limit(1);

    return {
      recorded: true,
      store: updated,
      note: visitNote,
      url: showroomUrl(env, input.showroomId),
    };
  },
});
