// ---------------------------------------------------------------------------
// NodeContextMenu — a DOM popover of homeowner-verb recipe actions for a node.
//
// Konva shapes can't be children of the shadcn (DOM) ContextMenu, so this is a
// controlled, screen-positioned menu: the canvas hooks Konva's `contextmenu`
// (right-click) + a long-press timer (touch) and opens this at the pointer.
// Copy is homeowner-first (§7): "Extract a sample…", "Try a different
// material…", "Mix with samples…" — never stage jargon.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { Armchair, Blend, Box, Building2, DoorOpen, LayoutGrid, PackageSearch, Palette, PenTool, Scissors, Sun, SwatchBook, Wand2 } from "lucide-react";

import { cn } from "@/lib/utils";

import type { BoardNode } from "../types";

export interface ContextMenuState {
  node: BoardNode;
  x: number;
  y: number;
}

interface NodeContextMenuProps {
  state: ContextMenuState | null;
  onClose: () => void;
  onExtractClipping: (node: BoardNode) => void;
  onMaterialSwap: (node: BoardNode) => void;
  onMix: (node: BoardNode) => void;
  /** Only offered on render nodes (SketchUp/AI renders). */
  onClayToPhotoreal: (node: BoardNode) => void;
  /** Only offered on floor_plan nodes. */
  onFloorPlanFurnish: (node: BoardNode) => void;
  onToneUnify: (node: BoardNode) => void;
  onLightingEnhance: (node: BoardNode) => void;
  onPlanToIsometric: (node: BoardNode) => void;
  onEvolutionGrid: (node: BoardNode) => void;
  onSketchToRender: (node: BoardNode) => void;
  onElevationRender: (node: BoardNode) => void;
  onCabinetReveal: (node: BoardNode) => void;
  onExtractFurnishings: (node: BoardNode) => void;
}

const ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-foreground/90 outline-none hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring";

export function NodeContextMenu({
  state,
  onClose,
  onExtractClipping,
  onMaterialSwap,
  onMix,
  onClayToPhotoreal,
  onFloorPlanFurnish,
  onToneUnify,
  onLightingEnhance,
  onPlanToIsometric,
  onEvolutionGrid,
  onSketchToRender,
  onElevationRender,
  onCabinetReveal,
  onExtractFurnishings,
}: NodeContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);

  // Dismiss on outside-click / Escape, and focus the first item on open.
  useEffect(() => {
    if (!state) return;
    firstItemRef.current?.focus();
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [state, onClose]);

  if (!state) return null;

  const run = (action: (node: BoardNode) => void) => {
    action(state.node);
    onClose();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Design tools for this image"
      className={cn(
        "fixed z-50 w-60 overflow-hidden rounded-xl bg-card/95 p-1 shadow-xl ring-1 ring-border/40 backdrop-blur",
      )}
      style={{ left: state.x, top: state.y }}
    >
      <div className="px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        Run a tool
      </div>
      <button
        ref={firstItemRef}
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => run(onExtractClipping)}
      >
        <Scissors className="size-4 text-muted-foreground" />
        <span>
          Extract a sample…
          <span className="block text-[11px] text-muted-foreground">
            Cut a material out of this image
          </span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => run(onMaterialSwap)}
      >
        <SwatchBook className="size-4 text-muted-foreground" />
        <span>
          Try a different material…
          <span className="block text-[11px] text-muted-foreground">
            Swap a finish using reference images
          </span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => run(onMix)}
      >
        <Blend className="size-4 text-muted-foreground" />
        <span>
          Mix with samples…
          <span className="block text-[11px] text-muted-foreground">
            Blend saved samples onto this image
          </span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => run(onLightingEnhance)}
      >
        <Sun className="size-4 text-muted-foreground" />
        <span>
          Even out the lighting…
          <span className="block text-[11px] text-muted-foreground">
            Balance exposure + recover shadow detail
          </span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => run(onToneUnify)}
      >
        <Palette className="size-4 text-muted-foreground" />
        <span>
          Clean up the color…
          <span className="block text-[11px] text-muted-foreground">
            Fix white balance + unify color temperature
          </span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => run(onEvolutionGrid)}
      >
        <LayoutGrid className="size-4 text-muted-foreground" />
        <span>
          Show it evolving…
          <span className="block text-[11px] text-muted-foreground">
            A 2×2 grid from empty to finished
          </span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => run(onSketchToRender)}
      >
        <PenTool className="size-4 text-muted-foreground" />
        <span>
          Make my sketch real…
          <span className="block text-[11px] text-muted-foreground">
            Turn a hand drawing into a photo
          </span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => run(onElevationRender)}
      >
        <Building2 className="size-4 text-muted-foreground" />
        <span>
          Render this elevation…
          <span className="block text-[11px] text-muted-foreground">
            A 2D elevation → photorealistic
          </span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => run(onCabinetReveal)}
      >
        <DoorOpen className="size-4 text-muted-foreground" />
        <span>
          Open it up…
          <span className="block text-[11px] text-muted-foreground">
            Reveal a cabinet / closet interior
          </span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => run(onExtractFurnishings)}
      >
        <PackageSearch className="size-4 text-muted-foreground" />
        <span>
          List the furnishings…
          <span className="block text-[11px] text-muted-foreground">
            Pull a shopping list out of this image
          </span>
        </span>
      </button>
      {state.node.sourceType === "render" ? (
        <button
          type="button"
          role="menuitem"
          className={ITEM_CLASS}
          onClick={() => run(onClayToPhotoreal)}
        >
          <Wand2 className="size-4 text-muted-foreground" />
          <span>
            Make it photoreal…
            <span className="block text-[11px] text-muted-foreground">
              Turn this SketchUp / clay render photorealistic
            </span>
          </span>
        </button>
      ) : null}
      {state.node.sourceType === "floor_plan" ? (
        <button
          type="button"
          role="menuitem"
          className={ITEM_CLASS}
          onClick={() => run(onFloorPlanFurnish)}
        >
          <Armchair className="size-4 text-muted-foreground" />
          <span>
            Furnish this plan…
            <span className="block text-[11px] text-muted-foreground">
              Add furniture, keeping the walls intact
            </span>
          </span>
        </button>
      ) : null}
      {state.node.sourceType === "floor_plan" ? (
        <button
          type="button"
          role="menuitem"
          className={ITEM_CLASS}
          onClick={() => run(onPlanToIsometric)}
        >
          <Box className="size-4 text-muted-foreground" />
          <span>
            Turn into a dollhouse…
            <span className="block text-[11px] text-muted-foreground">
              Render the plan as a 3D isometric view
            </span>
          </span>
        </button>
      ) : null}
    </div>
  );
}

export default NodeContextMenu;
