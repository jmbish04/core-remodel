import { Camera, ImageOff } from "lucide-react";
import React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { type RenderCanvas, resolveCfImageUrl } from "./types";

export interface AngleEntry {
  /** listing_photos.id for this camera angle. */
  listingPhotoId: number;
  /** Friendly label (e.g. "Sink wall", "Island view"). */
  label?: string | null;
  /** Blank-canvas (stage 0) delivery URL or CF Images id. */
  blankCanvasUrl?: string | null;
  /** Latest render for the current look (stage_3), if any. */
  latestRender?: Pick<
    RenderCanvas,
    "outputImageUrl" | "outputCfImageId" | "status" | "aiTitle"
  > | null;
}

interface AngleGalleryProps {
  angles: AngleEntry[];
  selectedListingPhotoId?: number | null;
  onSelect: (listingPhotoId: number) => void;
  className?: string;
}

/**
 * AngleGallery — a grid of a room's angle thumbnails. Each tile prefers the
 * latest render for the current look and falls back to the blank canvas.
 */
export function AngleGallery({
  angles,
  selectedListingPhotoId,
  onSelect,
  className,
}: AngleGalleryProps) {
  if (angles.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl bg-card px-4 py-10 text-center ring-1 ring-border/40",
          className,
        )}
      >
        <Camera className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">No angles for this room yet</p>
        <p className="text-xs text-muted-foreground">
          Upload blank canvases for this room to start staging angles.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4",
        className,
      )}
    >
      {angles.map((angle) => {
        const renderUrl = resolveCfImageUrl(
          angle.latestRender?.outputImageUrl ||
            angle.latestRender?.outputCfImageId ||
            "",
        );
        const blankUrl = resolveCfImageUrl(angle.blankCanvasUrl || "");
        const url = renderUrl || blankUrl;
        const isSelected = selectedListingPhotoId === angle.listingPhotoId;
        const hasRender = Boolean(renderUrl);
        return (
          <button
            key={angle.listingPhotoId}
            type="button"
            onClick={() => onSelect(angle.listingPhotoId)}
            className={cn(
              "group relative overflow-hidden rounded-lg bg-card text-left ring-1 ring-border/40 transition",
              isSelected ? "ring-2 ring-primary" : "hover:ring-border",
            )}
          >
            <div className="relative aspect-[4/3] w-full bg-muted/30">
              {url ? (
                <img
                  src={url}
                  alt={angle.label || `Angle ${angle.listingPhotoId}`}
                  className="size-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground">
                  <ImageOff className="size-5" />
                </div>
              )}
              <div className="absolute left-1.5 top-1.5">
                <Badge
                  variant={hasRender ? "default" : "secondary"}
                  className="text-[9px] uppercase tracking-wide"
                >
                  {hasRender ? "Rendered" : "Blank"}
                </Badge>
              </div>
            </div>
            <div className="px-2 py-1.5">
              <p className="truncate text-xs font-medium">
                {angle.label ||
                  angle.latestRender?.aiTitle ||
                  `Angle ${angle.listingPhotoId}`}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default AngleGallery;
