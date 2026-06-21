import { Check, Eraser, Loader2, MousePointerSquareDashed } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { BoundingBox, ExtractPayload } from "./types";

interface InspirationCanvasProps {
  /** Image record id used as inspirationImageId in the extract payload. */
  inspirationImageId: string;
  /** Delivery URL of the inspiration image to draw on. */
  imageUrl: string;
  /** Called on submit with the box converted to **source pixels**. */
  onExtract: (payload: ExtractPayload) => void | Promise<void>;
  /** Disables interaction + buttons (e.g. while a request is in flight). */
  submitting?: boolean;
  className?: string;
}

interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * InspirationCanvas — an <img> with an HTML5 <canvas> overlay. Click-drag to
 * draw ONE bounding box, then Submit to extract that region. Display
 * coordinates are scaled to source pixels via naturalWidth/clientWidth before
 * being handed to onExtract.
 */
export function InspirationCanvas({
  inspirationImageId,
  imageUrl,
  onExtract,
  submitting = false,
  className,
}: InspirationCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [drawing, setDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [rect, setRect] = useState<DisplayRect | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(
    null,
  );

  // Keep the overlay canvas pixel-matched to the rendered image size so the
  // drawn box lines up exactly with what the user sees.
  const syncCanvasSize = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const width = img.clientWidth;
    const height = img.clientHeight;
    if (width <= 0 || height <= 0) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    // Dim everything outside the selection, then outline the selection.
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgb(59,130,246)"; // blue-500
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }, [rect]);

  useEffect(() => {
    syncCanvasSize();
    redraw();
  }, [redraw, syncCanvasSize]);

  useEffect(() => {
    const onResize = () => {
      syncCanvasSize();
      redraw();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redraw, syncCanvasSize]);

  const pointFromEvent = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const bounds = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(canvas.width, event.clientX - bounds.left));
      const y = Math.max(0, Math.min(canvas.height, event.clientY - bounds.top));
      return { x, y };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0 || submitting) return;
      syncCanvasSize();
      const point = pointFromEvent(event);
      setStartPoint(point);
      setRect({ x: point.x, y: point.y, width: 0, height: 0 });
      setDrawing(true);
      canvasRef.current?.setPointerCapture(event.pointerId);
    },
    [pointFromEvent, submitting, syncCanvasSize],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing || !startPoint) return;
      const point = pointFromEvent(event);
      setRect({
        x: Math.min(startPoint.x, point.x),
        y: Math.min(startPoint.y, point.y),
        width: Math.abs(point.x - startPoint.x),
        height: Math.abs(point.y - startPoint.y),
      });
    },
    [drawing, pointFromEvent, startPoint],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      setDrawing(false);
    },
    [],
  );

  const handleClear = useCallback(() => {
    setRect(null);
    setStartPoint(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !rect || rect.width < 2 || rect.height < 2 || !naturalSize) {
      return;
    }
    // Scale display coords -> source pixels.
    const scaleX = naturalSize.w / canvas.width;
    const scaleY = naturalSize.h / canvas.height;
    const sourceBox: BoundingBox = {
      x: Math.round(rect.x * scaleX),
      y: Math.round(rect.y * scaleY),
      width: Math.round(rect.width * scaleX),
      height: Math.round(rect.height * scaleY),
    };
    await onExtract({
      inspirationImageId,
      referencedRegionBoundingBox: sourceBox,
    });
  }, [inspirationImageId, naturalSize, onExtract, rect]);

  const hasSelection = Boolean(rect && rect.width >= 2 && rect.height >= 2);

  return (
    <div className={cn("space-y-3", className)}>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl bg-muted/30 ring-1 ring-border/40"
      >
        {imageUrl ? (
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Inspiration source"
            className="block w-full select-none object-contain"
            draggable={false}
            onLoad={(event) => {
              const target = event.currentTarget;
              setNaturalSize({
                w: target.naturalWidth,
                h: target.naturalHeight,
              });
              syncCanvasSize();
              redraw();
            }}
          />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center text-sm text-muted-foreground">
            No inspiration image
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={cn(
            "absolute inset-0 size-full touch-none",
            submitting ? "cursor-not-allowed" : "cursor-crosshair",
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MousePointerSquareDashed className="size-3.5" />
          Click-drag to select one region.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={!hasSelection || submitting}
          >
            <Eraser className="mr-1.5 size-3.5" />
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={!hasSelection || submitting}
          >
            {submitting ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Check className="mr-1.5 size-3.5" />
            )}
            Extract Region
          </Button>
        </div>
      </div>
    </div>
  );
}

export default InspirationCanvas;
