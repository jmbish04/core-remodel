import { z } from "zod";

import { loadScene } from "../../../services/pascal/store";
import { toolError } from "../../format";
import { defineTool, READ_ONLY } from "../../types";
import { sceneLink } from "./_shared";

export const getVariantEditorLink = defineTool({
  name: "get_variant_editor_link",
  category: "render",
  title: "Get a variant's editor deep-link",
  description:
    "Return the Pascal editor URL for a variant (`/scene/:id`) — the link to open and visually edit that layout.",
  inputShape: { sceneId: z.string().min(1) },
  annotations: READ_ONLY,
  examples: [{ title: "Link for a variant", args: { sceneId: "scene-abc12345" } }],
  handler: async ({ env }, input) => {
    const row = await loadScene(env, input.sceneId);
    if (!row) return toolError(`Unknown sceneId '${input.sceneId}'`);
    return { sceneId: row.id, name: row.name, editorUrl: sceneLink(env, row.id) };
  },
});
