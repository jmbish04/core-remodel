"use client";

import * as React from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

/**
 * @fileoverview room-select.tsx — the ONE reusable room-selection dropdown.
 *
 * Every room picker app-wide (moodboards, listing-photo uploads, room-view photo
 * "move/reassign", supporting-document filters, render studio, …) must use this
 * component so they all behave identically per 0005 REVISIONS §C4:
 *
 *   1. NO room selected by default — `value` starts at `null`, the trigger shows a
 *      placeholder ("Select a room (optional)" by default). We NEVER auto-select.
 *   2. The trigger shows the room DISPLAY NAME, never the raw DB id. (The old
 *      moodboards dropdown auto-selected ghost room `2330295` and rendered the id.)
 *   3. Options are GROUPED BY FLOOR LEVEL (Lower / Upper / Outside …) with a group
 *      label, and sorted ALPHABETICALLY by display name within each floor.
 *   4. A SEARCH box filters the list as you type.
 *   5. ACTIVE rooms only — `GET /api/rooms/catalog` already filters `is_active=true`
 *      (home-catalog.ts, C1); we additionally treat the catalog as the single
 *      source of truth and never synthesize rooms from free text.
 *
 * IMPLEMENTATION NOTE — why Combobox and not the shared `<Select>`:
 *   base-ui's `Select` cannot host a sticky search field that filters items while
 *   keeping floor groups intact. base-ui's `Combobox` does exactly that natively:
 *   it accepts grouped `items` (`{ value, items }[]`), filters + re-groups them as
 *   the user types, resolves `{ value, label }` item objects to their label for
 *   both the trigger and the filter text, and renders an empty state. We reuse the
 *   project's existing `combobox.tsx` primitives (all `@base-ui/react`) — NO new
 *   dependency, and certainly NOT `react-aria-components`. The trigger is styled to
 *   match the Monolith `<Select>` trigger so it is visually indistinguishable.
 *
 * The component fetches the catalog itself (one `GET /api/rooms/catalog` per
 * mount) so call sites only have to hand it a `value` + `onChange`.
 */

// ---------------------------------------------------------------------------
// Catalog types (the slice of GET /api/rooms/catalog we consume)
// ---------------------------------------------------------------------------

/** A single room as returned inside `floors[].rooms` by the catalog endpoint. */
interface CatalogRoom {
  id: number;
  displayName?: string | null;
  roomName?: string | null;
  /** C1: present in every catalog row; the endpoint already filters to true. */
  isActive?: boolean | null;
}

/** A floor group as returned by the catalog endpoint. */
interface CatalogFloor {
  id: number;
  key: string;
  name: string;
  /** Sort order: Lower(1) → Upper(2) → Outside(3) → … (home-catalog seed). */
  levelOrder?: number | null;
  rooms?: CatalogRoom[] | null;
}

/** Top-level response shape from `GET /api/rooms/catalog`. */
interface CatalogResponse {
  success?: boolean;
  error?: string;
  floors?: CatalogFloor[];
}

// ---------------------------------------------------------------------------
// Internal item / group shapes consumed by base-ui Combobox
// ---------------------------------------------------------------------------

/**
 * base-ui resolves a `{ value, label }` item to `label` for display and filtering
 * automatically. `value` is the numeric room id; `null` is reserved for the
 * optional "All rooms" sentinel (see `includeAllOption`).
 */
interface RoomItem {
  value: number | null;
  label: string;
}

