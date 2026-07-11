/**
 * @fileoverview BucketReviewApp — Phase-3 review surface mounted at
 * /admin/shopping/photo-review. Fetches the bucket review queue plus the global
 * vocab (categories + colors), then renders one <BucketReviewForm> per bucket.
 * Approve/reject drops the bucket. Monolith dark; every failure → sonner toast.
 */

import { useCallback, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "@/components/products";

import { BucketReviewForm } from "./BucketReviewForm";
import type { CategoryRow, ColorRow, ReviewBucket } from "./review-types";

export function BucketReviewApp() {
  const [buckets, setBuckets] = useState<ReviewBucket[] | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [colors, setColors] = useState<ColorRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setError(null);
    try {
      const res = await api<{ buckets: ReviewBucket[] }>("/api/intake/review-queue");
      setBuckets(res.buckets ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load review queue";
      setError(msg);
      toast.error(msg);
    }
  }, []);

  const loadVocab = useCallback(async () => {
    try {
      const [cats, cols] = await Promise.all([
        api<CategoryRow[]>("/api/config/categories"),
        api<ColorRow[]>("/api/config/colors"),
      ]);
      setCategories(cats ?? []);
      setColors(cols ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load vocab");
    }
  }, []);

  useEffect(() => {
    void loadQueue();
    void loadVocab();
  }, [loadQueue, loadVocab]);

  const handleResolved = useCallback((bucketId: number) => {
    setBuckets((prev) => (prev ? prev.filter((b) => b.id !== bucketId) : prev));
  }, []);

  const handleCategoryCreated = useCallback((row: CategoryRow) => {
    setCategories((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]));
  }, []);

  const handleColorCreated = useCallback((row: ColorRow) => {
    setColors((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]));
  }, []);

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Price-Card Review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Confirm the AI extraction for each photo bucket, then approve it into a product.
        </p>
      </header>

      {buckets === null ? (
        <QueueSkeleton />
      ) : error ? (
        <EmptyState
          title="Couldn't load the queue"
          detail={error}
          action={
            <Button size="sm" variant="outline" onClick={() => void loadQueue()}>
              Retry
            </Button>
          }
        />
      ) : buckets.length === 0 ? (
        <EmptyState title="No buckets awaiting review" />
      ) : (
        <div className="flex flex-col gap-6">
          {buckets.map((bucket) => (
            <BucketReviewForm
              key={bucket.id}
              bucket={bucket}
              categories={categories}
              colors={colors}
              onResolved={handleResolved}
              onCategoryCreated={handleCategoryCreated}
              onColorCreated={handleColorCreated}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-64 animate-pulse rounded-2xl bg-muted/30 ring-1 ring-border/40"
        />
      ))}
    </div>
  );
}

function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-2xl bg-card p-6 text-center text-muted-foreground ring-1 ring-border/40">
      <ImageOff className="size-6" />
      <p className="text-sm">{title}</p>
      {detail && <p className="max-w-sm text-xs text-muted-foreground/70">{detail}</p>}
      {action}
    </div>
  );
}
