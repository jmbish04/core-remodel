/**
 * @fileoverview FloorplanGalleryApp.tsx
 *
 * Floor-plan page root (feature 0005, Phase 2). This component is now ONLY a
 * data-loader + layout shell; all presentation lives in the `./floorplan/*`
 * submodules (`FloorplanDot`, `RoomHoverCard`, `LevelSidebar`).
 *
 * Behavior (per IMPLEMENTATION_PLAN §6 and TASKS T2.2–T2.7):
 *   1. Loads the enriched room catalog (`GET /api/rooms/catalog`) which carries
 *      per-room coordinates, listing/inspiration counts, hero image url, and
 *      dimensions/sqft — so dots and hover cards need no per-room follow-up.
 *   2. Renders EVERY placed room's dot for BOTH levels simultaneously over the
 *      single side-by-side floorplan image. Coordinates come from the DB; there
 *      is no hardcoded coordinate map. Rooms with null coordinates render no dot.
 *   3. Hovering a dot shows its room card; clicking/tapping a dot PINS the card
 *      sticky until dismissed or another dot is clicked (single-pin model held
 *      here as `pinnedRoomId`).
 *   4. The Lower/Upper control lives in the right sidebar as a Switch and only
 *      filters which interior level's rooms the sidebar lists — it never reloads
 *      and never changes dot visibility.
 *   5. The former "Inspiration Highlights" and "Room Launch Board" cards are
 *      removed (T2.6).
 *   6. Layout is responsive from base → sm → lg (T2.7): the floorplan scales and
 *      the sidebar stacks below on small screens; dots stay tappable and the
 *      hover card becomes a tap-to-open popover on touch.
 *
 * Resilience: the catalog enrichment (T2.1) lands in parallel. If a deploy briefly
 * serves a catalog WITHOUT counts/hero, this component backfills those from the
 * existing `/api/images` endpoints so the page never regresses. In steady state
 * the catalog values are authoritative and the image fetches just confirm them.
 *
 * Error channel: failures surface via `sonner` toasts (the project's established
 * client error surface) and are logged to the console for diagnostics. No data is
 * mocked — an empty/failed load shows real empty/error states.
 */

import { Loader2, MapPinned, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  LevelSidebar,
  RoomHoverCard,
  type CatalogFloor,
  type CatalogRoom,
  type ResolvedRoom,
  type SidebarLevel,
} from "@/components/floorplan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Static floorplan asset: lower + upper levels rendered side by side. */
const FLOORPLAN_IMAGE_SRC = "/floorplans/126colby-listing-floorplan.jpg";

/** Minimal shape of an image record from `/api/images` (fallback path only). */
interface ImageRecord {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  roomId?: number | null;
  roomIds?: number[];
}

/** Resolve an image record to a Cloudflare Images delivery URL (fallback path). */
function resolveImageUrl(image: ImageRecord): string {
  const candidate = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!candidate) return "";
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  return `https://imagedelivery.net/${candidate}/public`;
}

/**
 * Format a dimension string from raw feet/inches parts. Used ONLY when the
 * catalog does not already provide a formatted `dimensions` value. Mirrors the
 * server-side `15'0" x 24'10"` format.
 */
function formatDimensionsFallback(room: CatalogRoom): string | null {
  const { lengthFeet, lengthInches, widthFeet, widthInches } = room;
  const hasLength = typeof lengthFeet === "number" || typeof lengthInches === "number";
  const hasWidth = typeof widthFeet === "number" || typeof widthInches === "number";
  if (!hasLength || !hasWidth) return null;
  const part = (feet?: number | null, inches?: number | null) => `${feet ?? 0}'${inches ?? 0}"`;
  return `${part(lengthFeet, lengthInches)} x ${part(widthFeet, widthInches)}`;
}

/**
 * Compute integer square footage from raw parts. Used ONLY when the catalog does
 * not provide `sqft`.
 */
