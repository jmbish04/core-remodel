import {
  Check,
  ChevronsLeftRight,
  CopyX,
  Crop,
  Eraser,
  FileImage,
  Home,
  Images,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePreview } from "@/components/ui/image-preview";
import { ImageComparison } from "@/components/ui/image-comparison";
import { ImageGallery, type ImageGalleryContextAction } from "@/components/ui/image-gallery";
import { ImageGalleryMasonry } from "@/components/ui/image-gallery-masonry";
import { GridBento } from "@/components/ui/grid-bento";
import { MultipleSelector, type MultipleSelectorOption } from "@/components/ui/multiple-selector";
import { LevelRoomSelect } from "@/components/LevelRoomSelect";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Cropper, CropperArea, CropperImage, type CropperAreaData } from "@/components/ui/cropper";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RoomSelect } from "@/components/ui/room-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getTrackedUploadLabel,
  type UploadProcessingStatus,
} from "@/lib/image-upload-tracking";
import { cn } from "@/lib/utils";

type PhotoCategory = "inspirational" | "listing";
type ViewMode = "bento" | "gallery" | "masonry" | "list" | "single";
type HighlightType = "like" | "dislike";

interface PhotoLibraryAppProps {
  category: PhotoCategory;
  title: string;
  reviewMode?: boolean;
}

interface AiPrefillValue {
  value: string;
  rationale: string;
}

interface AiPrefillMetadata {
  tags: AiPrefillValue[];
  note?: AiPrefillValue;
  roomType?: AiPrefillValue;
  displayName?: AiPrefillValue;
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
  id?: number;
  highlightType: HighlightType;
  shapeType: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  note?: string | null;
}

interface ParsedMetadata {
  tags: string[];
  note: string;
  deliveryUrl?: string;
  aiPrefill?: AiPrefillMetadata;
  raw: Record<string, unknown>;
}

interface ListingPhotoRecord {
  id: number;
  roomId?: number | null;
  roomName?: string | null;
  description?: string | null;
  blankCanvasCfImageId?: string | null;
  aiEdits?: Array<{
    id: number;
    prompt: string;
    path: string;
    generatedCfImageId: string;
    [key: string]: unknown;
  }>;
}

interface ImageRecord {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  photoCategory: "inspirational" | "listing" | "ai_render";
  roomId?: number | null;
  roomIds?: number[];
  roomLabels?: string[];
  tags?: string[];
  tagMappings?: TagMappingRecord[];
  highlights?: HighlightRecord[];
  roomType?: string | null;
  metadata?: string | null;
  datetimeCreated?: string | number | Date | null;
  processingStatus?: UploadProcessingStatus | null;
  workflowInstanceId?: string | null;
  processingError?: string | null;
  processedAt?: string | number | Date | null;
  listingPhoto?: ListingPhotoRecord | null;
}

interface CatalogFloor {
  id: number;
  key: string;
  name: string;
  levelOrder: number;
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

interface ViewImageRecord {
  raw: ImageRecord;
  id: string;
  name: string;
  path: string;
  roomId: number | null;
  roomIds: number[];
  roomLabels: string[];
  room: string;
  tags: string[];
  tagMappings: TagMappingRecord[];
  highlights: HighlightRecord[];
  note: string;
  createdAt: string;
  metadata: ParsedMetadata;
  processingStatus: UploadProcessingStatus | null;
  workflowInstanceId: string | null;
  processingError: string | null;
  processedAt: string | number | Date | null;
}

interface ImageGroup {
  room: string;
  images: ViewImageRecord[];
}

interface CropState {
  crop: { x: number; y: number };
  zoom: number;
  rotation: number;
  areaPixels: CropperAreaData | null;
}

function parseMetadata(raw: string | null | undefined): ParsedMetadata {
  if (!raw) {
    return { tags: [], note: "", raw: {} };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const note = typeof parsed.note === "string" ? parsed.note : "";
    const deliveryUrl =
      typeof parsed.deliveryUrl === "string" ? parsed.deliveryUrl : undefined;
    const aiPrefill =
      parsed.aiPrefill && typeof parsed.aiPrefill === "object"
        ? (parsed.aiPrefill as AiPrefillMetadata)
        : undefined;
    return { tags, note, deliveryUrl, aiPrefill, raw: parsed };
  } catch {
    return { tags: [], note: "", raw: { raw } };
  }
}

function resolveImageUrl(image: ImageRecord): string {
  const deliveryId = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!deliveryId) {
    return "";
  }

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

function formatCreatedAt(value: ImageRecord["datetimeCreated"]): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return date.toLocaleDateString();
}

function buildViewImage(image: ImageRecord): ViewImageRecord {
  const metadata = parseMetadata(image.metadata);
  const roomLabels = Array.isArray(image.roomLabels)
    ? image.roomLabels.map((label) => String(label).trim()).filter(Boolean)
    : [];
  const roomIds = Array.isArray(image.roomIds)
    ? image.roomIds
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.trunc(value))
    : [];

  const primaryRoom = roomLabels[0] || image.roomType?.trim() || "unassigned";
  const fallbackName =
    primaryRoom === "unassigned"
      ? "Untitled photo"
      : `${primaryRoom} photo`;

  return {
    raw: image,
    id: image.id,
    name: image.displayName?.trim() || fallbackName,
    path: resolveImageUrl(image),
    roomId: image.roomId ?? null,
    roomIds,
    roomLabels,
    room: primaryRoom,
    tags:
      Array.isArray(image.tags) && image.tags.length > 0
        ? image.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : metadata.tags,
    tagMappings: Array.isArray(image.tagMappings)
      ? image.tagMappings.filter((mapping) => Boolean(mapping))
      : [],
    highlights: Array.isArray(image.highlights)
      ? image.highlights
          .map((highlight) => ({
            ...highlight,
            highlightType: (highlight.highlightType === "dislike" ? "dislike" : "like") as HighlightType,
            shapeType: highlight.shapeType || "rect",
            xPct: Number(highlight.xPct) || 0,
            yPct: Number(highlight.yPct) || 0,
            widthPct: Number(highlight.widthPct) || 0,
            heightPct: Number(highlight.heightPct) || 0,
            note: highlight.note || "",
          }))
          .filter((highlight) => highlight.widthPct > 0 && highlight.heightPct > 0)
      : [],
    note: metadata.note,
    createdAt: formatCreatedAt(image.datetimeCreated),
    metadata,
    processingStatus: image.processingStatus ?? null,
    workflowInstanceId: image.workflowInstanceId ?? null,
    processingError: image.processingError ?? null,
    processedAt: image.processedAt ?? null,
  };
}

function groupByRoom(images: ViewImageRecord[]): ImageGroup[] {
  const map = new Map<string, ViewImageRecord[]>();

  for (const image of images) {
    const room = image.room || "unassigned";
    if (!map.has(room)) {
      map.set(room, []);
    }
    map.get(room)?.push(image);
  }

  return Array.from(map.entries())
    .map(([room, roomImages]) => ({
      room,
      images: roomImages,
    }))
    .sort((a, b) => a.room.localeCompare(b.room));
}

function createImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);

    image.addEventListener("load", () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    });

    image.addEventListener("error", (error) => {
      URL.revokeObjectURL(objectUrl);
      reject(error);
    });

    image.src = objectUrl;
  });
}

