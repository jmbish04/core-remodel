/**
 * @fileoverview floorplan/LevelSidebar.tsx
 *
 * The right-hand sidebar of the floor-plan page (feature 0005, Phase 2 /
 * tasks T2.5 + T2.7).
 *
 * What it does:
 *   - Hosts the Lower / Upper LEVEL SWITCH (shadcn `Switch`). This control moved
 *     OUT of the floorplan header (T2.5). Toggling it:
 *       * does NOT trigger any data reload, and
 *       * does NOT change which dots are visible (all dots are always shown),
 *       * ONLY changes which interior level's rooms this sidebar lists.
 *   - Lists the rooms for the selected interior level as compact rows (preview
 *     thumbnail, display name, room code, listing/inspiration count badges) that
 *     link to `/rooms/{roomCode}` — preserving the existing sidebar look.
 *   - Always renders an "Outside / Unplaced" group beneath the level list for
 *     rooms whose `floorplanFloorKey` is `outside`/`all_levels`/null or that have
 *     no coordinates (so unplaced rooms remain reachable).
 *
 * Grouping is driven by `floorplanFloorKey` (NOT by the catalog's nested floor),
 * because a room can be placed on a different canvas than the floor it is filed
 * under. Dot visibility is unrelated to this switch.
 *
 * Responsive: the parent stacks this below the floorplan on small screens; the
 * sidebar itself is fluid-width and its rows wrap gracefully.
 */

import { ArrowUpRight, ImageIcon } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { CatalogRoom, ResolvedRoom, SidebarLevel } from "./types";

/**
 * Determine whether a room belongs to the "Outside / Unplaced" bucket: anything
 * not pinned to one of the two interior levels, or lacking real coordinates.
 */
function isOutsideOrUnplaced(room: CatalogRoom): boolean {
  const key = room.floorplanFloorKey;
  if (key === "lower_level" || key === "upper_level") {
    // Pinned to an interior level but missing coords → still "unplaced".
    return room.floorplanXPct === null || room.floorplanYPct === null;
  }
  // outside, all_levels, or null → outside/unplaced group.
  return true;
}

export interface LevelSidebarProps {
  /** Resolved view-models for every room (counts/hero already computed). */
  resolved: ResolvedRoom[];
  /** Currently-selected interior level for the room list. */
  level: SidebarLevel;
  /** Change the selected interior level (switch handler). */
  onLevelChange: (level: SidebarLevel) => void;
  className?: string;
}

/**
 * The sidebar card. Pure presentation over `resolved`; all data is precomputed by
 * the parent so toggling the switch is instant and never refetches.
 */
export function LevelSidebar({ resolved, level, onLevelChange, className }: LevelSidebarProps) {
  // Partition rooms once per render into the three buckets.
  const { levelRooms, outsideRooms } = React.useMemo(() => {
    const lower: ResolvedRoom[] = [];
    const upper: ResolvedRoom[] = [];
    const outside: ResolvedRoom[] = [];

    for (const entry of resolved) {
      if (isOutsideOrUnplaced(entry.room)) {
        outside.push(entry);
      } else if (entry.room.floorplanFloorKey === "lower_level") {
        lower.push(entry);
      } else {
        upper.push(entry);
      }
    }

    return {
      levelRooms: level === "lower_level" ? lower : upper,
      outsideRooms: outside,
    };
  }, [resolved, level]);

  const isUpper = level === "upper_level";
  const levelTitle = isUpper ? "Upper Level" : "Lower Level";

  return (
    <Card className={cn("ring-1 ring-border/40", className)}>
      <CardHeader>
        <CardTitle className="text-base">Rooms</CardTitle>
        <CardDescription>Switch levels to browse room portals</CardDescription>

        {/*
          Level switch. Labels flank the switch so the on/off states read
          explicitly as "Lower" (unchecked) and "Upper" (checked). The whole
          control is a labelled group for assistive tech.
        */}
        <div
          className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2"
          role="group"
          aria-label="Floor level"
        >
          <Label
            htmlFor="floorplan-level-switch"
            className={cn(
              "cursor-pointer text-xs font-medium transition-colors",
              !isUpper ? "text-foreground" : "text-muted-foreground",
            )}
          >
            Lower
          </Label>
          <Switch
            id="floorplan-level-switch"
            checked={isUpper}
            onCheckedChange={(checked) => onLevelChange(checked ? "upper_level" : "lower_level")}
            aria-label={`Show ${isUpper ? "upper" : "lower"} level rooms`}
          />
          <Label
            htmlFor="floorplan-level-switch"
            className={cn(
              "cursor-pointer text-xs font-medium transition-colors",
              isUpper ? "text-foreground" : "text-muted-foreground",
            )}
          >
            Upper
          </Label>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Selected interior level. */}
        <section className="space-y-3" aria-label={`${levelTitle} rooms`}>
          <SidebarGroupHeading title={levelTitle} count={levelRooms.length} />
          {levelRooms.length === 0 ? (
            <SidebarEmpty message={`No rooms recorded on the ${levelTitle.toLowerCase()} yet.`} />
          ) : (
            <div className="space-y-3">
              {levelRooms.map((entry) => (
                <SidebarRoomRow key={entry.room.id} entry={entry} />
              ))}
            </div>
          )}
        </section>

        {/* Always-visible outside / unplaced group. */}
        {outsideRooms.length > 0 ? (
          <section className="space-y-3" aria-label="Outside or unplaced rooms">
            <SidebarGroupHeading title="Outside / Unplaced" count={outsideRooms.length} />
            <div className="space-y-3">
              {outsideRooms.map((entry) => (
                <SidebarRoomRow key={entry.room.id} entry={entry} />
              ))}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Small uppercase section heading with a count badge. */
function SidebarGroupHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {title}
      </h3>
      <Badge variant="secondary">{count}</Badge>
    </div>
  );
}

/** Dashed empty-state row (no 1px solid border; dashed ring-style placeholder). */
function SidebarEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}

/**
 * One room row. Mirrors the prior sidebar row: preview image, name + code,
 * listing/inspiration badges, and a link to the room portal.
 */
function SidebarRoomRow({ entry }: { entry: ResolvedRoom }) {
  const { room, listingCount, inspirationCount, heroImageUrl } = entry;
  return (
    <a
      href={`/rooms/${room.roomCode}`}
      className={cn(
        "block rounded-xl bg-card/40 p-3 ring-1 ring-border/40 transition",
        "hover:-translate-y-0.5 hover:bg-muted/20 hover:ring-primary/40",
      )}
    >
      <div className="flex gap-3">
        {heroImageUrl ? (
          // biome-ignore lint/performance/noImgElement: external delivery urls are expected
          <img
            src={heroImageUrl}
            alt={room.displayName}
            className="h-16 w-20 shrink-0 rounded-lg object-cover sm:h-20 sm:w-24"
            loading="lazy"
          />
        ) : (
          <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-lg bg-muted/20 ring-1 ring-border/40 sm:h-20 sm:w-24">
            <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{room.displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{room.roomCode}</p>
            </div>
            <ArrowUpRight
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={listingCount > 0 ? "default" : "secondary"}>
              {listingCount} listing
            </Badge>
            <Badge variant={inspirationCount > 0 ? "default" : "secondary"}>
              {inspirationCount} inspiration
            </Badge>
          </div>
        </div>
      </div>
    </a>
  );
}
