/**
 * @fileoverview room-view/hero-placeholder.tsx
 *
 * A single, reusable "no listing photo yet" hero placeholder for feature 0005.
 *
 * WHY THIS EXISTS (REVISIONS.md §C3 — "Hero image is NEVER an inspiration
 * photo"):
 *   The hero/representative image of a room must be a *listing* photo only. The
 *   server fallback chain is `representativeImageId (if listing) → first listing
 *   image → null` — inspiration photos are deliberately excluded. When a room
 *   has zero listing photos the API returns `representativeImage = null` (room
 *   detail) / `heroImageUrl = null` (catalog), and the UI must render a tasteful
 *   default *placeholder* rather than reaching for an inspiration photo. This
 *   component is that placeholder, shared by every hero surface so the empty
 *   state is identical everywhere:
 *     - the room viewport hero thumbnail (`HeroHeader`),
 *     - the floor-plan dot's hover/pin card (`RoomHoverCard` → `RoomCardBody`).
 *
 * DESIGN (Monolith profile): no 1px borders — separation comes from a muted
 * `bg-muted/30` fill inside the caller's `ring-1` frame. A single low-emphasis
 * lucide glyph (`ImageOff`) plus quiet "No listing photo yet" copy keeps the
 * card calm and on-brand in the dark theme. The component renders ONLY the
 * inner fill; the caller owns the outer aspect-ratio box and rounding so the
 * placeholder slots cleanly into whatever frame already wraps a real `<img>`.
 */

import { ImageOff } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/** Visual size of the placeholder, controlling the glyph + copy scale. */
export type HeroPlaceholderSize = "sm" | "md";

export interface HeroPlaceholderProps {
  /**
   * `md` (default) — the room-viewport hero thumbnail (larger glyph + caption).
   * `sm` — compact surfaces such as the floor-plan dot card (glyph + tiny copy).
   */
  size?: HeroPlaceholderSize;
  /**
   * When false, only the icon is shown (used by very small cards where a caption
   * would wrap awkwardly). Defaults to true.
   */
  showCaption?: boolean;
  /** Optional extra classes merged onto the fill container. */
  className?: string;
}

/**
 * The inner fill for a hero frame that has no listing photo. Intentionally has
 * NO aspect-ratio of its own — it stretches to fill the caller's box (which is
 * the same box a real `<img>` would occupy), so swapping image ⇄ placeholder
 * never shifts layout.
 */
export function HeroPlaceholder({
  size = "md",
  showCaption = true,
  className,
}: HeroPlaceholderProps) {
  const iconClass = size === "md" ? "size-6" : "size-5";
  const captionClass = size === "md" ? "text-xs" : "text-[11px]";

  return (
    <div
      // `role="img"` + `aria-label` gives assistive tech a meaningful name for
      // the empty state instead of announcing nothing (the glyph is decorative).
      role="img"
      aria-label="No listing photo yet"
      className={cn(
        "flex size-full flex-col items-center justify-center gap-2 bg-muted/30 text-center text-muted-foreground",
        className,
      )}
    >
      <ImageOff className={iconClass} aria-hidden="true" />
      {showCaption ? (
        <p className={cn("px-4 leading-tight", captionClass)}>No listing photo yet</p>
      ) : null}
    </div>
  );
}

export default HeroPlaceholder;
