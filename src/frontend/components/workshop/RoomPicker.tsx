// ---------------------------------------------------------------------------
// RoomPicker — the roomId-less entry screen (Slice-1 feedback #1).
//
// Justin: "the workshop landing should be the floorplan selector interface from
// /floor-plan — the user still sees a room list, but can pick the room ON the
// floorplan." So this mirrors FloorplanGalleryApp's DATA FETCH exactly (the same
// enriched `GET /api/rooms/catalog`, with the /api/images backfill) and renders
// the same real listing floorplan image with the same reusable `FloorplanDot`
// markers. The one difference from /floor-plan: every affordance here navigates
// INTO the Workshop (`?roomId=<id>`) instead of `/rooms/{code}`.
//
// Layout: two-column on desktop (plan left, room list right), stacked on mobile.
// The room list mirrors LevelSidebar's grouping (Lower/Upper switch + an
// Outside/Unplaced group) so rooms without coordinates stay reachable. Editorial
// left-aligned header stays; skeletons (not spinners) cover the load.
// ---------------------------------------------------------------------------

import { ArrowRight, DoorOpen, ImageIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { FloorplanDot } from "@/components/floorplan/FloorplanDot";
import {
  getRoomStatus,
  type CatalogFloor,
  type CatalogRoom,
  type ResolvedRoom,
  type SidebarLevel,
} from "@/components/floorplan/types";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Same static asset the /floor-plan page uses (lower + upper, side by side). */
const FLOORPLAN_IMAGE_SRC = "/floorplans/126colby-listing-floorplan.jpg";

/** Where a picked room goes: straight into its Workshop table. */
function workshopHref(roomId: number): string {
  return `/admin/designs/workshop?roomId=${roomId}`;
}

/** Minimal shape of an image record from `/api/images` (fallback path only). */
interface ImageRecord {
  id: string;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  roomId?: number | null;
  roomIds?: number[];
}

function resolveImageUrl(image: ImageRecord): string {
  const candidate = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!candidate) return "";
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  return `https://imagedelivery.net/${candidate}/public`;
}

function isOutsideOrUnplaced(room: CatalogRoom): boolean {
  const key = room.floorplanFloorKey;
  if (key === "lower_level" || key === "upper_level") {
    return room.floorplanXPct === null || room.floorplanYPct === null;
  }
  return true;
}

