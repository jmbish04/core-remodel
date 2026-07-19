/**
 * @fileoverview UploadPhotoModal — drag-and-drop / click-to-browse photo upload.
 *
 * Replaces the bare hidden `<input type=file>` that both "Upload photo" buttons
 * (hero action bar + "Your visit photos" card) used to trigger directly. On a
 * touchscreen a hidden input gives no target and no feedback; this gives a
 * large drop zone that doubles as the file-browser trigger, at the same ~80%
 * viewport size as the hours modal.
 *
 * Upload itself is delegated — the parent already owns the batch uploader that
 * POSTs to `/api/showroom-stores/:id/photos`.
 */

import { useCallback, useRef, useState } from "react";
import { ImagePlus, Loader2, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { TOUCH_DIALOG_BODY_CLASS, TOUCH_DIALOG_CLASS } from "./touch-dialog";

export function UploadPhotoModal({
  open,
  onOpenChange,
  uploading,
  onUpload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uploading: boolean;
  /** Uploads the batch; the modal closes once it resolves. */
  onUpload: (files: File[]) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = useCallback(
    async (list: FileList | null) => {
      const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      await onUpload(files);
      onOpenChange(false);
    },
    [onUpload, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (uploading ? undefined : onOpenChange(next))}>
      <DialogContent className={TOUCH_DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="size-4" /> Upload photos
          </DialogTitle>
          <DialogDescription>
            Drop images here, or tap to pick them from this device.
          </DialogDescription>
        </DialogHeader>

        <div className={TOUCH_DIALOG_BODY_CLASS}>
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!uploading) void accept(e.dataTransfer.files);
            }}
            className={`flex h-full min-h-64 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors ${
              dragging
                ? "border-primary bg-primary/10"
                : "border-border/60 bg-muted/20 hover:bg-muted/40"
            } disabled:opacity-60`}
          >
            {uploading ? (
              <Loader2 className="size-10 animate-spin text-muted-foreground" />
            ) : (
              <UploadCloud className="size-10 text-muted-foreground" />
            )}
            <span className="text-lg font-medium">
              {uploading ? "Uploading…" : "Drag photos here"}
            </span>
            <span className="text-sm text-muted-foreground">
              {uploading ? "Hang tight." : "or tap to browse"}
            </span>
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const list = e.target.files;
              e.target.value = ""; // allow re-picking the same file
              void accept(list);
            }}
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="h-12 px-4"
            disabled={uploading}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
