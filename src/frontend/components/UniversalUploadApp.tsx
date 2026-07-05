import { Check, ChevronDown, ChevronUp, Crop, FileText, Link2, Loader2, Upload, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UploadsMappingPanel } from "@/components/UploadsMappingPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Cropper, CropperArea, CropperImage, type CropperAreaData } from "@/components/ui/cropper";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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

type UploadTarget = "inspirational" | "listing";

interface CropState {
  crop: { x: number; y: number };
  zoom: number;
  rotation: number;
  areaPixels: CropperAreaData | null;
}

interface MappingSummary {
  listing: number;
  inspirational: number;
  total: number;
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

export function UniversalUploadApp() {
  const [target, setTarget] = useState<UploadTarget>("inspirational");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStates, setUploadStates] = useState<Record<string, TrackedUploadState>>({});
  const [status, setStatus] = useState<string>("");
  const [mappingSummary, setMappingSummary] = useState<MappingSummary>({
    listing: 0,
    inspirational: 0,
    total: 0,
  });
  const [mappingRefreshToken, setMappingRefreshToken] = useState(0);

  // ─── Bulk URL import state ──────────────────────────────────────────────
  const [urlText, setUrlText] = useState("");
  const [urlImporting, setUrlImporting] = useState(false);
  const [urlPanelOpen, setUrlPanelOpen] = useState(false);
  const [urlImportStatus, setUrlImportStatus] = useState("");

  const parsedUrls = useMemo(() => {
    return urlText
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter((s) => {
        try {
          const u = new URL(s);
          return u.protocol === "https:" || u.protocol === "http:";
        } catch {
          return false;
        }
      });
  }, [urlText]);

