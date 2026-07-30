import { renderSessions } from "@backend/db";
import {
  mergeRefs,
  parseSeedRefs,
  referenceSchema,
  resolveShowroomImageRefs,
} from "@backend/services/render/references";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";

/**
 * `add_render_references` (0041 P3) — add inspiration reference images to an
 * existing render session. Accepts a showroom photo folder (`imageGroupId` → all
 * its photos), individual `showroomImageIds`, and/or explicit `references`. Merges
 * into the session's seed list (deduped by url).
 */
export const addRenderReferences = defineTool({
  name: "add_render_references",
  category: "render",
  title: "Add render references",
  description:
    "Add inspiration reference images to a render session. Pass a showroom photo folder (`imageGroupId`), `showroomImageIds`, and/or explicit `references` [{url,label}]. Returns the updated reference set.",
  inputShape: {
    sessionId: z.string().describe("Render session id (from create_render_session*)."),
    imageGroupId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("A showroom image-group (folder) id — adds every photo in it."),
    showroomImageIds: z
      .array(z.number().int().positive())
      .max(500)
      .optional()
      .describe("Individual showroom_images ids."),
    references: z
      .array(referenceSchema)
      .max(500)
      .optional()
      .describe("Explicit reference images as {url,label} (http(s) urls)."),
  },
  annotations: WRITE,
  examples: [
    { title: "Add a whole folder of showroom photos", args: { sessionId: "…", imageGroupId: 2 } },
  ],
  outputShape: {
    seedReferences: z
      .array(z.object({ url: z.string(), label: z.string().optional() }))
      .describe("The session's reference set after the merge."),
  },
  handler: async ({ db }, input) => {
    const args = input as {
      sessionId: string;
      imageGroupId?: number;
      showroomImageIds?: number[];
      references?: { url: string; label?: string }[];
    };
    const session = await db
      .select()
      .from(renderSessions)
      .where(eq(renderSessions.id, args.sessionId))
      .get();
    if (!session) toolError(`Render session ${args.sessionId} not found.`);

    const added = await resolveShowroomImageRefs(db, {
      imageGroupId: args.imageGroupId,
      showroomImageIds: args.showroomImageIds,
      references: args.references,
    });
    if (added.length === 0) toolError("No images resolved — pass imageGroupId, showroomImageIds, or references.");

    const merged = mergeRefs(parseSeedRefs(session!.seedReferenceUrlsJson), added);
    await db
      .update(renderSessions)
      .set({ seedReferenceUrlsJson: JSON.stringify(merged), datetimeLastModified: new Date() })
      .where(eq(renderSessions.id, args.sessionId))
      .run();
    return { seedReferences: merged };
  },
});
