import { listingPhotos, renderCanvases } from "@backend/db";
import { runStage } from "@backend/services/render/stage-runner";
import { eq } from "drizzle-orm";

import { ACTION_TO_STAGE, deliveryUrlFromToken, metaDeliveryUrl } from "../lib/render";
import type { ToolDef } from "../types";

export const runRenderStage: ToolDef = {
  name: "run_render_stage",
  description:
    "Run a render stage. actionType: INITIAL_BASE (floor+paint from a blank canvas; needs listingPhotoId), STRUCTURAL_MOVE (rough-in), MATERIAL_TWEAK or FINISH (from a prior canvasId).",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      listingPhotoId: { type: "number" },
      canvasId: { type: "string" },
      actionType: {
        type: "string",
        enum: ["INITIAL_BASE", "STRUCTURAL_MOVE", "MATERIAL_TWEAK", "FINISH"],
      },
      prompt: { type: "string" },
    },
    required: ["sessionId", "actionType", "prompt"],
  },
  handler: async ({ db, env, args }) => {
    const type = ACTION_TO_STAGE[String(args.actionType)];
    if (!type) throw new Error("Invalid actionType");
    let inputImageUrl: string | null = null;
    let parentCanvasId: string | null = null;
    let listingPhotoId: number | null = args.listingPhotoId ?? null;
    let roomId: number | null = null;

    if (args.canvasId) {
      const parent = await db
        .select()
        .from(renderCanvases)
        .where(eq(renderCanvases.id, String(args.canvasId)))
        .get();
      if (!parent) throw new Error("Parent canvas not found");
      inputImageUrl =
        metaDeliveryUrl(parent.metadata) ??
        (parent.outputCfImageId ? deliveryUrlFromToken(parent.outputCfImageId) : null);
      parentCanvasId = parent.id;
      listingPhotoId = parent.listingPhotoId ?? listingPhotoId;
      roomId = parent.roomId ?? null;
    } else if (listingPhotoId != null) {
      const lp = await db
        .select()
        .from(listingPhotos)
        .where(eq(listingPhotos.id, listingPhotoId))
        .get();
      if (!lp) throw new Error("Listing photo not found");
      const token = lp.blankCanvasCfImageId ?? lp.cfImageId;
      if (!token) throw new Error("No blank canvas for this listing photo");
      inputImageUrl = deliveryUrlFromToken(token);
      roomId = lp.roomId ?? null;
    }
    if (!inputImageUrl) throw new Error("Provide canvasId or listingPhotoId");

    const result = await runStage({
      env,
      sessionId: String(args.sessionId),
      type,
      inputImageUrl,
      prompt: String(args.prompt),
      parentCanvasId,
      listingPhotoId,
      roomId,
    });
    return JSON.stringify(result);
  },
};
