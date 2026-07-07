import { Check, Loader2, Upload } from "lucide-react";
import React, { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadClear,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  apiSend,
  type EntityType,
  type UploadedDocument,
  type Visibility,
} from "./shared";

interface UploadResponse {
  success: boolean;
  document: UploadedDocument | null;
}

export interface DocumentUploaderProps {
  /** Visibility applied to every uploaded doc (via PATCH /settings). Default "private". */
  defaultVisibility?: Visibility;
  /**
   * When provided, each uploaded doc is auto-associated with this entity via
   * POST /:id/associations — makes this component reusable for entity mounting.
   */
  association?: { entityType: EntityType; entityId: string };
  /** Fired once per successfully-uploaded (and settled) document. */
  onUploaded?: (doc: UploadedDocument) => void;
  className?: string;
}

/**
 * Reusable document uploader built on the shared FileUpload dropzone primitive.
 *
 * Flow per file: POST /api/supporting-documents/upload (multipart) → optional
 * PATCH /:id/settings (visibility / docType / tags) → optional
 * POST /:id/associations (when `association` prop supplied).
 */
export function DocumentUploader({
  defaultVisibility = "private",
  association,
  onUploaded,
  className,
}: DocumentUploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility);
  const [docType, setDocType] = useState("");
  const [tags, setTags] = useState("");

  const uploadAll = useCallback(async () => {
    if (files.length === 0) {
      toast.error("Add at least one file to upload");
      return;
    }
    setUploading(true);
    try {
      let successCount = 0;
      const parsedTags = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const trimmedDocType = docType.trim().toUpperCase();

      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/supporting-documents/upload", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          document?: UploadedDocument | null;
        };
        if (!response.ok || !payload.success || !payload.document) {
          throw new Error(payload.error || `Failed uploading ${file.name}`);
        }
        const doc = payload.document;

        // Apply settings if they diverge from server defaults.
        if (visibility !== "private" || trimmedDocType || parsedTags.length > 0) {
          const settingsBody: Record<string, unknown> = {};
          if (visibility !== "private") settingsBody.visibility = visibility;
          if (trimmedDocType) settingsBody.docType = trimmedDocType;
          if (parsedTags.length > 0) settingsBody.tags = parsedTags;
          try {
            const settled = await apiSend<UploadResponse>(
              `/api/supporting-documents/${doc.id}/settings`,
              "PATCH",
              settingsBody,
            );
            if (settled.document) Object.assign(doc, settled.document);
          } catch (settingsError) {
            toast.error(
              settingsError instanceof Error
                ? `Uploaded ${file.name}, but settings failed: ${settingsError.message}`
                : `Uploaded ${file.name}, but settings failed`,
            );
          }
        }

        // Auto-associate when mounting under an entity.
        if (association) {
          try {
            await apiSend(`/api/supporting-documents/${doc.id}/associations`, "POST", {
              entityType: association.entityType,
              entityId: association.entityId,
            });
          } catch (assocError) {
            toast.error(
              assocError instanceof Error
                ? `Uploaded ${file.name}, but association failed: ${assocError.message}`
                : `Uploaded ${file.name}, but association failed`,
            );
          }
        }

        successCount += 1;
        onUploaded?.(doc);
      }

      setFiles([]);
      setDocType("");
      setTags("");
      setVisibility(defaultVisibility);
      toast.success(`Uploaded ${successCount} document${successCount === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload documents");
    } finally {
      setUploading(false);
    }
  }, [association, defaultVisibility, docType, files, onUploaded, tags, visibility]);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Visibility
          </Label>
          <Select value={visibility} onValueChange={(value) => setVisibility(value as Visibility)}>
            <SelectTrigger>
              <SelectValue placeholder="Visibility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor="uploader-doctype"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Doc Type
          </Label>
          <Input
            id="uploader-doctype"
            value={docType}
            onChange={(event) => setDocType(event.target.value)}
            placeholder="e.g. PERMIT"
            disabled={uploading}
          />
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor="uploader-tags"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Tags
          </Label>
          <Input
            id="uploader-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="comma, separated"
            disabled={uploading}
          />
        </div>
      </div>

      <FileUpload value={files} onValueChange={setFiles} multiple disabled={uploading}>
        <FileUploadDropzone className="gap-3 rounded-xl border-border/50 bg-muted/20 p-7 text-center">
          <Upload className="size-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Drop documents to upload</p>
            <p className="text-xs text-muted-foreground">
              PDF, image, video, and screenshot artifacts are supported. Text extraction runs
              automatically.
            </p>
          </div>
          <FileUploadTrigger asChild>
            <Button size="sm" variant="secondary" type="button">
              Browse Files
            </Button>
          </FileUploadTrigger>
        </FileUploadDropzone>

        <div className="flex items-center justify-between">
          <FileUploadClear asChild>
            <Button variant="ghost" size="sm" type="button" disabled={uploading}>
              Clear
            </Button>
          </FileUploadClear>
          <Button
            size="sm"
            type="button"
            onClick={() => void uploadAll()}
            disabled={uploading || files.length === 0}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Uploading
              </>
            ) : (
              <>
                <Check className="mr-2 size-4" />
                Upload {files.length > 0 ? `(${files.length})` : ""}
              </>
            )}
          </Button>
        </div>

        <FileUploadList className="max-h-56 overflow-y-auto pr-1">
          {files.map((file) => (
            <FileUploadItem
              key={`${file.name}-${file.size}-${file.lastModified}`}
              value={file}
              className="gap-3 rounded-lg border-border/40 bg-card/60 px-3 py-2"
            >
              <FileUploadItemPreview />
              <FileUploadItemMetadata size="sm" />
            </FileUploadItem>
          ))}
        </FileUploadList>
      </FileUpload>
    </div>
  );
}
