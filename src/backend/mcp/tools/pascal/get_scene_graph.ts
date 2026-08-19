import { z } from "zod";

import { loadScene } from "../../../services/pascal/store";
import { serializeSceneWithGraph } from "../../../services/pascal/shapes";
import { toolError } from "../../format";
import { defineTool, READ_ONLY } from "../../types";
import { editorBase } from "./_shared";

export const getSceneGraph = defineTool({
  name: "get_scene_graph",
  category: "render",
  title: "Get a variant's full scene graph",
  description:
    "Return the COMPLETE Pascal scene graph for a variant (scene) — every node and every property: levels, slabs, zones, walls, openings, items, cameras, metadata. This is the full-fidelity read; use it before editing so you edit against real node ids. Includes scene metadata (version, provenance).",
  inputShape: { sceneId: z.string().min(1) },
  annotations: READ_ONLY,
  examples: [{ title: "Read a scene", args: { sceneId: "scene-abc12345" } }],
  handler: async ({ env }, input) => {
    const row = await loadScene(env, input.sceneId);
    if (!row) return toolError(`Unknown sceneId '${input.sceneId}'`);
    return serializeSceneWithGraph(row, editorBase(env));
  },
});
