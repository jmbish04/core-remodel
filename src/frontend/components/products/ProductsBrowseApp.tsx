/**
 * @fileoverview ProductsBrowseApp — the browse + filter experience for
 * `/admin/shopping/products` (subsystem B, replaces GlobalProductsLanding).
 *
 * Layout:
 *   - Top: a 3-mode browse-by segmented control — "By category" (default),
 *     "By room", "Needs product".
 *   - Left: <FilterSidebar>, whose `sections` are built dynamically from the
 *     `facets` returned by GET /api/products/catalog (a checkbox section per
 *     facet — brands & productTypes — a price range section, and button
 *     sections for purchased / wishlisted).
 *   - Right: a product grid of cards (image, name, brand, type, min price,
 *     purchased / wishlisted badges, per-card add-to-wishlist). Cards link to
 *     the PDP at /admin/products/:id.
 *
 * Modes:
 *   - By category → category chips set the `productType` query param.
 *   - By room     → RoomSelect passes `roomId` (currently a server-side no-op;
 *     a "room filtering coming soon" hint is shown). Grid still renders.
 *   - Needs product → renders the `materialsNeedingProduct` list (title + room)
 *     instead of the grid; no filtering.
 *
 * All data is real: GET /api/products/browse (toggle data) + GET
 * /api/products/catalog (grid + facets), both fetched with credentials. Search
 * is debounced 250ms; errors route through sonner toast — never swallowed.
 *
 * Monolith house style: dark surfaces via bg-card / bg-background, separation
 * via `ring-1 ring-border/40` — never raw 1px borders.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  DoorOpen,
  Heart,
  Info,
  Loader2,
  PackageSearch,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RoomSelect } from "@/components/ui/room-select";
import { AddToWishlistButton } from "@/components/products/AddToWishlistButton";
import { FilterSidebar, type FilterSection } from "@/components/products/FilterSidebar";

// ─── Types (mirror the API response shapes) ─────────────────────────────────

interface BrowseRoom {
  id: number;
  roomName: string;
}
interface BrowseCategory {
  value: string;
  label: string;
}
interface MaterialNeedingProduct {
  materialId: number;
  title: string;
  roomName: string | null;
}
interface BrowseData {
  rooms: BrowseRoom[];
  categories: BrowseCategory[];
  materialsNeedingProduct: MaterialNeedingProduct[];
}

interface CatalogProduct {
  id: number;
  itemName: string;
  brandId: number | null;
  brandName: string | null;
  productType: string | null;
  imageUrl: string | null;
  msrp: string | null;
  msrpCents: number | null;
  minPriceCents: number | null;
  colors: string | null;
  userRating: number | null;
  isPurchased: boolean;
  isWishlisted: boolean;
}
interface FacetOption {
  value: string;
  label: string;
  count: number;
}
interface CatalogFacets {
  brands: FacetOption[];
  productTypes: FacetOption[];
  priceRange: { min: number | null; max: number | null };
  purchasedCount: number;
  wishlistedCount: number;
  total: number;
}
interface CatalogResponse {
  products: CatalogProduct[];
  facets: CatalogFacets;
}

type BrowseMode = "category" | "room" | "needs";

// ─── Fetch helper ───────────────────────────────────────────────────────────

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Cents → "$1,234" (whole dollars; no cents shown for catalog pricing). */
function formatCents(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

// ─── Applied-filter state (what the sidebar hands back via onApply) ─────────

interface AppliedFilters {
  brandId: string[];
  productTypes: string[];
  purchased: "yes" | "no" | null;
  wishlisted: "yes" | "no" | null;
  price: [number, number] | null;
}

const EMPTY_FILTERS: AppliedFilters = {
  brandId: [],
  productTypes: [],
  purchased: null,
  wishlisted: null,
  price: null,
};

const MODES: { id: BrowseMode; label: string; icon: typeof Boxes }[] = [
  { id: "category", label: "By category", icon: Boxes },
  { id: "room", label: "By room", icon: DoorOpen },
  { id: "needs", label: "Needs product", icon: PackageSearch },
];

export function ProductsBrowseApp() {
  const [mode, setMode] = useState<BrowseMode>("category");
  const [browse, setBrowse] = useState<BrowseData | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryType, setCategoryType] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<number | null>(null);
  const [applied, setApplied] = useState<AppliedFilters>(EMPTY_FILTERS);

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Browse toggle data (rooms / categories / materials-needing-product) ──
  useEffect(() => {
    api<BrowseData>("/api/products/browse")
      .then(setBrowse)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load browse data"));
  }, []);

  // ── Debounce search ──
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // ── Fetch catalog whenever filters change (skipped in "needs" mode) ──
  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      // Category chip (single) OR sidebar productType selection — sidebar wins.
      const productType = applied.productTypes[0] ?? categoryType;
      if (productType) params.set("productType", productType);
      if (applied.brandId.length) params.set("brandId", applied.brandId.join(","));
      if (applied.purchased) params.set("purchased", applied.purchased);
      if (applied.wishlisted) params.set("wishlisted", applied.wishlisted);
      if (applied.price) {
        params.set("priceMin", String(applied.price[0]));
        params.set("priceMax", String(applied.price[1]));
      }
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      if (mode === "room" && roomId != null) params.set("roomId", String(roomId));
      const data = await api<CatalogResponse>(`/api/products/catalog?${params.toString()}`);
      setCatalog(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [applied, categoryType, debouncedSearch, mode, roomId]);

  useEffect(() => {
    if (mode === "needs") {
      setLoading(false);
      return;
    }
    void fetchCatalog();
  }, [fetchCatalog, mode]);

  // ── Build sidebar sections from the current facets. Price uses CENTS to
  //    match the API's priceMin/priceMax contract. ──
  const facets = catalog?.facets;
  const sections = useMemo<FilterSection[]>(() => {
    if (!facets) return [];
    const out: FilterSection[] = [];
    if (facets.brands.length) {
      out.push({
        id: "brandId",
        title: "Brand",
        type: "checkbox",
        options: facets.brands.map((b) => ({ label: b.label, value: b.value, count: b.count })),
      });
    }
    if (facets.productTypes.length) {
      out.push({
        id: "productTypes",
        title: "Product type",
        type: "checkbox",
        options: facets.productTypes.map((t) => ({ label: t.label, value: t.value, count: t.count })),
      });
    }
    if (facets.priceRange.min != null && facets.priceRange.max != null && facets.priceRange.min < facets.priceRange.max) {
      out.push({
        id: "price",
        title: "Price (min)",
        type: "range",
        min: facets.priceRange.min,
        max: facets.priceRange.max,
        step: 100,
      });
    }
    out.push({
      id: "purchased",
      title: `Purchased (${facets.purchasedCount})`,
      type: "button",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    });
    out.push({
      id: "wishlisted",
      title: `Wishlisted (${facets.wishlistedCount})`,
      type: "button",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    });
    return out;
  }, [facets]);

  // The sidebar hands back a Record<sectionId, string[]> + [min,max] price.
  const handleApply = useCallback(
    (selected: Record<string, string[]>, price: [number, number]) => {
      const priceSection = sections.find((s) => s.id === "price");
      const priceChanged =
        priceSection && (price[0] !== priceSection.min || price[1] !== priceSection.max);
      setApplied({
        brandId: selected.brandId ?? [],
        productTypes: selected.productTypes ?? [],
        // "button" sections are multi-select in the sidebar; treat first pick as the value.
        purchased: (selected.purchased?.[0] as "yes" | "no") ?? null,
        wishlisted: (selected.wishlisted?.[0] as "yes" | "no") ?? null,
        price: priceChanged ? price : null,
      });
    },
    [sections],
  );

  const products = catalog?.products ?? [];
  const showGrid = mode !== "needs";

  return (
    <main className="container mx-auto max-w-7xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse every product across all brands. Filter by brand, type, price, and purchase status.
        </p>
      </header>

      {/* Browse-by segmented control */}
      <div className="mb-5 inline-flex flex-wrap gap-1 rounded-lg bg-card p-1 ring-1 ring-border/40">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <Button
              key={m.id}
              size="sm"
              variant={active ? "default" : "ghost"}
              onClick={() => setMode(m.id)}
              className="gap-1.5"
              aria-pressed={active}
            >
              <Icon className="h-4 w-4" />
              {m.label}
            </Button>
          );
        })}
      </div>

      {/* Secondary control row (mode-specific) */}
      {mode === "category" && browse && browse.categories.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5" aria-label="Categories">
          <Button
            size="sm"
            variant={categoryType === null ? "default" : "outline"}
            onClick={() => setCategoryType(null)}
          >
            All categories
          </Button>
          {browse.categories.map((cat) => (
            <Button
              key={cat.value}
              size="sm"
              variant={categoryType === cat.value ? "default" : "outline"}
              onClick={() => setCategoryType(cat.value)}
            >
              {cat.label}
            </Button>
          ))}
        </div>
      )}

      {mode === "room" && (
        <div className="mb-5 flex flex-col gap-2">
          <div className="max-w-xs">
            <RoomSelect
              value={roomId}
              onChange={setRoomId}
              includeAllOption
              allOptionLabel="All rooms"
              aria-label="Browse by room"
            />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" /> Room filtering is coming soon — products aren&apos;t narrowed by room yet.
          </p>
        </div>
      )}

      {/* Needs-product list */}
      {mode === "needs" && (
        <NeedsProductList materials={browse?.materialsNeedingProduct ?? null} />
      )}

      {/* Browse + filter body (grid modes only) */}
      {showGrid && (
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Sidebar */}
          <div className="lg:w-72 lg:shrink-0">
            {sections.length > 0 ? (
              <FilterSidebar
                key={mode + categoryType}
                sections={sections}
                // Seed from applied state so the sidebar's checkboxes/slider stay
                // in sync with the active query when it remounts on mode/category change.
                initialFilters={{
                  brandId: applied.brandId,
                  productTypes: applied.productTypes,
                  purchased: applied.purchased ? [applied.purchased] : [],
                  wishlisted: applied.wishlisted ? [applied.wishlisted] : [],
                }}
                initialPriceRange={applied.price ?? undefined}
                onApply={handleApply}
              />
            ) : null}
          </div>

          {/* Right column: search + grid */}
          <div className="min-w-0 flex-1">
            <div className="relative mb-5 max-w-md">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>

            {loading ? (
              <ProductGridSkeleton />
            ) : products.length === 0 ? (
              <Card>
                <CardContent className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
                  No products match.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

// ─── Product card ───────────────────────────────────────────────────────────

function ProductCard({ product: p }: { product: CatalogProduct }) {
  const price = formatCents(p.minPriceCents);
  return (
    <a href={`/admin/products/${p.id}`} className="block">
      <Card className="h-full overflow-hidden transition-colors hover:bg-muted/40">
        <div className="relative aspect-[4/3] w-full bg-muted/40">
          {p.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.imageUrl}
              alt={p.itemName}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Boxes className="h-8 w-8" />
            </div>
          )}
          <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
            {p.isPurchased && (
              <Badge className="bg-emerald-500/15 text-emerald-400 font-medium">Purchased</Badge>
            )}
            {p.isWishlisted && (
              <Badge className="bg-rose-500/15 text-rose-400 font-medium">
                <Heart className="mr-1 h-3 w-3 fill-current" /> Wishlisted
              </Badge>
            )}
          </div>
        </div>
        <CardContent className="space-y-1.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 truncate font-medium">{p.itemName}</span>
            {price && (
              <span className="shrink-0 font-mono text-sm tabular-nums text-emerald-400">{price}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {p.brandName && <span className="truncate">{p.brandName}</span>}
            {p.productType && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {p.productType}
              </Badge>
            )}
          </div>
          <div className="flex justify-end pt-1">
            <AddToWishlistButton productId={p.id} />
          </div>
        </CardContent>
      </Card>
    </a>
  );
}

// ─── Needs-product list ─────────────────────────────────────────────────────

function NeedsProductList({ materials }: { materials: MaterialNeedingProduct[] | null }) {
  if (materials === null) {
    return (
      <div className="flex min-h-[160px] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (materials.length === 0) {
    return (
      <Card>
        <CardContent className="flex min-h-[140px] items-center justify-center text-sm text-muted-foreground">
          Every material has a registered product. Nothing needs sourcing.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
      <ul className="divide-y divide-border/40">
        {materials.map((m) => (
          <li key={m.materialId} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <PackageSearch className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{m.title}</span>
            </div>
            {m.roomName && (
              <Badge variant="outline" className="shrink-0 text-xs text-muted-foreground">
                {m.roomName}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Loading skeleton ───────────────────────────────────────────────────────

function ProductGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
          <div className="aspect-[4/3] w-full animate-pulse bg-muted/40" />
          <div className="space-y-2 p-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted/40" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted/40" />
          </div>
        </div>
      ))}
    </div>
  );
}
