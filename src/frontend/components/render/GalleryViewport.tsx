import { ImageOff, Images, Loader2, Sparkles } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  type InspirationReference,
  type NormalizedBox,
  type RenderCanvas,
  normalizeBox,
  resolveCfImageUrl,
} from "./types";

interface GalleryViewportProps {
  /** Optional server-loaded active render; otherwise fetched from the API. */
  activeCanvas?: RenderCanvas | null;
  /** Optional server-loaded inspiration refs; otherwise fetched from the API. */
  inspirationReferences?: InspirationReference[];
  /** Canvas id to fetch from GET /api/render/canvases/:id when not provided. */
  canvasId?: string;
}

interface CanvasApiResponse {
  canvas?: RenderCanvas;
  lineage?: RenderCanvas[];
  inspirationRefs?: Array<{
    inspirationImageId: string;
    imageUrl?: string | null;
    cfImageId?: string | null;
    extractedCfImageId?: string | null;
    extractedImageUrl?: string | null;
    referencedRegionBoundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    sourceWidth?: number | null;
    sourceHeight?: number | null;
    extractionNotes?: string | null;
    referenceIndex?: number | null;
    label?: string | null;
  }>;
}

function ensureNormalizedBox(
  ref: InspirationReference,
  apiSourceWidth?: number | null,
  apiSourceHeight?: number | null,
): NormalizedBox | null {
  if (ref.normalizedBox) return ref.normalizedBox;
  if (!ref.referencedRegionBoundingBox) return null;
  // If we have true source dimensions, normalize against them; otherwise the
  // box is assumed to already be in a ~1000 space and is passed through.
  if (apiSourceWidth && apiSourceHeight) {
    return normalizeBox(
      ref.referencedRegionBoundingBox,
      apiSourceWidth,
      apiSourceHeight,
    );
  }
  return null;
}

/**
 * GalleryViewport — two-column split. Left (2/3) shows the active stage_3
 * render. Right (1/3) is a scrolling list of inspiration-reference chips.
 * Hovering a chip overlays a bounding-box highlight ON THAT INSPIRATION IMAGE
 * (never the render), using a CSS punch-out + blue outline positioned with
 * percentages derived from a box normalized to a 1000x1000 grid.
 */
