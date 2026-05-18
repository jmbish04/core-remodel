import { Check, Loader2, RefreshCcw } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MultipleSelector } from "@/components/ui/multiple-selector";
import {
  SelectablePhotoCards,
  type SelectablePhotoCardItem,
  type SelectablePhotoCardsDragStartPayload,
} from "@/components/ui/selectable-photo-cards";
import {
  getTrackedUploadLabel,
  type UploadProcessingStatus,
} from "@/lib/image-upload-tracking";
import { cn } from "@/lib/utils";

type MappingCategory = "listing" | "inspirational";

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
  roomName: string;
  displayName: string;
}

interface MappingSummary {
  listing: number;
  inspirational: number;
  total: number;
}

interface PendingImage {
  id: string;
  displayName: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized: string | null;
  photoCategory: MappingCategory;
  roomId?: number | null;
  roomType: string | null;
  roomIds: number[];
  roomLabels: string[];
  pendingSince?: string | number | Date | null;
  deliveryUrl?: string | null;
  processingStatus?: UploadProcessingStatus | null;
  workflowInstanceId?: string | null;
  processingError?: string | null;
  processedAt?: string | number | Date | null;
}

interface UploadsMappingPanelProps {
  refreshToken?: number;
  onSummaryChange?: (summary: MappingSummary) => void;
}

function resolveImageUrl(image: PendingImage): string | null {
  if (image.deliveryUrl && image.deliveryUrl.startsWith("http")) {
    return image.deliveryUrl;
  }
  const candidate = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!candidate) {
    return null;
  }
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  if (candidate.includes("/")) {
    return `https://imagedelivery.net/${candidate}/public`;
  }
  return null;
}

