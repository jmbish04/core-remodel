/**
 * @fileoverview PublicRoomGalleryApp.tsx
 *
 * The vendor/showroom-facing room view. Rendered by `rooms/[slug].astro` ONLY
 * for unauthenticated visitors (the homeowner sees the full `RoomViewApp`). It
 * is deliberately photos-only: room name + dimensions, the room's listing
 * photos, and its inspiration photos — nothing about budget, estimates, options
 * or documents. It reads the photos-only `GET /api/rooms/code/:roomCode/public`
 * endpoint, which is the single public-safe room surface.
 *
 * UX goal (per the share use-case): land on the floor plan, click a room, see
 * big photos, get back out in one click. So: a prominent "Back to floor plan"
 * control, large image tiles, and a full-screen lightbox with keyboard + arrow
 * navigation.
 */

import { ArrowLeft, ChevronLeft, ChevronRight, ImageOff, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { resolveCfImageUrl } from "@/components/render/types";
import { Button } from "@/components/ui/button";

interface PublicImage {
  id: string;
  displayName: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized: string | null;
}

interface PublicRoom {
  roomCode: string;
  displayName: string;
  floorName: string | null;
  asIsUse: string | null;
  dimensionLabel: string | null;
  sqft: number | null;
}

interface PublicPayload {
  success: boolean;
  room: PublicRoom;
  listingImages: PublicImage[];
  inspirationImages: PublicImage[];
}

/** Prefer the optimized delivery id, fall back to the original. */
function imageUrl(image: PublicImage): string {
  return resolveCfImageUrl(image.cfImageIdOptimized || image.cfImageIdOriginal);
}

export function PublicRoomGalleryApp({ roomCode }: { roomCode: string }) {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<PublicPayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Lightbox index into the combined image list (listing first, then inspiration).
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/rooms/code/${encodeURIComponent(roomCode)}/public`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = (await res.json()) as PublicPayload;
        if (!cancelled && res.ok && data.success) setPayload(data);
        else if (!cancelled) setNotFound(true);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  // Flat, ordered list backing the lightbox: listing photos then inspiration.
  const allImages = useMemo<PublicImage[]>(
    () => (payload ? [...payload.listingImages, ...payload.inspirationImages] : []),
    [payload],
  );

  const showAt = useCallback(
    (image: PublicImage) => {
      const idx = allImages.findIndex((img) => img.id === image.id);
      if (idx >= 0) setActiveIndex(idx);
    },
    [allImages],
  );

  const close = useCallback(() => setActiveIndex(null), []);
  const step = useCallback(
    (delta: number) =>
      setActiveIndex((current) => {
        if (current === null || allImages.length === 0) return current;
        return (current + delta + allImages.length) % allImages.length;
      }),
    [allImages.length],
  );

  // Keyboard navigation for the lightbox.
  useEffect(() => {
    if (activeIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, close, step]);

  if (loading) {
    return (
      <div className="flex min-h-[70svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-3 size-5 animate-spin" aria-hidden="true" />
        Loading room…
      </div>
    );
  }

  if (notFound || !payload) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-lg font-semibold">Room not found</p>
        <p className="mt-2 text-sm text-muted-foreground">
          This room is not available. Head back to the floor plan to pick another.
        </p>
        <Button className="mt-6" render={<a href="/floor-plan" />}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to floor plan
        </Button>
      </div>
    );
  }

  const { room, listingImages, inspirationImages } = payload;
  const active = activeIndex !== null ? allImages[activeIndex] : null;
  const meta = [room.floorName, room.asIsUse, room.dimensionLabel, room.sqft ? `${room.sqft} sq ft` : null]
    .filter(Boolean)
    .join(" • ");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 pb-16">
      {/* Sticky, unmistakable way back to the floor plan. */}
      <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-border/40 bg-background/85 px-4 py-3 backdrop-blur">
        <Button variant="ghost" size="sm" render={<a href="/floor-plan" />}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to floor plan
        </Button>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{room.displayName}</h1>
        {meta ? <p className="mt-1 text-sm text-muted-foreground">{meta}</p> : null}
      </header>

      <GallerySection title="Photos" images={listingImages} onOpen={showAt} emptyLabel="No photos for this room yet." />

      {inspirationImages.length > 0 ? (
        <GallerySection
          title="Inspiration"
          images={inspirationImages}
          onOpen={showAt}
          className="mt-12"
        />
      ) : null}

      {/* Full-screen lightbox. */}
      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={active.displayName || room.displayName}
          onClick={close}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            onClick={close}
            aria-label="Close"
          >
            <X className="size-6" aria-hidden="true" />
          </button>

          {allImages.length > 1 ? (
            <>
              <button
                type="button"
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
                onClick={(event) => {
                  event.stopPropagation();
                  step(-1);
                }}
                aria-label="Previous photo"
              >
                <ChevronLeft className="size-7" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
                onClick={(event) => {
                  event.stopPropagation();
                  step(1);
                }}
                aria-label="Next photo"
              >
                <ChevronRight className="size-7" aria-hidden="true" />
              </button>
            </>
          ) : null}

          {/* biome-ignore lint/performance/noImgElement: CF Images delivery URL */}
          <img
            src={imageUrl(active)}
            alt={active.displayName || room.displayName}
            className="max-h-[90svh] max-w-full select-none rounded-lg object-contain"
            onClick={(event) => event.stopPropagation()}
            draggable={false}
          />
        </div>
      ) : null}
    </div>
  );
}

function GallerySection({
  title,
  images,
  onOpen,
  emptyLabel,
  className,
}: {
  title: string;
  images: PublicImage[];
  onOpen: (image: PublicImage) => void;
  emptyLabel?: string;
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="mb-4 text-lg font-semibold tracking-tight">
        {title}
        <span className="ml-2 text-sm font-normal text-muted-foreground">{images.length}</span>
      </h2>

      {images.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/20 px-6 py-14 text-center ring-1 ring-border/40">
          <ImageOff className="size-7 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => onOpen(image)}
              className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-muted/20 ring-1 ring-border/40 transition hover:ring-border"
            >
              {/* biome-ignore lint/performance/noImgElement: CF Images delivery URL */}
              <img
                src={imageUrl(image)}
                alt={image.displayName || title}
                loading="lazy"
                className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default PublicRoomGalleryApp;
