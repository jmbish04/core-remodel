import { ArrowUpRight, Image as ImageIcon, Loader2, MapPinned, RefreshCw, Sparkles } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type FloorKey = "lower_level" | "upper_level";

interface CatalogRoom {
  id: number;
  floorId: number;
  floorKey: FloorKey;
  floorName: string;
  roomCode: string;
  roomName: string;
  displayName: string;
}

interface CatalogFloor {
  id: number;
  key: FloorKey;
  name: string;
  levelOrder: number;
  rooms: CatalogRoom[];
}

interface ImageRecord {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  roomId?: number | null;
  roomIds?: number[];
  roomLabels?: string[];
  datetimeCreated?: string | number | Date | null;
}

interface RoomCoordinate {
  floorKey: FloorKey;
  xPct: number;
  yPct: number;
}

const FLOORPLAN_IMAGE_SRC = "/floorplans/126colby-listing-floorplan.jpg";

const ROOM_COORDINATES_BY_CODE: Record<string, RoomCoordinate> = {
  "lower-patio": { floorKey: "lower_level", xPct: 27, yPct: 10 },
  "lower-family-room": { floorKey: "lower_level", xPct: 18, yPct: 34 },
  "lower-bedroom-1": { floorKey: "lower_level", xPct: 33, yPct: 28 },
  "lower-bath-1": { floorKey: "lower_level", xPct: 34, yPct: 43 },
  "lower-laundry": { floorKey: "lower_level", xPct: 26, yPct: 49 },
  "lower-storage": { floorKey: "lower_level", xPct: 34, yPct: 52 },
  "lower-garage": { floorKey: "lower_level", xPct: 25, yPct: 77 },
  "lower-entryway": { floorKey: "lower_level", xPct: 7, yPct: 89 },
  "upper-bedroom-2": { floorKey: "upper_level", xPct: 64, yPct: 21 },
  "upper-primary-bedroom": { floorKey: "upper_level", xPct: 82, yPct: 21 },
  "upper-bath-1": { floorKey: "upper_level", xPct: 64, yPct: 37 },
  "upper-lightwell": { floorKey: "upper_level", xPct: 67, yPct: 39 },
  "upper-bedroom-3": { floorKey: "upper_level", xPct: 66, yPct: 52 },
  "upper-bath-2": { floorKey: "upper_level", xPct: 88, yPct: 39 },
  "upper-kitchen-breakfast": { floorKey: "upper_level", xPct: 70, yPct: 76 },
  "upper-living-dining": { floorKey: "upper_level", xPct: 84, yPct: 72 },
  "upper-workshop": { floorKey: "upper_level", xPct: 78, yPct: 49 },
  "upper-deck": { floorKey: "upper_level", xPct: 82, yPct: 92 },
};

function resolveImageUrl(image: ImageRecord): string {
  const candidate = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!candidate) return "";
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  if (candidate.includes("/")) {
    return `https://imagedelivery.net/${candidate}/public`;
  }
  return `https://imagedelivery.net/${candidate}/public`;
}

function formatDate(value: ImageRecord["datetimeCreated"]): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString();
}

