/**
 * @fileoverview Multi-location surface for a showroom business (0045/0047).
 *
 * A showroom store is one business with N physical sites. These components expose that on the
 * store viewport:
 *   - `LocationsSpot` — the count + unique city chips shown just below the hero. A button that
 *     opens the modal when there are 2+ locations; concise static text when there is only one.
 *   - `LocationsModal` — a near-fullscreen, mobile-first dialog. A city rail (vertical on
 *     desktop, a horizontal scroll strip on mobile) selects a location; the pane shows its
 *     address, the business phone (tap-to-dial) + website, the contacts matched to that city,
 *     and a Google Maps Embed pin — the map is lazy, mounted only for the active location.
 *
 * Contacts/phone/website are business-level (a location row carries no phone of its own), so
 * every tab shows the store phone + website and the POCs whose address matches the city (or all
 * store contacts as a fallback). The map degrades gracefully: if the key or the Embed API is
 * unavailable, the pane still shows the address, contacts and the "Open in Google Maps" link.
 */
import { Building2, Crown, ExternalLink, Mail, MapPin, Phone, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { formatPhoneDisplay, telHrefFor } from "../ShowroomMergedCard";

// ─── Types (mirror GET /api/showroom-stores/:id/locations) ──────────────────────────────
export interface StoreLocation {
  id: number;
  address: string | null;
  streetNumber: string | null;
  streetName: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  googleMapsLink: string | null;
  hubName: string | null;
  isPrimary: boolean;
}

interface LocationPoc {
  id: number;
  fullName: string | null;
  title: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
}

interface LocationsPayload {
  locations: StoreLocation[];
  storePhone: string | null;
  storeWebsite: string | null;
  pocs: LocationPoc[];
}

// ─── Google Maps Embed key (fetched once, but only a SUCCESS is cached) ──────────────────
// A failed/empty fetch is NOT memoized — otherwise a transient 401/network blip would poison
// the map for the whole session with no way to recover but a full reload (codra/cursor P2).
let mapsKeyPromise: Promise<string | null> | null = null;
function getMapsKey(): Promise<string | null> {
  if (mapsKeyPromise) return mapsKeyPromise;
  const p = fetch("/api/places/maps-js-key", { credentials: "include" })
    .then((r) => (r.ok ? (r.json() as Promise<{ key?: string }>) : null))
    .then((j) => j?.key ?? null)
    .catch(() => null);
  mapsKeyPromise = p;
  // Drop the cache when it resolves to null, so the next tab that needs a map retries.
  void p.then((key) => {
    if (key == null && mapsKeyPromise === p) mapsKeyPromise = null;
  });
  return p;
}

/**
 * Return `url` only if it is a well-formed http(s) URL — otherwise null. Guards every href we
 * render from a stored value against `javascript:`/`data:` schemes (cursor P2): the website is
 * only length-validated on write, so a hostile value could otherwise reach an anchor here.
 */
function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Build the Embed `q` for a location: place_id → coords → address. */
function embedQuery(loc: StoreLocation): string | null {
  if (loc.placeId) return `place_id:${loc.placeId}`;
  if (loc.latitude != null && loc.longitude != null) return `${loc.latitude},${loc.longitude}`;
  if (loc.address) return loc.address;
  return null;
}

/** A best-effort Google Maps deep link for the "Open in Google Maps" button. */
function mapsHref(loc: StoreLocation): string | null {
  const gmap = safeHttpUrl(loc.googleMapsLink);
  if (gmap) return gmap;
  const q = embedQuery(loc);
  if (!q) return null;
  const term = q.startsWith("place_id:")
    ? `query_place_id=${q.slice("place_id:".length)}&query=${encodeURIComponent(loc.address ?? "")}`
    : `query=${encodeURIComponent(q)}`;
  return `https://www.google.com/maps/search/?api=1&${term}`;
}

// ─── Lazy Embed map (mounted only for the active location) ───────────────────────────────
function LocationMap({ location }: { location: StoreLocation }) {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void getMapsKey().then((k) => alive && setKey(k));
    return () => {
      alive = false;
    };
  }, []);

  const q = embedQuery(location);
  const href = mapsHref(location);

  // No coordinates/address at all, or the key/Embed API is unavailable → link-only fallback.
  if (!q || key === null || failed) {
    return (
      <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">
        <MapPin className="size-6" aria-hidden />
        <span>Map unavailable for this location.</span>
        {href && (
          <Button variant="outline" size="sm" render={<a href={href} target="_blank" rel="noreferrer" />}>
            Open in Google Maps
            <ExternalLink className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>
    );
  }

  if (key === undefined) {
    return <div className="h-full min-h-[12rem] animate-pulse rounded-lg bg-muted/40" />;
  }

  const src = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(
    key,
  )}&q=${encodeURIComponent(q)}&zoom=15`;

  return (
    <iframe
      title={`Map — ${location.city ?? location.address ?? "location"}`}
      src={src}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className="h-full min-h-[14rem] w-full rounded-lg border border-border"
      onError={() => setFailed(true)}
      allowFullScreen
    />
  );
}

// ─── One location's detail pane ──────────────────────────────────────────────────────────
function LocationPane({
  location,
  storePhone,
  storeWebsite,
  pocs,
}: {
  location: StoreLocation;
  storePhone: string | null;
  storeWebsite: string | null;
  pocs: LocationPoc[];
}) {
  // POCs whose address names this location's city or street; fall back to all store contacts.
  const matched = useMemo(() => {
    const city = location.city?.toLowerCase().trim();
    const street = location.streetName?.toLowerCase().trim();
    const hits = pocs.filter((p) => {
      const a = p.address?.toLowerCase() ?? "";
      return (city && a.includes(city)) || (street && a.includes(street));
    });
    return hits.length > 0 ? { list: hits, filtered: true } : { list: pocs, filtered: false };
  }, [pocs, location.city, location.streetName]);

  const href = mapsHref(location);
  const website = safeHttpUrl(storeWebsite);

  return (
    <div className="flex h-full flex-col gap-4 lg:flex-row">
      {/* Left: details — bounded on desktop so the map takes the rest. */}
      <div className="flex min-w-0 flex-col gap-4 overflow-y-auto lg:w-96 lg:shrink-0">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight">{location.city ?? "Location"}</h3>
            {location.isPrimary && (
              <Badge variant="secondary" className="gap-1">
                <Crown className="size-3 text-amber-400" aria-hidden /> Primary
              </Badge>
            )}
            {location.hubName && <Badge variant="outline">{location.hubName}</Badge>}
          </div>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{location.address ?? "Address on file unavailable"}</span>
          </p>
        </div>

        {/* Contact block — business phone (tap to dial) + website */}
        <div className="flex flex-col gap-2">
          {storePhone && (
            <a
              href={telHrefFor(storePhone)}
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <Phone className="size-4" aria-hidden />
              {formatPhoneDisplay(storePhone)}
            </a>
          )}
          {website && (
            <a
              href={website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="size-4" aria-hidden />
              {website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
            </a>
          )}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              <MapPin className="size-4" aria-hidden />
              Open in Google Maps
            </a>
          )}
        </div>

        {/* Contacts */}
        {matched.list.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {matched.filtered ? "Contacts at this location" : "Store contacts"}
            </p>
            <div className="flex flex-col gap-2">
              {matched.list.map((p) => (
                <div key={p.id} className="rounded-lg bg-muted/40 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <User className="size-3.5 text-muted-foreground" aria-hidden />
                    {p.fullName ?? "Contact"}
                    {p.title && (
                      <span className="text-xs font-normal text-muted-foreground">· {p.title}</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-col gap-1 text-xs">
                    {p.phone && (
                      <a
                        href={telHrefFor(p.phone)}
                        className="inline-flex items-center gap-1.5 text-primary hover:underline"
                      >
                        <Phone className="size-3" aria-hidden />
                        {formatPhoneDisplay(p.phone)}
                      </a>
                    )}
                    {p.email && (
                      <a
                        href={`mailto:${p.email}`}
                        className="inline-flex items-center gap-1.5 text-primary hover:underline"
                      >
                        <Mail className="size-3" aria-hidden />
                        {p.email}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: lazy map (mounted only for the active pane) */}
      <div className="min-h-[14rem] flex-1 lg:min-h-0">
        <LocationMap location={location} />
      </div>
    </div>
  );
}

// ─── The modal ───────────────────────────────────────────────────────────────────────────
export function LocationsModal({
  storeId,
  storeName,
  open,
  onOpenChange,
}: {
  storeId: number;
  storeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<LocationsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const loadingRef = useRef(false);

  const load = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    fetch(`/api/showroom-stores/${storeId}/locations`, { credentials: "include" })
      .then((r) =>
        r.ok ? (r.json() as Promise<LocationsPayload>) : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((j) => setData(j))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, [storeId]);

  // Lazy: fetch when the modal opens and we have no data yet. A failed load is NOT retried in
  // a loop (the effect only fires on `open` flipping), but re-opening — or the Retry button —
  // fetches again, so a transient failure is recoverable without a page reload (cursor P2).
  useEffect(() => {
    if (open && !data && !loadingRef.current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const locations = data?.locations ?? [];
  const activeLoc = locations[Math.min(active, Math.max(0, locations.length - 1))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Near-fullscreen: override the DialogContent primitive's `sm:max-w-sm`
          cap (twMerge keeps base vs sm variants separately, so a plain
          `max-w-*` here would NOT beat it on desktop) so the modal truly fills
          ~96vw × 92vh and the map gets real width. */}
      <DialogContent className="flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-3 p-4 sm:max-w-[96vw] sm:p-5">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-5 text-muted-foreground" aria-hidden />
            {storeName} — {locations.length || "…"} location{locations.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>Pick a city to see its address, contacts and map.</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading locations…
          </div>
        )}
        {error && !loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-destructive">
            <span>Couldn&apos;t load locations — {error}</span>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && locations.length > 0 && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
            {/* City rail: horizontal scroll strip on mobile, vertical rail on desktop */}
            <div
              role="tablist"
              aria-label="Locations"
              className="flex shrink-0 gap-1 overflow-x-auto pb-1 lg:w-48 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0"
            >
              {locations.map((loc, i) => (
                <button
                  key={loc.id}
                  role="tab"
                  aria-selected={i === active}
                  onClick={() => setActive(i)}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors lg:w-full",
                    i === active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/40 text-foreground/80 hover:bg-muted",
                  )}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-medium">{loc.city ?? `Location ${i + 1}`}</span>
                    {loc.isPrimary && (
                      <Crown
                        className={cn(
                          "size-3.5 shrink-0",
                          i === active ? "text-amber-200" : "text-amber-400",
                        )}
                        aria-label="Primary location"
                      />
                    )}
                  </span>
                </button>
              ))}
            </div>

            {/* Active pane */}
            <div className="min-h-0 flex-1 rounded-lg border border-border/60 p-3 sm:p-4">
              {activeLoc && (
                <LocationPane
                  key={activeLoc.id}
                  location={activeLoc}
                  storePhone={data?.storePhone ?? null}
                  storeWebsite={data?.storeWebsite ?? null}
                  pocs={data?.pocs ?? []}
                />
              )}
            </div>
          </div>
        )}

        {!loading && !error && locations.length === 0 && data && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No locations on file.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── The "Locations" spot shown below the hero ───────────────────────────────────────────
export function LocationsSpot({
  storeId,
  storeName,
  locationCount,
  locationCities,
}: {
  storeId: number;
  storeName: string;
  locationCount: number;
  locationCities: string[];
}) {
  const [open, setOpen] = useState(false);
  const cities = useMemo(
    () => [...locationCities].sort((a, b) => a.localeCompare(b)),
    [locationCities],
  );

  // Zero or one location: concise static text, no modal. Distinguish the two — "Single
  // location" is misleading when there are actually none on file (cursor P3).
  if (locationCount <= 1) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <MapPin className="size-4 shrink-0" aria-hidden />
        <span>
          {locationCount === 0
            ? "No locations on file"
            : `Single location${cities[0] ? ` · ${cities[0]}` : ""}`}
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Building2 className="size-4 text-muted-foreground" aria-hidden />
          {locationCount} locations
        </span>
        <span className="flex flex-wrap gap-1">
          {cities.map((c) => (
            <Badge key={c} variant="secondary" className="font-normal">
              {c}
            </Badge>
          ))}
        </span>
        <span className="ml-auto text-xs text-primary">View all →</span>
      </button>
      <LocationsModal
        storeId={storeId}
        storeName={storeName}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
