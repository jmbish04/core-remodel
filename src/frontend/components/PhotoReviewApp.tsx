import {
  Crop,
  Eye,
  FileImage,
  Images,
  LayoutGrid,
  Loader2,
  PanelRight,
  Palette,
  RefreshCw,
  Save,
  Tag,
  X,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Cropper,
  CropperArea,
  CropperImage,
  type CropperAreaData,
} from "@/components/ui/cropper";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  MultipleSelector,
  type MultipleSelectorOption,
} from "@/components/ui/multiple-selector";
import { Dropdown } from "@/components/ui/dropdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { ScopedInspirationCategorizer } from "@/components/review/ScopedInspirationCategorizer";
import { ScopedInspirationReview } from "@/components/review/ScopedInspirationReview";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HighlightType = "like" | "dislike";
type PhotoCategory = "listing" | "inspirational";

interface HighlightRecord {
  /**
   * Stable identity for React keys. Persisted highlights carry a numeric DB id;
   * client-drafted highlights get a `crypto.randomUUID()` string until saved.
   */
  id?: number | string;
  highlightType: HighlightType;
  shapeType: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  note: string;
}

interface TagMapping {
  tagId: number;
  slug: string;
  label: string;
}

/** Shape returned by GET /api/images (subset we consume here). */
interface ApiImage {
  id: string;
  displayName?: string | null;
  description?: string | null;
  cfImageIdOriginal?: string | null;
  cfImageIdOptimized?: string | null;
  metadata?: string | null;
  photoCategory: string;
  isDuplicate?: boolean;
  roomType?: string | null;
  roomLabels?: string[];
  tags?: string[];
  tagMappings?: TagMapping[];
  highlights?: Array<Partial<HighlightRecord>>;
  reviewed?: boolean;
}

/** Normalized view-model used by the review pane. */
interface ReviewImage {
  id: string;
  title: string;
  description: string;
  path: string;
  category: PhotoCategory;
  roomType: string | null;
  tagIds: string[];
  tags: string[];
  highlights: HighlightRecord[];
  reviewed: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(4))));
}

function deliveryUrlFromMetadata(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    if (typeof parsed.deliveryUrl === "string") {
      return parsed.deliveryUrl;
    }
  } catch {
    /* ignore malformed metadata */
  }
  return null;
}

function resolveImageUrl(image: ApiImage): string {
  const deliveryId = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (deliveryId) {
    if (deliveryId.startsWith("http://") || deliveryId.startsWith("https://")) {
      return deliveryId;
    }
    if (deliveryId.includes("/")) {
      return `https://imagedelivery.net/${deliveryId}/public`;
    }
  }
  const fromMetadata = deliveryUrlFromMetadata(image.metadata);
  if (fromMetadata) {
    return fromMetadata;
  }
  return deliveryId ? `https://imagedelivery.net/${deliveryId}/public` : "";
}

function normalizeHighlights(
  raw: Array<Partial<HighlightRecord>> | undefined,
): HighlightRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((highlight) => ({
      id: highlight?.id || crypto.randomUUID(),
      highlightType: (highlight?.highlightType === "dislike"
        ? "dislike"
        : "like") as HighlightType,
      shapeType: highlight?.shapeType || "rect",
      xPct: Number(highlight?.xPct) || 0,
      yPct: Number(highlight?.yPct) || 0,
      widthPct: Number(highlight?.widthPct) || 0,
      heightPct: Number(highlight?.heightPct) || 0,
      note: highlight?.note || "",
    }))
    .filter((highlight) => highlight.widthPct > 0 && highlight.heightPct > 0);
}

function buildReviewImage(image: ApiImage): ReviewImage {
  const category: PhotoCategory =
    image.photoCategory === "listing" ? "listing" : "inspirational";
  const tagMappings = Array.isArray(image.tagMappings) ? image.tagMappings : [];
  
  let computedRoomType = image.roomType?.trim() || null;
  const labels = Array.isArray(image.roomLabels) ? image.roomLabels : [];
  if (!computedRoomType && labels.length > 0) {
    if (labels.length > 5) {
      computedRoomType = "Entire Home (All Levels)";
    } else {
      computedRoomType = labels.join(", ");
    }
  }

  return {
    id: image.id,
    title: image.displayName?.trim() || "",
    description: image.description?.trim() || "",
    path: resolveImageUrl(image),
    category,
    roomType: computedRoomType,
    tagIds: tagMappings.map((mapping) => String(mapping.tagId)),
    tags: Array.isArray(image.tags)
      ? image.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : [],
    highlights: normalizeHighlights(image.highlights),
    reviewed: Boolean(image.reviewed),
  };
}

function createImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    image.addEventListener("load", () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image for cropping"));
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
  return new File([blob], filename, { type: outputType });
}

interface CropState {
  crop: { x: number; y: number };
  zoom: number;
  rotation: number;
  areaPixels: CropperAreaData | null;
}

const INITIAL_CROP_STATE: CropState = {
  crop: { x: 0, y: 0 },
  zoom: 1,
  rotation: 0,
  areaPixels: null,
};

// ---------------------------------------------------------------------------
// Photo coding workspace (the original per-image review/coding tool)
// ---------------------------------------------------------------------------

/**
 * The full-height photo coding workspace: a coding pane (image + highlights +
 * title/description/tags) plus a queued/reviewed sidebar. This is the original
 * `PhotoReviewApp` body, now rendered as the "Code photos" tab of the wrapping
 * {@link PhotoReviewApp} shell. Behavior is unchanged.
 */
function PhotoCodingWorkspace() {
  const [images, setImages] = useState<ReviewImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"queued" | "reviewed">("queued");

  const [tagOptions, setTagOptions] = useState<MultipleSelectorOption[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);

  // Coding-panel fields for the selected image.
  const [panelTitle, setPanelTitle] = useState("");
  const [panelDescription, setPanelDescription] = useState("");
  const [panelTagIds, setPanelTagIds] = useState<string[]>([]);
  const [panelHighlights, setPanelHighlights] = useState<HighlightRecord[]>([]);
  const [highlightMode, setHighlightMode] = useState<HighlightType>("like");
  const [isDrawingHighlight, setIsDrawingHighlight] = useState(false);
  const [draftHighlight, setDraftHighlight] = useState<HighlightRecord | null>(
    null,
  );
  const highlightSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropState, setCropState] = useState<CropState>(INITIAL_CROP_STATE);
  const [savingCrop, setSavingCrop] = useState(false);

  const selectedImage = useMemo(
    () => images.find((image) => image.id === selectedId) ?? null,
    [images, selectedId],
  );
  const queuedImages = useMemo(
    () => images.filter((image) => !image.reviewed),
    [images],
  );
  const reviewedImages = useMemo(
    () => images.filter((image) => image.reviewed),
    [images],
  );

  // ----- data loading -----

  const fetchImages = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/images");
      const payload = (await response.json()) as { images?: ApiImage[] };
      const list = (payload.images ?? [])
        .filter((image) => !image.isDuplicate)
        .filter((image) => image.photoCategory === "inspirational")
        .map(buildReviewImage);
      setImages(list);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load photos",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTags = useCallback(async () => {
    setTagsLoading(true);
    try {
      const response = await fetch("/api/images/tags");
      const payload = (await response.json()) as {
        tags?: Array<{ id: number; label: string; slug: string }>;
      };
      setTagOptions(
        (payload.tags ?? []).map((tag) => ({
          value: String(tag.id),
          label: tag.label,
          description: tag.slug,
        })),
      );
    } catch {
      /* tags are optional; ignore load failures */
    } finally {
      setTagsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchImages();
    void fetchTags();
  }, [fetchImages, fetchTags]);

  // ----- selection -----

  const loadImageIntoPanel = useCallback((image: ReviewImage | null) => {
    setSelectedId(image?.id ?? null);
    setPanelTitle(image?.title ?? "");
    setPanelDescription(image?.description ?? "");
    setPanelTagIds(image?.tagIds ?? []);
    setPanelHighlights(image?.highlights ?? []);
    setDraftHighlight(null);
    setIsDrawingHighlight(false);
    setHighlightMode("like");
  }, []);

  // Auto-select the first queued photo once data loads and nothing is selected.
  useEffect(() => {
    if (loading || selectedId) return;
    const firstQueued = images.find((image) => !image.reviewed);
    if (firstQueued) {
      loadImageIntoPanel(firstQueued);
    }
  }, [images, loading, selectedId, loadImageIntoPanel]);

  // ----- tags -----

  const createTagOption = useCallback(
    async (label: string): Promise<MultipleSelectorOption | null> => {
      const normalized = label.trim();
      if (!normalized) return null;
      const response = await fetch("/api/images/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      setTagOptions((previous) =>
        previous.some((option) => option.value === created.value)
          ? previous
          : [...previous, created].sort((a, b) =>
              a.label.localeCompare(b.label),
            ),
      );
      return created;
    },
    [],
  );

  // ----- highlight drawing -----

  const updateHighlightNote = useCallback((index: number, note: string) => {
    setPanelHighlights((previous) =>
      previous.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, note } : entry,
      ),
    );
  }, []);

  const removeHighlight = useCallback((index: number) => {
    setPanelHighlights((previous) =>
      previous.filter((_, entryIndex) => entryIndex !== index),
    );
  }, []);

  const beginHighlightDraw = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !selectedImage) return;
      const surface = highlightSurfaceRef.current;
      if (!surface) return;
      const bounds = surface.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const xPct = clampPercent(
        ((event.clientX - bounds.left) / bounds.width) * 100,
      );
      const yPct = clampPercent(
        ((event.clientY - bounds.top) / bounds.height) * 100,
      );
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
      if (!isDrawingHighlight || !draftHighlight) return;
      const surface = highlightSurfaceRef.current;
      if (!surface) return;
      const bounds = surface.getBoundingClientRect();
      const xPct = clampPercent(
        ((event.clientX - bounds.left) / bounds.width) * 100,
      );
      const yPct = clampPercent(
        ((event.clientY - bounds.top) / bounds.height) * 100,
      );
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

  // ----- save / advance -----

  const saveSelected = useCallback(async () => {
    if (!selectedImage) return;
    const wasQueued = !selectedImage.reviewed;
    const queueIndex = queuedImages.findIndex(
      (image) => image.id === selectedImage.id,
    );
    const nextQueued =
      queuedImages[queueIndex + 1] ??
      queuedImages.find((image) => image.id !== selectedImage.id) ??
      null;

    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        displayName: panelTitle,
        description: panelDescription,
        tagIds: panelTagIds.map((value) => Number(value)),
        highlights: panelHighlights.map((highlight) => ({
          ...highlight,
          note: highlight.note?.trim() || "",
        })),
        reviewed: true,
      };
      const response = await fetch(`/api/images/${selectedImage.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        image?: ApiImage;
        error?: string;
      };
      if (!response.ok || !data.image) {
        throw new Error(data.error ?? "Save failed");
      }
      const saved = buildReviewImage(data.image);
      setImages((previous) =>
        previous.map((image) => (image.id === saved.id ? saved : image)),
      );
      toast.success("Saved and marked reviewed");
      if (wasQueued) {
        loadImageIntoPanel(nextQueued);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [
    loadImageIntoPanel,
    panelDescription,
    panelHighlights,
    panelTagIds,
    panelTitle,
    queuedImages,
    selectedImage,
  ]);

  // ----- crop / replace -----

  const openCrop = useCallback(() => {
    if (!selectedImage) return;
    setCropState(INITIAL_CROP_STATE);
    setCropOpen(true);
  }, [selectedImage]);

  const saveCrop = useCallback(async () => {
    if (!selectedImage || !cropState.areaPixels) {
      toast.error("Select a crop area before saving");
      return;
    }
    setSavingCrop(true);
    try {
      const sourceResponse = await fetch(selectedImage.path, {
        cache: "no-store",
      });
      if (!sourceResponse.ok) {
        throw new Error(
          `Failed to fetch source image (${sourceResponse.status})`,
        );
      }
      const sourceBlob = await sourceResponse.blob();
      const croppedFile = await cropBlob(
        sourceBlob,
        cropState.areaPixels,
        `${selectedImage.id}-crop.jpg`,
      );
      const formData = new FormData();
      formData.append("file", croppedFile);
      const response = await fetch(`/api/images/${selectedImage.id}/replace`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        image?: ApiImage;
        error?: string;
      };
      if (!response.ok || !payload.image) {
        throw new Error(payload.error ?? "Failed to save cropped image");
      }
      const updated = buildReviewImage(payload.image);
      setImages((previous) =>
        previous.map((image) => (image.id === updated.id ? updated : image)),
      );
      toast.success("Image crop saved");
      setCropOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save cropped image",
      );
    } finally {
      setSavingCrop(false);
    }
  }, [cropState.areaPixels, selectedImage]);

  // ----- rendering -----

  const sidebarImages = sidebarTab === "queued" ? queuedImages : reviewedImages;

  const renderThumb = (image: ReviewImage) => {
    const isActive = image.id === selectedId;
    return (
      <button
        type="button"
        key={image.id}
        onClick={() => loadImageIntoPanel(image)}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition",
          isActive
            ? "border-primary bg-primary/5"
            : "border-border/40 hover:border-border hover:bg-muted/40",
        )}
      >
        <div className="size-14 shrink-0 overflow-hidden rounded-md bg-muted/40 ring-1 ring-border/30">
          {image.path ? (
            // biome-ignore lint/performance/noImgElement: external delivery urls
            <img
              src={image.path}
              alt={image.title || "Listing photo"}
              className="size-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <FileImage className="size-5" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {image.title || "Untitled photo"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {image.roomType || image.category}
          </p>
          {image.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {image.tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
              {image.tags.length > 2 && (
                <Badge variant="outline" className="text-[10px]">
                  +{image.tags.length - 2}
                </Badge>
              )}
            </div>
          )}
        </div>
      </button>
    );
  };

  const [thumbSidebarOpen, setThumbSidebarOpen] = useState(false);

  return (
    <div className="flex h-full min-h-[30rem] w-full">
      {/* Main coding pane */}
      <main className="flex min-w-0 flex-1 flex-col">
        {selectedImage ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border/40 p-4">
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold">
                  {panelTitle || "Untitled photo"}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {selectedImage.roomType || selectedImage.category}
                  {selectedImage.reviewed ? " · reviewed" : " · queued"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewOpen(true)}
                  className="hidden sm:inline-flex"
                >
                  <Eye className="mr-1.5 size-4" />
                  Preview
                </Button>
                <Button variant="outline" size="sm" onClick={openCrop} className="hidden sm:inline-flex">
                  <Crop className="mr-1.5 size-4" />
                  Crop
                </Button>
                <Button size="sm" onClick={saveSelected} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 size-4" />
                  )}
                  <span className="hidden sm:inline">Save &amp; mark reviewed</span>
                  <span className="sm:hidden">Save</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="lg:hidden"
                  onClick={() => setThumbSidebarOpen(true)}
                  aria-label="Show photo list"
                >
                  <PanelRight className="size-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* Image + highlight surface */}
              <div className="space-y-2">
                <div
                  ref={highlightSurfaceRef}
                  className="relative cursor-crosshair overflow-hidden rounded-xl bg-muted/30 ring-1 ring-border/40"
                  style={{ touchAction: "none" }}
                  onPointerDown={beginHighlightDraw}
                  onPointerMove={moveHighlightDraw}
                  onPointerUp={endHighlightDraw}
                  onPointerCancel={endHighlightDraw}
                >
                  {/* biome-ignore lint/performance/noImgElement: external delivery urls */}
                  <img
                    src={selectedImage.path}
                    alt={panelTitle || "Listing photo"}
                    className="max-h-[50vh] w-full select-none object-contain sm:max-h-[60vh]"
                    draggable={false}
                  />
                  {panelHighlights.map((highlight, index) => (
                    <div
                      key={`highlight-${index}-${highlight.id ?? "new"}`}
                      className={cn(
                        "pointer-events-none absolute border-2",
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
                        "pointer-events-none absolute border-2",
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
                <p className="text-xs text-muted-foreground">
                  Drag on the image to mark a region, then describe it below.
                </p>
              </div>

              {/* Coding fields — stacked below the image */}
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="review-title"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Title
                  </label>
                  <Input
                    id="review-title"
                    value={panelTitle}
                    onChange={(event) => setPanelTitle(event.target.value)}
                    placeholder="Kitchen sink wall concept"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="review-description"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Description
                  </label>
                  <Textarea
                    id="review-description"
                    value={panelDescription}
                    onChange={(event) =>
                      setPanelDescription(event.target.value)
                    }
                    rows={3}
                    placeholder="Lighting, finishes, layout ideas..."
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Tag className="size-3.5" />
                  Tags
                </span>
                <MultipleSelector
                  title="Select tags"
                  placeholder={
                    tagsLoading ? "Loading tags..." : "Select or create tags"
                  }
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
                        error instanceof Error
                          ? error.message
                          : "Failed to create tag",
                      );
                      return null;
                    }
                  }}
                  searchPlaceholder="Search tags..."
                />
              </div>

              <div className="space-y-2 rounded-lg border border-border/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Highlights
                  </span>
                  <Dropdown<HighlightType>
                    value={highlightMode}
                    onValueChange={setHighlightMode}
                    size="sm"
                    className="h-8 text-xs"
                    options={[
                      { value: "like", label: "I like this" },
                      { value: "dislike", label: "I do not like this" },
                    ]}
                  />
                </div>
                {panelHighlights.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Drag a box on the image to add a{" "}
                    {highlightMode === "like" ? "liked" : "disliked"} region.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {panelHighlights.map((highlight, index) => (
                      <div
                        key={`highlight-editor-${index}`}
                        className="rounded-md border border-border/40 p-2"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <Badge
                            variant={
                              highlight.highlightType === "like"
                                ? "default"
                                : "destructive"
                            }
                          >
                            {highlight.highlightType === "like"
                              ? "Like"
                              : "Do not like"}
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
                          onChange={(event) =>
                            updateHighlightNote(index, event.target.value)
                          }
                          placeholder={
                            highlight.highlightType === "like"
                              ? "What do you want to replicate here?"
                              : "What should be avoided here?"
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-muted/40">
              <Images className="size-7 text-muted-foreground" />
            </div>
            {queuedImages.length === 0 ? (
              <>
                <h2 className="text-lg font-semibold">
                  No queued photos to code
                </h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  You&apos;re all caught up. You can still modify the coding of
                  any photo by selecting it from the{" "}
                  <button
                    type="button"
                    className="font-medium text-primary underline-offset-2 hover:underline"
                    onClick={() => setSidebarTab("reviewed")}
                  >
                    Reviewed
                  </button>{" "}
                  tab.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">Select a photo to code</h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  Pick a photo from the Queued tab on the right to add a title,
                  description, tags, and highlights.
                </p>
              </>
            )}
          </div>
        )}
      </main>

      {/* Sidebar photo selector — always visible on lg+, slide-over on smaller */}
      <aside className="hidden w-80 shrink-0 flex-col border-l border-border/40 lg:flex">
        <div className="flex items-center justify-between gap-2 border-b border-border/40 p-3">
          <Tabs
            value={sidebarTab}
            onValueChange={(value) =>
              setSidebarTab(value as "queued" | "reviewed")
            }
          >
            <TabsList>
              <TabsTrigger value="queued">
                Queued ({queuedImages.length})
              </TabsTrigger>
              <TabsTrigger value="reviewed">
                Reviewed ({reviewedImages.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void fetchImages()}
            title="Refresh"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading photos...
            </div>
          ) : sidebarImages.length === 0 ? (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">
              {sidebarTab === "queued"
                ? "No photos awaiting review."
                : "No reviewed photos yet."}
            </p>
          ) : (
            sidebarImages.map(renderThumb)
          )}
        </div>
      </aside>

      {/* Mobile slide-over for photo list */}
      {thumbSidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          {/* biome-ignore lint/a11y/useKeyEvents: overlay dismiss */}
          {/* biome-ignore lint/a11y/useAriaRole: overlay dismiss */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs"
            onClick={() => setThumbSidebarOpen(false)}
          />
          {/* Panel */}
          <aside
            className="absolute inset-y-0 right-0 flex w-[85vw] max-w-sm flex-col bg-background shadow-xl"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border/40 p-3">
              <Tabs
                value={sidebarTab}
                onValueChange={(value) =>
                  setSidebarTab(value as "queued" | "reviewed")
                }
              >
                <TabsList>
                  <TabsTrigger value="queued">
                    Queued ({queuedImages.length})
                  </TabsTrigger>
                  <TabsTrigger value="reviewed">
                    Reviewed ({reviewedImages.length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => void fetchImages()}
                  title="Refresh"
                >
                  <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setThumbSidebarOpen(false)}
                  aria-label="Close photo list"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <div
              className="flex-1 space-y-2 overflow-y-auto overscroll-contain p-3"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading photos...
                </div>
              ) : sidebarImages.length === 0 ? (
                <p className="px-1 py-8 text-center text-sm text-muted-foreground">
                  {sidebarTab === "queued"
                    ? "No photos awaiting review."
                    : "No reviewed photos yet."}
                </p>
              ) : (
                sidebarImages.map((image) => (
                  <button
                    type="button"
                    key={image.id}
                    onClick={() => {
                      loadImageIntoPanel(image);
                      setThumbSidebarOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition",
                      image.id === selectedId
                        ? "border-primary bg-primary/5"
                        : "border-border/40 hover:border-border hover:bg-muted/40",
                    )}
                  >
                    <div className="size-14 shrink-0 overflow-hidden rounded-md bg-muted/40 ring-1 ring-border/30">
                      {image.path ? (
                        // biome-ignore lint/performance/noImgElement: external delivery urls
                        <img
                          src={image.path}
                          alt={image.title || "Listing photo"}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-muted-foreground">
                          <FileImage className="size-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {image.title || "Untitled photo"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {image.roomType || image.category}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">
              {panelTitle || "Photo preview"}
            </DialogTitle>
          </DialogHeader>
          {selectedImage ? (
            // biome-ignore lint/performance/noImgElement: external delivery urls
            <img
              src={selectedImage.path}
              alt={panelTitle || "Listing photo"}
              className="max-h-[75vh] w-full rounded-lg object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Crop dialog */}
      <Dialog open={cropOpen} onOpenChange={setCropOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Crop photo</DialogTitle>
          </DialogHeader>
          {selectedImage ? (
            <div className="space-y-4">
              <div className="relative h-[22rem] overflow-hidden rounded-xl bg-muted/30 ring-1 ring-border/40">
                <Cropper
                  crop={cropState.crop}
                  zoom={cropState.zoom}
                  rotation={cropState.rotation}
                  aspectRatio={4 / 3}
                  withGrid
                  onCropChange={(crop) =>
                    setCropState((prev) => ({ ...prev, crop }))
                  }
                  onZoomChange={(zoom) =>
                    setCropState((prev) => ({ ...prev, zoom }))
                  }
                  onRotationChange={(rotation) =>
                    setCropState((prev) => ({ ...prev, rotation }))
                  }
                  onCropAreaChange={(_, areaPixels) =>
                    setCropState((prev) => ({ ...prev, areaPixels }))
                  }
                >
                  <CropperImage
                    src={selectedImage.path}
                    alt="Crop target"
                    crossOrigin="anonymous"
                  />
                  <CropperArea />
                </Cropper>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={() => setCropOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={saveCrop} disabled={savingCrop}>
                  {savingCrop ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Crop className="mr-1.5 size-4" />
                  )}
                  Save crop
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review shell — tabs between photo coding and level/home inspiration categories
// ---------------------------------------------------------------------------

/**
 * PhotoReviewApp — the /review page shell.
 *
 * Two tabs:
 *   1. "Code photos"          — the original {@link PhotoCodingWorkspace}
 *                               (per-image title/description/tags/highlights).
 *   2. "Inspiration categories" — the 0005 level/home-scope surface: the
 *      {@link ScopedInspirationCategorizer} (AI-suggest + confirm a category for
 *      broad-scope inspiration) stacked above the reusable
 *      {@link ScopedInspirationReview} (the same photos grouped by category).
 *
 * Saving a category in the categorizer bumps a `refreshToken` so the grouped
 * viewer below re-fetches and reflects the change immediately. The coding
 * workspace owns the full viewport height; the categories tab scrolls its own
 * padded column so both fit under the shared 3.5rem navbar.
 */
export function PhotoReviewApp() {
  const [activeTab, setActiveTab] = useState<"code" | "categories">("code");
  // Bumped after each successful category save to refresh the grouped viewer.
  const [viewerRefreshToken, setViewerRefreshToken] = useState(0);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as "code" | "categories")}
      className="h-[calc(100dvh-3.5rem)] w-full gap-0"
    >
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2">
        <TabsList>
          <TabsTrigger value="code">
            <LayoutGrid className="size-4" />
            Code photos
          </TabsTrigger>
          <TabsTrigger value="categories">
            <Palette className="size-4" />
            Inspiration categories
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Photo coding workspace keeps its own internal full-height layout. */}
      <TabsContent value="code" className="min-h-0 overflow-hidden">
        <PhotoCodingWorkspace />
      </TabsContent>

      {/* Level/home categorization + grouped viewer, in a scrollable column. */}
      <TabsContent
        value="categories"
        className="min-h-0 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-6xl space-y-4 p-4">
          <ScopedInspirationCategorizer
            onCategorized={() => setViewerRefreshToken((token) => token + 1)}
          />
          <ScopedInspirationReview refreshToken={viewerRefreshToken} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