  const importUrls = useCallback(async () => {
    if (parsedUrls.length === 0) {
      setUrlImportStatus("No valid URLs found. Paste image URLs separated by newlines or commas.");
      return;
    }
    setUrlImporting(true);
    setUrlImportStatus(`Importing ${parsedUrls.length} URL${parsedUrls.length === 1 ? "" : "s"}… The worker is fetching each image.`);
    try {
      const res = await fetch("/api/images/upload-urls", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: parsedUrls, photoCategory: target }),
      });
      let payload: any;
      try {
        payload = await res.json();
      } catch {
        throw new Error(`Server returned non-JSON (${res.status})`);
      }
      if (!res.ok || !payload.success) {
        throw new Error(payload.error ?? "URL import failed");
      }
      const results = payload.results ?? [];
      const ok = results.filter((r: any) => r.success).length;
      const fail = results.length - ok;
      setUrlImportStatus(
        fail === 0
          ? `✓ ${ok} image${ok === 1 ? "" : "s"} imported and queued for processing.`
          : `Imported ${ok}/${results.length}. ${fail} failed.`,
      );
      if (ok > 0) {
        setUrlText("");
        setMappingRefreshToken((t) => t + 1);
        window.dispatchEvent(
          new CustomEvent("global-upload-complete", {
            detail: { target: "images", successful: ok, failed: fail, total: results.length },
          }),
        );
        window.dispatchEvent(
          new CustomEvent("image-mapping-summary-updated", {
            detail: { source: "url-import" },
          }),
        );
      }
    } catch (e) {
      setUrlImportStatus(e instanceof Error ? e.message : "URL import failed");
    } finally {
      setUrlImporting(false);
    }
  }, [parsedUrls, target]);

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropTargetFile, setCropTargetFile] = useState<File | null>(null);
  const [cropState, setCropState] = useState<CropState>({
    crop: { x: 0, y: 0 },
    zoom: 1,
    rotation: 0,
    areaPixels: null,
  });

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

  const pendingUploadCount = useMemo(
    () =>
      files.filter((file) => {
        const tracked = uploadStates[getFileKey(file)];
        return !tracked || tracked.status === "idle" || tracked.status === "failed";
      }).length,
    [files, uploadStates],
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

  const openCropModal = (file: File) => {
    setCropTargetFile(file);
    setCropState({
      crop: { x: 0, y: 0 },
      zoom: 1,
      rotation: 0,
      areaPixels: null,
    });
    setCropModalOpen(true);
  };

  const closeCropModal = () => {
    setCropModalOpen(false);
    setCropTargetFile(null);
  };

  const applyCrop = async () => {
    if (!cropTargetFile || !cropState.areaPixels) {
      setStatus("Select a crop area before applying");
      return;
    }

    try {
      const croppedFile = await getCroppedFile(cropTargetFile, cropState.areaPixels);
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
      setStatus(`Applied crop to ${croppedFile.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to apply crop");
    }
  };

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimeoutId: number | null = null;
    let isDisposed = false;

    const connect = () => {
      if (isDisposed) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/images/realtime`;
      
      console.log("Connecting to uploads realtime WS:", wsUrl);
      const ws = new WebSocket(wsUrl);
      socket = ws;

      ws.onopen = () => {
        console.log("WebSocket connected to uploads realtime");
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "realtime_event" && message.payload) {
            const payload = message.payload;
            if (payload.imageId) {
              setUploadStates((current) => {
                const next = { ...current };
                for (const [key, tracked] of Object.entries(next)) {
                  if (tracked.imageId === payload.imageId) {
                    next[key] = {
                      ...tracked,
                      status: payload.status,
                      progress: payload.progress,
                      stepName: payload.stepName,
                      message: payload.error || payload.stepName || getTrackedUploadMessage(payload.status),
                      processingError: payload.error || null,
                    };
                    break;
                  }
                }
                return next;
              });

              // Dispatch custom DOM event for other components (like UploadsMappingPanel)
              window.dispatchEvent(
                new CustomEvent("image-workflow-progress", {
                  detail: payload,
                }),
              );
            }
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message", error);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error on uploads realtime", error);
      };

      ws.onclose = (event) => {
        console.log("WebSocket disconnected from uploads realtime:", event.reason);
        if (!isDisposed) {
          reconnectTimeoutId = window.setTimeout(() => {
            connect();
          }, 3000);
        }
      };
    };

    connect();

    return () => {
      isDisposed = true;
      if (socket) {
        socket.close();
      }
      if (reconnectTimeoutId) {
        window.clearTimeout(reconnectTimeoutId);
      }
    };
  }, []);

  const uploadFiles = async () => {
    if (files.length === 0) {
      setStatus("Add files before uploading");
      return;
    }

    const filesToUpload = files.filter((file) => {
      const tracked = uploadStates[getFileKey(file)];
      return !tracked || tracked.status === "idle" || tracked.status === "failed";
    });

    if (filesToUpload.length === 0) {
      setStatus("All queued files are already submitted. Waiting on background processing.");
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
          photoCategory: target,
        };
      }
      return next;
    });
    setStatus(`Uploading ${filesToUpload.length} file${filesToUpload.length === 1 ? "" : "s"}...`);

    try {
      const formData = new FormData();
      for (const file of filesToUpload) {
        formData.append("files", file);
      }

      formData.append("isListingPhoto", String(target === "listing"));
      formData.append("photoCategory", target);

      const response = await fetch("/api/images/upload", {
        method: "POST",
        body: formData,
      });
      let payload: UploadApiResponse;
      try {
        const text = await response.text();
        try {
          payload = JSON.parse(text) as UploadApiResponse;
        } catch (e) {
          throw new Error(`Server returned non-JSON response (${response.status}): ${text.slice(0, 150)}`);
        }
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e));
      }

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Upload failed");
      }

      const results = payload.results || [];
      const successful = results.filter((result) => result.success).length;
      const failed = results.length - successful;
      const uploadedImageIds: string[] = [];
      setUploadStates((current) => {
        const next = { ...current };
        for (const [index, file] of filesToUpload.entries()) {
          const result = results[index] ?? {
            success: false,
            error: "Missing upload result from server",
          };
          const tracked = createTrackedUploadStateFromResult(result, target);
          if (tracked.imageId) {
            uploadedImageIds.push(tracked.imageId);
          }
          next[getFileKey(file)] = tracked;
        }
        return next;
      });
      setStatus(
        failed === 0
          ? `Accepted ${successful} file${successful === 1 ? "" : "s"} for background processing.`
          : `Accepted ${successful}/${results.length} files. ${failed} failed.`,
      );

      setMappingRefreshToken((token) => token + 1);
      window.dispatchEvent(
        new CustomEvent("global-upload-complete", {
          detail: {
            target: "images",
            successful,
            failed,
            total: results.length,
            isListingPhoto: target === "listing",
            photoCategory: target,
            uploadedImageIds,
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("image-mapping-summary-updated", {
          detail: { source: "universal-upload" },
        }),
      );
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
            photoCategory: target,
          };
        }
        return next;
      });
      setStatus(message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Universal Upload</CardTitle>
              <CardDescription>
                Choose photo type, upload in bulk, then map rooms in the staging queue.
              </CardDescription>
            </div>
            <Badge variant={mappingSummary.total > 0 ? "destructive" : "secondary"}>
              {mappingSummary.total} need mapping
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              className={cn(
                "rounded-xl border p-4 text-left transition",
                target === "inspirational"
                  ? "border-primary bg-primary/10"
                  : "border-border/60 hover:bg-muted/30",
              )}
              onClick={() => setTarget("inspirational")}
            >
              <p className="text-sm font-semibold">Inspiration / Review</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Reference and inspiration photos. Multi-room mapping is done after upload.
              </p>
            </button>

            <button
              type="button"
              className={cn(
                "rounded-xl border p-4 text-left transition",
                target === "listing"
                  ? "border-primary bg-primary/10"
                  : "border-border/60 hover:bg-muted/30",
              )}
              onClick={() => setTarget("listing")}
            >
              <p className="text-sm font-semibold">Listing Photos</p>
              <p className="mt-1 text-xs text-muted-foreground">
                As-is baseline photos. Room mapping is done after upload.
              </p>
            </button>
          </div>

          <FileUpload
            value={files}
            onValueChange={setFiles}
            onAccept={(acceptedFiles) => {
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
            }}
            onFileValidate={(file) => {
              if (!file.type.startsWith("image/")) {
                return "Only image files are allowed";
              }
              if (file.size > MAX_FILE_SIZE) {
                return "Each file must be 10MB or less";
              }
              return null;
            }}
            maxFiles={MAX_FILES}
            maxSize={MAX_FILE_SIZE}
            accept="image/*"
            multiple
            disabled={uploading}
          >
            <FileUploadDropzone className="gap-3 rounded-xl border-border/40 bg-muted/20 p-8 text-center">
              <Upload className="size-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Drop images here</p>
                <p className="text-xs text-muted-foreground">
                  Any number of files, max 10MB each
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
                  onClick={() => setUploadStates({})}
                >
                  Clear Queue
                </Button>
              </FileUploadClear>

              <Button
                size="sm"
                onClick={uploadFiles}
                disabled={uploading || pendingUploadCount === 0}
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Uploading
                  </>
                ) : (
                  <>
                    <Check className="mr-2 size-4" />
                    Upload Files
                  </>
                )}
              </Button>
            </div>
            {files.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {pendingUploadCount} ready • {activeProcessingCount} running • {processedCount} processed • {failedCount} failed
              </p>
            ) : null}

            <FileUploadList className="max-h-72 overflow-y-auto pr-1">
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
                            : "border-border/40 bg-card/60";
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
                      "gap-3 rounded-lg border px-3 py-2 transition-colors",
                      rowClassName,
                    )}
                  >
                    <FileUploadItemPreview className="size-12 rounded-md ring-1 ring-border/40" />
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
                      {tracked &&
                        (tracked.status === "uploading" ||
                          tracked.status === "queued" ||
                          tracked.status === "processing") && (
                          <div className="mt-2 w-full">
                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-500 ease-out",
                                  tracked.status === "uploading"
                                    ? "bg-blue-500"
                                    : tracked.status === "queued"
                                      ? "bg-amber-500"
                                      : "bg-sky-500 animate-pulse",
                                )}
                                style={{ width: `${tracked.progress ?? 10}%` }}
                              />
                            </div>
                          </div>
                        )}
                    </div>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openCropModal(file)}
                      title="Crop image"
                      disabled={!canEditFile}
                    >
                      <Crop className="size-4" />
                      <span className="sr-only">Crop {file.name}</span>
                    </Button>

                    <FileUploadItemDelete asChild>
                      <Button variant="ghost" size="icon-sm" title="Remove file">
                        <X className="size-4" />
                      </Button>
                    </FileUploadItemDelete>
                  </FileUploadItem>
                );
              })}
            </FileUploadList>
          </FileUpload>

          {status && <p className="text-sm text-muted-foreground">{status}</p>}
        </CardContent>
      </Card>

      {/* ─── Bulk URL Import Card ──────────────────────────────────────────── */}
      <Card className="ring-1 ring-border/40">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-6 py-4 text-left"
          onClick={() => setUrlPanelOpen(!urlPanelOpen)}
        >
          <Link2 className="size-4 text-muted-foreground" />
          <span className="flex-1 text-sm font-semibold">Import from URLs</span>
          {parsedUrls.length > 0 && (
            <Badge variant="secondary" className="mr-1">
              {parsedUrls.length} URL{parsedUrls.length === 1 ? "" : "s"}
            </Badge>
          )}
          {urlPanelOpen ? (
            <ChevronUp className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </button>
        {urlPanelOpen && (
          <CardContent className="space-y-3 pt-0">
            <p className="text-xs text-muted-foreground">
              Paste image URLs below — one per line, or comma/semicolon separated.
              Right-click any image on the web → "Copy image address" → paste here.
              The worker will fetch, upload to Cloudflare Images, and queue AI processing.
            </p>
            <Textarea
              placeholder={"https://example.com/photo1.jpg\nhttps://example.com/photo2.png\nhttps://cdn.site.com/inspiration/tile-closeup.webp"}
              value={urlText}
              onChange={(e) => {
                setUrlText(e.target.value);
                setUrlImportStatus("");
              }}
              rows={6}
              className="resize-y font-mono text-xs"
              disabled={urlImporting}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {parsedUrls.length === 0
                  ? "No valid URLs detected"
                  : `${parsedUrls.length} valid URL${parsedUrls.length === 1 ? "" : "s"} ready`}
              </p>
              <Button
                size="sm"
                onClick={importUrls}
                disabled={urlImporting || parsedUrls.length === 0}
              >
                {urlImporting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>
                    <Link2 className="mr-2 size-4" />
                    Import {parsedUrls.length > 0 ? parsedUrls.length : ""} URL{parsedUrls.length === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            </div>
            {urlImportStatus && (
              <p className={cn(
                "text-xs",
                urlImportStatus.startsWith("✓") ? "text-emerald-400" : "text-muted-foreground",
              )}>
                {urlImportStatus}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <UploadsMappingPanel
        refreshToken={mappingRefreshToken}
        onSummaryChange={(nextSummary) => setMappingSummary(nextSummary)}
      />

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Supporting Documents Workflow</CardTitle>
          <CardDescription>
            Store PDFs, screenshots, and videos as revision-safe records mapped to rooms and vision branches.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Use the dedicated workspace to track immutable references like blueprints and branch-specific artifacts.
          </p>
          <a href="/supporting-docs">
            <Button variant="outline" className="gap-2">
              <FileText className="size-4" />
              Open Supporting Docs
            </Button>
          </a>
        </CardContent>
      </Card>

      <Dialog open={cropModalOpen} onOpenChange={(open) => (open ? setCropModalOpen(true) : closeCropModal())}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Crop Upload</DialogTitle>
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
              <Button onClick={applyCrop}>
                <Crop className="mr-2 size-4" />
                Apply Crop
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