export function GalleryViewport({
  activeCanvas: activeCanvasProp,
  inspirationReferences: refsProp,
  canvasId,
}: GalleryViewportProps) {
  const [activeCanvas, setActiveCanvas] = useState<RenderCanvas | null>(
    activeCanvasProp ?? null,
  );
  const [references, setReferences] = useState<InspirationReference[]>(
    refsProp ?? [],
  );
  const [loading, setLoading] = useState(
    !activeCanvasProp && Boolean(canvasId),
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const loadCanvas = useCallback(async () => {
    if (!canvasId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/render/canvases/${canvasId}`);
      const payload = (await response.json()) as CanvasApiResponse;
      if (!response.ok || !payload.canvas) {
        throw new Error("Failed to load canvas");
      }
      setActiveCanvas(payload.canvas);
      const mapped: InspirationReference[] = (payload.inspirationRefs ?? []).map(
        (ref) => {
          const imageUrl = resolveCfImageUrl(
            ref.imageUrl || ref.cfImageId || "",
          );
          const extractedImageUrl = resolveCfImageUrl(
            ref.extractedImageUrl || ref.extractedCfImageId || "",
          );
          const base: InspirationReference = {
            inspirationImageId: ref.inspirationImageId,
            imageUrl,
            extractedImageUrl: extractedImageUrl || null,
            referencedRegionBoundingBox: ref.referencedRegionBoundingBox ?? null,
            extractionNotes: ref.extractionNotes ?? null,
            referenceIndex: ref.referenceIndex ?? undefined,
            label: ref.label ?? null,
          };
          return {
            ...base,
            normalizedBox: ensureNormalizedBox(
              base,
              ref.sourceWidth,
              ref.sourceHeight,
            ),
          };
        },
      );
      setReferences(mapped);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load gallery");
    } finally {
      setLoading(false);
    }
  }, [canvasId]);

  useEffect(() => {
    if (!activeCanvasProp && canvasId) {
      void loadCanvas();
    }
  }, [activeCanvasProp, canvasId, loadCanvas]);

  const renderUrl = useMemo(
    () =>
      activeCanvas
        ? resolveCfImageUrl(
            activeCanvas.outputImageUrl || activeCanvas.outputCfImageId || "",
          )
        : "",
    [activeCanvas],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left 2/3 — active render */}
      <div className="lg:col-span-2">
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
          <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">
                {activeCanvas?.aiTitle || "Active Render"}
              </h2>
            </div>
            {activeCanvas?.branchLabel && (
              <Badge variant="secondary" className="text-[10px]">
                Branch {activeCanvas.branchLabel}
              </Badge>
            )}
          </div>
          <div className="relative flex min-h-[20rem] items-center justify-center bg-muted/20">
            {loading ? (
              <div className="flex items-center gap-2 py-24 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading render...
              </div>
            ) : renderUrl ? (
              <img
                src={renderUrl}
                alt={activeCanvas?.aiTitle || "Stage 3 render"}
                className="max-h-[70vh] w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 py-24 text-center text-sm text-muted-foreground">
                <ImageOff className="size-6" />
                No finished render selected yet.
              </div>
            )}
          </div>
          {activeCanvas?.prompt && (
            <div className="border-t border-border/40 px-4 py-3">
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {activeCanvas.prompt}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Right 1/3 — inspiration chip rail */}
      <div className="lg:col-span-1">
        <div className="flex h-full flex-col rounded-xl bg-card ring-1 ring-border/40">
          <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
            <Images className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Inspiration References</h2>
            <Badge variant="outline" className="ml-auto text-[10px] tabular-nums">
              {references.length}
            </Badge>
          </div>
          <div className="max-h-[70vh] flex-1 space-y-3 overflow-y-auto p-3">
            {references.length === 0 ? (
              <p className="px-1 py-8 text-center text-xs text-muted-foreground">
                No inspiration references attached to this render.
              </p>
            ) : (
              references.map((ref) => {
                const isHovered = hoveredId === ref.inspirationImageId;
                const box = ref.normalizedBox;
                return (
                  <div
                    key={ref.inspirationImageId}
                    className={cn(
                      "group overflow-hidden rounded-lg bg-background ring-1 ring-border/40 transition",
                      isHovered && "ring-2 ring-blue-500/70",
                    )}
                    onMouseEnter={() => setHoveredId(ref.inspirationImageId)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <div className="relative">
                      {ref.imageUrl ? (
                        <img
                          src={ref.imageUrl}
                          alt={ref.label || "Inspiration reference"}
                          className="aspect-[4/3] w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-muted/30 text-xs text-muted-foreground">
                          <ImageOff className="size-5" />
                        </div>
                      )}

                      {/* Hover overlay: CSS punch-out highlighting the referenced
                          region ON THE INSPIRATION IMAGE, positioned from the
                          1000x1000-normalized box. */}
                      {isHovered && box && box.width > 0 && box.height > 0 && (
                        <div
                          className="pointer-events-none absolute rounded-[2px] shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] outline outline-2 outline-blue-500"
                          style={{
                            left: `${(box.x / 1000) * 100}%`,
                            top: `${(box.y / 1000) * 100}%`,
                            width: `${(box.width / 1000) * 100}%`,
                            height: `${(box.height / 1000) * 100}%`,
                          }}
                        />
                      )}

                      {typeof ref.referenceIndex === "number" && (
                        <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          @image{ref.referenceIndex + 1}
                        </span>
                      )}
                    </div>

                    {(ref.label || ref.extractionNotes) && (
                      <div className="space-y-1 px-2.5 py-2">
                        {ref.label && (
                          <p className="truncate text-xs font-medium">
                            {ref.label}
                          </p>
                        )}
                        {ref.extractionNotes && (
                          <p className="line-clamp-2 text-[11px] text-muted-foreground">
                            {ref.extractionNotes}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GalleryViewport;
