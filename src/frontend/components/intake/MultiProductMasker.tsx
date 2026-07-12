/**
 * @fileoverview MultiProductMasker — 0020-C2 Phase 4 masking UI.
 *
 * A wide showroom photo can hold several products. This dialog forks the
 * render/InspirationCanvas drag logic (which only supports ONE box + immediate
 * submit) to *accumulate* N boxes over the same image: each completed drag is
 * pushed into `regions[]`, overlaid on the photo, and given an optional label.
 *
 * Coordinate conversion mirrors workshop/ExtractClippingDialog exactly:
 * display-px → source-px (scale by naturalSize / canvasSize) → normalized 0..1
 * (divide by naturalSize). We store each region already normalized so overlays
 * survive canvas resize.
 *
 * On submit: POST /api/intake/buckets/:id/regions
 *   { sourcePhotoId, regions: [{ bbox:{x,y,width,height} 0..1, label? }] }
 * → one NEW `single` bucket per crop. Toast the count, call onDone() so the
 * wizard refetches, close.
 *
 * Base UI Dialog → dismissal blocked via the controlled onOpenChange guard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, MousePointerSquareDashed, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/components/products/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Bounding box, normalized 0..1 against the source image. */
interface NormBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Region {
  id: number;
  bbox: NormBox;
  label: string;
}

interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MultiProductMaskerProps {
  open: boolean;
  /** Source (wide) photo to mask. */
  photoId: number;
  imageUrl: string;
  /** The `multi` bucket being masked. */
  bucketId: number;
  onOpenChange: (open: boolean) => void;
  /** Called after buckets are created so the wizard can refetch. */
  onDone: () => void;
}

/** Response shape from POST /buckets/:id/regions. */
interface RegionsResponse {
  buckets: Array<{ id: number; kind: string; label: string | null; status: string }>;
}

