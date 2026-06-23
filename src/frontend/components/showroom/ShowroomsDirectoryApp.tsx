import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Loader2, MapPin, Store as StoreIcon } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Map as GeoMap, MapControls, MapMarker, MarkerContent, MarkerPopup } from "@/components/ui/map";
import { GapPanel } from "@/components/showroom/GapPanel";

interface Store {
  id: number;
  name: string;
  pricePoint: "$" | "$$" | "$$$" | "$$$$" | null;
  inventoryFocus: string | null;
  cityName: string | null;
  hubRoute: string | null;
  hubName: string | null;
}

// Bay Area procurement hubs with approximate centroids [lng, lat].
const HUBS: Record<string, { name: string; lng: number; lat: number }> = {
  A: { name: "SF Design District", lng: -122.4194, lat: 37.7749 },
  B: { name: "Silicon Valley & South Bay", lng: -121.8863, lat: 37.3382 },
  C: { name: "Peninsula / Mid-Market", lng: -122.2603, lat: 37.5072 },
  D: { name: "East Bay", lng: -122.2712, lat: 37.8044 },
  E: { name: "North Bay", lng: -122.545, lat: 37.906 },
};

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function PricePointBadge({ pricePoint }: { pricePoint: Store["pricePoint"] }) {
  if (!pricePoint) return null;
  return (
    <Badge variant="outline" className="font-mono text-[10px] tracking-widest text-emerald-400">
      {pricePoint}
    </Badge>
  );
}

export function ShowroomsDirectoryApp() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [hubFilter, setHubFilter] = useState<string | null>(null);

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ stores: Store[] }>("/api/showroom-stores");
      setStores(data.stores);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load showrooms");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stores.filter((s) => {
      if (hubFilter && s.hubRoute !== hubFilter) return false;
      if (q && !s.name.toLowerCase().includes(q) && !(s.cityName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [stores, search, hubFilter]);

  const byHub = useMemo(() => {
    const map = new Map<string, Store[]>();
    for (const s of stores) {
      if (!s.hubRoute || !HUBS[s.hubRoute]) continue;
      map.set(s.hubRoute, [...(map.get(s.hubRoute) ?? []), s]);
    }
    return map;
  }, [stores]);

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Showrooms</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bay Area sourcing hubs. Discover new showrooms from your materials via the coverage-gap panel below.
        </p>
      </div>

      <Card className="mb-6 overflow-hidden">
        <GeoMap className="h-[360px] w-full" theme="dark" viewport={{ center: [-122.27, 37.72], zoom: 8.2 }}>
          <MapControls showZoom />
          {[...byHub.entries()].map(([route, hubStores]) => {
            const hub = HUBS[route];
            return (
              <MapMarker key={route} longitude={hub.lng} latitude={hub.lat}>
                <MarkerContent className="z-20">
                  <div className="flex items-center gap-1.5 rounded-full bg-sky-500/90 px-2.5 py-1 text-xs font-semibold text-white shadow-lg">
                    <MapPin className="h-3.5 w-3.5" /> {route} · {hubStores.length}
                  </div>
                </MarkerContent>
                <MarkerPopup closeButton className="max-w-72">
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold">Hub {route} — {hub.name}</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {hubStores.slice(0, 8).map((s) => (
                        <li key={s.id} className="truncate">{s.name}</li>
                      ))}
                      {hubStores.length > 8 ? <li>+{hubStores.length - 8} more</li> : null}
                    </ul>
                  </div>
                </MarkerPopup>
              </MapMarker>
            );
          })}
        </GeoMap>
      </Card>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search showrooms…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={hubFilter === null ? "default" : "outline"} onClick={() => setHubFilter(null)}>
            All
          </Button>
          {Object.keys(HUBS).map((route) => (
            <Button key={route} size="sm" variant={hubFilter === route ? "default" : "outline"} onClick={() => setHubFilter(route)}>
              {route}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[160px] items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[140px] items-center justify-center text-sm text-muted-foreground">
            No showrooms match. Use the coverage-gap panel to discover new ones.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <a key={s.id} href={`/admin/showroom/store/${s.id}`} className="block">
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-medium">
                      <StoreIcon className="h-4 w-4 text-muted-foreground" /> {s.name}
                    </div>
                    <PricePointBadge pricePoint={s.pricePoint} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.hubRoute ? (
                      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Hub {s.hubRoute}
                      </Badge>
                    ) : null}
                    {s.cityName ? <span className="text-xs text-muted-foreground">{s.cityName}</span> : null}
                  </div>
                  {s.inventoryFocus ? <p className="line-clamp-2 text-xs text-muted-foreground">{s.inventoryFocus}</p> : null}
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      )}

      <div className="mt-8">
        <GapPanel context="showroom" />
      </div>
    </main>
  );
}
