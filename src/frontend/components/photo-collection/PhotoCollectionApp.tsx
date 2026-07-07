/**
 * PhotoCollectionApp — page-level orchestrator for the property-card-based
 * photo viewer on `/photos/listing` and `/photos/inspiration`.
 *
 * Flow:
 *   1. Fetches all images for the category and the room catalog.
 *   2. Groups images by room (using the same logic as PhotoLibraryApp).
 *   3. Renders a responsive grid of RoomPropertyCard components.
 *   4. Clicking a card → switches to the PhotoCollectionViewport for that room.
 *   5. "Back to rooms" inside the viewport → returns to the card grid.
 *
 * This is a READ-ONLY viewer intended for contractors and professionals.
 * The admin editing experience stays on the existing PhotoLibraryApp.
 */

import { Camera, Info, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RoomPropertyCard } from "./RoomPropertyCard";
import {
  PhotoCollectionViewport,
  type ViewportImage,
} from "./PhotoCollectionViewport";

// ─── Types (mirrored from PhotoLibraryApp for compatibility) ────────────────

type PhotoCategory = "inspirational" | "listing";

interface PhotoCollectionAppProps {
  category: PhotoCategory;
  title: string;
}

interface TagMappingRecord {
  id: number;
  tagId: number;
  slug: string;
  label: string;
  source: string;
  aiRationale?: string | null;
  isAiPrefill?: boolean;
}

interface HighlightRecord {
  highlightType: "like" | "dislike";
  shapeType: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  note?: string | null;
}

interface ImageRecord {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  photoCategory: string;
  roomId?: number | null;
  roomIds?: number[];
  roomLabels?: string[];
  tags?: string[];
  tagMappings?: TagMappingRecord[];
  highlights?: HighlightRecord[];
  roomType?: string | null;
  metadata?: string | null;
  datetimeCreated?: string | number | Date | null;
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

/** A processed view image ready for display. */
interface ViewImage {
  id: string;
  name: string;
  path: string;
  roomId: number | null;
  roomIds: number[];
  roomLabels: string[];
  room: string;
  tags: string[];
  highlights: HighlightRecord[];
  note: string;
  createdAt: string;
}

/** A group of images belonging to the same room. */
interface ImageGroup {
  room: string;
  roomId: number | null;
  floorName?: string;
  floorKey?: string;
  images: ViewImage[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseMetadata(raw: string | null | undefined): {
  tags: string[];
  note: string;
  deliveryUrl?: string;
} {
  if (!raw) return { tags: [], note: "" };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.map((v) => String(v).trim()).filter(Boolean)
      : [];
    const note = typeof parsed.note === "string" ? parsed.note : "";
    const deliveryUrl =
      typeof parsed.deliveryUrl === "string" ? parsed.deliveryUrl : undefined;
    return { tags, note, deliveryUrl };
  } catch {
    return { tags: [], note: "" };
  }
}

function resolveImageUrl(image: ImageRecord): string {
  const deliveryId = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!deliveryId) return "";
  if (deliveryId.startsWith("http://") || deliveryId.startsWith("https://"))
    return deliveryId;
  if (deliveryId.includes("/"))
    return `https://imagedelivery.net/${deliveryId}/public`;
  const metadata = parseMetadata(image.metadata);
  if (metadata.deliveryUrl) return metadata.deliveryUrl;
  return `https://imagedelivery.net/${deliveryId}/public`;
}

function formatCreatedAt(value: ImageRecord["datetimeCreated"]): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString();
}

function buildViewImage(image: ImageRecord): ViewImage {
  const metadata = parseMetadata(image.metadata);
  const roomLabels = Array.isArray(image.roomLabels)
    ? image.roomLabels.map((l) => String(l).trim()).filter(Boolean)
    : [];
  const roomIds = Array.isArray(image.roomIds)
    ? image.roomIds
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v))
        .map((v) => Math.trunc(v))
    : [];

  const primaryRoom = roomLabels[0] || image.roomType?.trim() || "unassigned";
  const fallbackName =
    primaryRoom === "unassigned" ? "Untitled photo" : `${primaryRoom} photo`;

  return {
    id: image.id,
    name: image.displayName?.trim() || fallbackName,
    path: resolveImageUrl(image),
    roomId: image.roomId ?? null,
    roomIds,
    roomLabels,
    room: primaryRoom,
    tags:
      Array.isArray(image.tags) && image.tags.length > 0
        ? image.tags.map((t) => String(t).trim()).filter(Boolean)
        : metadata.tags,
    highlights: Array.isArray(image.highlights)
      ? image.highlights
          .map((hl) => ({
            ...hl,
            highlightType: (hl.highlightType === "dislike"
              ? "dislike"
              : "like") as "like" | "dislike",
            shapeType: hl.shapeType || "rect",
            xPct: Number(hl.xPct) || 0,
            yPct: Number(hl.yPct) || 0,
            widthPct: Number(hl.widthPct) || 0,
            heightPct: Number(hl.heightPct) || 0,
            note: hl.note || "",
          }))
          .filter((hl) => hl.widthPct > 0 && hl.heightPct > 0)
      : [],
    note: metadata.note,
    createdAt: formatCreatedAt(image.datetimeCreated),
  };
}

