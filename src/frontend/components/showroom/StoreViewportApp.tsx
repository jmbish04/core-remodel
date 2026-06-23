import { useCallback, useEffect, useState } from "react";
import { Loader2, ArrowLeft, MapPin, Phone, Globe, ExternalLink, Package } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface StoreDetail {
  id: number;
  name: string;
  description: string | null;
  pricePoint: string | null;
  locationAddress: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  weekdayHours: string | null;
  weekendHours: string | null;
  inventoryFocus: string | null;
  aiHighlightsForUserRenovation: string | null;
  cityName: string | null;
  hubRoute: string | null;
  hubName: string | null;
  products: { id: number; itemName: string; price: string | null }[];
  notes: { id: number; note: string }[];
  research: { id: number; finding: string; findingUrl: string | null; sentiment: string | null }[];
  externalRatings: { id: number; source: string | null; rating: number | null; comment: string | null }[];
}

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  return payload as T;
}

export function StoreViewportApp({ id }: { id: number }) {
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<StoreDetail>(`/api/showroom-stores/${id}`);
      setStore(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load showroom");
    } finally {
      setLoading(false);
    }
  }, [id]);

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
  if (!store) return <div className="container mx-auto px-4 py-10 text-muted-foreground">Showroom not found.</div>;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <a href="/admin/showroom/showrooms" className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Showrooms
      </a>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{store.name}</h1>
        {store.hubRoute ? <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Hub {store.hubRoute}</Badge> : null}
        {store.pricePoint ? <Badge variant="outline" className="font-mono text-[10px] text-emerald-400">{store.pricePoint}</Badge> : null}
      </div>
      {store.description ? <p className="mt-2 text-sm text-muted-foreground">{store.description}</p> : null}

      <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
        {store.locationAddress ? <div className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {store.locationAddress}{store.cityName ? `, ${store.cityName}` : ""}</div> : null}
        {store.phoneNumber ? <div className="flex items-center gap-2"><Phone className="h-4 w-4" /> {store.phoneNumber}</div> : null}
        {store.websiteUrl ? <div className="flex items-center gap-2"><Globe className="h-4 w-4" /> <a href={store.websiteUrl} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{store.websiteUrl}</a></div> : null}
        {(store.weekdayHours || store.weekendHours) ? <div>Hours: {[store.weekdayHours, store.weekendHours].filter(Boolean).join(" · ")}</div> : null}
      </div>

      {store.aiHighlightsForUserRenovation ? (
        <Card className="mt-6 border-amber-500/20">
          <CardContent className="p-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-amber-400">AI highlights for your renovation</p>
            <p className="mt-1 text-sm">{store.aiHighlightsForUserRenovation}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader className="pb-3"><CardTitle className="text-base">Products carried ({store.products.length})</CardTitle></CardHeader>
        <CardContent>
          {store.products.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products tracked at this showroom yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {store.products.map((p) => (
                <li key={p.id}>
                  <a href={`/admin/showroom/product/${p.id}`} className="flex items-center justify-between rounded-md bg-muted/40 p-2.5 text-sm transition-colors hover:bg-muted/70">
                    <span className="flex items-center gap-1.5"><Package className="h-4 w-4 text-muted-foreground" /> {p.itemName}</span>
                    {p.price ? <span className="font-mono text-xs tabular-nums text-emerald-400">{p.price}</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {store.research.length > 0 ? (
        <Card className="mt-4">
          <CardHeader className="pb-3"><CardTitle className="text-base">Research findings</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {store.research.map((f) => (
                <li key={f.id} className="text-sm">
                  {f.finding}{" "}
                  {f.findingUrl ? <a href={f.findingUrl} target="_blank" rel="noreferrer" className="inline-flex text-sky-400"><ExternalLink className="h-3 w-3" /></a> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
