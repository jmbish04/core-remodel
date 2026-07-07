// ---------------------------------------------------------------------------
// RoomPicker — the roomId-less entry screen. Fetches the room catalog from the
// existing /api/rooms/catalog endpoint (the same source StudioBuilder uses),
// renders Monolith cards grouped by floor, and links each to
// /admin/designs/workshop?roomId=<id>. Left-aligned editorial header, no
// centered hero.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { ArrowRight, DoorOpen } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import type { CatalogFloor } from "./types";

export function RoomPicker() {
  const [floors, setFloors] = useState<CatalogFloor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/rooms/catalog", {
          credentials: "include",
        });
        const payload = (await response.json()) as {
          success?: boolean;
          floors?: Array<{
            id: number;
            key: string;
            name: string;
            rooms?: Array<{
              id: number;
              floorId: number;
              roomCode: string;
              roomName: string;
              displayName: string;
            }>;
          }>;
        };
        if (!response.ok || !payload.success) {
          throw new Error("Couldn’t load your rooms.");
        }
        const normalized: CatalogFloor[] = (payload.floors ?? []).map((floor) => ({
          id: floor.id,
          key: floor.key,
          name: floor.name,
          rooms: (floor.rooms ?? []).map((room) => ({
            ...room,
            floorKey: floor.key,
            floorName: floor.name,
          })),
        }));
        if (!cancelled) setFloors(normalized);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Couldn’t load your rooms.";
        if (!cancelled) setError(message);
        toast.error(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] w-full bg-[hsl(240_10%_4%)] px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-10 max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Design Workshop
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            Your house, room by room — pick where to start
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Each room is its own table. Walk up to one and you’ll find its
            photos, blank canvases, inspiration, and past renders laid out —
            ready to sort, sample, and mix.
          </p>
        </header>

        {loading ? (
          <RoomGridSkeleton />
        ) : error && floors.length === 0 ? (
          <div className="max-w-sm rounded-xl bg-card/60 p-6 ring-1 ring-border/40">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Rooms didn’t load
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{error}</p>
          </div>
        ) : floors.every((f) => f.rooms.length === 0) ? (
          <EmptyRooms />
        ) : (
          <div className="space-y-10">
            {floors
              .filter((floor) => floor.rooms.length > 0)
              .map((floor) => (
                <section key={floor.id}>
                  <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                    {floor.name}
                  </h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {floor.rooms.map((room) => (
                      <a
                        key={room.id}
                        href={`/admin/designs/workshop?roomId=${room.id}`}
                        className={cn(
                          "group flex items-center justify-between gap-3 rounded-xl bg-card/60 p-5 ring-1 ring-border/40 outline-none transition-colors",
                          "hover:bg-card hover:ring-border focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold tracking-tight text-foreground">
                            {room.displayName || room.roomName}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                            {room.roomCode}
                          </div>
                        </div>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </a>
                    ))}
                  </div>
                </section>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RoomGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-[92px] animate-pulse rounded-xl bg-foreground/[0.05]"
        />
      ))}
    </div>
  );
}

function EmptyRooms() {
  return (
    <div className="flex max-w-md flex-col items-start gap-3 rounded-xl bg-card/60 p-8 ring-1 ring-border/40">
      <div className="grid size-11 place-items-center rounded-full bg-foreground/[0.04] ring-1 ring-border/40">
        <DoorOpen className="size-5 text-muted-foreground" />
      </div>
      <h2 className="text-base font-semibold tracking-tight text-foreground">
        No rooms yet
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Add rooms to your floor plan and they’ll show up here, each with its own
        workshop table.
      </p>
      <a
        href="/admin/planning/measure"
        className="mt-1 rounded-md bg-foreground px-3 py-1.5 text-sm text-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open the floor plan
      </a>
    </div>
  );
}

export default RoomPicker;
