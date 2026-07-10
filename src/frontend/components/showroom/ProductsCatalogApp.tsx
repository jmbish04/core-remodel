import { useCallback, useEffect, useState } from "react";
import { Search, Loader2, Package, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddToWishlistButton } from "@/components/products/AddToWishlistButton";
import { GapPanel } from "@/components/showroom/GapPanel";

interface CatalogProduct {
  id: number;
  itemName: string;
  description: string | null;
  sku: string | null;
  price: string | null;
  leadTime: string | null;
  materialId: number | null;
  storeId: number;
  storeName: string | null;
  pricePoint: "$" | "$$" | "$$$" | "$$$$" | null;
  hubRoute: string | null;
  cityName: string | null;
}

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const HUBS = ["A", "B", "C", "D", "E"];

export function ProductsCatalogApp() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [hub, setHub] = useState<string | null>(null);
  const [linked, setLinked] = useState<"all" | "yes" | "no">("all");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (hub) params.set("hub", hub);
      if (linked !== "all") params.set("linked", linked);
      const data = await api<{ products: CatalogProduct[] }>(`/api/showroom-stores/catalog/products?${params.toString()}`);
      setProducts(data.products);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, hub, linked]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every product sourced across showrooms. Filter by hub or material link; surface coverage gaps below.
        </p>
      </div>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search products / SKU…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={hub === null ? "default" : "outline"} onClick={() => setHub(null)}>
            All hubs
          </Button>
          {HUBS.map((h) => (
            <Button key={h} size="sm" variant={hub === h ? "default" : "outline"} onClick={() => setHub(h)}>
              {h}
            </Button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(["all", "yes", "no"] as const).map((l) => (
            <Button key={l} size="sm" variant={linked === l ? "default" : "outline"} onClick={() => setLinked(l)}>
              {l === "all" ? "Any" : l === "yes" ? "Linked" : "Unlinked"}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[160px] items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : products.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[140px] items-center justify-center text-sm text-muted-foreground">
            No products yet. Source products from showrooms or run deep research from the gap panel.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <a key={p.id} href={`/admin/shopping/product/${p.id}`} className="block">
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 font-medium">
                      <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{p.itemName}</span>
                    </div>
                    {p.price ? <span className="shrink-0 font-mono text-sm tabular-nums text-emerald-400">{p.price}</span> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {p.storeName ? <span className="text-xs text-muted-foreground">{p.storeName}</span> : null}
                    {p.hubRoute ? (
                      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Hub {p.hubRoute}
                      </Badge>
                    ) : null}
                    {p.materialId ? (
                      <Badge variant="secondary" className="bg-sky-500/10 text-sky-400 font-mono text-[10px] uppercase tracking-widest">
                        <ExternalLink className="mr-1 h-3 w-3" /> Linked
                      </Badge>
                    ) : null}
                  </div>
                  {p.sku ? <p className="font-mono text-[11px] text-muted-foreground">SKU {p.sku}</p> : null}
                  <div className="flex justify-end pt-1">
                    <AddToWishlistButton productId={p.id} />
                  </div>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      )}

      <div className="mt-8">
        <GapPanel context="product" />
      </div>
    </main>
  );
}
