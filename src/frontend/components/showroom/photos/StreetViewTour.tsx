/**
 * @fileoverview StreetViewTour — free detection + gated render of a Google
 * Street View 360° panorama for a showroom, from its coordinates.
 *
 * Billing model (verified against Google's docs):
 *   - `StreetViewService.getPanorama()` — the detection call — is NOT billed.
 *     So we probe every store's coordinates for free on mount.
 *   - Instantiating a `StreetViewPanorama` object — the render — fires ONE
 *     Dynamic Street View (Pro SKU) billing event. We therefore defer it behind
 *     an explicit "Open tour" click AND call `POST /:id/streetview-render` first,
 *     which runs the server-side `street_view` monthly-cap guard and logs the
 *     event into `google_maps_usage_log`. A 403 means over-cap → we render nothing.
 *
 * This is the one place the app talks to Google Maps from the browser (every
 * other Maps call is server-proxied), because only the client StreetViewService
 * can resolve and render a panorama. The browser key is fetched at runtime from
 * `GET /api/places/maps-js-key` (served from the `GOOGLE_MAPS_API` secrets-store
 * binding behind auth) — never baked into the bundle. When that endpoint has no
 * key, the whole feature no-ops (renders nothing) — no errors, no black box.
 *
 * Caveat: the JS StreetViewService has no place-id lookup, only coordinates. We
 * query the store's lat/lng at a tight radius with `source: DEFAULT` (which
 * includes indoor "See inside" photospheres), so a business with an indoor tour
 * usually resolves to it — but a storefront street pano can win when no indoor
 * pano exists nearby. The manual SHOWROOM_TOUR link remains the authoritative
 * "this is THE tour" path; this is the automatic fallback.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, View } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// ─── Minimal Google Maps typings ──────────────────────────────────────────────
// Only the surface we use, declared locally to avoid pulling in @types/google.maps.

interface StreetViewPanoData {
  location?: { pano?: string } | null;
}
interface GMaps {
  StreetViewService: new () => {
    getPanorama(req: {
      location?: { lat: number; lng: number };
      radius?: number;
      source?: string;
    }): Promise<{ data: StreetViewPanoData }>;
  };
  StreetViewPanorama: new (
    el: HTMLElement,
    opts: {
      pano?: string;
      visible?: boolean;
      addressControl?: boolean;
      motionTracking?: boolean;
      motionTrackingControl?: boolean;
      fullscreenControl?: boolean;
    },
  ) => unknown;
  StreetViewSource: { DEFAULT: string; OUTDOOR: string };
}

declare global {
  interface Window {
    google?: { maps: GMaps };
    __gmapsReady?: () => void;
  }
}

let loaderPromise: Promise<GMaps> | null = null;

/** Fetch the browser Maps key from the auth-gated runtime endpoint. */
async function fetchBrowserKey(): Promise<string> {
  const res = await fetch("/api/places/maps-js-key");
  if (!res.ok) throw new Error(`maps-js-key ${res.status}`);
  const { key } = (await res.json()) as { key?: string };
  if (!key) throw new Error("maps-js-key returned no key");
  return key;
}

/** Lazily inject the Maps JS SDK once; resolves the `google.maps` namespace. */
function loadGoogleMaps(): Promise<GMaps> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("not in a browser"));
  }
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loaderPromise) return loaderPromise;

  loaderPromise = (async () => {
    const key = await fetchBrowserKey();
    return await new Promise<GMaps>((resolve, reject) => {
      window.__gmapsReady = () => resolve(window.google!.maps);
      const s = document.createElement("script");
      s.src =
        "https://maps.googleapis.com/maps/api/js" +
        `?key=${encodeURIComponent(key)}&loading=async&callback=__gmapsReady`;
      s.async = true;
      s.onerror = () => reject(new Error("Failed to load Google Maps JS"));
      document.head.appendChild(s);
    });
  })().catch((e) => {
    loaderPromise = null; // allow a later retry
    throw e;
  });
  return loaderPromise;
}

// ─── Component ─────────────────────────────────────────────────────────────────

type TourStatus = "checking" | "available" | "open" | "none";

export function StreetViewTour({
  storeId,
  placeId,
  lat,
  lng,
}: {
  storeId: number;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
}) {
  const [status, setStatus] = useState<TourStatus>("checking");
  const [opening, setOpening] = useState(false);
  const panoId = useRef<string | undefined>(undefined);
  const mapsRef = useRef<GMaps | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Free detection on mount. Renders nothing unless a panorama is found.
  useEffect(() => {
    if (lat == null || lng == null) {
      setStatus("none");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const maps = await loadGoogleMaps();
        if (cancelled) return;
        mapsRef.current = maps;
        const svc = new maps.StreetViewService();
        // Tight radius biases toward the on-premise (indoor) pano; DEFAULT source
        // includes indoor photospheres. getPanorama() is a FREE metadata call.
        const { data } = await svc.getPanorama({
          location: { lat, lng },
          radius: 50,
          source: maps.StreetViewSource.DEFAULT,
        });
        if (cancelled) return;
        const pano = data.location?.pano;
        if (pano) {
          panoId.current = pano;
          setStatus("available");
        } else {
          setStatus("none");
        }
      } catch {
        // No coverage (ZERO_RESULTS), no key, or SDK failure — stay silent.
        if (!cancelled) setStatus("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  // Gated, billable render — server checks quota + logs the event first.
  async function openTour() {
    if (opening || !mapsRef.current || !containerRef.current) return;
    setOpening(true);
    try {
      const res = await fetch(`/api/showroom-stores/${storeId}/streetview-render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panoId: panoId.current, placeId }),
      });
      if (res.status === 403) {
        toast.error("360° tour unavailable right now (monthly Street View limit reached).");
        return;
      }
      if (!res.ok) {
        toast.error("Couldn't open the 360° tour.");
        return;
      }
      setStatus("open");
      // Mount after the container is visible in the DOM (next tick).
      requestAnimationFrame(() => {
        if (!containerRef.current || !mapsRef.current) return;
        new mapsRef.current.StreetViewPanorama(containerRef.current, {
          pano: panoId.current,
          visible: true,
          addressControl: false,
          motionTrackingControl: false,
          fullscreenControl: true,
        });
      });
    } catch {
      toast.error("Couldn't open the 360° tour.");
    } finally {
      setOpening(false);
    }
  }

  if (status === "checking" || status === "none") return null;

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-border/40">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <View className="size-4 text-muted-foreground" /> 360° Street View
        </h2>
        {status === "available" ? (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={openTour} disabled={opening}>
            {opening ? <Loader2 className="size-3.5 animate-spin" /> : <View className="size-3.5" />}
            Open tour
          </Button>
        ) : null}
      </div>
      {status === "open" ? (
        <div
          ref={containerRef}
          className="mt-4 aspect-video overflow-hidden rounded-lg ring-1 ring-border/40"
        />
      ) : (
        <button
          type="button"
          onClick={openTour}
          disabled={opening}
          className="mt-4 flex aspect-video w-full items-center justify-center rounded-lg bg-muted/40 text-sm text-muted-foreground ring-1 ring-border/40 transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-60"
        >
          <View className="mr-2 size-5" /> Open the 360° walkthrough
        </button>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground/60">
        Google Street View · loads on open to stay within the free tier.
      </p>
    </div>
  );
}
