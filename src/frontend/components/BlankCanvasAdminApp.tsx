import {
  ArrowLeft,
  ArrowRight,
  SkipForward,
  Ban,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Download,
  Image,
  Loader2,
  Sparkles,
  Upload,
  Wrench,
  XCircle,
  Trash2,
  Brush,
  Eraser,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { BasicBlocksPlugin, BasicMarksPlugin } from "@platejs/basic-nodes/react";
import { InlineMaskEditor } from "@/components/ui/InlineMaskEditor";

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
    skipBlankCanvas?: boolean;
  } | null;
}

interface UploadedCanvasFile {
  file: File;
  objectUrl: string;
  matchedListingPhotoId: number | null;
  filename: string;
}

interface GenerationJobStatus {
  success: boolean;
  jobId: string;
  startedAt: number;
  summary: {
    total: number;
    done: number;
    failed: number;
    processing: number;
    pending: number;
  };
  isComplete: boolean;
  items: Array<{
    listingPhotoId: number;
    status: "pending" | "processing" | "done" | "failed";
    error?: string;
    blankCanvasCfImageId?: string;
  }>;
}

type WizardStep = "select" | "choose-mode" | "manual" | "ai-generate";

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

/** Normalize a filename stem for matching (lowercase, strip extension, remove common suffixes). */
function normalizeFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, "") // strip extension
    .toLowerCase()
    .replace(/[_\-\s]+/g, "_")
    .replace(/\(copy\)|_copy|_edited|_blank|_canvas/gi, "")
    .trim();
}

/** The recommended prompt for manual furniture removal. */
const BLANK_CANVAS_PROMPT = `Remove ALL furniture, appliances, fixtures, decor, rugs, plants, curtains, window treatments, and personal items from this room photo. Delete all ceiling lights, lamps, chandeliers, and lighting fixtures completely, filling their space with clean ceiling/wall texture. Leave the space completely empty — bare walls, bare floors, empty ceilings.

Preserve EXACTLY: flooring (material, color, finish, plank direction), every wall and wall color, all windows and their grids, all doors and openings, the ceiling structure (material, texture, shape, color), baseboards, light switches, outlets, the room's dimensions and proportions, and the camera angle.

Do NOT crop, zoom, pan, rotate, re-frame, or change the aspect ratio. Fill any area previously occupied by furniture with the surrounding wall color and flooring material. The result should look like a vacant, move-in-ready empty room.`;

// ---------------------------------------------------------------------------
// Plate-based Prompt Editor
// ---------------------------------------------------------------------------

interface PlatePromptEditorProps {
  value: string;
  onChange: (newValue: string) => void;
  placeholder?: string;
  className?: string;
  dependencyKey?: any;
}

