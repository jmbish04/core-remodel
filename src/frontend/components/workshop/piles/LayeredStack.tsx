// ---------------------------------------------------------------------------
// LayeredStack — the §8 "Layered Stack" pile behavior (gsap). Thumbnails sit in
// a tight restacked pile; hover springs them out into a fan; mouseleave
// restacks. Reduced-motion → an instant, spring-free expand (no gsap tween).
// Clicking a fanned photo opens a small action menu (handled by the parent).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

import { cn } from "@/lib/utils";

import { useReducedMotion } from "../hooks/useReducedMotion";
import { clippingAltText, type CollectionItem } from "../types";

interface LayeredStackProps {
  items: CollectionItem[];
  onPhotoClick: (item: CollectionItem, anchor: { x: number; y: number }) => void;
}

const THUMB = 56; // px
const FAN_GAP = 44; // px between fanned thumbnails

export function LayeredStack({ items, onPhotoClick }: LayeredStackProps) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const layout = useCallback(
    (open: boolean) => {
      const count = items.length;
      thumbRefs.current.forEach((el, index) => {
        if (!el) return;
        const targetX = open ? index * FAN_GAP : Math.min(index, 3) * 3;
        const targetY = open ? 0 : Math.min(index, 3) * -2;
        const targetRot = open ? 0 : (index - (count - 1) / 2) * 2;
        if (reduced) {
          gsap.set(el, { x: targetX, y: targetY, rotate: targetRot });
        } else {
          gsap.to(el, {
            x: targetX,
            y: targetY,
            rotate: targetRot,
            duration: 0.42,
            ease: "back.out(1.6)",
          });
        }
      });
    },
    [items.length, reduced],
  );

  useEffect(() => {
    layout(expanded);
  }, [expanded, layout, items.length]);

  const width = expanded
    ? Math.max(THUMB, (items.length - 1) * FAN_GAP + THUMB)
    : THUMB + 12;

  return (
    <div
      className="relative"
      style={{ height: THUMB, width }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setExpanded(false);
        }
      }}
    >
      {items.length === 0 ? (
        <div className="grid size-14 place-items-center rounded-lg bg-foreground/[0.03] ring-1 ring-border/40">
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            Empty
          </span>
        </div>
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            ref={(el) => {
              thumbRefs.current[index] = el;
            }}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onPhotoClick(item, { x: rect.right, y: rect.top });
            }}
            aria-label={clippingAltText({ label: null })}
            className={cn(
              "absolute left-0 top-0 size-14 overflow-hidden rounded-lg bg-card ring-1 ring-border/50 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
              "shadow-[0_2px_8px_rgba(0,0,0,0.4)]",
            )}
            style={{ zIndex: index }}
          >
            <img
              src={item.cfImageUrl}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          </button>
        ))
      )}
    </div>
  );
}

export default LayeredStack;
