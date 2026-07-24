/**
 * @fileoverview IntakeWizardApp — the showroom-visit photo intake wizard
 * (0020-C2 Phase 2) mounted at `/admin/shopping/photo-intake`.
 *
 * Four steps, driven by a Base UI <Tabs> shell + Next/Back buttons:
 *   1. Select showrooms — city-grouped (city headings ASC, names ASC),
 *      checkbox multi-select. Reuses the /api/showroom-stores directory feed.
 *   2. Upload — sidebar of selected showrooms (city-grouped ASC); click to
 *      focus. Right pane: reused <FileUpload> dropzone + <GooglePhotosButton>.
 *      On files chosen → read each to a dataURL → POST /api/intake/uploads →
 *      refetch /api/intake/photos. Thumbnails render fileName ASC.
 *   3. Group into buckets — bulk-select un-bucketed photos → "Merge into
 *      bucket" dialog (kind single|multi + optional label) → POST
 *      /api/intake/buckets. Existing buckets render as collage cards; a photo
 *      can be pulled back out via PATCH removePhotoIds.
 *   4. Process — per-bucket + "Process all" → POST /buckets/:id/process; on
 *      success mark processed (badge) + toast. (Review form is Phase 3.)
 *
 * All data is real (api() fetch helper, credentials forwarded). Errors route to
 * sonner toast, never swallowed. Monolith dark house style: separation via
 * `ring-1 ring-border/40`, never raw 1px borders.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, ImageIcon, Loader2, Scissors, Sparkles, Store, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/components/products/types";
import { GooglePhotosButton } from "@/components/google-photos/GooglePhotosButton";
import { MultiProductMasker } from "./MultiProductMasker";
import { EntitySearchSelect } from "@/components/research-console/EntitySearchSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileUpload, FileUploadDropzone, FileUploadTrigger } from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ─── Types (mirror the API response shapes) ─────────────────────────────────

interface Showroom {
  id: number;
  name: string;
  city: string;
}

interface Photo {
  id: number;
  imageUrl: string;
  fileName: string;
  bucketId: number | null;
}

interface BucketPhoto {
  id: number;
  imageUrl: string;
  fileName: string;
}

interface Bucket {
  id: number;
  kind: "single" | "multi";
  label: string | null;
  status: string;
  photos: BucketPhoto[];
  // Per-stack hints (Phase A′) — round-tripped from the API.
  brandId: number | null;
  brandNameRaw: string | null;
  productName: string | null;
  modelNumber: string | null;
  sku: string | null;
  productUrl: string | null;
  /** Derived server-side: has a brand (matched or raw) OR a product URL. */
  readyForWorkflow: boolean;
}

/**
 * The optional identity hints a user can attach to a stack while grouping, so
 * the intake workflow (Phase C) starts warm. Held as one object in the create /
 * edit dialogs and rendered by `BucketHintFields`.
 */
interface BucketHints {
  /** Matched existing brand: {id, name}. Null when unset or free-typed. */
  brand: { id: number; name: string } | null;
  /** Free-typed brand when no existing match — mutually exclusive with `brand`. */
  brandNameRaw: string;
  productName: string;
  modelNumber: string;
  sku: string;
  productUrl: string;
}

const EMPTY_HINTS: BucketHints = {
  brand: null,
  brandNameRaw: "",
  productName: "",
  modelNumber: "",
  sku: "",
  productUrl: "",
};

/** True when the hints carry enough to start a scrape — mirrors the server's
 *  `readyForWorkflow`, so the dialog can preview readiness live. */
function hintsReady(h: BucketHints): boolean {
  return h.brand != null || h.brandNameRaw.trim().length > 0 || h.productUrl.trim().length > 0;
}

/** Serialise hints into the API body shape (brand id / raw / product fields). */
function hintsToBody(h: BucketHints) {
  return {
    brandId: h.brand?.id ?? null,
    // Only send a raw brand name when NO existing brand was matched.
    brandNameRaw: h.brand ? null : h.brandNameRaw.trim() || null,
    productName: h.productName.trim() || null,
    modelNumber: h.modelNumber.trim() || null,
    sku: h.sku.trim() || null,
    productUrl: h.productUrl.trim() || null,
  };
}

