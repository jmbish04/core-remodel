/**
 * @fileoverview Workflow 4 — Media Galleries + Scrape Status + per-image HITL.
 *
 * Renders scraped imagery (`product_images` / `showroom_images`) as a responsive
 * grid, each tile carrying a derived scrape-lifecycle badge:
 *   - "Scraping…"  while a sweep is in flight (optimistic)
 *   - "Syncing…"   row persisted but no Cloudflare Images id yet
 *   - "Verified"   row has a cf_image_id (asset confirmed on the CDN)
 * Scraping can surface spam/irrelevant images, so each tile also has per-image
 * **Approve / Reject (junk)** controls; rejected tiles are dimmed and badged.
 * Also renders extracted product specs (`product_specs`) as a confidence-ranked
 * table.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Check, ImageOff, Images, ListChecks, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { reviewImage, type ReviewScope } from "./api";
import {
  scrapeStatus,
  scrapeStatusChip,
  scrapeStatusLabel,
  type ProductSpec,
  type ReviewStatus,
  type SourcedImage,
} from "./types";

interface MediaGalleryProps {
  images: SourcedImage[];
  /** Extracted specs (product targets only). */
  specs?: ProductSpec[];
  /** True while a sweep is running, so empty tiles show "Scraping…". */
  sweeping: boolean;
  /** Selects the table the image lives in (product vs store scoped). */
  scope: ReviewScope;
  /** Re-fetch the target context after a review write lands. */
  onReviewed: () => void;
}

export function MediaGallery({ images, specs = [], sweeping, scope, onReviewed }: MediaGalleryProps) {
  const verified = images.filter((i) => i.cfImageId).length;
  const [busy, setBusy] = useState<Set<number>>(new Set());

  function markBusy(id: number, on: boolean) {
    setBusy((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function review(img: SourcedImage, status: ReviewStatus) {
    markBusy(img.id, true);
    const result = await reviewImage(scope, img.id, status);
    markBusy(img.id, false);
    if (!result.ok) {
      toast.error(`Review failed: ${result.error}`);
      return;
    }
    toast.success(status === "approved" ? "Image approved." : "Image rejected as junk.");
    onReviewed();
  }

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
              const review_: ReviewStatus = img.reviewStatus ?? "pending";
              const rowBusy = busy.has(img.id);
              return (
                <figure
                  key={img.id}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-lg bg-muted/30 ring-1 transition",
                    review_ === "rejected"
                      ? "ring-rose-500/40"
                      : review_ === "approved"
                        ? "ring-emerald-500/40"
                        : "ring-border/40",
                  )}
                >
                  {img.deliveryUrl ? (
                    <img
                      src={img.deliveryUrl}
                      alt={img.altText ?? img.ogTitle ?? "Sourced image"}
                      loading="lazy"
                      className={cn(
                        "size-full object-cover transition-transform duration-300 group-hover:scale-105",
                        review_ === "rejected" && "opacity-40",
                      )}
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <ImageOff className="size-5" />
                    </div>
                  )}

                  {/* Scrape lifecycle (top-left) */}
                  <span
                    className={cn(
                      "absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider ring-1 backdrop-blur-sm",
                      scrapeStatusChip(status),
                    )}
                  >
                    {scrapeStatusLabel(status)}
                  </span>

                  {/* Review state (top-right) once acted on */}
                  {review_ !== "pending" ? (
                    <span
                      className={cn(
                        "absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider ring-1 backdrop-blur-sm",
                        review_ === "approved"
                          ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40"
                          : "bg-rose-500/15 text-rose-300 ring-rose-500/40",
                      )}
                    >
                      {review_}
                    </span>
                  ) : null}

                  {img.imageKind && img.imageKind !== "unknown" ? (
                    <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-[9px] capitalize text-white/80">
                      {img.imageKind}
                    </figcaption>
                  ) : null}

                  {/* HITL controls — revealed on hover/focus */}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    {review_ !== "approved" ? (
                      <button
                        type="button"
                        onClick={() => review(img, "approved")}
                        disabled={rowBusy}
                        aria-label="Approve image"
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-500/90 px-2 py-1 text-[10px] font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
                      >
                        {rowBusy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        Keep
                      </button>
                    ) : null}
                    {review_ !== "rejected" ? (
                      <button
                        type="button"
                        onClick={() => review(img, "rejected")}
                        disabled={rowBusy}
                        aria-label="Reject image as junk"
                        className="inline-flex items-center gap-1 rounded-md bg-rose-500/90 px-2 py-1 text-[10px] font-semibold text-rose-950 hover:bg-rose-400 disabled:opacity-60"
                      >
                        {rowBusy ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
                        Junk
                      </button>
                    ) : null}
                  </div>
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
