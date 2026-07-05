import {
  Crop,
  Home,
  Images,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ImagePreview } from "@/components/ui/image-preview";
import { ImageGallery, type ImageGalleryContextAction } from "@/components/ui/image-gallery";
import { GridBento } from "@/components/ui/grid-bento";
import { Button } from "@/components/ui/button";
import { Cropper, CropperArea, CropperImage, type CropperAreaData } from "@/components/ui/cropper";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ViewMode = "bento" | "gallery" | "list";

interface ImageRecord {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  roomType?: string | null;
  roomLabels?: string[];
  metadata?: string | null;
  isInstagram: boolean;
  isListingPhoto: boolean;
  datetimeCreated?: string | number | Date | null;
}

interface ViewImageRecord {
  raw: ImageRecord;
  id: string;
  name: string;
  path: string;
  room: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface ImageGroup {
  room: string;
  images: ViewImageRecord[];
}

interface ImagesGridEditorProps {
  isListingPhoto?: boolean;
  maxItems?: number;
  emptyMessage?: string;
}

interface ImagesPayload {
  images?: ImageRecord[];
}

interface CropState {
  crop: { x: number; y: number };
  zoom: number;
  rotation: number;
  areaPixels: CropperAreaData | null;
}

const DEFAULT_MAX_ITEMS = 120;

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}

function resolveImageUrl(image: ImageRecord): string {
  const deliveryId = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (deliveryId.startsWith("http://") || deliveryId.startsWith("https://")) {
    return deliveryId;
  }

  if (deliveryId.includes("/")) {
    return `https://imagedelivery.net/${deliveryId}/public`;
  }

  const metadata = parseMetadata(image.metadata);
  if (typeof metadata.deliveryUrl === "string") {
    return metadata.deliveryUrl;
  }

  return `https://imagedelivery.net/${deliveryId}/public`;
}

function formatDateLabel(value: ImageRecord["datetimeCreated"]): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString();
}

function buildViewImage(image: ImageRecord): ViewImageRecord {
  const metadata = parseMetadata(image.metadata);
  const roomLabels = Array.isArray(image.roomLabels)
    ? image.roomLabels.map((value) => String(value))
    : [];
  const resolvedRoom = roomLabels[0] || image.roomType?.trim() || "unassigned";
  const fallbackName =
    resolvedRoom === "unassigned"
      ? "Untitled photo"
      : `${resolvedRoom} photo`;

  return {
    raw: image,
    id: image.id,
    name: image.displayName?.trim() || fallbackName,
    path: resolveImageUrl(image),
    room: resolvedRoom,
    createdAt: formatDateLabel(image.datetimeCreated),
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
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load source image for cropping"));
    };

    image.src = url;
  });
}

