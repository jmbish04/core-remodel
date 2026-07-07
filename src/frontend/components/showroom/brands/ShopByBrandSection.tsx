/**
 * @fileoverview ShopByBrandSection — "Shop by Brand" grid for the showroom page.
 *
 * Adapted from the beste.co `ecommerce32` block into the project's Monolith dark
 * theme. The upstream ships a centered section (Badge + heading + description)
 * over a flex-wrap grid of brand cards — logo (grayscale → color on hover), name,
 * and an "N products" line, each card a link to the brand.
 *
 * Monolith adaptations vs. the reference:
 *   - No `border` + `hover:border-primary`; instead `ring-1 ring-border/40` +
 *     `hover:ring-primary/50` on a `bg-card` rounded-xl tile.
 *   - Keeps the grayscale-to-color logo hover (opacity 50 → 100), which reads
 *     well on the dark surface.
 *   - Brand logos use a plain <img> with an onError fallback to a lettermark
 *     tile (first letter over bg-muted) — mirrors BrandLogo's fallback pattern.
 *
 * Cards link to `/admin/brands/${id}` (plain <a>, no client router) — the brand
 * detail viewport there already renders that brand's products grid.
 *
 * Renders nothing when there are 0 brands (empty state = return null).
 */

import { useState } from "react";
import { Store } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ShopByBrandItem {
  id: number;
  name: string;
  /** Cloudflare Images delivery URL for the brand favicon/logo, if scraped. */
  iconCfImagesUrl: string | null;
  /** Number of this showroom's products carried under the brand (optional). */
  productCount?: number;
}

export interface ShopByBrandSectionProps {
  brands: ShopByBrandItem[];
  className?: string;
}

/** Brand logo tile with a graceful lettermark fallback (mirrors BrandLogo). */
function BrandCardLogo({ image, name }: { image: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(image) && !broken;
  const letter = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span className="relative flex size-14 items-center justify-center overflow-hidden rounded-xl bg-muted">
      {showImage ? (
        <img
          src={image ?? undefined}
          alt={`${name} logo`}
          loading="lazy"
          onError={() => setBroken(true)}
          className="size-full object-contain p-2 opacity-50 grayscale transition-all duration-300 group-hover:opacity-100 group-hover:grayscale-0"
        />
      ) : (
        <span className="text-lg font-semibold text-muted-foreground transition-colors duration-300 group-hover:text-foreground">
          {letter}
        </span>
      )}
    </span>
  );
}

export function ShopByBrandSection({ brands, className }: ShopByBrandSectionProps) {
  // Empty state: render nothing.
  if (brands.length === 0) return null;

  return (
    <section className={cn("flex flex-col items-center text-center", className)}>
      <Badge variant="outline" className="gap-1.5 font-mono text-[10px] uppercase tracking-widest">
        <Store className="size-3" />
        Brands
      </Badge>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight">Shop by Brand</h2>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Browse the brands carried at this showroom. Select one to see its products.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-4">
        {brands.map((brand) => (
          <a
            key={brand.id}
            href={`/admin/brands/${brand.id}`}
            aria-label={`View ${brand.name} products`}
            className={cn(
              "group flex w-40 flex-col items-center gap-3 rounded-xl bg-card p-5",
              "ring-1 ring-border/40 transition-all duration-300 hover:ring-primary/50",
            )}
          >
            <BrandCardLogo image={brand.iconCfImagesUrl} name={brand.name} />
            <span className="line-clamp-2 text-sm font-semibold tracking-tight text-card-foreground">
              {brand.name}
            </span>
            {typeof brand.productCount === "number" ? (
              <span className="text-xs text-muted-foreground">
                {brand.productCount} product{brand.productCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </a>
        ))}
      </div>
    </section>
  );
}
