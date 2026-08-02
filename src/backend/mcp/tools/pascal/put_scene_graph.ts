import { z } from "zod";

import { countNodes } from "../../../services/pascal/edit";
import { loadScene, PascalStoreError, saveScene } from "../../../services/pascal/store";
import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";
import { sceneLink } from "./_shared";

export const putSceneGraph = defineTool({
  name: "put_scene_graph",
  category: "render",
  title: "Replace a scene's whole graph",
  description:
    "Replace a variant's ENTIRE Pascal scene graph with an AI-authored one (`{ nodes, rootNodeIds }`). Use for wholesale rewrites; for surgical changes prefer `edit_scene_nodes`. Bumps to a new checkpoint version; pass `expectedVersion` for optimistic concurrency.",
  inputShape: {
    sceneId: z.string().min(1),
    graph: z
      .object({
        nodes: z.record(z.string(), z.unknown()).optional(),
        rootNodeIds: z.array(z.string()).optional(),
      })
      .passthrough(),
    expectedVersion: z.number().int().nonnegative().optional(),
  },
  annotations: WRITE,
  examples: [
    {
      title: "Replace the graph",
      args: {
        sceneId: "scene-abc12345",
        graph: { nodes: { site: { id: "site", type: "site" } }, rootNodeIds: ["site"] },
      },
    },
  ],
  handler: async ({ env }, input) => {
    const row = await loadScene(env, input.sceneId);
    if (!row) return toolError(`Unknown sceneId '${input.sceneId}'`);
    try {
      const saved = await saveScene(env, input.sceneId, {
        name: row.name,
        projectId: row.projectId,
        graph: input.graph,
        saveMode: "checkpoint",
        expectedVersion: input.expectedVersion,
      });
      return {
        sceneId: saved.id,
        version: saved.version,
        nodeCount: countNodes(input.graph),
        editorUrl: sceneLink(env, saved.id),
      };
    } catch (err) {
      if (err instanceof PascalStoreError) return toolError(`${err.code}: ${err.message}`);
      throw err;
    }
  },
});
