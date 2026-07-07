// ---------------------------------------------------------------------------
// CanvasEdges — revision-lineage edges. Each child node (parentNodeId set) gets
// a soft arrow from the center-bottom of its parent to its own center-top,
// drawn as a Konva.Arrow beneath the nodes. This is what makes "this render came
// from that photo" legible on the messy table.
// ---------------------------------------------------------------------------

import { Arrow } from "react-konva";

import type { BoardNode } from "../types";

interface CanvasEdgesProps {
  nodes: BoardNode[];
}

export function CanvasEdges({ nodes }: CanvasEdgesProps) {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return (
    <>
      {nodes.map((node) => {
        if (!node.parentNodeId || !node.isVisible) return null;
        const parent = byId.get(node.parentNodeId);
        if (!parent || !parent.isVisible) return null;

        const from = {
          x: parent.x + parent.width / 2,
          y: parent.y + parent.height,
        };
        const to = {
          x: node.x + node.width / 2,
          y: node.y,
        };

        return (
          <Arrow
            key={`edge-${node.id}`}
            points={[from.x, from.y, to.x, to.y]}
            stroke="rgba(255,255,255,0.22)"
            fill="rgba(255,255,255,0.22)"
            strokeWidth={1.5}
            pointerLength={8}
            pointerWidth={7}
            dash={[6, 5]}
            listening={false}
          />
        );
      })}
    </>
  );
}

export default CanvasEdges;
