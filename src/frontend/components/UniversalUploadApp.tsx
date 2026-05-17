import { Check, Crop, FileText, Loader2, Upload, X } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { UploadsMappingPanel } from "@/components/UploadsMappingPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
const MAX_FILES = 30;

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
  const [status, setStatus] = useState<string>("");
  const [mappingSummary, setMappingSummary] = useState<MappingSummary>({
    listing: 0,
    inspirational: 0,
    total: 0,
  });
  const [mappingRefreshToken, setMappingRefreshToken] = useState(0);

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
      setFiles((current) => current.map((item) => (item === cropTargetFile ? croppedFile : item)));
      closeCropModal();
      setStatus(`Applied crop to ${croppedFile.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to apply crop");
    }
  };

  const uploadFiles = async () => {
    if (files.length === 0) {
      setStatus("Add files before uploading");
      return;
    }

    setUploading(true);
    setStatus(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}...`);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }

      formData.append("isListingPhoto", String(target === "listing"));
      formData.append("photoCategory", target);

      const response = await fetch("/api/images/upload", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        results?: Array<{ success?: boolean }>;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Upload failed");
      }

      const results = payload.results || [];
      const successful = results.filter((result) => result.success).length;
      const failed = results.length - successful;

      setFiles([]);
      setStatus(
        failed === 0
          ? `Uploaded ${successful} file${successful === 1 ? "" : "s"}. Map them in the queue below.`
          : `Uploaded ${successful}/${results.length} files`,
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
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("image-mapping-summary-updated", {
          detail: { source: "universal-upload" },
        }),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
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
                  Up to {MAX_FILES} files, each max 10MB
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
                <Button variant="ghost" size="sm" disabled={uploading}>
                  Clear Queue
                </Button>
              </FileUploadClear>

              <Button size="sm" onClick={uploadFiles} disabled={uploading || files.length === 0}>
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

            <FileUploadList className="max-h-72 overflow-y-auto pr-1">
              {files.map((file) => (
                <FileUploadItem
                  key={getFileKey(file)}
                  value={file}
                  className="gap-3 rounded-lg border-border/40 bg-card/60 px-3 py-2"
                >
                  <FileUploadItemPreview className="size-12 rounded-md ring-1 ring-border/40" />
                  <FileUploadItemMetadata size="sm" />

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
                    <Button variant="ghost" size="icon-sm" title="Remove file">
                      <X className="size-4" />
                    </Button>
                  </FileUploadItemDelete>
                </FileUploadItem>
              ))}
            </FileUploadList>
          </FileUpload>

          {status && <p className="text-sm text-muted-foreground">{status}</p>}
        </CardContent>
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