/** A floor section: `{ value: <floor label>, items: RoomItem[] }` (base-ui `Group`). */
interface RoomGroup {
  value: string;
  items: RoomItem[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RoomSelectProps {
  /** Selected room id, or `null` when nothing is chosen (the default). */
  value: number | null;
  /** Fired with the new room id, or `null` when cleared / "All rooms" picked. */
  onChange: (roomId: number | null) => void;
  /** Trigger placeholder shown while `value` is `null`. */
  placeholder?: string;
  /** Class applied to the trigger button (sizing/width live here). */
  className?: string;
  /** Disables the whole control. */
  disabled?: boolean;
  /** Forwarded to the trigger for `<label htmlFor>` association. */
  id?: string;
  /** Accessible name when there is no visible `<label>`. */
  "aria-label"?: string;
  /**
   * Hide a specific room from the list (e.g. the room you are moving photos OUT
   * of, where selecting it would be a no-op). Optional; defaults to showing all.
   */
  excludeRoomId?: number | null;
  /**
   * Render a leading sentinel option whose value is `null` — used by FILTER
   * dropdowns that need an explicit "All rooms" choice rather than a placeholder.
   * When false (default) clearing simply returns to the placeholder.
   */
  includeAllOption?: boolean;
  /** Label for the `includeAllOption` sentinel. */
  allOptionLabel?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a room's human label, never leaking the id. */
function roomLabel(room: CatalogRoom): string {
  const display = room.displayName?.trim();
  if (display) return display;
  const raw = room.roomName?.trim();
  if (raw) return raw;
  return `Room ${room.id}`;
}

/** Stable, case-insensitive alphabetical comparison of display labels. */
function byLabel(a: RoomItem, b: RoomItem): number {
  return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Reusable, floor-grouped, searchable, active-only room picker with no default
 * selection. See the file header for the full §C4 contract.
 */
export function RoomSelect({
  value,
  onChange,
  placeholder = "Select a room (optional)",
  className,
  disabled = false,
  id,
  "aria-label": ariaLabel,
  excludeRoomId = null,
  includeAllOption = false,
  allOptionLabel = "All rooms",
}: RoomSelectProps) {
  const [floors, setFloors] = React.useState<CatalogFloor[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // ----- fetch the catalog once per mount -----
  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch("/api/rooms/catalog", {
          credentials: "include",
          signal: controller.signal,
        });
        const payload = (await response.json()) as CatalogResponse;
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error ?? `Failed to load rooms (${response.status})`);
        }
        if (!active) return;
        setFloors(Array.isArray(payload.floors) ? payload.floors : []);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        // Surface a one-line message in the empty state rather than throwing —
        // a room picker must never crash the host page (no silent swallow either:
        // the message is rendered to the user inside the popup).
        setLoadError(
          error instanceof Error ? error.message : "Failed to load rooms",
        );
        setFloors([]);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  // ----- build floor groups: ordered floors, alphabetical rooms, active-only -----
  const groups = React.useMemo<RoomGroup[]>(() => {
    const orderedFloors = [...floors].sort(
      (a, b) => (a.levelOrder ?? 0) - (b.levelOrder ?? 0),
    );

    const result: RoomGroup[] = [];
    for (const floor of orderedFloors) {
      const items: RoomItem[] = [];
      for (const room of floor.rooms ?? []) {
        // Active-only guard (defense in depth; catalog already filters is_active).
        if (room.isActive === false) continue;
        if (excludeRoomId != null && room.id === excludeRoomId) continue;
        items.push({ value: room.id, label: roomLabel(room) });
      }
      if (items.length === 0) continue;
      items.sort(byLabel);
      result.push({ value: floor.name, items });
    }
    return result;
  }, [floors, excludeRoomId]);

  // base-ui needs the "All rooms" sentinel as its own (label-less) group so it is
  // pinned above the floor sections and is itself searchable.
  const itemGroups = React.useMemo<RoomGroup[]>(() => {
    if (!includeAllOption) return groups;
    return [{ value: "", items: [{ value: null, label: allOptionLabel }] }, ...groups];
  }, [groups, includeAllOption, allOptionLabel]);

  // A flat list used only to resolve the current `value` → its `RoomItem` so the
  // controlled `value` prop maps to a referential item base-ui can match.
  const flatItems = React.useMemo<RoomItem[]>(
    () => itemGroups.flatMap((group) => group.items),
    [itemGroups],
  );

  const selectedItem = React.useMemo<RoomItem | null>(() => {
    if (value == null) {
      // When an explicit "All rooms" sentinel exists, null means that item.
      return includeAllOption
        ? flatItems.find((item) => item.value === null) ?? null
        : null;
    }
    return flatItems.find((item) => item.value === value) ?? null;
  }, [value, flatItems, includeAllOption]);

  const handleChange = React.useCallback(
    (next: RoomItem | null) => {
      onChange(next?.value ?? null);
    },
    [onChange],
  );

  const isDisabled = disabled || loading;
  const resolvedPlaceholder = loading
    ? "Loading rooms…"
    : groups.length === 0
      ? "No rooms available"
      : placeholder;

  return (
    <Combobox
      items={itemGroups}
      value={selectedItem}
      onValueChange={handleChange}
      // Match by room id so the controlled value need not be referentially equal.
      isItemEqualToValue={(a: RoomItem, b: RoomItem) => a.value === b.value}
      disabled={isDisabled}
    >
      {/* Trigger styled to match the Monolith <Select> trigger exactly. */}
      <ComboboxPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        data-slot="room-select-trigger"
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
          className,
        )}
      >
        <ComboboxValue placeholder={resolvedPlaceholder}>
          {(item: RoomItem | null) => (
            <span
              className={cn(
                "line-clamp-1 flex flex-1 text-left",
                item == null && "text-muted-foreground",
              )}
            >
              {item?.label ?? resolvedPlaceholder}
            </span>
          )}
        </ComboboxValue>
        <ComboboxPrimitive.Icon
          render={
            <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
          }
        />
      </ComboboxPrimitive.Trigger>

      <ComboboxContent>
        {/* Sticky search field — base-ui filters items against the {label}.
            The leading magnifier uses an inline-start addon (order-first) so it
            sits at the left of the InputGroup without overlapping the text. */}
        <ComboboxInput
          showTrigger={false}
          placeholder="Search rooms…"
          aria-label="Search rooms"
        >
          <InputGroupAddon align="inline-start">
            <SearchIcon className="size-4 text-muted-foreground" />
          </InputGroupAddon>
        </ComboboxInput>

        <ComboboxEmpty>
          {loadError ? `Couldn't load rooms: ${loadError}` : "No matching rooms."}
        </ComboboxEmpty>

        <ComboboxList>
          {(group: RoomGroup) => (
            <ComboboxGroup key={group.value || "__all__"} items={group.items}>
              {group.value ? <ComboboxLabel>{group.value}</ComboboxLabel> : null}
              <ComboboxCollection>
                {(item: RoomItem) => (
                  <ComboboxItem
                    key={item.value ?? "__all__"}
                    value={item}
                    className={cn(item.value == null && "text-muted-foreground")}
                  >
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export default RoomSelect;
