/**
 * @fileoverview ShowroomGalleryModal — a theater/lightbox for showroom photos.
 *
 * A large centered image sits on a dark scrim; prev/next arrows and keyboard
 * Left/Right navigate, Esc closes. A horizontally-scrollable thumbnail strip
 * lets you jump directly to any photo. The caption surfaces the Google author
 * attribution (Google Maps UGC requires visible credit) plus a "View on Google
 * Maps" link when the photo carries a `googleMapsUri`.
 *
 * Implemented as a fixed overlay (not the constrained shadcn Dialog) so the
 * theater can go near-fullscreen with full layout control. Monolith dark, no
 * 1px borders (ring-1 ring-border/40), mobile responsive.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";

import { cn } from "@/lib/utils";

export interface GalleryPhoto {
  id: number;
  cfImagesPhotoUrl: string;
  authorAttributes?: Array<{
    displayName?: string | null;
    uri?: string | null;
  }> | null;
  googleMapsUri?: string | null;
}

interface ShowroomGalleryModalProps {
  photos: GalleryPhoto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Photo to open on. Clamped into range. Defaults to 0. */
  startIndex?: number;
}

/** A single thumbnail image with graceful onError fallback. */
function Thumb({
  src,
  active,
  onClick,
  label,
}: {
  src: string;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active}
      className={cn(
        "relative size-16 shrink-0 overflow-hidden rounded-lg bg-card transition-all",
        active
          ? "ring-2 ring-primary"
          : "opacity-60 ring-1 ring-border/40 hover:opacity-100",
      )}
    >
      {failed ? (
        <span className="flex size-full items-center justify-center bg-muted/40 text-[9px] text-muted-foreground">
          n/a
        </span>
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      )}
    </button>
  );
}

/** The main stage image with graceful onError fallback. */
function StageImage({ src, index }: { src: string; index: number }) {
  const [failed, setFailed] = useState(false);
  // Reset the failure flag whenever the source changes (keyed by index below).
  return failed ? (
    <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
      This photo could not be loaded.
    </div>
  ) : (
    <img
      key={index}
      src={src}
      alt={`Showroom photo ${index + 1}`}
      onError={() => setFailed(true)}
      className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
    />
  );
}

export function ShowroomGalleryModal({
  photos,
  open,
  onOpenChange,
  startIndex = 0,
}: ShowroomGalleryModalProps) {
  const count = photos.length;
  const [index, setIndex] = useState(startIndex);

  // Clamp the active index into range whenever we (re)open or the set changes.
  useEffect(() => {
    if (!open) return;
    const clamped = Math.min(Math.max(startIndex, 0), Math.max(count - 1, 0));
    setIndex(clamped);
  }, [open, startIndex, count]);

  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setIndex((i) => (i + delta + count) % count);
    },
    [count],
  );

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Keyboard: Left/Right navigate, Esc closes. Bound only while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go, close]);

  // Lock body scroll while the theater is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || count === 0) return null;

  const current = photos[Math.min(index, count - 1)];
  const attributions = (current.authorAttributes ?? []).filter(
    (a) => a && (a.displayName || a.uri),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 supports-backdrop-filter:backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Showroom photo gallery"
    >
      {/* Top bar: counter + close. */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="font-mono text-[11px] uppercase tracking-widest text-white/70">
          {index + 1} / {count}
        </span>
        <button
          type="button"
          onClick={close}
          aria-label="Close gallery"
          className="rounded-full bg-white/10 p-2 text-white/90 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Stage. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-16">
        {count > 1 ? (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/90 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:left-4 sm:p-3"
          >
            <ChevronLeft className="size-6" />
          </button>
        ) : null}

        <div className="flex h-full max-h-full w-full items-center justify-center overflow-hidden">
          <StageImage src={current.cfImagesPhotoUrl} index={index} />
        </div>

        {count > 1 ? (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/90 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:right-4 sm:p-3"
          >
            <ChevronRight className="size-6" />
          </button>
        ) : null}
      </div>

      {/* Caption: Google author attribution (required) + Maps link. */}
      <div className="px-4 py-2 text-center">
        {attributions.length > 0 ? (
          <p className="text-xs text-white/70">
            Photo by{" "}
            {attributions.map((a, i) => {
              const name = a.displayName?.trim() || "Google user";
              const node = a.uri ? (
                <a
                  key={`${name}-${i}`}
                  href={a.uri}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-sky-300 hover:text-sky-200"
                >
                  {name}
                </a>
              ) : (
                <span key={`${name}-${i}`} className="font-medium text-white/90">
                  {name}
                </span>
              );
              return (
                <span key={`sep-${i}`}>
                  {i > 0 ? ", " : ""}
                  {node}
                </span>
              );
            })}{" "}
            <span className="text-white/40">· via Google Maps</span>
          </p>
        ) : (
          <p className="text-xs text-white/40">Photo via Google Maps</p>
        )}
        {current.googleMapsUri ? (
          <a
            href={current.googleMapsUri}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-white/70 transition-colors hover:text-white"
          >
            <ExternalLink className="size-3" />
            View on Google Maps
          </a>
        ) : null}
      </div>

      {/* Thumbnail strip. */}
      {count > 1 ? (
        <div className="shrink-0 overflow-x-auto px-4 pb-4 pt-1">
          <div className="mx-auto flex w-max gap-2">
            {photos.map((p, i) => (
              <Thumb
                key={p.id}
                src={p.cfImagesPhotoUrl}
                active={i === index}
                onClick={() => setIndex(i)}
                label={`Go to photo ${i + 1}`}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
