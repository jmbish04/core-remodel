/**
 * @fileoverview Shared presentational bits for the wishlist surface:
 * loading skeletons and empty states, so the tabs/detail views stay lean.
 *
 * MONOLITH: skeletons use `bg-muted/50` shimmer blocks and `ring-1
 * ring-border/40` framing — no borders, no spinners-only screens.
 */

import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

/** A grid of shimmering mosaic-card placeholders while a tab loads. */
export function MosaicGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-xl bg-card ring-1 ring-border/40"
        >
          <div className="grid grid-cols-2 gap-px bg-border/30">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="aspect-square animate-pulse bg-muted/50" />
            ))}
          </div>
          <div className="space-y-2 p-3">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted/50" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A list of shimmering item-row placeholders while a detail view loads. */
export function ItemListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex gap-3 rounded-xl bg-card p-3 ring-1 ring-border/40"
        >
          <div className="h-20 w-20 shrink-0 animate-pulse rounded-lg bg-muted/50" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted/50" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted/40" />
            <div className="h-6 w-2/3 animate-pulse rounded bg-muted/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A centered empty state with an icon, heading, and optional hint + action. */
export function EmptyState({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border/40",
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
        <Sparkles className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}
