// ---------------------------------------------------------------------------
// WorkshopCanvas — the domain canvas. Keeps the devl.dev shell chrome
// (pan/zoom, dot-grid, zoom controls, status pill, inspector, layers) but
// replaces the vector-shape scene with a react-konva Stage of image nodes and
// lineage edges. A pending recipe node shows the calm ambient (never a spinner)
// as a DOM overlay positioned in world space via the shared pan/zoom transform.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Stage } from "react-konva";
import type Konva from "konva";

import { cn } from "@/lib/utils";

import { CanvasEdges } from "./CanvasEdges";
import { CanvasImageNode } from "./CanvasImageNode";
import { NodeInspector, StatusPill, ZoomControls } from "./CanvasChrome";
import { usePanZoom, type Bounds } from "./usePanZoom";
import {
  NodeContextMenu,
  type ContextMenuState,
} from "../recipes/NodeContextMenu";
import { RenderAmbience } from "../status/RenderAmbience";
import type { BoardNode } from "../types";
import type { UseBoardResult } from "../hooks/useBoard";

interface WorkshopCanvasProps {
  board: UseBoardResult;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onExtractClipping: (node: BoardNode) => void;
  onMaterialSwap: (node: BoardNode) => void;
  onMix: (node: BoardNode) => void;
}

function computeBounds(nodes: BoardNode[]): Bounds | null {
  const visible = nodes.filter((node) => node.isVisible);
  if (visible.length === 0) return null;
  return {
    minX: Math.min(...visible.map((n) => n.x)),
    minY: Math.min(...visible.map((n) => n.y)),
    maxX: Math.max(...visible.map((n) => n.x + n.width)),
    maxY: Math.max(...visible.map((n) => n.y + n.height)),
  };
}