export function UploadsMappingPanel(props: UploadsMappingPanelProps) {
  const { refreshToken = 0, onSummaryChange } = props;
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [activeCategory, setActiveCategory] = useState<MappingCategory>("listing");
  const [summary, setSummary] = useState<MappingSummary>({
    listing: 0,
    inspirational: 0,
    total: 0,
  });
  const [pendingByCategory, setPendingByCategory] = useState<
    Record<MappingCategory, PendingImage[]>
  >({
    listing: [],
    inspirational: [],
  });
  const [catalogFloors, setCatalogFloors] = useState<CatalogFloor[]>([]);
  const [selectedByCategory, setSelectedByCategory] = useState<
    Record<MappingCategory, string[]>
  >({
    listing: [],
    inspirational: [],
  });
  const [dragImageIds, setDragImageIds] = useState<string[]>([]);
  const [hoverRoomId, setHoverRoomId] = useState<number | null>(null);
  const [inspirationRoomIds, setInspirationRoomIds] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);

  const selectedIds = selectedByCategory[activeCategory];
  const pendingImages = pendingByCategory[activeCategory];
  const catalogRooms = useMemo(
    () => catalogFloors.flatMap((floor) => floor.rooms),
    [catalogFloors],
  );
  const hasActiveProcessing = useMemo(
    () =>
      Object.values(pendingByCategory).some((images) =>
        images.some(
          (image) =>
            image.processingStatus === "queued" || image.processingStatus === "processing",
        ),
      ),
    [pendingByCategory],
  );
  const roomPendingCounts = useMemo(() => {
    const counts = new Map<number, number>();

    for (const category of ["listing", "inspirational"] as const) {
      for (const image of pendingByCategory[category]) {
        const mappedRoomIds = new Set<number>();
        if (typeof image.roomId === "number") {
          mappedRoomIds.add(image.roomId);
        }
        for (const roomId of image.roomIds) {
          mappedRoomIds.add(roomId);
        }
        for (const roomId of mappedRoomIds) {
          counts.set(roomId, (counts.get(roomId) || 0) + 1);
        }
      }
    }

    return counts;
  }, [pendingByCategory]);

  const fetchCatalog = useCallback(async () => {
    const response = await fetch("/api/rooms/catalog");
    const payload = (await response.json()) as {
      success?: boolean;
      floors?: Array<{
        id: number;
        key: string;
        name: string;
        rooms?: Array<{
          id: number;
          floorId: number;
          roomName: string;
          displayName: string;
        }>;
      }>;
    };

    if (!response.ok || !payload.success) {
      throw new Error("Failed to load room catalog");
    }

    const normalized = (payload.floors || []).map((floor) => ({
      id: floor.id,
      key: floor.key,
      name: floor.name,
      rooms: (floor.rooms || []).map((room) => ({
        ...room,
        floorKey: floor.key,
        floorName: floor.name,
      })),
    }));

    setCatalogFloors(normalized);
  }, []);

  const fetchSummary = useCallback(async () => {
    const response = await fetch("/api/images/mapping/summary");
    const payload = (await response.json()) as {
      success?: boolean;
      pending?: MappingSummary;
    };
    if (!response.ok || !payload.success || !payload.pending) {
      throw new Error("Failed to load mapping summary");
    }
    setSummary(payload.pending);
    onSummaryChange?.(payload.pending);
  }, [onSummaryChange]);

  const fetchPendingForCategory = useCallback(async (category: MappingCategory) => {
    const query = new URLSearchParams({ photoCategory: category });
    const response = await fetch(`/api/images/mapping/pending?${query.toString()}`);
    const payload = (await response.json()) as {
      success?: boolean;
      images?: PendingImage[];
    };
    if (!response.ok || !payload.success) {
      throw new Error(`Failed to load ${category} pending mappings`);
    }
    return payload.images || [];
  }, []);

  const refreshData = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      await fetchCatalog();
      await fetchSummary();
      const [listing, inspirational] = await Promise.all([
        fetchPendingForCategory("listing"),
        fetchPendingForCategory("inspirational"),
      ]);
      setPendingByCategory({
        listing,
        inspirational,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to refresh mapping workspace");
    } finally {
      setLoading(false);
    }
  }, [fetchCatalog, fetchPendingForCategory, fetchSummary]);

  useEffect(() => {
    void refreshData();
  }, [refreshData, refreshToken]);

  useEffect(() => {
    if (!hasActiveProcessing || applying) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshData();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [applying, hasActiveProcessing, refreshData]);

  const setSelectedForCategory = useCallback(
    (category: MappingCategory, nextIds: string[]) => {
      setSelectedByCategory((current) => ({
        ...current,
        [category]: nextIds,
      }));
    },
    [],
  );

  const applyMapping = useCallback(
    async (category: MappingCategory, imageIds: string[], roomIds: number[]) => {
      if (imageIds.length === 0 || roomIds.length === 0) {
        return;
      }

      setApplying(true);
      setStatus(
        category === "listing"
          ? `Assigning ${imageIds.length} listing photo(s)...`
          : `Assigning ${imageIds.length} inspiration photo(s)...`,
      );

      try {
        const payload: Record<string, unknown> = {
          photoCategory: category,
          imageIds,
        };
        if (category === "listing") {
          payload.roomId = roomIds[0];
        } else {
          payload.roomIds = roomIds;
        }

        const response = await fetch("/api/images/mapping/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = (await response.json()) as {
          success?: boolean;
          error?: string;
        };
        if (!response.ok || !json.success) {
          throw new Error(json.error || "Failed to apply mapping");
        }

        setStatus(`Mapped ${imageIds.length} photo(s).`);
        setSelectedForCategory(category, []);
        setDragImageIds([]);
        setHoverRoomId(null);
        if (category === "inspirational") {
          setInspirationRoomIds([]);
        }
        await refreshData();
        window.dispatchEvent(
          new CustomEvent("image-mapping-summary-updated", {
            detail: { source: "uploads-mapping-panel" },
          }),
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to apply mapping");
      } finally {
        setApplying(false);
      }
    },
    [refreshData, setSelectedForCategory],
  );

  const startDrag = useCallback(
    (
      event: React.DragEvent<HTMLButtonElement>,
      payload: SelectablePhotoCardsDragStartPayload,
    ) => {
      setDragImageIds(payload.selectedIds);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", payload.selectedIds.join(","));
    },
    [],
  );

  const selectedCountLabel =
    selectedIds.length === 1
      ? "1 photo selected"
      : `${selectedIds.length} photos selected`;
  const pendingCardItems = useMemo<SelectablePhotoCardItem[]>(() => {
    return pendingImages.map((image) => {
      const statusLabel = image.processingStatus
        ? getTrackedUploadLabel(image.processingStatus)
        : undefined;
      const statusTone: SelectablePhotoCardItem["statusTone"] =
        image.processingStatus === "processed"
          ? "success"
          : image.processingStatus === "failed"
            ? "danger"
            : image.processingStatus === "processing"
              ? "info"
              : image.processingStatus === "queued"
                ? "warning"
                : "default";
      const detailText =
        image.processingStatus === "failed" && image.processingError
          ? image.processingError
          : image.processingStatus === "processing"
            ? "Workers AI is still analyzing this image."
            : image.processingStatus === "queued"
              ? "Waiting for workflow execution."
              : undefined;

      return {
        id: image.id,
        title: image.displayName || "Untitled photo",
        imageUrl: resolveImageUrl(image),
        alt: image.displayName || "Pending upload",
        subtitle: image.pendingSince
          ? `Queued ${new Date(image.pendingSince).toLocaleString()}`
          : "Queued recently",
        statusLabel,
        statusTone,
        detailText,
        detailTone:
          image.processingStatus === "failed"
            ? "danger"
            : image.processingStatus === "processing"
              ? "info"
              : image.processingStatus === "queued"
                ? "warning"
                : "default",
      };
    });
  }, [pendingImages]);

  return (
    <Card className="ring-1 ring-border/40">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Pending Room Mapping</CardTitle>
            <CardDescription>
              Upload first, then bulk-map photos to rooms with faster review controls.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={summary.total > 0 ? "destructive" : "secondary"}>
              {summary.total} pending
            </Badge>
            {hasActiveProcessing ? (
              <Badge variant="secondary">AI processing active</Badge>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshData()}
              disabled={loading || applying}
            >
              {loading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 size-4" />
              )}
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2">
          <button
            type="button"
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition",
              activeCategory === "listing"
                ? "border-primary bg-primary/10"
                : "border-border/60 hover:bg-muted/30",
            )}
            onClick={() => setActiveCategory("listing")}
          >
            <p className="text-sm font-semibold">Listing Mapping</p>
            <p className="text-xs text-muted-foreground">
              {summary.listing} listing photo(s) pending
            </p>
          </button>
          <button
            type="button"
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition",
              activeCategory === "inspirational"
                ? "border-primary bg-primary/10"
                : "border-border/60 hover:bg-muted/30",
            )}
            onClick={() => setActiveCategory("inspirational")}
          >
            <p className="text-sm font-semibold">Inspiration Mapping</p>
            <p className="text-xs text-muted-foreground">
              {summary.inspirational} inspiration photo(s) pending
            </p>
          </button>
        </div>

        {activeCategory === "inspirational" && (
          <div className="space-y-2 rounded-lg bg-muted/20 p-3 ring-1 ring-border/30">
            <p className="text-sm font-medium">
              Multi-room apply for selected inspiration photos
            </p>
            <MultipleSelector
              title="Select rooms"
              placeholder="Choose one or more rooms"
              options={catalogRooms.map((room) => ({
                value: String(room.id),
                label: `${room.floorName} • ${room.displayName}`,
              }))}
              value={inspirationRoomIds}
              onValueChange={setInspirationRoomIds}
              disabled={applying || loading || selectedIds.length === 0}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={
                  applying ||
                  loading ||
                  selectedIds.length === 0 ||
                  inspirationRoomIds.length === 0
                }
                onClick={() =>
                  void applyMapping(
                    "inspirational",
                    selectedIds,
                    inspirationRoomIds.map((value) => Number(value)),
                  )
                }
              >
                <Check className="mr-2 size-4" />
                Apply Rooms to Selected
              </Button>
              <p className="text-xs text-muted-foreground">{selectedCountLabel}</p>
            </div>
          </div>
        )}

        {pendingImages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center">
            <p className="text-sm font-medium">No pending {activeCategory} photos</p>
            <p className="text-xs text-muted-foreground">
              Upload more photos to populate this mapping queue.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <p className="text-sm font-medium">Pending photos ({pendingImages.length})</p>
              <SelectablePhotoCards
                items={pendingCardItems}
                selectedIds={selectedIds}
                onSelectedIdsChange={(nextIds) => setSelectedForCategory(activeCategory, nextIds)}
                onDragStart={startDrag}
                onDragEnd={() => {
                  setDragImageIds([]);
                  setHoverRoomId(null);
                }}
                disabled={applying || loading}
                gridClassName="max-h-[34rem] overflow-y-auto pr-1"
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Drop zone: rooms by floor</p>
              <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                {catalogFloors.map((floor) => (
                  <section key={floor.id} className="space-y-2 rounded-lg border border-border/40 p-2">
                    <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {floor.name}
                    </h4>
                    <div className="space-y-1.5">
                      {floor.rooms.map((room) => (
                        <div
                          key={room.id}
                          onDragOver={(event) => {
                            event.preventDefault();
                            setHoverRoomId(room.id);
                          }}
                          onDragLeave={() => setHoverRoomId(null)}
                          onDrop={(event) => {
                            event.preventDefault();
                            const ids = dragImageIds.length > 0 ? dragImageIds : selectedIds;
                            setDragImageIds([]);
                            setHoverRoomId(null);
                            if (ids.length === 0) {
                              return;
                            }
                            const roomIds =
                              activeCategory === "listing" ? [room.id] : [room.id];
                            void applyMapping(activeCategory, ids, roomIds);
                          }}
                          className={cn(
                            "rounded-md border px-2 py-2",
                            hoverRoomId === room.id
                              ? "border-primary bg-primary/10"
                              : "border-border/40 bg-background/70",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <p className="truncate text-xs font-medium">{room.displayName}</p>
                              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {roomPendingCounts.get(room.id) || 0} queued
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              disabled={selectedIds.length === 0 || applying || loading}
                              onClick={() =>
                                void applyMapping(activeCategory, selectedIds, [room.id])
                              }
                            >
                              Assign selected
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        )}

        {status && <p className="text-sm text-muted-foreground">{status}</p>}
      </CardContent>
    </Card>
  );
}
