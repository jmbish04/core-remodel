import {
  CircleAlert,
  Check,
  CheckCircle2,
  Copy,
  Crop,
  FileImage,
  Home,
  RefreshCw,
  RotateCw,
  Tag,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Cropper, CropperArea, CropperImage, type CropperAreaData } from "@/components/ui/cropper";
import { cn } from "@/lib/utils";

interface ImageRecord {
  id: string;
  path: string;
  filename: string;
  room: string;
  tags: string | string[];
  note: string;
  sourceFile?: string;
  imageNumber?: string;
  igAccount?: string;
  visibleCaption?: string;
  width?: number;
  height?: number;
}

interface ImageGroup {
  room: string;
  images: ImageRecord[];
}

interface CropState {
  crop: { x: number; y: number };
  zoom: number;
  rotation: number;
  areaPixels: CropperAreaData | null;
}

type QueueUploadStatus = "idle" | "uploading" | "success" | "error";

interface QueueUploadOutcome {
  status: QueueUploadStatus;
  message?: string;
  failurePrompt?: string;
  copiedToClipboard?: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_UPLOAD_FILES = 20;

const fileKey = (file: File) =>
  `${file.name}-${file.size}-${file.type}-${file.lastModified}`;

const toPrompt = (params: {
  file: File;
  statusCode?: number;
  statusText?: string;
  errorMessage: string;
  rawResponse?: string;
}) =>
  [
    "Please help debug this photo upload failure in core-remodel.",
    `File: ${params.file.name}`,
    `Size: ${params.file.size} bytes`,
    `Type: ${params.file.type || "unknown"}`,
    `HTTP status: ${params.statusCode ?? "unknown"} ${params.statusText ?? ""}`.trim(),
    `Error message: ${params.errorMessage}`,
    "Raw server response:",
    params.rawResponse?.trim() || "(empty response)",
  ].join("\n");

const createImageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

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

const getCroppedFile = async (
  file: File,
  areaPixels: CropperAreaData,
): Promise<File> => {
  const image = await createImageFromFile(file);
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
};

export function PhotoReviewApp() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [groups, setGroups] = useState<ImageGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [croppedFiles, setCroppedFiles] = useState<Set<string>>(new Set());
  const [queueUploadOutcomes, setQueueUploadOutcomes] = useState<
    Record<string, QueueUploadOutcome>
  >({});

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropTargetFile, setCropTargetFile] = useState<File | null>(null);
  const [cropState, setCropState] = useState<CropState>({
    crop: { x: 0, y: 0 },
    zoom: 1,
    rotation: 0,
    areaPixels: null,
  });

  const [zoomModalOpen, setZoomModalOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<ImageRecord | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  const [panelRoom, setPanelRoom] = useState("");
  const [panelTags, setPanelTags] = useState("");
  const [panelNote, setPanelNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);

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

  const fetchImages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/photo-reviews");
      const data = (await res.json()) as {
        images?: ImageRecord[];
        groups?: ImageGroup[];
      };

      if (data.images && data.groups) {
        setImages(data.images);
        setGroups(data.groups);
      }
    } catch (error) {
      toast.error("Failed to load images");
    } finally {
      setLoading(false);
    }
  }, []);

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
        void fetchImages();
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

  useEffect(() => {
    setCroppedFiles((prev) => {
      if (queuedFiles.length === 0 || prev.size === 0) {
        return queuedFiles.length === 0 ? new Set() : prev;
      }

      const activeKeys = new Set(queuedFiles.map(fileKey));
      let changed = false;
      const next = new Set<string>();

      for (const key of prev) {
        if (activeKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [queuedFiles]);

  useEffect(() => {
    setQueueUploadOutcomes((prev) => {
      if (queuedFiles.length === 0) {
        if (Object.keys(prev).length === 0) return prev;
        return {};
      }

      let changed = false;
      const next: Record<string, QueueUploadOutcome> = {};
      for (const file of queuedFiles) {
        const key = fileKey(file);
        if (prev[key]) {
          next[key] = prev[key];
        } else {
          next[key] = { status: "idle" };
          changed = true;
        }
      }

      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [queuedFiles]);

  const pendingUploadCount = useMemo(
    () =>
      queuedFiles.filter(
        (file) => queueUploadOutcomes[fileKey(file)]?.status !== "success",
      ).length,
    [queuedFiles, queueUploadOutcomes],
  );

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

  const onFileValidate = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      return "Only image files are supported";
    }

    if (file.size > MAX_FILE_SIZE) {
      return "Each file must be 10MB or less";
    }

    return null;
  }, []);

  const onFileReject = useCallback((file: File, message: string) => {
    toast.error(`${file.name}: ${message}`);
  }, []);

  const onFilesAccepted = useCallback((files: File[]) => {
    setQueueUploadOutcomes((prev) => {
      const next = { ...prev };
      for (const file of files) {
        const key = fileKey(file);
        if (!next[key]) {
          next[key] = { status: "idle" };
        }
      }
      return next;
    });
    toast.success(
      files.length === 1
        ? `Added ${files[0]?.name}`
        : `Added ${files.length} files to queue`,
    );
  }, []);

  const openCropModal = useCallback((file: File) => {
    setCropTargetFile(file);
    setCropState({
      crop: { x: 0, y: 0 },
      zoom: 1,
      rotation: 0,
      areaPixels: null,
    });
    setCropModalOpen(true);
  }, []);

  const closeCropModal = useCallback(() => {
    setCropModalOpen(false);
    setCropTargetFile(null);
  }, []);

  const saveCroppedImage = useCallback(async () => {
    if (!cropTargetFile || !cropState.areaPixels) {
      toast.error("Select a crop area before applying");
      return;
    }

    try {
      const croppedFile = await getCroppedFile(cropTargetFile, cropState.areaPixels);
      const oldKey = fileKey(cropTargetFile);
      const newKey = fileKey(croppedFile);

      setQueuedFiles((prev) =>
        prev.map((item) => (item === cropTargetFile ? croppedFile : item)),
      );

      setCroppedFiles((prev) => {
        const next = new Set(prev);
        next.delete(oldKey);
        next.add(newKey);
        return next;
      });

      toast.success(`Cropped ${croppedFile.name}`);
      closeCropModal();
    } catch (error) {
      toast.error("Failed to apply crop");
    }
  }, [closeCropModal, cropState.areaPixels, cropTargetFile]);

  const uploadQueuedFiles = useCallback(async () => {
    if (queuedFiles.length === 0) {
      toast.error("No files in queue");
      return;
    }

    const filesToUpload = queuedFiles.filter(
      (file) => queueUploadOutcomes[fileKey(file)]?.status !== "success",
    );
    if (filesToUpload.length === 0) {
      toast.success("All queued photos are already uploaded");
      return;
    }

    setUploading(true);
    setUploadProgress({ current: 0, total: filesToUpload.length });

    let successCount = 0;
    let lastUploadedImage: ImageRecord | null = null;

    for (let index = 0; index < filesToUpload.length; index++) {
      const file = filesToUpload[index];
      const key = fileKey(file);
      const formData = new FormData();
      formData.append("file", file);

      setQueueUploadOutcomes((prev) => ({
        ...prev,
        [key]: {
          status: "uploading",
          message: "Uploading...",
          failurePrompt: undefined,
          copiedToClipboard: false,
        },
      }));

      try {
        const response = await fetch("/api/photo-reviews/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const rawResponse = await response.text();
          let errorMessage = `Upload failed (${response.status})`;
          if (rawResponse.trim().length > 0) {
            try {
              const errorData = JSON.parse(rawResponse) as { error?: string; message?: string };
              errorMessage =
                errorData.error?.trim() ||
                errorData.message?.trim() ||
                rawResponse.trim();
            } catch {
              errorMessage = rawResponse.trim();
            }
          }

          const failurePrompt = toPrompt({
            file,
            statusCode: response.status,
            statusText: response.statusText,
            errorMessage,
            rawResponse,
          });

          setQueueUploadOutcomes((prev) => ({
            ...prev,
            [key]: {
              status: "error",
              message: errorMessage,
              failurePrompt,
              copiedToClipboard: false,
            },
          }));

          toast.error(`Failed ${file.name}: ${errorMessage}`);
          setUploadProgress({ current: index + 1, total: filesToUpload.length });
          if (index < filesToUpload.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
          continue;
        }

        const payload = (await response.json()) as {
          success?: boolean;
          image?: ImageRecord;
          error?: string;
        };

        if (payload.success) {
          successCount += 1;
          if (payload.image) {
            lastUploadedImage = payload.image;
          }
          setQueueUploadOutcomes((prev) => ({
            ...prev,
            [key]: {
              status: "success",
              message: "Uploaded and processed successfully",
              failurePrompt: undefined,
              copiedToClipboard: false,
            },
          }));
        } else {
          const errorMessage = payload.error?.trim() || "Unknown error";
          const rawResponse = JSON.stringify(payload, null, 2);
          const failurePrompt = toPrompt({
            file,
            errorMessage,
            rawResponse,
          });
          setQueueUploadOutcomes((prev) => ({
            ...prev,
            [key]: {
              status: "error",
              message: errorMessage,
              failurePrompt,
              copiedToClipboard: false,
            },
          }));
          toast.error(`Failed ${file.name}: ${errorMessage}`);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected upload error";
        const failurePrompt = toPrompt({
          file,
          errorMessage: message,
        });
        setQueueUploadOutcomes((prev) => ({
          ...prev,
          [key]: {
            status: "error",
            message,
            failurePrompt,
            copiedToClipboard: false,
          },
        }));
        toast.error(`Failed ${file.name}: ${message}`);
      }

      setUploadProgress({ current: index + 1, total: filesToUpload.length });

      if (index < filesToUpload.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }

    setUploading(false);
    setUploadProgress(null);

    if (successCount > 0) {
      await fetchImages();

      if (lastUploadedImage) {
        setSelectedImage(lastUploadedImage);
      }
    }

    if (successCount === filesToUpload.length) {
      toast.success(`Uploaded all ${successCount} files`);
    } else {
      toast.warning(`Uploaded ${successCount} of ${filesToUpload.length} files`);
    }
  }, [fetchImages, queuedFiles, queueUploadOutcomes]);

  const copyFailurePrompt = useCallback(
    async (key: string) => {
      const prompt = queueUploadOutcomes[key]?.failurePrompt;
      if (!prompt) return;
      try {
        await navigator.clipboard.writeText(prompt);
        setQueueUploadOutcomes((prev) => ({
          ...prev,
          [key]: {
            ...prev[key],
            copiedToClipboard: true,
          },
        }));
      } catch {
        toast.error("Failed to copy prompt to clipboard");
      }
    },
    [queueUploadOutcomes],
  );

  const queueOutcomeAlerts = useMemo(
    () =>
      queuedFiles
        .map((file) => {
          const key = fileKey(file);
          return {
            file,
            key,
            outcome: queueUploadOutcomes[key],
          };
        })
        .filter(
          (entry) =>
            entry.outcome?.status === "success" ||
            entry.outcome?.status === "error",
        ),
    [queuedFiles, queueUploadOutcomes],
  );

  const saveSelectedImage = useCallback(async () => {
    if (!selectedImage) return;

    setIsSaving(true);

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
        }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        image?: ImageRecord;
      };

      if (payload.success) {
        await fetchImages();
        if (payload.image) {
          setSelectedImage(payload.image);
        }
        toast.success("Saved changes");
      } else {
        toast.error("Failed to save changes");
      }
    } catch (error) {
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  }, [fetchImages, panelNote, panelRoom, panelTags, selectedImage]);

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

        await fetchImages();
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

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-background text-foreground">
      <div
        className={cn(
          "flex flex-1 flex-col overflow-hidden transition-all",
          selectedImage && "mr-[22rem]",
        )}
      >
        <header className="flex items-center justify-between border-b border-border/40 bg-card/60 px-6 py-4 backdrop-blur">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Photo Reviews</h1>
            <p className="text-sm text-muted-foreground">
              {images.length} photos across {groups.length} rooms
              {queuedFiles.length > 0 ? ` • ${queuedFiles.length} queued` : ""}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchImages}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          <Card className="gap-4 ring-1 ring-border/40">
            <CardHeader className="pb-0">
              <CardTitle className="text-lg">Upload Queue</CardTitle>
              <CardDescription>
                Drag and drop multiple photos, crop any image before upload, then batch submit.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FileUpload
                value={queuedFiles}
                onValueChange={setQueuedFiles}
                onAccept={onFilesAccepted}
                onFileReject={onFileReject}
                onFileValidate={onFileValidate}
                maxFiles={MAX_UPLOAD_FILES}
                maxSize={MAX_FILE_SIZE}
                accept="image/*"
                multiple
                label="Photo upload queue"
                disabled={uploading}
              >
                <FileUploadDropzone className="gap-3 rounded-xl border-border/40 bg-muted/20 p-8 text-center">
                  <Upload className="size-8 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Drop images here</p>
                    <p className="text-xs text-muted-foreground">
                      Up to {MAX_UPLOAD_FILES} files, each max 10MB
                    </p>
                  </div>
                  <FileUploadTrigger asChild>
                    <Button size="sm" variant="secondary">
                      Browse Files
                    </Button>
                  </FileUploadTrigger>
                </FileUploadDropzone>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <FileUploadClear asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={uploading}
                      onClick={() => {
                        setQueueUploadOutcomes({});
                        setCroppedFiles(new Set());
                      }}
                    >
                      Clear Queue
                    </Button>
                  </FileUploadClear>

                  <Button
                    size="sm"
                    onClick={uploadQueuedFiles}
                    disabled={uploading || pendingUploadCount === 0}
                    className="gap-2"
                  >
                    {uploading ? (
                      <>
                        <RefreshCw className="size-4 animate-spin" />
                        Uploading {uploadProgress?.current}/{uploadProgress?.total}
                      </>
                    ) : (
                      <>
                        <Check className="size-4" />
                        Upload Queued Files
                      </>
                    )}
                  </Button>
                </div>

                <FileUploadList className="max-h-72 overflow-y-auto pr-1">
                  {queuedFiles.map((file) => {
                    const key = fileKey(file);
                    const isCropped = croppedFiles.has(key);
                    const outcome = queueUploadOutcomes[key];
                    const rowClass =
                      outcome?.status === "success"
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : outcome?.status === "error"
                          ? "border-destructive/60 bg-destructive/10"
                          : outcome?.status === "uploading"
                            ? "border-blue-500/50 bg-blue-500/10"
                            : "border-border/40 bg-card/60";

                    return (
                      <FileUploadItem
                        key={key}
                        value={file}
                        className={cn("gap-3 rounded-lg px-3 py-2 transition-colors", rowClass)}
                      >
                        <FileUploadItemPreview className="size-12 rounded-md ring-1 ring-border/40" />
                        <FileUploadItemMetadata size="sm" />

                        {outcome?.status === "success" && (
                          <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-[11px] font-medium text-emerald-300">
                            Uploaded
                          </span>
                        )}

                        {outcome?.status === "error" && (
                          <span className="rounded-full bg-destructive/20 px-2 py-1 text-[11px] font-medium text-destructive">
                            Failed
                          </span>
                        )}

                        {outcome?.status === "uploading" && (
                          <span className="rounded-full bg-blue-500/20 px-2 py-1 text-[11px] font-medium text-blue-300">
                            Processing
                          </span>
                        )}

                        {isCropped && (
                          <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-[11px] font-medium text-emerald-300">
                            Cropped
                          </span>
                        )}

                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openCropModal(file)}
                          title="Crop image"
                        >
                          <Crop className="size-4" />
                          <span className="sr-only">Crop {file.name}</span>
                        </Button>

                        <FileUploadItemDelete asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="Remove file"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="size-4" />
                            <span className="sr-only">Remove {file.name}</span>
                          </Button>
                        </FileUploadItemDelete>
                      </FileUploadItem>
                    );
                  })}
                </FileUploadList>

                {queueOutcomeAlerts.length > 0 && (
                  <div className="space-y-2">
                    {queueOutcomeAlerts.map(({ file, key, outcome }) => {
                      if (!outcome) return null;
                      if (outcome.status === "success") {
                        return (
                          <Alert key={`${key}-success`} variant="success">
                            <CheckCircle2 />
                            <AlertTitle>{file.name}</AlertTitle>
                            <AlertDescription>
                              {outcome.message || "Uploaded and processed successfully."}
                            </AlertDescription>
                          </Alert>
                        );
                      }

                      return (
                        <Alert key={`${key}-error`} variant="destructive">
                          <CircleAlert />
                          <AlertTitle>{file.name}</AlertTitle>
                          <AlertDescription className="space-y-2">
                            <p>{outcome.message || "Upload failed."}</p>
                            {outcome.failurePrompt && (
                              <>
                                <pre className="max-h-40 overflow-auto rounded-md border border-destructive/40 bg-background/60 p-2 text-xs whitespace-pre-wrap">
                                  {outcome.failurePrompt}
                                </pre>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => copyFailurePrompt(key)}
                                  >
                                    <Copy className="mr-2 size-4" />
                                    Copy Failure Prompt
                                  </Button>
                                  {outcome.copiedToClipboard && (
                                    <span className="text-xs text-emerald-300">
                                      Copied to clipboard.
                                    </span>
                                  )}
                                </div>
                              </>
                            )}
                          </AlertDescription>
                        </Alert>
                      );
                    })}
                  </div>
                )}
              </FileUpload>
            </CardContent>
          </Card>

          {loading && images.length === 0 ? (
            <div className="flex items-center justify-center rounded-xl bg-card/30 py-20 text-muted-foreground ring-1 ring-border/40">
              <RefreshCw className="mr-3 size-6 animate-spin" />
              Loading gallery...
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl bg-card/30 px-6 py-16 text-center ring-1 ring-border/40">
              <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted/50">
                <FileImage className="size-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-medium">No photos yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Upload your first batch above. Workers AI will classify rooms and generate tags.
              </p>
            </div>
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

                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {group.images.map((image) => {
                      const tags = getTags(image.tags);
                      const isSelected = selectedImage?.id === image.id;

                      return (
                        <ContextMenu key={image.id}>
                          <ContextMenuTrigger>
                            <button
                              type="button"
                              onClick={() => setSelectedImage(image)}
                              className={cn(
                                "group relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted/30 ring-1 ring-border/40 transition-all",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                "hover:-translate-y-0.5 hover:shadow-lg",
                                isSelected && "ring-2 ring-ring",
                              )}
                            >
                              <img
                                src={image.path.startsWith("http") ? image.path : `/images/${image.path}`}
                                alt={image.filename}
                                loading="lazy"
                                className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                              />

                              <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />

                              <div className="absolute bottom-2 left-2 right-2 z-10 flex flex-wrap gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                {tags.slice(0, 3).map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white"
                                  >
                                    {tag}
                                  </span>
                                ))}
                                {tags.length > 3 && (
                                  <span className="rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white">
                                    +{tags.length - 3}
                                  </span>
                                )}
                              </div>

                              <span className="sr-only">Open {image.filename}</span>
                            </button>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => setSelectedImage(image)}>
                              Update Metadata
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
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      <aside
        className={cn(
          "fixed right-0 top-16 bottom-0 z-20 w-[22rem] translate-x-full border-l border-border/40 bg-card/80 shadow-2xl backdrop-blur transition-transform",
          selectedImage && "translate-x-0",
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
            <h2 className="truncate pr-4 text-sm font-semibold">
              {selectedImage?.filename ?? "Details"}
            </h2>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelectedImage(null)}
              title="Close details"
            >
              <X className="size-4" />
            </Button>
          </div>

          {selectedImage && (
            <>
              <div className="flex items-center justify-center border-b border-border/40 bg-muted/20 p-4">
                <img
                  src={selectedImage.path.startsWith("http") ? selectedImage.path : `/images/${selectedImage.path}`}
                  alt={selectedImage.filename}
                  className="max-h-56 w-full rounded-lg object-contain ring-1 ring-border/40"
                />
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <div className="space-y-1.5">
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

                <div className="space-y-1.5">
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

                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1"
                    variant="outline"
                    onClick={() => openZoomModal(selectedImage)}
                  >
                    <ZoomIn className="mr-2 size-4" />
                    Zoom
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={saveSelectedImage}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw className="mr-2 size-4 animate-spin" />
                        Saving
                      </>
                    ) : (
                      <>
                        <Check className="mr-2 size-4" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>

      <Dialog open={cropModalOpen} onOpenChange={(open) => (open ? setCropModalOpen(true) : closeCropModal())}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Crop {cropTargetFile?.name ?? "image"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="relative h-[22rem] overflow-hidden rounded-xl bg-muted/30 ring-1 ring-border/40">
              {cropTargetPreview && (
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
                  <CropperImage src={cropTargetPreview} alt="Crop target" />
                  <CropperArea />
                </Cropper>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Zoom ({cropState.zoom.toFixed(2)}x)</span>
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
                <span className="text-muted-foreground">Rotation ({Math.round(cropState.rotation)}°)</span>
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
              <Button variant="outline" onClick={closeCropModal}>
                Cancel
              </Button>
              <Button onClick={saveCroppedImage}>
                <Crop className="mr-2 size-4" />
                Apply Crop
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={zoomModalOpen} onOpenChange={setZoomModalOpen}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>{zoomedImage?.filename}</DialogTitle>
          </DialogHeader>

          <div className="relative max-h-[70vh] overflow-auto rounded-xl bg-muted/30 ring-1 ring-border/40">
            {zoomedImage && (
              <div className="flex min-h-[24rem] items-center justify-center p-4">
                <img
                  src={zoomedImage.path.startsWith("http") ? zoomedImage.path : `/images/${zoomedImage.path}`}
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
              <RotateCw className="size-4" />
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
