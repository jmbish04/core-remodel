/**
 * @fileoverview Workflow 4 — Media Galleries + Scrape Status (and Specs).
 *
 * Renders scraped imagery (`product_images` / `showroom_images`) as a responsive
 * grid, each tile carrying a derived scrape-lifecycle badge:
 *   - "Scraping…"  while a sweep is in flight (optimistic)
 *   - "Syncing…"   row persisted but no Cloudflare Images id yet
 *   - "Verified"   row has a cf_image_id (asset confirmed on the CDN)
 * Also renders extracted product specs (`product_specs`) as a confidence-ranked
 * table. Image grid + ring/divider styling mirror the existing review surfaces.
 */

import { ImageOff, Images, ListChecks } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  scrapeStatus,
  scrapeStatusChip,
  scrapeStatusLabel,
  type ProductSpec,
  type SourcedImage,
} from "./types";

interface MediaGalleryProps {
  images: SourcedImage[];
  /** Extracted specs (product targets only). */
  specs?: ProductSpec[];
  /** True while a sweep is running, so empty tiles show "Scraping…". */
  sweeping: boolean;
}

export function MediaGallery({ images, specs = [], sweeping }: MediaGalleryProps) {
  const verified = images.filter((i) => i.cfImageId).length;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <Images className="size-3.5" />
            Media · {images.length}
          </h4>
          {images.length > 0 ? (
            <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">
              {verified}/{images.length} verified
            </span>
          ) : null}
        </div>

        {images.length === 0 ? (
          <div className="rounded-lg bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground ring-1 ring-border/40">
            {sweeping ? "Scraping imagery…" : "No imagery sourced yet."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((img) => {
              const status = scrapeStatus(img, sweeping);
              return (
                <figure
                  key={img.id}
                  className="group relative aspect-square overflow-hidden rounded-lg bg-muted/30 ring-1 ring-border/40"
                >
                  {img.deliveryUrl ? (
                    <img
                      src={img.deliveryUrl}
                      alt={img.altText ?? img.ogTitle ?? "Sourced image"}
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <ImageOff className="size-5" />
                    </div>
                  )}
                  <span
                    className={cn(
                      "absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider ring-1 backdrop-blur-sm",
                      scrapeStatusChip(status),
                    )}
                  >
                    {scrapeStatusLabel(status)}
                  </span>
                  {img.sourcePageUrl ? (
                    <a
                      href={img.sourcePageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute inset-0"
                      aria-label="Open source page"
                    />
                  ) : null}
                  {img.imageKind && img.imageKind !== "unknown" ? (
                    <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-[9px] capitalize text-white/80">
                      {img.imageKind}
                    </figcaption>
                  ) : null}
                </figure>
              );
            })}
          </div>
        )}
      </section>

      {specs.length > 0 ? (
        <section className="space-y-2">
          <h4 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <ListChecks className="size-3.5" />
            Specs · {specs.length}
          </h4>
          <div className="overflow-hidden rounded-lg ring-1 ring-border/40">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-foreground/5">
                {specs.map((spec) => (
                  <tr key={spec.id} className="bg-card">
                    <td className="w-2/5 px-3 py-2 align-top text-xs uppercase tracking-wide text-muted-foreground">
                      {spec.specKey}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="text-foreground/90">
                        {spec.specValue}
                        {spec.unit ? <span className="text-muted-foreground"> {spec.unit}</span> : null}
                      </span>
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                        {spec.confidence}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
