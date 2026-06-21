/**
 * @fileoverview floorplan/RoomHoverCard.tsx
 *
 * The room card shown for a floor-plan dot (feature 0005, Phase 2 / task T2.4).
 *
 * Behavior contract:
 *   - HOVER (fine pointer / desktop) → the card opens while the cursor is over
 *     the dot or the card itself, and closes when the cursor leaves both.
 *   - CLICK / TAP → the card becomes PINNED (sticky): it stays open after the
 *     pointer leaves, until the user dismisses it (Escape, click-away, or the
 *     close affordance) OR clicks a different dot (the parent moves the single
 *     pin, so the previous card closes automatically).
 *   - TOUCH (coarse pointer / mobile) → there is no hover; a tap is a click, so
 *     tap pins. The card content uses comfortable hit targets and the whole card
 *     is reachable for "View Room".
 *
 * Implementation notes:
 *   - Pin state is OWNED BY THE PARENT (`pinned` + `onPinChange`) so that only one
 *     card can be pinned at a time and clicking another dot transfers the pin.
 *   - Hover state is local. The popover's effective `open = pinned || hovered`.
 *   - We gate hover-open behind a `(pointer: fine)` media query so a tap on touch
 *     devices doesn't momentarily hover-open before pinning.
 *   - The card is a shadcn `Card` rendered inside the base-ui `PopoverContent`
 *     popup, matching the user's reference pattern (hero image, name, count
 *     badges, sqft + dimensions, "View Room").
 *   - Built on `@base-ui/react` Popover (NOT Radix): sides use `inline-start` /
 *     `inline-end`; we use `side="top"` so the card floats above the dot and does
 *     not cover the room it describes.
 */

import { ArrowUpRight, Ruler } from "lucide-react";
import * as React from "react";

import { HeroPlaceholder } from "@/components/room-view/hero-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { FloorplanDot } from "./FloorplanDot";
import { getRoomStatus, type ResolvedRoom } from "./types";

/**
 * Media-query hook for `(pointer: fine)`. Returns true on devices whose primary
 * pointer supports hover (mouse / trackpad), false on touch. SSR-safe: defaults
 * to `false` until mounted so first paint never assumes hover.
 */
function usePointerFine(): boolean {
  const [fine, setFine] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(pointer: fine)");
    const update = () => setFine(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return fine;
}

export interface RoomHoverCardProps {
  /** Fully-resolved room view-model (counts, hero, dims already computed). */
  resolved: ResolvedRoom;
  /** Whether THIS room's card is the currently-pinned one. */
  pinned: boolean;
  /**
   * Request a pin change. `true` = pin this room (parent unpins any other),
   * `false` = unpin. The parent is the single source of truth for the pin.
   */
  onPinChange: (pinned: boolean) => void;
}

/**
 * A floor-plan dot plus its hover/pin card. Renders nothing when the room has no
 * coordinates (the parent already filters those out, but we guard anyway).
 */
export function RoomHoverCard({ resolved, pinned, onPinChange }: RoomHoverCardProps) {
  const { room, listingCount, inspirationCount, heroImageUrl, dimensions, sqft } = resolved;
  const pointerFine = usePointerFine();
  const [hovered, setHovered] = React.useState(false);

  // Guard: a dot requires real coordinates.
  if (room.floorplanXPct === null || room.floorplanYPct === null) {
    return null;
  }

  const status = getRoomStatus(listingCount, inspirationCount);
  const open = pinned || (pointerFine && hovered);

  const label = `${room.displayName}: ${listingCount} listing, ${inspirationCount} inspiration`;

  /**
   * Popover open-change handler. base-ui fires this for outside-clicks, Escape,
   * and trigger toggles. We treat any close while pinned as an explicit dismiss.
   */
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setHovered(false);
      if (pinned) onPinChange(false);
    }
  };

  /**
   * Click on the dot toggles the pin. With base-ui's controlled `open`, the
   * trigger's own toggle is superseded by our `open` value, so we drive pinning
   * explicitly here (works identically for mouse-click and touch-tap).
   */
  const handleDotClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onPinChange(!pinned);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <FloorplanDot
            xPct={room.floorplanXPct}
            yPct={room.floorplanYPct}
            status={status}
            listingCount={listingCount}
            label={label}
            pinned={pinned}
            onClick={handleDotClick}
            // Hover only matters on fine pointers; the gate above ignores it
            // on touch, but wiring the handlers unconditionally is harmless.
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          />
        }
      />
      <PopoverContent
        side="top"
        sideOffset={10}
        // Keep the card open while the pointer is over it (desktop hover).
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="w-[18rem] max-w-[calc(100vw-2rem)] border-0 bg-transparent p-0 shadow-none ring-0"
      >
        <RoomCardBody
          roomCode={room.roomCode}
          displayName={room.displayName}
          heroImageUrl={heroImageUrl}
          listingCount={listingCount}
          inspirationCount={inspirationCount}
          dimensions={dimensions}
          sqft={sqft}
          pinned={pinned}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The visual card body. Extracted so the exact same layout can be reused by the
 * mobile tap-sheet (or anywhere a room summary card is needed) without dragging
 * the popover machinery along.
 */
