/**
 * @fileoverview BrandDetailViewport — single-brand admin viewport.
 *
 * Client island mounted at /admin/shopping/brands/:id. Fetches `GET /api/brands/:id` on
 * mount and answers "which showrooms carry this brand" up top, then surfaces:
 *   - a hero (favicon + name, website/Instagram out-links, online + user
 *     rating stars, an Edit dialog → PUT /api/brands/:id),
 *   - a prominent showrooms panel (each linking to /admin/shopping/store/:id),
 *   - a personal-notes Textarea with a "Save Notes" button → PUT { personalNotes },
 *   - a products grid (image w/ onError fallback, name, productType badge).
 *
 * Monolith dark: no 1px borders (bg-card, ring-1 ring-border/40), sonner
 * toasts, no mock data, loading/empty/error states, mobile responsive.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Globe,
  ImageOff,
  Layers,
  Loader2,
  MapPin,
  PackageSearch,
  Pencil,
  Play,
  RotateCcw,
  Save,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EntityDocumentsPanel } from "@/components/documents";
import { SocialLinks } from "@/components/showroom/hero";
import { MarkdownProse } from "@/components/research/MarkdownProse";

// ─── Types ──────────────────────────────────────────────────────────────────

interface BrandDetail {
  id: number;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  pinterestUrl: string | null;
  iconCfImagesUrl: string | null;
  personalNotes: string | null;
  onlineRating: number | null;
  userRating: number | null;
}

type ResearchStatus = "idle" | "pending" | "running" | "complete" | "failed";

interface BigboxRetailer {
  name: string;
  url?: string | null;
  notes?: string | null;
}

interface BigboxAvailability {
  retailers: BigboxRetailer[];
  onlineOnly?: boolean | null;
  rationale: string | null;
}

/** AI-derived brand intel; null for brands that predate the research workflow. */
interface BrandIntel {
  reviewSummary: string | null;
  isBigboxAvailable: boolean | null;
  bigboxAvailability: BigboxAvailability | null;
  salesIntel: string | null;
  researchReport: string | null;
  researchSources: string | null;
  researchStatus: ResearchStatus;
}

interface ProductLine {
  id: number;
  name: string;
  description: string | null;
  productType: string | null;
  sourceUrl: string | null;
  sortOrder: number | null;
}

interface BrandImage {
  id: number;
  deliveryUrl: string;
  altText: string | null;
  imageKind: string | null;
  reviewStatus: string | null;
}

interface BrandTypeRow {
  typeId: number;
  typeName: string;
}

interface ShowroomRow {
  id: number;
  name: string;
  locationAddress: string | null;
}

interface ProductRow {
  id: number;
  itemName: string;
  productType: string | null;
  imageUrl: string | null;
}

interface BrandDetailResponse {
  brand: BrandDetail;
  types: BrandTypeRow[];
  showrooms: ShowroomRow[];
  products: ProductRow[];
  productCount: number;
  intel: BrandIntel | null;
  productLines: ProductLine[];
  images: BrandImage[];
}

