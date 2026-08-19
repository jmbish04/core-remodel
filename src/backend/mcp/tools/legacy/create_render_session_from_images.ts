import { renderSessions, showroomImages } from "@backend/db";
import { referenceSchema } from "@backend/services/render/references";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { defineTool, WRITE } from "../../types";

/**
 * `create_render_session_from_images` (0041 P2) — spin up a render session seeded
 * with a set of images as inspiration references. Accepts showroom photo ids
 * (resolved to their Cloudflare delivery URLs) and/or explicit {url,label} refs.
 * The seeds are stored on the session and shown in the studio inspiration rail.
 */
export const createRenderSessionFromImages = defineTool({
  name: "create_render_session_from_images",
  category: "render",
  title: "Create render session from images",
  description:
    "Create a render session seeded with inspiration reference images. Pass `showroomImageIds` (from the showroom photo copy chips / list_showrooms photos) and/or explicit `references` [{url,label}]. Returns { sessionId }.",
  inputShape: {
    name: z.string().describe("Human-readable name for the render session."),
    roomId: z.number().optional().describe("Optional room id this session belongs to."),
    showroomImageIds: z
      .array(z.number().int().positive())
      .max(500)
      .optional()
      .describe("showroom_images ids to seed as inspiration references (resolved to CF URLs)."),
    references: z
      .array(referenceSchema)
      .max(500)
      .optional()
      .describe("Explicit reference images as {url,label} (http(s) urls)."),
  },
  annotations: WRITE,
  examples: [
    {
      title: "Seed a session from selected showroom photos",
      args: { name: "Primary bath — vanity options", showroomImageIds: [254, 255] },
    },
  ],
  outputShape: {
    sessionId: z.string().describe("The created render session id"),
    seedCount: z.number().int().describe("How many reference images were seeded"),
  },
  handler: async ({ db }, input) => {
    const args = input as {
      name: string;
      roomId?: number;
      showroomImageIds?: number[];
      references?: { url: string; label?: string }[];
    };

    const refs: { url: string; label?: string }[] = [];
    for (const r of args.references ?? []) refs.push({ url: r.url, label: r.label });

    const ids = [...new Set(args.showroomImageIds ?? [])];
    for (let i = 0; i < ids.length; i += 20) {
      const part = ids.slice(i, i + 20);
      const rows = await db
        .select({ id: showroomImages.id, url: showroomImages.deliveryUrl, alt: showroomImages.altText })
        .from(showroomImages)
        .where(inArray(showroomImages.id, part));
      for (const r of rows) refs.push({ url: r.url, label: r.alt ?? `#${r.id}` });
    }

    const id = crypto.randomUUID();
    await db
      .insert(renderSessions)
      .values({
        id,
        name: args.name,
        roomId: args.roomId ?? null,
        seedReferenceUrlsJson: refs.length > 0 ? JSON.stringify(refs) : null,
      })
      .run();
    return { sessionId: id, seedCount: refs.length };
  },
});
