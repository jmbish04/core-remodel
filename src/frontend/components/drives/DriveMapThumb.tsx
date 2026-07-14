/**
 * @fileoverview Drive-card map thumbnail.
 *
 * A small, non-interactive MapLibre map showing the drive's showroom stops as
 * markers (coords come from the stop, else its linked showroom). Free CartoCDN
 * dark basemap — no API key. Lazy-initialised via IntersectionObserver so only
 * on-screen cards spin up a WebGL context, and torn down on unmount.
 *
 * ponytail: MapLibre per card is fine for the handful of drives this page shows;
 * if it ever lists dozens, switch to a server-rendered static PNG.
 */
import { useEffect, useRef, useState } from "react";
import MapLibreGL from "maplibre-gl";
import { MapPinned } from "lucide-react";

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const MARKER_COLOR = "#fb923c"; // orange-400 — reads on the dark basemap
const LINE_COLOR = "#fb923c";

export type LatLng = { lat: number; lng: number };

export function DriveMapThumb({ markers }: { markers: LatLng[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreGL.Map | null>(null);
  const [visible, setVisible] = useState(false);

  // Only build the map once the card scrolls into view.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !containerRef.current || markers.length === 0 || mapRef.current) return;

    const points: [number, number][] = markers.map((m) => [m.lng, m.lat]);
    const map = new MapLibreGL.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      interactive: false,
      attributionControl: false,
      center: points[0],
      zoom: 10,
    });
    mapRef.current = map;

    map.on("load", () => {
      // Lazy-mounted in a just-sized container — make sure the GL viewport
      // matches before fitting, so tiles for the right area get requested.
      map.resize();
      // Fit to all points (with a sensible max zoom for a single stop).
      const bounds = points.reduce(
        (b, p) => b.extend(p),
        new MapLibreGL.LngLatBounds(points[0], points[0]),
      );
      map.fitBounds(bounds, { padding: 28, maxZoom: 13, duration: 0 });

      if (points.length > 1) {
        map.addSource("route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } },
        });
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: { "line-color": LINE_COLOR, "line-width": 2, "line-opacity": 0.5 },
        });
      }

      map.addSource("stops", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: points.map((p) => ({
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: p },
          })),
        },
      });
      map.addLayer({
        id: "stops",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": 5,
          "circle-color": MARKER_COLOR,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0a0a0a",
        },
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [visible, markers]);

  if (markers.length === 0) {
    return (
      <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-lg bg-muted">
        <div className="absolute inset-0 flex items-center justify-center">
          <MapPinned className="size-6 text-muted-foreground/50" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-lg bg-muted">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

export default DriveMapThumb;