export function RoomCardBody({
  roomCode,
  displayName,
  heroImageUrl,
  listingCount,
  inspirationCount,
  dimensions,
  sqft,
  pinned = false,
  className,
}: {
  roomCode: string;
  displayName: string;
  heroImageUrl: string | null;
  listingCount: number;
  inspirationCount: number;
  dimensions: string | null;
  sqft: number | null;
  pinned?: boolean;
  className?: string;
}) {
  const hasMeta = Boolean(dimensions) || typeof sqft === "number";

  return (
    <Card
      size="sm"
      className={cn(
        // Stronger ring + shadow than the default card so it reads as a floating
        // layer above the floorplan. Still no 1px border (Monolith rule).
        "w-full gap-0 overflow-hidden p-0 shadow-xl ring-1 ring-foreground/15",
        pinned && "ring-2 ring-primary/60",
        className,
      )}
    >
      {/*
        Hero image, or the shared "no listing photo yet" placeholder. C3
        (REVISIONS.md): the catalog `heroImageUrl` is LISTING-only (null when the
        room has no listing photo), so a null here means "no listing photo" — we
        show the placeholder and NEVER fall back to an inspiration photo. The
        compact placeholder drops its caption to fit the small card cleanly.
      */}
      {heroImageUrl ? (
        // biome-ignore lint/performance/noImgElement: external delivery urls are expected
        <img
          src={heroImageUrl}
          alt={`${displayName} hero`}
          className="aspect-[16/10] w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="aspect-[16/10] w-full">
          <HeroPlaceholder size="sm" showCaption={false} />
        </div>
      )}

      <div className="space-y-3 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{roomCode}</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant={listingCount > 0 ? "default" : "secondary"}>{listingCount} listing</Badge>
          <Badge variant={inspirationCount > 0 ? "default" : "secondary"}>
            {inspirationCount} inspiration
          </Badge>
        </div>

        {hasMeta ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Ruler className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {[
                typeof sqft === "number" ? `${sqft.toLocaleString()} sq ft` : null,
                dimensions || null,
              ]
                .filter(Boolean)
                .join(" • ")}
            </span>
          </div>
        ) : null}

        {/*
          Real anchor styled as a button → SSR-friendly, keyboard-navigable.
          base-ui merges the Button's children (the "View Room" label + icon)
          into this anchor at runtime; the explicit aria-label guarantees an
          accessible name even though the children are injected dynamically.
        */}
        <Button
          size="sm"
          className="w-full"
          render={<a href={`/rooms/${roomCode}`} aria-label={`View ${displayName} room`} />}
        >
          View Room
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}
