import {
  ArrowLeft,
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
const BLANK_CANVAS_PROMPT = `Remove ALL furniture, appliances, fixtures, decor, rugs, plants, curtains, window treatments, and personal items from this room photo. Leave the space completely empty — bare walls, bare floors, bare ceilings.

Preserve EXACTLY: flooring (material, color, finish, plank direction), every wall and wall color, all windows and their grids, all doors and openings, the ceiling, crown molding, baseboards, light switches, outlets, the room's dimensions and proportions, and the camera angle.

Do NOT crop, zoom, pan, rotate, re-frame, or change the aspect ratio. Fill any area previously occupied by furniture with the surrounding wall color and flooring material. The result should look like a vacant, move-in-ready empty room.`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlankCanvasAdminApp() {
  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [floors, setFloors] = useState<CatalogFloor[]>([]);

  // Wizard state
  const [step, setStep] = useState<WizardStep>("select");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

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
  // Derived data
  // -----------------------------------------------------------------------

  const needsCanvas = useMemo(() => {
    return images.filter(
      (img) =>
        img.photoCategory === "listing" &&
        (!img.listingPhoto || !img.listingPhoto.blankCanvasCfImageId),
    );
  }, [images]);

  const needsCanvasGrouped = useMemo(() => {
    const groups: Array<{
      floor: CatalogFloor;
      rooms: Array<{ room: CatalogRoom; images: ImageRecord[] }>;
    }> = [];

    for (const floor of floors) {
      const roomGroups: Array<{ room: CatalogRoom; images: ImageRecord[] }> = [];
      for (const room of floor.rooms) {
        const matched = needsCanvas.filter((img) => {
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
    const unmatched = needsCanvas.filter((img) => !matchedIds.has(img.id));

    return { groups, unmatched };
  }, [needsCanvas, floors]);

  const totalNeedsCanvas = needsCanvas.length;

  const totalWithCanvas = useMemo(() => {
    return images.filter(
      (img) =>
        img.photoCategory === "listing" &&
        img.listingPhoto?.blankCanvasCfImageId,
    ).length;
  }, [images]);

  // -----------------------------------------------------------------------
  // Selection helpers
  // -----------------------------------------------------------------------

  const selectedImages = useMemo(() => {
    return needsCanvas.filter(
      (img) => img.listingPhoto && selectedIds.has(img.listingPhoto.id),
    );
  }, [needsCanvas, selectedIds]);

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
    const allIds = needsCanvas
      .map((img) => img.listingPhoto?.id)
      .filter((id): id is number => typeof id === "number");
    setSelectedIds(new Set(allIds));
  }, [needsCanvas]);

  const selectNone = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

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
      a.download = "download_listing_photos.py";
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
        const data = (await response.json()) as { success: boolean; error?: string };
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Upload failed");
        }
        success++;
      } catch (error) {
        failed++;
        console.error(`Failed to save pair for LP ${pair.matchedListingPhotoId}:`, error);
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

  const handleReset = useCallback(() => {
    setStep("select");
    setSelectedIds(new Set());
    setUploadedFiles([]);
    setPairingMode(null);
    setGenerationJobId(null);
    setGenerationStatus(null);
    void loadData();
  }, [loadData]);

  // -----------------------------------------------------------------------
  // Copy prompt to clipboard
  // -----------------------------------------------------------------------

  const handleCopyPrompt = useCallback(() => {
    navigator.clipboard.writeText(BLANK_CANVAS_PROMPT).then(() => {
      setPromptCopied(true);
      toast.success("Prompt copied to clipboard!");
      setTimeout(() => setPromptCopied(false), 2000);
    });
  }, []);

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

      {/* ================================================================= */}
      {/* STEP: SELECT PHOTOS                                                */}
      {/* ================================================================= */}
      {step === "select" && totalNeedsCanvas > 0 && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={selectedIds.size === needsCanvas.length ? selectNone : selectAll}
            >
              {selectedIds.size === needsCanvas.length ? "Deselect All" : "Select All"}
            </Button>
            <p className="text-xs text-muted-foreground">
              {selectedIds.size} of {totalNeedsCanvas} selected
            </p>
            <div className="flex-1" />
            <Button
              size="sm"
              onClick={() => setStep("choose-mode")}
              disabled={selectedIds.size === 0}
            >
              Continue with {selectedIds.size} photo{selectedIds.size !== 1 ? "s" : ""}
            </Button>
          </div>

          {/* Floor tabs with photo grids */}
          <Tabs defaultValue={needsCanvasGrouped.groups[0]?.floor.key || "unassigned"}>
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
          </Tabs>
        </div>
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
                    {BLANK_CANVAS_PROMPT}
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
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
            <ArrowLeft className="size-3.5" />
            Back to mode selection
          </Button>

          <Card className="ring-1 ring-border/20">
            <CardHeader>
              <div className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10 mb-2">
                <Bot className="size-5 text-violet-400" />
              </div>
              <CardTitle className="text-base">
                AI Blank Canvas Generation
              </CardTitle>
              <CardDescription>
                Gemini will strip all furniture, fixtures, and decor from {selectedIds.size} selected
                photo{selectedIds.size !== 1 ? "s" : ""}. Results are auto-uploaded and paired.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Pre-generation: show selected photos and start button */}
              {!generationJobId && (
                <>
                  <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {selectedImages.map((img) => (
                      <div key={img.id} className="rounded-lg border border-border/40 overflow-hidden">
                        <div className="aspect-[4/3] bg-muted/30">
                          {/* biome-ignore lint/performance/noImgElement: CF Images URL */}
                          <img
                            src={resolveImageUrl(img)}
                            alt={img.displayName || "Listing photo"}
                            className="size-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <div className="p-1.5">
                          <p className="truncate text-[11px] text-muted-foreground">
                            {img.listingPhoto?.roomName || img.roomType || "Untitled"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedIds.size > 20 && (
                    <p className="text-xs text-destructive">
                      Maximum 20 photos per batch. Please go back and select fewer photos.
                    </p>
                  )}

                  <Button
                    onClick={handleStartGeneration}
                    disabled={startingGeneration || selectedIds.size > 20 || selectedIds.size === 0}
                    className="gap-2"
                  >
                    {startingGeneration ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4" />
                        Generate {selectedIds.size} Blank Canvas{selectedIds.size !== 1 ? "es" : ""}
                      </>
                    )}
                  </Button>
                </>
              )}

              {/* In-progress: show per-photo status */}
              {generationJobId && generationStatus && (
                <div className="space-y-4">
                  {/* Progress bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {generationStatus.isComplete ? "Complete" : "Processing..."}
                      </span>
                      <span className="tabular-nums text-foreground">
                        {generationStatus.summary.done + generationStatus.summary.failed} / {generationStatus.summary.total}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted/30">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          generationStatus.isComplete && generationStatus.summary.failed === 0
                            ? "bg-emerald-500"
                            : generationStatus.summary.failed > 0
                              ? "bg-amber-500"
                              : "bg-primary",
                        )}
                        style={{
                          width: `${((generationStatus.summary.done + generationStatus.summary.failed) / generationStatus.summary.total) * 100}%`,
                        }}
                      />
                    </div>
                    {generationStatus.summary.failed > 0 && (
                      <p className="text-xs text-destructive">
                        {generationStatus.summary.failed} failed
                      </p>
                    )}
                  </div>

                  {/* Per-item status cards */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {generationStatus.items.map((item) => {
                      const img = selectedImages.find(
                        (i) => i.listingPhoto?.id === item.listingPhotoId,
                      );
                      return (
                        <div
                          key={item.listingPhotoId}
                          className={cn(
                            "rounded-lg border overflow-hidden",
                            item.status === "done"
                              ? "border-emerald-500/30"
                              : item.status === "failed"
                                ? "border-destructive/30"
                                : item.status === "processing"
                                  ? "border-primary/30"
                                  : "border-border/40",
                          )}
                        >
                          <div className="aspect-[4/3] bg-muted/30 relative">
                            {img && (
                              // biome-ignore lint/performance/noImgElement: CF Images URL
                              <img
                                src={resolveImageUrl(img)}
                                alt={img.displayName || ""}
                                className="size-full object-cover"
                                loading="lazy"
                              />
                            )}
                            {item.status === "processing" && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                <Loader2 className="size-6 animate-spin text-white" />
                              </div>
                            )}
                            {item.status === "done" && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                <CheckCircle2 className="size-8 text-emerald-400" />
                              </div>
                            )}
                            {item.status === "failed" && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                <XCircle className="size-8 text-destructive" />
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 p-2">
                            <p className="truncate text-xs">
                              {img?.listingPhoto?.roomName || `LP #${item.listingPhotoId}`}
                            </p>
                            <Badge
                              className={cn(
                                "text-[10px]",
                                item.status === "done"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : item.status === "failed"
                                    ? "bg-destructive/10 text-destructive border-destructive/20"
                                    : item.status === "processing"
                                      ? "bg-primary/10 text-primary border-primary/20"
                                      : "bg-muted/40 text-muted-foreground",
                              )}
                            >
                              {item.status === "processing" && <Loader2 className="mr-1 size-2.5 animate-spin" />}
                              {item.status}
                            </Badge>
                          </div>
                          {item.status === "failed" && item.error && (
                            <div className="border-t border-border/20 px-2 py-1.5">
                              <p className="text-[10px] text-destructive/80 truncate">
                                {item.error}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Done state */}
                  {generationStatus.isComplete && (
                    <div className="flex items-center gap-3">
                      <Button onClick={handleReset} className="gap-2">
                        <Check className="size-4" />
                        Done — Return to selection
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Loading state for initial poll */}
              {generationJobId && !generationStatus && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <Loader2 className="size-4 animate-spin" />
                  Starting generation...
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
