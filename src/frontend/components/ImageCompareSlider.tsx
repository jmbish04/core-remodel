import React, { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

interface ImageCompareSliderProps {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
  defaultValue?: number;
  className?: string;
  aspectClassName?: string;
}

export function ImageCompareSlider(props: ImageCompareSliderProps) {
  const {
    beforeSrc,
    afterSrc,
    beforeLabel = "Before",
    afterLabel = "After",
    defaultValue = 50,
    className,
    aspectClassName,
  } = props;

  const [position, setPosition] = useState(Math.min(95, Math.max(5, defaultValue)));
  const sliderId = useId();
  const clipPath = useMemo(() => `inset(0 ${100 - position}% 0 0)`, [position]);

  return (
    <figure className={cn("space-y-3", className)}>
      <div
        className={cn(
          "relative overflow-hidden rounded-xl ring-1 ring-border/40",
          aspectClassName || "aspect-[4/3]",
        )}
      >
        {/* biome-ignore lint/performance/noImgElement: Cloudflare Images URLs are dynamic and should render directly */}
        <img
          src={beforeSrc}
          alt={beforeLabel}
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
        />
        {/* biome-ignore lint/performance/noImgElement: Cloudflare Images URLs are dynamic and should render directly */}
        <img
          src={afterSrc}
          alt={afterLabel}
          className="absolute inset-0 size-full object-cover"
          style={{ clipPath }}
          loading="lazy"
        />

        <div
          className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.2)]"
          style={{ left: `${position}%` }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white px-2 py-1 text-[10px] font-semibold tracking-wide text-black shadow"
          style={{ left: `${position}%` }}
          aria-hidden
        >
          DIFF
        </div>

        <span className="absolute left-2 top-2 rounded bg-black/55 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-white">
          {beforeLabel}
        </span>
        <span className="absolute right-2 top-2 rounded bg-black/55 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-white">
          {afterLabel}
        </span>
      </div>

      <div className="space-y-1">
        <label htmlFor={sliderId} className="text-xs text-muted-foreground">
          Drag to compare
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          className="w-full accent-foreground"
        />
      </div>
    </figure>
  );
}
