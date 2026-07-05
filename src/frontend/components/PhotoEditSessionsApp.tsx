import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Eraser,
  Loader2,
  Paintbrush,
  Plus,
  RefreshCw,
  Sofa,
  Sparkles,
  Brush,
  Trash2,
  Upload,
  Wand2,
  Layers,
  Image as ImageIcon,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ImageCompareSlider } from "@/components/ImageCompareSlider";
import { ImagePreview } from "@/components/ui/image-preview";

import {
  Stepper,
  StepperContent,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperList,
  StepperNext,
  StepperPrev,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { InlineMaskEditor } from "@/components/ui/InlineMaskEditor";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImageRecord {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  roomId?: number | null;
  roomLabels?: string[];
  roomType?: string | null;
  metadata?: string | null;
  photoCategory?: "inspirational" | "listing" | "ai_render";
  listingPhoto?: {
    id: number;
    roomId?: number | null;
    roomName?: string | null;
    description?: string | null;
    blankCanvasCfImageId?: string | null;
    skipBlankCanvas?: boolean;
    [key: string]: unknown;
  } | null;
}

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

interface EditSession {
  id: string;
  name: string;
  sourceImageId?: string | null;
  datetimeCreated?: string | number | Date;
  datetimeLastModified?: string | number | Date;
  revisionCount?: number;
}

interface EditRevision {
  id: string;
  sessionId: string;
  sourceImageId?: string | null;
  outputImageId: string;
  prompt: string;
  model?: string | null;
  revisionNumber: number;
  datetimeCreated?: string | number | Date;
  sourceImage?: ImageRecord | null;
  outputImage?: ImageRecord | null;
}

type EditCategory = "layout" | "paint" | "staging" | "stitch";

interface CategoryPromptConfig {
  key: EditCategory;
  title: string;
  description: string;
  icon: React.ReactNode;
  defaultPrompt: string;
  supportsMask: boolean;
}

const EDIT_CATEGORIES: CategoryPromptConfig[] = [
  {
    key: "layout",
    title: "Wall Layout Change",
    description:
      "Open walls, move zones, remove fixed elements, and establish a base canvas.",
    icon: <Layers className="size-5" />,
    defaultPrompt:
      "Remove all furniture and personal items from this room. Open the wall between the kitchen and living area. Keep the structural elements, windows, and flooring intact.",
    supportsMask: true,
  },
  {
    key: "paint",
    title: "Paint Color Visuals",
    description: "Test color systems, sheen, and finish detail prompts.",
    icon: <Paintbrush className="size-5" />,
    defaultPrompt:
      "Repaint all walls in this room to a warm greige (similar to Benjamin Moore Revere Pewter HC-172). Keep the trim and ceiling white. Preserve all furniture, lighting, and decor exactly as they are.",
    supportsMask: true,
  },
  {
    key: "staging",
    title: "Staging / Furniture",
    description: "Show furniture, lighting, and styling concepts.",
    icon: <Sofa className="size-5" />,
    defaultPrompt:
      "Stage this empty room with modern transitional furniture: a sectional sofa, accent chairs, coffee table, area rug, and ambient lighting. Keep the wall color, flooring, and windows exactly as they are.",
    supportsMask: true,
  },
  {
    key: "stitch",
    title: "Inspirational Stitching",
    description:
      "Extract details from inspiration photos and apply to listing angles.",
    icon: <Wand2 className="size-5" />,
    defaultPrompt:
      "Using the provided inspiration image(s), extract the key design elements (furniture style, color palette, material finishes) and apply them to this room photo. Maintain the room's architecture, windows, and flooring.",
    supportsMask: false,
  },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const fileKey = (file: File) =>
  `${file.name}-${file.size}-${file.type}-${file.lastModified}`;

function parseMetadata(raw: string | null | undefined): { deliveryUrl?: string } {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as { deliveryUrl?: string };
  } catch {
    return {};
  }
}

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

function getImageDisplayName(
  image: ImageRecord | null | undefined,
  fallback: string = "Untitled photo",
): string {
  if (!image) {
    return fallback;
  }
  const explicit = image.displayName?.trim();
  if (explicit) {
    return explicit;
  }
  const room = image.roomType?.trim();
  if (room) {
    return `${room} photo`;
  }
  return fallback;
}

function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function resolveRoomName(
  image: ImageRecord,
  catalogFloors: CatalogFloor[],
): { roomName: string; floorName: string } {
  // 1. Listing photo roomName is the most specific
  if (image.listingPhoto?.roomName) {
    // Try to find the floor
    for (const floor of catalogFloors) {
      const matched = floor.rooms.find(
        (room) =>
          room.roomName === image.listingPhoto?.roomName ||
          room.displayName === image.listingPhoto?.roomName,
      );
      if (matched) {
        return {
          roomName: matched.displayName || matched.roomName,
          floorName: floor.name,
        };
      }
    }
    return { roomName: image.listingPhoto.roomName, floorName: "Unassigned" };
  }

  // 2. Catalog room lookup via roomId
  if (image.roomId) {
    for (const floor of catalogFloors) {
      const matched = floor.rooms.find((room) => room.id === image.roomId);
      if (matched) {
        return {
          roomName: matched.displayName || matched.roomName,
          floorName: floor.name,
        };
      }
    }
  }

  // 3. roomLabels array
  if (Array.isArray(image.roomLabels) && image.roomLabels.length > 0) {
    for (const floor of catalogFloors) {
      const matched = floor.rooms.find((room) =>
        image.roomLabels?.includes(room.roomName),
      );
      if (matched) {
        return {
          roomName: matched.displayName || matched.roomName,
          floorName: floor.name,
        };
      }
    }
    return { roomName: image.roomLabels[0], floorName: "Unassigned" };
  }

  // 4. roomType fallback
  if (image.roomType) {
    return { roomName: image.roomType, floorName: "Unassigned" };
  }

  return { roomName: "Unassigned", floorName: "Unassigned" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PhotoEditSessionsApp() {
  const [sessions, setSessions] = useState<EditSession[]>([]);
  const [sourceImages, setSourceImages] = useState<ImageRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<EditSession | null>(null);
  const [sessionSourceImage, setSessionSourceImage] = useState<ImageRecord | null>(null);
  const [revisions, setRevisions] = useState<EditRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSession, setLoadingSession] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);

  // Revision form (inline after session selection)
  const [prompt, setPrompt] = useState("");
  const [roomType, setRoomType] = useState("");
  const [maskBase64, setMaskBase64] = useState<string | null>(null);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [creatingRevision, setCreatingRevision] = useState(false);
  const [useBlankCanvas, setUseBlankCanvas] = useState(true);

  // Room catalog
  const [catalogFloors, setCatalogFloors] = useState<CatalogFloor[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Wizard state
  const [sessionWizardOpen, setSessionWizardOpen] = useState(false);
  const [sessionWizardStep, setSessionWizardStep] = useState(1);
  const [wizardSelectedSourceImageIds, setWizardSelectedSourceImageIds] = useState<string[]>([]);
  const [wizardPreviewImageId, setWizardPreviewImageId] = useState<string | null>(null);
  const [wizardUseBlankCanvas, setWizardUseBlankCanvas] = useState(true);
  const [wizardRoomType, setWizardRoomType] = useState("");
  const [wizardSessionName, setWizardSessionName] = useState("");

  // Multi-select categories
  const [wizardSelectedCategories, setWizardSelectedCategories] = useState<Set<EditCategory>>(
    new Set(),
  );

  // Per-category prompts and config
  const [categoryPrompts, setCategoryPrompts] = useState<Record<EditCategory, string>>({
    layout: EDIT_CATEGORIES[0].defaultPrompt,
    paint: EDIT_CATEGORIES[1].defaultPrompt,
    staging: EDIT_CATEGORIES[2].defaultPrompt,
    stitch: EDIT_CATEGORIES[3].defaultPrompt,
  });
  const [categoryMasks, setCategoryMasks] = useState<Record<EditCategory, string | null>>({
    layout: null,
    paint: null,
    staging: null,
    stitch: null,
  });
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0);

  // Stitch-specific: inspo picker
  const [stitchInspoMode, setStitchInspoMode] = useState<"existing" | "upload">("existing");
  const [stitchSelectedInspoIds, setStitchSelectedInspoIds] = useState<string[]>([]);
  const [stitchUploadedFiles, setStitchUploadedFiles] = useState<File[]>([]);
  const [showAllInspo, setShowAllInspo] = useState(false);

  // Processing state
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchResults, setBatchResults] = useState<
    Array<{ category: string; success: boolean; error?: string }>
  >([]);

  const requestedSourceImageIdRef = useRef<string | null>(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("sourceImageId")
      : null,
  );

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadSourceImages = useCallback(async () => {
    const response = await fetch("/api/images");
    const payload = (await response.json()) as { images?: ImageRecord[] };
    if (!response.ok) {
      throw new Error("Failed to load source images");
    }
    const rows = Array.isArray(payload.images) ? payload.images : [];
    setSourceImages(rows.filter((row) => row.photoCategory !== "ai_render"));
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
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
        rooms: Array.isArray(floor.rooms)
          ? floor.rooms.map((room) => ({
              ...room,
              floorKey: floor.key,
              floorName: floor.name,
            }))
          : [],
      }));

      setCatalogFloors(normalizedFloors);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    const response = await fetch("/api/photo-edits/sessions");
    const payload = (await response.json()) as { sessions?: EditSession[] };
    if (!response.ok) {
      throw new Error("Failed to load edit sessions");
    }

    const rows = Array.isArray(payload.sessions) ? payload.sessions : [];
    setSessions(rows);

    if (!selectedSessionId && rows.length > 0) {
      setSelectedSessionId(rows[0].id);
    }
  }, [selectedSessionId]);

  const loadSelectedSession = useCallback(async () => {
    if (!selectedSessionId) {
      setSelectedSession(null);
      setSessionSourceImage(null);
      setRevisions([]);
      return;
    }

    setLoadingSession(true);
    try {
      const response = await fetch(`/api/photo-edits/sessions/${selectedSessionId}`);
      const payload = (await response.json()) as {
        session?: EditSession;
        sourceImage?: ImageRecord | null;
        revisions?: EditRevision[];
      };

      if (!response.ok || !payload.session) {
        throw new Error("Failed to load session details");
      }

      setSelectedSession(payload.session);
      const src = payload.sourceImage ?? null;
      setSessionSourceImage(src);
      setRevisions(Array.isArray(payload.revisions) ? payload.revisions : []);

      // Auto-fill room type from source image
      if (src) {
        const { roomName } = resolveRoomName(src, catalogFloors);
        if (roomName && roomName !== "Unassigned") {
          setRoomType(roomName.toLowerCase());
        }
        // Auto-set blank canvas toggle
        setUseBlankCanvas(!!src.listingPhoto?.blankCanvasCfImageId);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load session");
    } finally {
      setLoadingSession(false);
    }
  }, [selectedSessionId, catalogFloors]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await Promise.all([loadSourceImages(), loadSessions(), loadCatalog()]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load editor");
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [loadCatalog, loadSessions, loadSourceImages]);

  useEffect(() => {
    loadSelectedSession();
  }, [loadSelectedSession]);

  useEffect(() => {
    const onGlobalUploadComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{ target?: string }>;
      if (
        customEvent.detail?.target !== "images" &&
        customEvent.detail?.target !== "photo-reviews"
      ) {
        return;
      }

      void Promise.all([loadSourceImages(), loadSessions(), loadCatalog()]);
      if (selectedSessionId) {
        void loadSelectedSession();
      }
    };

    window.addEventListener("global-upload-complete", onGlobalUploadComplete);
    return () => {
      window.removeEventListener("global-upload-complete", onGlobalUploadComplete);
    };
  }, [loadCatalog, loadSelectedSession, loadSessions, loadSourceImages, selectedSessionId]);

  // Auto-open wizard if sourceImageId in URL
  useEffect(() => {
    const requestedSourceImageId = requestedSourceImageIdRef.current;
    if (!requestedSourceImageId) {
      return;
    }
    const matched = sourceImages.find((image) => image.id === requestedSourceImageId);
    if (!matched) {
      return;
    }

    setSessionWizardOpen(true);
    setSessionWizardStep(2);
    setWizardSelectedSourceImageIds([matched.id]);
    setWizardPreviewImageId(matched.id);
    setWizardSessionName(`${getImageDisplayName(matched, "Photo")} Edit Session`);

    // Auto-fill room
    const { roomName } = resolveRoomName(matched, catalogFloors);
    if (roomName && roomName !== "Unassigned") {
      setWizardRoomType(roomName.toLowerCase());
    }
    // Auto-set blank canvas
    setWizardUseBlankCanvas(!!matched.listingPhoto?.blankCanvasCfImageId);

    requestedSourceImageIdRef.current = null;
  }, [sourceImages, catalogFloors]);

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------

  const catalogRooms = useMemo(
    () => catalogFloors.flatMap((floor) => floor.rooms),
    [catalogFloors],
  );

  const listingPhotosByFloorAndRoom = useMemo(() => {
    const listingImages = sourceImages.filter(
      (image) => image.photoCategory === "listing",
    );

    const groups: Array<{
      floor: CatalogFloor;
      rooms: Array<{ room: CatalogRoom; images: ImageRecord[] }>;
    }> = [];

    for (const floor of catalogFloors) {
      const roomGroups: Array<{ room: CatalogRoom; images: ImageRecord[] }> = [];
      for (const room of floor.rooms) {
        const matched = listingImages.filter((image) => {
          if (image.roomId === room.id) return true;
          if (
            Array.isArray(image.roomLabels) &&
            image.roomLabels.includes(room.roomName)
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

    // Catch any listing photos that don't match a catalog room
    const matchedIds = new Set(
      groups.flatMap((g) => g.rooms.flatMap((r) => r.images.map((i) => i.id))),
    );
    const unmatched = listingImages.filter((image) => !matchedIds.has(image.id));

    return { groups, unmatched };
  }, [catalogFloors, sourceImages]);

  const inspirationImages = useMemo(() => {
    return sourceImages.filter((image) => image.photoCategory === "inspirational");
  }, [sourceImages]);

  // Filter inspo by room for the stitch picker
  const filteredInspoImages = useMemo(() => {
    if (showAllInspo) return inspirationImages;
    if (wizardSelectedSourceImageIds.length === 0) return inspirationImages;

    const firstSource = sourceImages.find(
      (img) => img.id === wizardSelectedSourceImageIds[0],
    );
    if (!firstSource) return inspirationImages;

    const { roomName } = resolveRoomName(firstSource, catalogFloors);
    if (!roomName || roomName === "Unassigned") return inspirationImages;

    const filtered = inspirationImages.filter((img) => {
      if (img.roomType?.toLowerCase() === roomName.toLowerCase()) return true;
      if (
        Array.isArray(img.roomLabels) &&
        img.roomLabels.some((label) => label.toLowerCase() === roomName.toLowerCase())
      )
        return true;
      return false;
    });

    // If filtering yields nothing, show all
    return filtered.length > 0 ? filtered : inspirationImages;
  }, [
    inspirationImages,
    showAllInspo,
    wizardSelectedSourceImageIds,
    sourceImages,
    catalogFloors,
  ]);

  const wizardPreviewImage = useMemo(
    () =>
      wizardPreviewImageId
        ? sourceImages.find((image) => image.id === wizardPreviewImageId) || null
        : null,
    [sourceImages, wizardPreviewImageId],
  );

  // Ordered list of selected categories for the walkthrough
  const orderedSelectedCategories = useMemo(() => {
    return EDIT_CATEGORIES.filter((cat) => wizardSelectedCategories.has(cat.key));
  }, [wizardSelectedCategories]);

  const activeCategory = orderedSelectedCategories[activeCategoryIndex] ?? null;

  // ---------------------------------------------------------------------------
  // Wizard actions
  // ---------------------------------------------------------------------------

  const resetSessionWizard = useCallback(() => {
    setSessionWizardStep(1);
    setWizardSelectedSourceImageIds([]);
    setWizardPreviewImageId(null);
    setWizardRoomType("");
    setWizardSessionName("");
    setWizardUseBlankCanvas(true);
    setWizardSelectedCategories(new Set());
    setCategoryPrompts({
      layout: EDIT_CATEGORIES[0].defaultPrompt,
      paint: EDIT_CATEGORIES[1].defaultPrompt,
      staging: EDIT_CATEGORIES[2].defaultPrompt,
      stitch: EDIT_CATEGORIES[3].defaultPrompt,
    });
    setCategoryMasks({ layout: null, paint: null, staging: null, stitch: null });
    setActiveCategoryIndex(0);
    setStitchInspoMode("existing");
    setStitchSelectedInspoIds([]);
    setStitchUploadedFiles([]);
    setShowAllInspo(false);
    setBatchProcessing(false);
    setBatchResults([]);
  }, []);

  const openSessionWizard = useCallback(() => {
    resetSessionWizard();
    setSessionWizardOpen(true);
  }, [resetSessionWizard]);

  // When source photos are selected, auto-fill room and session name
  useEffect(() => {
    if (wizardSelectedSourceImageIds.length === 0) return;
    const firstImage = sourceImages.find(
      (img) => img.id === wizardSelectedSourceImageIds[0],
    );
    if (!firstImage) return;

    // Auto-fill room type
    const { roomName } = resolveRoomName(firstImage, catalogFloors);
    if (roomName && roomName !== "Unassigned") {
      setWizardRoomType(roomName.toLowerCase());
    }

    // Auto-fill session name
    if (!wizardSessionName.trim()) {
      const displayName = getImageDisplayName(firstImage, "Photo");
      setWizardSessionName(`${displayName} Edit Session`);
    }

    // Auto-set blank canvas toggle
    setWizardUseBlankCanvas(!!firstImage.listingPhoto?.blankCanvasCfImageId);
  }, [wizardSelectedSourceImageIds, sourceImages, catalogFloors]);

  // Resolve the source image URL to show in the wizard (original vs blank canvas)
  const resolveWizardSourceUrl = useCallback(
    (image: ImageRecord): string => {
      if (
        wizardUseBlankCanvas &&
        image.listingPhoto?.blankCanvasCfImageId
      ) {
        const token = image.listingPhoto.blankCanvasCfImageId;
        return token.startsWith("http")
          ? token
          : `https://imagedelivery.net/${token}/public`;
      }
      return resolveImageUrl(image);
    },
    [wizardUseBlankCanvas],
  );

  // Submit wizard: create session + auto-process all selected categories
  const submitSessionWizard = useCallback(async () => {
    if (wizardSelectedSourceImageIds.length === 0) {
      toast.error("Select at least one source listing photo");
      setSessionWizardStep(1);
      return;
    }

    if (wizardSelectedCategories.size === 0) {
      toast.error("Select at least one edit category");
      setSessionWizardStep(2);
      return;
    }

    const sessionName =
      wizardSessionName.trim() ||
      `Edit Session ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

    setBatchProcessing(true);
    setBatchResults([]);

    try {
      // 1. Create session
      const sourceImageId = wizardSelectedSourceImageIds[0];
      const createRes = await fetch("/api/photo-edits/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sessionName,
          sourceImageId,
        }),
      });
      const createPayload = (await createRes.json()) as {
        session?: EditSession;
        error?: string;
      };

      if (!createRes.ok || !createPayload.session) {
        throw new Error(createPayload.error ?? "Failed to create session");
      }

      const createdSessionId = createPayload.session.id;

      // 2. Build revision specs for each selected category
      const firstImage = sourceImages.find((img) => img.id === sourceImageId);
      const blankCanvasId =
        wizardUseBlankCanvas && firstImage?.listingPhoto?.blankCanvasCfImageId
          ? firstImage.listingPhoto.blankCanvasCfImageId
          : undefined;

      const revisionSpecs = orderedSelectedCategories.map((cat) => ({
        prompt: categoryPrompts[cat.key] || cat.defaultPrompt,
        sourceImageId,
        roomType: wizardRoomType || undefined,
        maskBase64: categoryMasks[cat.key] || undefined,
        blankCanvasImageId: blankCanvasId,
        category: cat.key,
        inspoImageIds:
          cat.key === "stitch" ? stitchSelectedInspoIds : undefined,
      }));

      // 3. Fire batch endpoint
      const batchRes = await fetch(
        `/api/photo-edits/sessions/${createdSessionId}/revisions/batch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revisions: revisionSpecs }),
        },
      );

      const batchPayload = (await batchRes.json()) as {
        success: boolean;
        results: Array<{
          category: string | null;
          success: boolean;
          error?: string;
        }>;
      };

      const results = (batchPayload.results || []).map((r) => ({
        category: r.category || "unknown",
        success: r.success,
        error: r.error,
      }));

      setBatchResults(results);

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      if (successCount > 0) {
        toast.success(
          `Generated ${successCount} revision${successCount > 1 ? "s" : ""}${failCount > 0 ? ` (${failCount} failed)` : ""}`,
        );
      } else {
        toast.error("All revisions failed to generate");
      }

      await loadSessions();
      setSelectedSessionId(createdSessionId);

      // Close wizard after a brief delay to show results
      setTimeout(() => {
        resetSessionWizard();
        setSessionWizardOpen(false);
      }, 2000);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create session",
      );
    } finally {
      setBatchProcessing(false);
    }
  }, [
    wizardSelectedSourceImageIds,
    wizardSelectedCategories,
    wizardSessionName,
    sourceImages,
    wizardUseBlankCanvas,
    orderedSelectedCategories,
    categoryPrompts,
    wizardRoomType,
    categoryMasks,
    stitchSelectedInspoIds,
    loadSessions,
    resetSessionWizard,
  ]);

  // Create a single inline revision (from the session detail panel)
  const createRevision = useCallback(async () => {
    if (!selectedSessionId) {
      toast.error("Select or create a session first");
      return;
    }
    if (!prompt.trim()) {
      toast.error("Prompt is required");
      return;
    }

    setCreatingRevision(true);
    try {
      const sourceImageId =
        selectedSession?.sourceImageId || sessionSourceImage?.id;
      if (!sourceImageId) {
        toast.error("No source image for this session");
        return;
      }

      const blankCanvasId =
        useBlankCanvas && sessionSourceImage?.listingPhoto?.blankCanvasCfImageId
          ? sessionSourceImage.listingPhoto.blankCanvasCfImageId
          : undefined;

      const body: Record<string, unknown> = {
        prompt: prompt.trim(),
        sourceImageId,
        roomType: roomType.trim().toLowerCase() || undefined,
        maskBase64: maskBase64 || undefined,
        blankCanvasImageId: blankCanvasId,
      };

      const response = await fetch(
        `/api/photo-edits/sessions/${selectedSessionId}/revisions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create revision");
      }

      setPrompt("");
      setMaskBase64(null);
      await loadSessions();
      await loadSelectedSession();
      window.dispatchEvent(
        new CustomEvent("global-upload-complete", {
          detail: { target: "images", isListingPhoto: false, source: "photo-edits" },
        }),
      );
      toast.success("Revision generated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create revision",
      );
    } finally {
      setCreatingRevision(false);
    }
  }, [
    loadSelectedSession,
    loadSessions,
    prompt,
    roomType,
    selectedSession,
    selectedSessionId,
    sessionSourceImage,
    maskBase64,
    useBlankCanvas,
  ]);

  const onStitchFileValidate = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      return "Only image files are supported";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "File must be 10MB or less";
    }
    return null;
  }, []);

  // ---------------------------------------------------------------------------
  // Render: source image URL for session detail (respects blank canvas toggle)
  // ---------------------------------------------------------------------------

  const sessionSourceUrl = useMemo(() => {
    if (!sessionSourceImage) return "";
    if (
      useBlankCanvas &&
      sessionSourceImage.listingPhoto?.blankCanvasCfImageId
    ) {
      const token = sessionSourceImage.listingPhoto.blankCanvasCfImageId;
      return token.startsWith("http")
        ? token
        : `https://imagedelivery.net/${token}/public`;
    }
    return resolveImageUrl(sessionSourceImage);
  }, [sessionSourceImage, useBlankCanvas]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading photo editor...
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        {/* Session list sidebar */}
        <Card className="h-fit ring-1 ring-border/40">
          <CardHeader>
            <CardTitle>Edit Sessions</CardTitle>
            <CardDescription>
              Create a session for each room or idea, then iterate revisions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full gap-2" onClick={openSessionWizard}>
              <Plus className="size-4" />
              New Edit Session
            </Button>

            <div className="space-y-2 pt-2">
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions yet.</p>
              ) : (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className={cn(
                      "w-full rounded-lg border border-border/50 bg-card px-3 py-2 text-left text-sm transition",
                      selectedSessionId === session.id && "ring-2 ring-ring",
                    )}
                  >
                    <p className="truncate font-medium">{session.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {session.revisionCount || 0} revisions
                    </p>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Session detail panel */}
        <div className="space-y-6">
          <Card className="ring-1 ring-border/40">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {selectedSession?.name || "Select a Session"}
                </CardTitle>
                <CardDescription>
                  Prompt and generate revisions — Gemini processes automatically.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadSelectedSession}
                disabled={loadingSession || !selectedSessionId}
                className="gap-2"
              >
                <RefreshCw className={cn("size-4", loadingSession && "animate-spin")} />
                Refresh
              </Button>
            </CardHeader>

            <CardContent className="space-y-4">
              {sessionSourceImage ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
                    <img
                      src={sessionSourceUrl}
                      alt="Session source"
                      className="aspect-[4/3] w-full rounded-lg object-cover ring-1 ring-border/40"
                    />
                    <div className="space-y-1 text-sm text-muted-foreground flex flex-col justify-between">
                      <div>
                        <p>
                          <span className="font-medium text-foreground">Source:</span>{" "}
                          {getImageDisplayName(sessionSourceImage)}
                        </p>
                        <p><span className="font-medium text-foreground">Room:</span> {roomType || sessionSourceImage.roomType || "unassigned"}</p>
                        <p><span className="font-medium text-foreground">Created:</span> {formatDate(selectedSession?.datetimeCreated)}</p>
                      </div>

                      {/* Blank canvas toggle */}
                      {sessionSourceImage.listingPhoto?.blankCanvasCfImageId && (
                        <div className="pt-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={useBlankCanvas}
                              onChange={(e) => setUseBlankCanvas(e.target.checked)}
                              className="rounded border-border/40 bg-background text-primary focus:ring-primary/45"
                            />
                            <span className="text-xs font-semibold">
                              Use blank canvas as source
                            </span>
                            <Eraser className="size-3 text-sky-400" />
                          </label>
                          <p className="text-[10px] text-muted-foreground mt-0.5 ml-5">
                            Sends the furniture-removed version to Gemini for cleaner results
                          </p>
                        </div>
                      )}

                      {/* Mask controls */}
                      <div className="pt-2 flex flex-wrap gap-2">
                        {maskBase64 ? (
                          <>
                            <div className="flex items-center gap-1 text-xs font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full ring-1 ring-emerald-500/20">
                              <Check className="size-3" /> Mask Active
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              type="button"
                              onClick={() => setMaskEditorOpen(true)}
                              className="h-7 text-xs gap-1"
                            >
                              <Brush className="size-3" />
                              Edit Mask
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              onClick={() => setMaskBase64(null)}
                              className="h-7 text-xs text-red-500 hover:text-red-600 gap-1 hover:bg-transparent"
                            >
                              <Trash2 className="size-3" />
                              Clear Mask
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={() => setMaskEditorOpen(true)}
                            className="h-7 text-xs gap-1"
                          >
                            <Brush className="size-3" />
                            Draw Edit Mask
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {maskEditorOpen && (
                    <div className="space-y-2 rounded-lg border border-border/40 p-4 bg-muted/10">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">Draw Inpainting Mask</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => setMaskEditorOpen(false)}
                          className="h-7 text-xs gap-1"
                        >
                          <ArrowLeft className="size-3" /> Back
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Use the pen tool (red) to paint over the areas you want Gemini to change. Click "Save" inside the editor to compute the mask.
                      </p>
                      <InlineMaskEditor
                        imageUrl={sessionSourceUrl}
                        onChange={(mask) => {
                          setMaskBase64(mask);
                          setMaskEditorOpen(false);
                        }}
                        height={400}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Set a source image on the session before generating revisions.
                </p>
              )}

              {/* Prompt + Room Override + Generate */}
              <div className="space-y-2">
                <label
                  htmlFor="revision-prompt-input"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Prompt
                </label>
                <textarea
                  id="revision-prompt-input"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={4}
                  placeholder="Describe the changes you want Gemini to make to this photo..."
                  className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="room-override-input"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Room
                </label>
                <select
                  id="room-override-input"
                  value={roomType}
                  onChange={(event) => setRoomType(event.target.value)}
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                >
                  <option value="">Auto-detect from photo</option>
                  {catalogFloors.map((floor) => (
                    <optgroup key={floor.id} label={floor.name}>
                      {floor.rooms.map((room) => (
                        <option key={room.id} value={room.roomName.toLowerCase()}>
                          {room.displayName}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <Button
                className="w-full gap-2"
                onClick={createRevision}
                disabled={creatingRevision || !selectedSessionId}
              >
                {creatingRevision ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    Generate Revision
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Revision History */}
          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle>Revision History</CardTitle>
              <CardDescription>
                Each revision is generated by Gemini and saved to Cloudflare Images.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {revisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No revisions yet.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {revisions.map((revision) => {
                    const outputImage = revision.outputImage;
                    const sourceImage = revision.sourceImage;
                    const imageUrl = outputImage ? resolveImageUrl(outputImage) : "";
                    return (
                      <article key={revision.id} className="overflow-hidden rounded-lg border bg-card/50 ring-1 ring-border/40">
                        {imageUrl ? (
                          <>
                            <img
                              src={imageUrl}
                              alt={`Revision ${revision.revisionNumber}`}
                              className="aspect-[4/3] w-full object-cover"
                            />
                            {sourceImage && (
                              <div className="border-t border-border/40 p-2">
                                <ImageCompareSlider
                                  beforeSrc={resolveImageUrl(sourceImage)}
                                  afterSrc={imageUrl}
                                  beforeLabel="Source"
                                  afterLabel={`Revision ${revision.revisionNumber}`}
                                  defaultValue={55}
                                  aspectClassName="aspect-[16/10]"
                                />
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex aspect-[4/3] items-center justify-center bg-muted/30 text-sm text-muted-foreground">
                            No preview
                          </div>
                        )}
                        <div className="space-y-2 p-3">
                          <p className="text-sm font-medium">Revision {revision.revisionNumber}</p>
                          <p className="line-clamp-3 text-xs text-muted-foreground">{revision.prompt}</p>
                          <p className="text-[11px] text-muted-foreground">{formatDate(revision.datetimeCreated)}</p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ================================================================= */}
      {/* SESSION CREATION WIZARD                                           */}
      {/* ================================================================= */}
      <Dialog open={sessionWizardOpen} onOpenChange={setSessionWizardOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-5xl overflow-auto">
          <DialogHeader>
            <DialogTitle>Create New Edit Session</DialogTitle>
          </DialogHeader>

          <Stepper steps={4} value={sessionWizardStep} onValueChange={setSessionWizardStep}>
            <StepperList className="flex-nowrap overflow-x-auto pb-1">
              <StepperItem step={1}>
                <StepperTrigger>
                  <StepperIndicator />
                  <div className="text-left">
                    <StepperTitle>Choose Photos</StepperTitle>
                    <StepperDescription>Source listing photos</StepperDescription>
                  </div>
                </StepperTrigger>
              </StepperItem>
              <StepperItem step={2}>
                <StepperTrigger>
                  <StepperIndicator />
                  <div className="text-left">
                    <StepperTitle>Edit Categories</StepperTitle>
                    <StepperDescription>Select what to change</StepperDescription>
                  </div>
                </StepperTrigger>
              </StepperItem>
              <StepperItem step={3}>
                <StepperTrigger>
                  <StepperIndicator />
                  <div className="text-left">
                    <StepperTitle>Configure Prompts</StepperTitle>
                    <StepperDescription>Customize per category</StepperDescription>
                  </div>
                </StepperTrigger>
              </StepperItem>
              <StepperItem step={4}>
                <StepperTrigger>
                  <StepperIndicator />
                  <div className="text-left">
                    <StepperTitle>Confirm & Generate</StepperTitle>
                    <StepperDescription>Review and auto-process</StepperDescription>
                  </div>
                </StepperTrigger>
              </StepperItem>
            </StepperList>

            {/* STEP 1: Choose Source Photos */}
            <StepperContent step={1} className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Select listing photos
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {wizardSelectedSourceImageIds.length} selected
                  </span>
                </p>
              </div>

              {listingPhotosByFloorAndRoom.groups.length === 0 &&
                listingPhotosByFloorAndRoom.unmatched.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No listing photos uploaded yet.
                  </p>
                )}

              {listingPhotosByFloorAndRoom.groups.map((floorGroup) => (
                <div key={floorGroup.floor.id} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="size-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold tracking-wide">
                      {floorGroup.floor.name}
                    </h3>
                  </div>

                  {floorGroup.rooms.map((roomGroup) => (
                    <div key={roomGroup.room.id} className="space-y-2 pl-6">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {roomGroup.room.displayName}
                        </p>
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline"
                          onClick={() => {
                            const roomImageIds = roomGroup.images.map((i) => i.id);
                            const allSelected = roomImageIds.every((id) =>
                              wizardSelectedSourceImageIds.includes(id),
                            );
                            setWizardSelectedSourceImageIds((current) => {
                              if (allSelected) {
                                return current.filter((id) => !roomImageIds.includes(id));
                              }
                              const next = new Set(current);
                              for (const id of roomImageIds) next.add(id);
                              return Array.from(next);
                            });
                          }}
                        >
                          {roomGroup.images.every((i) =>
                            wizardSelectedSourceImageIds.includes(i.id),
                          )
                            ? "Deselect all"
                            : "Select all"}
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                        {roomGroup.images.map((image) => {
                          const selected = wizardSelectedSourceImageIds.includes(image.id);
                          const name = getImageDisplayName(image);
                          return (
                            <button
                              key={image.id}
                              type="button"
                              onClick={() => {
                                setWizardSelectedSourceImageIds((current) =>
                                  current.includes(image.id)
                                    ? current.filter((entry) => entry !== image.id)
                                    : [...current, image.id],
                                );
                              }}
                              className={cn(
                                "group relative overflow-hidden rounded-lg ring-1 ring-border/40 transition",
                                selected && "ring-2 ring-primary",
                              )}
                            >
                              <img
                                src={resolveImageUrl(image)}
                                alt={name}
                                className="aspect-square w-full object-cover"
                              />
                              {selected && (
                                <div className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                  <Check className="size-3" />
                                </div>
                              )}
                              {image.listingPhoto?.blankCanvasCfImageId && (
                                <div className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-sky-500/90 px-1 py-0.5 text-[9px] font-semibold text-white uppercase tracking-wide">
                                  <Eraser className="size-2.5" />
                                  Canvas
                                </div>
                              )}
                              <div
                                className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 opacity-0 transition group-hover:opacity-100"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setWizardPreviewImageId(image.id);
                                }}
                              >
                                <p className="truncate text-[11px] font-medium text-white">
                                  {name}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {listingPhotosByFloorAndRoom.unmatched.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Unassigned Photos
                  </p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                    {listingPhotosByFloorAndRoom.unmatched.map((image) => {
                      const selected = wizardSelectedSourceImageIds.includes(image.id);
                      const name = getImageDisplayName(image);
                      return (
                        <button
                          key={image.id}
                          type="button"
                          onClick={() => {
                            setWizardSelectedSourceImageIds((current) =>
                              current.includes(image.id)
                                ? current.filter((entry) => entry !== image.id)
                                : [...current, image.id],
                            );
                          }}
                          className={cn(
                            "group relative overflow-hidden rounded-lg ring-1 ring-border/40 transition",
                            selected && "ring-2 ring-primary",
                          )}
                        >
                          <img
                            src={resolveImageUrl(image)}
                            alt={name}
                            className="aspect-square w-full object-cover"
                          />
                          {selected && (
                            <div className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="size-3" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </StepperContent>

            {/* STEP 2: Select Edit Categories (Multi-Select) */}
            <StepperContent step={2} className="space-y-5">
              {/* Blank canvas toggle */}
              {(() => {
                const firstImage = sourceImages.find(
                  (img) => img.id === wizardSelectedSourceImageIds[0],
                );
                const hasBlankCanvas = !!firstImage?.listingPhoto?.blankCanvasCfImageId;

                return (
                  <div className="space-y-4">
                    {hasBlankCanvas && (
                      <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                        <input
                          type="checkbox"
                          id="wizard-blank-canvas-toggle"
                          checked={wizardUseBlankCanvas}
                          onChange={(e) => setWizardUseBlankCanvas(e.target.checked)}
                          className="mt-1 rounded border-border/40 bg-background text-primary focus:ring-primary/45"
                        />
                        <div className="grid gap-1">
                          <label
                            htmlFor="wizard-blank-canvas-toggle"
                            className="text-xs font-semibold text-foreground cursor-pointer flex items-center gap-1.5"
                          >
                            <Eraser className="size-3.5 text-sky-400" />
                            Use blank canvas as base image (recommended)
                          </label>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">
                            Sends the furniture-removed version to Gemini. Produces cleaner results for staging, paint, and layout changes.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Room override — pre-filled */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Room
                      </label>
                      <select
                        value={wizardRoomType}
                        onChange={(event) => setWizardRoomType(event.target.value)}
                        className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                      >
                        <option value="">Auto-detect</option>
                        {catalogFloors.map((floor) => (
                          <optgroup key={floor.id} label={floor.name}>
                            {floor.rooms.map((room) => (
                              <option key={room.id} value={room.roomName.toLowerCase()}>
                                {room.displayName}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    {/* Category checkboxes */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Select edit types
                        <span className="ml-2 normal-case font-normal">
                          (select all that apply)
                        </span>
                      </p>
                      <div className="grid gap-3 md:grid-cols-2">
                        {EDIT_CATEGORIES.map((option) => {
                          const isSelected = wizardSelectedCategories.has(option.key);
                          return (
                            <button
                              key={option.key}
                              type="button"
                              onClick={() => {
                                setWizardSelectedCategories((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(option.key)) {
                                    next.delete(option.key);
                                  } else {
                                    next.add(option.key);
                                  }
                                  return next;
                                });
                              }}
                              className={cn(
                                "rounded-xl border p-3 text-left ring-1 ring-border/40 transition flex items-start gap-3",
                                isSelected
                                  ? "border-primary bg-primary/10"
                                  : "hover:bg-muted/20",
                              )}
                            >
                              <div
                                className={cn(
                                  "flex size-5 items-center justify-center rounded border transition-colors mt-0.5",
                                  isSelected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border/60",
                                )}
                              >
                                {isSelected && <Check className="size-3" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground">{option.icon}</span>
                                  <p className="text-sm font-semibold">{option.title}</p>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {option.description}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </StepperContent>

            {/* STEP 3: Per-Category Prompt Walkthrough */}
            <StepperContent step={3} className="space-y-4">
              {orderedSelectedCategories.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Go back and select at least one edit category.
                </p>
              ) : (
                <>
                  {/* Sub-step tabs */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {orderedSelectedCategories.map((cat, index) => (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => setActiveCategoryIndex(index)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition whitespace-nowrap",
                          activeCategoryIndex === index
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/30 text-muted-foreground hover:bg-muted/50",
                        )}
                      >
                        {cat.icon}
                        {cat.title}
                        {categoryPrompts[cat.key] !== cat.defaultPrompt && (
                          <span className="size-1.5 rounded-full bg-emerald-400" />
                        )}
                      </button>
                    ))}
                  </div>

                  {activeCategory && (
                    <div className="space-y-4 rounded-lg border border-border/30 bg-muted/5 p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{activeCategory.icon}</span>
                        <h4 className="text-sm font-semibold">{activeCategory.title}</h4>
                      </div>

                      {/* Source preview */}
                      {wizardSelectedSourceImageIds[0] && (() => {
                        const previewImg = sourceImages.find(
                          (img) => img.id === wizardSelectedSourceImageIds[0],
                        );
                        return previewImg ? (
                          <div className="flex gap-3">
                            <img
                              src={resolveWizardSourceUrl(previewImg)}
                              alt="Source"
                              className="aspect-[4/3] w-40 rounded-lg object-cover ring-1 ring-border/30"
                            />
                            <div className="flex-1 space-y-1 text-xs text-muted-foreground">
                              <p>
                                <span className="font-medium text-foreground">Source:</span>{" "}
                                {getImageDisplayName(previewImg)}
                              </p>
                              {wizardUseBlankCanvas && previewImg.listingPhoto?.blankCanvasCfImageId && (
                                <p className="flex items-center gap-1 text-sky-400">
                                  <Eraser className="size-3" /> Using blank canvas
                                </p>
                              )}
                            </div>
                          </div>
                        ) : null;
                      })()}

                      {/* Prompt textarea */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Prompt for {activeCategory.title}
                        </label>
                        <textarea
                          value={categoryPrompts[activeCategory.key]}
                          onChange={(e) =>
                            setCategoryPrompts((prev) => ({
                              ...prev,
                              [activeCategory.key]: e.target.value,
                            }))
                          }
                          rows={5}
                          className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() =>
                            setCategoryPrompts((prev) => ({
                              ...prev,
                              [activeCategory.key]: activeCategory.defaultPrompt,
                            }))
                          }
                        >
                          Reset to default prompt
                        </Button>
                      </div>

                      {/* Category-specific UI */}
                      {activeCategory.supportsMask && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Edit Mask (optional)
                          </p>
                          {categoryMasks[activeCategory.key] ? (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 text-xs font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full ring-1 ring-emerald-500/20">
                                <Check className="size-3" /> Mask Active
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-red-500"
                                onClick={() =>
                                  setCategoryMasks((prev) => ({
                                    ...prev,
                                    [activeCategory.key]: null,
                                  }))
                                }
                              >
                                <Trash2 className="size-3 mr-1" /> Clear
                              </Button>
                            </div>
                          ) : (
                            <>
                              {wizardSelectedSourceImageIds[0] && (() => {
                                const maskImg = sourceImages.find(
                                  (img) => img.id === wizardSelectedSourceImageIds[0],
                                );
                                return maskImg ? (
                                  <InlineMaskEditor
                                    imageUrl={resolveWizardSourceUrl(maskImg)}
                                    onChange={(mask) =>
                                      setCategoryMasks((prev) => ({
                                        ...prev,
                                        [activeCategory.key]: mask,
                                      }))
                                    }
                                    height={360}
                                  />
                                ) : null;
                              })()}
                            </>
                          )}
                        </div>
                      )}

                      {/* Stitch-specific: inspo picker */}
                      {activeCategory.key === "stitch" && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setStitchInspoMode("existing")}
                              className={cn(
                                "text-xs font-semibold px-3 py-1.5 rounded-full transition",
                                stitchInspoMode === "existing"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted/30 text-muted-foreground",
                              )}
                            >
                              <ImageIcon className="size-3 mr-1 inline" />
                              Choose from library
                            </button>
                            <button
                              type="button"
                              onClick={() => setStitchInspoMode("upload")}
                              className={cn(
                                "text-xs font-semibold px-3 py-1.5 rounded-full transition",
                                stitchInspoMode === "upload"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted/30 text-muted-foreground",
                              )}
                            >
                              <Upload className="size-3 mr-1 inline" />
                              Upload new inspo
                            </button>
                          </div>

                          {stitchInspoMode === "existing" && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <p className="text-xs text-muted-foreground">
                                  {stitchSelectedInspoIds.length} selected
                                </p>
                                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={showAllInspo}
                                    onChange={(e) => setShowAllInspo(e.target.checked)}
                                    className="rounded border-border/40 bg-background text-primary focus:ring-primary/45"
                                  />
                                  Show all rooms
                                </label>
                              </div>
                              {filteredInspoImages.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-4 text-center">
                                  No inspiration photos found. Upload some first.
                                </p>
                              ) : (
                                <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto sm:grid-cols-5 lg:grid-cols-6">
                                  {filteredInspoImages.map((img) => {
                                    const sel = stitchSelectedInspoIds.includes(img.id);
                                    return (
                                      <button
                                        key={img.id}
                                        type="button"
                                        onClick={() => {
                                          setStitchSelectedInspoIds((prev) =>
                                            prev.includes(img.id)
                                              ? prev.filter((id) => id !== img.id)
                                              : [...prev, img.id],
                                          );
                                        }}
                                        className={cn(
                                          "relative overflow-hidden rounded-lg ring-1 ring-border/40 transition",
                                          sel && "ring-2 ring-primary",
                                        )}
                                      >
                                        <img
                                          src={resolveImageUrl(img)}
                                          alt={getImageDisplayName(img)}
                                          className="aspect-square w-full object-cover"
                                        />
                                        {sel && (
                                          <div className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                            <Check className="size-2.5" />
                                          </div>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {stitchInspoMode === "upload" && (
                            <FileUpload
                              value={stitchUploadedFiles}
                              onValueChange={setStitchUploadedFiles}
                              onFileValidate={onStitchFileValidate}
                              maxFiles={6}
                              maxSize={MAX_FILE_SIZE}
                              accept="image/*"
                              multiple
                              label="Upload inspiration photos"
                            >
                              <FileUploadDropzone className="gap-2 rounded-xl border-border/40 bg-muted/20 p-6 text-center">
                                <p className="text-sm font-medium">
                                  Drop inspiration photos here
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Up to 6 images, 10MB each
                                </p>
                                <FileUploadTrigger asChild>
                                  <Button size="sm" variant="secondary">
                                    Browse Files
                                  </Button>
                                </FileUploadTrigger>
                              </FileUploadDropzone>

                              <FileUploadList>
                                {stitchUploadedFiles.map((file) => (
                                  <FileUploadItem
                                    key={fileKey(file)}
                                    value={file}
                                    className="gap-3 rounded-lg border-border/40 bg-card/60 px-3 py-2"
                                  >
                                    <FileUploadItemPreview className="size-12 rounded-md ring-1 ring-border/40" />
                                    <FileUploadItemMetadata size="sm" />
                                    <FileUploadItemDelete asChild>
                                      <Button variant="ghost" size="icon-sm" title="Remove file">
                                        <Plus className="size-4 rotate-45" />
                                      </Button>
                                    </FileUploadItemDelete>
                                  </FileUploadItem>
                                ))}
                              </FileUploadList>
                            </FileUpload>
                          )}
                        </div>
                      )}

                      {/* Navigate between categories */}
                      <div className="flex justify-between pt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={activeCategoryIndex === 0}
                          onClick={() =>
                            setActiveCategoryIndex((i) => Math.max(0, i - 1))
                          }
                        >
                          <ArrowLeft className="size-3 mr-1" />
                          Previous
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={
                            activeCategoryIndex >=
                            orderedSelectedCategories.length - 1
                          }
                          onClick={() =>
                            setActiveCategoryIndex((i) =>
                              Math.min(orderedSelectedCategories.length - 1, i + 1),
                            )
                          }
                        >
                          Next
                          <ArrowRight className="size-3 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </StepperContent>

            {/* STEP 4: Confirm & Generate */}
            <StepperContent step={4} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Session Name
                </label>
                <input
                  type="text"
                  value={wizardSessionName}
                  onChange={(event) => setWizardSessionName(event.target.value)}
                  placeholder="Kitchen base layout v1"
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                />
              </div>

              <div className="rounded-lg bg-muted/20 p-3 text-sm ring-1 ring-border/30">
                <p className="font-medium">Summary</p>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  <li>• Source photos: {wizardSelectedSourceImageIds.length}</li>
                  <li>
                    • Edit types:{" "}
                    {orderedSelectedCategories.map((c) => c.title).join(", ") ||
                      "none selected"}
                  </li>
                  <li>• Room: {wizardRoomType || "auto-detect"}</li>
                  <li>
                    • Base image:{" "}
                    {wizardUseBlankCanvas ? "blank canvas" : "original photo"}
                  </li>
                  {stitchSelectedInspoIds.length > 0 && (
                    <li>
                      • Inspiration photos: {stitchSelectedInspoIds.length}
                    </li>
                  )}
                </ul>
              </div>

              {/* Batch processing results */}
              {batchResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Processing Results
                  </p>
                  {batchResults.map((result, index) => (
                    <div
                      key={index}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1",
                        result.success
                          ? "bg-emerald-500/5 ring-emerald-500/20 text-emerald-400"
                          : "bg-red-500/5 ring-red-500/20 text-red-400",
                      )}
                    >
                      {result.success ? (
                        <Check className="size-4" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      <span className="font-medium capitalize">
                        {result.category}
                      </span>
                      {result.error && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          {result.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </StepperContent>

            {/* Stepper Navigation */}
            <div className="flex justify-between gap-2 border-t border-border/40 pt-4">
              <StepperPrev
                onClick={() =>
                  setSessionWizardStep((current) => Math.max(1, current - 1))
                }
              >
                Back
              </StepperPrev>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSessionWizardOpen(false)}
                >
                  Cancel
                </Button>
                {sessionWizardStep < 4 ? (
                  <StepperNext
                    onClick={() =>
                      setSessionWizardStep((current) =>
                        Math.min(4, current + 1),
                      )
                    }
                    disabled={
                      (sessionWizardStep === 1 &&
                        wizardSelectedSourceImageIds.length === 0) ||
                      (sessionWizardStep === 2 &&
                        wizardSelectedCategories.size === 0)
                    }
                  >
                    Next
                  </StepperNext>
                ) : (
                  <Button
                    onClick={submitSessionWizard}
                    disabled={batchProcessing || batchResults.length > 0}
                  >
                    {batchProcessing ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 size-4" />
                        Create & Generate
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </Stepper>
        </DialogContent>
      </Dialog>

      {wizardPreviewImage && (
        <ImagePreview
          open={wizardPreviewImageId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setWizardPreviewImageId(null);
            }
          }}
          src={resolveImageUrl(wizardPreviewImage)}
          title={wizardPreviewImage.displayName || "Source Preview"}
          metadata={wizardPreviewImage.metadata || null}
        />
      )}
    </>
  );
}
