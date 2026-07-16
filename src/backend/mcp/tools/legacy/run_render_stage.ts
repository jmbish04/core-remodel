import { listingPhotos, renderCanvases } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { runStage } from "../../../services/render/stage-runner";
import type { StageType } from "../../../services/render/types";
import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, WRITE } from "../../types";

/**
 * Map a render canvas token to a public Cloudflare Images delivery URL. If the
 * token already looks like a URL we pass it through untouched.
 */
function deliveryUrlFromToken(token: string): string {
  return token.startsWith("http") ? token : `https://imagedelivery.net/${token}/public`;
}

/**
 * Pull a `deliveryUrl` out of a render canvas's JSON `metadata` column, if any.
 * Returns `null` on missing/invalid JSON or a non-string field.
 */
function metaDeliveryUrl(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { deliveryUrl?: unknown };
    return typeof parsed.deliveryUrl === "string" ? parsed.deliveryUrl : null;
  } catch {
    return null;
  }
}

/** Map an MCP `actionType` onto the internal render pipeline stage. */
const ACTION_TO_STAGE: Record<string, StageType> = {
  INITIAL_BASE: "stage_1_LP_base",
  STRUCTURAL_MOVE: "stage_2_LP_rough_in",
  MATERIAL_TWEAK: "stage_3_LP_finish",
  FINISH: "stage_3_LP_finish",
};

export const runRenderStage = defineTool({
    name: "run_render_stage",
    category: "render",
    title: "Run render stage",
    description:
      "Run a render stage. actionType: INITIAL_BASE (floor+paint from a blank canvas; needs listingPhotoId), STRUCTURAL_MOVE (rough-in), MATERIAL_TWEAK or FINISH (from a prior canvasId).",
    inputShape: {
      sessionId: z.string().describe("Render session id from create_render_session."),
      listingPhotoId: z
        .number()
        .optional()
        .describe("Listing photo id — required for INITIAL_BASE from a blank canvas."),
      canvasId: z
        .string()
        .optional()
        .describe("Parent canvas id to continue from (STRUCTURAL_MOVE/MATERIAL_TWEAK/FINISH)."),
      actionType: z
        .enum(["INITIAL_BASE", "STRUCTURAL_MOVE", "MATERIAL_TWEAK", "FINISH"])
        .describe("Which render stage to run."),
      prompt: z.string().describe("The render prompt."),
    },
    annotations: WRITE,
    // Envelope the opaque runStage result under `canvas` (passthrough) so the
    // tool carries an object outputSchema without enumerating every field.
    outputShape: {
      canvas: looseObject({ id: z.string() }),
    },
    handler: async ({ env, db }, input) => {
      const args = input as {
        actionType: unknown;
        canvasId?: unknown;
        listingPhotoId?: unknown;
        sessionId: unknown;
        prompt: unknown;
      };
      const type = ACTION_TO_STAGE[String(args.actionType)];
      if (!type) toolError("Invalid actionType");
      let inputImageUrl: string | null = null;
      let parentCanvasId: string | null = null;
      let listingPhotoId: number | null = (args.listingPhotoId as number | null) ?? null;
      let roomId: number | null = null;

      if (args.canvasId) {
        const parent = await db
          .select()
          .from(renderCanvases)
          .where(eq(renderCanvases.id, String(args.canvasId)))
          .get();
        if (!parent) toolError("Parent canvas not found");
        inputImageUrl =
          metaDeliveryUrl(parent!.metadata) ??
          (parent!.outputCfImageId ? deliveryUrlFromToken(parent!.outputCfImageId) : null);
        parentCanvasId = parent!.id;
        listingPhotoId = parent!.listingPhotoId ?? listingPhotoId;
        roomId = parent!.roomId ?? null;
      } else if (listingPhotoId != null) {
        const lp = await db
          .select()
          .from(listingPhotos)
          .where(eq(listingPhotos.id, listingPhotoId))
          .get();
        if (!lp) toolError("Listing photo not found");
        const token = lp!.blankCanvasCfImageId ?? lp!.cfImageId;
        if (!token) toolError("No blank canvas for this listing photo");
        inputImageUrl = deliveryUrlFromToken(token!);
        roomId = lp!.roomId ?? null;
      }
      if (!inputImageUrl) toolError("Provide canvasId or listingPhotoId");

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
      return { canvas: result };
    },
  });
