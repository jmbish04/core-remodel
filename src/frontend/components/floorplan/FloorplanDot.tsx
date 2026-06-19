/**
 * @fileoverview floorplan/FloorplanDot.tsx
 *
 * A single positioned marker on the combined floor-plan image (feature 0005,
 * Phase 2 / task T2.3).
 *
 * Responsibilities (presentational only):
 *   - Absolutely position itself at `xPct% / yPct%` over the floorplan image,
 *     centered on the point via `-translate-{x,y}-1/2`.
 *   - Color itself by room status (emerald = has listing photos, amber =
 *     inspiration-only, muted = placed but empty) per the existing convention.
 *   - Show the listing-photo count as its label.
 *   - Indicate the "pinned" state with a focus-style ring so the user can see
 *     which dot's card is sticky.
 *
 * It deliberately owns NO popover/hover logic. `RoomHoverCard` composes this as
 * its Popover trigger (via the `render` prop) and supplies hover/click handlers,
 * which keeps hover-vs-pin behavior in one place and this leaf fully reusable.
 *
 * Coordinates come straight from the DB (`floorplanXPct/YPct`); there is no
 * hardcoded coordinate map anymore — the old `ROOM_COORDINATES_BY_CODE` was
 * removed in T2.3.
 */

import * as React from "react";

import { cn } from "@/lib/utils";

import type { RoomStatus } from "./types";

/** Tailwind classes per status for the dot fill. */
const STATUS_DOT_CLASSES: Record<RoomStatus, string> = {
  listing: "bg-emerald-600",
  inspiration: "bg-amber-500",
  none: "bg-muted-foreground/80",
};

export interface FloorplanDotProps extends Omit<
  React.ComponentPropsWithoutRef<"button">,
  "children"
> {
  /** Absolute horizontal position over the floorplan image, 0–100. */
  xPct: number;
  /** Absolute vertical position over the floorplan image, 0–100. */
  yPct: number;
  /** Visual status driving the dot color. */
  status: RoomStatus;
  /** Listing-photo count shown as the dot label. */
  listingCount: number;
  /** Accessible label / native tooltip describing the room + counts. */
  label: string;
  /** Whether this dot's hover card is currently pinned (sticky). */
  pinned?: boolean;
}

/**
 * The dot is a real `<button>` so it is keyboard-focusable and announces as an
 * interactive control to assistive tech. `forwardRef` lets `@base-ui`'s Popover
 * attach its trigger ref + ARIA wiring when this is passed via `render`.
 */
export const FloorplanDot = React.forwardRef<HTMLButtonElement, FloorplanDotProps>(
  function FloorplanDot(
    { xPct, yPct, status, listingCount, label, pinned = false, className, style, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        data-pinned={pinned ? "true" : undefined}
        className={cn(
          // Positioning: centered on the coordinate point.
          "absolute z-10 -translate-x-1/2 -translate-y-1/2",
          // Shape + label. Min size keeps single-digit dots tappable on touch.
          "inline-flex min-h-6 min-w-6 items-center justify-center rounded-full px-1.5 py-0.5",
          // No 1px border for separation — use a white ring so the dot reads on
          // any underlying floorplan region (Monolith: ring, not border).
          "text-[11px] font-semibold leading-none text-white shadow-md ring-2 ring-white/90",
          // Touch ergonomics: invisible expanded hit area on coarse pointers.
          "touch-manipulation after:absolute after:-inset-2 after:content-['']",
          // Motion + focus affordances.
          "cursor-pointer outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-4 focus-visible:ring-ring/60",
          // Pinned dots get a persistent emphasis ring.
          pinned && "scale-110 ring-4 ring-primary/80",
          STATUS_DOT_CLASSES[status],
          className,
        )}
        style={{ left: `${xPct}%`, top: `${yPct}%`, ...style }}
        {...props}
      >
        {listingCount}
      </button>
    );
  },
);
