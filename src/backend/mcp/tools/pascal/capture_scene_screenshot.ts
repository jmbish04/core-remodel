import { z } from "zod";

import { captureSceneScreenshot } from "../../../services/pascal/capture";
import { loadScene, recordSnapshot } from "../../../services/pascal/store";
import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";
import { sceneLink } from "./_shared";

export const captureSceneScreenshotTool = defineTool({
  name: "capture_scene_screenshot",
  category: "render",
  title: "Capture a scene screenshot",
  description:
    "Render a variant's scene through Cloudflare Browser Rendering and store the image in Cloudflare Images, saving it as the variant's thumbnail by default. Returns the delivery URL. NOTE: Pascal renders client-side WebGPU; if the headless capture comes back blank, use the editor's canvas-capture fallback instead.",
  inputShape: {
    sceneId: z.string().min(1),
    width: z.number().int().min(320).max(3840).optional(),
    height: z.number().int().min(240).max(2160).optional(),
    fullPage: z.boolean().optional(),
    setAsThumbnail: z.boolean().optional(),
    caption: z.string().max(300).optional(),
  },
  annotations: WRITE,
  examples: [{ title: "Snapshot a variant", args: { sceneId: "scene-abc12345" } }],
  handler: async ({ env }, input) => {
    const row = await loadScene(env, input.sceneId);
    if (!row) return toolError(`Unknown sceneId '${input.sceneId}'`);
    try {
      const shot = await captureSceneScreenshot(env, sceneLink(env, input.sceneId), {
        width: input.width,
        height: input.height,
        fullPage: input.fullPage,
      });
      await recordSnapshot(env, {
        variantId: input.sceneId,
        cfImageId: shot.imageId,
        imageUrl: shot.deliveryUrl,
        caption: input.caption ?? null,
        setAsThumbnail: input.setAsThumbnail,
      });
      return {
        sceneId: input.sceneId,
        imageId: shot.imageId,
        deliveryUrl: shot.deliveryUrl,
        sceneVersion: row.version,
      };
    } catch (err) {
      return toolError(
        `Capture failed (${err instanceof Error ? err.message : "error"}). ` +
          "If the scene is a client-side WebGPU render, use the editor canvas-capture fallback.",
      );
    }
  },
});
