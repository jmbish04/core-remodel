import React, { useState, useRef, useEffect, useId } from "react";
import { ChevronsLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ImageComparisonProps {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
  defaultValue?: number;
  className?: string;
  aspectClassName?: string;
  onChange?: (value: number) => void;
}

export function ImageComparison(props: ImageComparisonProps) {
  const {
    beforeSrc,
    afterSrc,
    beforeLabel = "Original",
    afterLabel = "AI Render",
    defaultValue = 50,
    className,
    aspectClassName,
    onChange,
  } = props;

  const [position, setPosition] = useState(Math.min(98, Math.max(2, defaultValue)));
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const sliderId = useId();

  // Handle keyboard arrow keys
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPosition((prev) => {
        const next = Math.max(2, prev - 2);
        if (onChange) onChange(next);
        return next;
      });
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPosition((prev) => {
        const next = Math.min(98, prev + 2);
        if (onChange) onChange(next);
        return next;
      });
    }
  };

  const updatePosition = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.min(98, Math.max(2, (x / rect.width) * 100));
    setPosition(percentage);
    if (onChange) onChange(percentage);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Left click only
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updatePosition(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    updatePosition(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  };

  const clipPath = `inset(0 ${100 - position}% 0 0)`;

  return (
    <div className={cn("space-y-3", className)}>
      <div
        ref={containerRef}
        id={sliderId}
        role="slider"
        aria-label="Image comparison slider"
        aria-valuenow={position}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setIsDragging(false)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          setIsDragging(false);
        }}
        className={cn(
          "relative select-none overflow-hidden rounded-2xl border border-border/40 shadow-2xl bg-muted/20 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          aspectClassName || "aspect-[4/3] w-full",
          isDragging ? "cursor-grabbing" : "cursor-ew-resize"
        )}
        style={{ touchAction: "none" }}
      >
        {/* Underlay Image: After */}
        {/* biome-ignore lint/performance/noImgElement: Cloudflare Images URLs are dynamic */}
        <img
          src={afterSrc}
          alt={afterLabel}
          className="absolute inset-0 size-full object-cover select-none pointer-events-none"
          loading="lazy"
        />

        {/* Overlay Image: Before (Clipped) */}
        {/* biome-ignore lint/performance/noImgElement: Cloudflare Images URLs are dynamic */}
        <img
          src={beforeSrc}
          alt={beforeLabel}
          className="absolute inset-0 size-full object-cover select-none pointer-events-none"
          style={{ clipPath }}
          loading="lazy"
        />

        {/* Vertical Divider line */}
        <div
          className={cn(
            "absolute inset-y-0 z-10 w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)] transition-all duration-75 pointer-events-none",
            isDragging || isHovered ? "bg-white" : "bg-white/80"
          )}
          style={{ left: `${position}%` }}
        >
          {/* Slider Handle */}
          <div
            className={cn(
              "absolute top-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 z-20 flex size-10 items-center justify-center rounded-full border-[3px] border-white bg-slate-950/80 backdrop-blur text-white shadow-2xl transition-transform duration-200 pointer-events-none",
              isDragging ? "scale-110 rotate-12" : "",
              isHovered && !isDragging ? "scale-105" : ""
            )}
          >
            <ChevronsLeftRight className="size-4 animate-pulse" />
          </div>
        </div>

        {/* Overlay Labels */}
        <div
          className={cn(
            "absolute bottom-4 left-4 z-20 rounded-lg bg-slate-950/70 border border-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white backdrop-blur transition-opacity duration-300 pointer-events-none",
            isDragging ? "opacity-20" : "opacity-100"
          )}
        >
          {beforeLabel}
        </div>
        <div
          className={cn(
            "absolute bottom-4 right-4 z-20 rounded-lg bg-slate-950/70 border border-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white backdrop-blur transition-opacity duration-300 pointer-events-none",
            isDragging ? "opacity-20" : "opacity-100"
          )}
        >
          {afterLabel}
        </div>
      </div>
    </div>
  );
}
