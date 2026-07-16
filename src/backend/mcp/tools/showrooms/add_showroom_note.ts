import { showroomStores, storeNotes } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

export const addShowroomNote = defineTool({
  name: "add_showroom_note",
  category: "showrooms",
  title: "Record a showroom note",
  description:
    "Append a freeform note to a showroom (the 'record a visit note' tool). Body is Markdown and is stored in both `contentMarkdown` and the legacy `note` column. Pass an optional `title` and `tags` (string[]). Validates the showroom exists first.",
  inputShape: {
    storeId: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
    title: z.string().optional().describe("Short display title for the note"),
    body: z.string().describe("Note body as Markdown (required)"),
    tags: z.array(z.string()).optional().describe("Free-form tags, stored as JSON"),
  },
  annotations: WRITE,
  examples: [
    {
      title: "Visit note",
      args: {
        storeId: 4,
        title: "Kitchen faucet walkthrough",
        body: "Saw the **Galley** sink in person — brass finish is warmer than online.",
        tags: ["kitchen", "faucet"],
      },
    },
  ],
  outputShape: {
    created: z.boolean(),
    note: looseObject({ id: z.number().int(), title: z.string().nullable() }),
    url: urlField,
  },
  handler: async ({ env, db }, input) => {
    const body = input.body?.trim();
    if (!body) toolError("`body` is required and cannot be empty.");
    const [store] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(eq(showroomStores.id, input.storeId))
      .limit(1);
    if (!store) {
      toolError(`Showroom ${input.storeId} not found. Call list_showrooms for valid ids.`);
    }
    const [created] = await db
      .insert(storeNotes)
      .values({
        storeId: input.storeId,
        title: input.title,
        contentMarkdown: body,
        note: body,
        tagsJson: input.tags ? JSON.stringify(input.tags) : undefined,
      })
      .returning();
    return { created: true, note: created, url: showroomUrl(env, input.storeId) };
  },
});
