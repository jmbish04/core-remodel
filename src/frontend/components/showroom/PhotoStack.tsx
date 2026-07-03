/**
 * @fileoverview PhotoStack — a Monolith photo-stack chip.
 *
 * The first image sits on top in a rounded card; up to two more peek from
 * behind (rotated + offset) like a loose pile of prints, with a small count
 * chip ("N photos"). Built to float over the store hero banner. Clicking the
 * stack calls `onClick` (opens the gallery theater).
 *
 * Native reimplementation of the vendored Next.js `card16` reference — plain
 * `<img>` with graceful onError (no next/image), Monolith dark styling, no 1px
 * borders (ring-1 ring-border/40 + bg-card).
 */

import { useState } from "react";

import { cn } from "@/lib/utils";

interface PhotoStackProps {
  /** Photo URLs; the first is on top, up to two more peek from behind. */
  images: string[];
  /** Count chip label (e.g. "24 photos"). */
  count?: string;
  /** Fired when the stack is clicked/activated. */
  onClick?: () => void;
  /** Additional classes merged onto the root. */
  className?: string;
}

/** A single tucked/peeking print behind the top card. */
function PeekLayer({
  src,
  className,
}: {
  src: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute inset-0 overflow-hidden rounded-xl bg-card shadow-md ring-1 ring-border/40",
        className,
      )}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    </span>
  );
}

/** The top card image with graceful fallback and the count chip. */
function TopCard({ src, count }: { src: string; count?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="absolute inset-0 overflow-hidden rounded-xl bg-card shadow-lg ring-1 ring-border/40 transition-transform duration-500 ease-out motion-safe:group-hover/stack:scale-[1.02]">
      {failed ? (
        <span className="flex size-full items-center justify-center bg-muted/40 text-[10px] font-medium text-muted-foreground">
          No preview
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
      {/* Bottom scrim keeps the count chip legible over any image. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"
      />
      {count ? (
        <span className="absolute inset-x-0 bottom-0 flex justify-center p-1.5 text-[11px] font-semibold tracking-tight text-white">
          {count}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Photo-stack chip. Renders as a button when `onClick` is set so it's keyboard
 * accessible; otherwise a plain presentational stack.
 */
export function PhotoStack({ images, count, onClick, className }: PhotoStackProps) {
  const [top, second, third] = images;
  if (!top) return null;

  const inner = (
    <>
      {third ? (
        <PeekLayer
          src={third}
          className="rotate-6 transition-transform duration-500 ease-out motion-safe:group-hover/stack:rotate-[10deg] motion-safe:group-hover/stack:translate-x-2"
        />
      ) : null}
      {second ? (
        <PeekLayer
          src={second}
          className="-rotate-3 transition-transform duration-500 ease-out motion-safe:group-hover/stack:-rotate-6 motion-safe:group-hover/stack:-translate-x-2"
        />
      ) : null}
      <TopCard src={top} count={count} />
    </>
  );

  const classes = cn(
    "group/stack relative block aspect-square size-20 sm:size-24",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={count ? `Open gallery — ${count}` : "Open photo gallery"}
        className={cn(
          classes,
          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        {inner}
      </button>
    );
  }

  return <div className={classes}>{inner}</div>;
}
