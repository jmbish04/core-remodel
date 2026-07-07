/**
 * @fileoverview EntitySearchSelect — a debounced search-select over one of the
 * three entity catalogs (showroom / brand / product). Reused by:
 *   - the INITIATE dialog, to pick the target of a showroom/brand/product job;
 *   - the discovery-products intake flow, to pick the showroom a candidate
 *     product belongs to.
 *
 * Endpoints (verified against the associate modals):
 *   showroom → GET /api/showroom-stores?search=<q>      → { stores: [...] }
 *   brand    → GET /api/brands?search=<q>                → { brands: [...] }
 *   product  → GET /api/showroom-products/search?q=<q>   → { products: [...] }
 *
 * Monolith dark conventions: bg-card / ring-1 ring-border/40, sonner + console
 * on catch, credentials:"include", disable-while-in-flight, no 1px borders.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { getJson } from "./types";

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Which catalog to search. */
export type EntityCatalog = "showroom" | "brand" | "product";

/** A normalized search hit, whatever catalog it came from. */
export interface EntityHit {
  id: number;
  name: string;
  /** Optional secondary line (brand name, city, etc.). */
  subtitle?: string | null;
}

interface StoreRow {
  id: number;
  name: string;
  cityName?: string | null;
  city?: string | null;
}
interface BrandRow {
  id: number;
  name: string;
  description?: string | null;
}
interface ProductRow {
  id: number;
  itemName: string;
  brandName?: string | null;
}

// ─── Catalog config ─────────────────────────────────────────────────────────────

/** Per-catalog endpoint + response normalizer. */
const CATALOGS: Record<
  EntityCatalog,
  { placeholder: string; fetchHits: (q: string) => Promise<EntityHit[]> }
> = {
  showroom: {
    placeholder: "Search showrooms…",
    fetchHits: async (q) => {
      const data = await getJson<{ stores: StoreRow[] }>(
        `/api/showroom-stores?search=${encodeURIComponent(q)}`,
      );
      return (data.stores ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        subtitle: s.cityName ?? s.city ?? null,
      }));
    },
  },
  brand: {
    placeholder: "Search brands…",
    fetchHits: async (q) => {
      const data = await getJson<{ brands: BrandRow[] }>(
        `/api/brands?search=${encodeURIComponent(q)}`,
      );
      return (data.brands ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        subtitle: b.description ?? null,
      }));
    },
  },
  product: {
    placeholder: "Search products…",
    fetchHits: async (q) => {
      const data = await getJson<{ products: ProductRow[] }>(
        `/api/showroom-products/search?q=${encodeURIComponent(q)}`,
      );
      return (data.products ?? []).map((p) => ({
        id: p.id,
        name: p.itemName,
        subtitle: p.brandName ?? null,
      }));
    },
  },
};

// ─── Component ──────────────────────────────────────────────────────────────────

export function EntitySearchSelect({
  catalog,
  value,
  onChange,
  label,
  disabled,
  autoFocus,
}: {
  catalog: EntityCatalog;
  value: EntityHit | null;
  onChange: (hit: EntityHit | null) => void;
  /** Optional field label above the control. */
  label?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const seq = useRef(0);
  const cfg = CATALOGS[catalog];

  // Reset the search whenever the catalog changes (e.g. the template picker
  // flips from showroom → brand) so stale hits never bleed across kinds.
  useEffect(() => {
    setQuery("");
    setResults([]);
    setSearched(false);
    setSearching(false);
  }, [catalog]);

  // Debounced (~250ms) search — only while nothing is selected.
  useEffect(() => {
    if (value) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearched(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const s = ++seq.current;
    const handle = setTimeout(async () => {
      try {
        const hits = await cfg.fetchHits(q);
        if (s !== seq.current) return;
        setResults(hits);
        setSearched(true);
      } catch (e) {
        if (s !== seq.current) return;
        console.error(`[research/${catalog}-search]`, e);
        toast.error(e instanceof Error ? e.message : "Search failed");
        setResults([]);
        setSearched(true);
      } finally {
        if (s === seq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, value, cfg, catalog]);

  const clear = useCallback(() => onChange(null), [onChange]);

  // Selected state — a compact chip with a clear affordance.
  if (value) {
    return (
      <div className="space-y-1">
        {label ? <Label>{label}</Label> : null}
        <div className="flex items-center gap-2 rounded-md bg-card px-3 py-2 ring-1 ring-border/40">
          <Check className="size-3.5 text-emerald-400" />
          <span className="line-clamp-1 flex-1 text-sm">{value.name}</span>
          {value.subtitle ? (
            <span className="line-clamp-1 text-[11px] text-muted-foreground">
              {value.subtitle}
            </span>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            onClick={clear}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="Clear selection"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {label ? <Label>{label}</Label> : null}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={cfg.placeholder}
          className="pl-8"
          disabled={disabled}
          autoFocus={autoFocus}
        />
        {searching ? (
          <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {query.trim() !== "" ? (
        <div className="mt-1 max-h-56 overflow-y-auto rounded-md bg-card p-1 ring-1 ring-border/40">
          {results.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {results.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onChange(hit);
                      setQuery("");
                      setResults([]);
                      setSearched(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
                  >
                    <span className="line-clamp-1 flex-1">{hit.name}</span>
                    {hit.subtitle ? (
                      <span className="line-clamp-1 shrink-0 text-[11px] text-muted-foreground">
                        {hit.subtitle}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : searching ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              Searching…
            </div>
          ) : searched ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              No matches.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
