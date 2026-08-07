import { listingPhotos } from "@backend/db";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { runStage } from "../../../services/render/stage-runner";
import { looseObject } from "../../schemas";
import { defineTool, WRITE } from "../../types";

/**
 * Resolves a Cloudflare Images token to its public delivery URL.
 * If the token is already a full URL, it is returned verbatim.
 *
 * @param token - The Cloudflare Images token or full URL.
 * @returns The resolved public delivery URL.
 */
function deliveryUrlFromToken(token: string): string {
  return token.startsWith("http") ? token : `https://imagedelivery.net/${token}/public`;
}

export const runRoomLooks = defineTool({
  name: "run_room_looks",
  category: "render",
  title: "Run room looks",
  description:
    "Render every angle of a single room from one design prompt. Builds the hero angle first, then renders each remaining angle with the hero as a consistency reference. Synchronous — use create_render_campaign for multi-room or long-running batches.",
  inputShape: {
    sessionId: z.string().describe("Render session id."),
    prompt: z.string().describe("Design prompt applied to every angle."),
    listingPhotoIds: z.array(z.number().int()).min(1).describe("Listing photo ids to render."),
    heroIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Which listingPhotoIds index is the hero (default 0)."),
    lightingProfile: z.enum(["default", "day", "night"]).optional(),
  },
  outputShape: {
    heroCanvasId: z.string(),
    canvases: z.array(looseObject({ id: z.string(), status: z.enum(["done", "failed"]) })),
  },
  annotations: WRITE,
  examples: [
    {
      title: "Render all kitchen angles",
      args: {
        sessionId: "a1b2c3d4-0000-0000-0000-000000000000",
        prompt: "Walnut cabinetry, Calacatta Viola island, matte black fixtures.",
        listingPhotoIds: [12, 13, 14],
      },
    },
  ],
  handler: async ({ env, db }, input) => {
    const rows = await db
      .select()
      .from(listingPhotos)
      .where(inArray(listingPhotos.id, input.listingPhotoIds))
      .all();
    const byId = new Map(rows.map((r) => [r.id, r]));

    const resolved = [];
    for (const id of input.listingPhotoIds) {
      const lp = byId.get(id);
      if (!lp) throw new Error(`Listing photo ${id} not found`);
      const token = lp.blankCanvasCfImageId ?? lp.cfImageId;
      if (!token) throw new Error(`Listing photo ${id} has no blank canvas`);
      resolved.push({
        listingPhotoId: id,
        url: deliveryUrlFromToken(token),
        roomId: lp.roomId ?? null,
      });
    }

    const hero = resolved[Math.min(input.heroIndex ?? 0, resolved.length - 1)];
    const heroResult = await runStage({
      env,
      sessionId: input.sessionId,
      type: "stage_3_LP_finish",
      inputImageUrl: hero.url,
      prompt: input.prompt,
      listingPhotoId: hero.listingPhotoId,
      roomId: hero.roomId,
      lightingProfile: input.lightingProfile,
    });

    const canvases = [heroResult];
    for (const ang of resolved) {
      if (ang.listingPhotoId === hero.listingPhotoId) continue;
      const r = await runStage({
        env,
        sessionId: input.sessionId,
        type: "stage_3_LP_finish",
        inputImageUrl: ang.url,
        prompt: `${input.prompt}\n\nThis is the SAME kitchen shown in the reference image — render it from THIS camera angle, matching the reference's materials, layout, cabinetry, and fixtures exactly. Keep this room's real walls, windows, and openings unchanged.`,
        listingPhotoId: ang.listingPhotoId,
        roomId: ang.roomId,
        lightingProfile: input.lightingProfile,
        references: heroResult.outputDeliveryUrl
          ? [
              {
                url: heroResult.outputDeliveryUrl,
                label: "the same kitchen (hero render) — match it exactly",
              },
            ]
          : undefined,
      });
      canvases.push(r);
    }

    return {
      heroCanvasId: heroResult.id,
      canvases: canvases.map((c) => ({ id: c.id, status: c.status })),
    };
  },
});
