/**
 * @fileoverview Interactive drive-route map.
 *
 * A full-width, pan/zoom MapLibre map for the Drive viewport: it plots every
 * shown stop as a LABELED custom HTML marker ("1", "2", "3", "3a", "3b" — the
 * caller precomputes labels so optional detours read as forks off their core
 * stop) and draws a faint route line through the CORE stops only, in order.
 *
 * Free CartoCDN dark basemap — NO API key. Raw MapLibre (not react-map-gl) to
 * mirror the sibling `DriveMapThumb.tsx` setup idiom exactly: fitBounds over the
 * rendered points, a GeoJSON LineString source/layer added on `load`, a stable
 * dependency key so an identical-but-new `stops` array never tears down the GL
 * context, and full teardown (`map.remove()`, cleared marker array) on unmount /
 * before every rebuild. Unlike the thumbnail this map is always on-screen, so
 * there is no IntersectionObserver lazy-init — it builds on mount.
 *
 * Custom HTML markers (vs the thumbnail's circle layer) are what let us paint
 * the label text and the core/optional/visited states per stop.
 */
import { useEffect, useRef, type JSX } from "react";
import MapLibreGL from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPinned } from "lucide-react";

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const CORE_COLOR = "#fb923c"; // orange-400 — reads on the dark basemap
const VISITED_CORE_BG = "#4d7c4d"; // muted green
const INK = "#0a0a0a";

export type RouteMapStop = {
  id: number;
  label: string; // "1", "2", "3", "3a", "3b" — precomputed by the caller
  lat: number;
  lng: number;
  isOptional: boolean;
  visited: boolean;
};

const isFinitePt = (s: RouteMapStop) => Number.isFinite(s.lat) && Number.isFinite(s.lng);

/** Build the styled HTML element for one stop marker. */
function makeMarkerEl(stop: RouteMapStop): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = stop.label;
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.borderRadius = "9999px";
  el.style.fontWeight = "700";
  el.style.fontSize = "12px";
  el.style.lineHeight = "1";
  el.style.boxSizing = "border-box";
  el.style.userSelect = "none";
  el.style.pointerEvents = "none";

  if (stop.isOptional) {
    el.style.width = "22px";
    el.style.height = "22px";
    el.style.background = "transparent";
    el.style.border = `2px dashed ${CORE_COLOR}`;
    el.style.color = CORE_COLOR;
  } else {
    el.style.width = "26px";
    el.style.height = "26px";
    el.style.background = stop.visited ? VISITED_CORE_BG : CORE_COLOR;
    el.style.color = INK;
  }

  if (stop.visited) el.style.opacity = "0.55";
  return el;
}

export function DriveRouteMap({ stops }: { stops: RouteMapStop[] }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreGL.Map | null>(null);
  const markersRef = useRef<MapLibreGL.Marker[]>([]);

  const rendered = stops.filter(isFinitePt);
  // Stable identity: rebuild when the rendered set, positions, or visited flags
  // change, but not on a fresh-but-equal array reference.
  const stopsKey = rendered
    .map((s) => `${s.label}:${s.lat},${s.lng}:${s.visited}`)
    .join(";");

  useEffect(() => {
    if (!containerRef.current || rendered.length === 0) return;

    const points: [number, number][] = rendered.map((s) => [s.lng, s.lat]);
    const map = new MapLibreGL.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      attributionControl: false,
      center: points[0],
      zoom: 10,
    });
    mapRef.current = map;
    map.addControl(new MapLibreGL.NavigationControl({ showCompass: false }), "top-right");

    // Custom HTML markers — added immediately (they don't need the style loaded).
    markersRef.current = rendered.map((s) =>
      new MapLibreGL.Marker({ element: makeMarkerEl(s) }).setLngLat([s.lng, s.lat]).addTo(map),
    );

    map.on("load", () => {
      map.resize();
      const bounds = points.reduce(
        (b, p) => b.extend(p),
        new MapLibreGL.LngLatBounds(points[0], points[0]),
      );
      map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 0 });

      // Route line through CORE stops only, in order.
      const core = rendered.filter((s) => !s.isOptional).map((s) => [s.lng, s.lat]);
      if (core.length >= 2) {
        map.addSource("route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: core } },
        });
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: { "line-color": CORE_COLOR, "line-width": 2, "line-opacity": 0.5 },
        });
      }
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey]);

  if (rendered.length === 0) {
    return (
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg bg-muted">
        <div className="absolute inset-0 flex items-center justify-center">
          <MapPinned className="size-6 text-muted-foreground/50" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-72 w-full overflow-hidden rounded-xl bg-muted ring-1 ring-border/40 sm:h-80">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

export default DriveRouteMap;
