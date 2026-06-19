import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarcodeScanner } from "./BarcodeScanner";
import { useOfflineBarcodeSync } from "@/hooks/useOfflineBarcodeSync";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Store {
  id: number;
  name: string;
  description: string | null;
  pricePoint: string | null;
  locationAddress: string | null;
  websiteUrl: string | null;
  isFlagshipLocation: boolean;
  scale: string | null;
  inventoryFocus: string | null;
  aiHighlightsForUserRenovation: string | null;
  cityName: string | null;
  hubRoute: string | null;
  hubName: string | null;
}

interface GapItem {
  id: number;
  roomName: string;
  name: string;
  description: string;
  suggestion: string;
}

// ─── Price Point Badge ────────────────────────────────────────────────────────

function PricePointBadge({ pricePoint }: { pricePoint: string | null }) {
  if (!pricePoint) return null;
  const colors: Record<string, string> = {
    $: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    $$: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    $$$: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    $$$$: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  };
  return (
    <Badge variant="outline" className={colors[pricePoint] ?? ""}>
      {pricePoint}
    </Badge>
  );
}

// ─── Hub Badge ────────────────────────────────────────────────────────────────

function HubBadge({ hubRoute, hubName }: { hubRoute: string | null; hubName: string | null }) {
  if (!hubRoute) return null;
  const colors: Record<string, string> = {
    A: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    B: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    C: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    D: "bg-lime-500/10 text-lime-400 border-lime-500/20",
    E: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  };
  return (
    <Badge variant="outline" className={colors[hubRoute] ?? ""}>
      Hub {hubRoute}
    </Badge>
  );
}

// ─── Store Card ───────────────────────────────────────────────────────────────

function StoreCard({
  store,
  onClick,
}: {
  store: Store;
  onClick: (store: Store) => void;
}) {
  return (
    <Card
      className="cursor-pointer border-zinc-800 bg-zinc-900/60 transition-all hover:border-zinc-700 hover:bg-zinc-800/50"
      onClick={() => onClick(store)}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">{store.name}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {store.cityName ?? store.locationAddress ?? "Bay Area"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <PricePointBadge pricePoint={store.pricePoint} />
            {store.isFlagshipLocation && (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400">
                ★
              </Badge>
            )}
          </div>
        </div>

        {store.inventoryFocus && (
          <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">
            {store.inventoryFocus}
          </p>
        )}

        <div className="flex items-center gap-1.5">
          <HubBadge hubRoute={store.hubRoute} hubName={store.hubName} />
          {store.scale && (
            <span className="truncate text-[10px] text-zinc-600">{store.scale}</span>
          )}
        </div>

        {store.aiHighlightsForUserRenovation && (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2">
            <p className="text-[10px] leading-relaxed text-amber-400/80">
              💡 {store.aiHighlightsForUserRenovation}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function ShowroomDashboard() {
  const [stores, setStores] = useState<Store[]>([]);
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [hubFilter, setHubFilter] = useState<string | null>(null);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);

  const { queue, queueLength, isOnline, isSyncing, enqueueScan } =
    useOfflineBarcodeSync();

  // ── Data Fetching ─────────────────────────────────────────────────────────

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (hubFilter) params.set("hub", hubFilter);

      const res = await fetch(`/api/showroom-stores?${params}`);
      if (res.ok) {
        const data = (await res.json()) as { stores?: Store[] };
        setStores(data.stores ?? []);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, [search, hubFilter]);

  const fetchGaps = useCallback(async () => {
    try {
      const res = await fetch("/api/showroom-stores/meta/gaps");
      if (res.ok) {
        const data = (await res.json()) as { gaps?: GapItem[] };
        setGaps(data.gaps ?? []);
      }
    } catch {
      // Silent fail
    }
  }, []);

  useEffect(() => {
    fetchStores();
    fetchGaps();
  }, [fetchStores, fetchGaps]);

  // ── Barcode Handlers ──────────────────────────────────────────────────────

  const handleBarcodeDetected = useCallback(
    async (value: string) => {
      await enqueueScan({
        barcodeValue: value,
        storeId: selectedStore?.id,
      });
      fetchStores();
    },
    [enqueueScan, selectedStore, fetchStores]
  );

  const handleImageCapture = useCallback(
    async (base64: string) => {
      await enqueueScan({
        image: base64,
        storeId: selectedStore?.id,
      });
      fetchStores();
    },
    [enqueueScan, selectedStore, fetchStores]
  );

  // ── Hub labels ────────────────────────────────────────────────────────────

  const HUBS = [
    { route: "A", label: "SF Design District" },
    { route: "B", label: "Silicon Valley" },
    { route: "C", label: "Peninsula" },
    { route: "D", label: "East Bay" },
    { route: "E", label: "North Bay" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-light tracking-tight">Showroom Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stores.length} store locations tracked · {gaps.length} category gaps detected
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BarcodeScanner
            onBarcodeDetected={handleBarcodeDetected}
            onImageCapture={handleImageCapture}
            storeId={selectedStore?.id}
          />
          {queueLength > 0 && (
            <Badge
              variant="outline"
              className={`border-amber-500/30 ${isSyncing ? "animate-pulse" : ""}`}
            >
              {isSyncing ? "Syncing..." : `${queueLength} scan${queueLength !== 1 ? "s" : ""} queued`}
            </Badge>
          )}
          {!isOnline && (
            <Badge variant="outline" className="border-red-500/30 text-red-400">
              Offline
            </Badge>
          )}
        </div>
      </div>

      <Tabs defaultValue="stores">
        <TabsList className="bg-zinc-900">
          <TabsTrigger value="stores">Stores</TabsTrigger>
          <TabsTrigger value="gaps">
            Gap Analysis
            {gaps.length > 0 && (
              <Badge variant="outline" className="ml-1.5 border-amber-500/30 text-amber-400">
                {gaps.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Stores Tab ─────────────────────────────────────────────── */}
        <TabsContent value="stores" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              placeholder="Search stores..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs border-zinc-800 bg-zinc-900/60"
            />
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant={hubFilter === null ? "secondary" : "ghost"}
                onClick={() => setHubFilter(null)}
                className="h-7 text-xs"
              >
                All
              </Button>
              {HUBS.map((hub) => (
                <Button
                  key={hub.route}
                  size="sm"
                  variant={hubFilter === hub.route ? "secondary" : "ghost"}
                  onClick={() => setHubFilter(hub.route)}
                  className="h-7 text-xs"
                >
                  {hub.route}: {hub.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Store grid */}
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading stores...
            </div>
          ) : stores.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No stores found. Add your first showroom to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {stores.map((store) => (
                <StoreCard
                  key={store.id}
                  store={store}
                  onClick={setSelectedStore}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Gap Analysis Tab ───────────────────────────────────────── */}
        <TabsContent value="gaps" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Product areas with no store coverage detected. Fill these gaps to ensure complete
            procurement coverage for your renovation.
          </p>

          {gaps.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              ✅ All product areas have store coverage.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {gaps.map((gap) => (
                <Card key={gap.id} className="border-zinc-800 bg-zinc-900/60">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                        {gap.roomName}
                      </Badge>
                      <span className="text-amber-500">⚠</span>
                    </div>
                    <h4 className="text-sm font-medium">{gap.name}</h4>
                    <p className="text-xs text-zinc-500">{gap.description}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                    >
                      🔍 {gap.suggestion}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
