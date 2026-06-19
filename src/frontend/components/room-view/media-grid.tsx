import React from "react";

import { LazyImage } from "@/components/lazy-image";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ImageActions } from "./ImageActions";
import { formatDate, resolveImageUrl, type MediaKind, type MediaViewMode, type RoomImage } from "./types";

/**
 * media-grid.tsx — the photo grid the Room Media modal renders in its three
 * layout modes (Gallery / Masonry / List — Bento is intentionally gone).
 *
 * Why a bespoke grid instead of the bare `ui/image-gallery` components: the spec
 * (T3.6 / T3.8) requires EVERY tile to surface two things the generic galleries
 * cannot host — a stateful per-image `ImageActions` menu (its own AlertDialogs)
 * and a `Duplicate` badge driven by `image.isDuplicate`. This module reuses the
 * exact same primitives the shipped galleries are built from (`LazyImage` for
 * the masonry ratios, `resolveImageUrl` for delivery URLs, the same Monolith
 * ring/hover treatment) so the look stays consistent while gaining the overlay.
 *
 * All three layouts share one `MediaTile`, so the image + duplicate badge +
 * actions menu behave identically regardless of view mode. Selection/editing
 * state lives in the tiles' own `ImageActions`; this grid is otherwise pure.
 */
export interface MediaGridProps {
  images: RoomImage[];
  view: MediaViewMode;
  kind: MediaKind;
  roomId: number;
  roomDisplayName: string;
  accessAuthenticated: boolean;
  /** Bubbles up after any per-image mutation so the modal can refresh. */
  onChanged: () => void;
}

/** Deterministic aspect ratios for masonry, mirroring the shipped masonry gallery. */
const MASONRY_RATIOS = [1, 4 / 3, 3 / 4, 16 / 9, 2 / 3] as const;

function ratioForId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(index);
    hash |= 0;
  }
  const normalized = Math.abs(hash) % MASONRY_RATIOS.length;
  return MASONRY_RATIOS[normalized] ?? 1;
}

export function MediaGrid(props: MediaGridProps) {
  const { images, view, kind, roomId, roomDisplayName, accessAuthenticated, onChanged } = props;

  if (images.length === 0) {
    return (
      <div className="rounded-xl bg-muted/10 px-4 py-12 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
        No {kind} photos are linked to this room yet.
      </div>
    );
  }

  const shared = { kind, roomId, roomDisplayName, accessAuthenticated, onChanged } as const;

  if (view === "list") {
    return (
      <div className="space-y-3">
        {images.map((image) => (
          <MediaTile key={image.id} image={image} layout="list" {...shared} />
        ))}
      </div>
    );
  }

  if (view === "masonry") {
    return (
      <div className="columns-1 gap-4 sm:columns-2 md:columns-3 xl:columns-4">
        {images.map((image) => (
          <MediaTile key={image.id} image={image} layout="masonry" {...shared} />
        ))}
      </div>
    );
  }

  // Gallery (default) — responsive grid.
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {images.map((image) => (
        <MediaTile key={image.id} image={image} layout="gallery" {...shared} />
      ))}
    </div>
  );
}

/** A single photo tile shared across all three layouts. */
function MediaTile(props: {
  image: RoomImage;
  layout: "gallery" | "masonry" | "list";
  kind: MediaKind;
  roomId: number;
  roomDisplayName: string;
  accessAuthenticated: boolean;
  onChanged: () => void;
}) {
  const { image, layout, kind, roomId, roomDisplayName, accessAuthenticated, onChanged } = props;
  const src = resolveImageUrl(image);
  const title = image.displayName?.trim() || roomDisplayName || "Photo";
  const subtitle = formatDate(image.datetimeCreated);

  const overlay = (
    <>
      {image.isDuplicate ? (
        <Badge
          variant="destructive"
          className="absolute left-2 top-2 h-5 px-1.5 text-[10px] uppercase tracking-wide"
        >
          Duplicate
        </Badge>
      ) : null}
      {accessAuthenticated ? (
        <div className="absolute right-1.5 top-1.5 rounded-full bg-background/80 backdrop-blur-sm">
          <ImageActions
            image={image}
            kind={kind}
            roomId={roomId}
            accessAuthenticated={accessAuthenticated}
            onChanged={onChanged}
          />
        </div>
      ) : null}
    </>
  );

  if (layout === "list") {
    return (
      <div className="flex flex-col gap-3 rounded-xl bg-card/40 p-3 ring-1 ring-border/40 md:flex-row">
        <div className="relative shrink-0 overflow-hidden rounded-lg md:w-56">
          {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
          <img src={src} alt={image.displayName || image.id} className="h-40 w-full object-cover md:h-full" />
          {image.isDuplicate ? (
            <Badge
              variant="destructive"
              className="absolute left-2 top-2 h-5 px-1.5 text-[10px] uppercase tracking-wide"
            >
              Duplicate
            </Badge>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
            <Badge variant="secondary" className="capitalize">
              {kind}
            </Badge>
          </div>
          {accessAuthenticated ? (
            <ImageActions
              image={image}
              kind={kind}
              roomId={roomId}
              accessAuthenticated={accessAuthenticated}
              onChanged={onChanged}
            />
          ) : null}
        </div>
      </div>
    );
  }

  if (layout === "masonry") {
    return (
      <div className="mb-4 block break-inside-avoid">
        <div className="group relative overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
          <LazyImage
            alt={image.displayName || image.id}
            src={src}
            ratio={ratioForId(image.id)}
            inView
            className="transition-transform duration-300 group-hover:scale-[1.02]"
            containerClassName="border-0 bg-muted/40"
          />
          {overlay}
        </div>
        <p className="truncate px-1 pt-1.5 text-xs font-medium">{title}</p>
      </div>
    );
  }

  // Gallery tile.
  return (
    <div className="group overflow-hidden rounded-xl bg-card ring-1 ring-border/40 transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="relative aspect-[4/3] overflow-hidden">
        {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
        <img
          src={src}
          alt={image.displayName || image.id}
          loading="lazy"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {overlay}
      </div>
      <div className={cn("space-y-1 p-2.5")}>
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

export default MediaGrid;
