// ---------------------------------------------------------------------------
// WorkshopCanvas — the domain canvas. Keeps the devl.dev shell chrome
// (pan/zoom, dot-grid, zoom controls, status pill, inspector, layers) AND the
// full devl.dev TOOL PALETTE (Move / Hand / Frame / Ellipse / Text / Pen /
// Place image / More), then appends our own rendition on top: a react-konva
// Stage that renders BOTH image nodes and vector shapes, plus lineage edges and
// the calm recipe ambient.
//
// Tool behaviors mirror the template: drag-to-create for frame/ellipse/text
// (crosshair cursor, dashed preview, auto-return to Move after create), Escape
// deselects, Delete/Backspace removes the selection, space-to-pan, a
// typing-target guard on shortcuts. "Place image" opens the drawer; "More"
// opens the selection's context menu. The Pen tool draws freehand strokes.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Line, Stage } from "react-konva";
import type Konva from "konva";

import { cn } from "@/lib/utils";

import { CanvasEdges } from "./CanvasEdges";
import { CanvasImageNode } from "./CanvasImageNode";
import { CanvasShapeNode } from "./CanvasShapeNode";
import { NodeInspector, StatusPill, ZoomControls } from "./CanvasChrome";
import {
  DRAG_CREATE_TOOLS,
  ToolsPalette,
  type Tool,
} from "./ToolsPalette";
import { usePanZoom, type Bounds } from "./usePanZoom";
import {
  NodeContextMenu,
  type ContextMenuState,
} from "../recipes/NodeContextMenu";
import { RenderAmbience } from "../status/RenderAmbience";
import {
  isShapeNode,
  SHAPE_SWATCHES,
  type BoardNode,
  type CanvasNode,
  type ShapeKind,
  type ShapeMetadata,
  type ShapeNode,
} from "../types";
import type { UseBoardResult } from "../hooks/useBoard";

interface WorkshopCanvasProps {
  board: UseBoardResult;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onExtractClipping: (node: BoardNode) => void;
  onMaterialSwap: (node: BoardNode) => void;
  onMix: (node: BoardNode) => void;
  onClayToPhotoreal: (node: BoardNode) => void;
  onFloorPlanFurnish: (node: BoardNode) => void;
  onPlanToIsometric: (node: BoardNode) => void;
  onEvolutionGrid: (node: BoardNode) => void;
  onToneUnify: (node: BoardNode) => void;
  onLightingEnhance: (node: BoardNode) => void;
  /** "Place image (I)" opens the drawer — our rendition of image placement. */
  onPlaceImage: () => void;
}

interface Point {
  x: number;
  y: number;
}

/** Live drag interaction for shape creation / pen drawing. */
type ShapeDrag =
  | { kind: "create"; type: Exclude<ShapeKind, "pen">; start: Point; current: Point; fill: string }
  | { kind: "pen"; fill: string; points: number[] };

function computeBounds(nodes: CanvasNode[]): Bounds | null {
  const visible = nodes.filter((node) => node.isVisible);
  if (visible.length === 0) return null;
  return {
    minX: Math.min(...visible.map((n) => n.x)),
    minY: Math.min(...visible.map((n) => n.y)),
    maxX: Math.max(...visible.map((n) => n.x + n.width)),
    maxY: Math.max(...visible.map((n) => n.y + n.height)),
  };
}

function defaultShapeName(kind: ShapeKind, n: number): string {
  if (kind === "rectangle") return `Frame ${n}`;
  if (kind === "ellipse") return `Ellipse ${n}`;
  if (kind === "pen") return `Stroke ${n}`;
  return `Text ${n}`;
}

