import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LevelRoomSelectRoom {
  id: number;
  floorKey: string;
  floorName: string;
}

interface LevelRoomSelectProps {
  /** All catalog rooms (must carry floorKey + floorName). */
  rooms: LevelRoomSelectRoom[];
  /** Currently-selected room ids (as strings, matching MultipleSelector values). */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  className?: string;
}

interface FloorGroup {
  key: string;
  name: string;
  roomIds: string[];
}

type SelectionState = "all" | "some" | "none";

/**
 * Bulk "map to a level" toggles for inspirational room selection.
 *
 * Each button selects/clears every room on a floor (and an "All levels" button
 * covers every room). It's a pure convenience over the existing per-room
 * multiselect — selecting a level just fans out to that floor's room ids, which
 * the user can then individually deselect (e.g. "upstairs hardwood, minus the
 * two bathrooms"). No new data model: the resulting `value` is still a plain
 * list of room ids.
 */
export function LevelRoomSelect({
  rooms,
  value,
  onChange,
  disabled,
  className,
}: LevelRoomSelectProps) {
  const floors = useMemo<FloorGroup[]>(() => {
    const map = new Map<string, FloorGroup>();
    for (const room of rooms) {
      const key = room.floorKey || "unassigned";
      if (!map.has(key)) {
        map.set(key, { key, name: room.floorName || "Other", roomIds: [] });
      }
      map.get(key)!.roomIds.push(String(room.id));
    }
    return Array.from(map.values());
  }, [rooms]);

  const selected = useMemo(() => new Set(value), [value]);
  const allRoomIds = useMemo(() => rooms.map((room) => String(room.id)), [rooms]);

  const stateOf = (ids: string[]): SelectionState => {
    if (ids.length === 0) return "none";
    let count = 0;
    for (const id of ids) {
      if (selected.has(id)) count += 1;
    }
    if (count === 0) return "none";
    return count === ids.length ? "all" : "some";
  };

  const toggle = (ids: string[]) => {
    const next = new Set(selected);
    if (stateOf(ids) === "all") {
      for (const id of ids) next.delete(id);
    } else {
      for (const id of ids) next.add(id);
    }
    onChange(Array.from(next));
  };

  if (floors.length === 0) {
    return null;
  }

  const renderToggle = (key: string, label: string, ids: string[]) => {
    const state = stateOf(ids);
    return (
      <Button
        key={key}
        type="button"
        size="sm"
        variant={state === "all" ? "default" : "outline"}
        disabled={disabled || ids.length === 0}
        aria-pressed={state === "all"}
        onClick={() => toggle(ids)}
        title={
          state === "all"
            ? `All ${label} rooms selected — click to clear`
            : `Select every room on ${label}`
        }
        className={cn(
          "h-7 px-2.5 text-xs",
          state === "some" && "border-primary/60 bg-primary/10 text-foreground",
        )}
      >
        <span className="mr-1 font-mono text-[10px] leading-none opacity-70">
          {state === "all" ? "✓" : state === "some" ? "–" : "+"}
        </span>
        {label}
      </Button>
    );
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="mr-0.5 text-xs text-muted-foreground">Map to level:</span>
      {floors.map((floor) => renderToggle(floor.key, floor.name, floor.roomIds))}
      {floors.length > 1 && renderToggle("__all__", "All levels", allRoomIds)}
    </div>
  );
}
