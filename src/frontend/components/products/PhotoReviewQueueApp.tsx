/**
 * @fileoverview PhotoReviewQueueApp — HITL review surface for the showroom
 * price-card / product-photo ingest pipeline (subsystem 0020-C).
 *
 * Mounted at /admin/shopping/photo-review (client:only="react"). Two stacked
 * regions:
 *
 *   1. CAPTURE CARD — a phone-friendly file input (accept="image/*"
 *      capture="environment") + a native showroom picker. On submit it POSTs a
 *      multipart `FormData` (`file` + `showroomId`) to
 *      `POST /api/product-photos/ingest`; the backend uploads the image,
 *      AI-extracts brand/price/attributes, creates-or-matches a product, and
 *      writes a `pending_review` photo. On success we toast + refetch the queue.
 *
 *   2. PENDING QUEUE — one <PhotoReviewCard> per row from
 *      `GET /api/product-photos/pending`. Each card shows the image, the matched
 *      product (link to its PDP) and the AI-extracted attributes as EDITABLE
 *      fields. Approve → `POST /:id/review {action:'approve', attributes,
 *      observationApproved:true}`; Reject → `{action:'reject', reviewReason?}`.
 *      Reviewed cards drop out of the list optimistically.
 *
 * Monolith dark: no 1px borders (ring-1 ring-border/40 / bg-card), all failures
 * routed through sonner toasts, every empty/loading state handled. No mock data.
 */

import { useCallback, useEffect, useState } from "react";
import { Camera, ImageOff, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api } from "@/components/products";

import { PhotoReviewCard } from "./PhotoReviewCard";
import type { PendingPhoto, ShowroomOption } from "./photo-review-types";

// ─── Component ───────────────────────────────────────────────────────────────

export function PhotoReviewQueueApp() {
  const [photos, setPhotos] = useState<PendingPhoto[] | null>(null);
  const [showrooms, setShowrooms] = useState<ShowroomOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [showroomId, setShowroomId] = useState("");
  const [uploading, setUploading] = useState(false);

  const loadQueue = useCallback(async () => {
    setError(null);
    try {
      const res = await api<{ photos: PendingPhoto[] }>("/api/product-photos/pending");
      setPhotos(res.photos);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load review queue";
      setError(msg);
      toast.error(msg);
    }
  }, []);

  const loadShowrooms = useCallback(async () => {
    try {
      const res = await api<{ stores: ShowroomOption[] }>("/api/showroom-stores");
      setShowrooms(res.stores ?? []);
    } catch (e) {
      // A missing picker list shouldn't blank the page — the queue still works.
      toast.error(e instanceof Error ? e.message : "Failed to load showrooms");
    }
  }, []);

  useEffect(() => {
    void loadQueue();
    void loadShowrooms();
  }, [loadQueue, loadShowrooms]);

  const handleIngest = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!file) {
        toast.error("Choose a photo first");
        return;
      }
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        if (showroomId) form.append("showroomId", showroomId);
        // Multipart body — do NOT set Content-Type; the browser adds the boundary.
        const res = await fetch("/api/product-photos/ingest", {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error((payload.error as string) ?? `Upload failed (${res.status})`);
        }
        toast.success("Photo ingested — added to the review queue");
        setFile(null);
        await loadQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [file, showroomId, loadQueue],
  );

  // Drop a card as soon as it's reviewed (approve or reject both remove it).
  const handleReviewed = useCallback((photoId: number) => {
    setPhotos((prev) => (prev ? prev.filter((p) => p.id !== photoId) : prev));
  }, []);

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Price-Card Review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Snap a price card or product in a showroom; confirm what the AI extracted.
        </p>
      </header>

      {/* ─── Capture card ─────────────────────────────────────────────── */}
      <Card className="rounded-2xl bg-card p-5 ring-1 ring-border/40">
        <form onSubmit={handleIngest} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="photo-file">Photo</Label>
            <input
              id="photo-file"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted/60 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="photo-showroom">Showroom</Label>
            <select
              id="photo-showroom"
              value={showroomId}
              onChange={(e) => setShowroomId(e.target.value)}
              className="h-9 rounded-md bg-muted/40 px-3 text-sm text-foreground ring-1 ring-border/40 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Unspecified / online</option>
              {showrooms.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <Button type="submit" disabled={uploading || !file} className="self-start">
            {uploading ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : file ? (
              <Upload className="mr-1.5 size-4" />
            ) : (
              <Camera className="mr-1.5 size-4" />
            )}
            {uploading ? "Ingesting…" : "Ingest photo"}
          </Button>
        </form>
      </Card>

      <Separator className="my-8 bg-border/40" />

      {/* ─── Pending queue ────────────────────────────────────────────── */}
      <h2 className="mb-4 text-sm font-medium text-muted-foreground">Awaiting review</h2>

      {photos === null ? (
        <QueueSkeleton />
      ) : error ? (
        <EmptyState
          icon={<ImageOff className="size-6" />}
          title="Couldn't load the queue"
          detail={error}
          action={
            <Button size="sm" variant="outline" onClick={() => void loadQueue()}>
              Retry
            </Button>
          }
        />
      ) : photos.length === 0 ? (
        <EmptyState icon={<ImageOff className="size-6" />} title="No photos awaiting review" />
      ) : (
        <div className="flex flex-col gap-5">
          {photos.map((photo) => (
            <PhotoReviewCard key={photo.id} photo={photo} onReviewed={handleReviewed} />
          ))}
        </div>
      )}
    </main>
  );
}

// ─── Small presentational helpers ────────────────────────────────────────────

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-48 animate-pulse rounded-2xl bg-muted/30 ring-1 ring-border/40"
        />
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-2xl bg-card p-6 text-center text-muted-foreground ring-1 ring-border/40">
      {icon}
      <p className="text-sm">{title}</p>
      {detail && <p className="max-w-sm text-xs text-muted-foreground/70">{detail}</p>}
      {action}
    </div>
  );
}