function PlatePromptEditor({
  value,
  onChange,
  placeholder,
  className,
  dependencyKey,
}: PlatePromptEditorProps) {
  const initialValue = useMemo(() => {
    return value.split("\n").map((line) => ({
      type: "p",
      children: [{ text: line }],
    }));
  }, [dependencyKey]);

  const editor = usePlateEditor(
    {
      value: initialValue,
      plugins: [BasicBlocksPlugin, BasicMarksPlugin],
    },
    [dependencyKey]
  );

  return (
    <div className={cn("rounded-lg border border-border/40 overflow-hidden bg-card/30 p-2", className)}>
      <Plate
        editor={editor}
        onValueChange={({ value: newValue }) => {
          const plainText = newValue
            .map((node: any) => node.children?.map((c: any) => c.text).join("") || "")
            .join("\n");
          onChange(plainText);
        }}
      >
        <PlateContent
          className="min-h-[140px] rounded-lg border border-border/50 bg-background/85 px-3 py-3 text-sm outline-none"
          placeholder={placeholder || "Enter prompt instructions..."}
        />
      </Plate>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Manage Mode Photo Card
// ---------------------------------------------------------------------------

interface BlankCanvasRecord {
  id: number;
  listingPhotoId: number;
  cfImageId: string;
  prompt: string;
  datetimeCreated: string | Date;
}

function ManageListingPhotoCard({
  image,
  onGenerateNew,
  onRefreshStats,
}: {
  image: ImageRecord;
  onGenerateNew: (photoId: number) => void;
  onRefreshStats: () => void;
}) {
  const [canvases, setCanvases] = useState<BlankCanvasRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);

  const fetchCanvases = useCallback(async () => {
    if (!image.listingPhoto) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/listing-photos/${image.listingPhoto.id}/blank-canvases`);
      const data = (await res.json()) as {
        success: boolean;
        canvases: BlankCanvasRecord[];
        primaryCfImageId: string | null;
      };
      if (data.success) {
        setCanvases(data.canvases);
        setActiveCanvasId(data.primaryCfImageId);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [image.listingPhoto?.id]);

  useEffect(() => {
    void fetchCanvases();
  }, [fetchCanvases]);

  const handleMakePrimary = async (cfImageId: string) => {
    if (!image.listingPhoto) return;
    try {
      const res = await fetch(`/api/listing-photos/${image.listingPhoto.id}/set-primary-blank-canvas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cfImageId }),
      });
      const data = (await res.json()) as { success: boolean };
      if (data.success) {
        setActiveCanvasId(cfImageId);
        toast.success("Primary blank canvas updated!");
        onRefreshStats();
      }
    } catch {
      toast.error("Failed to update primary blank canvas");
    }
  };

  const handleDeleteCanvas = async (canvasId: number) => {
    if (!image.listingPhoto) return;
    try {
      const res = await fetch(`/api/listing-photos/${image.listingPhoto.id}/blank-canvases/${canvasId}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { success: boolean };
      if (data.success) {
        toast.success("Canvas version deleted!");
        void fetchCanvases();
        onRefreshStats();
      }
    } catch {
      toast.error("Failed to delete canvas version");
    }
  };

  const handleManualUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !image.listingPhoto) return;

    const formData = new FormData();
    formData.append("file", file);

    toast.promise(
      (async () => {
        const res = await fetch(`/api/listing-photos/${image.listingPhoto!.id}/blank-canvas`, {
          method: "POST",
          body: formData,
        });
        const data = (await res.json()) as { success: boolean };
        if (!data.success) throw new Error("Upload failed");
        void fetchCanvases();
        onRefreshStats();
      })(),
      {
        loading: "Uploading new blank canvas version...",
        success: "Blank canvas uploaded successfully!",
        error: "Failed to upload blank canvas",
      },
    );
  };

  return (
    <Card className="overflow-hidden border border-border/40 bg-muted/10">
      <CardContent className="p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Original Photo */}
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground">Original Photo</span>
            <div className="relative aspect-[4/3] rounded-md overflow-hidden bg-muted">
              {/* biome-ignore lint/performance/noImgElement: Image preview */}
              <img src={resolveImageUrl(image)} alt="Original" className="size-full object-cover" />
            </div>
            <div className="pt-1">
              <p className="truncate text-xs font-semibold">{image.displayName || "Listing Image"}</p>
              {image.listingPhoto?.roomName && (
                <p className="text-[10px] text-muted-foreground">{image.listingPhoto.roomName}</p>
              )}
            </div>
          </div>

          {/* Blank Canvases */}
          <div className="space-y-2 flex flex-col justify-between">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground">Blank Canvas Versions</span>
              
              {loading ? (
                <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin mr-1.5" /> Loading versions...
                </div>
              ) : canvases.length === 0 ? (
                <div className="border border-dashed border-border/40 rounded-md flex flex-col items-center justify-center p-4 text-center">
                  <p className="text-[11px] text-muted-foreground mb-2">No blank canvases yet</p>
                  <div className="flex gap-2">
                    <label className="cursor-pointer inline-flex items-center gap-1 px-2 py-1 rounded bg-secondary text-secondary-foreground text-[10px] font-medium hover:bg-secondary/80 transition-colors">
                      <Upload className="size-3" /> Upload
                      <input type="file" className="hidden" accept="image/*" onChange={handleManualUpload} />
                    </label>
                    <Button size="xs" variant="outline" onClick={() => onGenerateNew(image.listingPhoto!.id)} className="text-[10px]">
                      <Sparkles className="size-3 mr-1" /> Generate
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-1">
                  {canvases.map((c) => {
                    const isActive = activeCanvasId === c.cfImageId;
                    return (
                      <div key={c.id} className="relative aspect-[4/3] group rounded border overflow-hidden bg-muted">
                        {/* biome-ignore lint/performance/noImgElement: CF Image view */}
                        <img src={`https://imagedelivery.net/${c.cfImageId}/public`} alt="Canvas version" className="size-full object-cover" />
                        {isActive && (
                          <div className="absolute top-0.5 left-0.5 bg-emerald-500 text-white rounded-full p-0.5 shadow">
                            <Check className="size-2" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1 transition-opacity">
                          {!isActive && (
                            <button
                              title="Make Primary"
                              onClick={() => handleMakePrimary(c.cfImageId)}
                              className="p-1 rounded bg-emerald-500 hover:bg-emerald-600 text-white"
                            >
                              <Check className="size-2.5" />
                            </button>
                          )}
                          <button
                            title="Delete"
                            onClick={() => handleDeleteCanvas(c.id)}
                            className="p-1 rounded bg-red-500 hover:bg-red-600 text-white"
                          >
                            <Trash2 className="size-2.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {canvases.length > 0 && (
              <div className="flex justify-between items-center pt-2 border-t border-border/20">
                <span className="text-[10px] text-muted-foreground">
                  {canvases.length} version{canvases.length !== 1 ? "s" : ""}
                </span>
                <div className="flex gap-1.5">
                  <label className="cursor-pointer inline-flex items-center gap-1 px-2 py-1 rounded bg-secondary text-secondary-foreground text-[10px] font-medium hover:bg-secondary/80 transition-colors">
                    <Upload className="size-3" /> Add
                    <input type="file" className="hidden" accept="image/*" onChange={handleManualUpload} />
                  </label>
                  <Button size="xs" variant="outline" onClick={() => onGenerateNew(image.listingPhoto!.id)} className="text-[10px]">
                    <Sparkles className="size-3 mr-1" /> Generate
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlankCanvasAdminApp({ initialTab }: { initialTab?: string } = {}) {
  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [floors, setFloors] = useState<CatalogFloor[]>([]);

  // Wizard state
  const [step, setStep] = useState<WizardStep>("select");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<string>("");
  const [updatingSkip, setUpdatingSkip] = useState(false);
  const [viewMode, setViewMode] = useState<"fix" | "manage">("fix");
  const [hasDefaultedMode, setHasDefaultedMode] = useState(false);

  // Manual workflow state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedCanvasFile[]>([]);
  const [pairingMode, setPairingMode] = useState<number | null>(null); // uploaded file index being paired
  const [savingPairs, setSavingPairs] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  // AI workflow state
  const [generationJobId, setGenerationJobId] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationJobStatus | null>(null);
  const [startingGeneration, setStartingGeneration] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Interactive Editor Wizard state
  const [wizardIndex, setWizardIndex] = useState(0);
  const [wizardStage, setWizardStage] = useState<"setup" | "review" | "refine">("setup");
  const [wizardPrompt, setWizardPrompt] = useState("");
  const [wizardPromptKey, setWizardPromptKey] = useState(0);
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [wizardLeaveOutline, setWizardLeaveOutline] = useState(false);
  const [wizardHasWindows, setWizardHasWindows] = useState(true);
  const [wizardHasSkylights, setWizardHasSkylights] = useState(false);
  const [wizardGeneratedUrl, setWizardGeneratedUrl] = useState<string | null>(null);
  const [wizardGeneratedCfImageId, setWizardGeneratedCfImageId] = useState<string | null>(null);
  const [wizardMaskBase64, setWizardMaskBase64] = useState<string | null>(null);
  const [wizardRefineBase, setWizardRefineBase] = useState<"original" | "last-edit">("last-edit");
  const [wizardLoading, setWizardLoading] = useState(false);
  const [wizardThoughts, setWizardThoughts] = useState<string | null>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [copiedError, setCopiedError] = useState<string | null>(null);
  const [wizardHistory, setWizardHistory] = useState<{ url: string; cfImageId: string; prompt: string; thoughts?: string | null }[]>([]);

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/api/listing-photos/backfill", { method: "POST" });

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

      // Load default prompt from backend
      try {
        const pRes = await fetch("/api/listing-photos/default-prompt?leaveOutline=false&hasMask=false&hasWindows=true&hasSkylights=false");
        const pData = await pRes.json() as { success: boolean; prompt: string };
        if (pData.success) {
          setDefaultPrompt(pData.prompt);
          setWizardPrompt(pData.prompt);
          setWizardPromptKey((prev) => prev + 1);
        }
      } catch (pErr) {
        console.error("Failed to load default prompt:", pErr);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load data",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDefaultPrompt = useCallback(async (outline: boolean, hasMask: boolean, hasWindows: boolean, hasSkylights: boolean) => {
    try {
      const res = await fetch(`/api/listing-photos/default-prompt?leaveOutline=${outline}&hasMask=${hasMask}&hasWindows=${hasWindows}&hasSkylights=${hasSkylights}`);
      const data = await res.json() as { success: boolean; prompt: string };
      if (data.success) {
        setWizardPrompt(data.prompt);
        setWizardPromptKey((prev) => prev + 1);
      }
    } catch (err) {
      console.error("Failed to fetch default prompt:", err);
    }
  }, []);

  const handleCopyErrorPrompt = useCallback((errText: string) => {
    const fullPrompt = `The Blank Canvas generation/refinement failed with the following server error:
\`\`\`
${errText}
\`\`\`

The prompt that was sent to Gemini was:
\`\`\`
${wizardPrompt}
\`\`\`

Please investigate why this error occurred (such as invalid API response format, model-specific limitations, or input size issues) and provide a fix.`;

    navigator.clipboard.writeText(fullPrompt).then(() => {
      setCopiedError(errText);
      toast.success("Error prompt copied to clipboard!");
      setTimeout(() => {
        setCopiedError(null);
      }, 3000);
    });
  }, [wizardPrompt]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const needsCanvas = useMemo(() => {
    return images.filter(
      (img) =>
        img.photoCategory === "listing" &&
        (!img.listingPhoto || !img.listingPhoto.blankCanvasCfImageId),
    );
  }, [images]);

  const needsCanvasActive = useMemo(() => {
    return needsCanvas.filter((img) => !img.listingPhoto?.skipBlankCanvas);
  }, [needsCanvas]);

  const excludedPhotos = useMemo(() => {
    return needsCanvas.filter((img) => img.listingPhoto?.skipBlankCanvas);
  }, [needsCanvas]);

  const needsCanvasGrouped = useMemo(() => {
    const groups: Array<{
      floor: CatalogFloor;
      rooms: Array<{ room: CatalogRoom; images: ImageRecord[] }>;
    }> = [];

    for (const floor of floors) {
      const roomGroups: Array<{ room: CatalogRoom; images: ImageRecord[] }> = [];
      for (const room of floor.rooms) {
        const matched = needsCanvasActive.filter((img) => {
          if (img.roomId === room.id) return true;
          if (Array.isArray(img.roomLabels) && img.roomLabels.includes(room.roomName)) return true;
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

    const matchedIds = new Set(
      groups.flatMap((g) => g.rooms.flatMap((r) => r.images.map((i) => i.id))),
    );
    const unmatched = needsCanvasActive.filter((img) => !matchedIds.has(img.id));

    return { groups, unmatched };
  }, [needsCanvasActive, floors]);

  const allListingPhotosGrouped = useMemo(() => {
    const groups: Array<{
      floor: CatalogFloor;
      rooms: Array<{ room: CatalogRoom; images: ImageRecord[] }>;
    }> = [];

    const listingImages = images.filter((img) => img.photoCategory === "listing");

    for (const floor of floors) {
      const roomGroups: Array<{ room: CatalogRoom; images: ImageRecord[] }> = [];
      for (const room of floor.rooms) {
        const matched = listingImages.filter((img) => {
          if (img.roomId === room.id) return true;
          if (Array.isArray(img.roomLabels) && img.roomLabels.includes(room.roomName)) return true;
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

    const matchedIds = new Set(
      groups.flatMap((g) => g.rooms.flatMap((r) => r.images.map((i) => i.id))),
    );
    const unmatched = listingImages.filter((img) => !matchedIds.has(img.id));

    return { groups, unmatched };
  }, [images, floors]);

  const totalNeedsCanvas = needsCanvasActive.length;

  const totalWithCanvas = useMemo(() => {
    return images.filter(
      (img) =>
        img.photoCategory === "listing" &&
        img.listingPhoto?.blankCanvasCfImageId,
    ).length;
  }, [images]);

  // Auto-default viewMode once data is loaded based on pending fixes
  useEffect(() => {
    if (!loading && images.length > 0 && !hasDefaultedMode) {
      if (totalNeedsCanvas === 0) {
        setViewMode("manage");
      } else {
        setViewMode("fix");
      }
      setHasDefaultedMode(true);
    }
  }, [loading, images, totalNeedsCanvas, hasDefaultedMode]);

  // Sync activeTab when available tabs change and read/write URL path parameters
  useEffect(() => {
    const order = ["lower_level", "main_level", "upper_level", "unassigned", "excluded"];
    const sortTabs = (keys: string[]) => {
      return [...keys].sort((a, b) => {
        let idxA = order.indexOf(a);
        let idxB = order.indexOf(b);
        if (idxA === -1) idxA = 999;
        if (idxB === -1) idxB = 999;
        return idxA - idxB;
      });
    };

    const activeGroups = viewMode === "fix" ? needsCanvasGrouped : allListingPhotosGrouped;
    const availableTabs = sortTabs([
      ...activeGroups.groups.map((g) => g.floor.key),
      ...(activeGroups.unmatched.length > 0 ? ["unassigned"] : []),
      ...(viewMode === "fix" ? ["excluded"] : []),
    ]);

    if (availableTabs.length === 0) return;

    // Resolve current tab from URL path
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    let pathTab = pathParts[pathParts.length - 1];
    if (pathTab === "blank-canvas" || pathTab === "admin") {
      pathTab = "";
    }
    const resolvedPathTab = pathTab ? pathTab.replace(/-/g, "_") : "";

    // If activeTab is not set, or is no longer available in the active set
    if (!activeTab || !availableTabs.includes(activeTab)) {
      if (resolvedPathTab && availableTabs.includes(resolvedPathTab)) {
        setActiveTab(resolvedPathTab);
      } else if (initialTab && availableTabs.includes(initialTab)) {
        setActiveTab(initialTab);
        const slug = initialTab.replace(/_/g, "-");
        window.history.replaceState(null, "", `/admin/prepare/blank-canvas/${slug}`);
      } else {
        const defaultTab = availableTabs[0];
        setActiveTab(defaultTab);
        const slug = defaultTab.replace(/_/g, "-");
        window.history.replaceState(null, "", `/admin/prepare/blank-canvas/${slug}`);
      }
    } else {
      // Keep activeTab, but ensure URL pathname is synchronized
      const slug = activeTab.replace(/_/g, "-");
      const expectedPath = `/admin/prepare/blank-canvas/${slug}`;
      if (window.location.pathname !== expectedPath) {
        window.history.replaceState(null, "", expectedPath);
      }
    }
  }, [needsCanvasGrouped, allListingPhotosGrouped, activeTab, initialTab, viewMode]);

  // -----------------------------------------------------------------------
  // Selection helpers
  // -----------------------------------------------------------------------

  const selectedImages = useMemo(() => {
    return needsCanvas.filter(
      (img) => img.listingPhoto && selectedIds.has(img.listingPhoto.id),
    );
  }, [needsCanvas, selectedIds]);

  useEffect(() => {
    if (step === "ai-generate" && selectedImages[wizardIndex]) {
      void fetchDefaultPrompt(wizardLeaveOutline, !!wizardMaskBase64, wizardHasWindows, wizardHasSkylights);
    }
  }, [step, wizardIndex, wizardLeaveOutline, !!wizardMaskBase64, wizardHasWindows, wizardHasSkylights, fetchDefaultPrompt, selectedImages]);

  // Load existing blank canvas versions into wizard history if any exist
  useEffect(() => {
    const activeImage = selectedImages[wizardIndex];
    if (step === "ai-generate" && activeImage && activeImage.listingPhoto) {
      const loadExistingHistory = async () => {
        try {
          const res = await fetch(`/api/listing-photos/${activeImage.listingPhoto!.id}/blank-canvases`);
          const data = (await res.json()) as {
            success: boolean;
            canvases: BlankCanvasRecord[];
            primaryCfImageId: string | null;
          };
          if (data.success && data.canvases.length > 0) {
            const mappedHistory = data.canvases.map((c) => ({
              url: `https://imagedelivery.net/${c.cfImageId}/public`,
              cfImageId: c.cfImageId,
              prompt: c.prompt || "Prior Saved Canvas",
              thoughts: null,
            }));
            setWizardHistory(mappedHistory);
          } else {
            setWizardHistory([]);
          }
        } catch {
          setWizardHistory([]);
        }
      };
      void loadExistingHistory();
    } else {
      setWizardHistory([]);
    }
  }, [step, wizardIndex, selectedImages]);

  const toggleSelection = useCallback((listingPhotoId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(listingPhotoId)) {
        next.delete(listingPhotoId);
      } else {
        next.add(listingPhotoId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const sourceList = activeTab === "excluded" ? excludedPhotos : needsCanvasActive;
    const allIds = sourceList
      .map((img) => img.listingPhoto?.id)
      .filter((id): id is number => typeof id === "number");
    setSelectedIds(new Set(allIds));
  }, [activeTab, needsCanvasActive, excludedPhotos]);

  const selectNone = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleTabChange = useCallback((val: string) => {
    setActiveTab(val);
    setSelectedIds(new Set());
    const slug = val.replace(/_/g, "-");
    window.history.replaceState(null, "", `/admin/prepare/blank-canvas/${slug}`);
  }, []);

  const handleGenerateForPhoto = useCallback((lpId: number) => {
    setSelectedIds(new Set([lpId]));
    setStep("choose-mode");
    setViewMode("fix");
  }, []);

  const handleSetSuggestedPrompt = useCallback(() => {
    void fetchDefaultPrompt(wizardLeaveOutline, !!wizardMaskBase64, wizardHasWindows, wizardHasSkylights);
  }, [wizardLeaveOutline, wizardMaskBase64, wizardHasWindows, wizardHasSkylights, fetchDefaultPrompt]);

  const handleInteractiveGenerate = useCallback(async () => {
    const activeImage = selectedImages[wizardIndex];
    if (!activeImage || !activeImage.listingPhoto) return;

    setWizardLoading(true);
    setWizardError(null);
    setWizardThoughts(null);
    try {
      const res = await fetch("/api/listing-photos/refine-blank-canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingPhotoId: activeImage.listingPhoto.id,
          baseImageUrl: resolveImageUrl(activeImage),
          prompt: wizardPrompt,
          leaveOutline: wizardLeaveOutline,
          maskBase64: wizardMaskBase64 || undefined,
        }),
      });

      if (!res.ok) {
        let errMsg = "Failed to generate blank canvas";
        let thoughts: string | null = null;
        try {
          const errData = await res.json() as { error?: string; details?: string; thoughts?: string };
          errMsg = errData.details || errData.error || errMsg;
          thoughts = errData.thoughts || null;
        } catch {
          errMsg = await res.text() || errMsg;
        }
        if (thoughts) {
          setWizardThoughts(thoughts);
        }
        throw new Error(errMsg);
      }

      const data = (await res.json()) as {
        success: boolean;
        blankCanvasCfImageId: string;
        deliveryUrl: string;
        thoughts?: string;
      };
      setWizardGeneratedUrl(data.deliveryUrl);
      setWizardGeneratedCfImageId(data.blankCanvasCfImageId);
      setWizardThoughts(data.thoughts || null);
      setWizardHistory([
        {
          url: data.deliveryUrl,
          cfImageId: data.blankCanvasCfImageId,
          prompt: wizardPrompt,
          thoughts: data.thoughts || null,
        },
      ]);
      setWizardStage("review");
      toast.success("Blank canvas generated!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setWizardError(msg);
      toast.error(msg);
    } finally {
      setWizardLoading(false);
    }
  }, [selectedImages, wizardIndex, wizardPrompt, wizardLeaveOutline, wizardMaskBase64]);

  const handleReset = useCallback(() => {
    setStep("select");
    setSelectedIds(new Set());
    setUploadedFiles([]);
    setPairingMode(null);
    setGenerationJobId(null);
    setGenerationStatus(null);
    setWizardIndex(0);
    setWizardStage("setup");
    setWizardPrompt("Loading prompt template...");
    setWizardPromptKey((prev) => prev + 1);
    setWizardLeaveOutline(false);
    setWizardHasWindows(true);
    setWizardHasSkylights(false);
    setWizardGeneratedUrl(null);
    setWizardGeneratedCfImageId(null);
    setWizardThoughts(null);
    setWizardError(null);
    setWizardMaskBase64(null);
    setWizardRefineBase("last-edit");
    setWizardLoading(false);
    setWizardHistory([]);
    void loadData();
  }, [loadData]);

  const handleInteractiveAccept = useCallback(async () => {
    const activeImage = selectedImages[wizardIndex];
    if (!activeImage || !activeImage.listingPhoto || !wizardGeneratedCfImageId) return;

    setWizardLoading(true);
    try {
      const res = await fetch(`/api/listing-photos/${activeImage.listingPhoto.id}/accept-blank-canvas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blankCanvasCfImageId: wizardGeneratedCfImageId,
          prompt: wizardPrompt || "Accepted Refinement",
        }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!data.success) {
        throw new Error(data.error || "Failed to accept blank canvas");
      }
      toast.success("Blank canvas accepted!");

      if (wizardIndex + 1 < selectedImages.length) {
        setWizardPrompt("Loading prompt template...");
        setWizardIndex((prev) => prev + 1);
        setWizardStage("setup");
        setWizardGeneratedUrl(null);
        setWizardGeneratedCfImageId(null);
        setWizardThoughts(null);
        setWizardError(null);
        setWizardMaskBase64(null);
        setWizardHistory([]);
      } else {
        handleReset();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to accept blank canvas");
    } finally {
      setWizardLoading(false);
    }
  }, [selectedImages, wizardIndex, wizardGeneratedCfImageId, wizardPrompt, handleReset]);

  const handleSkip = useCallback(() => {
    if (wizardIndex + 1 < selectedImages.length) {
      setWizardPrompt("Loading prompt template...");
      setWizardIndex((prev) => prev + 1);
      setWizardStage("setup");
      setWizardGeneratedUrl(null);
      setWizardGeneratedCfImageId(null);
      setWizardThoughts(null);
      setWizardError(null);
      setWizardMaskBase64(null);
      setWizardHistory([]);
      toast.info("Skipped to next photo");
    } else {
      toast.info("Finished wizard");
      handleReset();
    }
  }, [selectedImages, wizardIndex, handleReset]);

  const handleInteractiveRefine = useCallback(async () => {
    const activeImage = selectedImages[wizardIndex];
    if (!activeImage || !activeImage.listingPhoto) return;

    const baseImg = wizardRefineBase === "last-edit" ? wizardGeneratedUrl : resolveImageUrl(activeImage);
    if (!baseImg) return;

    setWizardLoading(true);
    setWizardError(null);
    setWizardThoughts(null);
    try {
      const res = await fetch("/api/listing-photos/refine-blank-canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingPhotoId: activeImage.listingPhoto.id,
          baseImageUrl: baseImg,
          maskBase64: wizardMaskBase64 || undefined,
          prompt: wizardPrompt,
          leaveOutline: wizardLeaveOutline,
        }),
      });

      if (!res.ok) {
        let errMsg = "Failed to refine blank canvas";
        let thoughts: string | null = null;
        try {
          const errData = await res.json() as { error?: string; details?: string; thoughts?: string };
          errMsg = errData.details || errData.error || errMsg;
          thoughts = errData.thoughts || null;
        } catch {
          errMsg = await res.text() || errMsg;
        }
        if (thoughts) {
          setWizardThoughts(thoughts);
        }
        throw new Error(errMsg);
      }

      const data = (await res.json()) as {
        success: boolean;
        blankCanvasCfImageId: string;
        deliveryUrl: string;
        thoughts?: string;
      };
      setWizardGeneratedUrl(data.deliveryUrl);
      setWizardGeneratedCfImageId(data.blankCanvasCfImageId);
      setWizardThoughts(data.thoughts || null);
      setWizardHistory((prev) => [
        ...prev,
        {
          url: data.deliveryUrl,
          cfImageId: data.blankCanvasCfImageId,
          prompt: wizardPrompt,
          thoughts: data.thoughts || null,
        },
      ]);
      setWizardStage("review");
      toast.success("Refinement completed!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setWizardError(msg);
      toast.error(msg);
    } finally {
      setWizardLoading(false);
    }
  }, [selectedImages, wizardIndex, wizardRefineBase, wizardGeneratedUrl, wizardMaskBase64, wizardPrompt, wizardLeaveOutline]);

  const selectFloor = useCallback(
    (floorKey: string) => {
      const group = needsCanvasGrouped.groups.find((g) => g.floor.key === floorKey);
      if (!group) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const floorIds = group.rooms.flatMap((r) =>
          r.images
            .map((img) => img.listingPhoto?.id)
            .filter((id): id is number => typeof id === "number"),
        );
        const allFloorSelected = floorIds.every((id) => next.has(id));
        if (allFloorSelected) {
          for (const id of floorIds) next.delete(id);
        } else {
          for (const id of floorIds) next.add(id);
        }
        return next;
      });
    },
    [needsCanvasGrouped],
  );

  const selectRoom = useCallback(
    (roomId: number) => {
      for (const group of needsCanvasGrouped.groups) {
        const roomGroup = group.rooms.find((r) => r.room.id === roomId);
        if (!roomGroup) continue;
        setSelectedIds((prev) => {
          const next = new Set(prev);
          const roomPhotoIds = roomGroup.images
            .map((img) => img.listingPhoto?.id)
            .filter((id): id is number => typeof id === "number");
          const allRoomSelected = roomPhotoIds.every((id) => next.has(id));
          if (allRoomSelected) {
            for (const id of roomPhotoIds) next.delete(id);
          } else {
            for (const id of roomPhotoIds) next.add(id);
          }
          return next;
        });
        break;
      }
    },
    [needsCanvasGrouped],
  );

  // Bulk skip status toggle
  const handleBulkSkipStatus = useCallback(async (skip: boolean) => {
    if (selectedIds.size === 0) return;
    setUpdatingSkip(true);
    try {
      const response = await fetch("/api/listing-photos/bulk-skip-blank-canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          skip,
        }),
      });
      const data = (await response.json()) as { success: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to update skip status");
      }
      toast.success(
        skip
          ? `Successfully excluded ${selectedIds.size} photo(s)`
          : `Successfully marked ${selectedIds.size} photo(s) as needing canvas`
      );
      setSelectedIds(new Set());
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update skip status");
    } finally {
      setUpdatingSkip(false);
    }
  }, [selectedIds, loadData]);

  // -----------------------------------------------------------------------
  // Manual workflow: Download script
  // -----------------------------------------------------------------------

  const handleDownloadScript = useCallback(async () => {
    const ids = Array.from(selectedIds).join(",");
    const url = `/api/listing-photos/download-script?ids=${ids}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to generate download script");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "download_listing_photos.sh";
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Download script saved!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to download script");
    }
  }, [selectedIds]);

  // -----------------------------------------------------------------------
  // Manual workflow: Upload + Auto-match
  // -----------------------------------------------------------------------

  const handleFilesAdded = useCallback(
    (files: File[]) => {
      const newUploaded: UploadedCanvasFile[] = files.map((file) => {
        const normalized = normalizeFilename(file.name);
        let matchedId: number | null = null;

        // Try to match by filename containing listingPhotoId
        for (const img of selectedImages) {
          const lpId = img.listingPhoto?.id;
          if (!lpId) continue;

          // Check if filename contains the listing photo ID
          const roomName = (img.listingPhoto?.roomName || "room")
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .toLowerCase();
          const expectedStem = `${roomName}_${lpId}`;
          if (
            normalized.includes(String(lpId)) ||
            normalized.includes(expectedStem)
          ) {
            matchedId = lpId;
            break;
          }
        }

        return {
          file,
          objectUrl: URL.createObjectURL(file),
          matchedListingPhotoId: matchedId,
          filename: file.name,
        };
      });

      setUploadedFiles((prev) => [...prev, ...newUploaded]);
    },
    [selectedImages],
  );

  const handlePairClick = useCallback(
    (listingPhotoId: number) => {
      if (pairingMode === null) return;
      setUploadedFiles((prev) =>
        prev.map((uf, idx) =>
          idx === pairingMode ? { ...uf, matchedListingPhotoId: listingPhotoId } : uf,
        ),
      );
      setPairingMode(null);
      toast.success("Paired!");
    },
    [pairingMode],
  );

  const handleUnpair = useCallback((uploadIdx: number) => {
    setUploadedFiles((prev) =>
      prev.map((uf, idx) =>
        idx === uploadIdx ? { ...uf, matchedListingPhotoId: null } : uf,
      ),
    );
  }, []);

  const handleRemoveUpload = useCallback((uploadIdx: number) => {
    setUploadedFiles((prev) => {
      const removed = prev[uploadIdx];
      if (removed) URL.revokeObjectURL(removed.objectUrl);
      return prev.filter((_, idx) => idx !== uploadIdx);
    });
  }, []);

  const pairedCount = useMemo(
    () => uploadedFiles.filter((f) => f.matchedListingPhotoId !== null).length,
    [uploadedFiles],
  );

  const handleSaveAllPairs = useCallback(async () => {
    const pairs = uploadedFiles.filter((f) => f.matchedListingPhotoId !== null);
    if (pairs.length === 0) {
      toast.error("No paired files to save");
      return;
    }

    setSavingPairs(true);
    let success = 0;
    let failed = 0;

    for (const pair of pairs) {
      try {
        const formData = new FormData();
        formData.append("file", pair.file);
        const response = await fetch(
          `/api/listing-photos/${pair.matchedListingPhotoId}/blank-canvas`,
          { method: "POST", body: formData },
        );
        const data = (await response.json()) as { success: boolean; error?: string; details?: string };
        if (!response.ok || !data.success) {
          const errMsg = data.error ? (data.details ? `${data.error} (${data.details})` : data.error) : "Upload failed";
          throw new Error(errMsg);
        }
        success++;
      } catch (error: any) {
        failed++;
        console.error(`Failed to save pair for LP ${pair.matchedListingPhotoId}:`, error);
        toast.error(`Error saving ${pair.file.name}: ${error.message || error}`);
      }
    }

    setSavingPairs(false);
    if (failed === 0) {
      toast.success(`All ${success} blank canvases saved!`);
    } else {
      toast.warning(`${success} saved, ${failed} failed`);
    }

    // Refresh data
    setUploadedFiles([]);
    setStep("select");
    setSelectedIds(new Set());
    void loadData();
  }, [uploadedFiles, loadData]);

  // -----------------------------------------------------------------------
  // AI workflow
  // -----------------------------------------------------------------------

  const handleStartGeneration = useCallback(async () => {
    setStartingGeneration(true);
    try {
      const response = await fetch("/api/listing-photos/generate-blank-canvases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingPhotoIds: Array.from(selectedIds) }),
      });
      const data = (await response.json()) as {
        success: boolean;
        jobId?: string;
        error?: string;
      };
      if (!response.ok || !data.success || !data.jobId) {
        throw new Error(data.error || "Failed to start generation");
      }
      setGenerationJobId(data.jobId);
      toast.success("Generation started!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start generation");
    } finally {
      setStartingGeneration(false);
    }
  }, [selectedIds]);

  // Poll for generation progress
  useEffect(() => {
    if (!generationJobId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/listing-photos/generation-status/${generationJobId}`);
        const data = (await res.json()) as GenerationJobStatus;
        setGenerationStatus(data);
        if (data.isComplete && pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      } catch {
        // ignore transient poll errors
      }
    };

    void poll();
    pollingRef.current = setInterval(poll, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [generationJobId]);

  // -----------------------------------------------------------------------
  // Reset wizard
  // -----------------------------------------------------------------------

  const handleBack = useCallback(() => {
    if (step === "choose-mode") {
      setStep("select");
    } else if (step === "manual" || step === "ai-generate") {
      setStep("choose-mode");
      setUploadedFiles([]);
      setPairingMode(null);
      setGenerationJobId(null);
      setGenerationStatus(null);
    }
  }, [step]);


  // -----------------------------------------------------------------------
  // Copy prompt to clipboard
  // -----------------------------------------------------------------------

  const handleCopyPrompt = useCallback(() => {
    const textToCopy = defaultPrompt || "Remove ALL furniture, appliances, fixtures, decor, rugs, plants, curtains, window treatments, and personal items from this room photo. Leave the space completely empty.";
    navigator.clipboard.writeText(textToCopy).then(() => {
      setPromptCopied(true);
      toast.success("Prompt copied to clipboard!");
      setTimeout(() => setPromptCopied(false), 2000);
    });
  }, [defaultPrompt]);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const renderPhotoCard = useCallback(
    (image: ImageRecord, opts?: { onClick?: () => void; highlight?: boolean; compact?: boolean }) => {
      const lp = image.listingPhoto;
      if (!lp) return null;
      const isSelected = selectedIds.has(lp.id);
      const isHighlightTarget = opts?.highlight;

      return (
        <button
          key={image.id}
          type="button"
          onClick={() => opts?.onClick?.() ?? toggleSelection(lp.id)}
          className={cn(
            "group relative w-full overflow-hidden rounded-lg border text-left transition select-none",
            isSelected
              ? "border-primary ring-2 ring-primary/40"
              : "border-border/60 hover:border-primary/40",
            isHighlightTarget && "border-amber-500 ring-2 ring-amber-500/40 animate-pulse",
            opts?.compact && "rounded-md",
          )}
        >
          <div className={cn("relative w-full bg-muted/30", opts?.compact ? "aspect-square" : "aspect-[4/3]")}>
            {/* biome-ignore lint/performance/noImgElement: CF Images URL */}
            <img
              src={resolveImageUrl(image)}
              alt={image.displayName || "Listing photo"}
              className="size-full object-cover"
              loading="lazy"
            />
            <div
              className={cn(
                "absolute inset-0 bg-black/40 transition-opacity",
                isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-15",
              )}
            />
            {step === "select" && (
              <span
                className={cn(
                  "absolute right-2 top-2 inline-flex size-5 items-center justify-center rounded-full border text-[11px]",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-white/60 bg-black/45 text-white",
                )}
              >
                <Check className="size-3" />
              </span>
            )}
          </div>
          <div className="space-y-0.5 p-2">
            <p className="truncate text-xs font-medium">
              {image.displayName || image.roomType || "Untitled photo"}
            </p>
            {lp.roomName && (
              <p className="text-[11px] text-muted-foreground">{lp.roomName}</p>
            )}
          </div>
        </button>
      );
    },
    [selectedIds, toggleSelection, step],
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
            <CardDescription className="text-xs">Total Excluded</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-red-400">
              {excludedPhotos.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Fix / Manage View Mode Toggle */}
      {step === "select" && (
        <div className="flex justify-between items-center border-b border-border/40 pb-4">
          <div className="flex items-center gap-2 bg-muted/60 p-1 rounded-lg border border-border/20">
            <button
              onClick={() => setViewMode("fix")}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
                viewMode === "fix"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Fix Needed ({totalNeedsCanvas})
            </button>
            <button
              onClick={() => setViewMode("manage")}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
                viewMode === "manage"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Manage Canvases
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP: SELECT PHOTOS                                                */}
      {/* ================================================================= */}
      {step === "select" && (
        viewMode === "fix" ? (
          // -------------------------------------------------------------
          // FIX NEEDED VIEW
          // -------------------------------------------------------------
          (totalNeedsCanvas > 0 || excludedPhotos.length > 0) ? (
            <div className="space-y-4">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectedIds.size > 0 ? selectNone : selectAll}
                >
                  {selectedIds.size > 0 ? "Deselect All" : "Select All"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {selectedIds.size} selected
                </p>

                <div className="flex-1" />

                {activeTab === "excluded" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkSkipStatus(false)}
                    disabled={selectedIds.size === 0 || updatingSkip}
                    className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300"
                  >
                    {updatingSkip ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    Mark Selected as Needing Canvas
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleBulkSkipStatus(true)}
                      disabled={selectedIds.size === 0 || updatingSkip}
                      className="gap-1.5 border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 mr-2"
                    >
                      {updatingSkip ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Ban className="size-3.5" />
                      )}
                      Exclude Selected
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setStep("choose-mode")}
                      disabled={selectedIds.size === 0}
                    >
                      Continue with {selectedIds.size} photo{selectedIds.size !== 1 ? "s" : ""}
                    </Button>
                  </>
                )}
              </div>

              {/* Floor tabs with photo grids */}
              <Tabs key={activeTab} defaultValue={activeTab} onValueChange={handleTabChange}>
                <TabsList>
                  {needsCanvasGrouped.groups.map((floorGroup) => (
                    <TabsTrigger key={floorGroup.floor.key} value={floorGroup.floor.key}>
                      <Building2 className="mr-1.5 size-3.5" />
                      {floorGroup.floor.name}
                      <Badge variant="secondary" className="ml-1.5 text-[10px] tabular-nums">
                        {floorGroup.rooms.reduce((sum, r) => sum + r.images.length, 0)}
                      </Badge>
                    </TabsTrigger>
                  ))}
                  {needsCanvasGrouped.unmatched.length > 0 && (
                    <TabsTrigger value="unassigned">
                      <Image className="mr-1.5 size-3.5" />
                      Unassigned
                      <Badge variant="secondary" className="ml-1.5 text-[10px] tabular-nums">
                        {needsCanvasGrouped.unmatched.length}
                      </Badge>
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="excluded">
                    <Ban className="mr-1.5 size-3.5 text-red-400" />
                    Excluded
                    <Badge variant="secondary" className="ml-1.5 text-[10px] tabular-nums">
                      {excludedPhotos.length}
                    </Badge>
                  </TabsTrigger>
                </TabsList>

                {needsCanvasGrouped.groups.map((floorGroup) => (
                  <TabsContent
                    key={floorGroup.floor.key}
                    value={floorGroup.floor.key}
                    className="space-y-6 pt-4"
                  >
                    {/* Floor-level select */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => selectFloor(floorGroup.floor.key)}
                    >
                      Toggle entire floor
                    </Button>

                    {floorGroup.rooms.map((roomGroup) => (
                      <div key={roomGroup.room.id} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => selectRoom(roomGroup.room.id)}
                            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {roomGroup.room.displayName}
                          </button>
                          <Badge variant="secondary" className="text-[10px]">
                            {roomGroup.images.length} photo{roomGroup.images.length !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {roomGroup.images.map((img) => renderPhotoCard(img))}
                        </div>
                      </div>
                    ))}
                  </TabsContent>
                ))}

                {needsCanvasGrouped.unmatched.length > 0 && (
                  <TabsContent value="unassigned" className="space-y-2 pt-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {needsCanvasGrouped.unmatched.map((img) => renderPhotoCard(img))}
                    </div>
                  </TabsContent>
                )}

                <TabsContent value="excluded" className="space-y-2 pt-4">
                  {excludedPhotos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
                      <CheckCircle2 className="size-8 text-emerald-500/80" />
                      No photos excluded from blank canvas workflows.
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {excludedPhotos.map((img) => renderPhotoCard(img))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          ) : (
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
          )
        ) : (
          // -------------------------------------------------------------
          // MANAGE CANVASES VIEW
          // -------------------------------------------------------------
          <div className="space-y-4">
            <Tabs key={activeTab} defaultValue={activeTab} onValueChange={handleTabChange}>
              <TabsList>
                {allListingPhotosGrouped.groups.map((floorGroup) => (
                  <TabsTrigger key={floorGroup.floor.key} value={floorGroup.floor.key}>
                    <Building2 className="mr-1.5 size-3.5" />
                    {floorGroup.floor.name}
                    <Badge variant="secondary" className="ml-1.5 text-[10px] tabular-nums">
                      {floorGroup.rooms.reduce((sum, r) => sum + r.images.length, 0)}
                    </Badge>
                  </TabsTrigger>
                ))}
                {allListingPhotosGrouped.unmatched.length > 0 && (
                  <TabsTrigger value="unassigned">
                    <Image className="mr-1.5 size-3.5" />
                    Unassigned
                    <Badge variant="secondary" className="ml-1.5 text-[10px] tabular-nums">
                      {allListingPhotosGrouped.unmatched.length}
                    </Badge>
                  </TabsTrigger>
                )}
              </TabsList>

              {allListingPhotosGrouped.groups.map((floorGroup) => (
                <TabsContent
                  key={floorGroup.floor.key}
                  value={floorGroup.floor.key}
                  className="space-y-6 pt-4"
                >
                  {floorGroup.rooms.map((roomGroup) => (
                    <div key={roomGroup.room.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {roomGroup.room.displayName}
                        </span>
                        <Badge variant="secondary" className="text-[10px]">
                          {roomGroup.images.length} photo{roomGroup.images.length !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        {roomGroup.images.map((img) => (
                          <ManageListingPhotoCard
                            key={img.id}
                            image={img}
                            onGenerateNew={handleGenerateForPhoto}
                            onRefreshStats={loadData}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </TabsContent>
              ))}

              {allListingPhotosGrouped.unmatched.length > 0 && (
                <TabsContent value="unassigned" className="space-y-2 pt-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    {allListingPhotosGrouped.unmatched.map((img) => (
                      <ManageListingPhotoCard
                        key={img.id}
                        image={img}
                        onGenerateNew={handleGenerateForPhoto}
                        onRefreshStats={loadData}
                      />
                    ))}
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </div>
        )
      )}

      {/* ================================================================= */}
      {/* STEP: CHOOSE MODE                                                  */}
      {/* ================================================================= */}
      {step === "choose-mode" && (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
            <ArrowLeft className="size-3.5" />
            Back to selection
          </Button>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Manual card */}
            <button
              type="button"
              onClick={() => setStep("manual")}
              className="group text-left"
            >
              <Card className="ring-1 ring-border/20 transition-colors group-hover:ring-primary/50 h-full">
                <CardHeader>
                  <div className="flex size-10 items-center justify-center rounded-lg bg-sky-500/10 mb-2">
                    <Wrench className="size-5 text-sky-400" />
                  </div>
                  <CardTitle className="text-lg">Manual Edit</CardTitle>
                  <CardDescription>
                    Download listing photos, edit them externally in your preferred AI tool
                    (Photoshop, DALL-E, etc.), then re-upload the blank canvas versions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    <li>• Download Python script with CF Images URLs</li>
                    <li>• Copy the recommended prompt</li>
                    <li>• Edit photos in your AI tool of choice</li>
                    <li>• Bulk re-upload and auto-match</li>
                  </ul>
                </CardContent>
              </Card>
            </button>

            {/* AI card */}
            <button
              type="button"
              onClick={() => setStep("ai-generate")}
              className="group text-left"
            >
              <Card className="ring-1 ring-border/20 transition-colors group-hover:ring-primary/50 h-full">
                <CardHeader>
                  <div className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10 mb-2">
                    <Sparkles className="size-5 text-violet-400" />
                  </div>
                  <CardTitle className="text-lg">AI Generate</CardTitle>
                  <CardDescription>
                    Let Gemini automatically strip furniture from the selected photos.
                    Results are uploaded and paired automatically.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    <li>• Powered by Gemini 3 Pro via CF AI Gateway</li>
                    <li>• Max {selectedIds.size <= 20 ? selectedIds.size : 20} photos per batch</li>
                    <li>• ~30–60 seconds per photo</li>
                    <li>• Auto-upload &amp; auto-pair results</li>
                  </ul>
                </CardContent>
              </Card>
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP: MANUAL WORKFLOW                                              */}
      {/* ================================================================= */}
      {step === "manual" && (
        <div className="space-y-6">
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
            <ArrowLeft className="size-3.5" />
            Back to mode selection
          </Button>

          {/* Step A: Download + Prompt */}
          <Card className="ring-1 ring-border/20">
            <CardHeader>
              <CardTitle className="text-base">
                Step 1 — Download &amp; Edit
              </CardTitle>
              <CardDescription>
                Download the selected {selectedIds.size} photos, then edit them in your AI tool.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Prompt */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">
                  Recommended prompt for your AI editor:
                </p>
                <div className="relative rounded-lg border border-border/40 bg-muted/30 p-3">
                  <pre className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed">
                    {defaultPrompt || "Loading prompt template..."}
                  </pre>
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute right-2 top-2 gap-1.5 text-xs"
                    onClick={handleCopyPrompt}
                  >
                    {promptCopied ? (
                      <>
                        <Check className="size-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <ClipboardCopy className="size-3" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                className="gap-2"
                onClick={handleDownloadScript}
              >
                <Download className="size-4" />
                Download Python Script ({selectedIds.size} photos)
              </Button>
            </CardContent>
          </Card>

          {/* Step B: Upload edited photos */}
          <Card className="ring-1 ring-border/20">
            <CardHeader>
              <CardTitle className="text-base">
                Step 2 — Upload Edited Blank Canvases
              </CardTitle>
              <CardDescription>
                Drop your edited (furniture-removed) images here. The system will try to auto-match
                them to the original listing photos by filename.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FileUpload
                maxFiles={100}
                multiple
                accept="image/*"
                onValueChange={(files) => {
                  if (files.length > uploadedFiles.length) {
                    const newFiles = files.slice(uploadedFiles.length);
                    handleFilesAdded(newFiles);
                  }
                }}
              >
                <FileUploadDropzone>
                  <div className="flex flex-col items-center gap-2 py-4">
                    <Upload className="size-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Drag &amp; drop edited photos here, or click to browse
                    </p>
                  </div>
                  <FileUploadTrigger asChild>
                    <Button variant="outline" size="sm">
                      Browse files
                    </Button>
                  </FileUploadTrigger>
                </FileUploadDropzone>
              </FileUpload>

              {uploadedFiles.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {uploadedFiles.length} file{uploadedFiles.length !== 1 ? "s" : ""} uploaded
                      &middot; {pairedCount} paired
                    </p>
                    {pairingMode !== null && (
                      <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20">
                        Click a listing photo below to pair
                      </Badge>
                    )}
                  </div>

                  {/* Uploaded file cards */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {uploadedFiles.map((uf, idx) => (
                      <div
                        key={`upload-${idx}`}
                        className={cn(
                          "relative rounded-lg border overflow-hidden",
                          uf.matchedListingPhotoId
                            ? "border-emerald-500/30 ring-1 ring-emerald-500/20"
                            : pairingMode === idx
                              ? "border-amber-500 ring-2 ring-amber-500/40"
                              : "border-border/60",
                        )}
                      >
                        <div className="relative aspect-[4/3] bg-muted/30">
                          {/* biome-ignore lint/performance/noImgElement: local object URL */}
                          <img
                            src={uf.objectUrl}
                            alt={uf.filename}
                            className="size-full object-cover"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 p-2">
                          <p className="truncate text-xs font-medium">{uf.filename}</p>
                          <div className="flex shrink-0 gap-1">
                            {uf.matchedListingPhotoId ? (
                              <>
                                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1 text-[10px]">
                                  <CheckCircle2 className="size-3" />
                                  LP #{uf.matchedListingPhotoId}
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-[10px]"
                                  onClick={() => handleUnpair(idx)}
                                >
                                  Unpair
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-[10px]"
                                onClick={() =>
                                  setPairingMode(pairingMode === idx ? null : idx)
                                }
                              >
                                {pairingMode === idx ? "Cancel" : "Pair"}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] text-destructive"
                              onClick={() => handleRemoveUpload(idx)}
                            >
                              <XCircle className="size-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Listing photos grid for pairing (when in pairing mode) */}
                  {pairingMode !== null && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-amber-400">
                        Select the listing photo this blank canvas belongs to:
                      </p>
                      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {selectedImages.map((img) =>
                          renderPhotoCard(img, {
                            onClick: () => img.listingPhoto?.id && handlePairClick(img.listingPhoto.id),
                            highlight: false,
                            compact: true,
                          }),
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Save button */}
              {pairedCount > 0 && (
                <Button
                  onClick={handleSaveAllPairs}
                  disabled={savingPairs}
                  className="gap-2"
                >
                  {savingPairs ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Saving {pairedCount} pair{pairedCount !== 1 ? "s" : ""}...
                    </>
                  ) : (
                    <>
                      <Check className="size-4" />
                      Save {pairedCount} Blank Canvas{pairedCount !== 1 ? "es" : ""}
                    </>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP: AI GENERATE WORKFLOW                                          */}
      {/* ================================================================= */}
      {step === "ai-generate" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
            {selectedImages.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-full">
                  Photo {wizardIndex + 1} of {selectedImages.length}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={handleSkip}
                  className="h-7 text-xs gap-1 hover:bg-muted"
                >
                  Skip
                  <ArrowRight className="size-3" />
                </Button>
              </div>
            )}
          </div>

          {selectedImages.length === 0 ? (
            <Card className="ring-1 ring-border/20">
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No listing photos selected. Please go back and select at least one photo.
              </CardContent>
            </Card>
          ) : (
            (() => {
              const activeImage = selectedImages[wizardIndex];
              
              let matchedRoomName = activeImage.listingPhoto?.roomName || activeImage.roomType || "Listing Photo";
              let matchedFloorName = "Unassigned";

              if (activeImage.roomId) {
                for (const floor of floors) {
                  const r = floor.rooms.find((room) => room.id === activeImage.roomId);
                  if (r) {
                    matchedRoomName = r.displayName || r.roomName;
                    matchedFloorName = floor.name;
                    break;
                  }
                }
              } else if (Array.isArray(activeImage.roomLabels) && activeImage.roomLabels.length > 0) {
                for (const floor of floors) {
                  const r = floor.rooms.find((room) => activeImage.roomLabels?.includes(room.roomName));
                  if (r) {
                    matchedRoomName = r.displayName || r.roomName;
                    matchedFloorName = floor.name;
                    break;
                  }
                }
              }

              return (
                <Card className="ring-1 ring-border/20 overflow-hidden relative">
                  {wizardLoading && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs gap-3">
                      <Loader2 className="size-10 animate-spin text-primary" />
                      <p className="text-sm font-semibold text-white">
                        {wizardStage === "setup"
                          ? "Generating blank canvas..."
                          : "Processing refinement..."}
                      </p>
                    </div>
                  )}

                  <CardHeader className="border-b border-border/20 bg-muted/10 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">
                          {matchedRoomName}
                        </CardTitle>
                        <CardDescription>
                          Floor: {matchedFloorName}
                        </CardDescription>
                      </div>
                      <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20">
                        {wizardStage.toUpperCase()} STAGE
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="p-6">
                    <div className="grid gap-6 lg:grid-cols-2">
                      {/* Left Column: Image / Canvas Overlay */}
                      <div className="space-y-3">
                        {wizardStage === "setup" && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Original Photo with Masking
                              </span>
                              {wizardMaskBase64 && (
                                <span className="text-xs font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full ring-1 ring-emerald-500/20">
                                  ✓ Mask Active
                                </span>
                              )}
                            </div>
                            <InlineMaskEditor
                              imageUrl={resolveImageUrl(activeImage)}
                              onChange={setWizardMaskBase64}
                            />
                          </div>
                        )}

                        {wizardStage === "review" && wizardGeneratedUrl && (
                          <div className="space-y-1.5">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Generated Blank Canvas
                            </span>
                            <div className="overflow-hidden rounded-lg border border-emerald-500/20 aspect-[4/3] bg-muted/20 relative ring-1 ring-emerald-500/10">
                              {/* biome-ignore lint/performance/noImgElement: generated output preview */}
                              <img
                                src={wizardGeneratedUrl}
                                alt="Generated Blank Canvas"
                                className="size-full object-contain"
                              />
                            </div>
                          </div>
                        )}

                        {wizardStage === "refine" && (
                          <div className="space-y-1.5">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Paint Mask (Optional)
                            </span>
                            <InlineMaskEditor
                              imageUrl={
                                wizardRefineBase === "last-edit"
                                  ? wizardGeneratedUrl || resolveImageUrl(activeImage)
                                  : resolveImageUrl(activeImage)
                              }
                              onChange={setWizardMaskBase64}
                            />
                          </div>
                        )}
                      </div>

                      {/* Right Column: Prompt & Configurations */}
                      <div className="flex flex-col justify-between space-y-6">
                        {wizardStage === "setup" && (
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
                                Blank Canvas Generation Prompt
                              </label>
                              <PlatePromptEditor
                                dependencyKey={wizardPromptKey}
                                value={wizardPrompt}
                                onChange={setWizardPrompt}
                              />
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={handleSetSuggestedPrompt}
                                className="h-7 text-[10px]"
                              >
                                Use Default System Prompt
                              </Button>
                            </div>

                            <div className="space-y-2.5">
                              <div className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-muted/20 p-3">
                                <input
                                  type="checkbox"
                                  id="plumbing-toggle"
                                  checked={wizardLeaveOutline}
                                  onChange={(e) => setWizardLeaveOutline(e.target.checked)}
                                  className="mt-1 rounded border-border/40 bg-background text-primary focus:ring-primary/45"
                                />
                                <div className="grid gap-1">
                                  <label
                                    htmlFor="plumbing-toggle"
                                    className="text-xs font-semibold text-foreground cursor-pointer"
                                  >
                                    Leave faint outline for plumbing fixtures
                                  </label>
                                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                                    Instructs Gemini to retain very faint shapes where shower, vanity, toilet, and bath plumbing goes to root subsequent edit iterations.
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-muted/20 p-3">
                                <input
                                  type="checkbox"
                                  id="windows-toggle"
                                  checked={wizardHasWindows}
                                  onChange={(e) => setWizardHasWindows(e.target.checked)}
                                  className="mt-1 rounded border-border/40 bg-background text-primary focus:ring-primary/45"
                                />
                                <div className="grid gap-1">
                                  <label
                                    htmlFor="windows-toggle"
                                    className="text-xs font-semibold text-foreground cursor-pointer"
                                  >
                                    Preserve windows in the photo
                                  </label>
                                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                                    Tells Gemini to keep existing windows and window panes exactly as they are. Turn off if the photo has no windows to prevent hallucinations.
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-muted/20 p-3">
                                <input
                                  type="checkbox"
                                  id="skylights-toggle"
                                  checked={wizardHasSkylights}
                                  onChange={(e) => setWizardHasSkylights(e.target.checked)}
                                  className="mt-1 rounded border-border/40 bg-background text-primary focus:ring-primary/45"
                                />
                                <div className="grid gap-1">
                                  <label
                                    htmlFor="skylights-toggle"
                                    className="text-xs font-semibold text-foreground cursor-pointer"
                                  >
                                    Preserve skylights in the ceiling
                                  </label>
                                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                                    Instructs Gemini to preserve skylights on the ceiling. Keep off if there are no skylights.
                                  </p>
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-2">
                              <Button
                                onClick={handleInteractiveGenerate}
                                disabled={wizardLoading}
                                className="flex-1 gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                              >
                                <Sparkles className="size-4" />
                                Generate Blank Canvas
                              </Button>
                              <Button
                                variant="outline"
                                onClick={handleSkip}
                                disabled={wizardLoading}
                                className="gap-1.5 hover:bg-muted"
                              >
                                Skip Photo
                              </Button>
                            </div>
                          </div>
                        )}

                        {wizardStage === "review" && (
                          <div className="space-y-4">
                            <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-2">
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Prompt Used
                              </h4>
                              <p className="text-xs text-foreground italic leading-relaxed whitespace-pre-wrap">
                                "{wizardPrompt}"
                              </p>
                            </div>

                            {wizardThoughts && (
                              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4 space-y-2 ring-1 ring-violet-500/10">
                                <h4 className="text-xs font-semibold text-violet-400 uppercase tracking-wide flex items-center gap-1.5">
                                  <Bot className="size-3.5" />
                                  Gemini's Thoughts
                                </h4>
                                <p className="text-xs text-muted-foreground italic leading-relaxed whitespace-pre-wrap">
                                  {wizardThoughts}
                                </p>
                              </div>
                            )}

                            {wizardHistory.length > 1 && (
                              <div className="rounded-lg border border-border/40 bg-muted/10 p-4 space-y-3">
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  Prior Edits / Version History
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                  {wizardHistory.map((item, idx) => {
                                    const isActive = wizardGeneratedCfImageId === item.cfImageId;
                                    return (
                                      <Button
                                        key={`history-${idx}`}
                                        variant={isActive ? "default" : "outline"}
                                        size="xs"
                                        onClick={() => {
                                          setWizardGeneratedUrl(item.url);
                                          setWizardGeneratedCfImageId(item.cfImageId);
                                          setWizardThoughts(item.thoughts || null);
                                          setWizardPrompt(item.prompt);
                                          setWizardPromptKey((prev) => prev + 1);
                                          toast.info(`Restored Version ${idx + 1}`);
                                        }}
                                        className={cn(
                                          "text-[10px] h-7 px-2.5",
                                          isActive && "bg-violet-600 text-white hover:bg-violet-700 hover:text-white"
                                        )}
                                      >
                                        V{idx + 1} {idx === 0 ? "(Initial)" : `(Refine ${idx})`}
                                      </Button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <div className="grid gap-2">
                              <Button
                                onClick={handleInteractiveAccept}
                                disabled={wizardLoading}
                                className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                              >
                                <Check className="size-4" />
                                Accept Blank Canvas
                              </Button>

                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                   variant="outline"
                                   onClick={() => {
                                     setWizardRefineBase("last-edit");
                                     setWizardStage("refine");
                                     setWizardMaskBase64(null);
                                     setWizardPromptKey((prev) => prev + 1);
                                   }}
                                   className="gap-1.5 hover:bg-muted"
                                 >
                                  <Brush className="size-3.5" />
                                  Revise Last Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setWizardRefineBase("original");
                                    setWizardStage("refine");
                                    setWizardMaskBase64(null);
                                    void fetchDefaultPrompt(wizardLeaveOutline, !!wizardMaskBase64, wizardHasWindows, wizardHasSkylights);
                                  }}
                                  className="gap-1.5 hover:bg-muted"
                                >
                                  <ArrowLeft className="size-3.5" />
                                  Start Fresh
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={handleSkip}
                                  className="gap-1.5 col-span-2 hover:bg-muted"
                                >
                                  <SkipForward className="size-3.5" />
                                  Skip Photo
                                </Button>
                              </div>

                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setWizardStage("setup");
                                  setWizardGeneratedUrl(null);
                                  setWizardGeneratedCfImageId(null);
                                  setWizardThoughts(null);
                                }}
                                className="text-muted-foreground text-xs"
                              >
                                Cancel &amp; Restart Setup
                              </Button>
                            </div>
                          </div>
                        )}

                        {wizardStage === "refine" && (
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
                                Refinement Instructions
                              </label>
                              <PlatePromptEditor
                                dependencyKey={wizardPromptKey}
                                value={wizardPrompt}
                                onChange={setWizardPrompt}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                onClick={handleInteractiveRefine}
                                disabled={wizardLoading}
                                className="col-span-2 gap-2 bg-primary text-primary-foreground"
                              >
                                <Sparkles className="size-4" />
                                Run Refinement
                              </Button>

                              <Button
                                variant="outline"
                                onClick={() => {
                                  setWizardStage("review");
                                  setWizardMaskBase64(null);
                                }}
                                className="hover:bg-muted"
                              >
                                Cancel
                              </Button>

                              <Button
                                variant="outline"
                                onClick={handleSkip}
                                className="gap-1.5 hover:bg-muted"
                              >
                                Skip Photo
                              </Button>
                            </div>
                          </div>
                        )}

                        {wizardStage !== "review" && wizardThoughts && (
                          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4 space-y-2 ring-1 ring-violet-500/10">
                            <h4 className="text-xs font-semibold text-violet-400 uppercase tracking-wide flex items-center gap-1.5">
                              <Bot className="size-3.5" />
                              Gemini's Thoughts
                            </h4>
                            <p className="text-xs text-muted-foreground italic leading-relaxed whitespace-pre-wrap">
                              {wizardThoughts}
                            </p>
                          </div>
                        )}

                        {wizardError && (
                          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 space-y-3 ring-1 ring-destructive/10">
                            <div className="space-y-1.5">
                              <h4 className="text-xs font-semibold text-destructive uppercase tracking-wide flex items-center gap-1.5">
                                <XCircle className="size-3.5" />
                                Generation Failed
                              </h4>
                              <p className="text-xs text-muted-foreground font-mono bg-background/50 p-2 rounded border border-border/40 leading-relaxed whitespace-pre-wrap select-all">
                                {wizardError}
                              </p>
                            </div>

                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="xs"
                                className={cn(
                                  "flex-1 gap-1.5 text-xs transition-all duration-300",
                                  copiedError === wizardError
                                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                    : "hover:bg-muted"
                                )}
                                onClick={() => handleCopyErrorPrompt(wizardError)}
                              >
                                {copiedError === wizardError ? (
                                  <>
                                    <Check className="size-3.5" />
                                    Copied!
                                  </>
                                ) : (
                                  <>
                                    <ClipboardCopy className="size-3.5" />
                                    Copy Error
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={handleSkip}
                                className="flex-1 text-xs gap-1.5 hover:bg-muted"
                              >
                                <SkipForward className="size-3.5" />
                                Skip Photo
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
}
