import {
  Brush,
  Code2,
  Eraser,
  Loader2,
  MessageSquareText,
  Play,
  Trash2,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface MaskConfiguratorProps {
  /** Delivery URL of the stage image to paint a mask over. */
  imageUrl: string;
  /** Injected runner — the page wires the actual upload + POST /api/render/stage. */
  onRunStage: (args: {
    prompt: string;
    configJson: string | null;
    maskBlob: Blob | null;
  }) => void | Promise<void>;
  /** Disables interaction while a pipeline step is running. */
  running?: boolean;
  className?: string;
}

type Tool = "draw" | "erase";
type InputMode = "prompt" | "json";

const BRUSH_RADIUS = 18;

/**
 * MaskConfigurator — an HTML5 <canvas> over the selected stage image to paint a
 * white-on-black inpainting mask (Draw / Erase + Clear), beside a Textarea that
 * toggles natural-language prompt vs JSON config. On submit, the mask canvas is
 * exported via toBlob and handed to the injected onRunStage prop along with the
 * prompt / config.
 */
export function MaskConfigurator({
  imageUrl,
  onRunStage,
  running = false,
  className,
}: MaskConfiguratorProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Visible overlay (semi-transparent paint the user sees).
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  // Hidden export canvas (true white-on-black mask at display resolution).
  const maskRef = useRef<HTMLCanvasElement | null>(null);

  const [tool, setTool] = useState<Tool>("draw");
  const [mode, setMode] = useState<InputMode>("prompt");
  const [prompt, setPrompt] = useState("");
  const [configJson, setConfigJson] = useState(
    '{\n  "swatches": [],\n  "textures": [],\n  "layout": []\n}',
  );
  const [painting, setPainting] = useState(false);
  const [hasMask, setHasMask] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const syncSizes = useCallback(() => {
    const img = imgRef.current;
    const overlay = overlayRef.current;
    const mask = maskRef.current;
    if (!img || !overlay || !mask) return;
    const width = img.clientWidth;
    const height = img.clientHeight;
    if (width <= 0 || height <= 0) return;
    for (const canvas of [overlay, mask]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    // Re-prime the mask backdrop to black after any resize.
    const maskCtx = mask.getContext("2d");
    if (maskCtx && !hasMask) {
      maskCtx.fillStyle = "#000";
      maskCtx.fillRect(0, 0, mask.width, mask.height);
    }
  }, [hasMask]);

  useEffect(() => {
    const onResize = () => syncSizes();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [syncSizes]);

  const pointFromEvent = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const overlay = overlayRef.current;
      if (!overlay) return { x: 0, y: 0 };
      const bounds = overlay.getBoundingClientRect();
      return {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
    },
    [],
  );

  const paintAt = useCallback(
    (x: number, y: number) => {
      const overlay = overlayRef.current;
      const mask = maskRef.current;
      if (!overlay || !mask) return;
      const overlayCtx = overlay.getContext("2d");
      const maskCtx = mask.getContext("2d");
      if (!overlayCtx || !maskCtx) return;

      if (tool === "draw") {
        // Visible blue-tinted paint.
        overlayCtx.globalCompositeOperation = "source-over";
        overlayCtx.fillStyle = "rgba(59,130,246,0.45)";
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2);
        overlayCtx.fill();
        // True mask: white on black.
        maskCtx.globalCompositeOperation = "source-over";
        maskCtx.fillStyle = "#fff";
        maskCtx.beginPath();
        maskCtx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2);
        maskCtx.fill();
        setHasMask(true);
      } else {
        // Erase the visible overlay.
        overlayCtx.globalCompositeOperation = "destination-out";
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2);
        overlayCtx.fill();
        // Paint black back into the mask.
        maskCtx.globalCompositeOperation = "source-over";
        maskCtx.fillStyle = "#000";
        maskCtx.beginPath();
        maskCtx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2);
        maskCtx.fill();
      }
    },
    [tool],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0 || running) return;
      syncSizes();
      setPainting(true);
      overlayRef.current?.setPointerCapture(event.pointerId);
      const point = pointFromEvent(event);
      paintAt(point.x, point.y);
    },
    [paintAt, pointFromEvent, running, syncSizes],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!painting) return;
      const point = pointFromEvent(event);
      paintAt(point.x, point.y);
    },
    [painting, paintAt, pointFromEvent],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const overlay = overlayRef.current;
      if (overlay?.hasPointerCapture(event.pointerId)) {
        overlay.releasePointerCapture(event.pointerId);
      }
      setPainting(false);
    },
    [],
  );

  const clearMask = useCallback(() => {
    const overlay = overlayRef.current;
    const mask = maskRef.current;
    if (overlay) {
      const ctx = overlay.getContext("2d");
      ctx?.clearRect(0, 0, overlay.width, overlay.height);
    }
    if (mask) {
      const ctx = mask.getContext("2d");
      if (ctx) {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, mask.width, mask.height);
      }
    }
    setHasMask(false);
  }, []);

  const validateJson = useCallback((value: string): boolean => {
    try {
      JSON.parse(value);
      setJsonError(null);
      return true;
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Invalid JSON");
      return false;
    }
  }, []);

  const exportMaskBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const mask = maskRef.current;
      if (!mask || !hasMask) {
        resolve(null);
        return;
      }
      mask.toBlob((blob) => resolve(blob), "image/png");
    });
  }, [hasMask]);

  const handleRun = useCallback(async () => {
    if (mode === "prompt" && !prompt.trim()) {
      toast.error("Enter a prompt for this pipeline step");
      return;
    }
    if (mode === "json" && !validateJson(configJson)) {
      toast.error("Fix the JSON config before running");
      return;
    }
    const maskBlob = await exportMaskBlob();
    await onRunStage({
      prompt: mode === "prompt" ? prompt.trim() : "",
      configJson: mode === "json" ? configJson : null,
      maskBlob,
    });
  }, [configJson, exportMaskBlob, mode, onRunStage, prompt, validateJson]);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Inpainting Mask
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={tool === "draw" ? "default" : "outline"}
              size="sm"
              onClick={() => setTool("draw")}
              disabled={running}
            >
              <Brush className="mr-1.5 size-3.5" />
              Draw
            </Button>
            <Button
              type="button"
              variant={tool === "erase" ? "default" : "outline"}
              size="sm"
              onClick={() => setTool("erase")}
              disabled={running}
            >
              <Eraser className="mr-1.5 size-3.5" />
              Erase
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearMask}
              disabled={running || !hasMask}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Clear
            </Button>
          </div>
        </div>

        <div className="relative w-full overflow-hidden rounded-xl bg-muted/30 ring-1 ring-border/40">
          {imageUrl ? (
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Stage image"
              className="block w-full select-none object-contain"
              draggable={false}
              onLoad={() => syncSizes()}
            />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center text-sm text-muted-foreground">
              Select a stage image to mask
            </div>
          )}
          <canvas
            ref={overlayRef}
            className={cn(
              "absolute inset-0 size-full touch-none",
              running ? "cursor-not-allowed" : "cursor-crosshair",
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          {/* Hidden true-mask canvas, exported on submit. */}
          <canvas ref={maskRef} className="hidden" />
        </div>
        <p className="text-xs text-muted-foreground">
          Paint the regions to regenerate. White areas are edited; the rest is
          preserved.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Instruction
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={mode === "prompt" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("prompt")}
              disabled={running}
            >
              <MessageSquareText className="mr-1.5 size-3.5" />
              Prompt
            </Button>
            <Button
              type="button"
              variant={mode === "json" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("json")}
              disabled={running}
            >
              <Code2 className="mr-1.5 size-3.5" />
              JSON
            </Button>
          </div>
        </div>

        {mode === "prompt" ? (
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            placeholder="Replace only the masked vanity with a walnut finish; preserve walls, windows, floor, and camera angle."
          />
        ) : (
          <div className="space-y-1">
            <Textarea
              value={configJson}
              onChange={(event) => {
                setConfigJson(event.target.value);
                validateJson(event.target.value);
              }}
              rows={6}
              className="font-mono text-xs"
              spellCheck={false}
            />
            {jsonError && (
              <p className="text-xs text-destructive">{jsonError}</p>
            )}
          </div>
        )}
      </div>

      <Button
        className="w-full gap-2"
        onClick={handleRun}
        disabled={running}
      >
        {running ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        Execute Pipeline Step
      </Button>
    </div>
  );
}

export default MaskConfigurator;
