/**
 * @fileoverview ProductGallery — square main image + selectable thumbnail strip.
 *
 * Modeled on the "Ecommerce26" left column but rebuilt for Monolith dark: no
 * 1px borders (ring-1 ring-border/40 + bg-card), active thumb marked with
 * ring-2 ring-primary, graceful onError fallback per image. Renders an inviting
 * placeholder tile when the product has no images at all.
 */

import { useMemo, useState } from "react";
import { ImageOff } from "lucide-react";

import type { ProductImage } from "./types";

/** A single image that swaps to a fallback tile when the URL 404s. */
function GalleryImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div
        className={`flex items-center justify-center bg-muted text-muted-foreground ring-1 ring-border/40 ${className}`}
      >
        <ImageOff className="size-6" aria-label="Image unavailable" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className={`bg-muted object-cover ring-1 ring-border/40 ${className}`}
    />
  );
}

export function ProductGallery({
  images,
  productName,
}: {
  images: ProductImage[];
  productName: string;
}) {
  // Only show images the reviewer has not rejected.
  const visible = useMemo(
    () => images.filter((img) => img.reviewStatus !== "rejected"),
    [images],
  );
  const [activeId, setActiveId] = useState<number | null>(visible[0]?.id ?? null);

  const active = visible.find((img) => img.id === activeId) ?? visible[0] ?? null;

  if (!active) {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-2xl bg-card text-muted-foreground ring-1 ring-border/40">
        <ImageOff className="size-8" aria-hidden />
        <p className="text-xs">No product imagery yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <GalleryImage
        key={active.id}
        src={active.deliveryUrl}
        alt={active.altText ?? productName}
        className="aspect-square w-full rounded-2xl"
      />

      {visible.length > 1 && (
        <div className="grid grid-cols-5 gap-2">
          {visible.map((img) => {
            const isActive = img.id === active.id;
            return (
              <button
                key={img.id}
                type="button"
                onClick={() => setActiveId(img.id)}
                aria-label={`View ${img.altText ?? productName}`}
                aria-pressed={isActive}
                className={`overflow-hidden rounded-lg transition-opacity ${
                  isActive
                    ? "ring-2 ring-primary"
                    : "opacity-70 ring-1 ring-border/40 hover:opacity-100"
                }`}
              >
                <GalleryImage
                  src={img.deliveryUrl}
                  alt={img.altText ?? productName}
                  className="aspect-square w-full"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
