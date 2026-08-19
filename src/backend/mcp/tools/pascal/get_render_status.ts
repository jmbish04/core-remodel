import { z } from "zod";

import { loadScene } from "../../../services/pascal/store";
import { toolError } from "../../format";
import { defineTool, READ_ONLY } from "../../types";
import { sceneLink } from "./_shared";

export const getRenderStatus = defineTool({
  name: "get_render_status",
  category: "render",
  title: "Get a variant's render status",
  description:
    "Version + lifecycle status of a variant: version, published/draft flags, node count, thumbnail, and editor link. Use to check whether a scene has been edited or has a snapshot yet.",
  inputShape: { sceneId: z.string().min(1) },
  annotations: READ_ONLY,
  examples: [{ title: "Status of a variant", args: { sceneId: "scene-abc12345" } }],
  handler: async ({ env }, input) => {
    const row = await loadScene(env, input.sceneId);
    if (!row) return toolError(`Unknown sceneId '${input.sceneId}'`);
    return {
      sceneId: row.id,
      name: row.name,
      version: row.version,
      status: row.status,
      isDraft: row.isDraft,
      published: row.published,
      nodeCount: row.nodeCount,
      thumbnailUrl: row.thumbnailUrl,
      editorUrl: sceneLink(env, row.id),
    };
  },
});
