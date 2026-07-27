/**
 * @fileoverview 1–5 star control (0032 V2c).
 *
 * Interactive (editor) + read-only (list/timeline) variants of the amber star
 * pattern used by RecordVisitModal — factored out so the workspace and the store
 * section share one control. Value 0/null = unrated.
 */
import { Star } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/** Editable rating; onChange(0) clears (click the active star again). */
export function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const [hover, setHover] = useState(0);
  const active = hover || value;
  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          aria-label={`${i} star${i > 1 ? "s" : ""}`}
          aria-pressed={value === i}
          onMouseEnter={() => setHover(i)}
          onClick={() => onChange(value === i ? 0 : i)}
          className="rounded p-0.5 text-muted-foreground/30 transition-colors hover:text-amber-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        >
          <Star className={cn("size-7 transition-colors", i <= active && "fill-amber-400 text-amber-400")} />
        </button>
      ))}
      {value > 0 && <span className="ml-2 text-sm text-muted-foreground">{value} / 5</span>}
    </div>
  );
}

/** Read-only stars (compact) for list rows + the store timeline. */
export function StarsReadOnly({ rating, className }: { rating: number | null; className?: string }) {
  if (rating == null || rating <= 0) {
    return <span className="text-xs text-muted-foreground/60">Unrated</span>;
  }
  const rounded = Math.round(rating);
  return (
    <div className={cn("flex items-center gap-0.5", className)} aria-label={`${rating} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn("size-4", i <= rounded ? "fill-amber-400 text-amber-400" : "text-muted-foreground/25")}
        />
      ))}
    </div>
  );
}
