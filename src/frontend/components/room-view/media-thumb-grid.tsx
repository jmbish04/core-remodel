import { Check } from "lucide-react";
import React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { resolveImageUrl, type RoomImage } from "./types";

/**
 * media-thumb-grid.tsx — a compact, controlled multi-select thumbnail grid used
 * by `MovePhotosModal` (Round 3b — T3.9) to let the user pick which of the
 * room's photos to move.
 *
 * The project ships no shadcn `Checkbox` primitive, so selection is expressed
 * the Monolith way: a `ring-2 ring-ring` highlight plus a small check badge in
 * the corner — no 1px borders, dark surfaces only. The whole tile is a single
 * `<button>` so it is keyboard-operable and screen-reader friendly (its
 * `aria-pressed` reflects selection state).
 *
 * Controlled component: the parent owns the selected-id set and toggles it via
 * `onToggle`. Kept tiny and dependency-free so it can be reused by any future
 * "pick some photos" surface.
 */
export interface MediaThumbGridProps {
  /** The images to render as selectable tiles. */
  images: RoomImage[];
  /** Currently-selected image ids (controlled by the parent). */
  selectedIds: Set<string>;
  /** Toggles a single image id in/out of the selection. */
  onToggle: (imageId: string) => void;
  /** Fallback label when an image has no display name. */
  fallbackTitle?: string;
  /** Disables interaction (e.g. while a move is in flight). */
  disabled?: boolean;
  className?: string;
}

export function MediaThumbGrid(props: MediaThumbGridProps) {
  const { images, selectedIds, onToggle, fallbackTitle = "Photo", disabled = false, className } = props;

  if (images.length === 0) {
    return (
      <div className="rounded-xl bg-muted/10 px-4 py-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
        There are no photos of this type to move.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4",
        className,
      )}
      role="group"
      aria-label="Select photos to move"
    >
      {images.map((image) => {
        const isSelected = selectedIds.has(image.id);
        const title = image.displayName?.trim() || fallbackTitle;
        const src = resolveImageUrl(image);

        return (
          <button
            key={image.id}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={() => onToggle(image.id)}
            className={cn(
              "group relative overflow-hidden rounded-xl bg-card text-left transition",
              "ring-1 ring-border/40 hover:-translate-y-0.5 hover:shadow-lg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-60",
              isSelected && "ring-2 ring-ring",
            )}
          >
            <div className="relative aspect-[4/3] overflow-hidden">
              {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
              <img
                src={src}
                alt={image.displayName || image.id}
                loading="lazy"
                className={cn(
                  "size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]",
                  isSelected && "brightness-90",
                )}
              />

              {/* Selection check — only rendered when picked, top-right corner. */}
              {isSelected ? (
                <span className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                  <Check className="size-3.5" />
                </span>
              ) : null}

              {/* Duplicate hint so duplicates are obvious while culling/moving. */}
              {image.isDuplicate ? (
                <Badge
                  variant="destructive"
                  className="absolute left-2 top-2 h-5 px-1.5 text-[10px] uppercase tracking-wide"
                >
                  Duplicate
                </Badge>
              ) : null}
            </div>

            <p className="truncate p-2 text-xs font-medium">{title}</p>
          </button>
        );
      })}
    </div>
  );
}

export default MediaThumbGrid;