export function WorkshopCanvas({
  board,
  selectedId,
  onSelect,
  onExtractClipping,
  onMaterialSwap,
  onMix,
}: WorkshopCanvasProps) {
  const { containerRef, zoom, pan, spaceDown, setPan, zoomBy, fitToScreen } =
    usePanZoom();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null,
  );

  const { nodes, processingNodeIds, justAddedNodeIds, moveNode } = board;

  // Track container size so the Konva Stage fills it (Stage needs pixel dims).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  // --- Space / hand pan on empty canvas (drag the background) --------------
  const onStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      // Only start a pan when clicking empty stage (not a node) with space held.
      const clickedEmpty = event.target === event.target.getStage();
      if (spaceDown && clickedEmpty) {
        setPanning(true);
        panStart.current = {
          x: event.evt.clientX,
          y: event.evt.clientY,
          panX: pan.x,
          panY: pan.y,
        };
        return;
      }
      if (clickedEmpty) onSelect(null);
    },
    [onSelect, pan.x, pan.y, spaceDown],
  );

  useEffect(() => {
    if (!panning) return;
    const onMove = (event: MouseEvent) => {
      const start = panStart.current;
      if (!start) return;
      setPan({
        x: start.panX + (event.clientX - start.x),
        y: start.panY + (event.clientY - start.y),
      });
    };
    const onUp = () => {
      setPanning(false);
      panStart.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [panning, setPan]);

  const handleDragMove = useCallback(
    (id: string, x: number, y: number) => moveNode(id, { x, y }),
    [moveNode],
  );
  const handleDragEnd = useCallback(
    (id: string, x: number, y: number) => moveNode(id, { x, y }),
    [moveNode],
  );

  // Open the recipe menu at the pointer (right-click) for a node.
  const openMenu = useCallback(
    (node: BoardNode, clientX: number, clientY: number) => {
      onSelect(node.id);
      setMenuState({ node, x: clientX, y: clientY });
    },
    [onSelect],
  );

  const handleNodeContextMenu = useCallback(
    (node: BoardNode, event: Konva.KonvaEventObject<PointerEvent>) => {
      event.evt.preventDefault();
      openMenu(node, event.evt.clientX, event.evt.clientY);
    },
    [openMenu],
  );

  // Long-press (touch) → open the menu at the touch point.
  const handleNodeTouchStart = useCallback(
    (node: BoardNode, event: Konva.KonvaEventObject<TouchEvent>) => {
      onSelect(node.id);
      const touch = event.evt.touches[0];
      if (!touch) return;
      const { clientX, clientY } = touch;
      longPressTimer.current = setTimeout(() => {
        openMenu(node, clientX, clientY);
      }, 500);
    },
    [onSelect, openMenu],
  );

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Source nodes with a recipe in flight — the ambient veil + narration line
  // overlay their image (they keep showing while "working").
  const processingNodes = useMemo(
    () =>
      nodes.filter((node) => processingNodeIds.has(node.id) && node.isVisible),
    [nodes, processingNodeIds],
  );

  const cursorClass = panning
    ? "cursor-grabbing"
    : spaceDown
      ? "cursor-grab"
      : "cursor-default";

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full select-none overflow-hidden bg-[hsl(240_10%_4%)] text-foreground",
        cursorClass,
      )}
    >
      {/* Dot-grid background (kept from the shell), moves with pan/zoom. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(color-mix(in oklab, var(--color-foreground) 14%, transparent) 1px, transparent 1px)",
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />

      {size.width > 0 && size.height > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          x={pan.x}
          y={pan.y}
          scaleX={zoom}
          scaleY={zoom}
          onMouseDown={onStageMouseDown}
          onTouchStart={(e) => {
            if (e.target === e.target.getStage()) onSelect(null);
          }}
        >
          <Layer listening={false}>
            <CanvasEdges nodes={nodes} />
          </Layer>
          <Layer>
            {nodes.map((node) => (
              <CanvasImageNode
                key={node.id}
                node={node}
                isSelected={node.id === selectedId}
                isRevealing={justAddedNodeIds.has(node.id)}
                onSelect={onSelect}
                onDragMove={handleDragMove}
                onDragStart={clearLongPress}
                onDragEnd={handleDragEnd}
                onContextMenu={handleNodeContextMenu}
                onTouchStart={handleNodeTouchStart}
                onTouchEnd={clearLongPress}
              />
            ))}
          </Layer>
        </Stage>
      )}

      {/* Ambient + narration veil over source nodes with a recipe in flight —
          a DOM layer positioned in world space via the same pan/zoom transform,
          so it tracks the node. Calm texture (never a spinner) + a promise line
          in §7 voice. */}
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        {processingNodes.map((node) => (
          <div
            key={`ambient-${node.id}`}
            className="absolute overflow-hidden rounded-lg ring-1 ring-primary/40"
            style={{
              left: node.x,
              top: node.y,
              width: node.width,
              height: node.height,
            }}
          >
            <RenderAmbience />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
              <p className="font-mono text-[11px] leading-snug tracking-tight text-foreground/90">
                Keeping your windows exactly where they are…
              </p>
            </div>
          </div>
        ))}
      </div>

      <ZoomControls
        zoom={zoom}
        onIn={() => zoomBy(0.1)}
        onOut={() => zoomBy(-0.1)}
        onFit={() => fitToScreen(computeBounds(nodes))}
      />
      <StatusPill selected={selectedNode} total={nodes.length} />
      <NodeInspector
        node={selectedNode}
        nodes={nodes}
        selectedId={selectedId}
        onSelect={onSelect}
        onUpdate={(id, patch) => moveNode(id, patch)}
        onToggleVisible={(id) => {
          const target = nodes.find((n) => n.id === id);
          if (target) void board.patchNode(id, { isVisible: !target.isVisible });
        }}
        onToggleLocked={(id) => {
          const target = nodes.find((n) => n.id === id);
          if (target) void board.patchNode(id, { isLocked: !target.isLocked });
        }}
        onDelete={(id) => {
          void board.removeNode(id);
          if (selectedId === id) onSelect(null);
        }}
      />

      <NodeContextMenu
        state={menuState}
        onClose={() => setMenuState(null)}
        onExtractClipping={onExtractClipping}
        onMaterialSwap={onMaterialSwap}
        onMix={onMix}
      />
    </div>
  );
}

export default WorkshopCanvas;
