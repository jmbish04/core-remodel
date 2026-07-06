/**
 * @fileoverview ShowroomsDirectoryApp — Bay Area Showroom Directory
 *
 * Features:
 *   - Enriched store data (categories, ratings, hours, flags)
 *   - Horizontal filter chip bar (hub, category, price, rating, flags)
 *   - Tri-view toggle: Map / Grid / Grouped
 *   - Map-filter sync: markers reflect applied filters
 *   - Add Showroom modal (multi-step Dialog form)
 *   - Stats summary bar
 *   - GapPanel integration (preserved from original)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Clock,
  ExternalLink,
  Filter,
  Globe,
  LayoutList,
  Loader2,
  Map as MapIcon,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  Star,
  Store as StoreIcon,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Map as GeoMap,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerPopup,
} from "@/components/ui/map";
import { GapPanel } from "@/components/showroom/GapPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Store {
  id: number;
  name: string;
  description: string | null;
  pricePoint: "$" | "$$" | "$$$" | "$$$$" | null;
  inventoryFocus: string | null;
  cityName: string | null;
  hubRoute: string | null;
  hubName: string | null;
  categories: string[];
  avgRating: number | null;
  ratingCount: number;
  isAppointmentOnly: boolean;
  isFlagshipLocation: boolean;
  weekdayHours: string | null;
  weekendHours: string | null;
  isOpenWeekends: boolean;
  websiteUrl: string | null;
  locationAddress: string | null;
  scale: string | null;
}

interface Category {
  id: number;
  name: string;
}

interface City {
  id: number;
  bayAreaCityName: string;
  hubRoute: string | null;
  hubName: string | null;
}

type ViewMode = "map" | "list" | "directory";

// ─── Constants ────────────────────────────────────────────────────────────────

const HUBS: Record<string, { name: string; lng: number; lat: number }> = {
  A: { name: "SF Design District", lng: -122.4194, lat: 37.7749 },
  B: { name: "Silicon Valley & South Bay", lng: -121.8863, lat: 37.3382 },
  C: { name: "Peninsula / Mid-Market", lng: -122.2603, lat: 37.5072 },
  D: { name: "East Bay", lng: -122.2712, lat: 37.8044 },
  E: { name: "North Bay", lng: -122.545, lat: 37.906 },
};

const PRICE_POINTS = ["$", "$$", "$$$", "$$$$"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StarRating({ rating, count }: { rating: number | null; count: number }) {
  if (rating === null) return <span className="text-[10px] text-muted-foreground">No rating</span>;
  return (
    <div className="flex items-center gap-1">
      <div className="flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={`size-3 ${i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
          />
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground">
        {rating.toFixed(1)} ({count})
      </span>
    </div>
  );
}

function PricePointBadge({ pricePoint }: { pricePoint: Store["pricePoint"] }) {
  if (!pricePoint) return null;
  return (
    <Badge variant="outline" className="font-mono text-[10px] tracking-widest text-emerald-400">
      {pricePoint}
    </Badge>
  );
}

function CategoryTags({ categories, max = 3 }: { categories: string[]; max?: number }) {
  if (!categories.length) return null;
  const shown = categories.slice(0, max);
  const overflow = categories.length - max;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((c) => (
        <Badge key={c} variant="secondary" className="px-1.5 py-0 text-[9px] font-normal">
          {c}
        </Badge>
      ))}
      {overflow > 0 && (
        <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-normal text-muted-foreground">
          +{overflow}
        </Badge>
      )}
    </div>
  );
}

// ─── Store Card ───────────────────────────────────────────────────────────────

function StoreCard({ store }: { store: Store }) {
  return (
    <a href={`/admin/showroom/store/${store.id}`} className="block">
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 font-medium">
              <StoreIcon className="size-4 text-muted-foreground" />
              <span className="line-clamp-1">{store.name}</span>
              {store.isFlagshipLocation && (
                <Badge className="bg-amber-500/15 px-1 py-0 text-[9px] font-normal text-amber-400 ring-1 ring-amber-500/20">
                  Flagship
                </Badge>
              )}
            </div>
            <PricePointBadge pricePoint={store.pricePoint} />
          </div>

          <StarRating rating={store.avgRating} count={store.ratingCount} />

          <div className="flex flex-wrap items-center gap-1.5">
            {store.hubRoute && (
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Hub {store.hubRoute}
              </Badge>
            )}
            {store.cityName && <span className="text-xs text-muted-foreground">{store.cityName}</span>}
          </div>

          <CategoryTags categories={store.categories} />

          {(store.weekdayHours || store.isAppointmentOnly) && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Clock className="size-3" />
              {store.isAppointmentOnly ? (
                <span className="text-amber-400">Appointment Only</span>
              ) : (
                <span>{store.weekdayHours}</span>
              )}
            </div>
          )}

          {store.inventoryFocus && (
            <p className="line-clamp-2 text-xs text-muted-foreground">{store.inventoryFocus}</p>
          )}
        </CardContent>
      </Card>
    </a>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stores }: { stores: Store[] }) {
  const stats = useMemo(() => {
    const hubCounts = new Map<string, number>();
    let ratedCount = 0;
    let ratingSum = 0;
    let flagshipCount = 0;

    for (const s of stores) {
      if (s.hubRoute) hubCounts.set(s.hubRoute, (hubCounts.get(s.hubRoute) ?? 0) + 1);
      if (s.avgRating !== null) {
        ratedCount++;
        ratingSum += s.avgRating;
      }
      if (s.isFlagshipLocation) flagshipCount++;
    }

    return {
      total: stores.length,
      hubCounts,
      avgRating: ratedCount > 0 ? Math.round((ratingSum / ratedCount) * 10) / 10 : null,
      flagshipCount,
    };
  }, [stores]);

  return (
    <div className="flex flex-wrap gap-4 rounded-lg bg-card p-3 text-xs ring-1 ring-border/40">
      <div>
        <span className="text-muted-foreground">Total</span>
        <span className="ml-1.5 font-semibold text-foreground">{stats.total}</span>
      </div>
      {Object.keys(HUBS).map((h) => (
        <div key={h}>
          <span className="text-muted-foreground">Hub {h}</span>
          <span className="ml-1 font-semibold text-foreground">{stats.hubCounts.get(h) ?? 0}</span>
        </div>
      ))}
      <div>
        <span className="text-muted-foreground">Avg Rating</span>
        <span className="ml-1.5 font-semibold text-foreground">
          {stats.avgRating !== null ? `${stats.avgRating}★` : "—"}
        </span>
      </div>
      <div>
        <span className="text-muted-foreground">Flagship</span>
        <span className="ml-1.5 font-semibold text-amber-400">{stats.flagshipCount}</span>
      </div>
    </div>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

interface Filters {
  search: string;
  hub: string | null;
  categories: string[];
  pricePoint: string | null;
  minRating: number | null;
  appointmentOnly: boolean;
  flagship: boolean;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  hub: null,
  categories: [],
  pricePoint: null,
  minRating: null,
  appointmentOnly: false,
  flagship: false,
};

function FilterBar({
  filters,
  onChange,
  allCategories,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  allCategories: Category[];
}) {
  const [catOpen, setCatOpen] = useState(false);
  const hasActiveFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search showrooms…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="pl-8"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Hub chips */}
        <Button
          size="sm"
          variant={filters.hub === null ? "default" : "outline"}
          onClick={() => onChange({ ...filters, hub: null })}
          className="h-7 text-[11px]"
        >
          All Hubs
        </Button>
        {Object.entries(HUBS).map(([route, hub]) => (
          <Button
            key={route}
            size="sm"
            variant={filters.hub === route ? "default" : "outline"}
            onClick={() => onChange({ ...filters, hub: filters.hub === route ? null : route })}
            className="h-7 text-[11px]"
          >
            {route} · {hub.name.split(" ")[0]}
          </Button>
        ))}

        <div className="mx-1 h-5 w-px bg-border/40" />

        {/* Price chips */}
        {PRICE_POINTS.map((pp) => (
          <Button
            key={pp}
            size="sm"
            variant={filters.pricePoint === pp ? "default" : "outline"}
            onClick={() => onChange({ ...filters, pricePoint: filters.pricePoint === pp ? null : pp })}
            className="h-7 font-mono text-[11px]"
          >
            {pp}
          </Button>
        ))}

        <div className="mx-1 h-5 w-px bg-border/40" />

        {/* Rating chips */}
        {[3, 4, 5].map((r) => (
          <Button
            key={r}
            size="sm"
            variant={filters.minRating === r ? "default" : "outline"}
            onClick={() => onChange({ ...filters, minRating: filters.minRating === r ? null : r })}
            className="h-7 gap-0.5 text-[11px]"
          >
            {r}+ <Star className="size-3 fill-amber-400 text-amber-400" />
          </Button>
        ))}

        <div className="mx-1 h-5 w-px bg-border/40" />

        {/* Toggle chips */}
        <Button
          size="sm"
          variant={filters.appointmentOnly ? "default" : "outline"}
          onClick={() => onChange({ ...filters, appointmentOnly: !filters.appointmentOnly })}
          className="h-7 text-[11px]"
        >
          Appt Only
        </Button>
        <Button
          size="sm"
          variant={filters.flagship ? "default" : "outline"}
          onClick={() => onChange({ ...filters, flagship: !filters.flagship })}
          className="h-7 text-[11px]"
        >
          Flagship
        </Button>

        {/* Category dropdown */}
        <div className="relative">
          <Button
            size="sm"
            variant={filters.categories.length > 0 ? "default" : "outline"}
            onClick={() => setCatOpen(!catOpen)}
            className="h-7 gap-1 text-[11px]"
          >
            <Filter className="size-3" />
            Category
            {filters.categories.length > 0 && (
              <Badge className="ml-0.5 h-4 px-1 text-[9px]">{filters.categories.length}</Badge>
            )}
            <ChevronDown className="size-3" />
          </Button>
          {catOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-[240px] min-w-[200px] overflow-y-auto rounded-md bg-popover p-1 shadow-lg ring-1 ring-border/40">
              {allCategories.map((c) => {
                const active = filters.categories.includes(c.name);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      const next = active
                        ? filters.categories.filter((n) => n !== c.name)
                        : [...filters.categories, c.name];
                      onChange({ ...filters, categories: next });
                    }}
                    className={`flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs transition ${
                      active ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-muted/60"
                    }`}
                  >
                    <div
                      className={`size-3.5 rounded border transition ${
                        active ? "border-primary bg-primary" : "border-border"
                      }`}
                    />
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Reset */}
        {hasActiveFilters && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
            className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── View Toggle ──────────────────────────────────────────────────────────────

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const views: { id: ViewMode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "map", label: "Map", Icon: MapIcon },
    { id: "list", label: "List", Icon: LayoutList },
    { id: "directory", label: "Directory", Icon: Users },
  ];

  return (
    <div className="flex gap-1 rounded-lg bg-card p-0.5 ring-1 ring-border/40">
      {views.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
            value === id
              ? "bg-primary/10 text-primary ring-1 ring-primary/30"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Map View ─────────────────────────────────────────────────────────────────

function MapView({ stores }: { stores: Store[] }) {
  const byHub = useMemo(() => {
    const map = new Map<string, Store[]>();
    for (const s of stores) {
      if (!s.hubRoute || !HUBS[s.hubRoute]) continue;
      map.set(s.hubRoute, [...(map.get(s.hubRoute) ?? []), s]);
    }
    return map;
  }, [stores]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Map */}
      <Card className="overflow-hidden lg:flex-1">
        <GeoMap className="h-[360px] w-full lg:h-[520px]" theme="dark" viewport={{ center: [-122.27, 37.72], zoom: 8.2 }}>
          <MapControls showZoom />
          {[...byHub.entries()].map(([route, hubStores]) => {
            const hub = HUBS[route];
            return (
              <MapMarker key={route} longitude={hub.lng} latitude={hub.lat}>
                <MarkerContent className="z-20">
                  <div className="flex items-center gap-1.5 rounded-full bg-sky-500/90 px-2.5 py-1 text-xs font-semibold text-white shadow-lg">
                    <MapPin className="size-3.5" /> {route} · {hubStores.length}
                  </div>
                </MarkerContent>
                <MarkerPopup closeButton className="max-w-72">
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold">Hub {route} — {hub.name}</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {hubStores.slice(0, 8).map((s) => (
                        <li key={s.id} className="flex items-center gap-1 truncate">
                          <span>{s.name}</span>
                          {s.avgRating !== null && (
                            <span className="ml-auto text-[10px] text-amber-400">{s.avgRating}★</span>
                          )}
                        </li>
                      ))}
                      {hubStores.length > 8 && <li>+{hubStores.length - 8} more</li>}
                    </ul>
                  </div>
                </MarkerPopup>
              </MapMarker>
            );
          })}
        </GeoMap>
      </Card>

      {/* Scrolling card list */}
      <div className="flex max-h-[520px] flex-col gap-2 overflow-y-auto lg:w-[340px]">
        {stores.length === 0 ? (
          <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
            No showrooms match filters
          </div>
        ) : (
          stores.map((s) => <StoreCard key={s.id} store={s} />)
        )}
      </div>
    </div>
  );
}