/** Hydrate hints from a bucket DTO (for the edit dialog). Brand name isn't on
 *  the DTO, so a matched brand shows as its id until re-searched; we keep the
 *  raw name visible when present. */
function hintsFromBucket(b: Bucket): BucketHints {
  return {
    brand: b.brandId != null ? { id: b.brandId, name: b.brandNameRaw ?? `Brand #${b.brandId}` } : null,
    brandNameRaw: b.brandId == null ? (b.brandNameRaw ?? "") : "",
    productName: b.productName ?? "",
    modelNumber: b.modelNumber ?? "",
    sku: b.sku ?? "",
    productUrl: b.productUrl ?? "",
  };
}

// ─── Components ─────────────────────────────────────────────────────────────

/**
 * The optional per-stack identity fields, shared by the create and edit
 * dialogs. All optional; a live "ready / needs brand or URL" hint mirrors the
 * server rule so the user sees when a stack is workflow-ready.
 *
 * Brand uses the existing `EntitySearchSelect` (brand catalog → /api/brands).
 * When no existing brand matches, the user types a raw name in the "brand not
 * listed?" field — kept separate so the workflow knows to scrape it fresh.
 */
function BucketHintFields({
  hints,
  onChange,
}: {
  hints: BucketHints;
  onChange: (next: BucketHints) => void;
}) {
  const set = <K extends keyof BucketHints>(key: K, val: BucketHints[K]) =>
    onChange({ ...hints, [key]: val });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Brand</Label>
        <EntitySearchSelect
          catalog="brand"
          value={hints.brand ? { id: hints.brand.id, name: hints.brand.name } : null}
          onChange={(hit) =>
            onChange({
              ...hints,
              brand: hit ? { id: hit.id, name: hit.name } : null,
              // Picking a matched brand clears any free-typed name.
              brandNameRaw: hit ? "" : hints.brandNameRaw,
            })
          }
        />
        {!hints.brand && (
          <Input
            value={hints.brandNameRaw}
            onChange={(e) => set("brandNameRaw", e.target.value)}
            placeholder="Brand not listed? Type it here"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Product name</Label>
          <Input
            value={hints.productName}
            onChange={(e) => set("productName", e.target.value)}
            placeholder="e.g. Goccia"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Model #</Label>
          <Input
            value={hints.modelNumber}
            onChange={(e) => set("modelNumber", e.target.value)}
            placeholder="e.g. 33686"
          />
        </div>
        <div className="space-y-1.5">
          <Label>SKU</Label>
          <Input value={hints.sku} onChange={(e) => set("sku", e.target.value)} placeholder="Optional" />
        </div>
        <div className="space-y-1.5">
          <Label>Product URL</Label>
          <Input
            value={hints.productUrl}
            onChange={(e) => set("productUrl", e.target.value)}
            placeholder="brand.com/product/…"
          />
        </div>
      </div>

      {/* Live readiness mirror of the server rule — a nudge, never a block. */}
      <p className={cn("text-xs", hintsReady(hints) ? "text-emerald-500" : "text-amber-500")}>
        {hintsReady(hints)
          ? "Ready for the intake workflow."
          : "Add a brand or a product URL to make this stack workflow-ready (optional)."}
      </p>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Read a File into a base64 data URL for the JSON upload body. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Group showrooms by city (headings ASC), each group's rooms sorted name ASC. */
function groupByCity(list: Showroom[]): Array<[string, Showroom[]]> {
  const map = new Map<string, Showroom[]>();
  for (const s of list) {
    const city = s.city?.trim() || "Other";
    (map.get(city) ?? map.set(city, []).get(city)!).push(s);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([city, rooms]) => [city, rooms.sort((a, b) => a.name.localeCompare(b.name))] as [string, Showroom[]]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function IntakeWizardApp() {
  const [step, setStep] = useState("1");

  const [showrooms, setShowrooms] = useState<Showroom[]>([]);
  const [loadingShowrooms, setLoadingShowrooms] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [focusedId, setFocusedId] = useState<number | null>(null);

  const [photosByShowroom, setPhotosByShowroom] = useState<Record<number, Photo[]>>({});
  const [bucketsByShowroom, setBucketsByShowroom] = useState<Record<number, Bucket[]>>({});
  const [uploading, setUploading] = useState<Record<number, boolean>>({});

  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<number>>(new Set());
  const [processing, setProcessing] = useState<Set<number>>(new Set());

  const [maskBucket, setMaskBucket] = useState<{ bucketId: number; photoId: number; imageUrl: string } | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [bucketKind, setBucketKind] = useState<"single" | "multi">("multi");
  const [bucketLabel, setBucketLabel] = useState("");
  const [bucketHints, setBucketHints] = useState<BucketHints>(EMPTY_HINTS);
  const [savingBucket, setSavingBucket] = useState(false);
  // Edit-details dialog for an EXISTING bucket (Phase A′).
  const [editBucket, setEditBucket] = useState<Bucket | null>(null);
  const [editHints, setEditHints] = useState<BucketHints>(EMPTY_HINTS);
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Load showrooms once (reuses the directory feed) ──────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ stores: Array<{ id: number; name: string; cityName: string | null }> }>(
          "/api/showroom-stores",
        );
        setShowrooms(data.stores.map((s) => ({ id: s.id, name: s.name, city: s.cityName ?? "Other" })));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load showrooms");
      } finally {
        setLoadingShowrooms(false);
      }
    })();
  }, []);

  const selectedShowrooms = useMemo(
    () => showrooms.filter((s) => selectedIds.has(s.id)),
    [showrooms, selectedIds],
  );

  const focusedShowroom = focusedId != null ? showrooms.find((s) => s.id === focusedId) ?? null : null;
  const focusedPhotos = focusedId != null ? photosByShowroom[focusedId] ?? [] : [];
  const focusedBuckets = focusedId != null ? bucketsByShowroom[focusedId] ?? [] : [];
  const unbucketedPhotos = useMemo(
    () => focusedPhotos.filter((p) => p.bucketId == null),
    [focusedPhotos],
  );

  // ── Data fetchers ────────────────────────────────────────────────────────
  const refreshPhotos = useCallback(async (showroomId: number) => {
    try {
      const data = await api<{ photos: Photo[] }>(`/api/intake/photos?showroomId=${showroomId}`);
      setPhotosByShowroom((cur) => ({ ...cur, [showroomId]: data.photos }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load photos");
    }
  }, []);

  const refreshBuckets = useCallback(async (showroomId: number) => {
    try {
      const data = await api<{ buckets: Bucket[] }>(`/api/intake/buckets?showroomId=${showroomId}`);
      setBucketsByShowroom((cur) => ({ ...cur, [showroomId]: data.buckets }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load buckets");
    }
  }, []);

  // Focus a showroom (upload/bucket steps) and lazy-load its photos + buckets.
  const focusShowroom = useCallback(
    (id: number) => {
      setFocusedId(id);
      setSelectedPhotoIds(new Set());
      if (!photosByShowroom[id]) void refreshPhotos(id);
      if (!bucketsByShowroom[id]) void refreshBuckets(id);
    },
    [photosByShowroom, bucketsByShowroom, refreshPhotos, refreshBuckets],
  );

  // Default focus to the first selected showroom when entering steps 2–4.
  useEffect(() => {
    if (step === "1") return;
    if (focusedId != null && selectedIds.has(focusedId)) return;
    const first = selectedShowrooms[0];
    if (first) focusShowroom(first.id);
  }, [step, focusedId, selectedIds, selectedShowrooms, focusShowroom]);

  // ── Upload ───────────────────────────────────────────────────────────────
  const uploadFiles = useCallback(
    async (showroomId: number, files: File[]) => {
      if (files.length === 0) return;
      setUploading((cur) => ({ ...cur, [showroomId]: true }));
      try {
        // Chunk to a few files per request — base64 data URLs are large and a
        // single big JSON body risks the Worker's memory / request-size limits.
        const CHUNK = 3;
        for (let i = 0; i < files.length; i += CHUNK) {
          const payload = await Promise.all(
            files.slice(i, i + CHUNK).map(async (f) => ({ fileName: f.name, dataUrl: await readAsDataUrl(f) })),
          );
          await api<{ photos: Photo[] }>("/api/intake/uploads", {
            method: "POST",
            body: JSON.stringify({ showroomId, files: payload }),
          });
        }
        await refreshPhotos(showroomId);
        toast.success(`Uploaded ${files.length} photo${files.length === 1 ? "" : "s"}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading((cur) => ({ ...cur, [showroomId]: false }));
      }
    },
    [refreshPhotos],
  );

  // ── Bucketing ──────────────────────────────────────────────────────────────
  const togglePhoto = useCallback((id: number) => {
    setSelectedPhotoIds((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const createBucket = useCallback(async () => {
    if (focusedId == null || selectedPhotoIds.size === 0) return;
    setSavingBucket(true);
    try {
      await api<{ bucket: Bucket }>("/api/intake/buckets", {
        method: "POST",
        body: JSON.stringify({
          showroomId: focusedId,
          kind: bucketKind,
          label: bucketLabel.trim() || undefined,
          photoIds: [...selectedPhotoIds],
          ...hintsToBody(bucketHints),
        }),
      });
      await Promise.all([refreshPhotos(focusedId), refreshBuckets(focusedId)]);
      setSelectedPhotoIds(new Set());
      setBucketLabel("");
      setBucketHints(EMPTY_HINTS);
      setDialogOpen(false);
      toast.success("Bucket created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create bucket");
    } finally {
      setSavingBucket(false);
    }
  }, [focusedId, selectedPhotoIds, bucketKind, bucketLabel, bucketHints, refreshPhotos, refreshBuckets]);

  /** Save edited hint fields to an existing bucket via PATCH. */
  const saveEditBucket = useCallback(async () => {
    if (!editBucket || focusedId == null) return;
    setSavingEdit(true);
    try {
      await api<{ bucket: Bucket }>(`/api/intake/buckets/${editBucket.id}`, {
        method: "PATCH",
        body: JSON.stringify(hintsToBody(editHints)),
      });
      await refreshBuckets(focusedId);
      setEditBucket(null);
      toast.success("Stack details saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save details");
    } finally {
      setSavingEdit(false);
    }
  }, [editBucket, editHints, focusedId, refreshBuckets]);

  const removeFromBucket = useCallback(
    async (bucketId: number, photoId: number) => {
      if (focusedId == null) return;
      try {
        await api(`/api/intake/buckets/${bucketId}`, {
          method: "PATCH",
          body: JSON.stringify({ removePhotoIds: [photoId] }),
        });
        await Promise.all([refreshPhotos(focusedId), refreshBuckets(focusedId)]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to remove photo");
      }
    },
    [focusedId, refreshPhotos, refreshBuckets],
  );

  // ── Process ────────────────────────────────────────────────────────────────
  const processBucket = useCallback(
    async (showroomId: number, bucketId: number) => {
      setProcessing((cur) => new Set(cur).add(bucketId));
      try {
        await api(`/api/intake/buckets/${bucketId}/process`, { method: "POST" });
        setBucketsByShowroom((cur) => ({
          ...cur,
          [showroomId]: (cur[showroomId] ?? []).map((b) =>
            b.id === bucketId ? { ...b, status: "processed" } : b,
          ),
        }));
        toast.success("Sent to AI extraction");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Processing failed");
      } finally {
        setProcessing((cur) => {
          const next = new Set(cur);
          next.delete(bucketId);
          return next;
        });
      }
    },
    [],
  );

  const processAll = useCallback(
    async (showroomId: number) => {
      const pending = (bucketsByShowroom[showroomId] ?? []).filter((b) => b.status !== "processed");
      for (const b of pending) await processBucket(showroomId, b.id);
    },
    [bucketsByShowroom, processBucket],
  );

  // ── Render helpers ──────────────────────────────────────────────────────────
  const canAdvance = selectedIds.size > 0;

  const sidebar = (
    <aside className="w-full shrink-0 space-y-4 md:w-56">
      {groupByCity(selectedShowrooms).map(([city, rooms]) => (
        <div key={city}>
          <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {city}
          </div>
          <div className="space-y-1">
            {rooms.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => focusShowroom(s.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ring-1 ring-transparent transition-colors hover:bg-muted/40",
                  focusedId === s.id && "bg-muted/60 ring-border/40",
                )}
              >
                <Store className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Showroom Photo Intake</h1>
        <p className="text-sm text-muted-foreground">
          Select showrooms, upload a visit&apos;s photos, group burst shots into product buckets, then send each
          bucket to AI extraction.
        </p>
      </div>

      <Tabs value={step} onValueChange={(v) => setStep(v as string)}>
        <TabsList>
          <TabsTrigger value="1">1. Select</TabsTrigger>
          <TabsTrigger value="2" disabled={!canAdvance}>
            2. Upload
          </TabsTrigger>
          <TabsTrigger value="3" disabled={!canAdvance}>
            3. Group
          </TabsTrigger>
          <TabsTrigger value="4" disabled={!canAdvance}>
            4. Process
          </TabsTrigger>
        </TabsList>

        {/* ── Step 1: Select showrooms ─────────────────────────────────── */}
        <TabsContent value="1" className="mt-4 space-y-4">
          {loadingShowrooms ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading showrooms…
            </div>
          ) : showrooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">No showrooms in the directory yet.</p>
          ) : (
            groupByCity(showrooms).map(([city, rooms]) => (
              <div key={city}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {city}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {rooms.map((s) => {
                    const checked = selectedIds.has(s.id);
                    return (
                      <label
                        key={s.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg bg-card px-3 py-2.5 ring-1 ring-border/40 transition-colors hover:bg-muted/40",
                          checked && "ring-primary/50",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() =>
                            setSelectedIds((cur) => {
                              const next = new Set(cur);
                              next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                              return next;
                            })
                          }
                        />
                        <span className="truncate text-sm">{s.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
            <Button disabled={!canAdvance} onClick={() => setStep("2")}>
              Next: Upload
            </Button>
          </div>
        </TabsContent>

        {/* ── Step 2: Upload ───────────────────────────────────────────── */}
        <TabsContent value="2" className="mt-4">
          <div className="flex flex-col gap-6 md:flex-row">
            {sidebar}
            <div className="min-w-0 flex-1 space-y-4">
              {focusedShowroom ? (
                <>
                  <div className="text-sm font-medium">{focusedShowroom.name}</div>
                  <FileUpload
                    accept="image/*"
                    multiple
                    disabled={uploading[focusedShowroom.id]}
                    onAccept={(files) => void uploadFiles(focusedShowroom.id, files)}
                    label="Showroom photo upload"
                  >
                    <FileUploadDropzone className="rounded-lg border-0 bg-muted/25 px-4 py-8 text-center ring-1 ring-border/40">
                      {uploading[focusedShowroom.id] ? (
                        <Loader2 className="mx-auto mb-2 size-6 animate-spin text-muted-foreground" />
                      ) : (
                        <Upload className="mx-auto mb-2 size-6 text-muted-foreground" />
                      )}
                      <p className="text-sm font-medium">Drop photos here</p>
                      <p className="text-xs text-muted-foreground">Uploaded to Cloudflare Images, sorted by filename</p>
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <FileUploadTrigger asChild>
                          <Button size="sm" variant="secondary" disabled={uploading[focusedShowroom.id]}>
                            Browse files
                          </Button>
                        </FileUploadTrigger>
                        <GooglePhotosButton
                          variant="secondary"
                          disabled={uploading[focusedShowroom.id]}
                          onFiles={(files) => uploadFiles(focusedShowroom.id, files)}
                        />
                      </div>
                    </FileUploadDropzone>
                  </FileUpload>

                  {focusedPhotos.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {focusedPhotos.map((p) => (
                        <figure key={p.id} className="overflow-hidden rounded-lg bg-card ring-1 ring-border/40">
                          <img src={p.imageUrl} alt={p.fileName} className="aspect-square w-full object-cover" />
                          <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground">
                            {p.fileName}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No photos uploaded yet.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Select a showroom from the list.</p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between pt-4">
            <Button variant="ghost" onClick={() => setStep("1")}>
              Back
            </Button>
            <Button onClick={() => setStep("3")}>Next: Group</Button>
          </div>
        </TabsContent>

        {/* ── Step 3: Group into buckets ───────────────────────────────── */}
        <TabsContent value="3" className="mt-4">
          <div className="flex flex-col gap-6 md:flex-row">
            {sidebar}
            <div className="min-w-0 flex-1 space-y-6">
              {focusedShowroom ? (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{focusedShowroom.name}</div>
                    <Button
                      size="sm"
                      disabled={selectedPhotoIds.size === 0}
                      onClick={() => setDialogOpen(true)}
                    >
                      <Boxes className="mr-1.5 size-4" />
                      Merge into bucket ({selectedPhotoIds.size})
                    </Button>
                  </div>

                  {/* Existing buckets */}
                  {focusedBuckets.length > 0 && (
                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Buckets
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {focusedBuckets.map((b) => (
                          <Card key={b.id} className="bg-card ring-1 ring-border/40">
                            <CardContent className="space-y-2 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium">
                                  {b.label || `Bucket #${b.id}`}
                                </span>
                                <Badge variant={b.kind === "multi" ? "default" : "secondary"}>{b.kind}</Badge>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {b.photos.map((p) => (
                                  <div key={p.id} className="group relative">
                                    <img
                                      src={p.imageUrl}
                                      alt={p.fileName}
                                      className="size-12 rounded object-cover ring-1 ring-border/40"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => void removeFromBucket(b.id, p.id)}
                                      className="absolute -right-1 -top-1 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block"
                                      aria-label={`Remove ${p.fileName}`}
                                    >
                                      <Trash2 className="size-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {b.photos.length} photo{b.photos.length === 1 ? "" : "s"}
                              </div>
                              {b.kind === "multi" && b.photos.length > 0 && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="w-full"
                                  onClick={() =>
                                    setMaskBucket({
                                      bucketId: b.id,
                                      photoId: b.photos[0].id,
                                      imageUrl: b.photos[0].imageUrl,
                                    })
                                  }
                                >
                                  <Scissors className="mr-1.5 size-3.5" />
                                  Mask products
                                </Button>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Un-bucketed photos */}
                  <div className="space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Un-bucketed photos
                    </div>
                    {unbucketedPhotos.length > 0 ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {unbucketedPhotos.map((p) => {
                          const checked = selectedPhotoIds.has(p.id);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => togglePhoto(p.id)}
                              className={cn(
                                "relative overflow-hidden rounded-lg bg-card text-left ring-1 ring-border/40 transition-shadow",
                                checked && "ring-2 ring-primary",
                              )}
                            >
                              <img src={p.imageUrl} alt={p.fileName} className="aspect-square w-full object-cover" />
                              <span className="absolute left-1.5 top-1.5">
                                <Checkbox checked={checked} tabIndex={-1} />
                              </span>
                              <span className="block truncate px-2 py-1 text-[11px] text-muted-foreground">
                                {p.fileName}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {focusedPhotos.length === 0 ? "No photos uploaded yet." : "All photos are bucketed."}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Select a showroom from the list.</p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between pt-4">
            <Button variant="ghost" onClick={() => setStep("2")}>
              Back
            </Button>
            <Button onClick={() => setStep("4")}>Next: Process</Button>
          </div>
        </TabsContent>

        {/* ── Step 4: Process ──────────────────────────────────────────── */}
        <TabsContent value="4" className="mt-4">
          <div className="flex flex-col gap-6 md:flex-row">
            {sidebar}
            <div className="min-w-0 flex-1 space-y-4">
              {focusedShowroom ? (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{focusedShowroom.name}</div>
                    <Button
                      size="sm"
                      disabled={focusedBuckets.every((b) => b.status === "processed") || focusedBuckets.length === 0}
                      onClick={() => void processAll(focusedShowroom.id)}
                    >
                      <Sparkles className="mr-1.5 size-4" />
                      Process all
                    </Button>
                  </div>
                  {focusedBuckets.length > 0 ? (
                    <div className="divide-y divide-border/40 overflow-hidden rounded-lg bg-card ring-1 ring-border/40">
                      {focusedBuckets.map((b) => {
                        const busy = processing.has(b.id);
                        const done = b.status === "processed";
                        return (
                          <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                              <span className="truncate text-sm">{b.label || `Bucket #${b.id}`}</span>
                              <span className="text-xs text-muted-foreground">
                                {b.photos.length} photo{b.photos.length === 1 ? "" : "s"}
                              </span>
                              {done && <Badge variant="secondary">processed</Badge>}
                              {/* Workflow-readiness — a nudge to add a brand or URL, never a block. */}
                              {!done &&
                                (b.readyForWorkflow ? (
                                  <Badge className="bg-emerald-500/10 text-emerald-500">ready</Badge>
                                ) : (
                                  <Badge className="bg-amber-500/10 text-amber-500">needs brand or URL</Badge>
                                ))}
                            </div>
                            <div className="flex items-center gap-2">
                              {!done && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setEditHints(hintsFromBucket(b));
                                    setEditBucket(b);
                                  }}
                                >
                                  Details
                                </Button>
                              )}
                            <Button
                              size="sm"
                              variant={done ? "ghost" : "default"}
                              disabled={busy || done}
                              onClick={() => void processBucket(focusedShowroom.id, b.id)}
                            >
                              {busy ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : done ? (
                                "Done"
                              ) : (
                                <>
                                  <Sparkles className="mr-1.5 size-4" />
                                  Process with AI
                                </>
                              )}
                            </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No buckets yet — group photos in step 3.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Select a showroom from the list.</p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between pt-4">
            <Button variant="ghost" onClick={() => setStep("3")}>
              Back
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Merge-into-bucket dialog. Base UI Dialog → block dismissal via the
          controlled onOpenChange guard (no Radix onInteractOutside prop). */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !savingBucket && setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge into bucket</DialogTitle>
            <DialogDescription>
              Group {selectedPhotoIds.size} photo{selectedPhotoIds.size === 1 ? "" : "s"} into one product bucket.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <div className="flex gap-2">
                {(["single", "multi"] as const).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={bucketKind === k ? "default" : "outline"}
                    onClick={() => setBucketKind(k)}
                  >
                    {k === "single" ? "Single product" : "Multiple angles"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bucket-label">Label (optional)</Label>
              <Input
                id="bucket-label"
                value={bucketLabel}
                onChange={(e) => setBucketLabel(e.target.value)}
                placeholder="e.g. Calacatta Viola slab"
              />
            </div>
            <BucketHintFields hints={bucketHints} onChange={setBucketHints} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={savingBucket}>
              Cancel
            </Button>
            <Button onClick={() => void createBucket()} disabled={savingBucket}>
              {savingBucket ? <Loader2 className="size-4 animate-spin" /> : "Create bucket"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit-details dialog for an existing stack (Phase A′). */}
      <Dialog open={editBucket != null} onOpenChange={(open) => !savingEdit && !open && setEditBucket(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stack details</DialogTitle>
            <DialogDescription>
              Brand and product hints for {editBucket?.label ? `"${editBucket.label}"` : "this stack"}. All optional —
              they give the intake workflow a warm start.
            </DialogDescription>
          </DialogHeader>
          <BucketHintFields hints={editHints} onChange={setEditHints} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditBucket(null)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button onClick={() => void saveEditBucket()} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="size-4 animate-spin" /> : "Save details"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Multi-product masking: draw a box per product → one single bucket each. */}
      {maskBucket && (
        <MultiProductMasker
          open={maskBucket != null}
          bucketId={maskBucket.bucketId}
          photoId={maskBucket.photoId}
          imageUrl={maskBucket.imageUrl}
          onOpenChange={(open) => !open && setMaskBucket(null)}
          onDone={() => {
            if (focusedId != null) {
              void refreshPhotos(focusedId);
              void refreshBuckets(focusedId);
            }
          }}
        />
      )}
    </div>
  );
}
