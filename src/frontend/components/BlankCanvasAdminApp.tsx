import {
  Building2,
  Check,
  Eraser,
  Image,
  Loader2,
  Upload,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CatalogFloor {
  id: number;
  key: string;
  name: string;
  rooms: CatalogRoom[];
}

interface CatalogRoom {
  id: number;
  floorId: number;
  floorKey: string;
  floorName: string;
  roomCode: string;
  roomName: string;
  displayName: string;
}

interface ImageRecord {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  roomId?: number | null;
  roomLabels?: string[];
  roomType?: string | null;
  metadata?: string | null;
  photoCategory?: string | null;
  listingPhoto?: {
    id: number;
    roomId?: number | null;
    roomName?: string | null;
    description?: string | null;
    blankCanvasCfImageId?: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveImageUrl(image: ImageRecord): string {
  const deliveryId = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!deliveryId) return "";
  if (deliveryId.startsWith("http://") || deliveryId.startsWith("https://")) {
    return deliveryId;
  }
  if (deliveryId.includes("/")) {
    return `https://imagedelivery.net/${deliveryId}/public`;
  }
  const metadata = parseMetadata(image.metadata);
  if (metadata.deliveryUrl) {
    return metadata.deliveryUrl;
  }
  return `https://imagedelivery.net/${deliveryId}/public`;
}

function parseMetadata(raw: string | null | undefined): { deliveryUrl?: string } {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as { deliveryUrl?: string };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlankCanvasAdminApp() {
  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [floors, setFloors] = useState<CatalogFloor[]>([]);
  const [uploadingIds, setUploadingIds] = useState<Set<number>>(new Set());
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [imagesRes, catalogRes] = await Promise.all([
        fetch("/api/images?isListingPhoto=true"),
        fetch("/api/rooms/catalog"),
      ]);

      const imagesData = (await imagesRes.json()) as {
        success?: boolean;
        images?: ImageRecord[];
      };
      const catalogData = (await catalogRes.json()) as {
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

      if (imagesData.success && Array.isArray(imagesData.images)) {
        setImages(imagesData.images);
      }

      if (catalogData.success && Array.isArray(catalogData.floors)) {
        setFloors(
          catalogData.floors.map((floor) => ({
            id: floor.id,
            key: floor.key,
            name: floor.name,
            rooms: Array.isArray(floor.rooms)
              ? floor.rooms.map((room) => ({
                  ...room,
                  floorKey: floor.key,
                  floorName: floor.name,
                }))
              : [],
          })),
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load data",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // -----------------------------------------------------------------------
  // Derived: listing photos without blank canvas, grouped by floor → room
  // -----------------------------------------------------------------------

  const needsCanvas = useMemo(() => {
    const listingImages = images.filter(
      (img) =>
        img.photoCategory === "listing" &&
        (!img.listingPhoto || !img.listingPhoto.blankCanvasCfImageId),
    );

    const groups: Array<{
      floor: CatalogFloor;
      rooms: Array<{ room: CatalogRoom; images: ImageRecord[] }>;
    }> = [];

    for (const floor of floors) {
      const roomGroups: Array<{ room: CatalogRoom; images: ImageRecord[] }> =
        [];
      for (const room of floor.rooms) {
        const matched = listingImages.filter((img) => {
          if (img.roomId === room.id) return true;
          if (
            Array.isArray(img.roomLabels) &&
            img.roomLabels.includes(room.roomName)
          )
            return true;
          return false;
        });
        if (matched.length > 0) {
          roomGroups.push({ room, images: matched });
        }
      }
      if (roomGroups.length > 0) {
        groups.push({ floor, rooms: roomGroups });
      }
    }

    // Catch unmatched
    const matchedIds = new Set(
      groups.flatMap((g) =>
        g.rooms.flatMap((r) => r.images.map((i) => i.id)),
      ),
    );
    const unmatched = listingImages.filter((img) => !matchedIds.has(img.id));

    return { groups, unmatched };
  }, [images, floors]);

  const totalNeedsCanvas = useMemo(() => {
    return (
      needsCanvas.groups.reduce(
        (sum, g) => sum + g.rooms.reduce((s, r) => s + r.images.length, 0),
        0,
      ) + needsCanvas.unmatched.length
    );
  }, [needsCanvas]);

  const totalWithCanvas = useMemo(() => {
    return images.filter(
      (img) =>
        img.photoCategory === "listing" &&
        img.listingPhoto?.blankCanvasCfImageId,
    ).length;
  }, [images]);

  // -----------------------------------------------------------------------
  // Upload handler
  // -----------------------------------------------------------------------

  const handleUpload = useCallback(
    async (listingPhotoId: number, file: File) => {
      setUploadingIds((prev) => new Set(prev).add(listingPhotoId));
      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(
          `/api/listing-photos/${listingPhotoId}/blank-canvas`,
          { method: "POST", body: formData },
        );

        const data = (await response.json()) as {
          success: boolean;
          error?: string;
        };
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Upload failed");
        }

        setCompletedIds((prev) => new Set(prev).add(listingPhotoId));
        toast.success("Blank canvas uploaded");

        // Refresh data after a short delay so the row disappears
        setTimeout(() => {
          void loadData();
        }, 1500);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to upload blank canvas",
        );
      } finally {
        setUploadingIds((prev) => {
          const next = new Set(prev);
          next.delete(listingPhotoId);
          return next;
        });
      }
    },
    [loadData],
  );

  // -----------------------------------------------------------------------
  // Render: photo card row
  // -----------------------------------------------------------------------

  const renderPhotoRow = useCallback(
    (image: ImageRecord) => {
      const listingPhoto = image.listingPhoto;
      if (!listingPhoto) return null;
      const isUploading = uploadingIds.has(listingPhoto.id);
      const isCompleted = completedIds.has(listingPhoto.id);
      const inputId = `blank-canvas-upload-${listingPhoto.id}`;

      return (
        <div
          key={image.id}
          className={cn(
            "group flex w-full items-center gap-4 rounded-lg border border-border/40 bg-card p-3 ring-1 ring-border/20 transition-colors",
            isCompleted && "border-emerald-500/30 bg-emerald-500/5 ring-emerald-500/20",
          )}
        >
          {/* Thumbnail */}
          <div className="relative size-16 shrink-0 overflow-hidden rounded-md border border-border/40 bg-muted">
            {/* biome-ignore lint/performance/noImgElement: CF Images URL */}
            <img
              src={resolveImageUrl(image)}
              alt={image.displayName || "Listing photo"}
              className="size-full object-cover"
            />
          </div>

          {/* Details */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {image.displayName || image.roomType || "Untitled photo"}
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              {listingPhoto.roomName && (
                <span className="text-xs text-muted-foreground">
                  {listingPhoto.roomName}
                </span>
              )}
              {listingPhoto.description && (
                <span className="max-w-[200px] truncate text-xs text-muted-foreground/60">
                  {listingPhoto.description}
                </span>
              )}
            </div>
          </div>

          {/* Upload action */}
          <div className="shrink-0">
            {isCompleted ? (
              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1">
                <Check className="size-3" />
                Uploaded
              </Badge>
            ) : (
              <>
                <Input
                  type="file"
                  accept="image/*"
                  id={inputId}
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    await handleUpload(listingPhoto.id, file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs font-medium"
                  onClick={() =>
                    document.getElementById(inputId)?.click()
                  }
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="size-3.5" />
                      Upload Canvas
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      );
    },
    [completedIds, handleUpload, uploadingIds],
  );

  // -----------------------------------------------------------------------
  // Render: room group
  // -----------------------------------------------------------------------

  const renderRoomGroup = useCallback(
    (roomGroup: { room: CatalogRoom; images: ImageRecord[] }) => (
      <div key={roomGroup.room.id} className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {roomGroup.room.displayName}
          </p>
          <Badge variant="secondary" className="text-[10px]">
            {roomGroup.images.length} photo{roomGroup.images.length !== 1 ? "s" : ""}
          </Badge>
        </div>
        <div className="space-y-2">
          {roomGroup.images.map(renderPhotoRow)}
        </div>
      </div>
    ),
    [renderPhotoRow],
  );

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
        <Loader2 className="size-4 animate-spin" />
        Loading listing photos...
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Stats summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card className="ring-1 ring-border/20">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Needs Canvas</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-amber-400">
              {totalNeedsCanvas}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="ring-1 ring-border/20">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Has Canvas</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-emerald-400">
              {totalWithCanvas}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="ring-1 ring-border/20">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Total Listing</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {totalNeedsCanvas + totalWithCanvas}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Empty state */}
      {totalNeedsCanvas === 0 && (
        <Card className="ring-1 ring-border/20">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
            <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
              <Check className="size-6 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-foreground">
              All listing photos have a blank canvas paired!
            </p>
            <p className="text-xs text-muted-foreground">
              {totalWithCanvas} blank canvas image{totalWithCanvas !== 1 ? "s" : ""} uploaded.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Floor tabs — only show when there are photos needing canvas */}
      {totalNeedsCanvas > 0 && (
        <Tabs defaultValue={needsCanvas.groups[0]?.floor.key || "unassigned"}>
          <TabsList>
            {needsCanvas.groups.map((floorGroup) => (
              <TabsTrigger key={floorGroup.floor.key} value={floorGroup.floor.key}>
                <Building2 className="mr-1.5 size-3.5" />
                {floorGroup.floor.name}
                <Badge
                  variant="secondary"
                  className="ml-1.5 text-[10px] tabular-nums"
                >
                  {floorGroup.rooms.reduce(
                    (sum, r) => sum + r.images.length,
                    0,
                  )}
                </Badge>
              </TabsTrigger>
            ))}
            {needsCanvas.unmatched.length > 0 && (
              <TabsTrigger value="unassigned">
                <Image className="mr-1.5 size-3.5" />
                Unassigned
                <Badge
                  variant="secondary"
                  className="ml-1.5 text-[10px] tabular-nums"
                >
                  {needsCanvas.unmatched.length}
                </Badge>
              </TabsTrigger>
            )}
          </TabsList>

          {needsCanvas.groups.map((floorGroup) => (
            <TabsContent
              key={floorGroup.floor.key}
              value={floorGroup.floor.key}
              className="space-y-6 pt-4"
            >
              {floorGroup.rooms.map(renderRoomGroup)}
            </TabsContent>
          ))}

          {needsCanvas.unmatched.length > 0 && (
            <TabsContent value="unassigned" className="space-y-2 pt-4">
              {needsCanvas.unmatched.map(renderPhotoRow)}
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