async function cropBlob(
  sourceBlob: Blob,
  areaPixels: CropperAreaData,
  filename: string,
): Promise<File> {
  const image = await createImageFromBlob(sourceBlob);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("2D context is not available for cropping");
  }

  const width = Math.max(1, Math.round(areaPixels.width));
  const height = Math.max(1, Math.round(areaPixels.height));
  const x = Math.max(0, Math.round(areaPixels.x));
  const y = Math.max(0, Math.round(areaPixels.y));

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, x, y, width, height, 0, 0, width, height);

  const outputType = sourceBlob.type === "image/png" ? "image/png" : "image/jpeg";

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error("Failed to render cropped image"));
          return;
        }
        resolve(result);
      },
      outputType,
      0.95,
    );
  });

  return new File([blob], filename, {
    type: outputType,
    lastModified: Date.now(),
  });
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(4))));
}

function normalizeTagInput(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function PhotoLibraryApp(props: PhotoLibraryAppProps) {
  const { category, title, reviewMode = false } = props;

  const [images, setImages] = useState<ViewImageRecord[]>([]);
  const [groups, setGroups] = useState<ImageGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>(reviewMode ? "single" : "bento");
  const [selectedImage, setSelectedImage] = useState<ViewImageRecord | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetImage, setDeleteTargetImage] = useState<ViewImageRecord | null>(null);

  const [catalogRooms, setCatalogRooms] = useState<CatalogRoom[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [panelDisplayName, setPanelDisplayName] = useState("");
  // Listing-photo room (null = unassigned). The Lower/Upper floor toggle + the
  // per-floor filtering were removed in favour of the shared floor-grouped,
  // searchable <RoomSelect> (0005 §C4). `panelRoomIds` (inspirational, multi-room)
  // is a separate stream and stays on MultipleSelector/LevelRoomSelect.
  const [panelRoomId, setPanelRoomId] = useState<number | null>(null);
  const [panelRoomIds, setPanelRoomIds] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<MultipleSelectorOption[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [panelTagIds, setPanelTagIds] = useState<string[]>([]);
  const [panelTagDraft, setPanelTagDraft] = useState("");
  const [panelNote, setPanelNote] = useState("");
  const [panelHighlights, setPanelHighlights] = useState<HighlightRecord[]>([]);
  const [highlightMode, setHighlightMode] = useState<HighlightType>("like");
  const [isDrawingHighlight, setIsDrawingHighlight] = useState(false);
  const [draftHighlight, setDraftHighlight] = useState<HighlightRecord | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isUploadingAiRender, setIsUploadingAiRender] = useState(false);
  const [isUploadingBlankCanvas, setIsUploadingBlankCanvas] = useState(false);
  const [isDeletingBlankCanvas, setIsDeletingBlankCanvas] = useState(false);
  const [demoSliderOpen, setDemoSliderOpen] = useState(false);
  const [comparisonModal, setComparisonModal] = useState({
    open: false,
    beforeSrc: "",
    afterSrc: "",
    beforeLabel: "",
    afterLabel: "",
  });
  const highlightSurfaceRef = useRef<HTMLDivElement | null>(null);
  const requestedImageIdRef = useRef<string | null>(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("imageId")
      : null,
  );

  const [replaceCropModalOpen, setReplaceCropModalOpen] = useState(false);
  const [replaceCropTargetImage, setReplaceCropTargetImage] = useState<ViewImageRecord | null>(null);
  const [replaceCropState, setReplaceCropState] = useState<CropState>({
    crop: { x: 0, y: 0 },
    zoom: 1,
    rotation: 0,
    areaPixels: null,
  });
  const [savingReplacementCrop, setSavingReplacementCrop] = useState(false);
  const processingCounts = useMemo(
    () =>
      images.reduce(
        (counts, image) => {
          if (image.processingStatus === "queued") {
            counts.queued += 1;
          } else if (image.processingStatus === "processing") {
            counts.processing += 1;
          } else if (image.processingStatus === "failed") {
            counts.failed += 1;
          }
          return counts;
        },
        { queued: 0, processing: 0, failed: 0 },
      ),
    [images],
  );
  const hasActiveProcessing =
    processingCounts.queued > 0 || processingCounts.processing > 0;

  const loadImages = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ photoCategory: category });
      const response = await fetch(`/api/images?${query.toString()}`);
      const payload = (await response.json()) as { images?: ImageRecord[] };

      if (!response.ok) {
        throw new Error("Failed to load images");
      }

      const rows = Array.isArray(payload.images) ? payload.images : [];
      const mapped = rows.map(buildViewImage).sort((a, b) => {
        const aTime = new Date(a.raw.datetimeCreated ?? 0).getTime();
        const bTime = new Date(b.raw.datetimeCreated ?? 0).getTime();
        return bTime - aTime;
      });

      setImages(mapped);
      setGroups(groupByRoom(mapped));
      setSelectedImage((current) => {
        if (!current) {
          return reviewMode ? mapped[0] ?? null : current;
        }
        return mapped.find((image) => image.id === current.id) ?? (reviewMode ? mapped[0] ?? null : current);
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load images");
    } finally {
      setLoading(false);
    }
  }, [category, reviewMode]);

  const refreshImages = useCallback(async () => {
    setRefreshing(true);
    try {
      const query = new URLSearchParams({ photoCategory: category });
      const response = await fetch(`/api/images?${query.toString()}`);
      const payload = (await response.json()) as { images?: ImageRecord[] };

      if (!response.ok) {
        throw new Error("Failed to load images");
      }

      const rows = Array.isArray(payload.images) ? payload.images : [];
      const mapped = rows.map(buildViewImage).sort((a, b) => {
        const aTime = new Date(a.raw.datetimeCreated ?? 0).getTime();
        const bTime = new Date(b.raw.datetimeCreated ?? 0).getTime();
        return bTime - aTime;
      });

      setImages(mapped);
      setGroups(groupByRoom(mapped));
      setSelectedImage((current) => {
        if (!current) {
          return reviewMode ? mapped[0] ?? null : current;
        }
        return mapped.find((image) => image.id === current.id) ?? (reviewMode ? mapped[0] ?? null : current);
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh images");
    } finally {
      setRefreshing(false);
    }
  }, [category, reviewMode]);

  const fetchTagOptions = useCallback(async () => {
    setTagsLoading(true);
    try {
      const response = await fetch("/api/images/tags");
      const payload = (await response.json()) as {
        tags?: Array<{ id: number; label: string; slug: string }>;
      };
      if (!response.ok) {
        throw new Error("Failed to load tags");
      }
      const options =
        Array.isArray(payload.tags)
          ? payload.tags
              .map((tag) => ({
                value: String(tag.id),
                label: tag.label,
                description: tag.slug,
              }))
              .sort((a, b) => a.label.localeCompare(b.label))
          : [];
      setTagOptions(options);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load tags");
    } finally {
      setTagsLoading(false);
    }
  }, []);

  const fetchCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const response = await fetch("/api/rooms/catalog");
      const payload = (await response.json()) as {
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

      if (!response.ok || !payload.success) {
        throw new Error("Failed to load room catalog");
      }

      const floors = Array.isArray(payload.floors) ? payload.floors : [];
      const normalizedFloors: CatalogFloor[] = floors.map((floor) => ({
        id: floor.id,
        key: floor.key,
        name: floor.name,
        levelOrder: floor.levelOrder,
        rooms: Array.isArray(floor.rooms)
          ? floor.rooms.map((room) => ({
              ...room,
              floorKey: floor.key,
              floorName: floor.name,
            }))
          : [],
      }));

      setCatalogRooms(normalizedFloors.flatMap((floor) => floor.rooms));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load room list");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  useEffect(() => {
    fetchTagOptions();
  }, [fetchTagOptions]);

  useEffect(() => {
    const onGlobalUploadComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{
        target?: string;
        isListingPhoto?: boolean;
      }>;
      if (customEvent.detail?.target !== "images") {
        return;
      }
      const uploadCategory = customEvent.detail?.isListingPhoto ? "listing" : "inspirational";
      if (uploadCategory === category) {
        refreshImages();
        fetchTagOptions();
      }
    };

    window.addEventListener("global-upload-complete", onGlobalUploadComplete);
    return () => {
      window.removeEventListener("global-upload-complete", onGlobalUploadComplete);
    };
  }, [category, fetchTagOptions, refreshImages]);

  useEffect(() => {
    if (!hasActiveProcessing) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshImages();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasActiveProcessing, refreshImages]);

  useEffect(() => {
    if (!selectedImage) {
      return;
    }

    setPanelDisplayName(selectedImage.raw.displayName ?? "");
    setPanelNote(selectedImage.note || "");
    setPanelHighlights(selectedImage.highlights || []);

    const mappedTagIds = selectedImage.tagMappings.map((mapping) => String(mapping.tagId));
    setPanelTagIds(mappedTagIds);
    const mappedLabelSet = new Set(
      selectedImage.tagMappings.map((mapping) => mapping.label.trim().toLowerCase()),
    );
    const detachedTags = selectedImage.tags.filter(
      (tag) => !mappedLabelSet.has(tag.trim().toLowerCase()),
    );
    setPanelTagDraft(detachedTags.join(", "));

    if (category === "listing") {
      // Pre-fill the picker with the photo's EXISTING saved room (editing an
      // assignment), else leave it unselected. This is not a "default" auto-select
      // of an arbitrary/ghost room — it reflects the photo's current state.
      const matchedRoom =
        selectedImage.roomId !== null && selectedImage.roomId !== undefined
          ? catalogRooms.find((room) => room.id === selectedImage.roomId)
          : null;

      setPanelRoomId(matchedRoom ? matchedRoom.id : null);
      setPanelRoomIds([]);
    } else {
      setPanelRoomIds(selectedImage.roomIds.map((roomId) => String(roomId)));
      setPanelRoomId(null);
    }
  }, [category, catalogRooms, selectedImage]);

  useEffect(() => {
    if (!reviewMode) {
      return;
    }
    if (!selectedImage && images.length > 0) {
      setSelectedImage(images[0]);
    }
  }, [images, reviewMode, selectedImage]);

  const openImage = useCallback((image: ViewImageRecord) => {
    setSelectedImage(image);
    setPreviewOpen(false);
  }, []);

  useEffect(() => {
    const requestedImageId = requestedImageIdRef.current;
    if (!requestedImageId) {
      return;
    }
    const matched = images.find((image) => image.id === requestedImageId);
    if (!matched) {
      return;
    }
    openImage(matched);
    requestedImageIdRef.current = null;
  }, [images, openImage]);

  const closeSelection = useCallback(() => {
    if (reviewMode) {
      return;
    }
    setSelectedImage(null);
    setPreviewOpen(false);
  }, [reviewMode]);

  const createTagOption = useCallback(
    async (label: string): Promise<MultipleSelectorOption | null> => {
      const normalized = label.trim();
      if (!normalized) {
        return null;
      }

      const response = await fetch("/api/images/tags", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label: normalized }),
      });
      const payload = (await response.json()) as {
        tag?: { id: number; label: string; slug: string };
        error?: string;
      };
      if (!response.ok || !payload.tag) {
        throw new Error(payload.error || "Failed to create tag");
      }
      const created: MultipleSelectorOption = {
        value: String(payload.tag.id),
        label: payload.tag.label,
        description: payload.tag.slug,
      };
      setTagOptions((previous) => {
        if (previous.some((option) => option.value === created.value)) {
          return previous;
        }
        return [...previous, created].sort((a, b) => a.label.localeCompare(b.label));
      });
      return created;
    },
    [],
  );

  const updateHighlightNote = useCallback((index: number, note: string) => {
    setPanelHighlights((previous) =>
      previous.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              note,
            }
          : entry,
      ),
    );
  }, []);

  const removeHighlight = useCallback((index: number) => {
    setPanelHighlights((previous) => previous.filter((_, entryIndex) => entryIndex !== index));
  }, []);

  const beginHighlightDraw = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      if (!selectedImage) {
        return;
      }
      const surface = highlightSurfaceRef.current;
      if (!surface) {
        return;
      }
      const bounds = surface.getBoundingClientRect();
      if (!bounds.width || !bounds.height) {
        return;
      }
      const xPct = clampPercent(((event.clientX - bounds.left) / bounds.width) * 100);
      const yPct = clampPercent(((event.clientY - bounds.top) / bounds.height) * 100);
      setDraftHighlight({
        highlightType: highlightMode,
        shapeType: "rect",
        xPct,
        yPct,
        widthPct: 0.1,
        heightPct: 0.1,
        note: "",
      });
      setIsDrawingHighlight(true);
      surface.setPointerCapture(event.pointerId);
    },
    [highlightMode, selectedImage],
  );

  const moveHighlightDraw = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDrawingHighlight || !draftHighlight) {
      return;
    }
    const surface = highlightSurfaceRef.current;
    if (!surface) {
      return;
    }
    const bounds = surface.getBoundingClientRect();
    const xPct = clampPercent(((event.clientX - bounds.left) / bounds.width) * 100);
    const yPct = clampPercent(((event.clientY - bounds.top) / bounds.height) * 100);
    const nextX = Math.min(draftHighlight.xPct, xPct);
    const nextY = Math.min(draftHighlight.yPct, yPct);
    const nextWidth = Math.abs(xPct - draftHighlight.xPct);
    const nextHeight = Math.abs(yPct - draftHighlight.yPct);
    setDraftHighlight((previous) =>
      previous
        ? {
            ...previous,
            xPct: nextX,
            yPct: nextY,
            widthPct: clampPercent(nextWidth),
            heightPct: clampPercent(nextHeight),
          }
        : null,
    );
  }, [draftHighlight, isDrawingHighlight]);

  const endHighlightDraw = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const surface = highlightSurfaceRef.current;
    if (surface && surface.hasPointerCapture(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId);
    }
    if (!draftHighlight) {
      setIsDrawingHighlight(false);
      return;
    }
    if (draftHighlight.widthPct >= 1 && draftHighlight.heightPct >= 1) {
      setPanelHighlights((previous) => [...previous, draftHighlight]);
    }
    setDraftHighlight(null);
    setIsDrawingHighlight(false);
  }, [draftHighlight]);

  const saveSelectedImage = useCallback(async () => {
    if (!selectedImage) return;

    if (category === "listing" && panelRoomId == null) {
      toast.error("Listing photos must be assigned to a room");
      return;
    }
    if (category === "inspirational" && panelRoomIds.length === 0) {
      toast.error("Select one or more rooms for this inspirational photo");
      return;
    }

    setIsSaving(true);

    try {
      const detachedTags = normalizeTagInput(panelTagDraft);
      const payload: Record<string, unknown> = {
        displayName: panelDisplayName,
        photoCategory: category,
        tagIds: panelTagIds.map((value) => Number(value)),
        customTags: detachedTags,
        note: panelNote,
        highlights: panelHighlights.map((highlight) => ({
          ...highlight,
          note: highlight.note?.trim() || "",
        })),
      };

      if (category === "listing") {
        const roomId = panelRoomId;
        payload.roomId = roomId;
        const room = catalogRooms.find((entry) => entry.id === roomId);
        payload.roomType = room?.roomName ?? selectedImage.room;
      } else {
        payload.roomIds = panelRoomIds.map((value) => Number(value));
      }

      const response = await fetch(`/api/images/${selectedImage.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as { image?: ImageRecord; error?: string };

      if (!response.ok || !data.image) {
        throw new Error(data.error ?? "Save failed");
      }

      const updated = buildViewImage(data.image);
      setSelectedImage(updated);
      await refreshImages();
      toast.success("Saved changes");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  }, [
    catalogRooms,
    category,
    panelDisplayName,
    panelHighlights,
    panelNote,
    panelRoomId,
    panelRoomIds,
    panelTagDraft,
    panelTagIds,
    refreshImages,
    selectedImage,
  ]);

  const handleUploadAiRender = useCallback(
    async (file: File) => {
      if (!selectedImage || !selectedImage.raw.listingPhoto) return;
      setIsUploadingAiRender(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("prompt", aiPrompt.trim() || "AI Rendered Image");

        const response = await fetch(`/api/listing-photos/${selectedImage.raw.listingPhoto.id}/ai-renders`, {
          method: "POST",
          body: formData,
        });

        const data = (await response.json()) as { success: boolean; edit?: any; error?: string };
        if (!response.ok || !data.success || !data.edit) {
          throw new Error(data.error || "Upload failed");
        }

        toast.success("Successfully uploaded AI render");
        setAiPrompt("");

        // Refresh database state
        await refreshImages();

        // Refetch the updated image to refresh selected details
        const imgRes = await fetch(`/api/images?ids=${selectedImage.id}`);
        const imgData = (await imgRes.json()) as { success: boolean; images?: ImageRecord[] };
        if (imgRes.ok && imgData.success && imgData.images && imgData.images.length > 0) {
          setSelectedImage(buildViewImage(imgData.images[0]));
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to upload AI render");
      } finally {
        setIsUploadingAiRender(false);
      }
    },
    [selectedImage, aiPrompt, refreshImages]
  );

  const handleUploadBlankCanvas = useCallback(
    async (file: File) => {
      if (!selectedImage || !selectedImage.raw.listingPhoto) return;
      setIsUploadingBlankCanvas(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(
          `/api/listing-photos/${selectedImage.raw.listingPhoto.id}/blank-canvas`,
          { method: "POST", body: formData },
        );

        const data = (await response.json()) as {
          success: boolean;
          blankCanvasCfImageId?: string;
          error?: string;
        };
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Upload failed");
        }

        toast.success("Blank canvas uploaded");
        await refreshImages();

        const imgRes = await fetch(`/api/images?ids=${selectedImage.id}`);
        const imgData = (await imgRes.json()) as { success: boolean; images?: ImageRecord[] };
        if (imgRes.ok && imgData.success && imgData.images && imgData.images.length > 0) {
          setSelectedImage(buildViewImage(imgData.images[0]));
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to upload blank canvas");
      } finally {
        setIsUploadingBlankCanvas(false);
      }
    },
    [selectedImage, refreshImages],
  );

  const handleDeleteBlankCanvas = useCallback(async () => {
    if (!selectedImage || !selectedImage.raw.listingPhoto) return;
    setIsDeletingBlankCanvas(true);
    try {
      const response = await fetch(
        `/api/listing-photos/${selectedImage.raw.listingPhoto.id}/blank-canvas`,
        { method: "DELETE" },
      );

      const data = (await response.json()) as { success: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Delete failed");
      }

      toast.success("Blank canvas removed");
      await refreshImages();

      const imgRes = await fetch(`/api/images?ids=${selectedImage.id}`);
      const imgData = (await imgRes.json()) as { success: boolean; images?: ImageRecord[] };
      if (imgRes.ok && imgData.success && imgData.images && imgData.images.length > 0) {
        setSelectedImage(buildViewImage(imgData.images[0]));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove blank canvas");
    } finally {
      setIsDeletingBlankCanvas(false);
    }
  }, [selectedImage, refreshImages]);

  const requestDeleteImage = useCallback((image: ViewImageRecord) => {
    setSelectedImage(image);
    setDeleteTargetImage(image);
    setDeleteConfirmOpen(true);
  }, []);

  const requestDeleteSelectedImage = useCallback(() => {
    if (!selectedImage) {
      return;
    }
    requestDeleteImage(selectedImage);
  }, [requestDeleteImage, selectedImage]);

  const navigateToAiEdit = useCallback((image: ViewImageRecord) => {
    const params = new URLSearchParams({ sourceImageId: image.id });
    window.location.assign(`/admin/photo-edits?${params.toString()}`);
  }, []);

  const markImageAsDuplicate = useCallback(
    async (image: ViewImageRecord) => {
      try {
        const response = await fetch(`/api/images/${image.id}/duplicate`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isDuplicate: true }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || "Failed to mark as duplicate");
        }

        // Remove from local list immediately
        setImages((current) => current.filter((img) => img.id !== image.id));
        setGroups((current) =>
          current
            .map((group) => ({
              ...group,
              images: group.images.filter((img) => img.id !== image.id),
            }))
            .filter((group) => group.images.length > 0),
        );
        if (selectedImage?.id === image.id) {
          closeSelection();
        }
        toast.success("Marked as duplicate — hidden from all views");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to mark duplicate");
      }
    },
    [closeSelection, selectedImage],
  );

  const performDeleteImage = useCallback(async () => {
    if (!deleteTargetImage) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/images/${deleteTargetImage.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete image");
      }

      window.dispatchEvent(
        new CustomEvent("global-upload-complete", {
          detail: {
            target: "images",
            deleted: true,
            isListingPhoto: category === "listing",
          },
        }),
      );

      setDeleteConfirmOpen(false);
      setDeleteTargetImage(null);
      if (reviewMode) {
        setSelectedImage(null);
      } else {
        closeSelection();
      }
      await refreshImages();
      toast.success("Image deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete image");
    } finally {
      setIsDeleting(false);
    }
  }, [category, closeSelection, deleteTargetImage, refreshImages, reviewMode]);

  const openReplaceCropModal = useCallback((image: ViewImageRecord) => {
    setReplaceCropTargetImage(image);
    setReplaceCropState({
      crop: { x: 0, y: 0 },
      zoom: 1,
      rotation: 0,
      areaPixels: null,
    });
    setReplaceCropModalOpen(true);
  }, []);

  const closeReplaceCropModal = useCallback(() => {
    setReplaceCropModalOpen(false);
    setReplaceCropTargetImage(null);
    setSavingReplacementCrop(false);
  }, []);

  const saveReplacementCrop = useCallback(async () => {
    if (!replaceCropTargetImage || !replaceCropState.areaPixels) {
      toast.error("Select a crop area before saving");
      return;
    }

    setSavingReplacementCrop(true);
    try {
      const sourceResponse = await fetch(replaceCropTargetImage.path, { cache: "no-store" });
      if (!sourceResponse.ok) {
        throw new Error(`Failed to fetch source image (${sourceResponse.status})`);
      }

      const sourceBlob = await sourceResponse.blob();
      const croppedFile = await cropBlob(
        sourceBlob,
        replaceCropState.areaPixels,
        `${replaceCropTargetImage.id}-crop.jpg`,
      );

      const formData = new FormData();
      formData.append("file", croppedFile);

      const response = await fetch(`/api/images/${replaceCropTargetImage.id}/replace`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { image?: ImageRecord; error?: string };

      if (!response.ok || !payload.image) {
        throw new Error(payload.error ?? "Failed to save cropped image");
      }

      const updatedView = buildViewImage(payload.image);
      setSelectedImage(updatedView);
      await refreshImages();
      window.dispatchEvent(
        new CustomEvent("global-upload-complete", {
          detail: {
            target: "images",
            replaced: true,
            isListingPhoto: category === "listing",
          },
        }),
      );
      toast.success("Image crop saved");
      closeReplaceCropModal();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save cropped image");
    } finally {
      setSavingReplacementCrop(false);
    }
  }, [
    category,
    closeReplaceCropModal,
    refreshImages,
    replaceCropState.areaPixels,
    replaceCropTargetImage,
  ]);

  const imageById = useMemo(() => {
    return new Map(images.map((image) => [image.id, image]));
  }, [images]);

  const imageContextActions = useMemo<ImageGalleryContextAction[]>(
    () => [
      {
        id: "edit-metadata",
        label: "Update Metadata",
        onSelect: (item) => {
          const image = imageById.get(item.id);
          if (image) {
            openImage(image);
          }
        },
      },
      {
        id: "ai-edit",
        label: "Edit With AI",
        onSelect: (item) => {
          const image = imageById.get(item.id);
          if (image) {
            navigateToAiEdit(image);
          }
        },
      },
      {
        id: "mark-duplicate",
        label: "Mark as Duplicate",
        variant: "destructive" as const,
        separatorBefore: true,
        onSelect: (item) => {
          const image = imageById.get(item.id);
          if (image) {
            void markImageAsDuplicate(image);
          }
        },
      },
      {
        id: "delete-image",
        label: "Delete Image",
        variant: "destructive",
        onSelect: (item) => {
          const image = imageById.get(item.id);
          if (image) {
            requestDeleteImage(image);
          }
        },
      },
    ],
    [imageById, markImageAsDuplicate, navigateToAiEdit, openImage, requestDeleteImage],
  );

  const flatItems = useMemo(
    () =>
      images.map((image) => ({
        id: image.id,
        src: image.path,
        alt: image.name,
        title: image.name,
        subtitle: `${image.room} • ${image.createdAt}`,
        badge: image.room,
        tags: image.tags,
      })),
    [images],
  );

  const emptyMessage =
    category === "listing" ? "No listing photos yet" : "No inspiration photos yet";
  const panelVisible = reviewMode || Boolean(selectedImage);

  return (
    <>
      <div className="flex min-h-[calc(100svh-3rem)] overflow-hidden bg-background text-foreground">
        <div
          className={cn(
            "flex flex-1 flex-col overflow-hidden transition-all",
            panelVisible && !reviewMode && "lg:mr-[24rem]",
          )}
        >
          <header className="flex items-center justify-between border-b border-border/40 bg-card/60 px-6 py-4 backdrop-blur">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <p className="text-sm text-muted-foreground">
                {images.length} photos across {groups.length} rooms
              </p>
              {(processingCounts.queued > 0 ||
                processingCounts.processing > 0 ||
                processingCounts.failed > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {processingCounts.queued > 0 ? (
                    <Badge
                      variant="secondary"
                      className="bg-amber-500/15 text-amber-300"
                    >
                      {processingCounts.queued} queued
                    </Badge>
                  ) : null}
                  {processingCounts.processing > 0 ? (
                    <Badge
                      variant="secondary"
                      className="bg-sky-500/15 text-sky-300"
                    >
                      {processingCounts.processing} processing
                    </Badge>
                  ) : null}
                  {processingCounts.failed > 0 ? (
                    <Badge
                      variant="secondary"
                      className="bg-destructive/15 text-destructive"
                    >
                      {processingCounts.failed} failed
                    </Badge>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-amber-500/30 text-amber-300 bg-amber-500/5 hover:bg-amber-500/10 flex items-center gap-1.5"
                onClick={() => setDemoSliderOpen(true)}
              >
                <ChevronsLeftRight className="size-4 animate-pulse" />
                Slider Demo
              </Button>
              <Button
                variant={viewMode === "single" ? "default" : "outline"}
                size="icon-sm"
                onClick={() => setViewMode("single")}
                title="Single review view"
              >
                <ZoomIn className="size-4" />
              </Button>
              <Button
                variant={viewMode === "bento" ? "default" : "outline"}
                size="icon-sm"
                onClick={() => setViewMode("bento")}
                title="Bento view"
              >
                <LayoutGrid className="size-4" />
              </Button>
              <Button
                variant={viewMode === "gallery" ? "default" : "outline"}
                size="icon-sm"
                onClick={() => setViewMode("gallery")}
                title="Gallery view"
              >
                <Images className="size-4" />
              </Button>
              <Button
                variant={viewMode === "masonry" ? "default" : "outline"}
                size="icon-sm"
                onClick={() => setViewMode("masonry")}
                title="Masonry view"
              >
                <LayoutGrid className="size-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="icon-sm"
                onClick={() => setViewMode("list")}
                title="Grouped list view"
              >
                <List className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={refreshImages}
                disabled={refreshing || loading}
                className="gap-2"
              >
                <RefreshCw className={cn("size-4", (refreshing || loading) && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </header>

          <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            {(processingCounts.queued > 0 ||
              processingCounts.processing > 0 ||
              processingCounts.failed > 0) && (
              <div className="rounded-xl border border-border/40 bg-card/50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {processingCounts.queued > 0 ? (
                    <Badge
                      variant="secondary"
                      className="bg-amber-500/15 text-amber-300"
                    >
                      {processingCounts.queued} queued
                    </Badge>
                  ) : null}
                  {processingCounts.processing > 0 ? (
                    <Badge
                      variant="secondary"
                      className="bg-sky-500/15 text-sky-300"
                    >
                      {processingCounts.processing} processing
                    </Badge>
                  ) : null}
                  {processingCounts.failed > 0 ? (
                    <Badge
                      variant="secondary"
                      className="bg-destructive/15 text-destructive"
                    >
                      {processingCounts.failed} failed
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Newly uploaded photos refresh automatically while background analysis runs.
                </p>
              </div>
            )}
            {loading && images.length === 0 ? (
              <div className="flex items-center justify-center rounded-xl bg-card/30 py-20 text-muted-foreground ring-1 ring-border/40">
                <Loader2 className="mr-3 size-6 animate-spin" />
                Loading gallery...
              </div>
            ) : images.length === 0 ? (
              <div className="rounded-xl bg-card/30 px-6 py-16 text-center ring-1 ring-border/40">
                <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted/50">
                  <FileImage className="size-8 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-medium">{emptyMessage}</h3>
              </div>
            ) : viewMode === "single" ? (
              <div className="space-y-4">
                {selectedImage ? (
                  <div className="space-y-4">
                    <div className="relative overflow-hidden rounded-2xl border bg-card ring-1 ring-border/40">
                      {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
                      <img
                        src={selectedImage.path}
                        alt={selectedImage.name}
                        className="max-h-[68svh] w-full object-contain"
                      />
                      {selectedImage.highlights
                        .filter((highlight) => highlight.highlightType === "like")
                        .map((highlight, index) => (
                          <span
                            key={`single-like-${index}-${highlight.id ?? "new"}`}
                            className="absolute inline-flex size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-emerald-500 shadow"
                            style={{
                              left: `${highlight.xPct + highlight.widthPct / 2}%`,
                              top: `${highlight.yPct + highlight.heightPct / 2}%`,
                            }}
                            title={highlight.note || "Liked detail"}
                          />
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                      {images.map((image) => (
                        <ContextMenu key={`thumb-${image.id}`}>
                          <ContextMenuTrigger>
                            <button
                              type="button"
                              onClick={() => openImage(image)}
                              className={cn(
                                "w-full overflow-hidden rounded-lg border ring-1 ring-border/40",
                                selectedImage.id === image.id && "ring-2 ring-ring",
                              )}
                            >
                              {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
                              <img
                                src={image.path}
                                alt={image.name}
                                className="aspect-[4/3] w-full object-cover"
                              />
                            </button>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => openImage(image)}>
                              Update Metadata
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => navigateToAiEdit(image)}>
                              Edit With AI
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              variant="destructive"
                              onClick={() => requestDeleteImage(image)}
                            >
                              Delete Image
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : viewMode === "bento" ? (
              <GridBento
                items={flatItems}
                selectedId={selectedImage?.id}
                contextActions={imageContextActions}
                onSelect={(item) => {
                  const found = images.find((entry) => entry.id === item.id);
                  if (found) openImage(found);
                }}
              />
            ) : viewMode === "gallery" ? (
              <ImageGallery
                items={flatItems}
                selectedId={selectedImage?.id}
                contextActions={imageContextActions}
                onSelect={(item) => {
                  const found = images.find((entry) => entry.id === item.id);
                  if (found) openImage(found);
                }}
              />
            ) : viewMode === "masonry" ? (
              <ImageGalleryMasonry
                items={flatItems}
                selectedId={selectedImage?.id}
                contextActions={imageContextActions}
                onSelect={(item) => {
                  const found = images.find((entry) => entry.id === item.id);
                  if (found) openImage(found);
                }}
              />
            ) : (
              <div className="space-y-10 pb-10">
                {groups.map((group) => (
                  <section key={group.room} className="space-y-4">
                    <div className="sticky top-0 z-10 -mx-2 flex items-center gap-3 bg-background/90 px-2 py-2 backdrop-blur">
                      <div className="rounded-md bg-muted p-2">
                        <Home className="size-4 text-muted-foreground" />
                      </div>
                      <h2 className="text-lg font-semibold capitalize">{group.room}</h2>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {group.images.length}
                      </span>
                    </div>

                    <ImageGallery
                      items={group.images.map((image) => ({
                        id: image.id,
                        src: image.path,
                        alt: image.name,
                        title: image.name,
                        subtitle: image.createdAt,
                        badge: image.room,
                        tags: image.tags,
                      }))}
                      selectedId={selectedImage?.id}
                      contextActions={imageContextActions}
                      onSelect={(item) => {
                        const found = group.images.find((entry) => entry.id === item.id);
                        if (found) openImage(found);
                      }}
                    />
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside
          className={cn(
            "fixed inset-y-0 right-0 z-30 w-full translate-x-full border-l border-border/40 bg-card/80 shadow-2xl backdrop-blur transition-transform sm:w-[24rem]",
            panelVisible && "translate-x-0",
            reviewMode &&
              "lg:static lg:w-[30rem] lg:translate-x-0 lg:shadow-none lg:backdrop-blur-none",
          )}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <div className="min-w-0 pr-4">
                <h2 className="truncate text-sm font-semibold">
                  {selectedImage?.name ?? "Details"}
                </h2>
                {selectedImage?.processingStatus ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        selectedImage.processingStatus === "processed"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : selectedImage.processingStatus === "failed"
                            ? "bg-destructive/15 text-destructive"
                            : selectedImage.processingStatus === "processing"
                              ? "bg-sky-500/15 text-sky-300"
                              : "bg-amber-500/15 text-amber-300",
                      )}
                    >
                      {getTrackedUploadLabel(selectedImage.processingStatus)}
                    </span>
                    {selectedImage.processingStatus === "failed" &&
                    selectedImage.processingError ? (
                      <span className="truncate text-[11px] text-destructive">
                        {selectedImage.processingError}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {!reviewMode ? (
                <Button variant="ghost" size="icon-sm" onClick={closeSelection} title="Close details">
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>

            {selectedImage && (
              <>
                <div className="border-b border-border/40 bg-muted/20 p-4">
                  <div
                    ref={highlightSurfaceRef}
                    className={cn(
                      "relative overflow-hidden rounded-lg ring-1 ring-border/40",
                      "cursor-crosshair",
                    )}
                    onPointerDown={beginHighlightDraw}
                    onPointerMove={moveHighlightDraw}
                    onPointerUp={endHighlightDraw}
                    onPointerCancel={endHighlightDraw}
                  >
                    {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
                    <img
                      src={selectedImage.path}
                      alt={selectedImage.name}
                      className="max-h-56 w-full object-contain"
                    />

                    {panelHighlights.map((highlight, index) => (
                      <div
                        key={`highlight-${index}-${highlight.id ?? "new"}`}
                        className={cn(
                          "absolute border-2",
                          highlight.highlightType === "like"
                            ? "border-emerald-400 bg-emerald-400/20"
                            : "border-rose-400 bg-rose-400/20",
                        )}
                        style={{
                          left: `${highlight.xPct}%`,
                          top: `${highlight.yPct}%`,
                          width: `${highlight.widthPct}%`,
                          height: `${highlight.heightPct}%`,
                        }}
                      />
                    ))}

                    {draftHighlight ? (
                      <div
                        className={cn(
                          "absolute border-2",
                          draftHighlight.highlightType === "like"
                            ? "border-emerald-300 bg-emerald-300/20"
                            : "border-rose-300 bg-rose-300/20",
                        )}
                        style={{
                          left: `${draftHighlight.xPct}%`,
                          top: `${draftHighlight.yPct}%`,
                          width: `${draftHighlight.widthPct}%`,
                          height: `${draftHighlight.heightPct}%`,
                        }}
                      />
                    ) : null}
                  </div>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto p-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="photo-display-name"
                      className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
                    >
                      Photo Name (Optional)
                    </label>
                    {selectedImage.metadata.aiPrefill?.displayName?.value ? (
                      <p className="text-xs text-amber-600">
                        ✨ AI prefill rationale: {selectedImage.metadata.aiPrefill.displayName.rationale}
                      </p>
                    ) : null}
                    <Input
                      id="photo-display-name"
                      value={panelDisplayName}
                      onChange={(event) => setPanelDisplayName(event.target.value)}
                      placeholder="Kitchen sink wall concept"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      <Home className="size-3.5" />
                      Room
                    </p>

                    {category === "listing" ? (
                      <div className="space-y-2 rounded-lg bg-muted/20 p-3 ring-1 ring-border/30">
                        {/* Listing room — shared <RoomSelect> (§C4): floor-grouped,
                            searchable, active-only, display name in the trigger. */}
                        <RoomSelect
                          value={panelRoomId}
                          onChange={setPanelRoomId}
                          disabled={catalogLoading}
                          placeholder="Select listing room"
                          aria-label="Listing room"
                          className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">Room is required for listing photos.</p>
                      </div>
                    ) : (
                      <div className="space-y-2 rounded-lg bg-muted/20 p-3 ring-1 ring-border/30">
                        <LevelRoomSelect
                          rooms={catalogRooms}
                          value={panelRoomIds}
                          onChange={setPanelRoomIds}
                          disabled={catalogLoading}
                        />
                        <MultipleSelector
                          title="Tag inspirational rooms"
                          placeholder="Select one or more rooms"
                          options={catalogRooms.map((room) => ({
                            value: String(room.id),
                            label: `${room.floorName} • ${room.displayName}`,
                          }))}
                          value={panelRoomIds}
                          onValueChange={setPanelRoomIds}
                          disabled={catalogLoading}
                        />
                        <p className="text-xs text-muted-foreground">
                          Select one or more rooms for inspiration mapping.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="photo-tags"
                      className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
                    >
                      <Tag className="size-3.5" />
                      Tags
                    </label>
                    {selectedImage.metadata.aiPrefill?.tags?.length ? (
                      <div className="rounded-md border border-amber-200/60 bg-amber-50/50 p-2 text-xs text-amber-700">
                        <p className="font-medium">✨ AI suggested tags</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {selectedImage.metadata.aiPrefill.tags.map((tag, index) => (
                            <Badge
                              key={`prefill-tag-${index}-${tag.value}`}
                              variant="secondary"
                              className="cursor-help"
                              title={tag.rationale}
                            >
                              {tag.value}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <MultipleSelector
                      title="Select tags"
                      placeholder={tagsLoading ? "Loading tags..." : "Select or create tags"}
                      options={tagOptions}
                      value={panelTagIds}
                      onValueChange={setPanelTagIds}
                      disabled={tagsLoading}
                      enableCreate
                      createLabel="Create tag"
                      onCreateOption={async (value) => {
                        try {
                          return await createTagOption(value);
                        } catch (error) {
                          toast.error(
                            error instanceof Error ? error.message : "Failed to create tag",
                          );
                          return null;
                        }
                      }}
                      searchPlaceholder="Search tags..."
                    />
                    <Input
                      id="photo-tags"
                      value={panelTagDraft}
                      onChange={(event) => setPanelTagDraft(event.target.value)}
                      placeholder="Optional extra tags (comma separated)"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="photo-notes"
                      className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
                    >
                      <FileImage className="size-3.5" />
                      Notes
                    </label>
                    {selectedImage.metadata.aiPrefill?.note?.value ? (
                      <p className="text-xs text-amber-600">
                        ✨ AI prefill rationale: {selectedImage.metadata.aiPrefill.note.rationale}
                      </p>
                    ) : null}
                    <Textarea
                      id="photo-notes"
                      value={panelNote}
                      onChange={(event) => setPanelNote(event.target.value)}
                      rows={5}
                      placeholder="Lighting, finishes, layout ideas..."
                    />
                  </div>

                  <div className="space-y-2 rounded-lg border border-border/40 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Highlights
                      </p>
                      <Select
                        value={highlightMode}
                        onValueChange={(next) => setHighlightMode(next as HighlightType)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="like">I Like This</SelectItem>
                          <SelectItem value="dislike">I Do Not Like This</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Drag on the image above to create a {highlightMode === "like" ? "liked" : "disliked"} region.
                    </p>
                    <div className="space-y-2">
                      {panelHighlights.map((highlight, index) => (
                        <div key={`highlight-editor-${index}`} className="rounded-md border border-border/40 p-2">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <Badge variant={highlight.highlightType === "like" ? "default" : "destructive"}>
                              {highlight.highlightType === "like" ? "Like" : "Do Not Like"}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeHighlight(index)}
                              className="h-7 px-2 text-xs"
                            >
                              Remove
                            </Button>
                          </div>
                          <Input
                            value={highlight.note || ""}
                            onChange={(event) => updateHighlightNote(index, event.target.value)}
                            placeholder={
                              highlight.highlightType === "like"
                                ? "What do you want to replicate from this region?"
                                : "What should be avoided in future edits?"
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Blank Canvas Section */}
                  {category === "listing" && selectedImage.raw.listingPhoto && (
                    <div className="space-y-3 rounded-xl border border-border/40 bg-muted/5 p-4 shadow-sm ring-1 ring-border/20">
                      <div className="flex items-center justify-between border-b border-border/40 pb-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                          <Eraser className="size-3.5" />
                          Blank Canvas
                        </h3>
                        {selectedImage.raw.listingPhoto.blankCanvasCfImageId && (
                          <Badge variant="secondary" className="text-[10px] bg-sky-500/10 text-sky-400 border-sky-500/20">
                            Paired
                          </Badge>
                        )}
                      </div>

                      {selectedImage.raw.listingPhoto.blankCanvasCfImageId ? (
                        <div className="space-y-2">
                          <div className="relative overflow-hidden rounded-lg border border-border/40 bg-muted aspect-video">
                            {/* biome-ignore lint/performance/noImgElement: CF Images URL */}
                            <img
                              src={`https://imagedelivery.net/${selectedImage.raw.listingPhoto.blankCanvasCfImageId}/public`}
                              alt="Blank canvas"
                              className="size-full object-cover"
                            />
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-full text-[11px] font-medium border-sky-500/20 text-sky-300 bg-sky-500/5 hover:bg-sky-500/10"
                            onClick={() => {
                              setComparisonModal({
                                open: true,
                                beforeSrc: selectedImage.path,
                                afterSrc: `https://imagedelivery.net/${selectedImage.raw.listingPhoto!.blankCanvasCfImageId}/public`,
                                beforeLabel: "Original",
                                afterLabel: "Blank Canvas",
                              });
                            }}
                          >
                            <ChevronsLeftRight className="mr-1.5 size-3.5" />
                            Compare Original vs Blank Canvas
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-full text-[11px] font-medium border-amber-500/20 text-amber-300 bg-amber-500/5 hover:bg-amber-500/10"
                            onClick={() => {
                              const params = new URLSearchParams({ sourceImageId: selectedImage.id });
                              window.location.assign(`/admin/photo-edits?${params.toString()}`);
                            }}
                          >
                            <Sparkles className="mr-1.5 size-3.5" />
                            Use for Photo Edit Session
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-full text-[11px] text-muted-foreground hover:text-destructive"
                            onClick={handleDeleteBlankCanvas}
                            disabled={isDeletingBlankCanvas}
                          >
                            {isDeletingBlankCanvas ? (
                              <>
                                <Loader2 className="mr-1.5 size-3 animate-spin" />
                                Removing...
                              </>
                            ) : (
                              <>
                                <Trash2 className="mr-1.5 size-3" />
                                Remove Blank Canvas
                              </>
                            )}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground italic text-center py-1">
                            No blank canvas uploaded yet. Upload a furniture-removed version of this listing photo.
                          </p>
                          <Input
                            type="file"
                            accept="image/*"
                            id="blank-canvas-file"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              await handleUploadBlankCanvas(file);
                              e.target.value = "";
                            }}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-full text-xs font-medium bg-background text-foreground"
                            onClick={() => document.getElementById("blank-canvas-file")?.click()}
                            disabled={isUploadingBlankCanvas}
                          >
                            {isUploadingBlankCanvas ? (
                              <>
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                Uploading...
                              </>
                            ) : (
                              <>
                                <Upload className="mr-1.5 size-3.5" />
                                Upload Blank Canvas
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* AI Renders / Modifications Section */}
                  {category === "listing" && selectedImage.raw.listingPhoto && (
                    <div className="space-y-4 rounded-xl border border-border/40 bg-muted/5 p-4 shadow-sm ring-1 ring-border/20">
                      <div className="flex items-center justify-between border-b border-border/40 pb-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
                          ✨ AI Renders & Before/After
                        </h3>
                        <Badge variant="secondary" className="text-[10px]">
                          {selectedImage.raw.listingPhoto.aiEdits?.length || 0} versions
                        </Badge>
                      </div>

                      {/* Displaying AI edits / comparisons */}
                      {selectedImage.raw.listingPhoto.aiEdits && selectedImage.raw.listingPhoto.aiEdits.length > 0 ? (
                        <div className="space-y-3">
                          {selectedImage.raw.listingPhoto.aiEdits.map((edit: NonNullable<ListingPhotoRecord["aiEdits"]>[number]) => (
                            <div key={`edit-${edit.id}`} className="flex flex-col gap-2 rounded-lg bg-card border border-border/30 p-2.5 shadow-sm hover:border-amber-500/30 transition-all">
                              <div className="flex gap-2">
                                <div className="relative size-12 shrink-0 overflow-hidden rounded-md border border-border/40 bg-muted">
                                  {/* biome-ignore lint/performance/noImgElement: External Cloudflare url */}
                                  <img src={edit.path} alt={edit.prompt} className="size-full object-cover" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-medium text-foreground" title={edit.prompt}>
                                    {edit.prompt}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {new Date(String(edit.datetimeCreated ?? "")).toLocaleDateString()}
                                  </p>
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 w-full text-[11px] font-medium border-amber-500/20 text-amber-300 bg-amber-500/5 hover:bg-amber-500/10"
                                onClick={() => {
                                  setComparisonModal({
                                    open: true,
                                    beforeSrc: selectedImage.path,
                                    afterSrc: edit.path,
                                    beforeLabel: "Original Photo",
                                    afterLabel: `AI: ${edit.prompt}`,
                                  });
                                }}
                              >
                                <ChevronsLeftRight className="mr-1.5 size-3.5" />
                                Compare Before / After
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic text-center py-2 bg-muted/10 rounded-lg">
                          No AI-rendered images uploaded yet.
                        </p>
                      )}

                      {/* Upload new AI Render Form */}
                      <div className="space-y-3 border-t border-border/30 pt-3">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Upload New AI Render
                        </p>
                        
                        <div className="space-y-2">
                          <Input
                            type="text"
                            placeholder="Prompt (e.g. Modern kitchen with brass hardware)"
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            className="h-8 text-xs"
                          />
                          
                          <div className="flex items-center gap-2">
                            <Input
                              type="file"
                              accept="image/*"
                              id="ai-render-file"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                await handleUploadAiRender(file);
                              }}
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-full text-xs font-medium bg-background text-foreground"
                              onClick={() => document.getElementById("ai-render-file")?.click()}
                              disabled={isUploadingAiRender}
                            >
                              {isUploadingAiRender ? (
                                <>
                                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                  Uploading...
                                </>
                              ) : (
                                "Select Image & Upload"
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Uploaded {selectedImage.createdAt}
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={() => setPreviewOpen(true)}>
                      <ZoomIn className="mr-2 size-4" />
                      Preview
                    </Button>
                    <Button variant="outline" onClick={() => openReplaceCropModal(selectedImage)}>
                      <Crop className="mr-2 size-4" />
                      Crop & Save
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={saveSelectedImage} disabled={isSaving}>
                      {isSaving ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Saving
                        </>
                      ) : (
                        <>
                          <Check className="mr-2 size-4" />
                          Save
                        </>
                      )}
                    </Button>

                    <Button
                      variant="destructive"
                      onClick={requestDeleteSelectedImage}
                      disabled={isDeleting}
                    >
                      {isDeleting ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Deleting
                        </>
                      ) : (
                        <>
                          <Trash2 className="mr-2 size-4" />
                          Delete
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {selectedImage && (
        <ImagePreview
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          src={selectedImage.path}
          alt={selectedImage.name}
          title={selectedImage.name}
          metadata={{
            room: selectedImage.room,
            roomLabels: selectedImage.roomLabels,
            createdAt: selectedImage.createdAt,
            ...selectedImage.metadata.raw,
          }}
        />
      )}

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Photo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Delete{" "}
              <span className="font-medium text-foreground">
                {deleteTargetImage?.name || "this photo"}
              </span>{" "}
              from Cloudflare Images and D1?
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  setDeleteTargetImage(null);
                }}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={performDeleteImage} disabled={isDeleting}>
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Deleting
                  </>
                ) : (
                  "Delete"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={replaceCropModalOpen}
        onOpenChange={(open) => (open ? setReplaceCropModalOpen(true) : closeReplaceCropModal())}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Crop Uploaded Image</DialogTitle>
          </DialogHeader>

          {replaceCropTargetImage && (
            <div className="space-y-4">
              <div className="relative h-[22rem] overflow-hidden rounded-xl bg-muted/30 ring-1 ring-border/40">
                <Cropper
                  crop={replaceCropState.crop}
                  zoom={replaceCropState.zoom}
                  rotation={replaceCropState.rotation}
                  aspectRatio={4 / 3}
                  withGrid
                  onCropChange={(crop) => setReplaceCropState((prev) => ({ ...prev, crop }))}
                  onZoomChange={(zoom) => setReplaceCropState((prev) => ({ ...prev, zoom }))}
                  onRotationChange={(rotation) =>
                    setReplaceCropState((prev) => ({ ...prev, rotation }))
                  }
                  onCropAreaChange={(_, areaPixels) =>
                    setReplaceCropState((prev) => ({ ...prev, areaPixels }))
                  }
                >
                  <CropperImage
                    src={replaceCropTargetImage.path}
                    alt="Crop target"
                    crossOrigin="anonymous"
                  />
                  <CropperArea />
                </Cropper>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="text-muted-foreground">
                    Zoom ({replaceCropState.zoom.toFixed(2)}x)
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    step={0.05}
                    value={replaceCropState.zoom}
                    onChange={(event) =>
                      setReplaceCropState((prev) => ({
                        ...prev,
                        zoom: Number(event.target.value),
                      }))
                    }
                    className="w-full"
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span className="text-muted-foreground">
                    Rotation ({Math.round(replaceCropState.rotation)}°)
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={replaceCropState.rotation}
                    onChange={(event) =>
                      setReplaceCropState((prev) => ({
                        ...prev,
                        rotation: Number(event.target.value),
                      }))
                    }
                    className="w-full"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeReplaceCropModal} disabled={savingReplacementCrop}>
                  Cancel
                </Button>
                <Button onClick={saveReplacementCrop} disabled={savingReplacementCrop}>
                  {savingReplacementCrop ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Saving
                    </>
                  ) : (
                    <>
                      <Crop className="mr-2 size-4" />
                      Save Crop
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Premium Image Comparison Modal */}
      <Dialog
        open={comparisonModal.open}
        onOpenChange={(open) => setComparisonModal((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="sm:max-w-4xl border border-border/40 bg-card/90 shadow-2xl backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <ChevronsLeftRight className="size-5 text-amber-500 animate-pulse" />
              Before & After Comparison
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 overflow-hidden rounded-xl border border-border/40 bg-muted/10 p-1">
            {comparisonModal.open && (
              <ImageComparison
                beforeSrc={comparisonModal.beforeSrc}
                afterSrc={comparisonModal.afterSrc}
                beforeLabel={comparisonModal.beforeLabel}
                afterLabel={comparisonModal.afterLabel}
                aspectClassName="aspect-video w-full max-h-[70vh] object-contain"
              />
            )}
          </div>
          <div className="flex justify-between items-center mt-3 text-xs text-muted-foreground bg-muted/20 px-3 py-2 rounded-lg border border-border/30">
            <span className="truncate max-w-[80%] font-medium text-foreground">
              {comparisonModal.afterLabel}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setComparisonModal((prev) => ({ ...prev, open: false }))}
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Slider Demo Modal */}
      <Dialog
        open={demoSliderOpen}
        onOpenChange={setDemoSliderOpen}
      >
        <DialogContent className="sm:max-w-4xl border border-border/40 bg-card/90 shadow-2xl backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <ChevronsLeftRight className="size-5 text-amber-500 animate-pulse" />
              Interactive Diff Slider Demo
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <p className="text-xs text-muted-foreground">
              This demo showcases our new premium, hardware-accelerated <strong>ImageComparison</strong> component.
              Drag directly on the image or use your mouse/finger to slide the divider and compare.
              You can also focus the slider and use the <strong>Arrow Left</strong> and <strong>Arrow Right</strong> keys on your keyboard!
            </p>
            <div className="overflow-hidden rounded-xl border border-border/40 bg-muted/10 p-1">
              {demoSliderOpen && (
                <ImageComparison
                  beforeSrc="https://images.unsplash.com/photo-1513694203232-719a280e022f?q=80&w=1200"
                  afterSrc="https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?q=80&w=1200"
                  beforeLabel="Original Room (Before)"
                  afterLabel="Premium Remodel Render (After)"
                  aspectClassName="aspect-video w-full max-h-[60vh] object-contain"
                />
              )}
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDemoSliderOpen(false)}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