export function RoomPicker() {
  const [floors, setFloors] = useState<CatalogFloor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<SidebarLevel>("lower_level");

  // Fallback aggregates (used only if the catalog omits enrichment).
  const [heroUrlByRoomId, setHeroUrlByRoomId] = useState<Map<number, string>>(
    () => new Map(),
  );
  const [listingCountByRoomId, setListingCountByRoomId] = useState<
    Map<number, number>
  >(() => new Map());
  const [inspirationCountByRoomId, setInspirationCountByRoomId] = useState<
    Map<number, number>
  >(() => new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Mirror FloorplanGalleryApp: catalog is authoritative; the image lists
        // backfill counts/hero if a deploy briefly serves an un-enriched catalog.
        const [catalogRes, listingRes, inspirationRes] = await Promise.all([
          fetch("/api/rooms/catalog", { credentials: "include" }),
          fetch("/api/images?photoCategory=listing", { credentials: "include" }),
          fetch("/api/images?photoCategory=inspirational", {
            credentials: "include",
          }),
        ]);

        const catalogPayload = (await catalogRes.json()) as {
          success?: boolean;
          floors?: CatalogFloor[];
        };
        if (!catalogRes.ok || !catalogPayload.success) {
          throw new Error("Couldn't load your rooms.");
        }

        const nextFloors: CatalogFloor[] = (catalogPayload.floors ?? []).map(
          (floor) => ({
            id: floor.id,
            key: floor.key,
            name: floor.name,
            levelOrder: floor.levelOrder,
            rooms: floor.rooms ?? [],
          }),
        );

        const nextHero = new Map<number, string>();
        const nextListing = new Map<number, number>();
        const nextInspiration = new Map<number, number>();

        if (listingRes.ok) {
          const payload = (await listingRes.json()) as {
            images?: ImageRecord[];
          };
          for (const image of payload.images ?? []) {
            if (!image.roomId) continue;
            nextListing.set(
              image.roomId,
              (nextListing.get(image.roomId) ?? 0) + 1,
            );
            if (!nextHero.has(image.roomId)) {
              const url = resolveImageUrl(image);
              if (url) nextHero.set(image.roomId, url);
            }
          }
        }
        if (inspirationRes.ok) {
          const payload = (await inspirationRes.json()) as {
            images?: ImageRecord[];
          };
          for (const image of payload.images ?? []) {
            for (const roomId of image.roomIds ?? []) {
              nextInspiration.set(
                roomId,
                (nextInspiration.get(roomId) ?? 0) + 1,
              );
              if (!nextHero.has(roomId)) {
                const url = resolveImageUrl(image);
                if (url) nextHero.set(roomId, url);
              }
            }
          }
        }

        if (!cancelled) {
          setFloors(nextFloors);
          setHeroUrlByRoomId(nextHero);
          setListingCountByRoomId(nextListing);
          setInspirationCountByRoomId(nextInspiration);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Couldn't load your rooms.";
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

  const allRooms = useMemo<CatalogRoom[]>(
    () => floors.flatMap((floor) => floor.rooms),
    [floors],
  );

  const resolvedRooms = useMemo<ResolvedRoom[]>(
    () =>
      allRooms.map((room) => {
        const listingCount =
          typeof room.listingCount === "number"
            ? room.listingCount
            : (listingCountByRoomId.get(room.id) ?? 0);
        const inspirationCount =
          typeof room.inspirationCount === "number"
            ? room.inspirationCount
            : (inspirationCountByRoomId.get(room.id) ?? 0);
        const heroImageUrl =
          room.heroImageUrl !== undefined
            ? (room.heroImageUrl ?? null)
            : (heroUrlByRoomId.get(room.id) ?? null);
        return {
          room,
          listingCount,
          inspirationCount,
          heroImageUrl,
          dimensions: room.dimensions ?? null,
          sqft: typeof room.sqft === "number" ? room.sqft : null,
        } satisfies ResolvedRoom;
      }),
    [
      allRooms,
      listingCountByRoomId,
      inspirationCountByRoomId,
      heroUrlByRoomId,
    ],
  );

  /** Only rooms with real coordinates get a dot — both levels at once. */
  const dotRooms = useMemo(
    () =>
      resolvedRooms.filter(
        (entry) =>
          entry.room.floorplanXPct !== null &&
          entry.room.floorplanYPct !== null,
      ),
    [resolvedRooms],
  );

  /** Partition rooms into the sidebar list buckets (mirrors LevelSidebar). */
  const { levelRooms, outsideRooms } = useMemo(() => {
    const lower: ResolvedRoom[] = [];
    const upper: ResolvedRoom[] = [];
    const outside: ResolvedRoom[] = [];
    for (const entry of resolvedRooms) {
      if (isOutsideOrUnplaced(entry.room)) outside.push(entry);
      else if (entry.room.floorplanFloorKey === "lower_level")
        lower.push(entry);
      else upper.push(entry);
    }
    return {
      levelRooms: level === "lower_level" ? lower : upper,
      outsideRooms: outside,
    };
  }, [resolvedRooms, level]);

  const select = useCallback((roomId: number) => {
    window.location.assign(workshopHref(roomId));
  }, []);

  const isUpper = level === "upper_level";
  const noRooms = !loading && !error && allRooms.length === 0;

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
            Tap a room on the plan, or pick it from the list. You’ll land at its
            table — photos, blank canvases, inspiration, and samples laid out and
            ready to mix.
          </p>
        </header>

        {loading ? (
          <PickerSkeleton />
        ) : error && floors.length === 0 ? (
          <div className="max-w-sm rounded-xl bg-card/60 p-6 ring-1 ring-border/40">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Rooms didn’t load
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{error}</p>
          </div>
        ) : noRooms ? (
          <EmptyRooms />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {/* Plan (left on desktop). */}
            <section aria-label="Floor plan room selector">
              <div className="relative overflow-hidden rounded-xl bg-muted/20 ring-1 ring-border/40">
                {/* biome-ignore lint/performance/noImgElement: static floorplan asset */}
                <img
                  src={FLOORPLAN_IMAGE_SRC}
                  alt="126 Colby listing floor plan, lower and upper levels"
                  className="h-auto w-full select-none object-contain"
                  draggable={false}
                />
                {dotRooms.map((entry) => {
                  const status = getRoomStatus(
                    entry.listingCount,
                    entry.inspirationCount,
                  );
                  return (
                    <FloorplanDot
                      key={entry.room.id}
                      xPct={entry.room.floorplanXPct as number}
                      yPct={entry.room.floorplanYPct as number}
                      status={status}
                      listingCount={entry.listingCount}
                      label={`Open ${entry.room.displayName} in the Workshop — ${entry.listingCount} listing, ${entry.inspirationCount} inspiration`}
                      onClick={() => select(entry.room.id)}
                    />
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <LegendSwatch className="bg-emerald-600" label="Has listing photos" />
                <LegendSwatch className="bg-amber-500" label="Inspiration only" />
                <LegendSwatch
                  className="bg-muted-foreground/80"
                  label="No photos yet"
                />
              </div>
            </section>

            {/* Room list (right on desktop, below on mobile). */}
            <section
              aria-label="Room list"
              className="rounded-xl bg-card/40 p-4 ring-1 ring-border/40"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  Rooms
                </h2>
                <div
                  className="flex items-center gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5"
                  role="group"
                  aria-label="Floor level"
                >
                  <Label
                    htmlFor="workshop-level-switch"
                    className={cn(
                      "cursor-pointer text-xs font-medium transition-colors",
                      !isUpper ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    Lower
                  </Label>
                  <Switch
                    id="workshop-level-switch"
                    checked={isUpper}
                    onCheckedChange={(checked) =>
                      setLevel(checked ? "upper_level" : "lower_level")
                    }
                    aria-label={`Show ${isUpper ? "upper" : "lower"} level rooms`}
                  />
                  <Label
                    htmlFor="workshop-level-switch"
                    className={cn(
                      "cursor-pointer text-xs font-medium transition-colors",
                      isUpper ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    Upper
                  </Label>
                </div>
              </div>

              <div className="mt-4 space-y-5">
                <RoomListGroup
                  title={isUpper ? "Upper Level" : "Lower Level"}
                  rooms={levelRooms}
                  onSelect={select}
                  emptyMessage={`No rooms recorded on the ${
                    isUpper ? "upper" : "lower"
                  } level yet.`}
                />
                {outsideRooms.length > 0 ? (
                  <RoomListGroup
                    title="Outside / Unplaced"
                    rooms={outsideRooms}
                    onSelect={select}
                  />
                ) : null}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function RoomListGroup({
  title,
  rooms,
  onSelect,
  emptyMessage,
}: {
  title: string;
  rooms: ResolvedRoom[];
  onSelect: (roomId: number) => void;
  emptyMessage?: string;
}) {
  return (
    <section className="space-y-3" aria-label={`${title} rooms`}>
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {title}
        </h3>
        <Badge variant="secondary">{rooms.length}</Badge>
      </div>
      {rooms.length === 0 ? (
        <p className="rounded-xl bg-background/40 px-4 py-6 text-center text-xs text-muted-foreground ring-1 ring-border/40">
          {emptyMessage ?? "No rooms here yet."}
        </p>
      ) : (
        <ul className="space-y-2">
          {rooms.map((entry) => (
            <li key={entry.room.id}>
              <button
                type="button"
                onClick={() => onSelect(entry.room.id)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl bg-card/40 p-2.5 text-left ring-1 ring-border/40 outline-none transition",
                  "hover:bg-muted/20 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {entry.heroImageUrl ? (
                  // biome-ignore lint/performance/noImgElement: external delivery urls
                  <img
                    src={entry.heroImageUrl}
                    alt=""
                    className="size-12 shrink-0 rounded-lg object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted/20 ring-1 ring-border/40">
                    <ImageIcon
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold tracking-tight text-foreground">
                    {entry.room.displayName || entry.room.roomName}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {entry.room.roomCode}
                    </span>
                    <Badge
                      variant={entry.listingCount > 0 ? "default" : "secondary"}
                    >
                      {entry.listingCount} listing
                    </Badge>
                  </div>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LegendSwatch({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-block size-2.5 rounded-full ring-1 ring-white/80",
          className,
        )}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function PickerSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="aspect-[16/9] w-full animate-pulse rounded-xl bg-foreground/[0.05]" />
      <div className="space-y-2 rounded-xl bg-card/40 p-4 ring-1 ring-border/40">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-[68px] animate-pulse rounded-xl bg-foreground/[0.05]"
          />
        ))}
      </div>
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