async function cropImageBlob(
  sourceBlob: Blob,
  areaPixels: CropperAreaData,
  outputName: string,
): Promise<File> {
  const image = await createImageFromBlob(sourceBlob);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Failed to initialize crop canvas");
  }

  const x = Math.max(0, Math.round(areaPixels.x));
  const y = Math.max(0, Math.round(areaPixels.y));
  const width = Math.max(1, Math.round(areaPixels.width));
  const height = Math.max(1, Math.round(areaPixels.height));

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, x, y, width, height, 0, 0, width, height);

  const outputType = sourceBlob.type === "image/png" ? "image/png" : "image/jpeg";
  const croppedBlob = await new Promise<Blob>((resolve, reject) => {
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

  return new File([croppedBlob], outputName, {
    type: outputType,
    lastModified: Date.now(),
  });
}

export function ImagesGridEditor(props: ImagesGridEditorProps) {
  const {
    isListingPhoto,
    maxItems = DEFAULT_MAX_ITEMS,
    emptyMessage = "No images found yet.",
  } = props;

  const [images, setImages] = useState<ViewImageRecord[]>([]);
  const [groups, setGroups] = useState<ImageGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingCrop, setSavingCrop] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetImage, setDeleteTargetImage] = useState<ViewImageRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("bento");

  const [selectedImage, setSelectedImage] = useState<ViewImageRecord | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingImage, setEditingImage] = useState<ViewImageRecord | null>(null);
  const [cropState, setCropState] = useState<CropState>({
    crop: { x: 0, y: 0 },
    zoom: 1,
    rotation: 0,
    areaPixels: null,
  });

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    if (typeof isListingPhoto === "boolean") {
      params.set("isListingPhoto", String(isListingPhoto));
    }
    const query = params.toString();
    return query ? `/api/images?${query}` : "/api/images";
  }, [isListingPhoto]);

  const assignImages = useCallback(
    (rows: ImageRecord[]) => {
      const viewRows = rows
        .map(buildViewImage)
        .sort((a, b) => {
          const aTime = new Date(a.raw.datetimeCreated ?? 0).getTime();
          const bTime = new Date(b.raw.datetimeCreated ?? 0).getTime();
          return bTime - aTime;
        })
        .slice(0, maxItems);

      setImages(viewRows);
      setGroups(groupByRoom(viewRows));
    },
    [maxItems],
  );

  const loadImages = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(endpoint);
      const payload = (await response.json()) as ImagesPayload;

      if (!response.ok) {
        throw new Error("Failed to load images");
      }

      const fetchedImages = Array.isArray(payload.images) ? payload.images : [];
      assignImages(fetchedImages);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load images");
    } finally {
      setLoading(false);
    }
  }, [assignImages, endpoint]);

  const refreshImages = useCallback(async () => {
    setRefreshing(true);
    setErrorMessage(null);

    try {
      const response = await fetch(endpoint);
      const payload = (await response.json()) as ImagesPayload;

      if (!response.ok) {
        throw new Error("Failed to load images");
      }

      const fetchedImages = Array.isArray(payload.images) ? payload.images : [];
      assignImages(fetchedImages);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load images");
    } finally {
      setRefreshing(false);
    }
  }, [assignImages, endpoint]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  useEffect(() => {
    const onGlobalUploadComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{
        target?: string;
        isListingPhoto?: boolean;
      }>;

      if (customEvent.detail?.target !== "images" && customEvent.detail?.target !== "photo-reviews") {
        return;
      }

      if (isListingPhoto === true && customEvent.detail?.target === "photo-reviews") {
        return;
      }

      if (
        typeof isListingPhoto === "boolean" &&
        customEvent.detail?.target === "images" &&
        typeof customEvent.detail.isListingPhoto === "boolean" &&
        customEvent.detail.isListingPhoto !== isListingPhoto
      ) {
        return;
      }

      refreshImages();
    };

    window.addEventListener("global-upload-complete", onGlobalUploadComplete);
    return () => {
      window.removeEventListener("global-upload-complete", onGlobalUploadComplete);
    };
  }, [isListingPhoto, refreshImages]);

  const openCropEditor = (image: ViewImageRecord) => {
    setEditingImage(image);
    setCropState({
      crop: { x: 0, y: 0 },
      zoom: 1,
      rotation: 0,
      areaPixels: null,
    });
    setEditModalOpen(true);
  };

  const closeCropEditor = () => {
    setEditModalOpen(false);
    setEditingImage(null);
  };

  const saveCrop = useCallback(async () => {
    if (!editingImage || !cropState.areaPixels) {
      toast.error("Select a crop area before saving");
      return;
    }

    setSavingCrop(true);
    try {
      const sourceResponse = await fetch(editingImage.path, { cache: "no-store" });
      if (!sourceResponse.ok) {
        throw new Error(`Failed to fetch source image (${sourceResponse.status})`);
      }

      const sourceBlob = await sourceResponse.blob();
      const croppedFile = await cropImageBlob(
        sourceBlob,
        cropState.areaPixels,
        `${editingImage.id}-crop.jpg`,
      );

      const formData = new FormData();
      formData.append("file", croppedFile);

      const replaceResponse = await fetch(`/api/images/${editingImage.id}/replace`, {
        method: "POST",
        body: formData,
      });
      const replacePayload = (await replaceResponse.json()) as { error?: string };

      if (!replaceResponse.ok) {
        throw new Error(replacePayload.error ?? "Failed to save cropped image");
      }

      toast.success("Image updated");
      window.dispatchEvent(
        new CustomEvent("global-upload-complete", {
          detail: {
            target: "images",
            replaced: true,
            isListingPhoto: editingImage.raw.isListingPhoto === true,
          },
        }),
      );
      closeCropEditor();
      await refreshImages();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save crop");
    } finally {
      setSavingCrop(false);
    }
  }, [cropState.areaPixels, editingImage, refreshImages]);

  const requestDeleteImage = useCallback((image: ViewImageRecord) => {
    setDeleteTargetImage(image);
    setDeleteConfirmOpen(true);
  }, []);

  const deleteImage = useCallback(async () => {
    if (!deleteTargetImage) {
      return;
    }
    setDeleting(true);
    try {
      const response = await fetch(`/api/images/${deleteTargetImage.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete image");
      }

      if (selectedImage?.id === deleteTargetImage.id) {
        setSelectedImage(null);
        setPreviewOpen(false);
      }

      window.dispatchEvent(
        new CustomEvent("global-upload-complete", {
          detail: {
            target: "images",
            deleted: true,
            isListingPhoto: deleteTargetImage.raw.isListingPhoto === true,
          },
        }),
      );

      setDeleteConfirmOpen(false);
      setDeleteTargetImage(null);
      toast.success("Image deleted");
      await refreshImages();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete image");
    } finally {
      setDeleting(false);
    }
  }, [deleteTargetImage, refreshImages, selectedImage?.id]);

  const openPreview = (image: ViewImageRecord) => {
    setSelectedImage(image);
    setPreviewOpen(true);
  };

  const openMetadataEditor = useCallback((image: ViewImageRecord) => {
    const pagePath = image.raw.isListingPhoto ? "/listing-photos" : "/inspiration-photos";
    const params = new URLSearchParams({ imageId: image.id });
    window.location.assign(`${pagePath}?${params.toString()}`);
  }, []);

  const openAiEditor = useCallback((image: ViewImageRecord) => {
    const params = new URLSearchParams({ sourceImageId: image.id });
    window.location.assign(`/admin/photo-edits?${params.toString()}`);
  }, []);

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
            openMetadataEditor(image);
          }
        },
      },
      {
        id: "ai-edit",
        label: "Edit With AI",
        onSelect: (item) => {
          const image = imageById.get(item.id);
          if (image) {
            openAiEditor(image);
          }
        },
      },
      {
        id: "delete-image",
        label: "Delete Image",
        variant: "destructive",
        separatorBefore: true,
        onSelect: (item) => {
          const image = imageById.get(item.id);
          if (image) {
            requestDeleteImage(image);
          }
        },
      },
    ],
    [imageById, openAiEditor, openMetadataEditor, requestDeleteImage],
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
      })),
    [images],
  );

  if (loading && images.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading images...</p>;
  }

  if (errorMessage && images.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{errorMessage}</p>
        <Button variant="outline" size="sm" onClick={refreshImages}>
          <RefreshCw className="mr-2 size-4" />
          Retry
        </Button>
      </div>
    );
  }

  if (images.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
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
              variant={viewMode === "list" ? "default" : "outline"}
              size="icon-sm"
              onClick={() => setViewMode("list")}
              title="Grouped list view"
            >
              <List className="size-4" />
            </Button>
          </div>

          <Button variant="outline" size="sm" onClick={refreshImages} disabled={refreshing}>
            {refreshing ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Refreshing
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 size-4" />
                Refresh
              </>
            )}
          </Button>
        </div>

        {viewMode === "bento" ? (
          <GridBento
            items={flatItems}
            selectedId={selectedImage?.id}
            contextActions={imageContextActions}
            onSelect={(item) => {
              const found = images.find((entry) => entry.id === item.id);
              if (found) {
                openPreview(found);
              }
            }}
          />
        ) : viewMode === "gallery" ? (
          <ImageGallery
            items={flatItems}
            selectedId={selectedImage?.id}
            contextActions={imageContextActions}
            onSelect={(item) => {
              const found = images.find((entry) => entry.id === item.id);
              if (found) {
                openPreview(found);
              }
            }}
          />
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.room} className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Home className="size-4 text-muted-foreground" />
                  <h3 className="font-semibold capitalize">{group.room}</h3>
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
                  }))}
                  selectedId={selectedImage?.id}
                  contextActions={imageContextActions}
                  onSelect={(item) => {
                    const found = group.images.find((entry) => entry.id === item.id);
                    if (found) {
                      openPreview(found);
                    }
                  }}
                />
              </section>
            ))}
          </div>
        )}
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
            createdAt: selectedImage.createdAt,
            ...selectedImage.metadata,
          }}
          actions={
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPreviewOpen(false);
                  openCropEditor(selectedImage);
                }}
              >
                <Crop className="mr-2 size-4" />
                Crop & Save
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => requestDeleteImage(selectedImage)}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            </div>
          }
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
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={deleteImage} disabled={deleting}>
                {deleting ? (
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

      <Dialog open={editModalOpen} onOpenChange={(open) => (open ? setEditModalOpen(true) : closeCropEditor())}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Crop Uploaded Image</DialogTitle>
          </DialogHeader>

          {editingImage && (
            <div className="space-y-4">
              <div className="relative h-[22rem] overflow-hidden rounded-xl bg-muted/30 ring-1 ring-border/40">
                <Cropper
                  crop={cropState.crop}
                  zoom={cropState.zoom}
                  rotation={cropState.rotation}
                  aspectRatio={4 / 3}
                  withGrid
                  onCropChange={(crop) => setCropState((prev) => ({ ...prev, crop }))}
                  onZoomChange={(zoom) => setCropState((prev) => ({ ...prev, zoom }))}
                  onRotationChange={(rotation) =>
                    setCropState((prev) => ({ ...prev, rotation }))
                  }
                  onCropAreaChange={(_, areaPixels) =>
                    setCropState((prev) => ({ ...prev, areaPixels }))
                  }
                >
                  <CropperImage
                    src={editingImage.path}
                    alt="Crop target"
                    crossOrigin="anonymous"
                  />
                  <CropperArea />
                </Cropper>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="text-muted-foreground">
                    Zoom ({cropState.zoom.toFixed(2)}x)
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    step={0.05}
                    value={cropState.zoom}
                    onChange={(event) =>
                      setCropState((prev) => ({
                        ...prev,
                        zoom: Number(event.target.value),
                      }))
                    }
                    className="w-full"
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span className="text-muted-foreground">
                    Rotation ({Math.round(cropState.rotation)}°)
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={cropState.rotation}
                    onChange={(event) =>
                      setCropState((prev) => ({
                        ...prev,
                        rotation: Number(event.target.value),
                      }))
                    }
                    className="w-full"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeCropEditor}>
                  Cancel
                </Button>
                <Button onClick={saveCrop} disabled={savingCrop}>
                  {savingCrop ? (
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
