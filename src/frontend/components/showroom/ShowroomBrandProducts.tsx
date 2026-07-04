/**
 * @fileoverview ShowroomBrandProducts — the Showroom↔Brand split viewport.
 *
 * Given a showroom + a brand, splits that brand's products into two surfaces:
 *
 *   Section A — Associated: full-color image cards for products already mapped
 *     to this showroom. A count badge; each card shows a disabled "Associated"
 *     (Check) affordance. When empty, a dashed-ring empty state invites the user
 *     to promote products from Section B.
 *
 *   Section B — Available (unassociated): the brand's remaining catalog, shown
 *     grayscale + faded + softly blurred (so the eye reads them as "dormant").
 *     Hovering restores full color/sharpness; clicking a card associates that
 *     product with the showroom (optimistically hoisting it into Section A). An
 *     "Associate All" button promotes the whole remaining catalog at once.
 *
 * Data + mutations use the plain fetch+useState house pattern (no react-query),
 * sonner toasts, lucide glyphs, and Monolith surfaces (bg-card / ring-border/40 /
 * semantic tints — never raw zinc or 1px borders).
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, ImageOff, Loader2, Package, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandProduct {
  id: number;
  name: string;
  imageUrl: string | null;
}

interface SplitResponse {
  brandName: string;
  showroomName: string;
  associated: BrandProduct[];
  unassociated: BrandProduct[];
}

// ─── Fetch helper (mirrors the house `api<T>`) ──────────────────────────────────

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ─── Product image with graceful fallback ───────────────────────────────────────

function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className="flex aspect-square w-full items-center justify-center bg-muted/40 text-muted-foreground"
        aria-hidden
      >
        <ImageOff className="size-8 opacity-60" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="aspect-square w-full bg-muted/40 object-cover"
    />
  );
}

// ─── Associated card (full color, disabled "Associated" state) ──────────────────

function AssociatedCard({ product }: { product: BrandProduct }) {
  return (
    <div className="group overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
      <ProductImage src={product.imageUrl} alt={product.name} />
      <div className="flex items-center justify-between gap-2 p-3">
        <span className="min-w-0 truncate text-sm font-medium" title={product.name}>
          {product.name}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
          <Check className="size-3" />
          Associated
        </span>
      </div>
    </div>
  );
}

// ─── Available card (grayscale + blur, un-blurs on hover; click to associate) ───

function AvailableCard({
  product,
  pending,
  onAssociate,
}: {
  product: BrandProduct;
  pending: boolean;
  onAssociate: (product: BrandProduct) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onAssociate(product)}
      disabled={pending}
      aria-label={`Associate ${product.name} with this showroom`}
      className="group relative overflow-hidden rounded-xl bg-card text-left ring-1 ring-border/40 transition-all hover:ring-primary/40 disabled:cursor-wait"
    >
      {/* Media dims/blurs/desaturates until hover (or while its own request is in-flight). */}
      <div
        className={`transition-all duration-300 ${
          pending
            ? "opacity-100 blur-none grayscale-0"
            : "opacity-60 blur-[2px] grayscale group-hover:opacity-100 group-hover:blur-none group-hover:grayscale-0"
        }`}
      >
        <ProductImage src={product.imageUrl} alt={product.name} />
      </div>

      {/* Hover "＋ Associate" scrim. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40 opacity-0 transition-opacity group-hover:opacity-100">
        {pending ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-card/90 px-2.5 py-1 text-xs font-medium ring-1 ring-border/40">
            <Loader2 className="size-3.5 animate-spin" />
            Associating…
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm">
            <Plus className="size-3.5" />
            Associate
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 p-3">
        <span className="min-w-0 truncate text-sm font-medium text-muted-foreground group-hover:text-foreground" title={product.name}>
          {product.name}
        </span>
        {pending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Plus className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
        )}
      </div>
    </button>
  );
}

// ─── Main island ────────────────────────────────────────────────────────────────

export function ShowroomBrandProducts({
  showroomId,
  brandId,
}: {
  showroomId: number;
  brandId: number;
}) {
  const [data, setData] = useState<SplitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-card in-flight guard + a global "Associate All" flag.
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set());
  const [associatingAll, setAssociatingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<SplitResponse>(
        `/api/showroom-stores/${showroomId}/brands/${brandId}/products`,
      );
      setData({
        brandName: res.brandName ?? "Brand",
        showroomName: res.showroomName ?? "this showroom",
        associated: res.associated ?? [],
        unassociated: res.unassociated ?? [],
      });
    } catch (e) {
      console.error("[showroom-brand/load]", e);
      const msg = e instanceof Error ? e.message : "Failed to load brand products";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [showroomId, brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Associate a single product → optimistically hoist into Section A. ──────────
  const associateOne = useCallback(
    async (product: BrandProduct) => {
      if (pendingIds.has(product.id) || associatingAll) return;
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.add(product.id);
        return next;
      });
      try {
        const res = await fetch(`/api/showroom-stores/${showroomId}/mapped-products`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Associate failed (${res.status})`);
        }
        const payload = (await res.json().catch(() => ({}))) as { alreadyExists?: boolean };
        // Optimistically move it from unassociated → associated.
        setData((prev) =>
          prev
            ? {
                ...prev,
                unassociated: prev.unassociated.filter((p) => p.id !== product.id),
                associated: prev.associated.some((p) => p.id === product.id)
                  ? prev.associated
                  : [...prev.associated, product],
              }
            : prev,
        );
        toast.success(
          payload.alreadyExists
            ? `${product.name} was already associated`
            : `${product.name} associated`,
        );
      } catch (e) {
        console.error("[showroom-brand/associate-one]", e);
        toast.error(e instanceof Error ? e.message : "Failed to associate product");
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(product.id);
          return next;
        });
      }
    },
    [showroomId, pendingIds, associatingAll],
  );

  // ── Associate the whole remaining catalog → refetch for the authoritative split. ─
  const associateAll = useCallback(async () => {
    if (associatingAll) return;
    setAssociatingAll(true);
    try {
      const res = await fetch(
        `/api/showroom-stores/${showroomId}/brands/${brandId}/associate-all`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Associate all failed (${res.status})`);
      }
      const payload = (await res.json().catch(() => ({}))) as { added?: number };
      toast.success(
        payload.added && payload.added > 0
          ? `Associated ${payload.added} product${payload.added === 1 ? "" : "s"}`
          : "Everything is already associated",
      );
      await load();
    } catch (e) {
      console.error("[showroom-brand/associate-all]", e);
      toast.error(e instanceof Error ? e.message : "Failed to associate all products");
    } finally {
      setAssociatingAll(false);
    }
  }, [showroomId, brandId, associatingAll, load]);

  // ── Render states ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <a
          href={`/admin/shopping/store/${showroomId}`}
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Showroom
        </a>
        <div className="mt-6 rounded-xl bg-card p-8 text-center ring-1 ring-border/40">
          <p className="text-sm text-muted-foreground">
            {error ?? "Failed to load brand products."}
          </p>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </main>
    );
  }

  const { brandName, showroomName, associated, unassociated } = data;

  return (
    <main className="container mx-auto max-w-6xl px-4 py-10">
      {/* Back link */}
      <a
        href={`/admin/shopping/store/${showroomId}`}
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> {showroomName}
      </a>

      {/* Header */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {brandName} at {showroomName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Promote {brandName} products into this showroom. Faded items are available in the
            catalog but not yet associated.
          </p>
        </div>
        {unassociated.length > 0 ? (
          <Button size="sm" className="gap-1.5" onClick={associateAll} disabled={associatingAll}>
            {associatingAll ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Associate All ({unassociated.length})
          </Button>
        ) : null}
      </div>

      {/* ── Section A — Associated ──────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-base font-semibold">Associated with {showroomName}</h2>
          <Badge
            variant="secondary"
            className="px-1.5 py-0 text-[10px] font-normal text-emerald-400"
          >
            {associated.length}
          </Badge>
          <span className="ml-auto h-px flex-1 bg-border/40" />
        </div>

        {associated.length === 0 ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-card/40 p-8 text-center">
            <Package className="size-6 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              No {brandName} products associated yet.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Click a faded card below to promote it here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {associated.map((p) => (
              <AssociatedCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section B — Available (unassociated) ────────────────────────────────── */}
      <section className="mt-10">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-base font-semibold">Available in the {brandName} catalog</h2>
          <Badge
            variant="secondary"
            className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
          >
            {unassociated.length}
          </Badge>
          <span className="ml-auto h-px flex-1 bg-border/40" />
        </div>

        {unassociated.length === 0 ? (
          <div className="flex min-h-[120px] items-center justify-center rounded-xl bg-card p-8 text-center text-sm text-muted-foreground ring-1 ring-border/40">
            Every {brandName} product is associated with {showroomName}.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {unassociated.map((p) => (
              <AvailableCard
                key={p.id}
                product={p}
                pending={pendingIds.has(p.id)}
                onAssociate={associateOne}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