// ─── Directory Card (condensed, shared by List + Directory views) ─────────────

function DirectoryCard({ store }: { store: Store }) {
  return (
    <a href={`/admin/showroom/store/${store.id}`} className="block">
      <article className="rounded-xl border border-border/60 bg-background/40 p-4 transition-colors hover:bg-background/60">
        <div className="flex items-start gap-3">
          {/* Icon / initials */}
          <div className="relative">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
              {store.name.slice(0, 2).toUpperCase()}
            </div>
            {store.pricePoint && (
              <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-emerald-500/20 px-1 font-mono text-[8px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
                {store.pricePoint}
              </span>
            )}
          </div>
          {/* Identity */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">{store.name}</span>
              {store.isFlagshipLocation && (
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-amber-400">
                  flagship
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {store.categories.length > 0
                ? store.categories.slice(0, 2).join(" · ")
                : store.inventoryFocus
                  ? store.inventoryFocus.slice(0, 60) + (store.inventoryFocus.length > 60 ? "…" : "")
                  : "Showroom"}
              {store.hubRoute && ` · Hub ${store.hubRoute}`}
            </div>
          </div>
          {/* Rating */}
          {store.avgRating !== null && (
            <div className="flex items-center gap-0.5 text-xs text-amber-400">
              <Star className="size-3 fill-amber-400" />
              {store.avgRating.toFixed(1)}
            </div>
          )}
        </div>

        {store.inventoryFocus && store.categories.length > 0 && (
          <p className="mt-2.5 text-sm leading-snug text-foreground/85 line-clamp-2">
            {store.inventoryFocus}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {store.cityName && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" />
              {store.cityName}
            </span>
          )}
          {store.isAppointmentOnly ? (
            <span className="inline-flex items-center gap-1 text-amber-400">
              <Clock className="size-3" />
              Appointment Only
            </span>
          ) : store.weekdayHours ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {store.weekdayHours}
            </span>
          ) : null}
          {store.websiteUrl && (
            <span
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={(e) => {
                e.preventDefault();
                window.open(store.websiteUrl!, "_blank");
              }}
            >
              <Globe className="size-3" />
              Website
            </span>
          )}
        </div>
      </article>
    </a>
  );
}

// ─── List View (flat, condensed) ──────────────────────────────────────────────

function ListView({ stores }: { stores: Store[] }) {
  if (stores.length === 0) {
    return (
      <div className="flex min-h-[140px] items-center justify-center text-sm text-muted-foreground">
        No showrooms match. Try adjusting your filters.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {stores.map((s) => (
        <DirectoryCard key={s.id} store={s} />
      ))}
    </div>
  );
}

// ─── Directory View (grouped by category) ─────────────────────────────────────

function DirectoryView({ stores }: { stores: Store[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, Store[]>();
    for (const s of stores) {
      if (s.categories.length === 0) {
        const list = map.get("Uncategorized") ?? [];
        list.push(s);
        map.set("Uncategorized", list);
      } else {
        for (const cat of s.categories) {
          const list = map.get(cat) ?? [];
          list.push(s);
          map.set(cat, list);
        }
      }
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [stores]);

  if (stores.length === 0) {
    return (
      <div className="flex min-h-[140px] items-center justify-center text-sm text-muted-foreground">
        No showrooms match. Try adjusting your filters.
      </div>
    );
  }

  return (
    <div>
      {groups.map(([category, catStores]) => (
        <section key={category} className="mt-10 first:mt-0">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-base font-semibold">{category}</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {catStores.length}
            </span>
            <span className="ml-auto h-px flex-1 bg-border/40" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {catStores.map((s) => (
              <DirectoryCard key={`${category}-${s.id}`} store={s} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ─── Add Showroom Modal ───────────────────────────────────────────────────────

function AddShowroomModal({
  cities,
  onCreated,
}: {
  cities: City[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    pricePoint: "",
    websiteUrl: "",
    bayAreaCityId: "",
    locationAddress: "",
    zipCode: "",
    googleMapsLink: "",
    weekdayHours: "",
    weekendHours: "",
    isOpenWeekends: false,
    isAppointmentOnly: false,
    isFlagshipLocation: false,
    scale: "",
    inventoryFocus: "",
    targetDemographic: "",
    mainPocFullname: "",
    mainPocPhoneNumber: "",
    mainPocEmailAddress: "",
  });

  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Store name is required");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { name: form.name.trim() };
      if (form.description) body.description = form.description;
      if (form.pricePoint) body.pricePoint = form.pricePoint;
      if (form.websiteUrl) body.websiteUrl = form.websiteUrl;
      if (form.bayAreaCityId) body.bayAreaCityId = Number(form.bayAreaCityId);
      if (form.locationAddress) body.locationAddress = form.locationAddress;
      if (form.zipCode) body.zipCode = form.zipCode;
      if (form.googleMapsLink) body.googleMapsLink = form.googleMapsLink;
      if (form.weekdayHours) body.weekdayHours = form.weekdayHours;
      if (form.weekendHours) body.weekendHours = form.weekendHours;
      body.isOpenWeekends = form.isOpenWeekends;
      body.isAppointmentOnly = form.isAppointmentOnly;
      body.isFlagshipLocation = form.isFlagshipLocation;
      if (form.scale) body.scale = form.scale;
      if (form.inventoryFocus) body.inventoryFocus = form.inventoryFocus;
      if (form.targetDemographic) body.targetDemographic = form.targetDemographic;
      if (form.mainPocFullname) body.mainPocFullname = form.mainPocFullname;
      if (form.mainPocPhoneNumber) body.mainPocPhoneNumber = form.mainPocPhoneNumber;
      if (form.mainPocEmailAddress) body.mainPocEmailAddress = form.mainPocEmailAddress;

      const res = await fetch("/api/showroom-stores", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((err.error as string) ?? `Failed (${res.status})`);
      }

      toast.success(`${form.name} added! AI research will run in the background.`);
      setOpen(false);
      setStep(0);
      setForm({
        name: "",
        description: "",
        pricePoint: "",
        websiteUrl: "",
        bayAreaCityId: "",
        locationAddress: "",
        zipCode: "",
        googleMapsLink: "",
        weekdayHours: "",
        weekendHours: "",
        isOpenWeekends: false,
        isAppointmentOnly: false,
        isFlagshipLocation: false,
        scale: "",
        inventoryFocus: "",
        targetDemographic: "",
        mainPocFullname: "",
        mainPocPhoneNumber: "",
        mainPocEmailAddress: "",
      });
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create showroom");
    } finally {
      setSubmitting(false);
    }
  };

  const steps = ["Identity", "Location", "Details", "Contact"];

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        Add Showroom
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Showroom</DialogTitle>
          <DialogDescription>
            Add a Bay Area showroom. The AI research agent will automatically run after creation.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex gap-1">
          {steps.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(i)}
              className={`flex-1 rounded-sm py-1 text-center text-[10px] font-medium uppercase tracking-wider transition ${
                step === i
                  ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-2 space-y-3">
          {step === 0 && (
            <>
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input id="name" value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Ferguson Bath, Kitchen & Lighting" />
              </div>
              <div>
                <Label htmlFor="desc">Description</Label>
                <Input id="desc" value={form.description} onChange={(e) => update({ description: e.target.value })} placeholder="Brief description" />
              </div>
              <div>
                <Label htmlFor="price">Price Point</Label>
                <div className="flex gap-1.5">
                  {PRICE_POINTS.map((pp) => (
                    <Button
                      key={pp}
                      size="sm"
                      type="button"
                      variant={form.pricePoint === pp ? "default" : "outline"}
                      onClick={() => update({ pricePoint: form.pricePoint === pp ? "" : pp })}
                      className="font-mono"
                    >
                      {pp}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="website">Website</Label>
                <Input id="website" value={form.websiteUrl} onChange={(e) => update({ websiteUrl: e.target.value })} placeholder="https://..." />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <Label htmlFor="city">Bay Area City</Label>
                <select
                  id="city"
                  value={form.bayAreaCityId}
                  onChange={(e) => update({ bayAreaCityId: e.target.value })}
                  className="w-full rounded-md bg-card px-3 py-2 text-sm text-foreground ring-1 ring-border/40 focus:ring-primary/40"
                >
                  <option value="">Select a city…</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.bayAreaCityName} {c.hubRoute ? `(Hub ${c.hubRoute})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="address">Address</Label>
                <Input id="address" value={form.locationAddress} onChange={(e) => update({ locationAddress: e.target.value })} placeholder="123 Design St" />
              </div>
              <div>
                <Label htmlFor="zip">Zip Code</Label>
                <Input id="zip" value={form.zipCode} onChange={(e) => update({ zipCode: e.target.value })} placeholder="94103" />
              </div>
              <div>
                <Label htmlFor="maps">Google Maps Link</Label>
                <Input id="maps" value={form.googleMapsLink} onChange={(e) => update({ googleMapsLink: e.target.value })} placeholder="https://maps.google.com/..." />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="weekday">Weekday Hours</Label>
                  <Input id="weekday" value={form.weekdayHours} onChange={(e) => update({ weekdayHours: e.target.value })} placeholder="M-F 9am-5pm" />
                </div>
                <div>
                  <Label htmlFor="weekend">Weekend Hours</Label>
                  <Input id="weekend" value={form.weekendHours} onChange={(e) => update({ weekendHours: e.target.value })} placeholder="Sat 10am-4pm" />
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label>Open Weekends</Label>
                  <Switch checked={form.isOpenWeekends} onCheckedChange={(v) => update({ isOpenWeekends: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Appointment Only</Label>
                  <Switch checked={form.isAppointmentOnly} onCheckedChange={(v) => update({ isAppointmentOnly: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Flagship Location</Label>
                  <Switch checked={form.isFlagshipLocation} onCheckedChange={(v) => update({ isFlagshipLocation: v })} />
                </div>
              </div>
              <div>
                <Label htmlFor="scale">Scale</Label>
                <Input id="scale" value={form.scale} onChange={(e) => update({ scale: e.target.value })} placeholder="e.g. Massive, dual-wing facility" />
              </div>
              <div>
                <Label htmlFor="focus">Inventory Focus</Label>
                <Input id="focus" value={form.inventoryFocus} onChange={(e) => update({ inventoryFocus: e.target.value })} placeholder="What this location specializes in" />
              </div>
              <div>
                <Label htmlFor="demo">Target Demographic</Label>
                <Input id="demo" value={form.targetDemographic} onChange={(e) => update({ targetDemographic: e.target.value })} placeholder="e.g. Urban architects, tech executives" />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <Label htmlFor="pocName">POC Name</Label>
                <Input id="pocName" value={form.mainPocFullname} onChange={(e) => update({ mainPocFullname: e.target.value })} placeholder="Full name" />
              </div>
              <div>
                <Label htmlFor="pocPhone">POC Phone</Label>
                <Input id="pocPhone" value={form.mainPocPhoneNumber} onChange={(e) => update({ mainPocPhoneNumber: e.target.value })} placeholder="(415) 555-0100" />
              </div>
              <div>
                <Label htmlFor="pocEmail">POC Email</Label>
                <Input id="pocEmail" value={form.mainPocEmailAddress} onChange={(e) => update({ mainPocEmailAddress: e.target.value })} placeholder="name@showroom.com" />
              </div>
            </>
          )}
        </div>

        {/* Navigation */}
        <div className="mt-4 flex justify-between">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          <div className="flex gap-2">
            {step < steps.length - 1 ? (
              <Button size="sm" onClick={() => setStep(step + 1)}>
                Next
              </Button>
            ) : (
              <Button size="sm" onClick={handleSubmit} disabled={submitting || !form.name.trim()}>
                {submitting && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                Create Showroom
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export function ShowroomsDirectoryApp() {
  const [allStores, setAllStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });
  const [viewMode, setViewMode] = useState<ViewMode>("map");

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ stores: Store[] }>(
        "/api/showroom-stores?include=categories,ratings"
      );
      // Ensure enriched fields have safe defaults.
      setAllStores(
        data.stores.map((s) => ({
          ...s,
          categories: s.categories ?? [],
          avgRating: s.avgRating ?? null,
          ratingCount: s.ratingCount ?? 0,
          isAppointmentOnly: s.isAppointmentOnly ?? false,
          isFlagshipLocation: s.isFlagshipLocation ?? false,
          isOpenWeekends: s.isOpenWeekends ?? false,
        }))
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load showrooms");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMeta = useCallback(async () => {
    try {
      const [catData, cityData] = await Promise.all([
        api<{ categories: Category[] }>("/api/showroom-stores/meta/categories"),
        api<{ cities: City[] }>("/api/showroom-stores/meta/cities"),
      ]);
      setCategories(catData.categories);
      setCities(cityData.cities);
    } catch {
      // Non-critical — filters just won't show all options
    }
  }, []);

  useEffect(() => {
    fetchStores();
    fetchMeta();
  }, [fetchStores, fetchMeta]);

  // Client-side filtering (server params could also be used for large datasets)
  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return allStores.filter((s) => {
      if (filters.hub && s.hubRoute !== filters.hub) return false;
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !(s.cityName ?? "").toLowerCase().includes(q) &&
        !(s.inventoryFocus ?? "").toLowerCase().includes(q)
      )
        return false;
      if (filters.pricePoint && s.pricePoint !== filters.pricePoint) return false;
      if (filters.minRating !== null && (s.avgRating === null || s.avgRating < filters.minRating))
        return false;
      if (filters.appointmentOnly && !s.isAppointmentOnly) return false;
      if (filters.flagship && !s.isFlagshipLocation) return false;
      if (
        filters.categories.length > 0 &&
        !filters.categories.some((c) => s.categories.includes(c))
      )
        return false;
      return true;
    });
  }, [allStores, filters]);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Showrooms</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bay Area sourcing hubs. Filter, browse, and add showrooms for your renovation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <AddShowroomModal cities={cities} onCreated={fetchStores} />
        </div>
      </div>

      {/* Stats Bar */}
      {!loading && <StatsBar stores={allStores} />}

      {/* Filter Bar */}
      <div className="mt-4 mb-5">
        <FilterBar filters={filters} onChange={setFilters} allCategories={categories} />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : viewMode === "map" ? (
        <MapView stores={filtered} />
      ) : viewMode === "list" ? (
        <ListView stores={filtered} />
      ) : (
        <DirectoryView stores={filtered} />
      )}

      {/* Gap Panel */}
      <div className="mt-8">
        <GapPanel context="showroom" />
      </div>
    </main>
  );
}
