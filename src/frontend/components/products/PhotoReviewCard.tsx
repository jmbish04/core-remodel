/**
 * @fileoverview PhotoReviewCard — one pending photo in the HITL review queue.
 *
 * Renders the captured image, the matched product (linked to its PDP) and the
 * AI-extracted attributes as EDITABLE text fields seeded from
 * `photo.attributes`. The reviewer corrects anything wrong, then:
 *
 *   Approve → POST /api/product-photos/:id/review
 *             { action:'approve', attributes:<edited>, observationApproved:true }
 *   Reject  → POST /api/product-photos/:id/review
 *             { action:'reject', reviewReason?:<optional note> }
 *
 * On success the parent drops the card (onReviewed). Failures toast; the card
 * stays put so nothing is silently lost. Monolith dark, no 1px borders.
 */

import { useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/components/products";

import type { ExtractedAttributes, PendingPhoto } from "./photo-review-types";

/** Editable string fields, in display order. `colors` is comma-joined. */
const FIELDS: { key: keyof ExtractedAttributes; label: string }[] = [
  { key: "itemName", label: "Item name" },
  { key: "brand", label: "Brand" },
  { key: "modelNumber", label: "Model number" },
  { key: "category", label: "Category" },
  { key: "style", label: "Style" },
  { key: "colors", label: "Colors (comma-separated)" },
  { key: "price", label: "Price" },
  { key: "salePrice", label: "Sale price" },
  { key: "discountInfo", label: "Discount info" },
];

/** Coerce any attribute value into an editable string. */
function toField(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function PhotoReviewCard({
  photo,
  onReviewed,
}: {
  photo: PendingPhoto;
  onReviewed: (photoId: number) => void;
}) {
  const attrs = photo.attributes ?? {};
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, toField(attrs[f.key])])),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const confidence = useMemo(() => {
    // confidence is already an integer 0-100 from the extraction schema — do NOT ×100.
    const c = attrs.confidence;
    return typeof c === "number" ? Math.max(0, Math.min(100, Math.round(c))) : null;
  }, [attrs.confidence]);

  const submit = async (action: "approve" | "reject") => {
    setBusy(action);
    try {
      const body: Record<string, unknown> = { action };
      if (action === "approve") {
        // Merge edits back over the original attributes so untouched keys
        // (dominantColors, per-field confidence, …) survive the round trip.
        const edited: ExtractedAttributes = { ...attrs };
        for (const { key } of FIELDS) {
          const raw = form[key] ?? "";
          edited[key] =
            key === "colors"
              ? raw.split(",").map((s) => s.trim()).filter(Boolean)
              : raw || null;
        }
        body.attributes = edited;
        body.observationApproved = true;
      } else if (reason.trim()) {
        body.reviewReason = reason.trim();
      }

      await api(`/api/product-photos/${photo.id}/review`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success(action === "approve" ? "Approved" : "Rejected");
      onReviewed(photo.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Review failed");
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5 rounded-2xl bg-card p-5 ring-1 ring-border/40 sm:grid-cols-[minmax(0,180px)_1fr]">
      {/* Image + product identity */}
      <div className="flex flex-col gap-3">
        {photo.imageUrl ? (
          <img
            src={photo.imageUrl}
            alt={photo.product?.itemName ?? "Captured photo"}
            className="aspect-square w-full rounded-xl object-cover ring-1 ring-border/40"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-muted/30 text-xs text-muted-foreground ring-1 ring-border/40">
            No image
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-full text-[10px] capitalize">
            {photo.photoKind.replace("_", " ")}
          </Badge>
          {confidence !== null && (
            <Badge
              variant={confidence >= 70 ? "default" : "outline"}
              className="rounded-full text-[10px]"
            >
              {confidence}% confident
            </Badge>
          )}
        </div>

        {photo.product && (
          <a
            href={`/admin/products/${photo.product.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-foreground/80 hover:text-foreground"
          >
            <span className="truncate">
              {photo.product.itemName ?? `Product #${photo.product.id}`}
              {photo.product.brandName ? ` · ${photo.product.brandName}` : ""}
            </span>
            <ExternalLink className="size-3.5 shrink-0" />
          </a>
        )}
      </div>

      {/* Editable attributes + actions */}
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map(({ key, label }) => (
            <div key={String(key)} className="grid gap-1.5">
              <Label htmlFor={`f-${photo.id}-${String(key)}`} className="text-xs">
                {label}
              </Label>
              <Input
                id={`f-${photo.id}-${String(key)}`}
                value={form[key as string] ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                className="h-8 bg-muted/20"
              />
            </div>
          ))}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`reason-${photo.id}`} className="text-xs text-muted-foreground">
            Reject reason (optional)
          </Label>
          <Input
            id={`reason-${photo.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. blurry / wrong product"
            className="h-8 bg-muted/20"
          />
        </div>

        <div className="flex gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => void submit("approve")}>
            {busy === "approve" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Check className="mr-1.5 size-4" />
            )}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void submit("reject")}
          >
            {busy === "reject" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <X className="mr-1.5 size-4" />
            )}
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}
