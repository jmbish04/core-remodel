import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  ArrowLeft,
  Globe,
  Package,
  Star,
  Store,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface BrandProduct {
  id: number;
  itemName: string;
  price: string | null;
  description: string | null;
  storeName: string | null;
}

interface BrandStore {
  id: number;
  name: string | null;
}

interface BrandDetail {
  brand: {
    id: number;
    name: string;
    slug: string;
    logoCfDeliveryUrl: string | null;
    websiteUrl: string | null;
    description: string | null;
    pricePoint: string | null;
    avgRating: number | null;
    ratingCount: number;
    countryOfOrigin: string | null;
  };
  products: BrandProduct[];
  stores: BrandStore[];
}

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

interface BrandViewportAppProps {
  brandId: number;
}

/**
 * Global brand viewport page — shows brand identity, all products across
 * all stores, and the showrooms that carry this brand.
 *
 * Mounted at /admin/brands/[id].
 */
export function BrandViewportApp({ brandId }: BrandViewportAppProps) {
  const [data, setData] = useState<BrandDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<BrandDetail>(
        `/api/showroom-stores/brands/${brandId}`,
      );
      setData(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load brand");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container mx-auto px-4 py-10 text-muted-foreground">
        Brand not found.
      </div>
    );
  }

  const { brand, products, stores } = data;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <a
        href="/admin/brands"
        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> All brands
      </a>

      {/* Brand header */}
      <div className="mt-4 flex items-center gap-4">
        {brand.logoCfDeliveryUrl ? (
          <img
            src={brand.logoCfDeliveryUrl}
            alt={brand.name}
            className="h-12 w-auto object-contain"
          />
        ) : null}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {brand.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {brand.pricePoint ? (
              <Badge
                variant="outline"
                className="font-mono text-[10px] text-emerald-400"
              >
                {brand.pricePoint}
              </Badge>
            ) : null}
            {brand.countryOfOrigin ? (
              <Badge
                variant="outline"
                className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
              >
                {brand.countryOfOrigin}
              </Badge>
            ) : null}
            {brand.avgRating != null ? (
              <span className="inline-flex items-center gap-1 text-xs font-mono tabular-nums text-amber-400">
                <Star className="h-3 w-3 fill-amber-400" />
                {brand.avgRating.toFixed(1)}
                {brand.ratingCount > 0 && (
                  <span className="text-muted-foreground">
                    ({brand.ratingCount})
                  </span>
                )}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {brand.description ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {brand.description}
        </p>
      ) : null}

      {brand.websiteUrl ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Globe className="h-4 w-4" />
          <a
            href={brand.websiteUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 hover:underline"
          >
            {brand.websiteUrl}
          </a>
        </div>
      ) : null}

      {/* Showrooms carrying this brand */}
      {stores.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Store className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Carried at:</span>
          {stores.map((s) => (
            <a
              key={s.id}
              href={`/admin/showroom/store/${s.id}`}
              className="text-xs text-sky-400 hover:underline"
            >
              {s.name}
            </a>
          ))}
        </div>
      ) : null}

      {/* Products for this brand */}
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Products ({products.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No products tracked for {brand.name} yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {products.map((p) => (
                <li key={p.id}>
                  <a
                    href={`/admin/showroom/product/${p.id}`}
                    className="flex items-center justify-between rounded-md bg-muted/40 p-2.5 text-sm transition-colors hover:bg-muted/70"
                  >
                    <span className="flex items-center gap-1.5">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span>{p.itemName}</span>
                      {p.storeName ? (
                        <span className="text-[10px] text-muted-foreground/60">
                          — {p.storeName}
                        </span>
                      ) : null}
                    </span>
                    {p.price ? (
                      <span className="font-mono text-xs tabular-nums text-emerald-400">
                        {p.price}
                      </span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