export function WorkshopCanvas({
  board,
  selectedId,
  onSelect,
  onExtractClipping,
  onMaterialSwap,
  onMix,
  onClayToPhotoreal,
  onFloorPlanFurnish,
  onPlanToIsometric,
  onEvolutionGrid,
  onToneUnify,
  onLightingEnhance,
  onPlaceImage,
}: WorkshopCanvasProps) {
  const { containerRef, zoom, pan, spaceDown, setPan, zoomBy, fitToScreen } =
    usePanZoom();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const [tool, setTool] = useState<Tool>("move");
  const [shapeDrag, setShapeDrag] = useState<ShapeDrag | null>(null);
  const [createCount, setCreateCount] = useState(1);
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null,
  );

  const {
    nodes,
    shapes,
    processingNodeIds,
    processingNarration,
    justAddedNodeIds,
    moveNode,
    moveShape,
    addShape,
    patchShape,
    removeShape,
  } = board;

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

  // Combined view-model for the inspector, status pill, layers + fit.
  const allCanvasNodes = useMemo<CanvasNode[]>(
    () => [...nodes, ...shapes],
    [nodes, shapes],
  );

  const selectedNode = useMemo<CanvasNode | null>(
    () => allCanvasNodes.find((node) => node.id === selectedId) ?? null,
    [allCanvasNodes, selectedId],
  );

  // Convert a client point to WORLD coordinates via the stage transform.
  const clientToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [containerRef, pan.x, pan.y, zoom],
  );

  const isPanGesture = tool === "hand" || spaceDown;

  // --- Stage pointer-down: pan / create / pen / deselect -------------------
  const onStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = event.target.getStage();
      const clickedEmpty = event.target === stage;

      // Pan takes priority (hand tool or space held) on empty canvas.
      if (isPanGesture && clickedEmpty) {
        setPanning(true);
        panStart.current = {
          x: event.evt.clientX,
          y: event.evt.clientY,
          panX: pan.x,
          panY: pan.y,
        };
        return;
      }

      // Shape creation / pen only begins on empty canvas.
      if (clickedEmpty && DRAG_CREATE_TOOLS.has(tool)) {
        const world = clientToWorld(event.evt.clientX, event.evt.clientY);
        const fill = SHAPE_SWATCHES[createCount % SHAPE_SWATCHES.length]!;
        const type = (tool === "frame" ? "rectangle" : tool) as Exclude<
          ShapeKind,
          "pen"
        >;
        setShapeDrag({ kind: "create", type, start: world, current: world, fill });
        onSelect(null);
        return;
      }

      if (clickedEmpty && tool === "pen") {
        const world = clientToWorld(event.evt.clientX, event.evt.clientY);
        const fill = SHAPE_SWATCHES[createCount % SHAPE_SWATCHES.length]!;
        setShapeDrag({ kind: "pen", fill, points: [world.x, world.y] });
        onSelect(null);
        return;
      }

      if (clickedEmpty) onSelect(null);
    },
    [
      clientToWorld,
      createCount,
      isPanGesture,
      onSelect,
      pan.x,
      pan.y,
      tool,
    ],
  );

  // Window-level move/up for pan.
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

  // Window-level move/up for shape create + pen drawing.
  useEffect(() => {
    if (!shapeDrag) return;
    const onMove = (event: MouseEvent) => {
      const world = clientToWorld(event.clientX, event.clientY);
      setShapeDrag((prev) => {
        if (!prev) return prev;
        if (prev.kind === "create") return { ...prev, current: world };
        return { ...prev, points: [...prev.points, world.x, world.y] };
      });
    };
    const onUp = () => {
      setShapeDrag((prev) => {
        if (!prev) return null;
        if (prev.kind === "create") {
          const x1 = Math.min(prev.start.x, prev.current.x);
          const y1 = Math.min(prev.start.y, prev.current.y);
          const w = Math.abs(prev.current.x - prev.start.x);
          const h = Math.abs(prev.current.y - prev.start.y);
          if (w >= 4 && h >= 4) {
            const metadata: ShapeMetadata = {
              fill: prev.fill,
              opacity: 100,
              name: defaultShapeName(prev.type, createCount),
              ...(prev.type === "text" ? { text: "Text" } : {}),
            };
            const created = addShape({
              kind: prev.type,
              x: x1,
              y: y1,
              width: prev.type === "text" ? Math.max(w, 80) : w,
              height: prev.type === "text" ? Math.max(h, 32) : h,
              metadata,
            });
            if (created) onSelect(created.id);
            setCreateCount((c) => c + 1);
            setTool("move");
          }
        } else {
          // Pen: bbox = points extent; store points RELATIVE to the origin.
          const xs = prev.points.filter((_, i) => i % 2 === 0);
          const ys = prev.points.filter((_, i) => i % 2 === 1);
          if (xs.length >= 2) {
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const w = Math.max(1, Math.max(...xs) - minX);
            const h = Math.max(1, Math.max(...ys) - minY);
            const rel = prev.points.map((v, i) =>
              i % 2 === 0 ? v - minX : v - minY,
            );
            const created = addShape({
              kind: "pen",
              x: minX,
              y: minY,
              width: w,
              height: h,
              metadata: {
                fill: prev.fill,
                opacity: 100,
                name: defaultShapeName("pen", createCount),
                points: rel,
              },
            });
            if (created) onSelect(created.id);
            setCreateCount((c) => c + 1);
            setTool("move");
          }
        }
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [shapeDrag, clientToWorld, addShape, createCount, onSelect]);

  // Keyboard: tool shortcuts + Escape deselect + Delete/Backspace remove.
  // (space-to-pan lives in usePanZoom.) Guards against typing targets.
  useEffect(() => {
    const isTyping = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.isContentEditable);
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.key === "Escape") {
        onSelect(null);
        setShapeDrag(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selectedId) return;
        event.preventDefault();
        if (shapes.some((s) => s.id === selectedId)) {
          removeShape(selectedId);
        } else {
          void board.removeNode(selectedId);
        }
        onSelect(null);
        return;
      }
      const k = event.key.toLowerCase();
      if (k === "v") setTool("move");
      else if (k === "h") setTool("hand");
      else if (k === "r" || k === "f") setTool("frame");
      else if (k === "o") setTool("ellipse");
      else if (k === "t") setTool("text");
      else if (k === "p") setTool("pen");
      else if (k === "i") onPlaceImage();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board, onPlaceImage, onSelect, removeShape, selectedId, shapes]);

  const handleDragMove = useCallback(
    (id: string, x: number, y: number) => moveNode(id, { x, y }),
    [moveNode],
  );
  const handleDragEnd = useCallback(
    (id: string, x: number, y: number) => moveNode(id, { x, y }),
    [moveNode],
  );
  const handleShapeDragMove = useCallback(
    (id: string, x: number, y: number) => moveShape(id, { x, y }),
    [moveShape],
  );

  // Open the recipe menu at the pointer (right-click) for an image node.
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

  // "More" tool: open the context menu for the current image selection.
  const handleMore = useCallback(() => {
    if (selectedNode && !isShapeNode(selectedNode)) {
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = (rect?.left ?? 0) + selectedNode.x * zoom + pan.x + 8;
      const cy = (rect?.top ?? 0) + selectedNode.y * zoom + pan.y + 8;
      openMenu(selectedNode, cx, cy);
    }
  }, [containerRef, openMenu, pan.x, pan.y, selectedNode, zoom]);

  // Source nodes with a recipe in flight — ambient veil overlays their image.
  const processingNodes = useMemo(
    () =>
      nodes.filter((node) => processingNodeIds.has(node.id) && node.isVisible),
    [nodes, processingNodeIds],
  );

  const cursorClass = panning
    ? "cursor-grabbing"
    : isPanGesture
      ? "cursor-grab"
      : DRAG_CREATE_TOOLS.has(tool) || tool === "pen"
        ? "cursor-crosshair"
        : "cursor-default";

  // Live create-preview rect in world space (DOM overlay, dashed).
  const previewRect =
    shapeDrag?.kind === "create"
      ? {
          x: Math.min(shapeDrag.start.x, shapeDrag.current.x),
          y: Math.min(shapeDrag.start.y, shapeDrag.current.y),
          width: Math.abs(shapeDrag.current.x - shapeDrag.start.x),
          height: Math.abs(shapeDrag.current.y - shapeDrag.start.y),
          fill: shapeDrag.fill,
          type: shapeDrag.type,
        }
      : null;

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
            {shapes.map((shape) => (
              <CanvasShapeNode
                key={shape.id}
                shape={shape}
                isSelected={shape.id === selectedId}
                onSelect={onSelect}
                onDragMove={handleShapeDragMove}
                onDragEnd={handleShapeDragMove}
                onDblClick={(s) => {
                  // Double-click a text shape → focus its inspector field.
                  onSelect(s.id);
                }}
              />
            ))}
            {/* Live pen stroke preview while drawing. */}
            {shapeDrag?.kind === "pen" && shapeDrag.points.length >= 4 && (
              <Line
                points={shapeDrag.points}
                stroke={shapeDrag.fill}
                strokeWidth={3}
                tension={0.4}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      )}

      {/* Dashed create-preview (DOM, world-space), matching the template. */}
      {previewRect && previewRect.width > 0 && previewRect.height > 0 ? (
        <div
          className="pointer-events-none absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <div
            className="absolute"
            style={{
              left: previewRect.x,
              top: previewRect.y,
              width: previewRect.width,
              height: previewRect.height,
            }}
          >
            <div
              className={cn(
                "size-full",
                previewRect.type === "ellipse" ? "rounded-full" : "rounded-md",
              )}
              style={{ backgroundColor: previewRect.fill, opacity: 0.55 }}
            />
            <div
              className="absolute inset-0 border-2 border-dashed border-[#3b82f6]"
              style={{
                borderRadius: previewRect.type === "ellipse" ? "9999px" : "6px",
              }}
            />
          </div>
        </div>
      ) : null}

      {/* Ambient + narration veil over source nodes with a recipe in flight. */}
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
                {processingNarration[node.id] ?? "Working on it…"}
              </p>
            </div>
          </div>
        ))}
      </div>

      <ToolsPalette
        tool={tool}
        onChangeTool={setTool}
        onPlaceImage={onPlaceImage}
        onMore={handleMore}
      />

      <ZoomControls
        zoom={zoom}
        onIn={() => zoomBy(0.1)}
        onOut={() => zoomBy(-0.1)}
        onFit={() => fitToScreen(computeBounds(allCanvasNodes))}
      />
      <StatusPill selected={selectedNode} total={allCanvasNodes.length} />
      <NodeInspector
        node={selectedNode}
        nodes={allCanvasNodes}
        selectedId={selectedId}
        onSelect={onSelect}
        onUpdate={(id, patch) => {
          if (shapes.some((s) => s.id === id)) moveShape(id, patch);
          else moveNode(id, patch);
        }}
        onUpdateShape={(id, patch) => patchShape(id, { metadata: patch })}
        onToggleVisible={(id) => {
          const shape = shapes.find((s) => s.id === id);
          if (shape) {
            patchShape(id, { isVisible: !shape.isVisible });
            return;
          }
          const target = nodes.find((n) => n.id === id);
          if (target) void board.patchNode(id, { isVisible: !target.isVisible });
        }}
        onToggleLocked={(id) => {
          const shape = shapes.find((s) => s.id === id);
          if (shape) {
            patchShape(id, { isLocked: !shape.isLocked });
            return;
          }
          const target = nodes.find((n) => n.id === id);
          if (target) void board.patchNode(id, { isLocked: !target.isLocked });
        }}
        onDelete={(id) => {
          if (shapes.some((s) => s.id === id)) removeShape(id);
          else void board.removeNode(id);
          if (selectedId === id) onSelect(null);
        }}
      />

      <NodeContextMenu
        state={menuState}
        onClose={() => setMenuState(null)}
        onExtractClipping={onExtractClipping}
        onMaterialSwap={onMaterialSwap}
        onMix={onMix}
        onClayToPhotoreal={onClayToPhotoreal}
        onFloorPlanFurnish={onFloorPlanFurnish}
        onPlanToIsometric={onPlanToIsometric}
        onEvolutionGrid={onEvolutionGrid}
        onToneUnify={onToneUnify}
        onLightingEnhance={onLightingEnhance}
      />
    </div>
  );
}

export default WorkshopCanvas;
