import {
  GripVertical,
  ImageOff,
  Layers,
  Loader2,
  Sparkles,
  Anchor,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { InspirationReference, RenderCanvas } from "./types";

interface InspoSortWorkspaceProps {
  /** Optional session id, forwarded to /api/render/synthesize. */
  sessionId?: string;
  /** The fixed @image1 anchor (the working/base canvas). */
  baseCanvas: Pick<
    RenderCanvas,
    "id" | "outputImageUrl" | "outputCfImageId" | "aiTitle"
  >;
  /** Inspiration chips to order. */
  references: InspirationReference[];
  /** Optional callback after a successful synthesize call. */
  onSynthesized?: (canvas: RenderCanvas) => void;
}

interface SynthesizeResponse {
  canvas?: RenderCanvas;
  error?: string;
}

function chipImageUrl(ref: InspirationReference): string {
  return ref.extractedImageUrl || ref.imageUrl || "";
}

/**
 * InspoSortWorkspace (Stage 5) — reorderable list of inspiration chips using
 * NATIVE HTML5 drag-and-drop (no npm dependency). The base canvas is a fixed
 * "@image1" anchor row; inspiration chips show live "@image{index+2}" tags. A
 * prompt textarea + Execute button POST the ordered refs to
 * /api/render/synthesize.
 */
export function InspoSortWorkspace({
  sessionId,
  baseCanvas,
  references,
  onSynthesized,
}: InspoSortWorkspaceProps) {
  const [ordered, setOrdered] = useState<InspirationReference[]>(references);
  const [prompt, setPrompt] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const baseUrl = useMemo(
    () => baseCanvas.outputImageUrl || baseCanvas.outputCfImageId || "",
    [baseCanvas],
  );

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLLIElement>, index: number) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOverIndex(index);
    },
    [],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLIElement>, dropIndex: number) => {
      event.preventDefault();
      setOverIndex(null);
      setDragIndex(null);
      if (dragIndex === null || dragIndex === dropIndex) return;
      setOrdered((current) => {
        const next = [...current];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(dropIndex, 0, moved);
        return next;
      });
    },
    [dragIndex],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  const handleExecute = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error("Add a synthesis prompt first");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/render/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          baseCanvasId: baseCanvas.id,
          prompt: prompt.trim(),
          inspirationReferences: ordered.map((ref, index) => ({
            inspirationImageId: ref.inspirationImageId,
            // base canvas is @image1 (index 0); refs start at index 1.
            referenceIndex: index + 1,
          })),
        }),
      });
      const payload = (await response.json()) as SynthesizeResponse;
      if (!response.ok || !payload.canvas) {
        throw new Error(payload.error ?? "Failed to synthesize");
      }
      toast.success("Synthesis queued");
      onSynthesized?.(payload.canvas);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to synthesize");
    } finally {
      setSubmitting(false);
    }
  }, [baseCanvas.id, onSynthesized, ordered, prompt, sessionId]);

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-border/40">
      <div className="flex items-center gap-2">
        <Layers className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Inspiration Synthesis</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          Drag to reorder · sets @image index
        </span>
      </div>

      {/* Fixed @image1 anchor — the base/working canvas. */}
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 bg-background px-3 py-2">
        <Anchor className="size-4 shrink-0 text-blue-400" />
        <div className="size-12 shrink-0 overflow-hidden rounded-md bg-muted/40 ring-1 ring-border/30">
          {baseUrl ? (
            <img
              src={baseUrl}
              alt={baseCanvas.aiTitle || "Base canvas"}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <ImageOff className="size-4" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {baseCanvas.aiTitle || "Working canvas"}
          </p>
          <p className="text-xs text-muted-foreground">Anchored base image</p>
        </div>
        <span className="rounded bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-300">
          @image1
        </span>
      </div>

      {/* Reorderable inspiration chips. */}
      {ordered.length === 0 ? (
        <p className="rounded-lg border border-border/40 px-3 py-6 text-center text-xs text-muted-foreground">
          No inspiration references to order yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((ref, index) => {
            const url = chipImageUrl(ref);
            const isDragging = dragIndex === index;
            const isOver = overIndex === index && dragIndex !== index;
            return (
              <li
                key={ref.inspirationImageId}
                draggable={!submitting}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(event) => handleDragOver(event, index)}
                onDrop={(event) => handleDrop(event, index)}
                onDragEnd={handleDragEnd}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border/40 bg-background px-3 py-2 transition",
                  !submitting && "cursor-grab active:cursor-grabbing",
                  isDragging && "opacity-50",
                  isOver && "ring-2 ring-blue-500/60",
                )}
              >
                <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                <div className="size-12 shrink-0 overflow-hidden rounded-md bg-muted/40 ring-1 ring-border/30">
                  {url ? (
                    <img
                      src={url}
                      alt={ref.label || "Inspiration"}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <ImageOff className="size-4" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {ref.label || "Inspiration reference"}
                  </p>
                  {ref.extractionNotes && (
                    <p className="truncate text-xs text-muted-foreground">
                      {ref.extractionNotes}
                    </p>
                  )}
                </div>
                <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-foreground">
                  @image{index + 2}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2">
        <label
          htmlFor="synthesize-prompt"
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Synthesis Prompt
        </label>
        <Textarea
          id="synthesize-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder="Compose @image1 using the cabinet finish from @image2 and the counter veining from @image3..."
        />
      </div>

      <Button
        className="w-full gap-2"
        onClick={handleExecute}
        disabled={submitting}
      >
        {submitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        Execute Synthesis
      </Button>
    </div>
  );
}

export default InspoSortWorkspace;
