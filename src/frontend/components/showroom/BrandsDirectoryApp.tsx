import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";

interface Brand {
  id: number;
  name: string;
  slug: string;
  logoCfDeliveryUrl: string | null;
  websiteUrl: string | null;
  pricePoint: string | null;
  avgRating: number | null;
  isActive: boolean;
}

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * Global brand directory — lists all brands in the system.
 * Mounted at /admin/brands.
 */
export function BrandsDirectoryApp() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ brands: Brand[] }>("/api/showroom-stores/brands");
      setBrands(result.brands);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load brands");
    } finally {
      setLoading(false);
    }
  }, []);

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

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Brands</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        All brands tracked across showrooms
      </p>

      {brands.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          No brands found. Brands are added when the agent scrapes showroom websites.
        </p>
      ) : (
        <div className="mt-8 flex flex-wrap gap-3">
          {brands.map((brand) => (
            <a
              key={brand.id}
              href={`/admin/brands/${brand.id}`}
              className="group/brand flex w-[calc(50%-0.375rem)] flex-col items-center justify-center rounded-xl ring-1 ring-border/40 bg-card/60 p-5 transition-all hover:ring-primary/50 hover:bg-card/80 md:w-[calc(33.333%-0.5rem)] lg:w-[calc(25%-0.5625rem)]"
            >
              <div className="relative mb-2.5 flex h-10 w-full items-center justify-center grayscale transition-all group-hover/brand:grayscale-0">
                {brand.logoCfDeliveryUrl ? (
                  <img
                    src={brand.logoCfDeliveryUrl}
                    alt={brand.name}
                    width={80}
                    height={40}
                    className="max-h-full object-contain opacity-50 transition-all duration-300 group-hover/brand:opacity-100"
                  />
                ) : (
                  <span className="text-xs font-semibold tracking-tight text-muted-foreground/60 transition-colors group-hover/brand:text-foreground">
                    {brand.name}
                  </span>
                )}
              </div>
              <p className="text-center text-sm font-medium">{brand.name}</p>
              <div className="mt-1 flex items-center gap-2">
                {brand.pricePoint ? (
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] text-emerald-400"
                  >
                    {brand.pricePoint}
                  </Badge>
                ) : null}
                {brand.avgRating != null ? (
                  <span className="text-[10px] font-mono tabular-nums text-amber-400">
                    ★ {brand.avgRating.toFixed(1)}
                  </span>
                ) : null}
              </div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
