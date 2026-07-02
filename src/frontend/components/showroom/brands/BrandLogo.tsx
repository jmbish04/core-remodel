/**
 * @fileoverview BrandLogo — brand icon + name lockup.
 *
 * Adapted from the ui.beste.co `logo1` piece into the project's Astro/React +
 * Monolith conventions (the upstream ships as a Next.js component using
 * `next/image`; here we use a plain <img> with a graceful fallback and the
 * repo's `cn` util). Used to render the icons for brands associated with a
 * showroom (StoreViewportApp brands section).
 *
 * When `image` (the brand's Cloudflare-Images favicon URL) is present and loads,
 * it renders in a rounded card tile (object-contain so transparent favicons sit
 * on the card surface). Otherwise it falls back to a toned lucide glyph so a
 * brand without a scraped favicon still reads as a branded chip.
 */

import { useState } from "react";
import { Box, Globe, Sparkles, Zap } from "lucide-react";

import { cn } from "@/lib/utils";

type IconKey = "zap" | "sparkle" | "box" | "globe";
type Tone = "primary" | "foreground" | "sunset";

const iconMap: Record<IconKey, typeof Zap> = {
  zap: Zap,
  sparkle: Sparkles,
  box: Box,
  globe: Globe,
};

const toneClasses: Record<Tone, string> = {
  primary: "bg-primary text-primary-foreground",
  foreground: "bg-foreground text-background",
  sunset: "bg-gradient-to-br from-rose-500 to-orange-500 text-white",
};

export interface BrandLogoProps {
  /** Brand favicon / logo URL (Cloudflare Images delivery URL). */
  image?: string | null;
  /** Brand name — shown as the label and used as the img alt. */
  alt?: string;
  /** Fallback glyph when no image is available or it fails to load. */
  icon?: IconKey;
  /** Fallback tile tone. */
  tone?: Tone;
  /** Render the name label alongside the icon (default true). */
  showName?: boolean;
  className?: string;
}

export function BrandLogo({
  image,
  alt = "Brand",
  icon = "box",
  tone = "foreground",
  showName = true,
  className,
}: BrandLogoProps) {
  const Icon = iconMap[icon];
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(image) && !broken;

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      {showImage ? (
        <span className="relative flex size-8 items-center justify-center overflow-hidden rounded-lg bg-card ring-1 ring-border/40">
          <img
            src={image ?? undefined}
            alt={alt}
            className="size-full object-contain"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        </span>
      ) : (
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-lg shadow-sm",
            toneClasses[tone],
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
      )}
      {showName && (
        <span className="text-sm font-semibold tracking-tight text-card-foreground">
          {alt}
        </span>
      )}
    </div>
  );
}
