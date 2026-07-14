/**
 * @fileoverview MosaicCard — the Pinterest-style board tile used by both the
 * "By Room" grid and the "Collections" grid.
 *
 * Visual: a 2×2 image mosaic drawn from up to four real item thumbnails, an
 * item-count badge, a title, and a subtitle (e.g. "8 items"). Clicking the
 * card invokes `onOpen` (the parent swaps to the detail view for that bucket).
 *
 * Image sourcing is 100% live — thumbnails come from the wishlist items' own
 * denormalized `imageUrl` snapshots. Cells with no image (fewer than four
 * images, or null-image items) render a neutral placeholder tile, never a
 * broken `<img>`.
 *
 * MONOLITH: no 1px borders — the card body uses `ring-1 ring-border/40`; the
 * mosaic cells are separated by the card background showing through a small
 * gap, not borders.
 */

import { ImageOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface MosaicCardProps {
  title: string;
  /** Short subtitle under the title (e.g. "12 items"). */
  subtitle: string;
  /** Total count shown in the corner badge. */
  count: number;
  /**
   * Up to four thumbnail URLs (nulls allowed and rendered as placeholder cells).
   * The parent passes the item images in priority order.
   */
  images: (string | null)[];
  onOpen: () => void;
  /** Optional accent (e.g. an "All rooms" tile gets a distinct treatment). */
  highlight?: boolean;
  /** Optional trailing content in the header (e.g. a collection menu button). */
  headerAccessory?: React.ReactNode;
}

/** A single mosaic cell — image or graceful fallback. */
function Cell({ src, alt }: { src: string | null; alt: string }) {
  return (
    <div className="relative aspect-square overflow-hidden bg-muted/40">
      {src ? (
        <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
          <ImageOff className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

export function MosaicCard({
  title,
  subtitle,
  count,
  images,
  onOpen,
  highlight = false,
  headerAccessory,
}: MosaicCardProps) {
  // Always render exactly four cells for a stable 2×2 grid.
  const cells: (string | null)[] = [
    images[0] ?? null,
    images[1] ?? null,
    images[2] ?? null,
    images[3] ?? null,
  ];

  return (
    <div
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl bg-card ring-1 transition-all",
        highlight
          ? "ring-primary/30 hover:ring-primary/60"
          : "ring-border/40 hover:ring-border/70",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="relative block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open ${title}`}
      >
        <div className="grid grid-cols-2 gap-px bg-border/30">
          {cells.map((src, i) => (
            <Cell key={i} src={src} alt={`${title} item ${i + 1}`} />
          ))}
        </div>
        <Badge className="absolute right-2 top-2 border-0 bg-background/80 text-foreground backdrop-blur">
          {count}
        </Badge>
      </button>

      <div className="flex items-start justify-between gap-2 p-3">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left outline-none"
        >
          <p className="truncate font-medium leading-snug">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </button>
        {headerAccessory}
      </div>
    </div>
  );
}
