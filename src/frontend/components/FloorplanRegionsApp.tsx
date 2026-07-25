/**
 * FloorplanRegionsApp — admin tool to draw each room's rectangle on the
 * floorplan image (docs/0014_ai_photo_workshop). Saving a region crops the
 * floorplan to that box (server-side, Cloudflare Images) so the Workshop's
 * furnish-this-plan recipe runs per-room instead of whole-house.
 *
 * Flow: pick a level tab → pick a room → drag a rectangle on the floorplan →
 * it auto-saves. Existing regions render as dimmed boxes; the selected room's
 * box is highlighted and editable. "Clear" removes a room's region.
 *
 * Coordinates are percents (0–100) of the floorplan image, matching the dot
 * coordinates already stored on rooms.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Region {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

interface RoomRegion {
  id: number;
  name: string;
  floorplanFloorKey: string | null;
  floorplanXPct: number | null;
  floorplanYPct: number | null;
  region: Region | null;
  cropUrl: string | null;
}

interface ApiResponse {
  floorplanImageUrl: string;
  rooms: RoomRegion[];
}

/** Level tabs, in walking order. Any other key falls into "outside". */
const LEVELS: Array<{ key: string; label: string }> = [
  { key: "lower_level", label: "Lower level" },
  { key: "upper_level", label: "Upper level" },
  { key: "outside", label: "Outside" },
];

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function FloorplanRegionsApp() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [activeLevel, setActiveLevel] = useState<string>("lower_level");
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Region | null>(null);
  const [saving, setSaving] = useState(false);

  const imageRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/floorplan-regions", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as ApiResponse);
    } catch {
      toast.error("Could not load floorplan regions.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const roomsForLevel = useMemo(
    () => (data?.rooms ?? []).filter((r) => r.floorplanFloorKey === activeLevel),
    [data, activeLevel],
  );

  const selectedRoom = useMemo(
    () => roomsForLevel.find((r) => r.id === selectedRoomId) ?? null,
    [roomsForLevel, selectedRoomId],
  );

  /** Pointer position as a clamped percent of the floorplan image box. */
  const pctFromEvent = useCallback((e: React.PointerEvent) => {
    const box = imageRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: clamp(((e.clientX - box.left) / box.width) * 100),
      y: clamp(((e.clientY - box.top) / box.height) * 100),
    };
  }, []);

  const saveRegion = useCallback(
    async (roomId: number, region: Region | null) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/floorplan-regions/rooms/${roomId}`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ region }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { room } = (await res.json()) as { room: RoomRegion };
        setData((prev) =>
          prev
            ? { ...prev, rooms: prev.rooms.map((r) => (r.id === room.id ? room : r)) }
            : prev,
        );
        toast.success(region ? "Region saved + cropped." : "Region cleared.");
      } catch {
        toast.error("Save failed — try again.");
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (saving) return; // don't start a new box while a save is in flight
    if (!selectedRoom) {
      toast.info("Pick a room first, then drag its rectangle.");
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pctFromEvent(e);
    dragStart.current = p;
    setDraft({ xPct: p.x, yPct: p.y, wPct: 0, hPct: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const p = pctFromEvent(e);
    const s = dragStart.current;
    setDraft({
      xPct: Math.min(s.x, p.x),
      yPct: Math.min(s.y, p.y),
      wPct: Math.abs(p.x - s.x),
      hPct: Math.abs(p.y - s.y),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const region = draft;
    dragStart.current = null;
    setDraft(null);
    if (!selectedRoom || !region || region.wPct < 0.5 || region.hPct < 0.5) return;
    void saveRegion(selectedRoom.id, region);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Room list */}
      <aside className="space-y-4">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Floor level">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              type="button"
              aria-pressed={activeLevel === l.key}
              onClick={() => {
                setActiveLevel(l.key);
                setSelectedRoomId(null);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                activeLevel === l.key
                  ? "bg-foreground/[0.08] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>

        <ul className="divide-y divide-border/40 rounded-lg bg-card ring-1 ring-border/40">
          {roomsForLevel.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No rooms placed on this level.
            </li>
          ) : (
            roomsForLevel.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedRoomId(r.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition-colors",
                    selectedRoomId === r.id
                      ? "bg-foreground/[0.06] text-foreground"
                      : "text-foreground/90 hover:bg-foreground/[0.03]",
                  )}
                >
                  <span className="truncate">{r.name}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      r.region
                        ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                        : "bg-foreground/[0.06] text-muted-foreground",
                    )}
                  >
                    {r.region ? "region set" : "no region"}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        {selectedRoom ? (
          <div className="space-y-3 rounded-lg bg-card p-4 ring-1 ring-border/40">
            <p className="text-sm font-medium">{selectedRoom.name}</p>
            <p className="text-xs text-muted-foreground">
              Drag a rectangle over this room on the floorplan. It auto-saves and crops.
            </p>
            {selectedRoom.cropUrl ? (
              <img
                src={selectedRoom.cropUrl}
                alt={`${selectedRoom.name} floorplan region`}
                className="w-full rounded-md ring-1 ring-border/40"
              />
            ) : null}
            {selectedRoom.region ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => void saveRegion(selectedRoom.id, null)}
                className="w-full text-muted-foreground hover:text-destructive"
              >
                Clear region
              </Button>
            ) : null}
          </div>
        ) : null}
      </aside>

      {/* Floorplan canvas */}
      <div className="min-w-0">
        <div
          ref={imageRef}
          className="relative w-full touch-none select-none overflow-hidden rounded-lg bg-card ring-1 ring-border/40"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {/* biome-ignore lint/performance/noImgElement: static floorplan asset */}
          <img
            src={data?.floorplanImageUrl ?? ""}
            alt="126 Colby floor plan"
            className="pointer-events-none block w-full"
            draggable={false}
          />

          {/* Existing regions for this level */}
          {roomsForLevel.map((r) =>
            r.region && r.id !== selectedRoomId ? (
              <div
                key={`region-${r.id}`}
                className="pointer-events-none absolute rounded-sm bg-foreground/[0.04] ring-1 ring-border/60"
                style={rectStyle(r.region)}
                title={r.name}
              />
            ) : null,
          )}

          {/* Room dots for this level */}
          {roomsForLevel.map((r) =>
            r.floorplanXPct != null && r.floorplanYPct != null ? (
              <span
                key={`dot-${r.id}`}
                className={cn(
                  "pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background",
                  r.id === selectedRoomId ? "bg-emerald-400" : "bg-foreground/60",
                )}
                style={{ left: `${r.floorplanXPct}%`, top: `${r.floorplanYPct}%` }}
              />
            ) : null,
          )}

          {/* Selected room's saved region (highlighted) */}
          {selectedRoom?.region && !draft ? (
            <div
              className="pointer-events-none absolute rounded-sm bg-emerald-400/10 ring-2 ring-emerald-400/70"
              style={rectStyle(selectedRoom.region)}
            />
          ) : null}

          {/* Live draft rectangle */}
          {draft ? (
            <div
              className="pointer-events-none absolute rounded-sm bg-emerald-400/15 ring-2 ring-emerald-400"
              style={rectStyle(draft)}
            />
          ) : null}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {selectedRoom
            ? "Drag a box over the selected room. Release to save."
            : "Pick a room on the left, then drag its rectangle here."}
        </p>
      </div>
    </div>
  );
}

/** Percent region → absolute-position style. */
function rectStyle(r: Region): React.CSSProperties {
  return {
    left: `${r.xPct}%`,
    top: `${r.yPct}%`,
    width: `${r.wPct}%`,
    height: `${r.hPct}%`,
  };
}
