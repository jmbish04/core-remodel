// ---------------------------------------------------------------------------
// SampleDrawer — the bottom "drawer" of Gemini-extracted material clippings
// (the Sample Library). A §8 drawer-reveal pattern tamed to Monolith: a
// motion/spring slide-up handle that expands into a tile grid. Each clipping
// tile is draggable onto the canvas (sets the DRAG_MIME payload) so it can be
// dropped as a node, and clicking a tile adds it to the canvas directly. New
// clippings animate in with a satisfying spring reveal.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronUp, Scissors } from "lucide-react";

import { cn } from "@/lib/utils";

import { DRAG_MIME, type DragPayload } from "../piles/PilesRail";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { clippingAltText, type Clipping } from "../types";

interface SampleDrawerProps {
  clippings: Clipping[];
  onPlaceClipping: (clipping: Clipping) => void;
}

const SPRING = { type: "spring" as const, stiffness: 200, damping: 25 };

export function SampleDrawer({ clippings, onPlaceClipping }: SampleDrawerProps) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);

  const setDragData = (clipping: Clipping, event: React.DragEvent) => {
    const payload: DragPayload = {
      cfImageUrl: clipping.clippingCfImageUrl,
      sourceType: "clipping",
      sourceId: clipping.id,
    };
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center">
      {/* Handle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close sample drawer" : "Open sample drawer"}
        className="pointer-events-auto mb-0 flex items-center gap-2 rounded-t-lg bg-card/90 px-4 py-1.5 text-[12px] text-foreground/80 shadow-lg ring-1 ring-border/40 backdrop-blur outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Scissors className="size-3.5" />
        Samples
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {clippings.length}
        </span>
        <ChevronUp
          className={cn(
            "size-3.5 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduced ? { height: "auto" } : { y: 260 }}
            animate={{ y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: 260 }}
            transition={reduced ? { duration: 0 } : SPRING}
            className="pointer-events-auto max-h-[42vh] w-full overflow-y-auto bg-card/95 px-4 py-4 shadow-2xl ring-1 ring-border/40 backdrop-blur"
          >
            {clippings.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
                <AnimatePresence initial={false}>
                  {clippings.map((clipping, index) => (
                    <motion.button
                      key={clipping.id}
                      type="button"
                      layout={!reduced}
                      initial={
                        reduced ? { opacity: 1 } : { opacity: 0, scale: 0.9 }
                      }
                      animate={{ opacity: 1, scale: 1 }}
                      transition={
                        reduced
                          ? { duration: 0 }
                          : { ...SPRING, delay: Math.min(index, 6) * 0.04 }
                      }
                      draggable
                      onDragStart={(e) =>
                        setDragData(clipping, e as unknown as React.DragEvent)
                      }
                      onClick={() => onPlaceClipping(clipping)}
                      className="group flex flex-col overflow-hidden rounded-lg bg-background text-left outline-none ring-1 ring-border/40 transition-shadow hover:ring-border focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="aspect-square w-full overflow-hidden bg-foreground/[0.02]">
                        <img
                          src={clipping.clippingCfImageUrl}
                          alt={clippingAltText(clipping)}
                          className="size-full object-contain"
                          draggable={false}
                        />
                      </div>
                      <div className="truncate px-2 py-1.5 text-[11px] text-muted-foreground">
                        {clipping.label || "Untitled sample"}
                      </div>
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="grid size-11 place-items-center rounded-full bg-foreground/[0.04] ring-1 ring-border/40">
        <Scissors className="size-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold tracking-tight text-foreground">
        No samples yet
      </h3>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
        Right-click any image on the table and choose “Extract a sample…” to cut
        a material out and save it here.
      </p>
    </div>
  );
}

export default SampleDrawer;
