import { Image as ImageIcon, Loader2, MapPinned } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ImageGallery } from "@/components/ui/image-gallery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type FloorKey = "lower_level" | "upper_level";

interface CatalogRoom {
  id: number;
  floorId: number;
  floorKey: string;
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

interface ListingImage {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  metadata?: string | null;
  roomId?: number | null;
  roomType?: string | null;
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

function resolveImageUrl(image: ListingImage): string {
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

function formatDate(value: ListingImage["datetimeCreated"]): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString();
}

export function FloorplanGalleryApp() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [floors, setFloors] = useState<CatalogFloor[]>([]);
  const [listingImages, setListingImages] = useState<ListingImage[]>([]);
  const [selectedFloor, setSelectedFloor] = useState<FloorKey>("lower_level");
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);

  const fetchData = useCallback(async (setLoadingState: boolean) => {
    if (setLoadingState) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [catalogRes, listingRes] = await Promise.all([
        fetch("/api/rooms/catalog"),
        fetch("/api/images?photoCategory=listing"),
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
        images?: ListingImage[];
      };

      if (!catalogRes.ok || !catalogPayload.success) {
        throw new Error("Failed to load room catalog");
      }
      if (!listingRes.ok || !listingPayload.success) {
        throw new Error("Failed to load listing photos");
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

      if (!nextFloors.some((floor) => floor.key === selectedFloor)) {
        setSelectedFloor(nextFloors[0]?.key || "lower_level");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load gallery data");
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
      const customEvent = event as CustomEvent<{ target?: string; isListingPhoto?: boolean }>;
      if (customEvent.detail?.target === "images" && customEvent.detail?.isListingPhoto === true) {
        void fetchData(false);
      }
    };

    window.addEventListener("global-upload-complete", onGlobalUploadComplete);
    return () => {
      window.removeEventListener("global-upload-complete", onGlobalUploadComplete);
    };
  }, [fetchData]);

  const rooms = useMemo(
    () => floors.flatMap((floor) => floor.rooms),
    [floors],
  );

  const roomById = useMemo(
    () => new Map(rooms.map((room) => [room.id, room])),
    [rooms],
  );

  const listingByRoomId = useMemo(() => {
    const map = new Map<number, ListingImage[]>();
    for (const image of listingImages) {
      if (!image.roomId) continue;
      const next = map.get(image.roomId) || [];
      next.push(image);
      map.set(image.roomId, next);
    }
    for (const entries of map.values()) {
      entries.sort((a, b) => {
        const aTs = new Date(a.datetimeCreated || 0).getTime();
        const bTs = new Date(b.datetimeCreated || 0).getTime();
        return bTs - aTs;
      });
    }
    return map;
  }, [listingImages]);

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
        }))
        .filter((entry) => entry.coordinate && entry.coordinate.floorKey === selectedFloor),
    [floorRooms, selectedFloor],
  );

  const fallbackSelectedRoomId = useMemo(() => {
    const firstWithPhotos = floorRooms.find((room) => (listingByRoomId.get(room.id) || []).length > 0);
    return firstWithPhotos?.id || floorRooms[0]?.id || null;
  }, [floorRooms, listingByRoomId]);

  useEffect(() => {
    if (!selectedRoomId || !floorRooms.some((room) => room.id === selectedRoomId)) {
      setSelectedRoomId(fallbackSelectedRoomId);
    }
  }, [fallbackSelectedRoomId, floorRooms, selectedRoomId]);

  const selectedRoom = selectedRoomId ? roomById.get(selectedRoomId) || null : null;
  const selectedRoomImages = selectedRoomId ? listingByRoomId.get(selectedRoomId) || [] : [];

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Floorplan Gallery</h2>
          <p className="text-sm text-muted-foreground">
            Start from the plan, click a room dot, and review all listing photos for that room.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchData(false)} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <MapPinned className="mr-2 size-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Listing Floorplan</CardTitle>
                <CardDescription>Interactive room markers on the listing 2D plan</CardDescription>
              </div>
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

              {dotRooms.map(({ room, coordinate }) => {
                const count = (listingByRoomId.get(room.id) || []).length;
                const active = room.id === selectedRoomId;
                return (
                  <button
                    key={`dot-${room.id}`}
                    type="button"
                    onClick={() => setSelectedRoomId(room.id)}
                    className={cn(
                      "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 px-1.5 py-0.5 text-[10px] font-semibold shadow",
                      active
                        ? "border-white bg-blue-600 text-white"
                        : count > 0
                          ? "border-white bg-emerald-600 text-white"
                          : "border-white bg-muted-foreground/80 text-background",
                    )}
                    style={{ left: `${coordinate.xPct}%`, top: `${coordinate.yPct}%` }}
                    title={`${room.displayName} (${count} photo${count === 1 ? "" : "s"})`}
                  >
                    {count}
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              Dot labels show listing photo count per room on this floor.
            </p>
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Rooms on {selectedFloor === "lower_level" ? "Lower Level" : "Upper Level"}</CardTitle>
            <CardDescription>Select a room to preview its listing set</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {floorRooms.map((room) => {
              const count = (listingByRoomId.get(room.id) || []).length;
              const selected = room.id === selectedRoomId;
              return (
                <button
                  key={`room-selector-${room.id}`}
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left",
                    selected ? "border-primary bg-primary/10" : "border-border/60 hover:bg-muted/20",
                  )}
                  onClick={() => setSelectedRoomId(room.id)}
                >
                  <span className="truncate text-sm font-medium">{room.displayName}</span>
                  <Badge variant={count > 0 ? "default" : "secondary"}>{count}</Badge>
                </button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle>{selectedRoom ? selectedRoom.displayName : "Room Photos"}</CardTitle>
          <CardDescription>
            {selectedRoomImages.length} listing photo{selectedRoomImages.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {selectedRoomImages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center">
              <ImageIcon className="mx-auto mb-2 size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No listing photos are mapped to this room yet.</p>
            </div>
          ) : (
            <ImageGallery
              items={selectedRoomImages.map((image) => ({
                id: image.id,
                src: resolveImageUrl(image),
                title: image.displayName?.trim() || selectedRoom?.displayName || "Listing photo",
                subtitle: formatDate(image.datetimeCreated),
                badge: selectedRoom?.displayName || "",
              }))}
            />
          )}
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">All Listing Groups</CardTitle>
          <CardDescription>Room and floor grouped listing overview</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {floors.map((floor) => (
            <section key={`floor-groups-${floor.id}`} className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {floor.name}
              </h3>
              <div className="space-y-4">
                {floor.rooms.map((room) => {
                  const roomImages = listingByRoomId.get(room.id) || [];
                  return (
                    <div key={`room-group-${room.id}`} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{room.displayName}</p>
                        <Badge variant={roomImages.length > 0 ? "default" : "secondary"}>
                          {roomImages.length}
                        </Badge>
                      </div>
                      {roomImages.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No listing photos mapped.</p>
                      ) : (
                        <ImageGallery
                          items={roomImages.map((image) => ({
                            id: image.id,
                            src: resolveImageUrl(image),
                            title: image.displayName?.trim() || room.displayName,
                            subtitle: formatDate(image.datetimeCreated),
                          }))}
                          columnsClassName="grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
                        />
                      )}
                    </div>
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