export function FloorplanGalleryApp() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [floors, setFloors] = useState<CatalogFloor[]>([]);
  const [listingImages, setListingImages] = useState<ImageRecord[]>([]);
  const [inspirationalImages, setInspirationalImages] = useState<ImageRecord[]>([]);
  const [selectedFloor, setSelectedFloor] = useState<FloorKey>("lower_level");

  const fetchData = useCallback(async (setLoadingState: boolean) => {
    if (setLoadingState) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [catalogRes, listingRes, inspirationRes] = await Promise.all([
        fetch("/api/rooms/catalog"),
        fetch("/api/images?photoCategory=listing"),
        fetch("/api/images?photoCategory=inspirational"),
      ]);

      const catalogPayload = (await catalogRes.json()) as {
        success?: boolean;
        floors?: Array<{
          id: number;
          key: FloorKey;
          name: string;
          levelOrder: number;
          rooms?: Array<{
            id: number;
            floorId: number;
            roomCode: string;
            roomName: string;
            displayName: string;
          }>;
        }>;
      };
      const listingPayload = (await listingRes.json()) as {
        success?: boolean;
        images?: ImageRecord[];
      };
      const inspirationPayload = (await inspirationRes.json()) as {
        success?: boolean;
        images?: ImageRecord[];
      };

      if (!catalogRes.ok || !catalogPayload.success) {
        throw new Error("Failed to load room catalog");
      }
      if (!listingRes.ok || !listingPayload.success) {
        throw new Error("Failed to load listing photos");
      }
      if (!inspirationRes.ok || !inspirationPayload.success) {
        throw new Error("Failed to load inspiration photos");
      }

      const nextFloors: CatalogFloor[] = (catalogPayload.floors || []).map((floor) => ({
        id: floor.id,
        key: floor.key,
        name: floor.name,
        levelOrder: floor.levelOrder,
        rooms: (floor.rooms || []).map((room) => ({
          ...room,
          floorKey: floor.key,
          floorName: floor.name,
        })),
      }));

      setFloors(nextFloors);
      setListingImages((listingPayload.images || []).filter((image) => Boolean(image.roomId)));
      setInspirationalImages(inspirationPayload.images || []);

      if (!nextFloors.some((floor) => floor.key === selectedFloor)) {
        setSelectedFloor(nextFloors[0]?.key || "lower_level");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load gallery");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedFloor]);

  useEffect(() => {
    void fetchData(true);
  }, [fetchData]);

  useEffect(() => {
    const onGlobalUploadComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{ target?: string }>;
      if (customEvent.detail?.target === "images") {
        void fetchData(false);
      }
    };

    window.addEventListener("global-upload-complete", onGlobalUploadComplete);
    return () => {
      window.removeEventListener("global-upload-complete", onGlobalUploadComplete);
    };
  }, [fetchData]);

  const rooms = useMemo(() => floors.flatMap((floor) => floor.rooms), [floors]);
  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);

  const listingByRoomId = useMemo(() => {
    const map = new Map<number, ImageRecord[]>();
    for (const image of listingImages) {
      if (!image.roomId) continue;
      const next = map.get(image.roomId) || [];
      next.push(image);
      map.set(image.roomId, next);
    }
    return map;
  }, [listingImages]);

  const inspirationByRoomId = useMemo(() => {
    const map = new Map<number, ImageRecord[]>();
    for (const image of inspirationalImages) {
      for (const roomId of image.roomIds || []) {
        const next = map.get(roomId) || [];
        next.push(image);
        map.set(roomId, next);
      }
    }
    return map;
  }, [inspirationalImages]);

  const floorRooms = useMemo(
    () => floors.find((floor) => floor.key === selectedFloor)?.rooms || [],
    [floors, selectedFloor],
  );

  const dotRooms = useMemo(
    () =>
      floorRooms
        .map((room) => ({
          room,
          coordinate: ROOM_COORDINATES_BY_CODE[room.roomCode],
          listingCount: (listingByRoomId.get(room.id) || []).length,
          inspirationCount: (inspirationByRoomId.get(room.id) || []).length,
        }))
        .filter((entry) => entry.coordinate && entry.coordinate.floorKey === selectedFloor),
    [floorRooms, inspirationByRoomId, listingByRoomId, selectedFloor],
  );

  const inspirationHighlights = useMemo(() => {
    const currentRoomIds = new Set(floorRooms.map((room) => room.id));
    return inspirationalImages
      .filter((image) => (image.roomIds || []).some((roomId) => currentRoomIds.has(roomId)))
      .slice(0, 10);
  }, [floorRooms, inspirationalImages]);

  if (loading) {
    return (
      <div className="flex min-h-[50svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-3 size-5 animate-spin" />
        Loading floorplan gallery...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Listing Floorplan</CardTitle>
                <CardDescription>Each room dot opens the dedicated room view</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-md border border-border/60 bg-muted/20 p-1">
                  <button
                    type="button"
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium",
                      selectedFloor === "lower_level"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground",
                    )}
                    onClick={() => setSelectedFloor("lower_level")}
                  >
                    Lower
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium",
                      selectedFloor === "upper_level"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground",
                    )}
                    onClick={() => setSelectedFloor("upper_level")}
                  >
                    Upper
                  </button>
                </div>
                <Button variant="outline" size="sm" onClick={() => void fetchData(false)} disabled={refreshing}>
                  {refreshing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
                  Refresh
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative overflow-hidden rounded-xl border border-border/50 bg-muted/20">
              {/* biome-ignore lint/performance/noImgElement: static floorplan from public assets */}
              <img
                src={FLOORPLAN_IMAGE_SRC}
                alt="126 Colby listing floorplan"
                className="h-auto w-full object-contain"
              />

              {dotRooms.map(({ room, coordinate, listingCount, inspirationCount }) => (
                <a
                  key={`dot-${room.id}`}
                  href={`/rooms/${room.roomCode}`}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white px-1.5 py-0.5 text-[10px] font-semibold text-white shadow transition hover:scale-105",
                    listingCount > 0 ? "bg-emerald-600" : inspirationCount > 0 ? "bg-amber-500" : "bg-muted-foreground/80",
                  )}
                  style={{ left: `${coordinate.xPct}%`, top: `${coordinate.yPct}%` }}
                  title={`${room.displayName}: ${listingCount} listing, ${inspirationCount} inspiration`}
                >
                  {listingCount}
                </a>
              ))}
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              Dot labels show listing-photo counts. Open a room to see listing, inspiration, budget, summary, and supporting records together.
            </p>
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Rooms on {selectedFloor === "lower_level" ? "Lower Level" : "Upper Level"}</CardTitle>
            <CardDescription>Open a room portal from the floor you are reviewing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {floorRooms.map((room) => {
              const listing = listingByRoomId.get(room.id) || [];
              const inspiration = inspirationByRoomId.get(room.id) || [];
              const preview = listing[0] || inspiration[0] || null;
              return (
                <a
                  key={room.id}
                  href={`/rooms/${room.roomCode}`}
                  className="block rounded-xl border border-border/60 bg-card/40 p-3 transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/20"
                >
                  <div className="flex gap-3">
                    {preview ? (
                      // biome-ignore lint/performance/noImgElement: external delivery urls are expected
                      <img
                        src={resolveImageUrl(preview)}
                        alt={preview.displayName || room.displayName}
                        className="h-20 w-24 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-20 w-24 items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20">
                        <ImageIcon className="size-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{room.displayName}</p>
                          <p className="text-xs text-muted-foreground">{room.roomCode}</p>
                        </div>
                        <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={listing.length > 0 ? "default" : "secondary"}>
                          {listing.length} listing
                        </Badge>
                        <Badge variant={inspiration.length > 0 ? "default" : "secondary"}>
                          {inspiration.length} inspiration
                        </Badge>
                      </div>
                    </div>
                  </div>
                </a>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Inspiration Highlights</CardTitle>
          <CardDescription>
            Current floor inspiration that can be reviewed alongside room-specific listing context
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inspirationHighlights.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
              No inspiration photos are linked to rooms on this floor yet.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {inspirationHighlights.map((image) => {
                const roomId = (image.roomIds || [])[0] || null;
                const room = roomId ? roomById.get(roomId) || null : null;
                return (
                  <a
                    key={image.id}
                    href={room ? `/rooms/${room.roomCode}` : "/floor-plan"}
                    className="block overflow-hidden rounded-xl border border-border/60 bg-card/40 transition hover:-translate-y-0.5 hover:border-primary/40"
                  >
                    {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
                    <img
                      src={resolveImageUrl(image)}
                      alt={image.displayName || room?.displayName || "Inspiration photo"}
                      className="aspect-[4/3] w-full object-cover"
                    />
                    <div className="space-y-1 p-3">
                      <p className="truncate text-sm font-semibold">
                        {image.displayName?.trim() || room?.displayName || "Inspiration"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {room?.displayName || "Room mapping pending"} • {formatDate(image.datetimeCreated)}
                      </p>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Room Launch Board</CardTitle>
          <CardDescription>
            Gallery overview for both listing and inspiration photos, grouped by room portal
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {floors.map((floor) => (
            <section key={floor.id} className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  {floor.name}
                </h3>
                <Badge variant="secondary">{floor.rooms.length} rooms</Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {floor.rooms.map((room) => {
                  const listing = listingByRoomId.get(room.id) || [];
                  const inspiration = inspirationByRoomId.get(room.id) || [];
                  const preview = listing[0] || inspiration[0] || null;
                  return (
                    <a
                      key={room.id}
                      href={`/rooms/${room.roomCode}`}
                      className="block overflow-hidden rounded-2xl border border-border/60 bg-card/40 transition hover:-translate-y-0.5 hover:border-primary/40"
                    >
                      {preview ? (
                        // biome-ignore lint/performance/noImgElement: external delivery urls are expected
                        <img
                          src={resolveImageUrl(preview)}
                          alt={preview.displayName || room.displayName}
                          className="aspect-[4/3] w-full object-cover"
                        />
                      ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-muted/20">
                          <Sparkles className="size-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">{room.displayName}</p>
                            <p className="text-xs text-muted-foreground">{room.roomCode}</p>
                          </div>
                          <ArrowUpRight className="size-4 text-muted-foreground" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={listing.length > 0 ? "default" : "secondary"}>
                            {listing.length} listing
                          </Badge>
                          <Badge variant={inspiration.length > 0 ? "default" : "secondary"}>
                            {inspiration.length} inspiration
                          </Badge>
                        </div>
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
