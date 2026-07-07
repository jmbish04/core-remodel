// ---------------------------------------------------------------------------
// CanvasImageNode — a single board node rendered on the Konva stage.
//
// Loads the CF Images URL via use-image, draws it draggable, and reports drag
// moves upward (the parent debounces the PATCH). A selected node gets a subtle
// ring + resize handles; a locked node isn't draggable. A child node arriving
// from a completed recipe (isRevealing) plays a short spring-like entrance
// (opacity + slight scale, transform/opacity only) — instant under
// prefers-reduced-motion.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from "react";
import { Group, Image as KonvaImage, Rect } from "react-konva";
import Konva from "konva";
import useImage from "use-image";

import { useReducedMotion } from "../hooks/useReducedMotion";
import type { BoardNode } from "../types";

const SELECT_COLOR = "#3b82f6";
const HANDLE_SIZE = 8;

interface CanvasImageNodeProps {
  node: BoardNode;
  isSelected: boolean;
  /** True briefly after this node arrives from a completed recipe. */
  isRevealing: boolean;
  onSelect: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragStart?: () => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onContextMenu: (
    node: BoardNode,
    event: Konva.KonvaEventObject<PointerEvent>,
  ) => void;
  onTouchStart: (
    node: BoardNode,
    event: Konva.KonvaEventObject<TouchEvent>,
  ) => void;
  onTouchEnd: () => void;
}

export function CanvasImageNode({
  node,
  isSelected,
  isRevealing,
  onSelect,
  onDragMove,
  onDragStart,
  onDragEnd,
  onContextMenu,
  onTouchStart,
  onTouchEnd,
}: CanvasImageNodeProps) {
  const reduced = useReducedMotion();
  const groupRef = useRef<Konva.Group | null>(null);
  // crossOrigin anonymous so CF Images can be drawn without tainting the canvas.
  const [image] = useImage(node.cfImageUrl, "anonymous");

  // Entrance reveal for freshly-added child nodes (transform/opacity only).
  useEffect(() => {
    const group = groupRef.current;
    if (!group || !isRevealing) return;
    if (reduced) {
      group.opacity(1);
      group.scale({ x: 1, y: 1 });
      return;
    }
    group.opacity(0);
    group.scale({ x: 0.94, y: 0.94 });
    const tween = new Konva.Tween({
      node: group,
      duration: 0.42,
      opacity: 1,
      scaleX: 1,
      scaleY: 1,
      easing: Konva.Easings.BackEaseOut,
    });
    tween.play();
    return () => tween.destroy();
  }, [isRevealing, reduced]);

  const handleDragMove = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      onDragMove(node.id, event.target.x(), event.target.y());
    },
    [node.id, onDragMove],
  );

  const handleDragEnd = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(node.id, event.target.x(), event.target.y());
    },
    [node.id, onDragEnd],
  );

  const handleSelect = useCallback(() => onSelect(node.id), [node.id, onSelect]);

  if (!node.isVisible) return null;

  return (
    <Group
      ref={groupRef}
      x={node.x}
      y={node.y}
      rotation={node.rotation}
      draggable={!node.isLocked}
      onDragStart={onDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onMouseDown={handleSelect}
      onContextMenu={(event: Konva.KonvaEventObject<PointerEvent>) =>
        onContextMenu(node, event)
      }
      onTouchStart={(event: Konva.KonvaEventObject<TouchEvent>) => {
        handleSelect();
        onTouchStart(node, event);
      }}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchEnd}
    >
      {/* Loading surface until use-image resolves — a near-black card, not
          pure black. */}
      {!image && (
        <Rect
          width={node.width}
          height={node.height}
          cornerRadius={8}
          fill="#0b0b0f"
          stroke={isSelected ? SELECT_COLOR : "rgba(255,255,255,0.08)"}
          strokeWidth={isSelected ? 2 : 1}
        />
      )}

      {image && (
        <KonvaImage
          image={image}
          width={node.width}
          height={node.height}
          cornerRadius={8}
        />
      )}

      {/* Selection ring (drawn as an inset stroke rect). */}
      {isSelected && image && (
        <Rect
          width={node.width}
          height={node.height}
          cornerRadius={8}
          stroke={SELECT_COLOR}
          strokeWidth={2}
          listening={false}
        />
      )}

      {/* Corner handles (visual only in slice-1; resize is via the inspector). */}
      {isSelected &&
        [
          { x: 0, y: 0 },
          { x: node.width, y: 0 },
          { x: 0, y: node.height },
          { x: node.width, y: node.height },
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

export default CanvasImageNode;
