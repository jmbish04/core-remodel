// ---------------------------------------------------------------------------
// ExtractClippingDialog — the extraction flow. Hosts the EXISTING
// render/InspirationCanvas bbox selector over a node's image; on submit it
// converts the source-pixel box to the normalized 0..1 bbox the API expects,
// POSTs /clippings/extract, and hands the new clipping back so the drawer can
// reveal it. Optional label is captured up front (homeowner copy).
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InspirationCanvas } from "@/components/render/InspirationCanvas";
import type { ExtractPayload } from "@/components/render/types";

import { extractClipping } from "../api";
import type { BoardNode, Clipping } from "../types";

interface ExtractClippingDialogProps {
  node: BoardNode | null;
  roomId: string;
  onClose: () => void;
  onExtracted: (clipping: Clipping) => void;
}

export function ExtractClippingDialog({
  node,
  roomId,
  onClose,
  onExtracted,
}: ExtractClippingDialogProps) {
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  // Measure the source image's natural size so the source-pixel box from
  // InspirationCanvas can be normalized to 0..1 for the API.
  useEffect(() => {
    setLabel("");
    setNatural(null);
    if (!node) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () =>
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = node.cfImageUrl;
  }, [node]);

  const handleExtract = async (payload: ExtractPayload) => {
    if (!node) return;
    const dims = natural;
    if (!dims || dims.w <= 0 || dims.h <= 0) {
      toast.error("Still loading the image — try again in a moment.");
      return;
    }
    const box = payload.referencedRegionBoundingBox;
    setSubmitting(true);
    try {
      const clipping = await extractClipping({
        roomId,
        sourceCfImageUrl: node.cfImageUrl,
        bbox: {
          x: box.x / dims.w,
          y: box.y / dims.h,
          width: box.width / dims.w,
          height: box.height / dims.h,
        },
        label: label.trim() || undefined,
      });
      onExtracted(clipping);
      toast.success("Sample saved to the drawer.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't extract that.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(node)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl ring-1 ring-border/40">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">
            Extract a sample
          </DialogTitle>
          <DialogDescription>
            Drag a box around the material you want to keep — the tile, stone, or
            finish. It’ll be cut onto a clean background and saved to your
            samples.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="clipping-label" className="text-xs">
              Name this sample (optional)
            </Label>
            <Input
              id="clipping-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Calacatta Viola marble"
              className="ring-1 ring-border/40"
            />
          </div>

          {node && (
            <InspirationCanvas
              inspirationImageId={node.id}
              imageUrl={node.cfImageUrl}
              onExtract={handleExtract}
              submitting={submitting || !natural}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ExtractClippingDialog;
