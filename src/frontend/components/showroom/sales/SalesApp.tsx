/**
 * @fileoverview SalesApp — /admin/shopping/sales.
 *
 * Layout is search-bar-over-content with a collapsible filter rail on the left:
 *
 *   [------------- search -------------]
 *   [ filters ][ ---- results grid ---- ]
 *
 * Every facet is built DYNAMICALLY from `GET /api/showroom-sales/facets` — the
 * vocabulary comes from whatever the clearance extractor actually read off the
 * showroom sites, because a hardcoded category list goes stale the moment a
 * showroom invents "Scratch & dent". Facets with no values simply don't render.
 *
 * Search has two modes: keyword (substring) and RAG (Vectorize similarity over
 * the snapshot embeddings). RAG is the one worth reaching for when the wording
 * won't match — "marble remnants" finding a listing that says "stone offcuts".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Store as StoreIcon,
  Tag,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";

// ─── Types (mirror /api/showroom-sales) ───────────────────────────────────────

interface SaleItem {
  saleId: number;
  storeId: number;
  storeName: string;
  storeCity: string | null;
  storeIconCfImagesUrl: string | null;
  sourceUrl: string;
  title: string;
  brand: string | null;
  category: string | null;
  originalPrice: number | null;
  salePrice: number | null;
  discountPercent: number | null;
  dealLabel: string | null;
  url: string | null;
  notes: string | null;
  saleHeadline: string | null;
  saleEndsText: string | null;
  capturedAt: string | null;
  score: number | null;
}

interface FacetValue {
  value: string;
  count: number;
}

interface StoreFacet {
  id: number;
  name: string;
  count: number;
}

interface Facets {
  brands: FacetValue[];
  categories: FacetValue[];
  dealLabels: FacetValue[];
  cities: FacetValue[];
  stores: StoreFacet[];
  priceRange: { min: number; max: number } | null;
  discountRange: { min: number; max: number } | null;
  totalItems: number;
  storeCount: number;
}

/** The active filter selection. Each key maps to a repeatable query param. */
interface Selection {
  brand: string[];
  category: string[];
  dealLabel: string[];
  city: string[];
  storeId: string[];
}

const EMPTY_SELECTION: Selection = {
  brand: [],
  category: [],
  dealLabel: [],
  city: [],
  storeId: [],
};

type SelectionKey = keyof Selection;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ─── Facet section ────────────────────────────────────────────────────────────

/**
 * One checkbox facet. Renders nothing when the vocabulary is empty — that's how
 * the rail stays honest about what the corpus actually contains.
 */
function FacetSection({
  title,
  id,
  values,
  selected,
  onToggle,
}: {
  title: string;
  id: string;
  values: Array<{ value: string; label: string; count: number }>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <>
      <section className="flex flex-col gap-3 px-5" aria-labelledby={`filter-${id}`}>
        <h3 id={`filter-${id}`} className="text-sm font-semibold tracking-tight text-foreground">
          {title}
        </h3>
        <ul className="flex flex-col gap-2.5">
          {values.map((v) => (
            <li key={v.value} className="flex items-center gap-2.5">
              <Checkbox
                id={`${id}-${v.value}`}
                checked={selected.includes(v.value)}
                onCheckedChange={() => onToggle(v.value)}
              />
              <Label
                htmlFor={`${id}-${v.value}`}
                className="flex min-w-0 flex-1 justify-between gap-3 text-sm font-normal text-foreground"
              >
                <span className="truncate">{v.label}</span>
                <span className="tabular-nums text-muted-foreground">{v.count}</span>
              </Label>
            </li>
          ))}
        </ul>
      </section>
      <div className="px-5 py-5">
        <Separator />
      </div>
    </>
  );
}

// ─── Result card ──────────────────────────────────────────────────────────────

