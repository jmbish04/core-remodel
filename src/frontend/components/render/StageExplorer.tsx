import { ArrowRight, ImageOff, Layers3 } from "lucide-react";
import React, { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  STAGE_BUCKET_LABEL,
  type RenderCanvas,
  type StageBucket,
  resolveCfImageUrl,
  stageBucketForType,
} from "./types";

const STAGE_ORDER: StageBucket[] = ["stage_0", "stage_1", "stage_2", "stage_3"];

interface StageExplorerProps {
  /** All canvases for the selected angle/session. */
  canvases: RenderCanvas[];
  selectedStage: StageBucket;
  onSelectStage: (stage: StageBucket) => void;
  /** Optional: highlight a specific canvas node. */
  selectedCanvasId?: string | null;
  onSelectCanvas?: (canvasId: string) => void;
  className?: string;
}

/**
 * StageExplorer — a horizontal timeline of stages stage_0..stage_3. Clicking a
 * stage selects that bucket and lists its canvases (startingImageUrl,
 * outputImageUrl, aiTitle) supplied via props.
 */
export function StageExplorer({
  canvases,
  selectedStage,
  onSelectStage,
  selectedCanvasId,
  onSelectCanvas,
  className,
}: StageExplorerProps) {
  const byStage = useMemo(() => {
    const map: Record<StageBucket, RenderCanvas[]> = {
      stage_0: [],
      stage_1: [],
      stage_2: [],
      stage_3: [],
    };
    for (const canvas of canvases) {
      const bucket = stageBucketForType(canvas.type);
      if (bucket) map[bucket].push(canvas);
    }
    return map;
  }, [canvases]);

  const stageCanvases = byStage[selectedStage];

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2">
        <Layers3 className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Stage Timeline</h3>
      </div>

      {/* Horizontal timeline */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STAGE_ORDER.map((stage, index) => {
          const count = byStage[stage].length;
          const isActive = selectedStage === stage;
          return (
            <React.Fragment key={stage}>
              <button
                type="button"
                onClick={() => onSelectStage(stage)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-border/40 transition",
                  isActive
                    ? "bg-primary/10 text-foreground ring-2 ring-primary"
                    : "bg-card text-muted-foreground hover:bg-muted/30",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {index}
                </span>
                <span className="font-medium">{STAGE_BUCKET_LABEL[stage]}</span>
                <Badge variant="outline" className="text-[10px] tabular-nums">
                  {count}
                </Badge>
              </button>
              {index < STAGE_ORDER.length - 1 && (
                <ArrowRight className="size-4 shrink-0 text-muted-foreground/50" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Canvases for the selected stage */}
      {stageCanvases.length === 0 ? (
        <p className="rounded-lg border border-border/40 px-3 py-6 text-center text-xs text-muted-foreground">
          No {STAGE_BUCKET_LABEL[selectedStage].toLowerCase()} canvases yet.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stageCanvases.map((canvas) => {
            const startUrl = resolveCfImageUrl(canvas.startingImageUrl || "");
            const outputUrl = resolveCfImageUrl(
              canvas.outputImageUrl || canvas.outputCfImageId || "",
            );
            const isSelected = selectedCanvasId === canvas.id;
            const clickable = Boolean(onSelectCanvas);
            return (
              <button
                key={canvas.id}
                type="button"
                disabled={!clickable}
                onClick={() => onSelectCanvas?.(canvas.id)}
                className={cn(
                  "overflow-hidden rounded-lg bg-card text-left ring-1 ring-border/40 transition",
                  clickable && "hover:ring-border",
                  isSelected && "ring-2 ring-primary",
                  !clickable && "cursor-default",
                )}
              >
                <div className="grid grid-cols-2">
                  <div className="relative aspect-square bg-muted/30">
                    {startUrl ? (
                      <img
                        src={startUrl}
                        alt="Starting image"
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground">
                        <ImageOff className="size-4" />
                      </div>
                    )}
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white">
                      In
                    </span>
                  </div>
                  <div className="relative aspect-square bg-muted/30">
                    {outputUrl ? (
                      <img
                        src={outputUrl}
                        alt="Output image"
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground">
                        <ImageOff className="size-4" />
                      </div>
                    )}
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white">
                      Out
                    </span>
                  </div>
                </div>
                <div className="space-y-1 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-medium">
                      {canvas.aiTitle || "Untitled stage"}
                    </p>
                    {canvas.branchLabel && (
                      <Badge variant="secondary" className="text-[9px]">
                        {canvas.branchLabel}
                      </Badge>
                    )}
                  </div>
                  {canvas.prompt && (
                    <p className="line-clamp-2 text-[11px] text-muted-foreground">
                      {canvas.prompt}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StageExplorer;
