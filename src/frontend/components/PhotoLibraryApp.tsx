import {
  Check,
  Crop,
  FileImage,
  Home,
  Images,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Tag,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cropper, CropperArea, CropperImage, type CropperAreaData } from "@/components/ui/cropper";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GridBento } from "@/components/ui/grid-bento";
import { ImageGallery } from "@/components/ui/image-gallery";
import { ImageGalleryMasonry } from "@/components/ui/image-gallery-masonry";
import { ImagePreview } from "@/components/ui/image-preview";
import { Input } from "@/components/ui/input";
import { MultipleSelector, type MultipleSelectorOption } from "@/components/ui/multiple-selector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
    const deliveryUrl = typeof parsed.deliveryUrl === "string" ? parsed.deliveryUrl : undefined;
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
  const fallbackName = primaryRoom === "unassigned" ? "Untitled photo" : `${primaryRoom} photo`;

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
            highlightType: highlight.highlightType === "dislike" ? "dislike" : "like",
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

  const [catalogFloors, setCatalogFloors] = useState<CatalogFloor[]>([]);
  const [catalogRooms, setCatalogRooms] = useState<CatalogRoom[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [panelDisplayName, setPanelDisplayName] = useState("");
  const [panelFloorKey, setPanelFloorKey] = useState("lower_level");
  const [panelRoomId, setPanelRoomId] = useState("");
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
  const highlightSurfaceRef = useRef<HTMLDivElement | null>(null);

  const [replaceCropModalOpen, setReplaceCropModalOpen] = useState(false);
  const [replaceCropTargetImage, setReplaceCropTargetImage] = useState<ViewImageRecord | null>(
    null,
  );
  const [replaceCropState, setReplaceCropState] = useState<CropState>({
    crop: { x: 0, y: 0 },
    zoom: 1,
    rotation: 0,
    areaPixels: null,
  });
  const [savingReplacementCrop, setSavingReplacementCrop] = useState(false);

  const lowerFloor = useMemo(
    () => catalogFloors.find((floor) => floor.key === "lower_level") || catalogFloors[0] || null,
    [catalogFloors],
  );

  const upperFloor = useMemo(
    () =>
      catalogFloors.find((floor) => floor.key === "upper_level") ||
      catalogFloors[catalogFloors.length - 1] ||
      null,
    [catalogFloors],
  );

  const isPanelFloorUpper = panelFloorKey === upperFloor?.key;

  const panelRoomsForSelectedFloor = useMemo(() => {
    const floor = catalogFloors.find((item) => item.key === panelFloorKey);
    return floor?.rooms || [];
  }, [catalogFloors, panelFloorKey]);

  const handlePanelFloorToggle = useCallback(
    (checked: boolean) => {
      const nextFloorKey = checked ? upperFloor?.key : lowerFloor?.key;
      if (!nextFloorKey) {
        return;
      }
      setPanelFloorKey(nextFloorKey);
      setPanelRoomId("");
    },
    [lowerFloor?.key, upperFloor?.key],
  );

  const handlePanelRoomChange = useCallback(
    (nextRoomId: string) => {
      setPanelRoomId(nextRoomId);
      const nextRoom = catalogRooms.find((room) => room.id === Number(nextRoomId));
      if (nextRoom && nextRoom.floorKey !== panelFloorKey) {
        setPanelFloorKey(nextRoom.floorKey);
      }
    },
    [catalogRooms, panelFloorKey],
  );

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
      if (reviewMode && mapped.length > 0 && !selectedImage) {
        setSelectedImage(mapped[0]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load images");
    } finally {
      setLoading(false);
    }
  }, [category, reviewMode, selectedImage]);

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
      if (reviewMode && mapped.length > 0 && !selectedImage) {
        setSelectedImage(mapped[0]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh images");
    } finally {
      setRefreshing(false);
    }
  }, [category, reviewMode, selectedImage]);

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
      const options = Array.isArray(payload.tags)
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

      setCatalogFloors(normalizedFloors);
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
      const matchedRoom =
        selectedImage.roomId !== null && selectedImage.roomId !== undefined
          ? catalogRooms.find((room) => room.id === selectedImage.roomId)
          : null;

      if (matchedRoom) {
        setPanelRoomId(String(matchedRoom.id));
        setPanelFloorKey(matchedRoom.floorKey);
      } else {
        setPanelRoomId("");
        if (lowerFloor) {
          setPanelFloorKey(lowerFloor.key);
        }
      }
      setPanelRoomIds([]);
    } else {
      setPanelRoomIds(selectedImage.roomIds.map((roomId) => String(roomId)));
      setPanelRoomId("");
      if (lowerFloor) {
        setPanelFloorKey(lowerFloor.key);
      }
    }
  }, [category, catalogRooms, lowerFloor, selectedImage]);

  useEffect(() => {
    if (panelRoomId.length === 0) {
      return;
    }

    const existsInFloor = panelRoomsForSelectedFloor.some(
      (room) => room.id === Number(panelRoomId),
    );
    if (!existsInFloor) {
      setPanelRoomId("");
    }
  }, [panelRoomId, panelRoomsForSelectedFloor]);

  useEffect(() => {
    if (!reviewMode) {
      return;
    }
    if (!selectedImage && images.length > 0) {
      setSelectedImage(images[0]);
    }
  }, [images, reviewMode, selectedImage]);

  const openImage = (image: ViewImageRecord) => {
    setSelectedImage(image);
    setPreviewOpen(false);
  };

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

  const moveHighlightDraw = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
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
    },
    [draftHighlight, isDrawingHighlight],
  );

  const endHighlightDraw = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
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
    },
    [draftHighlight],
  );

  const saveSelectedImage = useCallback(async () => {
    if (!selectedImage) return;

    if (category === "listing" && !panelRoomId) {
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
        const roomId = panelRoomId ? Number(panelRoomId) : null;
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

  const requestDeleteSelectedImage = useCallback(() => {
    if (!selectedImage) {
      return;
    }
    setDeleteTargetImage(selectedImage);
    setDeleteConfirmOpen(true);
  }, [selectedImage]);

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
            </div>

            <div className="flex items-center gap-2">
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
                        <button
                          key={`thumb-${image.id}`}
                          type="button"
                          onClick={() => openImage(image)}
                          className={cn(
                            "overflow-hidden rounded-lg border ring-1 ring-border/40",
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
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : viewMode === "bento" ? (
              <GridBento
                items={flatItems}
                selectedId={selectedImage?.id}
                onSelect={(item) => {
                  const found = images.find((entry) => entry.id === item.id);
                  if (found) openImage(found);
                }}
              />
            ) : viewMode === "gallery" ? (
              <ImageGallery
                items={flatItems}
                selectedId={selectedImage?.id}
                onSelect={(item) => {
                  const found = images.find((entry) => entry.id === item.id);
                  if (found) openImage(found);
                }}
              />
            ) : viewMode === "masonry" ? (
              <ImageGalleryMasonry
                items={flatItems}
                selectedId={selectedImage?.id}
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
              <h2 className="truncate pr-4 text-sm font-semibold">
                {selectedImage?.name ?? "Details"}
              </h2>
              {!reviewMode ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={closeSelection}
                  title="Close details"
                >
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
                        ✨ AI prefill rationale:{" "}
                        {selectedImage.metadata.aiPrefill.displayName.rationale}
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
                        <div className="flex items-center justify-between rounded-md bg-background/80 px-3 py-2 ring-1 ring-border/40">
                          <span
                            className={cn(
                              "text-xs font-medium",
                              !isPanelFloorUpper ? "text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {lowerFloor?.name ?? "Downstairs"}
                          </span>
                          <Switch
                            checked={isPanelFloorUpper}
                            onCheckedChange={handlePanelFloorToggle}
                            aria-label="Toggle listing room floor"
                            disabled={catalogLoading || !lowerFloor || !upperFloor}
                          />
                          <span
                            className={cn(
                              "text-xs font-medium",
                              isPanelFloorUpper ? "text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {upperFloor?.name ?? "Upstairs"}
                          </span>
                        </div>

                        <Select
                          value={panelRoomId}
                          onValueChange={handlePanelRoomChange}
                          disabled={catalogLoading}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue
                              placeholder={
                                catalogLoading ? "Loading rooms..." : "Select listing room"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {panelRoomsForSelectedFloor.map((room) => (
                              <SelectItem key={room.id} value={String(room.id)}>
                                {room.displayName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Room is required for listing photos.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 rounded-lg bg-muted/20 p-3 ring-1 ring-border/30">
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
                        <SelectTrigger className="h-8 w-[9rem] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="like">I Like This</SelectItem>
                          <SelectItem value="dislike">I Do Not Like This</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Drag on the image above to create a{" "}
                      {highlightMode === "like" ? "liked" : "disliked"} region.
                    </p>
                    <div className="space-y-2">
                      {panelHighlights.map((highlight, index) => (
                        <div
                          key={`highlight-editor-${index}`}
                          className="rounded-md border border-border/40 p-2"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <Badge
                              variant={
                                highlight.highlightType === "like" ? "default" : "destructive"
                              }
                            >
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
        <DialogContent className="max-w-md">
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
        <DialogContent className="max-w-4xl">
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
                <Button
                  variant="outline"
                  onClick={closeReplaceCropModal}
                  disabled={savingReplacementCrop}
                >
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
    </>
  );
}