function SaleCard({ item }: { item: SaleItem }) {
  const href = item.url ?? item.sourceUrl;
  return (
    <article className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-border/40 transition-colors hover:bg-muted/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {item.brand ? (
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {item.brand}
            </p>
          ) : null}
          <h3 className="text-sm font-medium leading-snug text-balance">
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-4 transition-colors hover:text-sky-400 hover:underline"
            >
              {item.title}
            </a>
          </h3>
        </div>
        {item.discountPercent != null ? (
          <Badge className="shrink-0 bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
            {Math.round(item.discountPercent)}% off
          </Badge>
        ) : null}
      </div>

      {/* Price. An item with no stated price is common — sale pages often just
          say "call for pricing", so we show the deal label instead of a blank. */}
      <div className="flex items-baseline gap-2 text-sm tabular-nums">
        {item.salePrice != null ? (
          <span className="font-semibold text-foreground">{money(item.salePrice)}</span>
        ) : null}
        {item.originalPrice != null && item.originalPrice !== item.salePrice ? (
          <span className="text-muted-foreground line-through">{money(item.originalPrice)}</span>
        ) : null}
        {item.salePrice == null && item.dealLabel ? (
          <span className="text-muted-foreground">{item.dealLabel}</span>
        ) : null}
      </div>

      {item.notes ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.notes}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/30 pt-2.5 text-xs text-muted-foreground">
        <a
          href={`/admin/shopping/store/${item.storeId}`}
          className="inline-flex min-w-0 items-center gap-1.5 transition-colors hover:text-foreground"
        >
          {item.storeIconCfImagesUrl ? (
            <img
              src={item.storeIconCfImagesUrl}
              alt=""
              className="size-4 shrink-0 rounded-full object-contain"
            />
          ) : (
            <StoreIcon className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{item.storeName}</span>
        </a>
        {item.category ? (
          <span className="inline-flex items-center gap-1">
            <Tag className="size-3" />
            {item.category}
          </span>
        ) : null}
        {item.saleEndsText ? (
          <span className="text-amber-400">{item.saleEndsText}</span>
        ) : null}
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          View <ExternalLink className="size-3" />
        </a>
      </div>
    </article>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export function SalesApp() {
  const [facets, setFacets] = useState<Facets | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  // The query actually sent — debounced so typing doesn't fire a request per key.
  const [activeQuery, setActiveQuery] = useState("");
  const [ragMode, setRagMode] = useState(false);
  const [resolvedMode, setResolvedMode] = useState<"keyword" | "rag">("keyword");
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [minDiscount, setMinDiscount] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setActiveQuery(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const loadFacets = useCallback(async () => {
    try {
      setFacets(await api<Facets>("/api/showroom-sales/facets"));
    } catch (err) {
      console.error("[SalesApp] facets failed:", err);
    }
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (activeQuery) {
      params.set("q", activeQuery);
      if (ragMode) params.set("mode", "rag");
    }
    for (const key of Object.keys(selection) as SelectionKey[]) {
      for (const v of selection[key]) params.append(key, v);
    }
    if (minDiscount > 0) params.set("minDiscount", String(minDiscount));
    return params.toString();
  }, [activeQuery, ragMode, selection, minDiscount]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ items: SaleItem[]; mode: "keyword" | "rag" }>(
        `/api/showroom-sales?${queryString}`,
      );
      setItems(data.items);
      setResolvedMode(data.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sales");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);
  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const toggle = (key: SelectionKey, value: string) => {
    setSelection((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }));
  };

  const clearAll = () => {
    setSelection(EMPTY_SELECTION);
    setMinDiscount(0);
    setQuery("");
  };

  const activeChips = useMemo(() => {
    const chips: Array<{ key: SelectionKey; value: string; label: string }> = [];
    for (const key of Object.keys(selection) as SelectionKey[]) {
      for (const value of selection[key]) {
        const label =
          key === "storeId"
            ? facets?.stores.find((s) => String(s.id) === value)?.name ?? value
            : value;
        chips.push({ key, value, label });
      }
    }
    return chips;
  }, [selection, facets]);

  const hasFilters = activeChips.length > 0 || minDiscount > 0;

  const runSweep = async () => {
    setSweeping(true);
    try {
      const res = await fetch("/api/showroom-sales/sweep", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 }),
      });
      if (!res.ok) throw new Error(`Sweep failed (${res.status})`);
      const summary = (await res.json()) as { recorded: number; unchanged: number };
      toast.success(
        `Sweep complete — ${summary.recorded} updated, ${summary.unchanged} unchanged.`,
      );
      await Promise.all([loadFacets(), loadItems()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sweep failed");
    } finally {
      setSweeping(false);
    }
  };

  return (
    <main className="container mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales &amp; Clearance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the tracked showrooms currently have marked down. Refreshed weekly from each
            store&rsquo;s sale pages.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void runSweep()}
          disabled={sweeping}
        >
          {sweeping ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Re-scan now
        </Button>
      </div>

      {/* ── Search bar (spans the full width, above both rails) ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              ragMode
                ? "Describe what you're after — e.g. marble remnants for a small vanity"
                : "Search sale items, brands, stores…"
            }
            className="pl-9"
            aria-label="Search clearance items"
          />
        </div>
        <Button
          variant={ragMode ? "default" : "outline"}
          size="sm"
          className="gap-1.5"
          onClick={() => setRagMode((v) => !v)}
          aria-pressed={ragMode}
          title="Semantic search over the clearance corpus"
        >
          <Sparkles className="size-3.5" />
          Smart search
        </Button>
      </div>
      {ragMode && activeQuery && resolvedMode === "keyword" ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          No semantic matches indexed yet — showing keyword results.
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* ── Filter rail ── */}
        <aside aria-label="Sale filters" className="w-full shrink-0 lg:w-64">
          <div className="flex flex-col gap-0 overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
            <div className="flex items-center justify-between gap-3 px-5 pt-5">
              <h2 className="text-base font-semibold tracking-tight text-foreground">Filters</h2>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  Clear all
                </button>
              ) : null}
            </div>

            <div className="px-5 py-5">
              <Separator />
            </div>

            {activeChips.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-1.5 px-5" aria-label="Active filters">
                  {activeChips.map((chip) => (
                    <button
                      key={`${chip.key}:${chip.value}`}
                      type="button"
                      aria-label={`Remove filter ${chip.label}`}
                      onClick={() => toggle(chip.key, chip.value)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 py-0.5 pl-2 pr-2 text-xs font-medium text-foreground ring-1 ring-border transition-colors hover:bg-muted"
                    >
                      {chip.label}
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  ))}
                </div>
                <div className="px-5 py-5">
                  <Separator />
                </div>
              </>
            ) : null}

            {/* Minimum discount — only offered when the corpus has percents. */}
            {facets?.discountRange ? (
              <>
                <section className="flex flex-col gap-4 px-5" aria-labelledby="filter-discount">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3
                      id="filter-discount"
                      className="text-sm font-semibold tracking-tight text-foreground"
                    >
                      Min. discount
                    </h3>
                    <span className="text-xs font-medium tabular-nums text-foreground">
                      {minDiscount}%
                    </span>
                  </div>
                  <Slider
                    value={[minDiscount]}
                    min={0}
                    max={Math.max(facets.discountRange.max, 10)}
                    step={5}
                    // Base UI's Slider emits `number | number[]` depending on
                    // whether it's ranged; this one is single-thumb.
                    onValueChange={(v) => setMinDiscount(Array.isArray(v) ? v[0] ?? 0 : v)}
                    aria-label="Minimum discount percent"
                  />
                </section>
                <div className="px-5 py-5">
                  <Separator />
                </div>
              </>
            ) : null}

            <FacetSection
              title="Category"
              id="category"
              values={(facets?.categories ?? []).map((f) => ({ ...f, label: f.value }))}
              selected={selection.category}
              onToggle={(v) => toggle("category", v)}
            />
            <FacetSection
              title="Brand"
              id="brand"
              values={(facets?.brands ?? []).map((f) => ({ ...f, label: f.value }))}
              selected={selection.brand}
              onToggle={(v) => toggle("brand", v)}
            />
            <FacetSection
              title="Deal type"
              id="dealLabel"
              values={(facets?.dealLabels ?? []).map((f) => ({ ...f, label: f.value }))}
              selected={selection.dealLabel}
              onToggle={(v) => toggle("dealLabel", v)}
            />
            <FacetSection
              title="Showroom"
              id="storeId"
              values={(facets?.stores ?? []).map((s) => ({
                value: String(s.id),
                label: s.name,
                count: s.count,
              }))}
              selected={selection.storeId}
              onToggle={(v) => toggle("storeId", v)}
            />
            <FacetSection
              title="City"
              id="city"
              values={(facets?.cities ?? []).map((f) => ({ ...f, label: f.value }))}
              selected={selection.city}
              onToggle={(v) => toggle("city", v)}
            />
          </div>
        </aside>

        {/* ── Results grid ── */}
        <div className="min-w-0 flex-1">
          <p className="mb-3 text-xs text-muted-foreground">
            {loading ? "Loading…" : `${items.length} item${items.length === 1 ? "" : "s"}`}
            {facets ? ` across ${facets.storeCount} showroom${facets.storeCount === 1 ? "" : "s"}` : ""}
            {resolvedMode === "rag" ? " · ranked by relevance" : ""}
          </p>

          {error ? (
            <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive ring-1 ring-destructive/30">
              {error}
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 rounded-xl bg-card p-8 text-sm text-muted-foreground ring-1 ring-border/40">
              <Loader2 className="size-4 animate-spin" /> Loading clearance…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl bg-card p-8 text-center ring-1 ring-border/40">
              <p className="text-sm font-medium">Nothing on sale matches that.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasFilters || activeQuery
                  ? "Try clearing a filter or broadening the search."
                  : "No tracked showroom is currently running a clearance the scraper can see."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <SaleCard key={`${item.saleId}:${item.title}`} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