function isResearchInFlight(status: ResearchStatus | null | undefined): boolean {
  return status === "pending" || status === "running";
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const AVATAR_COLORS = [
  "bg-rose-500/20 text-rose-300",
  "bg-amber-500/20 text-amber-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-sky-500/20 text-sky-300",
  "bg-violet-500/20 text-violet-300",
  "bg-fuchsia-500/20 text-fuchsia-300",
  "bg-cyan-500/20 text-cyan-300",
  "bg-lime-500/20 text-lime-300",
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Favicon / initials avatar (hero size) ─────────────────────────────────────

function BrandHeroIcon({ brand }: { brand: BrandDetail }) {
  const [broken, setBroken] = useState(false);
  if (brand.iconCfImagesUrl && !broken) {
    return (
      <img
        src={brand.iconCfImagesUrl}
        alt=""
        onError={() => setBroken(true)}
        className="size-16 shrink-0 rounded-xl bg-card object-contain p-1.5 ring-1 ring-border/40"
      />
    );
  }
  return (
    <div
      className={`flex size-16 shrink-0 items-center justify-center rounded-xl text-xl font-semibold ${avatarColor(brand.name)}`}
    >
      {brand.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ─── Rating stars (0–5, half-step aware) ───────────────────────────────────────

function RatingStars({
  value,
  label,
  variant,
}: {
  value: number;
  label: string;
  variant: "online" | "user";
}) {
  const color = variant === "online" ? "text-amber-300" : "text-primary";
  return (
    <div
      className="flex items-center gap-1.5"
      title={`${label}: ${value.toFixed(1)} / 5`}
    >
      <div className="flex items-center gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star
            key={i}
            className={`size-3.5 ${i < Math.round(value) ? `${color} fill-current` : "text-muted-foreground/30"}`}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        {value.toFixed(1)}
        <span className="ml-1 hidden text-[10px] uppercase tracking-wide text-muted-foreground/70 sm:inline">
          {label}
        </span>
      </span>
    </div>
  );
}

// ─── Product image w/ fallback ─────────────────────────────────────────────────

function ProductImage({ product }: { product: ProductRow }) {
  const [broken, setBroken] = useState(false);
  if (product.imageUrl && !broken) {
    return (
      <img
        src={product.imageUrl}
        alt={product.itemName}
        onError={() => setBroken(true)}
        className="aspect-square w-full rounded-lg bg-muted object-cover ring-1 ring-border/40"
      />
    );
  }
  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border/40">
      <ImageOff className="size-6" aria-label="No image" />
    </div>
  );
}

// ─── Research status chip ──────────────────────────────────────────────────────

function ResearchStatusChip({ status }: { status: ResearchStatus }) {
  const map: Record<ResearchStatus, { label: string; cls: string; spin?: boolean }> = {
    idle: { label: "Not researched", cls: "bg-muted/40 text-muted-foreground ring-border/40" },
    pending: { label: "Queued", cls: "bg-amber-500/10 text-amber-300 ring-amber-500/30", spin: true },
    running: { label: "Researching…", cls: "bg-amber-500/10 text-amber-300 ring-amber-500/30", spin: true },
    complete: { label: "Researched", cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" },
    failed: { label: "Research failed", cls: "bg-rose-500/10 text-rose-300 ring-rose-500/30" },
  };
  const { label, cls, spin } = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${cls}`}>
      {spin && <Loader2 className="size-3 animate-spin" />}
      {label}
    </span>
  );
}

// ─── Section wrapper (card) ─────────────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-2xl bg-card p-6 ring-1 ring-border/40">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ─── Photo w/ fallback (research imagery strip) ─────────────────────────────────

function BrandPhoto({ image, brandName }: { image: BrandImage; brandName: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="flex size-28 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border/40">
        <ImageOff className="size-5" aria-label="Image unavailable" />
      </div>
    );
  }
  return (
    <img
      src={image.deliveryUrl}
      alt={image.altText ?? brandName}
      loading="lazy"
      onError={() => setBroken(true)}
      className="size-28 shrink-0 rounded-lg bg-muted object-cover ring-1 ring-border/40"
    />
  );
}

// ─── Brand research enrichment (all null-intel-safe) ────────────────────────────

/**
 * Renders every enrichment section produced by `POST /api/brands/:id/research`.
 * When `intel` is null (pre-workflow brands) it shows an inviting "Not
 * researched yet — Run research" empty state rather than blank holes.
 */
function BrandEnrichment({
  intel,
  productLines,
  images,
  running,
  onRunResearch,
}: {
  intel: BrandIntel | null;
  productLines: ProductLine[];
  images: BrandImage[];
  running: boolean;
  onRunResearch: () => void;
}) {
  const status = intel?.researchStatus ?? "idle";
  const inFlight = running || isResearchInFlight(status);
  const visibleImages = images.filter((img) => img.reviewStatus !== "rejected");

  const runButton = (
    <div className="flex items-center gap-2">
      <ResearchStatusChip status={status} />
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={onRunResearch}
        disabled={inFlight}
      >
        {inFlight ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        {intel ? "Re-run" : "Run research"}
      </Button>
    </div>
  );

  // Pre-workflow: single inviting empty state carrying the run affordance.
  if (!intel) {
    return (
      <SectionCard icon={<Sparkles className="size-4 text-primary" />} title="Brand intelligence" action={runButton}>
        <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl bg-muted/20 p-6 text-center ring-1 ring-border/40">
          <Sparkles className="size-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            Not researched yet. Run research to surface a review summary, big-box
            availability, sales intel, and top product lines.
          </p>
        </div>
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard icon={<Sparkles className="size-4 text-primary" />} title="Brand intelligence" action={runButton}>
        {intel.reviewSummary ? (
          <Alert className="bg-muted/20 ring-1 ring-border/40">
            <Sparkles className="size-4 text-primary" />
            <AlertTitle>AI review summary</AlertTitle>
            <AlertDescription>{intel.reviewSummary}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">No review summary produced.</p>
        )}

        {/* Big-box warning — answers "why pay a showroom premium?" */}
        {intel.isBigboxAvailable && (
          <Alert className="mt-4 bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30">
            <TriangleAlert className="size-4 text-amber-300" />
            <AlertTitle className="text-amber-200">Available at big-box retail</AlertTitle>
            <AlertDescription className="text-amber-200/80">
              {intel.bigboxAvailability?.rationale ??
                "This brand is carried by big-box retailers — a showroom premium may not be justified."}
              {intel.bigboxAvailability?.onlineOnly && (
                <span className="mt-1 block text-xs text-amber-200/70">Online only.</span>
              )}
              {intel.bigboxAvailability?.retailers && intel.bigboxAvailability.retailers.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {intel.bigboxAvailability.retailers.map((r) =>
                    r.url ? (
                      <a
                        key={r.name}
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        title={r.notes ?? undefined}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-200 ring-1 ring-amber-500/30 hover:bg-amber-500/25"
                      >
                        <ShoppingBag className="size-3" />
                        {r.name}
                        <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span
                        key={r.name}
                        title={r.notes ?? undefined}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-200 ring-1 ring-amber-500/30"
                      >
                        <ShoppingBag className="size-3" />
                        {r.name}
                      </span>
                    ),
                  )}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Sales & specials */}
        {intel.salesIntel && (
          <div className="mt-4 rounded-xl bg-muted/20 p-4 ring-1 ring-border/40">
            <p className="mb-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Sales &amp; specials
            </p>
            <MarkdownProse>{intel.salesIntel}</MarkdownProse>
          </div>
        )}
      </SectionCard>

      {/* Top product lines */}
      {productLines.length > 0 && (
        <SectionCard icon={<Layers className="size-4 text-muted-foreground" />} title="Top product lines">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {productLines
              .slice()
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              .map((line) => (
                <article
                  key={line.id}
                  className="flex flex-col gap-1.5 rounded-xl bg-muted/20 p-4 ring-1 ring-border/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold tracking-tight">{line.name}</h3>
                    {line.sourceUrl && (
                      <a
                        href={line.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${line.name} source`}
                        className="shrink-0 text-sky-400 hover:text-sky-300"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                  {line.productType && (
                    <Badge variant="secondary" className="w-fit rounded-full text-[10px]">
                      {line.productType}
                    </Badge>
                  )}
                  {line.description && (
                    <p className="text-xs leading-relaxed text-muted-foreground">{line.description}</p>
                  )}
                </article>
              ))}
          </div>
        </SectionCard>
      )}

      {/* Research imagery strip */}
      {visibleImages.length > 0 && (
        <SectionCard icon={<ImageOff className="size-4 text-muted-foreground" />} title="Photos">
          <div className="flex gap-3 overflow-x-auto pb-1">
            {visibleImages.map((img) => (
              <BrandPhoto key={img.id} image={img} brandName="brand" />
            ))}
          </div>
        </SectionCard>
      )}
    </>
  );
}

