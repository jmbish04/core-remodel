/**
 * @fileoverview Interactive footprint dot-map for the renovation viewport.
 *
 * Renders a vector-style blueprint canvas with absolute-positioned hotspot pins
 * for each renovating room. Hover surfaces a popover with allocation; click
 * fires `onSelectRoomViewport`. Pure Tailwind hover — no Popover primitive
 * required.
 */

import { ArrowRight, Home } from "lucide-react";

export interface FloorPlanRoomDot {
  roomId: number;
  roomName: string;
  /** CSS percentage string, e.g. "32%" */
  coordinateX: string;
  /** CSS percentage string, e.g. "60%" */
  coordinateY: string;
  isRenovating: boolean;
  activeBudgetCents: number;
}

interface InteractiveFloorPlanProps {
  rooms: FloorPlanRoomDot[];
  onSelectRoomViewport: (roomId: number) => void;
}

export function InteractiveFloorPlan({
  rooms,
  onSelectRoomViewport,
}: InteractiveFloorPlanProps) {
  return (
    <div className="space-y-4 rounded-2xl bg-card/20 p-6 text-foreground ring-1 ring-border/30">
      <div className="flex items-center justify-between border-b border-border/10 pb-3">
        <div className="space-y-0.5">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
            <Home className="size-4 text-muted-foreground" />
            Footprint mission map
          </h2>
          <p className="text-xs font-light text-muted-foreground">
            Select a highlighted node to drill into a specific room viewport.
          </p>
        </div>
      </div>

      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-zinc-950 ring-1 ring-border/20">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] bg-[size:24px_24px] opacity-[0.03]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/20">
            Structural layout blueprint
          </span>
        </div>

        {rooms.map((room) => {
          if (!room.isRenovating) {
            return null;
          }
          return (
            <button
              key={room.roomId}
              type="button"
              className="group absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
              style={{ top: room.coordinateY, left: room.coordinateX }}
              onClick={() => onSelectRoomViewport(room.roomId)}
            >
              <span className="absolute inline-flex size-5 animate-ping rounded-full bg-primary/40 opacity-75" />
              <span className="relative size-3.5 rounded-full bg-primary ring-2 ring-background transition-transform group-hover:scale-125" />
              <div className="absolute bottom-full left-1/2 z-30 mb-2 hidden min-w-[140px] -translate-x-1/2 rounded-lg bg-zinc-900 p-2 text-left shadow-2xl ring-1 ring-border/60 group-hover:block">
                <p className="text-xs font-bold leading-none text-foreground">
                  {room.roomName}
                </p>
                <p className="pt-1 text-[10px] text-muted-foreground">
                  Allocation: ${(room.activeBudgetCents / 100).toLocaleString()}
                </p>
                <div className="mt-1.5 flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                  Enter viewport <ArrowRight className="size-2.5" />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4">
        {rooms.map((room) => (
          <button
            key={room.roomId}
            type="button"
            onClick={() => onSelectRoomViewport(room.roomId)}
            className="flex flex-col justify-between rounded-lg bg-background/40 p-2 text-left text-xs ring-1 ring-border/20 transition-all hover:ring-border/60"
          >
            <span className="font-medium leading-tight text-foreground">
              {room.roomName}
            </span>
            <span className="pt-0.5 text-[10px] text-muted-foreground">
              ${(room.activeBudgetCents / 100).toLocaleString()}
            </span>
          </button>
        ))}
        {rooms.length === 0 && (
          <p className="col-span-full px-2 py-6 text-center text-xs italic text-muted-foreground">
            No rooms registered yet — add a room to start mapping the footprint.
          </p>
        )}
      </div>
    </div>
  );
}