export function MultiProductMasker({
  open,
  photoId,
  imageUrl,
  bucketId,
  onOpenChange,
  onDone,
}: MultiProductMaskerProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nextId = useRef(1);

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<DisplayRect | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset per-open so a reused dialog starts clean.
  useEffect(() => {
    if (!open) return;
    setRegions([]);
    setDraft(null);
    setStartPoint(null);
    setDrawing(false);
    setNaturalSize(null);
    nextId.current = 1;
  }, [open, photoId]);

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
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);

    // Dim the whole image, then punch a hole for every masked region + the draft.
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, w, h);
    const holes: DisplayRect[] = [
      ...regions.map((r) => ({
        x: r.bbox.x * w,
        y: r.bbox.y * h,
        width: r.bbox.width * w,
        height: r.bbox.height * h,
      })),
      ...(draft && draft.width > 0 && draft.height > 0 ? [draft] : []),
    ];
    for (const rect of holes) ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();

    // Committed regions: blue + numbered.
    ctx.lineWidth = 2;
    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    regions.forEach((r, i) => {
      const x = r.bbox.x * w;
      const y = r.bbox.y * h;
      const rw = r.bbox.width * w;
      const rh = r.bbox.height * h;
      ctx.strokeStyle = "rgb(59,130,246)"; // blue-500
      ctx.strokeRect(x, y, rw, rh);
      const tag = String(i + 1);
      ctx.fillStyle = "rgb(59,130,246)";
      ctx.fillRect(x, y, 18, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(tag, x + 5, y + 12);
    });

    // Live draft: green outline.
    if (draft && draft.width > 0 && draft.height > 0) {
      ctx.strokeStyle = "rgb(34,197,94)"; // green-500
      ctx.strokeRect(draft.x, draft.y, draft.width, draft.height);
    }
  }, [regions, draft]);

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

  const pointFromEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvas.width, event.clientX - bounds.left));
    const y = Math.max(0, Math.min(canvas.height, event.clientY - bounds.top));
    return { x, y };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0 || submitting) return;
      syncCanvasSize();
      const point = pointFromEvent(event);
      setStartPoint(point);
      setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
      setDrawing(true);
      canvasRef.current?.setPointerCapture(event.pointerId);
    },
    [pointFromEvent, submitting, syncCanvasSize],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing || !startPoint) return;
      const point = pointFromEvent(event);
      setDraft({
        x: Math.min(startPoint.x, point.x),
        y: Math.min(startPoint.y, point.y),
        width: Math.abs(point.x - startPoint.x),
        height: Math.abs(point.y - startPoint.y),
      });
    },
    [drawing, pointFromEvent, startPoint],
  );

  // On pointer-up, commit the draft as a new normalized region.
  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      setDrawing(false);
      setStartPoint(null);

      const rect = draft;
      setDraft(null);
      if (!canvas || !rect || rect.width < 4 || rect.height < 4 || !naturalSize) return;

      // display-px → source-px (mirror ExtractClippingDialog) …
      const scaleX = naturalSize.w / canvas.width;
      const scaleY = naturalSize.h / canvas.height;
      const source = {
        x: rect.x * scaleX,
        y: rect.y * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
      };
      // … then source-px → normalized 0..1 (divide by natural size).
      const bbox: NormBox = {
        x: source.x / naturalSize.w,
        y: source.y / naturalSize.h,
        width: source.width / naturalSize.w,
        height: source.height / naturalSize.h,
      };
      setRegions((cur) => [...cur, { id: nextId.current++, bbox, label: "" }]);
    },
    [draft, naturalSize],
  );

  const setLabel = useCallback((id: number, label: string) => {
    setRegions((cur) => cur.map((r) => (r.id === id ? { ...r, label } : r)));
  }, []);

  const removeRegion = useCallback((id: number) => {
    setRegions((cur) => cur.filter((r) => r.id !== id));
  }, []);

  const submit = useCallback(async () => {
    if (regions.length === 0) return;
    setSubmitting(true);
    try {
      const res = await api<RegionsResponse>(`/api/intake/buckets/${bucketId}/regions`, {
        method: "POST",
        body: JSON.stringify({
          sourcePhotoId: photoId,
          regions: regions.map((r) => ({
            bbox: r.bbox,
            label: r.label.trim() || undefined,
          })),
        }),
      });
      const n = res.buckets?.length ?? regions.length;
      toast.success(`Created ${n} product${n === 1 ? "" : "s"}`);
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create products");
    } finally {
      setSubmitting(false);
    }
  }, [regions, bucketId, photoId, onDone, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-3xl ring-1 ring-border/40">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">
            Mask products
          </DialogTitle>
          <DialogDescription>
            Drag a box around each product in this photo. Each box becomes its own
            product bucket, cropped from the original.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
          <div className="relative w-full overflow-hidden rounded-xl bg-muted/30 ring-1 ring-border/40">
            {imageUrl ? (
              <img
                ref={imgRef}
                src={imageUrl}
                alt="Source photo"
                className="block w-full select-none object-contain"
                draggable={false}
                onLoad={(event) => {
                  const t = event.currentTarget;
                  setNaturalSize({ w: t.naturalWidth, h: t.naturalHeight });
                  syncCanvasSize();
                  redraw();
                }}
              />
            ) : (
              <div className="flex aspect-video items-center justify-center text-sm text-muted-foreground">
                No photo
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

          <div className="min-w-0 space-y-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MousePointerSquareDashed className="size-3.5" />
              Drag to add a region.
            </p>
            {regions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No regions yet.</p>
            ) : (
              <ul className="space-y-2">
                {regions.map((r, i) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 rounded-lg bg-card px-2 py-1.5 ring-1 ring-border/40"
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded bg-primary/15 text-[11px] font-semibold text-primary">
                      {i + 1}
                    </span>
                    <Input
                      value={r.label}
                      onChange={(e) => setLabel(r.id, e.target.value)}
                      placeholder="Label (optional)"
                      className="h-8 flex-1 ring-1 ring-border/40"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeRegion(r.id)}
                      aria-label={`Remove region ${i + 1}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || regions.length === 0}>
            {submitting ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Check className="mr-1.5 size-4" />
            )}
            Create {regions.length || ""} product{regions.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MultiProductMasker;