function groupByRoom(
  images: ViewImage[],
  catalogRooms: CatalogRoom[],
): ImageGroup[] {
  const map = new Map<string, ViewImage[]>();
  for (const image of images) {
    const room = image.room || "unassigned";
    if (!map.has(room)) map.set(room, []);
    map.get(room)!.push(image);
  }

  // Build a lookup for catalog room metadata by display name (case insensitive).
  const catalogByName = new Map(
    catalogRooms.map((r) => [r.displayName.toLowerCase(), r]),
  );

  return Array.from(map.entries())
    .map(([room, roomImages]) => {
      const catalog = catalogByName.get(room.toLowerCase());
      return {
        room,
        roomId: catalog?.id ?? roomImages[0]?.roomId ?? null,
        floorName: catalog?.floorName,
        floorKey: catalog?.floorKey,
        images: roomImages,
      };
    })
    .sort((a, b) => a.room.localeCompare(b.room));
}

// ─── Notice copy ────────────────────────────────────────────────────────────

const LISTING_NOTICE =
  "These are the listing photos from the original property listing, captured before it was taken off the market. Use them as a baseline reference for the home's condition at the time of purchase.";

const INSPIRATION_NOTICE =
  "Browse the inspiration photos organized by room. These images represent the design direction and style goals for each space in the remodel.";

// ─── Component ──────────────────────────────────────────────────────────────

export function PhotoCollectionApp({
  category,
  title,
}: PhotoCollectionAppProps) {
  const [images, setImages] = useState<ViewImage[]>([]);
  const [catalogRooms, setCatalogRooms] = useState<CatalogRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /** The room currently open in the viewport (null = card grid view). */
  const [activeRoom, setActiveRoom] = useState<string | null>(null);

  // ─── Data fetching ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [imgRes, catRes] = await Promise.all([
        fetch(`/api/images?photoCategory=${category}`, {
          credentials: "include",
        }),
        fetch("/api/rooms/catalog", { credentials: "include" }),
      ]);

      const imgPayload = (await imgRes.json()) as { images?: ImageRecord[] };
      const catPayload = (await catRes.json()) as {
        success?: boolean;
        floors?: Array<{
          id: number;
          key: string;
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

      // Images.
      const rows = Array.isArray(imgPayload.images) ? imgPayload.images : [];
      const mapped = rows.map(buildViewImage).sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime() || 0;
        const bTime = new Date(b.createdAt).getTime() || 0;
        return bTime - aTime;
      });
      setImages(mapped);

      // Catalog rooms.
      const floors =
        catRes.ok && catPayload.success && Array.isArray(catPayload.floors)
          ? catPayload.floors
          : [];
      const rooms: CatalogRoom[] = floors.flatMap((floor) =>
        Array.isArray(floor.rooms)
          ? floor.rooms.map((room) => ({
              ...room,
              floorKey: floor.key,
              floorName: floor.name,
            }))
          : [],
      );
      setCatalogRooms(rooms);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load photos",
      );
    } finally {
      setLoading(false);
    }
  }, [category]);

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    try {
      const imgRes = await fetch(`/api/images?photoCategory=${category}`, {
        credentials: "include",
      });
      const imgPayload = (await imgRes.json()) as { images?: ImageRecord[] };
      const rows = Array.isArray(imgPayload.images) ? imgPayload.images : [];
      const mapped = rows.map(buildViewImage).sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime() || 0;
        const bTime = new Date(b.createdAt).getTime() || 0;
        return bTime - aTime;
      });
      setImages(mapped);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to refresh photos",
      );
    } finally {
      setRefreshing(false);
    }
  }, [category]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ─── Derived state ──────────────────────────────────────────────────────

  const groups = useMemo(
    () => groupByRoom(images, catalogRooms),
    [images, catalogRooms],
  );

  const activeGroup = useMemo(
    () => groups.find((g) => g.room === activeRoom) ?? null,
    [activeRoom, groups],
  );

  const notice = category === "listing" ? LISTING_NOTICE : INSPIRATION_NOTICE;

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-3 size-5 animate-spin" />
        Loading photos…
      </div>
    );
  }

  // ─── Viewport mode (a room is selected) ─────────────────────────────────

  if (activeRoom && activeGroup) {
    const viewportImages: ViewportImage[] = activeGroup.images.map((img) => ({
      id: img.id,
      name: img.name,
      path: img.path,
      tags: img.tags,
      note: img.note,
      highlights: img.highlights,
      createdAt: img.createdAt,
    }));

    return (
      <div className="mx-auto max-w-6xl px-4 py-4 lg:py-6">
        <PhotoCollectionViewport
          roomName={activeGroup.room}
          viewerType={title}
          floorName={activeGroup.floorName}
          floorKey={activeGroup.floorKey}
          images={viewportImages}
          onBack={() => setActiveRoom(null)}
        />
      </div>
    );
  }

  // ─── Card grid mode ─────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 lg:py-8">
      {/* Header. */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {images.length} photos across {groups.length} rooms
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshData()}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Refresh
        </Button>
      </header>

      {/* Notice. */}
      <div className="mb-6 flex items-start gap-3 rounded-xl bg-muted/10 px-4 py-3 ring-1 ring-foreground/10">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm leading-6 text-muted-foreground">{notice}</p>
      </div>

      {/* Empty state. */}
      {images.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-card/30 px-6 py-16 text-center ring-1 ring-foreground/10">
          <Camera className="size-10 text-muted-foreground" />
          <div>
            <h3 className="text-lg font-medium">
              {category === "listing"
                ? "No listing photos yet"
                : "No inspiration photos yet"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Photos will appear here once they are uploaded and assigned to
              rooms.
            </p>
          </div>
        </div>
      ) : (
        /* Room property cards grid. */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {groups.map((group) => (
            <RoomPropertyCard
              key={group.room}
              roomName={group.room}
              floorName={group.floorName}
              floorKey={group.floorKey}
              photoCount={group.images.length}
              heroImageUrl={group.images[0]?.path ?? null}
              onSelect={() => setActiveRoom(group.room)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default PhotoCollectionApp;
