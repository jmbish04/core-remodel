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
import { Blend, Scissors, SwatchBook } from "lucide-react";

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
}

const ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-foreground/90 outline-none hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring";

export function NodeContextMenu({
  state,
  onClose,
  onExtractClipping,
  onMaterialSwap,
  onMix,
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
    </div>
  );
}

export default NodeContextMenu;
