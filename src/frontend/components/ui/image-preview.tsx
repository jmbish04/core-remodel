import { ChevronDown, ChevronUp, Info, ZoomIn, ZoomOut } from "lucide-react";
import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ImagePreviewMetadata {
  [key: string]: unknown;
}

export interface ImagePreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt?: string;
  title?: string;
  metadata?: ImagePreviewMetadata | string | null;
  actions?: React.ReactNode;
  className?: string;
}

function normalizeMetadata(
  value: ImagePreviewMetadata | string | null | undefined,
): ImagePreviewMetadata {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as ImagePreviewMetadata;
      }
      return { raw: value };
    } catch {
      return { raw: value };
    }
  }

  return value;
}

export function ImagePreview(props: ImagePreviewProps) {
  const {
    open,
    onOpenChange,
    src,
    alt = "Preview image",
    title = "Image Preview",
    metadata,
    actions,
    className,
  } = props;

  const [zoom, setZoom] = useState(1);
  const [showMetadata, setShowMetadata] = useState(false);

  const metadataObject = useMemo(() => normalizeMetadata(metadata), [metadata]);
  const metadataEntries = useMemo(
    () => Object.entries(metadataObject).filter(([, value]) => value !== null && value !== undefined),
    [metadataObject],
  );

  const resetState = () => {
    setZoom(1);
    setShowMetadata(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          resetState();
        }
      }}
    >
      <DialogContent className={cn("max-w-6xl", className)}>
        <DialogHeader>
          <DialogTitle className="truncate pr-4">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative max-h-[72vh] overflow-auto rounded-xl bg-muted/20 p-4 ring-1 ring-border/40">
            {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
            <img
              src={src}
              alt={alt}
              className="mx-auto max-w-full origin-center rounded-lg object-contain transition-transform"
              style={{ transform: `scale(${zoom})` }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setZoom((current) => Math.max(0.5, current - 0.25))}
              title="Zoom out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.25}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="w-40"
            />
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setZoom((current) => Math.min(4, current + 0.25))}
              title="Zoom in"
            >
              <ZoomIn className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground">{zoom.toFixed(2)}x</span>

            {metadataEntries.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto gap-2"
                onClick={() => setShowMetadata((current) => !current)}
              >
                <Info className="size-4" />
                Metadata
                {showMetadata ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </Button>
            )}

            {actions}
          </div>

          {showMetadata && metadataEntries.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-lg bg-muted/20 p-3 ring-1 ring-border/30">
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                {metadataEntries.map(([key, value]) => (
                  <div key={key}>
                    <dt className="font-medium text-foreground">{key}</dt>
                    <dd className="text-muted-foreground">
                      {typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
