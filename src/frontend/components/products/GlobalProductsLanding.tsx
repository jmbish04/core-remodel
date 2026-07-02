/**
 * @fileoverview GlobalProductsLanding — the Global Products hub.
 *
 * One grid of every product across all brands/showrooms, regroupable on the fly
 * by Type / Brand / Showroom. Each card links to the shared product viewport at
 * `/admin/products/<id>`. Client island: fetches on mount, filters client-side.
 *
 * Monolith house style (mirrors ShowroomsDirectoryApp): dark surfaces via
 * `bg-card` / `bg-background`, separation via `ring-1 ring-border/40` — never raw
 * zinc palettes or 1px borders.
 */

import { useEffect, useMemo, useState } from "react";
import { Layers, ListFilter, Loader2, MapPin, RotateCcw, Search, Star } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: number;
  name: string;
  brandId: number | null;
  brandName: string | null;
  storeId: number | null;
  storeName: string | null;
  productType: string | null;
  imageUrl: string | null;
  userRating: number | null;
  onlineRating: number | null;
}

type GroupBy = "type" | "brand" | "showroom";

const UNASSIGNED = "Unassigned";

// ─── Data ─────────────────────────────────────────────────────────────────────

async function fetchProducts(): Promise<Product[]> {
  const res = await fetch("/api/showroom-products", { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  const data = (await res.json()) as { products: Product[] };
  return (data.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    brandId: p.brandId ?? null,
    brandName: p.brandName ?? null,
    storeId: p.storeId ?? null,
    storeName: p.storeName ?? null,
    productType: p.productType ?? null,
    imageUrl: p.imageUrl ?? null,
    userRating: p.userRating ?? null,
    onlineRating: p.onlineRating ?? null,
  }));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Star rating chip — only rendered when a rating is present. */
function RatingChip({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-300">
      <Star className="size-3 fill-amber-400 text-amber-400" />
      {rating.toFixed(1)}
    </span>
  );
}

/** Product image with a graceful placeholder fallback on load error. */
function ProductImage({ product }: { product: Product }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(product.imageUrl) && !broken;
  return (
    <div className="aspect-square w-full overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border/40">
      {showImage ? (
        <img
          src={product.imageUrl as string}
          alt={product.name}
          loading="lazy"
          onError={() => setBroken(true)}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground/40">
          <Layers className="size-8" />
        </div>
      )}
    </div>
  );
}

/**
 * A single product card. The whole card is a link to the viewport; the
 * `secondary` line shows the "other" dimension (e.g. product type when grouped
 * by brand, brand otherwise).
 */
function ProductCard({ product, secondary }: { product: Product; secondary: string | null }) {
  return (
    <a
      href={`/admin/products/${product.id}`}
      className="group flex flex-col gap-2 rounded-xl bg-card p-2.5 ring-1 ring-border/40 transition-colors hover:bg-muted/40"
    >
      <ProductImage product={product} />
      <div className="min-w-0 px-0.5 pb-0.5">
        <p className="truncate text-sm font-medium text-foreground" title={product.name}>
          {product.name}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          {secondary ? (
            <span className="truncate text-[11px] text-muted-foreground" title={secondary}>
              {secondary}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/50">—</span>
          )}
          {product.userRating !== null && <RatingChip rating={product.userRating} />}
        </div>
      </div>
    </a>
  );
}

function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-base font-semibold">{label}</h2>
      <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {count}
      </span>
      <span className="ml-auto h-px flex-1 bg-border/40" />
    </div>
  );
}

/** Loading skeleton — a couple of stubbed group sections. */
function LoadingSkeleton() {
  return (
    <div className="space-y-10">
      {[0, 1].map((s) => (
        <section key={s}>
          <div className="mb-3 flex items-center gap-3">
            <div className="h-5 w-40 animate-pulse rounded bg-muted/60" />
            <span className="ml-auto h-px flex-1 bg-border/40" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-card p-2.5 ring-1 ring-border/40">
                <div className="aspect-square w-full animate-pulse rounded-lg bg-muted/60" />
                <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-muted/60" />
                <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-muted/40" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

/** Resolve the group-key label for a product under the active grouping. */
function groupKeyFor(product: Product, groupBy: GroupBy): string {
  if (groupBy === "type") return product.productType ?? UNASSIGNED;
  if (groupBy === "brand") return product.brandName ?? UNASSIGNED;
  return product.storeName ?? UNASSIGNED;
}

/**
 * The "other" dimension shown on the card's secondary line. Grouping by brand
 * surfaces the product type; every other grouping surfaces the brand name.
 */
function secondaryFor(product: Product, groupBy: GroupBy): string | null {
  if (groupBy === "brand") return product.productType;
  return product.brandName;
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export function GlobalProductsLanding() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("type");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setProducts(await fetchProducts());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load products";
      console.error("[GlobalProductsLanding] load failed:", e);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.brandName ?? "").toLowerCase().includes(q),
    );
  }, [products, search]);

  /** Ordered [label, products][] under the active grouping — larger groups first, Unassigned last. */
  const groups = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const key = groupKeyFor(p, groupBy);
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()].sort((a, b) => {
      const aUn = a[0] === UNASSIGNED;
      const bUn = b[0] === UNASSIGNED;
      if (aUn !== bUn) return aUn ? 1 : -1; // Unassigned last
      if (b[1].length !== a[1].length) return b[1].length - a[1].length; // larger first
      return a[0].localeCompare(b[0]);
    });
  }, [filtered, groupBy]);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-10">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Global Products</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every product across all brands and showrooms, in one grid. Regroup on the fly and jump
          into any product's viewport.
        </p>
      </div>

      {/* Filter card */}
      <div className="mb-6 flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-border/40 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search products or brands…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-[10px] uppercase tracking-wider text-muted-foreground/70 sm:inline">
            Group by
          </span>
          <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <TabsList>
              <TabsTrigger value="type">
                <Layers className="size-3.5" />
                Type
              </TabsTrigger>
              <TabsTrigger value="brand">
                <ListFilter className="size-3.5" />
                Brand
              </TabsTrigger>
              <TabsTrigger value="showroom">
                <MapPin className="size-3.5" />
                Showroom
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border/40">
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary ring-1 ring-primary/30 transition hover:bg-primary/20"
          >
            <RotateCcw className="size-3.5" />
            Retry
          </button>
        </div>
      ) : products.length === 0 ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl bg-card p-8 text-center ring-1 ring-border/40">
          <Layers className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No products yet.</p>
          <p className="text-xs text-muted-foreground/70">
            Products appear here once brands and showrooms have been catalogued.
          </p>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
          No products match "{search.trim()}".
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map(([label, groupProducts]) => (
            <section key={label}>
              <GroupHeader label={label} count={groupProducts.length} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {groupProducts.map((p) => (
                  <ProductCard key={p.id} product={p} secondary={secondaryFor(p, groupBy)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