// ─── Edit dialog ────────────────────────────────────────────────────────────────

interface EditForm {
  name: string;
  description: string;
  websiteUrl: string;
  instagramUrl: string;
  onlineRating: string;
  userRating: string;
}

function clampRating(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(0, n));
}

function EditBrandDialog({
  open,
  onOpenChange,
  brand,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brand: BrandDetail;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EditForm>(() => ({
    name: brand.name,
    description: brand.description ?? "",
    websiteUrl: brand.websiteUrl ?? "",
    instagramUrl: brand.instagramUrl ?? "",
    onlineRating: brand.onlineRating != null ? String(brand.onlineRating) : "",
    userRating: brand.userRating != null ? String(brand.userRating) : "",
  }));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: brand.name,
        description: brand.description ?? "",
        websiteUrl: brand.websiteUrl ?? "",
        instagramUrl: brand.instagramUrl ?? "",
        onlineRating: brand.onlineRating != null ? String(brand.onlineRating) : "",
        userRating: brand.userRating != null ? String(brand.userRating) : "",
      });
    }
  }, [open, brand]);

  const update = (patch: Partial<EditForm>) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Brand name is required");
      return;
    }
    setSubmitting(true);
    try {
      await apiJson<{ brand: BrandDetail }>(`/api/brands/${brand.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          websiteUrl: form.websiteUrl.trim() || null,
          instagramUrl: form.instagramUrl.trim() || null,
          onlineRating: clampRating(form.onlineRating),
          userRating: clampRating(form.userRating),
        }),
      });
      toast.success(`"${form.name.trim()}" updated`);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update brand");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Brand</DialogTitle>
          <DialogDescription>
            Update this brand's details, links, and ratings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="e-name">Name *</Label>
            <Input
              id="e-name"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Kohler"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="e-desc">Description</Label>
            <Textarea
              id="e-desc"
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="What this brand supplies."
              rows={2}
            />
          </div>
          <div>
            <Label htmlFor="e-web">Website</Label>
            <Input
              id="e-web"
              value={form.websiteUrl}
              onChange={(e) => update({ websiteUrl: e.target.value })}
              placeholder="https://…"
            />
          </div>
          <div>
            <Label htmlFor="e-ig">Instagram</Label>
            <Input
              id="e-ig"
              value={form.instagramUrl}
              onChange={(e) => update({ instagramUrl: e.target.value })}
              placeholder="https://instagram.com/…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="e-online">Online rating (0–5)</Label>
              <Input
                id="e-online"
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={form.onlineRating}
                onChange={(e) => update({ onlineRating: e.target.value })}
                placeholder="e.g. 4.5"
              />
            </div>
            <div>
              <Label htmlFor="e-user">Your rating (0–5)</Label>
              <Input
                id="e-user"
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={form.userRating}
                onChange={(e) => update({ userRating: e.target.value })}
                placeholder="e.g. 5"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !form.name.trim()}>
            {submitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main viewport ──────────────────────────────────────────────────────────────

export function BrandDetailViewport({ brandId }: { brandId: number }) {
  const [data, setData] = useState<BrandDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);

  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBrand = useCallback(async () => {
    setError(null);
    try {
      const res = await apiJson<BrandDetailResponse>(`/api/brands/${brandId}`);
      setData(res);
      setNotes(res.brand.personalNotes ?? "");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load brand";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void fetchBrand();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [fetchBrand]);

  // Poll while brand research is in flight, then settle.
  useEffect(() => {
    const status = data?.intel?.researchStatus;
    if (!isResearchInFlight(status)) {
      setRunning(false);
      return;
    }
    pollRef.current = setTimeout(() => {
      void fetchBrand();
    }, 4000);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [data, fetchBrand]);

  const runResearch = useCallback(async () => {
    setRunning(true);
    try {
      await apiJson(`/api/brands/${brandId}/research`, { method: "POST" });
      toast.success("Research queued");
      await fetchBrand();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to queue research";
      if (/409|already|running/i.test(msg)) {
        toast.message("Research is already running");
      } else {
        toast.error(msg);
        setRunning(false);
      }
    }
  }, [brandId, fetchBrand]);

  const saveNotes = async () => {
    if (!data) return;
    setSavingNotes(true);
    try {
      await apiJson<{ brand: BrandDetail }>(`/api/brands/${brandId}`, {
        method: "PUT",
        body: JSON.stringify({ personalNotes: notes.trim() || null }),
      });
      toast.success("Notes saved");
      setData((d) =>
        d ? { ...d, brand: { ...d.brand, personalNotes: notes.trim() || null } } : d,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save notes");
    } finally {
      setSavingNotes(false);
    }
  };

  const notesDirty = useMemo(
    () => (data ? notes !== (data.brand.personalNotes ?? "") : false),
    [notes, data],
  );

  if (loading) {
    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <a
          href="/admin/shopping/brands"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Brands
        </a>
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-lg bg-card p-6 text-center ring-1 ring-border/40">
          <p className="text-sm text-muted-foreground">{error ?? "Brand not found."}</p>
          <Button size="sm" variant="outline" onClick={() => void fetchBrand()}>
            <RotateCcw className="mr-1.5 size-3.5" />
            Retry
          </Button>
        </div>
      </main>
    );
  }

  const { brand, types, showrooms, products, productCount, intel, productLines, images } = data;

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <a
        href="/admin/shopping/brands"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Brands
      </a>

      {/* Hero */}
      <section className="rounded-2xl bg-card p-6 ring-1 ring-border/40">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <BrandHeroIcon brand={brand} />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                {brand.name}
              </h1>
              {brand.description && (
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                  {brand.description}
                </p>
              )}

              {/* Type badges */}
              {types.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {types.map((t) => (
                    <Badge
                      key={t.typeId}
                      variant="secondary"
                      className="rounded-full text-[10px] font-medium"
                    >
                      {t.typeName}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Links + ratings */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {brand.websiteUrl && (
                  <a
                    href={brand.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Globe className="size-4" />
                    Website
                  </a>
                )}
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <PackageSearch className="size-4" />
                  {productCount} {productCount === 1 ? "product" : "products"}
                </span>

                {/* Social icon row (Instagram / Facebook / Pinterest) */}
                <SocialLinks
                  instagramUrl={brand.instagramUrl}
                  facebookUrl={brand.facebookUrl}
                  pinterestUrl={brand.pinterestUrl}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                {typeof brand.onlineRating === "number" && brand.onlineRating > 0 && (
                  <RatingStars value={brand.onlineRating} label="Online" variant="online" />
                )}
                {typeof brand.userRating === "number" && brand.userRating > 0 && (
                  <RatingStars value={brand.userRating} label="Yours" variant="user" />
                )}
              </div>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        </div>

        {/* Showrooms panel — answers "which showrooms carry this brand" */}
        <div className="mt-6 rounded-xl bg-muted/20 p-4 ring-1 ring-border/40">
          <div className="mb-3 flex items-center gap-2">
            <Store className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-tight">Showrooms carrying this brand</h2>
            <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[10px]">
              {showrooms.length}
            </Badge>
          </div>
          {showrooms.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No registered showrooms carry this brand.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {showrooms.map((sr) => (
                <a
                  key={sr.id}
                  href={`/admin/shopping/store/${sr.id}`}
                  className="group flex items-start gap-3 rounded-lg bg-card p-3 ring-1 ring-border/40 transition-colors hover:bg-muted/30"
                >
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-medium group-hover:text-foreground">
                      {sr.name}
                    </p>
                    {sr.locationAddress && (
                      <p className="mt-0.5 line-clamp-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3 shrink-0" />
                        {sr.locationAddress}
                      </p>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* AI brand intelligence (research workflow) */}
      <BrandEnrichment
        intel={intel}
        productLines={productLines}
        images={images}
        running={running}
        onRunResearch={() => void runResearch()}
      />

      {/* Personal notes */}
      <section className="mt-6 rounded-2xl bg-card p-6 ring-1 ring-border/40">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">Personal notes</h2>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => void saveNotes()}
            disabled={savingNotes || !notesDirty}
          >
            {savingNotes ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save Notes
          </Button>
        </div>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Your private notes on this brand — pricing, contacts, lead times, quality impressions…"
          rows={5}
        />
      </section>

      {/* Products grid */}
      <section className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <PackageSearch className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Products</h2>
          <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[10px]">
            {products.length}
          </Badge>
        </div>
        {products.length === 0 ? (
          <div className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl bg-card p-6 text-center ring-1 ring-border/40">
            <ImageOff className="size-6 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              No products saved for this brand yet.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <article
                key={p.id}
                className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-border/40 transition-colors hover:bg-muted/20"
              >
                <ProductImage product={p} />
                <div className="min-w-0">
                  <h3 className="line-clamp-2 text-xs font-medium">{p.itemName}</h3>
                  {p.productType && (
                    <Badge
                      variant="secondary"
                      className="mt-1.5 rounded-full text-[10px] font-medium"
                    >
                      {p.productType}
                    </Badge>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Documents linked to this brand */}
      <div className="mt-6">
        <EntityDocumentsPanel entityType="brand" entityId={String(brandId)} />
      </div>

      <EditBrandDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        brand={brand}
        onSaved={fetchBrand}
      />
    </main>
  );
}
