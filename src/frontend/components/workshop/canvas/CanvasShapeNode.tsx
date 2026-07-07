// ---------------------------------------------------------------------------
// CanvasShapeNode — a single vector shape rendered on the SAME Konva stage as
// image nodes (the devl.dev canvas-tools baseline appended to our rendition).
//
//   • rectangle → Konva.Rect (rounded corners)
//   • ellipse   → Konva.Ellipse
//   • text      → Konva.Text (fill color, font sized to node height ~0.5, like
//                 the template)
//   • pen       → Konva.Line (points relative to the node origin, tension ~0.4,
//                 round caps/joins)
//
// Selection frame + drag behavior are identical to image nodes: a subtle ring +
// corner handles, draggable unless locked, drag reported upward (parent
// debounces the best-effort persist). No neon glow — the Monolith select color
// is the same #3b82f6 hairline used by image nodes.
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { Ellipse, Group, Line, Rect, Text } from "react-konva";
import type Konva from "konva";

import type { ShapeNode } from "../types";

const SELECT_COLOR = "#3b82f6";
const HANDLE_SIZE = 8;

interface CanvasShapeNodeProps {
  shape: ShapeNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDragStart?: () => void;
  onDblClick?: (shape: ShapeNode) => void;
  onContextMenu?: (
    shape: ShapeNode,
    event: Konva.KonvaEventObject<PointerEvent>,
  ) => void;
}

export function CanvasShapeNode({
  shape,
  isSelected,
  onSelect,
  onDragMove,
  onDragEnd,
  onDragStart,
  onDblClick,
  onContextMenu,
}: CanvasShapeNodeProps) {
  const handleDragMove = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      onDragMove(shape.id, event.target.x(), event.target.y());
    },
    [shape.id, onDragMove],
  );

  const handleDragEnd = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(shape.id, event.target.x(), event.target.y());
    },
    [shape.id, onDragEnd],
  );

  const handleSelect = useCallback(
    () => onSelect(shape.id),
    [shape.id, onSelect],
  );

  if (!shape.isVisible) return null;

  const { fill, opacity, text, points } = shape.metadata;
  const alpha = Math.max(0, Math.min(1, opacity / 100));

  return (
    <Group
      x={shape.x}
      y={shape.y}
      rotation={shape.rotation}
      opacity={alpha}
      draggable={!shape.isLocked}
      onDragStart={onDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onMouseDown={handleSelect}
      onDblClick={() => onDblClick?.(shape)}
      onDblTap={() => onDblClick?.(shape)}
      onContextMenu={(event: Konva.KonvaEventObject<PointerEvent>) =>
        onContextMenu?.(shape, event)
      }
    >
      {shape.kind === "rectangle" && (
        <Rect
          width={shape.width}
          height={shape.height}
          cornerRadius={6}
          fill={fill}
        />
      )}

      {shape.kind === "ellipse" && (
        <Ellipse
          x={shape.width / 2}
          y={shape.height / 2}
          radiusX={shape.width / 2}
          radiusY={shape.height / 2}
          fill={fill}
        />
      )}

      {shape.kind === "text" && (
        <Text
          text={text ?? "Text"}
          width={shape.width}
          height={shape.height}
          fill={fill}
          fontSize={Math.max(16, shape.height * 0.5)}
          fontStyle="600"
          verticalAlign="middle"
          lineHeight={1}
        />
      )}

      {shape.kind === "pen" && points && points.length >= 4 && (
        <Line
          points={points}
          stroke={fill}
          strokeWidth={3}
          tension={0.4}
          lineCap="round"
          lineJoin="round"
        />
      )}

      {/* Selection ring — a hairline inset stroke, matching image nodes. */}
      {isSelected && (
        <Rect
          width={shape.width}
          height={shape.height}
          cornerRadius={shape.kind === "ellipse" ? 9999 : 6}
          stroke={SELECT_COLOR}
          strokeWidth={2}
          listening={false}
        />
      )}

      {isSelected &&
        [
          { x: 0, y: 0 },
          { x: shape.width, y: 0 },
          { x: 0, y: shape.height },
          { x: shape.width, y: shape.height },
        ].map((corner, index) => (
          <Rect
            key={index}
            x={corner.x - HANDLE_SIZE / 2}
            y={corner.y - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            fill="#ffffff"
            stroke={SELECT_COLOR}
            strokeWidth={1.5}
            listening={false}
          />
        ))}
    </Group>
  );
}

export default CanvasShapeNode;
