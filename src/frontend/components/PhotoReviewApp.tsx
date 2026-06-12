import {
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  FileImage,
  Home,
  Info,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface ImageRecord {
  id: string;
  path: string;
  filename: string;
  room: string;
  tags: string | string[];
  note: string;
  reviewed?: boolean;
  sourceFile?: string;
  imageNumber?: string;
  igAccount?: string;
  visibleCaption?: string;
  width?: number;
  height?: number;
}

const imageSrc = (image: ImageRecord) =>
  image.path.startsWith("http") ? image.path : `/images/${image.path}`;

export function PhotoReviewApp() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);

  const [zoomModalOpen, setZoomModalOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<ImageRecord | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  const [panelRoom, setPanelRoom] = useState("");
  const [panelTags, setPanelTags] = useState("");
  const [panelNote, setPanelNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState("queued");

  const fetchImages = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }
      try {
        const res = await fetch("/api/photo-reviews");
        const data = (await res.json()) as {
          images?: ImageRecord[];
        };

        if (data.images) {
          setImages(data.images);
        }
        return data;
      } catch {
        toast.error("Failed to load images");
        return { images: undefined };
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void fetchImages();
  }, [fetchImages]);

  useEffect(() => {
    const onGlobalUploadComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{
        target?: string;
        isListingPhoto?: boolean;
      }>;
      const target = customEvent.detail?.target;
      if (
        target === "photo-reviews" ||
        (target === "images" && customEvent.detail?.isListingPhoto !== true)
      ) {
        void fetchImages({ silent: true });
      }
    };

    window.addEventListener("global-upload-complete", onGlobalUploadComplete);
    return () => {
      window.removeEventListener("global-upload-complete", onGlobalUploadComplete);
    };
  }, [fetchImages]);

  useEffect(() => {
    if (!selectedImage) return;

    setPanelRoom(selectedImage.room || "unassigned");

    let tags = selectedImage.tags;
    if (typeof tags === "string") {
      try {
        tags = JSON.parse(tags);
      } catch {
        tags = [];
      }
    }

    setPanelTags(Array.isArray(tags) ? tags.join(", ") : "");
    setPanelNote(selectedImage.note || "");
  }, [selectedImage]);

  const getTags = useCallback((tagsRaw: string | string[]): string[] => {
    if (Array.isArray(tagsRaw)) return tagsRaw;

    if (typeof tagsRaw === "string") {
      try {
        const parsed = JSON.parse(tagsRaw);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return [];
      }
    }

    return [];
  }, []);

  const queuedImages = useMemo(
    () =>
      images
        .filter((image) => !image.reviewed)
        .sort((a, b) => a.filename.localeCompare(b.filename)),
    [images],
  );

  const reviewedImages = useMemo(
    () =>
      images
        .filter((image) => image.reviewed)
        .sort((a, b) => a.filename.localeCompare(b.filename)),
    [images],
  );

  const queuedCount = queuedImages.length;
  const reviewedCount = reviewedImages.length;

  const saveSelectedImage = useCallback(async () => {
    if (!selectedImage) return;

    setIsSaving(true);

    const wasReviewed = !!selectedImage.reviewed;
    const queueBeforeSave = queuedImages;

    const tags = panelTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    try {
      const response = await fetch(`/api/photo-reviews/${selectedImage.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room: panelRoom,
          tags,
          note: panelNote,
          reviewed: true,
        }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        image?: ImageRecord;
      };

      if (payload.success) {
        await fetchImages({ silent: true });
        toast.success("Saved changes");

        if (!wasReviewed) {
          const currentIndex = queueBeforeSave.findIndex(
            (image) => image.id === selectedImage.id,
          );
          const nextImage = queueBeforeSave[currentIndex + 1];
          if (nextImage) {
            setSelectedImage(nextImage);
            toast.info("Advanced to next photo in queue");
          } else {
            setSelectedImage(null);
          }
        } else if (payload.image) {
          setSelectedImage(payload.image);
        }
      } else {
        toast.error("Failed to save changes");
      }
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  }, [fetchImages, panelNote, panelRoom, panelTags, queuedImages, selectedImage]);

  const deleteImage = useCallback(
    async (image: ImageRecord) => {
      setDeletingImageId(image.id);
      try {
        const response = await fetch(`/api/images/${image.id}`, {
          method: "DELETE",
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Failed to delete image");
        }

        await fetchImages({ silent: true });
        setSelectedImage((current) => (current?.id === image.id ? null : current));
        toast.success("Image deleted");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to delete image");
      } finally {
        setDeletingImageId(null);
      }
    },
    [fetchImages],
  );

  const openAiEdit = useCallback((image: ImageRecord) => {
    const params = new URLSearchParams({ sourceImageId: image.id });
    window.location.assign(`/photo-edits?${params.toString()}`);
  }, []);

  const openZoomModal = useCallback((image: ImageRecord) => {
    setZoomedImage(image);
    setZoomLevel(1);
    setZoomModalOpen(true);
  }, []);

  const renderSidebarPhotoRow = (image: ImageRecord) => {
    const tags = getTags(image.tags);
    const isSelected = selectedImage?.id === image.id;

    return (
      <ContextMenu key={image.id}>
        <ContextMenuTrigger>
          <button
            type="button"
            onClick={() => setSelectedImage(image)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-all",
              "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "bg-muted/50 ring-1 ring-ring"
                : "bg-transparent",
            )}
          >
            {/* biome-ignore lint/performance/noImgElement: photo review thumbnails */}
            <img
              src={imageSrc(image)}
              alt={image.filename}
              loading="lazy"
              className="size-10 shrink-0 rounded-md object-cover ring-1 ring-border/40"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium leading-tight">{image.filename}</p>
              <p className="truncate text-[11px] capitalize text-muted-foreground">
                {image.room || "unassigned"}
              </p>
              {tags.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-muted px-1 text-[9px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                  {tags.length > 2 && (
                    <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">
                      +{tags.length - 2}
                    </span>
                  )}
                </div>
              )}
            </div>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setSelectedImage(image)}>
            Review Photo
          </ContextMenuItem>
          <ContextMenuItem onClick={() => openAiEdit(image)}>
            Edit With AI
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={deletingImageId === image.id}
            onClick={() => deleteImage(image)}
          >
            Delete Image
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  // ─── Welcome / Landing State ──────────────────────────────────────────
  const renderWelcome = () => (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-xl gap-4 ring-1 ring-border/40">
        <CardHeader className="pb-0 text-center">
          <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-full bg-muted/50">
            <Camera className="size-8 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl">Welcome to Photo Reviews</CardTitle>
          <CardDescription className="mx-auto max-w-md">
            Review and organize your photos by assigning rooms, tags, and notes.
            Click a photo from the sidebar to get started.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-muted/30 p-4 text-center ring-1 ring-border/40">
              <p className="text-3xl font-semibold">{queuedCount}</p>
              <p className="text-sm text-muted-foreground">Queued for review</p>
            </div>
            <div className="rounded-xl bg-muted/30 p-4 text-center ring-1 ring-border/40">
              <p className="text-3xl font-semibold">{reviewedCount}</p>
              <p className="text-sm text-muted-foreground">Already reviewed</p>
            </div>
          </div>

          <div className="space-y-3 rounded-xl bg-muted/20 p-4 text-sm ring-1 ring-border/40">
            <p className="font-medium">How it works</p>
            <ol className="list-inside list-decimal space-y-1.5 text-muted-foreground">
              <li>Click a photo from the <strong>Queued</strong> tab in the sidebar</li>
              <li>Review and update the room, tags, and notes</li>
              <li>Click <strong>Save &amp; Next</strong> to advance to the next photo</li>
              <li>Edit any past review from the <strong>Reviewed</strong> tab</li>
            </ol>
          </div>

          {queuedCount > 0 ? (
            <Button
              onClick={() => {
                setSelectedImage(queuedImages[0]);
                setSidebarTab("queued");
              }}
              className="w-full gap-2"
            >
              <Check className="size-4" />
              Start reviewing ({queuedCount} photos)
            </Button>
          ) : reviewedCount > 0 ? (
            <Alert variant="default" className="border-border/40 bg-muted/20">
              <CheckCircle2 className="size-4" />
              <AlertTitle>You&apos;re all caught up!</AlertTitle>
              <AlertDescription>
                No more photos in the queue. You can edit any previous review by
                clicking a photo in the <strong>Reviewed</strong> tab.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="default" className="border-border/40 bg-muted/20">
              <Info className="size-4" />
              <AlertTitle>No photos yet</AlertTitle>
              <AlertDescription>
                Upload photos first, then come back here to review them.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );


  // ─── Review Form (main content when a photo is selected) ──────────────
  const renderReviewForm = () => {
    if (!selectedImage) return null;

    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border/40 bg-card/60 px-6 py-3 backdrop-blur">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{selectedImage.filename}</h2>
            <p className="text-xs capitalize text-muted-foreground">
              {selectedImage.room || "unassigned"}
              {selectedImage.reviewed ? " · Reviewed" : " · Queued"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSelectedImage(null)}
            title="Close review"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Photo preview */}
          <div className="flex items-center justify-center rounded-xl bg-muted/20 p-3 ring-1 ring-border/40">
            {/* biome-ignore lint/performance/noImgElement: photo review preview */}
            <img
              src={imageSrc(selectedImage)}
              alt={selectedImage.filename}
              className="max-h-72 w-full rounded-lg object-contain ring-1 ring-border/40"
            />
          </div>

          {/* Room & Tags */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5 md:col-span-1">
              <label
                htmlFor="photo-room"
                className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                <Home className="size-3.5" />
                Room
              </label>
              <input
                id="photo-room"
                type="text"
                value={panelRoom}
                onChange={(event) => setPanelRoom(event.target.value)}
                className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                placeholder="Kitchen"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label
                htmlFor="photo-tags"
                className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                <Tag className="size-3.5" />
                Tags
              </label>
              <textarea
                id="photo-tags"
                value={panelTags}
                onChange={(event) => setPanelTags(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
                placeholder="modern, white oak, brushed brass"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label
              htmlFor="photo-notes"
              className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              <FileImage className="size-3.5" />
              Notes
            </label>
            <textarea
              id="photo-notes"
              value={panelNote}
              onChange={(event) => setPanelNote(event.target.value)}
              rows={5}
              className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm outline-none ring-ring/40 transition focus:ring-2"
              placeholder="Lighting, finishes, layout ideas..."
            />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openZoomModal(selectedImage)}
            >
              <ZoomIn className="mr-2 size-4" />
              Zoom
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openAiEdit(selectedImage)}
            >
              <Sparkles className="mr-2 size-4" />
              Edit with AI
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={deletingImageId === selectedImage.id}
              onClick={() => deleteImage(selectedImage)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-2 size-4" />
              Delete
            </Button>
            <div className="flex-1" />
            <Button
              onClick={saveSelectedImage}
              disabled={isSaving}
              className="gap-2"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="size-4 animate-spin" />
                  Saving
                </>
              ) : (
                <>
                  <Check className="size-4" />
                  {selectedImage.reviewed ? "Save" : "Save & Next"}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-background text-foreground">
      {/* ─── Main Content (Left) ──────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border/40 bg-card/60 px-6 py-4 backdrop-blur">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Photo Reviews</h1>
            <p className="text-sm text-muted-foreground">
              {images.length} photos · {queuedCount} queued · {reviewedCount} reviewed
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchImages({ silent: true })}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </header>

        {loading && images.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <RefreshCw className="mr-3 size-6 animate-spin" />
            Loading photos...
          </div>
        ) : images.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="text-center">
              <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted/50">
                <FileImage className="size-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-medium">No photos yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Upload your first batch of photos. Workers AI will classify rooms and generate tags.
              </p>
            </div>
          </div>
        ) : selectedImage ? (
          renderReviewForm()
        ) : (
          renderWelcome()
        )}
      </div>

      {/* ─── Sidebar (Right) ─ Photo list with Queued / Reviewed tabs ─── */}
      <aside className="flex w-72 flex-col border-l border-border/40 bg-card/80 backdrop-blur">
        <Tabs value={sidebarTab} onValueChange={setSidebarTab} className="flex h-full flex-col">
          <div className="border-b border-border/40 px-3 py-3">
            <TabsList variant="line" className="w-full">
              <TabsTrigger value="queued" className="flex-1 gap-1.5 text-xs">
                Queued
                <Badge variant="secondary" className="h-5 min-w-5 px-1 text-[10px]">
                  {queuedCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="reviewed" className="flex-1 gap-1.5 text-xs">
                Reviewed
                <Badge variant="secondary" className="h-5 min-w-5 px-1 text-[10px]">
                  {reviewedCount}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="queued" className="h-full overflow-hidden">
            <div className="h-full space-y-1 overflow-y-auto p-2">
              {queuedCount === 0 ? (
                <div className="rounded-lg bg-muted/30 px-3 py-8 text-center text-xs text-muted-foreground ring-1 ring-border/40">
                  <CheckCircle2 className="mx-auto mb-2 size-5 text-emerald-400" />
                  No queued photos
                </div>
              ) : (
                queuedImages.map((image) => renderSidebarPhotoRow(image))
              )}
            </div>
          </TabsContent>

          <TabsContent value="reviewed" className="h-full overflow-hidden">
            <div className="h-full space-y-1 overflow-y-auto p-2">
              {reviewedCount === 0 ? (
                <div className="rounded-lg bg-muted/30 px-3 py-8 text-center text-xs text-muted-foreground ring-1 ring-border/40">
                  No reviewed photos yet
                </div>
              ) : (
                reviewedImages.map((image) => renderSidebarPhotoRow(image))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </aside>

      {/* ─── Zoom Modal ──────────────────────────────────────── */}
      <Dialog open={zoomModalOpen} onOpenChange={setZoomModalOpen}>
        <DialogContent className="sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{zoomedImage?.filename}</DialogTitle>
          </DialogHeader>

          <div className="relative max-h-[70vh] overflow-auto rounded-xl bg-muted/30 ring-1 ring-border/40">
            {zoomedImage && (
              <div className="flex min-h-[24rem] items-center justify-center p-4">
                {/* biome-ignore lint/performance/noImgElement: zoom modal image */}
                <img
                  src={imageSrc(zoomedImage)}
                  alt={zoomedImage.filename}
                  style={{ transform: `scale(${zoomLevel})` }}
                  className="max-w-full transition-transform"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setZoomLevel((level) => Math.max(0.5, level - 0.25))}
              title="Zoom out"
            >
              <ZoomOut className="size-4" />
            </Button>

            <input
              type="range"
              min={0.5}
              max={5}
              step={0.25}
              value={zoomLevel}
              onChange={(event) => setZoomLevel(Number(event.target.value))}
              className="flex-1"
            />

            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setZoomLevel((level) => Math.min(5, level + 0.25))}
              title="Zoom in"
            >
              <ZoomIn className="size-4" />
            </Button>

            <Button variant="ghost" size="sm" onClick={() => setZoomLevel(1)} className="gap-2">
              Reset
            </Button>

            <span className="min-w-14 text-right text-sm text-muted-foreground">
              {zoomLevel.toFixed(2)}x
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
