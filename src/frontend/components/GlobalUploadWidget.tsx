import { Building2, CheckCircle2, Crop, Loader2, Upload, XCircle } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Cropper, CropperArea, CropperImage, type CropperAreaData } from "@/components/ui/cropper";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  FileUpload,
  FileUploadClear,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  buildImageStatusUrl,
  createTrackedUploadStateFromResult,
  getTrackedUploadLabel,
  getTrackedUploadMessage,
  hasTrackedUploadsInFlight,
  mergeTrackedUploadState,
  type TrackedUploadState,
  type UploadApiImageRecord,
  type UploadApiResponse,
} from "@/lib/image-upload-tracking";
import { cn } from "@/lib/utils";

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
  roomName: string;
  displayName: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 9999; // Effectively unlimited

const getFileKey = (file: File) =>
  `${file.name}-${file.size}-${file.type}-${file.lastModified}`;

function createImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read image for crop"));
    };

    image.src = url;
  });
}

async function getCroppedFile(file: File, areaPixels: CropperAreaData): Promise<File> {
  const image = await createImageFromFile(file);
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

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
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

  return new File([blob], file.name, {
    type: outputType,
    lastModified: Date.now(),
  });
}

export function GlobalUploadWidget() {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStates, setUploadStates] = useState<Record<string, TrackedUploadState>>({});
  const [status, setStatus] = useState<{
    tone: "neutral" | "success" | "error";
    message: string;
  } | null>(null);

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropTargetFile, setCropTargetFile] = useState<File | null>(null);
  const [cropAreaPixels, setCropAreaPixels] = useState<CropperAreaData | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropRotation, setCropRotation] = useState(0);
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 });

  const cropTargetPreview = useMemo(
    () => (cropTargetFile ? URL.createObjectURL(cropTargetFile) : null),
    [cropTargetFile],
  );

  useEffect(() => {
    return () => {
      if (cropTargetPreview) {
        URL.revokeObjectURL(cropTargetPreview);
      }
    };
  }, [cropTargetPreview]);

  const pageFlags = useMemo(() => {
    if (typeof window === "undefined") {
      return { isListingPage: false };
    }

    const path = window.location.pathname;
    return {
      isListingPage: path.startsWith("/listing-photos"),
    };
  }, []);

  const [catalogFloors, setCatalogFloors] = useState<CatalogFloor[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedFloorKey, setSelectedFloorKey] = useState("lower_level");
  const [selectedRoomId, setSelectedRoomId] = useState("");

  const lowerFloor = useMemo(
    () =>
      catalogFloors.find((floor) => floor.key === "lower_level") ||
      catalogFloors[0] ||
      null,
    [catalogFloors],
  );
  const upperFloor = useMemo(
    () =>
      catalogFloors.find((floor) => floor.key === "upper_level") ||
      catalogFloors[catalogFloors.length - 1] ||
      null,
    [catalogFloors],
  );
  const isUpperFloorSelected = selectedFloorKey === upperFloor?.key;
  const listingRoomsForSelectedFloor = useMemo(() => {
    const selectedFloor = catalogFloors.find((floor) => floor.key === selectedFloorKey);
    return selectedFloor?.rooms ?? [];
  }, [catalogFloors, selectedFloorKey]);
  const selectedListingRoom = useMemo(
    () =>
      listingRoomsForSelectedFloor.find(
        (room) => room.id === Number(selectedRoomId),
      ) || null,
    [listingRoomsForSelectedFloor, selectedRoomId],
  );
  const photoCategory = pageFlags.isListingPage ? "listing" : "inspirational";
  const pendingUploadCount = useMemo(
    () =>
      files.filter((file) => {
        const tracked = uploadStates[getFileKey(file)];
        return !tracked || tracked.status === "idle" || tracked.status === "failed";
      }).length,
    [files, uploadStates],
  );
  const processedCount = useMemo(
    () =>
      Object.values(uploadStates).filter((state) => state.status === "processed").length,
    [uploadStates],
  );
  const failedCount = useMemo(
    () =>
      Object.values(uploadStates).filter((state) => state.status === "failed").length,
    [uploadStates],
  );
  const activeProcessingCount = useMemo(
    () =>
      Object.values(uploadStates).filter(
        (state) =>
          state.status === "uploading" ||
          state.status === "queued" ||
          state.status === "processing",
      ).length,
    [uploadStates],
  );

  const fetchCatalog = useCallback(async () => {
    if (!pageFlags.isListingPage) {
      return;
    }

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
            roomName: string;
            displayName: string;
          }>;
        }>;
      };

      if (!response.ok || !payload.success) {
        throw new Error("Failed to load room list");
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
      if (!normalizedFloors.some((floor) => floor.key === selectedFloorKey)) {
        setSelectedFloorKey(normalizedFloors[0]?.key ?? "lower_level");
      }
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to load room list",
      });
    } finally {
      setCatalogLoading(false);
    }
  }, [pageFlags.isListingPage, selectedFloorKey]);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  useEffect(() => {
    if (!selectedRoomId) {
      return;
    }

    const existsInFloor = listingRoomsForSelectedFloor.some(
      (room) => room.id === Number(selectedRoomId),
    );
    if (!existsInFloor) {
      setSelectedRoomId("");
    }
  }, [listingRoomsForSelectedFloor, selectedRoomId]);

  useEffect(() => {
    setUploadStates((current) => {
      const activeKeys = new Set(files.map(getFileKey));
      const nextEntries = Object.entries(current).filter(([key]) => activeKeys.has(key));
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [files]);

  const onFileValidate = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      return "Only image files are allowed";
    }

    if (file.size > MAX_FILE_SIZE) {
      return "Files must be 10MB or less";
    }

    return null;
  }, []);

  const onFileReject = useCallback((file: File, message: string) => {
    setStatus({
      tone: "error",
      message: `${file.name}: ${message}`,
    });
  }, []);

  const onFilesAccepted = useCallback((acceptedFiles: File[]) => {
    setUploadStates((current) => {
      const next = { ...current };
      for (const file of acceptedFiles) {
        const key = getFileKey(file);
        if (!next[key]) {
          next[key] = {
            status: "idle",
            message: getTrackedUploadMessage("idle"),
          };
        }
      }
      return next;
    });
    setStatus({
      tone: "neutral",
      message:
        acceptedFiles.length === 1
          ? `Queued ${acceptedFiles[0]?.name}`
          : `Queued ${acceptedFiles.length} files`,
    });
  }, []);

  const openCropModal = useCallback((file: File) => {
    setCropTargetFile(file);
    setCropAreaPixels(null);
    setCropZoom(1);
    setCropRotation(0);
    setCropPosition({ x: 0, y: 0 });
    setCropModalOpen(true);
  }, []);

  const closeCropModal = useCallback(() => {
    setCropModalOpen(false);
    setCropTargetFile(null);
    setCropAreaPixels(null);
  }, []);

  const applyCrop = useCallback(async () => {
    if (!cropTargetFile || !cropAreaPixels) {
      setStatus({
        tone: "error",
        message: "Select a crop area before applying",
      });
      return;
    }

    try {
      const croppedFile = await getCroppedFile(cropTargetFile, cropAreaPixels);
      const oldKey = getFileKey(cropTargetFile);
      const newKey = getFileKey(croppedFile);
      setFiles((current) => current.map((item) => (item === cropTargetFile ? croppedFile : item)));
      setUploadStates((current) => {
        const next = { ...current };
        delete next[oldKey];
        next[newKey] = {
          status: "idle",
          message: getTrackedUploadMessage("idle"),
        };
        return next;
      });
      closeCropModal();
      setStatus({
        tone: "success",
        message: `Applied crop to ${croppedFile.name}`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to apply crop",
      });
    }
  }, [closeCropModal, cropAreaPixels, cropTargetFile]);

  const pollUploadStatuses = useCallback(async () => {
    const trackedEntries = Object.entries(uploadStates).filter(
      ([, tracked]) =>
        tracked.imageId &&
        (tracked.status === "uploading" ||
          tracked.status === "queued" ||
          tracked.status === "processing"),
    );

    if (trackedEntries.length === 0) {
      return;
    }

    try {
      const response = await fetch(
        buildImageStatusUrl(
          photoCategory,
          trackedEntries
            .map(([, tracked]) => tracked.imageId)
            .filter((imageId): imageId is string => Boolean(imageId)),
        ),
      );
      const payload = (await response.json()) as {
        images?: UploadApiImageRecord[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to refresh upload status");
      }

      const imageById = new Map(
        (Array.isArray(payload.images) ? payload.images : []).map((image) => [image.id, image]),
      );

      setUploadStates((current) => {
        const next = { ...current };
        for (const [key, tracked] of Object.entries(current)) {
          if (!tracked.imageId) {
            continue;
          }
          const image = imageById.get(tracked.imageId);
          if (!image) {
            continue;
          }
          next[key] = mergeTrackedUploadState(tracked, image);
        }
        return next;
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Failed to refresh upload status",
      });
    }
  }, [photoCategory, uploadStates]);

  useEffect(() => {
    if (!hasTrackedUploadsInFlight(uploadStates)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void pollUploadStatuses();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pollUploadStatuses, uploadStates]);

  const uploadFiles = useCallback(async () => {
    if (files.length === 0) {
      setStatus({
        tone: "error",
        message: "Add files before uploading",
      });
      return;
    }

    const filesToUpload = files.filter((file) => {
      const tracked = uploadStates[getFileKey(file)];
      return !tracked || tracked.status === "idle" || tracked.status === "failed";
    });

    if (filesToUpload.length === 0) {
      setStatus({
        tone: "neutral",
        message: "All queued files are already submitted. Waiting on background processing.",
      });
      return;
    }

    setUploading(true);
    setUploadStates((current) => {
      const next = { ...current };
      for (const file of filesToUpload) {
        next[getFileKey(file)] = {
          ...(next[getFileKey(file)] ?? {
            status: "idle",
            message: getTrackedUploadMessage("idle"),
          }),
          status: "uploading",
          message: getTrackedUploadMessage("uploading"),
          processingError: null,
          photoCategory,
        };
      }
      return next;
    });
    setStatus({
      tone: "neutral",
      message: `Uploading ${filesToUpload.length} file${filesToUpload.length === 1 ? "" : "s"}...`,
    });

    try {
      let successful = 0;
      let failed = 0;
      const total = filesToUpload.length;
      const uploadedImageIds: string[] = [];

      const formData = new FormData();
      for (const file of filesToUpload) {
        formData.append("files", file);
      }
      formData.append("isListingPhoto", String(pageFlags.isListingPage));
      formData.append("photoCategory", photoCategory);
      if (pageFlags.isListingPage && selectedRoomId) {
        formData.append("roomId", selectedRoomId);
      }

      const response = await fetch("/api/images/upload", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as UploadApiResponse;

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error ?? payload.message ?? `Upload failed (${response.status})`,
        );
      }

      const results = payload.results ?? [];
      successful = results.filter((result) => result.success).length;
      failed = results.length > 0 ? results.length - successful : 0;

      setUploadStates((current) => {
        const next = { ...current };
        for (const [index, file] of filesToUpload.entries()) {
          const result = results[index] ?? {
            success: false,
            error: "Missing upload result from server",
          };
          const tracked = createTrackedUploadStateFromResult(result, photoCategory);
          if (tracked.imageId) {
            uploadedImageIds.push(tracked.imageId);
          }
          next[getFileKey(file)] = tracked;
        }
        return next;
      });
      setStatus({
        tone: failed === 0 ? "success" : failed === total ? "error" : "neutral",
        message:
          failed === 0
            ? `Accepted ${total} file${total === 1 ? "" : "s"} for background processing.`
            : `Accepted ${successful}/${total} files. ${failed} failed.`,
      });

      window.dispatchEvent(
        new CustomEvent("global-upload-complete", {
          detail: {
            successful,
            failed,
            total,
            target: "images",
            isListingPhoto: pageFlags.isListingPage,
            photoCategory,
            uploadedImageIds,
          },
        }),
      );
      if (uploadedImageIds.length > 0) {
        void pollUploadStatuses();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setUploadStates((current) => {
        const next = { ...current };
        for (const file of filesToUpload) {
          const key = getFileKey(file);
          next[key] = {
            ...(next[key] ?? {
              status: "idle",
              message: getTrackedUploadMessage("idle"),
            }),
            status: "failed",
            message,
            processingError: message,
            photoCategory,
          };
        }
        return next;
      });
      setStatus({
        tone: "error",
        message,
      });
    } finally {
      setUploading(false);
    }
  }, [files, pageFlags.isListingPage, photoCategory, pollUploadStatuses, selectedRoomId, uploadStates]);

  const statusClassName = useMemo(() => {
    if (!status) return "";
    if (status.tone === "success") return "text-emerald-400";
    if (status.tone === "error") return "text-red-400";
    return "text-muted-foreground";
  }, [status]);

  return (
    <>
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 w-[min(26rem,calc(100vw-2rem))]">
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          {open && (
            <div
              id="global-upload-widget"
              className="w-full rounded-xl bg-card/95 p-4 shadow-2xl ring-1 ring-border/50 backdrop-blur"
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Quick Upload</p>
                  <p className="text-xs text-muted-foreground">
                    Dice UI upload + crop on every page
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setOpen(false)}
                  aria-label="Close upload widget"
                >
                  <XCircle className="size-4" />
                </Button>
              </div>

              {pageFlags.isListingPage && (
                <div className="mb-3 space-y-3 rounded-lg bg-muted/25 p-3 ring-1 ring-border/40">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Building2 className="size-3.5" />
                      Listing Room
                    </p>
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                      Optional
                    </span>
                  </div>

                  <div className="flex items-center justify-between rounded-md bg-background/80 px-3 py-2 ring-1 ring-border/40">
                    <span
                      className={cn(
                        "text-[11px] font-medium",
                        !isUpperFloorSelected ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {lowerFloor?.name ?? "Downstairs"}
                    </span>
                    <Switch
                      checked={isUpperFloorSelected}
                      onCheckedChange={(checked) => {
                        const nextFloor = checked ? upperFloor?.key : lowerFloor?.key;
                        if (nextFloor) {
                          setSelectedFloorKey(nextFloor);
                        }
                      }}
                      aria-label="Toggle listing floor for quick upload"
                      disabled={catalogLoading || !lowerFloor || !upperFloor}
                    />
                    <span
                      className={cn(
                        "text-[11px] font-medium",
                        isUpperFloorSelected ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {upperFloor?.name ?? "Upstairs"}
                    </span>
                  </div>

                  <Select
                    value={selectedRoomId}
                    onValueChange={setSelectedRoomId}
                    disabled={catalogLoading}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={catalogLoading ? "Loading rooms..." : "Select room"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {listingRoomsForSelectedFloor.map((room) => (
                        <SelectItem key={room.id} value={String(room.id)}>
                          {room.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <p className="text-[11px] text-muted-foreground">
                    {selectedListingRoom
                      ? `Uploading to: ${selectedListingRoom.floorName} • ${selectedListingRoom.displayName}`
                      : "No room selected. Photos will be queued for mapping after upload."}
                  </p>
                </div>
              )}

              <FileUpload
                value={files}
                onValueChange={setFiles}
                onAccept={onFilesAccepted}
                onFileReject={onFileReject}
                onFileValidate={onFileValidate}
                maxFiles={MAX_FILES}
                maxSize={MAX_FILE_SIZE}
                accept="image/*"
                multiple
                label="Global image upload"
                disabled={uploading}
              >
                <FileUploadDropzone className="rounded-lg border-border/40 bg-muted/25 px-4 py-6 text-center">
                  <Upload className="mx-auto mb-2 size-6 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop images here</p>
                  <p className="text-xs text-muted-foreground">
                    Any number of files, max 10MB each
                  </p>
                  <div className="mt-3">
                    <FileUploadTrigger asChild>
                      <Button size="sm" variant="secondary">
                        Browse Files
                      </Button>
                    </FileUploadTrigger>
                  </div>
                </FileUploadDropzone>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <FileUploadClear asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={uploading}
                      onClick={() => setUploadStates({})}
                    >
                      Clear
                    </Button>
                  </FileUploadClear>

                  <Button
                    size="sm"
                    onClick={uploadFiles}
                    disabled={uploading || pendingUploadCount === 0}
                    className="gap-2"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="size-4" />
                        Upload
                      </>
                    )}
                  </Button>
                </div>

                {status && (
                  <p className={cn("mt-2 text-xs", statusClassName)}>{status.message}</p>
                )}
                {files.length > 0 ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {pendingUploadCount} ready • {activeProcessingCount} running • {processedCount} processed • {failedCount} failed
                  </p>
                ) : null}

                <FileUploadList className="mt-3 max-h-56 overflow-y-auto pr-1">
                  {files.map((file) => {
                    const key = getFileKey(file);
                    const tracked = uploadStates[key];
                    const canEditFile =
                      !tracked || tracked.status === "idle" || tracked.status === "failed";
                    const rowClassName =
                      tracked?.status === "processed"
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : tracked?.status === "failed"
                          ? "border-destructive/40 bg-destructive/10"
                          : tracked?.status === "processing"
                            ? "border-sky-500/40 bg-sky-500/10"
                            : tracked?.status === "queued"
                              ? "border-amber-500/40 bg-amber-500/10"
                              : tracked?.status === "uploading"
                                ? "border-blue-500/40 bg-blue-500/10"
                                : "border-border/40 bg-muted/20";
                    const messageClassName =
                      tracked?.status === "failed"
                        ? "text-destructive"
                        : tracked?.status === "processed"
                          ? "text-emerald-300"
                          : tracked?.status === "processing"
                            ? "text-sky-300"
                            : tracked?.status === "queued"
                              ? "text-amber-300"
                              : "text-muted-foreground";

                    return (
                      <FileUploadItem
                        key={key}
                        value={file}
                        className={cn(
                          "gap-2 rounded-lg border px-2.5 py-2 transition-colors",
                          rowClassName,
                        )}
                      >
                        <FileUploadItemPreview className="size-10 rounded-md ring-1 ring-border/40" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <FileUploadItemMetadata size="sm" />
                            {tracked ? (
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                                  tracked.status === "processed"
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : tracked.status === "failed"
                                      ? "bg-destructive/15 text-destructive"
                                      : tracked.status === "processing"
                                        ? "bg-sky-500/15 text-sky-300"
                                        : tracked.status === "queued"
                                          ? "bg-amber-500/15 text-amber-300"
                                          : tracked.status === "uploading"
                                            ? "bg-blue-500/15 text-blue-300"
                                            : "bg-muted text-muted-foreground",
                                )}
                              >
                                {getTrackedUploadLabel(tracked.status)}
                              </span>
                            ) : null}
                          </div>
                          {tracked ? (
                            <p className={cn("mt-1 text-[11px]", messageClassName)}>
                              {tracked.message}
                            </p>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-1 h-auto px-2 py-1 text-xs"
                            onClick={() => openCropModal(file)}
                            type="button"
                            disabled={!canEditFile}
                          >
                            <Crop className="mr-1 size-3.5" />
                            Crop
                          </Button>
                        </div>
                        <FileUploadItemDelete asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`}>
                            <XCircle className="size-4" />
                          </Button>
                        </FileUploadItemDelete>
                      </FileUploadItem>
                    );
                  })}
                </FileUploadList>
              </FileUpload>
            </div>
          )}

          <Button
            onClick={() => setOpen((value) => !value)}
            className="gap-2 shadow-lg"
            aria-expanded={open}
            aria-controls="global-upload-widget"
          >
            <Upload className="size-4" />
            {open ? "Hide Upload" : "Quick Upload"}
          </Button>
        </div>
      </div>

      <Dialog open={cropModalOpen} onOpenChange={(open) => (open ? setCropModalOpen(true) : closeCropModal())}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Crop Before Upload</DialogTitle>
          </DialogHeader>

          {cropTargetPreview && (
            <div className="space-y-4">
              <div className="relative h-[20rem] overflow-hidden rounded-xl bg-muted/30 ring-1 ring-border/40">
                <Cropper
                  crop={cropPosition}
                  zoom={cropZoom}
                  rotation={cropRotation}
                  aspectRatio={4 / 3}
                  withGrid
                  onCropChange={setCropPosition}
                  onZoomChange={setCropZoom}
                  onRotationChange={setCropRotation}
                  onCropAreaChange={(_, areaPixels) => setCropAreaPixels(areaPixels)}
                >
                  <CropperImage src={cropTargetPreview} alt="Crop target" />
                  <CropperArea />
                </Cropper>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="text-muted-foreground">Zoom ({cropZoom.toFixed(2)}x)</span>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    step={0.05}
                    value={cropZoom}
                    onChange={(event) => setCropZoom(Number(event.target.value))}
                    className="w-full"
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span className="text-muted-foreground">Rotation ({Math.round(cropRotation)}°)</span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={cropRotation}
                    onChange={(event) => setCropRotation(Number(event.target.value))}
                    className="w-full"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeCropModal}>
                  Cancel
                </Button>
                <Button onClick={applyCrop}>
                  <Crop className="mr-2 size-4" />
                  Apply Crop
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
