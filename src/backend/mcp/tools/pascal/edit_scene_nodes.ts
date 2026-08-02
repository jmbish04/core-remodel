import { z } from "zod";

import { applyNodeOps, countNodes } from "../../../services/pascal/edit";
import { parseGraphJson } from "../../../services/pascal/shapes";
import { loadScene, PascalStoreError, saveScene } from "../../../services/pascal/store";
import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";
import { sceneLink } from "./_shared";

export const editSceneNodes = defineTool({
  name: "edit_scene_nodes",
  category: "render",
  title: "Edit a scene's nodes",
  description:
    "Apply granular ops to a variant's Pascal scene graph — add/update/delete/move ANY node with ANY properties (walls, openings, items, cameras, …). Full fidelity. Each op is validated against the live graph, so a bad node id is rejected. Bumps the scene to a new checkpoint version; pass `expectedVersion` for optimistic concurrency.",
  inputShape: {
    sceneId: z.string().min(1),
    ops: z
      .array(
        z.object({
          op: z.enum(["add", "update", "delete", "move"]),
          nodeId: z.string().min(1),
          node: z.record(z.string(), z.unknown()).optional(),
          parentId: z.string().min(1).nullable().optional(),
        }),
      )
      .min(1)
      .max(200),
    expectedVersion: z.number().int().nonnegative().optional(),
  },
  annotations: WRITE,
  examples: [
    {
      title: "Add an island item to a zone",
      args: {
        sceneId: "scene-abc12345",
        ops: [
          {
            op: "add",
            nodeId: "item_island",
            parentId: "zone_kitchen",
            node: { type: "item", name: "Island", kind: "island", width: 3, length: 6, unit: "ft" },
          },
        ],
      },
    },
  ],
  handler: async ({ env }, input) => {
    const row = await loadScene(env, input.sceneId);
    if (!row) return toolError(`Unknown sceneId '${input.sceneId}'`);
    try {
      const nextGraph = applyNodeOps(parseGraphJson(row.graphJson), input.ops);
      const saved = await saveScene(env, input.sceneId, {
        name: row.name,
        projectId: row.projectId,
        graph: nextGraph,
        saveMode: "checkpoint",
        expectedVersion: input.expectedVersion,
      });
      return {
        sceneId: saved.id,
        version: saved.version,
        nodeCount: countNodes(nextGraph),
        applied: input.ops.length,
        editorUrl: sceneLink(env, saved.id),
      };
    } catch (err) {
      if (err instanceof PascalStoreError) {
        return toolError(`${err.code}: ${err.message}`);
      }
      throw err;
    }
  },
});
