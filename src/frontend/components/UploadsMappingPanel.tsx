import { Check, CopyX, Loader2, RefreshCcw, Trash2, XCircle } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MultipleSelector } from "@/components/ui/multiple-selector";
import { LevelRoomSelect } from "@/components/LevelRoomSelect";
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
  const [activeCategory, setActiveCategory] = useState<MappingCategory>("inspirational");
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
  const [hoverRoomId, setHoverRoomId] = useState<number | string | null>(null);
  const [inspirationRoomIds, setInspirationRoomIds] = useState<string[]>([]);
  // The set of in-flight image ids is tracked purely so optimistic apply calls
  // can be cleaned up in `.finally`; the value itself is not read for rendering
  // (per-card spinners are driven by upload-workflow events), hence the `_`.
  const [_applyingImageIds, setApplyingImageIds] = useState<Set<string>>(
    new Set(),
  );
  const debouncedRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [abandoning, setAbandoning] = useState(false);
  const [confirmAbandonOpen, setConfirmAbandonOpen] = useState(false);
  const [abandonTarget, setAbandonTarget] = useState<"selected" | "all" | null>(null);
  const [hasLoadedInitially, setHasLoadedInitially] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [confirmReprocessOpen, setConfirmReprocessOpen] = useState(false);
  const [reprocessTarget, setReprocessTarget] = useState<"selected" | "all" | null>(null);

  const selectedIds = selectedByCategory[activeCategory];
  const pendingImages = pendingByCategory[activeCategory];
  const catalogRooms = useMemo(
    () => catalogFloors.flatMap((floor) => floor.rooms),
    [catalogFloors],
  );

  /**
   * Maps a catalog floor bucket to the scope arguments for `applyMapping`.
   *
   * This is the bucket→scope mapping that fixes the "one photo becomes N rows"
   * bug. The catalog floor ids are the canonical source of truth (so this stays
   * correct even if the DB ids change): for the live DB those are
   * lower_level=1, upper_level=2, outside=233121.
   *
   *   - "All Levels" bucket (floor.key === "all_levels") → scope "home"
   *     (applies to the whole home, no floor id, no per-room rows).
   *   - any real floor bucket ("Lower"/"Upper"/"Outside")  → scope "level" with
   *     that floor's id (no per-room rows).
   *
   * The returned `floorId` is null for home scope (the server requires it only
   * for level scope).
   */
  const floorScopeOptions = useCallback(
    (floor: CatalogFloor): { scope: "level" | "home"; floorId: number | null } =>
      floor.key === "all_levels"
        ? { scope: "home", floorId: null }
        : { scope: "level", floorId: floor.id },
    [],
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

  const refreshData = useCallback(async (silent = false) => {
    const shouldShowLoader = !silent && !hasLoadedInitially;
    if (shouldShowLoader) {
      setLoading(true);
    }
    setStatus("");
    try {
      // On silent refreshes the catalog never changes — skip the extra round-trip.
      // Always fetch summary + both categories in parallel to cut latency.
      const catalogPromise = silent ? Promise.resolve() : fetchCatalog();
      const [, , listing, inspirational] = await Promise.all([
        catalogPromise,
        fetchSummary(),
        fetchPendingForCategory("listing"),
        fetchPendingForCategory("inspirational"),
      ]);
      setPendingByCategory({
        listing,
        inspirational,
      });
      setHasLoadedInitially(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to refresh mapping workspace");
    } finally {
      if (shouldShowLoader) {
        setLoading(false);
      }
    }
  }, [fetchCatalog, fetchPendingForCategory, fetchSummary, hasLoadedInitially]);

  useEffect(() => {
    const isFirstMount = !hasLoadedInitially;
    void refreshData(isFirstMount ? false : true);
  }, [refreshData, refreshToken, hasLoadedInitially]);

  const setSelectedForCategory = useCallback(
    (category: MappingCategory, nextIds: string[]) => {
      setSelectedByCategory((current) => ({
        ...current,
        [category]: nextIds,
      }));
    },
    [],
  );

  const scheduleDebouncedRefresh = useCallback(() => {
    if (debouncedRefreshTimer.current) {
      clearTimeout(debouncedRefreshTimer.current);
    }
    debouncedRefreshTimer.current = setTimeout(() => {
      debouncedRefreshTimer.current = null;
      void refreshData(true);
    }, 600);
  }, [refreshData]);

  useEffect(() => {
    const handleWorkflowProgress = (event: Event) => {
      const customEvent = event as CustomEvent<{
        imageId: string;
        status: UploadProcessingStatus;
        progress: number;
        stepName?: string;
        error?: string;
      }>;
      const payload = customEvent.detail;
      if (!payload || !payload.imageId) {
        return;
      }

      setPendingByCategory((current) => {
        let updated = false;
        const next = { ...current };

        for (const category of ["listing", "inspirational"] as const) {
          const list = next[category];
          const index = list.findIndex((img) => img.id === payload.imageId);
          if (index !== -1) {
            const oldImg = list[index];
            const newImg = {
              ...oldImg,
              processingStatus: payload.status,
              processingError: payload.error || null,
            };
            
            const newList = [...list];
            newList[index] = newImg;
            next[category] = newList;
            updated = true;
          }
        }

        if (updated) {
          return next;
        }
        return current;
      });

      if (payload.status === "processed" || payload.status === "failed") {
        // Use debounced refresh to collapse rapid completions into a single fetch
        scheduleDebouncedRefresh();
      }
    };

    window.addEventListener("image-workflow-progress", handleWorkflowProgress);
    return () => {
      window.removeEventListener("image-workflow-progress", handleWorkflowProgress);
    };
  }, [scheduleDebouncedRefresh]);

  /**
   * Applies a mapping to one or more pending uploads.
   *
   * Listing photos always map to a single room (`roomIds[0]`).
   *
   * Inspirational photos are SCOPE-AWARE (0005 REVISIONS — the fix that stops one
   * "Entire Floor / Entire Home" photo from fanning out into N per-room rows):
   *   - scope "room"  (default) → sends `roomIds` and the server inserts one
   *                                `inspirational_image_rooms` row per active room.
   *   - scope "level"           → sends `{ scope:'level', floorId }` only; the
   *                                server records the scope on the image and does
   *                                NOT create per-room rows. `roomIds` is ignored.
   *   - scope "home"            → sends `{ scope:'home' }` only; applies to the
   *                                whole home with no per-room rows.
   *
   * `scopeOptions` defaults to room scope so existing per-room drop targets keep
   * their behavior; the floor/home drop targets pass an explicit level/home scope.
   */
  const applyMapping = useCallback(
    (
      category: MappingCategory,
      imageIds: string[],
      roomIds: number[],
      scopeOptions: {
        scope?: "room" | "level" | "home";
        floorId?: number | null;
      } = {},
    ) => {
      const scope = scopeOptions.scope ?? "room";
      // Room/level/home each have a different "is this call actionable?" rule:
      //   - room scope needs at least one target room id
      //   - level scope needs a floorId
      //   - home scope needs neither
      const needsRoomIds = category === "listing" || scope === "room";
      const needsFloorId = category === "inspirational" && scope === "level";
      if (imageIds.length === 0) {
        return;
      }
      if (needsRoomIds && roomIds.length === 0) {
        return;
      }
      if (needsFloorId && (scopeOptions.floorId == null)) {
        return;
      }

      const idsSet = new Set(imageIds);

      // 1. Optimistic removal — immediately remove images from the pending list
      const rollbackSnapshot: Record<MappingCategory, PendingImage[]> = {
        listing: [],
        inspirational: [],
      };
      setPendingByCategory((current) => {
        rollbackSnapshot.listing = current.listing;
        rollbackSnapshot.inspirational = current.inspirational;
        return {
          listing:
            category === "listing"
              ? current.listing.filter((img) => !idsSet.has(img.id))
              : current.listing,
          inspirational:
            category === "inspirational"
              ? current.inspirational.filter((img) => !idsSet.has(img.id))
              : current.inspirational,
        };
      });

      // 2. Optimistic summary decrement
      setSummary((current) => {
        const delta = imageIds.length;
        return {
          listing:
            category === "listing"
              ? Math.max(0, current.listing - delta)
              : current.listing,
          inspirational:
            category === "inspirational"
              ? Math.max(0, current.inspirational - delta)
              : current.inspirational,
          total: Math.max(0, current.total - delta),
        };
      });

      // 3. Track in-flight image IDs (for per-card spinners, not panel-level disable)
      setApplyingImageIds((current) => {
        const next = new Set(current);
        for (const id of imageIds) next.add(id);
        return next;
      });

      // 4. Clear drag/selection state immediately
      setSelectedForCategory(
        category,
        selectedByCategory[category].filter((id) => !idsSet.has(id)),
      );
      setDragImageIds([]);
      setHoverRoomId(null);

      // 5. Fire-and-forget API call — no await, no UI blocking
      const payload: Record<string, unknown> = {
        photoCategory: category,
        imageIds,
      };
      if (category === "listing") {
        payload.roomId = roomIds[0];
      } else if (scope === "level") {
        // No fan-out: store the level scope + floor on the image itself.
        payload.scope = "level";
        payload.floorId = scopeOptions.floorId;
      } else if (scope === "home") {
        // No fan-out: store the home scope on the image itself.
        payload.scope = "home";
      } else {
        // Per-room inspiration: one row per selected room.
        payload.scope = "room";
        payload.roomIds = roomIds;
      }

      fetch("/api/images/mapping/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(async (response) => {
          const json = (await response.json()) as {
            success?: boolean;
            error?: string;
          };
          if (!response.ok || !json.success) {
            throw new Error(json.error || "Failed to apply mapping");
          }

          // Success — debounced background refresh to consolidate rapid drops
          scheduleDebouncedRefresh();
          window.dispatchEvent(
            new CustomEvent("image-mapping-summary-updated", {
              detail: { source: "uploads-mapping-panel" },
            }),
          );
        })
        .catch((error: unknown) => {
          // Rollback: restore the optimistically removed images
          setPendingByCategory(rollbackSnapshot);
          // Re-fetch summary to get accurate counts
          void fetchSummary();
          setStatus(
            error instanceof Error ? error.message : "Failed to apply mapping",
          );
        })
        .finally(() => {
          setApplyingImageIds((current) => {
            const next = new Set(current);
            for (const id of imageIds) next.delete(id);
            return next;
          });
        });
    },
    [fetchSummary, scheduleDebouncedRefresh, selectedByCategory, setSelectedForCategory],
  );

  const markAsDuplicate = useCallback(
    async (imageIds: string[]) => {
      if (imageIds.length === 0) return;

      const idsSet = new Set(imageIds);

      // Optimistic removal
      const rollbackSnapshot: Record<MappingCategory, PendingImage[]> = {
        listing: [],
        inspirational: [],
      };
      setPendingByCategory((current) => {
        rollbackSnapshot.listing = current.listing;
        rollbackSnapshot.inspirational = current.inspirational;
        return {
          listing: current.listing.filter((img) => !idsSet.has(img.id)),
          inspirational: current.inspirational.filter((img) => !idsSet.has(img.id)),
        };
      });
      setSummary((current) => ({
        listing: Math.max(0, current.listing - imageIds.filter((id) => rollbackSnapshot.listing.some((img) => img.id === id)).length),
        inspirational: Math.max(0, current.inspirational - imageIds.filter((id) => rollbackSnapshot.inspirational.some((img) => img.id === id)).length),
        total: Math.max(0, current.total - imageIds.length),
      }));
      setSelectedForCategory(activeCategory, selectedByCategory[activeCategory].filter((id) => !idsSet.has(id)));

      try {
        await Promise.all(
          imageIds.map((imageId) =>
            fetch(`/api/images/${imageId}/duplicate`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isDuplicate: true }),
            }).then(async (res) => {
              if (!res.ok) {
                const json = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(json.error || "Failed to mark duplicate");
              }
            }),
          ),
        );
        setStatus(`Marked ${imageIds.length} photo(s) as duplicate.`);
        scheduleDebouncedRefresh();
      } catch (error) {
        setPendingByCategory(rollbackSnapshot);
        void fetchSummary();
        setStatus(error instanceof Error ? error.message : "Failed to mark duplicates");
      }
    },
    [activeCategory, fetchSummary, scheduleDebouncedRefresh, selectedByCategory, setSelectedForCategory],
  );

  const abandonPending = useCallback(
    async (target: "selected" | "all") => {
      const imageIdsToAbandon =
        target === "selected"
          ? selectedIds
          : pendingImages.map((image) => image.id);

      if (imageIdsToAbandon.length === 0) {
        return;
      }

      setAbandoning(true);
      setStatus(`Abandoning ${imageIdsToAbandon.length} photo(s)...`);

      try {
        const response = await fetch("/api/images/mapping/abandon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: imageIdsToAbandon }),
        });
        const json = (await response.json()) as {
          success?: boolean;
          error?: string;
        };
        if (!response.ok || !json.success) {
          throw new Error(json.error || "Failed to abandon photos");
        }

        setStatus(`Abandoned ${imageIdsToAbandon.length} photo(s).`);
        setSelectedForCategory(activeCategory, []);
        await refreshData();
        window.dispatchEvent(
          new CustomEvent("image-mapping-summary-updated", {
            detail: { source: "uploads-mapping-panel" },
          }),
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to abandon photos");
      } finally {
        setAbandoning(false);
        setConfirmAbandonOpen(false);
        setAbandonTarget(null);
      }
    },
    [activeCategory, pendingImages, selectedIds, refreshData, setSelectedForCategory],
  );

  const reprocessPending = useCallback(
    async (target: "selected" | "all") => {
      const imageIdsToReprocess =
        target === "selected"
          ? selectedIds
          : pendingImages.map((image) => image.id);

      if (imageIdsToReprocess.length === 0) {
        return;
      }

      setReprocessing(true);
      setStatus(`Queueing ${imageIdsToReprocess.length} photo(s) for reprocessing...`);

      try {
        const response = await fetch("/api/images/mapping/reprocess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: imageIdsToReprocess }),
        });
        const json = (await response.json()) as {
          success?: boolean;
          error?: string;
        };
        if (!response.ok || !json.success) {
          throw new Error(json.error || "Failed to reprocess photos");
        }

        setStatus(`Reprocessing started for ${imageIdsToReprocess.length} photo(s).`);
        setSelectedForCategory(activeCategory, []);
        await refreshData();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to reprocess photos");
      } finally {
        setReprocessing(false);
        setConfirmReprocessOpen(false);
        setReprocessTarget(null);
      }
    },
    [activeCategory, pendingImages, selectedIds, refreshData, setSelectedForCategory],
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
              disabled={loading}
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
            <LevelRoomSelect
              rooms={catalogRooms}
              value={inspirationRoomIds}
              onChange={setInspirationRoomIds}
              disabled={loading || selectedIds.length === 0}
            />
            <MultipleSelector
              title="Select rooms"
              placeholder="Choose one or more rooms"
              options={catalogRooms.map((room) => ({
                value: String(room.id),
                label: `${room.floorName} • ${room.displayName}`,
              }))}
              value={inspirationRoomIds}
              onValueChange={setInspirationRoomIds}
              disabled={loading || selectedIds.length === 0}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={
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
            </div>
          </div>
        )}
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/10 p-3 ring-1 ring-border/20">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                disabled={loading || abandoning || reprocessing}
                onClick={() => {
                  const allIds = pendingImages.map((img) => img.id);
                  const allSelected = selectedIds.length === pendingImages.length;
                  setSelectedForCategory(activeCategory, allSelected ? [] : allIds);
                }}
              >
                {selectedIds.length === pendingImages.length ? "Deselect All" : "Select All"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="text-xs bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 transition"
                disabled={loading || abandoning || reprocessing || selectedIds.length === 0}
                onClick={() => {
                  setReprocessTarget("selected");
                  setConfirmReprocessOpen(true);
                }}
              >
                <RefreshCcw className="mr-1.5 size-3.5" />
                Reprocess Selected ({selectedIds.length})
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="text-xs text-muted-foreground border-border/60 hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition"
                disabled={loading || abandoning || reprocessing}
                onClick={() => {
                  setReprocessTarget("all");
                  setConfirmReprocessOpen(true);
                }}
              >
                <RefreshCcw className="mr-1.5 size-3.5" />
                Reprocess All
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="text-xs bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 hover:text-red-300 transition"
                disabled={loading || abandoning || reprocessing || selectedIds.length === 0}
                onClick={() => {
                  setAbandonTarget("selected");
                  setConfirmAbandonOpen(true);
                }}
              >
                <Trash2 className="mr-1.5 size-3.5" />
                Abandon Selected ({selectedIds.length})
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20 hover:text-amber-300 transition"
                disabled={loading || abandoning || reprocessing || selectedIds.length === 0}
                onClick={() => void markAsDuplicate(selectedIds)}
              >
                <CopyX className="mr-1.5 size-3.5" />
                Mark Duplicate ({selectedIds.length})
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="text-xs text-muted-foreground border-border/60 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition"
                disabled={loading || abandoning || reprocessing}
                onClick={() => {
                  setAbandonTarget("all");
                  setConfirmAbandonOpen(true);
                }}
              >
                <XCircle className="mr-1.5 size-3.5" />
                Abandon All {activeCategory === "listing" ? "Listing" : "Inspiration"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground font-medium">{selectedCountLabel}</p>
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
                disabled={loading}
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
                      {activeCategory !== "listing" && (
                        <div
                          onDragOver={(event) => {
                            event.preventDefault();
                            setHoverRoomId(`floor-${floor.id}`);
                          }}
                          onDragLeave={() => setHoverRoomId(null)}
                          onDrop={(event) => {
                            event.preventDefault();
                            const ids = dragImageIds.length > 0 ? dragImageIds : selectedIds;
                            setDragImageIds([]);
                            setHoverRoomId(null);
                            if (ids.length === 0) return;
                            // Store the scope on the image (no per-room fan-out).
                            const options = floorScopeOptions(floor);
                            void applyMapping(activeCategory, ids, [], options);
                          }}
                          className={cn(
                            "rounded-md border px-2 py-2 border-dashed transition-colors",
                            hoverRoomId === `floor-${floor.id}`
                              ? "border-primary bg-primary/10"
                              : "border-border/60 bg-muted/30"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <p className="truncate text-xs font-medium italic">
                                {floor.key === "all_levels" ? "Entire Home (All Levels)" : `Entire Floor (${floor.name})`}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              disabled={selectedIds.length === 0 || loading}
                              onClick={() => {
                                // Level/home scope is stored on the image — no
                                // dependency on the floor having any rooms.
                                const options = floorScopeOptions(floor);
                                void applyMapping(
                                  activeCategory,
                                  selectedIds,
                                  [],
                                  options,
                                );
                              }}
                            >
                              Assign selected
                            </Button>
                          </div>
                        </div>
                      )}
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
                              disabled={selectedIds.length === 0 || loading}
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

      <AlertDialog open={confirmAbandonOpen} onOpenChange={setConfirmAbandonOpen}>
        <AlertDialogContent className="ring-1 ring-border/50 max-w-md bg-card/95 backdrop-blur-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold text-red-500 flex items-center gap-2">
              <Trash2 className="size-5 animate-pulse" />
              Abandon Pending Mappings
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {abandonTarget === "selected" ? (
                `Are you sure you want to abandon the ${selectedIds.length} selected pending photo(s)? This will permanently delete their records from the database and remove the files from Cloudflare Images.`
              ) : (
                `Are you sure you want to abandon ALL ${pendingImages.length} pending ${activeCategory} photo(s)? This will permanently delete their records from the database and remove the files from Cloudflare Images.`
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="border-border/60 hover:bg-muted/50" disabled={abandoning}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-500 focus:ring-red-500"
              onClick={(e) => {
                e.preventDefault();
                const target = abandonTarget;
                setConfirmAbandonOpen(false);
                setAbandonTarget(null);
                if (target) void abandonPending(target);
              }}
              disabled={abandoning}
            >
              {abandoning ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Discarding...
                </>
              ) : (
                "Yes, Discard Permanently"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReprocessOpen} onOpenChange={setConfirmReprocessOpen}>
        <AlertDialogContent className="ring-1 ring-border/50 max-w-md bg-card/95 backdrop-blur-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold text-primary flex items-center gap-2">
              <RefreshCcw className="size-5" />
              Reprocess AI Workflows
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground mt-2 leading-relaxed font-medium text-zinc-300">
              {reprocessTarget === "selected" ? (
                `Please confirm you would like to reprocess the AI workflow for the ${selectedIds.length} selected photos.`
              ) : (
                `Please confirm you would like to reprocess the AI workflow for all queued photos.`
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="border-border/60 hover:bg-muted/50" disabled={reprocessing}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary"
              onClick={(e) => {
                e.preventDefault();
                const target = reprocessTarget;
                setConfirmReprocessOpen(false);
                setReprocessTarget(null);
                if (target) void reprocessPending(target);
              }}
              disabled={reprocessing}
            >
              {reprocessing ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Reprocessing...
                </>
              ) : (
                "Confirm Reprocess"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