function computeSqftFallback(room: CatalogRoom): number | null {
  const { lengthFeet, lengthInches, widthFeet, widthInches } = room;
  const hasLength = typeof lengthFeet === "number" || typeof lengthInches === "number";
  const hasWidth = typeof widthFeet === "number" || typeof widthInches === "number";
  if (!hasLength || !hasWidth) return null;
  const length = (lengthFeet ?? 0) + (lengthInches ?? 0) / 12;
  const width = (widthFeet ?? 0) + (widthInches ?? 0) / 12;
  const area = Math.round(length * width);
  return area > 0 ? area : null;
}

export function FloorplanGalleryApp() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errored, setErrored] = useState(false);
  const [floors, setFloors] = useState<CatalogFloor[]>([]);

  // Fallback aggregates (only populated/used when the catalog omits enrichment).
  const [listingCountByRoomId, setListingCountByRoomId] = useState<Map<number, number>>(
    () => new Map(),
  );
  const [inspirationCountByRoomId, setInspirationCountByRoomId] = useState<Map<number, number>>(
    () => new Map(),
  );
  const [heroUrlByRoomId, setHeroUrlByRoomId] = useState<Map<number, string>>(() => new Map());

  // UI state.
  const [selectedLevel, setSelectedLevel] = useState<SidebarLevel>("lower_level");
  const [pinnedRoomId, setPinnedRoomId] = useState<number | null>(null);

  /**
   * Load the catalog (authoritative) plus the image lists (fallback aggregates).
   * `setLoadingState` distinguishes the initial blocking load from a soft refresh.
   */
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
        floors?: CatalogFloor[];
      };

      if (!catalogRes.ok || !catalogPayload.success) {
        throw new Error("Failed to load room catalog");
      }

      const nextFloors: CatalogFloor[] = (catalogPayload.floors || []).map((floor) => ({
        id: floor.id,
        key: floor.key,
        name: floor.name,
        levelOrder: floor.levelOrder,
        rooms: floor.rooms || [],
      }));
      setFloors(nextFloors);
      setErrored(false);

      // Build fallback aggregates from the image endpoints. These are cheap and
      // keep the page correct if the catalog enrichment hasn't shipped yet. They
      // are ignored per-room whenever the catalog already supplies the value.
      const nextListingCount = new Map<number, number>();
      const nextInspirationCount = new Map<number, number>();
      const nextHeroUrl = new Map<number, string>();

      if (listingRes.ok) {
        const listingPayload = (await listingRes.json()) as {
          success?: boolean;
          images?: ImageRecord[];
        };
        for (const image of listingPayload.images || []) {
          if (!image.roomId) continue;
          nextListingCount.set(image.roomId, (nextListingCount.get(image.roomId) || 0) + 1);
          if (!nextHeroUrl.has(image.roomId)) {
            const url = resolveImageUrl(image);
            if (url) nextHeroUrl.set(image.roomId, url);
          }
        }
      }

      if (inspirationRes.ok) {
        const inspirationPayload = (await inspirationRes.json()) as {
          success?: boolean;
          images?: ImageRecord[];
        };
        for (const image of inspirationPayload.images || []) {
          for (const roomId of image.roomIds || []) {
            nextInspirationCount.set(roomId, (nextInspirationCount.get(roomId) || 0) + 1);
            // Inspiration is a last-resort hero only if no listing hero exists.
            if (!nextHeroUrl.has(roomId)) {
              const url = resolveImageUrl(image);
              if (url) nextHeroUrl.set(roomId, url);
            }
          }
        }
      }

      setListingCountByRoomId(nextListingCount);
      setInspirationCountByRoomId(nextInspirationCount);
      setHeroUrlByRoomId(nextHeroUrl);
    } catch (error) {
      console.error("[FloorplanGalleryApp] load failed", error);
      setErrored(true);
      toast.error(error instanceof Error ? error.message : "Failed to load floor plan");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void fetchData(true);
  }, [fetchData]);

  // Soft-refresh when a global upload completes for images.
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

  /** Flatten every room across all floors. */
  const allRooms = useMemo<CatalogRoom[]>(() => floors.flatMap((floor) => floor.rooms), [floors]);

  /**
   * Resolve every room into a view-model, preferring catalog enrichment and
   * falling back to the image-endpoint aggregates only when a field is absent.
   */
  const resolvedRooms = useMemo<ResolvedRoom[]>(
    () =>
      allRooms.map((room) => {
        const listingCount =
          typeof room.listingCount === "number"
            ? room.listingCount
            : listingCountByRoomId.get(room.id) || 0;
        const inspirationCount =
          typeof room.inspirationCount === "number"
            ? room.inspirationCount
            : inspirationCountByRoomId.get(room.id) || 0;
        const heroImageUrl =
          room.heroImageUrl !== undefined
            ? room.heroImageUrl
            : heroUrlByRoomId.get(room.id) || null;
        const dimensions =
          room.dimensions !== undefined ? room.dimensions : formatDimensionsFallback(room);
        const sqft =
          typeof room.sqft === "number" || room.sqft === null
            ? room.sqft
            : computeSqftFallback(room);

        return {
          room,
          listingCount,
          inspirationCount,
          heroImageUrl: heroImageUrl ?? null,
          dimensions: dimensions ?? null,
          sqft: sqft ?? null,
        } satisfies ResolvedRoom;
      }),
    [allRooms, listingCountByRoomId, inspirationCountByRoomId, heroUrlByRoomId],
  );

  /** Only rooms with real coordinates get a dot — both levels at once. */
  const dotRooms = useMemo(
    () =>
      resolvedRooms.filter(
        (entry) => entry.room.floorplanXPct !== null && entry.room.floorplanYPct !== null,
      ),
    [resolvedRooms],
  );

  /** Toggle the single pinned card. Passing false from the active room clears it. */
  const handlePinChange = useCallback((roomId: number, pinned: boolean) => {
    setPinnedRoomId((current) => {
      if (pinned) return roomId;
      return current === roomId ? null : current;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[50svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-3 size-5 animate-spin" aria-hidden="true" />
        Loading floor plan...
      </div>
    );
  }

  if (errored && floors.length === 0) {
    return (
      <Card className="ring-1 ring-border/40">
        <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <MapPinned className="size-8 text-muted-foreground" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold">Could not load the floor plan</p>
            <p className="text-sm text-muted-foreground">
              The room catalog request failed. Check your connection and try again.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fetchData(true)}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Floorplan canvas with all dots (both levels, always visible). */}
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>Listing Floor Plan</CardTitle>
                <CardDescription>
                  Hover a room dot for details; click to keep its card open.
                </CardDescription>
              </div>
              {/* Level control moved to the sidebar (T2.5) — only Refresh remains here. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchData(false)}
                disabled={refreshing}
              >
                {refreshing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-4" aria-hidden="true" />
                )}
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative overflow-hidden rounded-xl bg-muted/20 ring-1 ring-border/40">
              {/* biome-ignore lint/performance/noImgElement: static floorplan from public assets */}
              <img
                src={FLOORPLAN_IMAGE_SRC}
                alt="126 Colby listing floor plan, lower and upper levels"
                className="h-auto w-full select-none object-contain"
                draggable={false}
              />

              {dotRooms.map((entry) => (
                <RoomHoverCard
                  key={entry.room.id}
                  resolved={entry}
                  pinned={pinnedRoomId === entry.room.id}
                  onPinChange={(pinned) => handlePinChange(entry.room.id, pinned)}
                />
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <LegendSwatch className="bg-emerald-600" label="Has listing photos" />
              <LegendSwatch className="bg-amber-500" label="Inspiration only" />
              <LegendSwatch className="bg-muted-foreground/80" label="No photos yet" />
              <span className="ml-auto">Dot number = listing photo count</span>
            </div>
          </CardContent>
        </Card>

        {/* Right sidebar: level switch + room list + outside/unplaced group. */}
        <LevelSidebar
          resolved={resolvedRooms}
          level={selectedLevel}
          onLevelChange={setSelectedLevel}
        />
      </div>
    </div>
  );
}

/** Tiny colored swatch + label used in the floorplan legend. */
function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block size-2.5 rounded-full ring-1 ring-white/80 ${className}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
