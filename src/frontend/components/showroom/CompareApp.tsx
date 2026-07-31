import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X, Plus, Loader2, Share2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Product {
  id: number;
  itemName: string;
  price: string | null;
  sku: string | null;
  storeName: string | null;
  materialId: number | null;
}
interface CompareData {
  products: Product[];
  specKeys: string[];
  specMatrix: Record<string, Record<number, string>>;
}
interface SearchRow {
  id: number;
  itemName: string;
  storeName: string | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  return payload as T;
}

function readIdsFromUrl(): number[] {
  if (typeof window === "undefined") return [];
  const raw = new URLSearchParams(window.location.search).get("ids") ?? "";
  return raw.split(",").map((s) => Number.parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
}

export function CompareApp() {
  const [ids, setIds] = useState<number[]>([]);
  const [data, setData] = useState<CompareData>({ products: [], specKeys: [], specMatrix: {} });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchRow[]>([]);

  useEffect(() => {
    setIds(readIdsFromUrl());
  }, []);

  const syncUrl = useCallback((next: number[]) => {
    const url = new URL(window.location.href);
    if (next.length > 0) url.searchParams.set("ids", next.join(","));
    else url.searchParams.delete("ids");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const load = useCallback(async () => {
    if (ids.length === 0) {
      setData({ products: [], specKeys: [], specMatrix: {} });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const d = await api<CompareData>(`/api/showroom-stores/catalog/compare?ids=${ids.join(",")}`);
      setData(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load comparison");
    } finally {
      setLoading(false);
    }
  }, [ids]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const d = await api<{ products: SearchRow[] }>(`/api/showroom-stores/catalog/products?search=${encodeURIComponent(search.trim())}`);
        if (active) {
          setResults(d.products.filter((p) => !ids.includes(p.id)).slice(0, 6));
        }
      } catch {
        /* ignore */
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [search, ids]);

  const add = (id: number) => {
    const next = [...ids, id];
    setIds(next);
    syncUrl(next);
    setSearch("");
    setResults([]);
  };
  const remove = (id: number) => {
    const next = ids.filter((x) => x !== id);
    setIds(next);
    syncUrl(next);
  };

  const decide = async (p: Product) => {
    if (!p.materialId) {
      toast.info("Link this product to a material first to decide.");
      return;
    }
    try {
      await api(`/api/materials/${p.materialId}/purchased`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPurchased: true, productId: p.id }),
      });
      toast.success(`Marked "${p.itemName}" as the choice for its material`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to decide");
    }
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Comparison link copied");
    } catch {
      toast.error("Could not copy link");
    }
  };

  const colCount = useMemo(() => data.products.length, [data.products]);

  return (
    <main className="w-full px-4 py-10 md:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compare</h1>
          <p className="mt-1 text-sm text-muted-foreground">Side-by-side product specs. Share the link; decide a winner per material.</p>
        </div>
        {colCount > 0 ? (
          <Button size="sm" variant="outline" onClick={share}>
            <Share2 className="h-3.5 w-3.5" /> Share
          </Button>
        ) : null}
      </div>

      <div className="mb-5">
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Add a product to compare…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        {results.length > 0 ? (
          <Card className="mt-2 max-w-md">
            <CardContent className="p-2">
              {results.map((r) => (
                <button key={r.id} onClick={() => add(r.id)} className="flex w-full items-center justify-between rounded-md p-2 text-left text-sm hover:bg-muted/60">
                  <span>{r.itemName}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">{r.storeName}<Plus className="h-3.5 w-3.5" /></span>
                </button>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {loading ? (
        <div className="flex min-h-[160px] items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : colCount === 0 ? (
        <Card>
          <CardContent className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
            Add two or more products above to compare them side by side.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-background p-2 text-left text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Spec</th>
                {data.products.map((p) => (
                  <th key={p.id} className="min-w-[180px] p-3 text-left align-top">
                    <div className="flex items-start justify-between gap-2">
                      <a href={`/admin/shopping/product/${p.id}`} className="font-medium hover:underline">{p.itemName}</a>
                      <button onClick={() => remove(p.id)} className="text-muted-foreground hover:text-destructive" aria-label="Remove"><X className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {p.price ? <span className="font-mono text-emerald-400">{p.price}</span> : null}
                      {p.storeName ? <span>{p.storeName}</span> : null}
                    </div>
                    <Button size="sm" variant="outline" className="mt-2 h-7" onClick={() => decide(p)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Decide
                    </Button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.specKeys.length === 0 ? (
                <tr>
                  <td colSpan={colCount + 1} className="p-4 text-center text-muted-foreground">
                    No captured specs for these products. Run deep research to populate specs.
                  </td>
                </tr>
              ) : (
                data.specKeys.map((key) => (
                  <tr key={key} className="border-t border-border/40">
                    <td className="sticky left-0 bg-background p-2 text-muted-foreground">{key}</td>
                    {data.products.map((p) => (
                      <td key={p.id} className="p-2">{data.specMatrix[key]?.[p.id] ?? <span className="text-muted-foreground/40">—</span>}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
