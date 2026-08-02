/**
 * @fileoverview Pascal graph-edit core (0043 Phase 3).
 *
 * Applies granular node operations to a Pascal `SceneGraph` with full fidelity —
 * add/update/delete/move any node with any properties. Every op is validated
 * against the live graph before it is applied, so a hallucinated node id (or a
 * `move` to a non-existent parent) is rejected rather than silently written.
 */
import { z } from "zod";

import type { SceneGraph } from "./shapes";
import { PascalStoreError } from "./store";

export const nodeOpSchema = z.object({
  op: z.enum(["add", "update", "delete", "move"]),
  nodeId: z.string().min(1),
  /** Full node properties for `add`; a partial patch for `update`. */
  node: z.record(z.string(), z.unknown()).optional(),
  /** New parent for `move` (or `add`); null = a root node. */
  parentId: z.string().min(1).nullable().optional(),
});
export type NodeOp = z.infer<typeof nodeOpSchema>;

/**
 * Apply ops to a graph, returning a NEW graph. Throws PascalStoreError("invalid")
 * with a specific message on any op that references a node/parent that doesn't
 * exist (or an `add` that collides with an existing id).
 */
export function applyNodeOps(graph: SceneGraph, ops: NodeOp[]): SceneGraph {
  const nodes: Record<string, unknown> = { ...((graph?.nodes as Record<string, unknown>) ?? {}) };

  for (const [i, op] of ops.entries()) {
    const exists = Object.prototype.hasOwnProperty.call(nodes, op.nodeId);
    const at = `op[${i}] ${op.op} '${op.nodeId}'`;

    switch (op.op) {
      case "add": {
        if (exists) throw new PascalStoreError("invalid", `${at}: node already exists (use update)`);
        if (!op.node) throw new PascalStoreError("invalid", `${at}: 'node' is required for add`);
        if (op.parentId != null && !Object.prototype.hasOwnProperty.call(nodes, op.parentId)) {
          throw new PascalStoreError("invalid", `${at}: unknown parentId '${op.parentId}'`);
        }
        nodes[op.nodeId] = {
          ...(op.node as Record<string, unknown>),
          id: op.nodeId,
          ...(op.parentId !== undefined ? { parentId: op.parentId } : {}),
        };
        break;
      }
      case "update": {
        if (!exists) throw new PascalStoreError("invalid", `${at}: unknown node`);
        const patch = (op.node as Record<string, unknown>) ?? {};
        // A parentId embedded in the patch must resolve (or be null) — same rule as `move`.
        if (
          "parentId" in patch &&
          patch.parentId != null &&
          !Object.prototype.hasOwnProperty.call(nodes, patch.parentId as string)
        ) {
          throw new PascalStoreError("invalid", `${at}: unknown parentId '${String(patch.parentId)}'`);
        }
        nodes[op.nodeId] = { ...(nodes[op.nodeId] as Record<string, unknown>), ...patch, id: op.nodeId };
        break;
      }
      case "delete": {
        if (!exists) throw new PascalStoreError("invalid", `${at}: unknown node`);
        delete nodes[op.nodeId];
        break;
      }
      case "move": {
        if (!exists) throw new PascalStoreError("invalid", `${at}: unknown node`);
        if (op.parentId != null && !Object.prototype.hasOwnProperty.call(nodes, op.parentId)) {
          throw new PascalStoreError("invalid", `${at}: unknown parentId '${op.parentId}'`);
        }
        nodes[op.nodeId] = {
          ...(nodes[op.nodeId] as Record<string, unknown>),
          parentId: op.parentId ?? null,
        };
        break;
      }
    }
  }

  // Recompute rootNodeIds from the graph itself: a root is any node with no parent.
  // This keeps the invariant correct after adds (new roots), deletes, and moves —
  // rather than only pruning the stale list.
  const rootNodeIds = Object.entries(nodes)
    .filter(([, n]) => (n as Record<string, unknown>)?.parentId == null)
    .map(([id]) => id);
  return { ...graph, nodes, rootNodeIds };
}

/** Count nodes in a graph (for tool responses). */
export function countNodes(graph: SceneGraph): number {
  return graph?.nodes ? Object.keys(graph.nodes).length : 0;
}
