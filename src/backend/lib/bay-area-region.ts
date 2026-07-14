/**
 * @fileoverview Bay Area region classifier — the single source of truth for
 * assigning a showroom to one of the five procurement "hubs" (regions) from its
 * geography rather than from a free-text label.
 *
 * The five hubs mirror `store_bayarea_cities.hub_route` (A–E):
 *   A → "SF Design District"        (San Francisco)
 *   B → "Silicon Valley & South Bay"(Santa Clara county / South Bay)
 *   C → "Peninsula / Mid-Market"    (San Mateo county / mid-peninsula)
 *   D → "East Bay"                  (Alameda + Contra Costa)
 *   E → "North Bay"                 (Marin / Sonoma / Napa / Solano)
 *
 * Classification is DYNAMIC and derived from the showroom's own address, in
 * priority order:
 *   1. lat/lng          → nearest hub centroid (authoritative; Places always
 *                         returns coordinates so new intakes get this).
 *   2. city name        → matched from the formatted address against a curated
 *                         Bay Area city → region table (accurate for legacy /
 *                         manually-typed rows that have an address but no coords).
 *   3. ZIP prefix       → coarse county-prefix fallback.
 *
 * This lets both the intake flow (capture the region once) and the directory
 * API (a cheap read-time fallback) resolve a region WITHOUT ever calling the
 * Places API on page load.
 */

export type HubRoute = "A" | "B" | "C" | "D" | "E";

export interface BayAreaHub {
  route: HubRoute;
  /** Human-readable hub name — matches `store_bayarea_cities.hub_name`. */
  name: string;
  /** Short region label used by filters and map markers. */
  label: string;
  /** Centroid used for nearest-hub classification and map framing. */
  lat: number;
  lng: number;
}

/** The five Bay Area procurement hubs, keyed by route letter. */
export const BAY_AREA_HUBS: Record<HubRoute, BayAreaHub> = {
  A: { route: "A", name: "SF Design District", label: "SF", lat: 37.7749, lng: -122.4194 },
  B: { route: "B", name: "Silicon Valley & South Bay", label: "South Bay", lat: 37.3382, lng: -121.8863 },
  C: { route: "C", name: "Peninsula / Mid-Market", label: "Peninsula", lat: 37.5072, lng: -122.2603 },
  D: { route: "D", name: "East Bay", label: "East Bay", lat: 37.8044, lng: -122.2712 },
  E: { route: "E", name: "North Bay", label: "North Bay", lat: 37.906, lng: -122.545 },
};

export interface RegionResult {
  route: HubRoute;
  name: string;
}

function hubResult(route: HubRoute): RegionResult {
  return { route, name: BAY_AREA_HUBS[route].name };
}

// ─── 1. lat/lng → nearest hub centroid ─────────────────────────────────────────

/**
 * Rough bounds guard so a coordinate far outside the Bay Area (a bad geocode,
 * an out-of-area place) is not force-fit to the nearest hub. Generous box
 * covering the nine-county Bay Area.
 */
function isInBayArea(lat: number, lng: number): boolean {
  return lat >= 36.9 && lat <= 38.9 && lng >= -123.2 && lng <= -121.1;
}

/**
 * Classify a coordinate to the nearest hub centroid (squared Euclidean distance
 * in lat/lng space — fine at this scale). Returns null when the point is well
 * outside the Bay Area.
 */
export function regionFromLatLng(lat: number, lng: number): RegionResult | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!isInBayArea(lat, lng)) return null;

  let best: HubRoute | null = null;
  let bestDist = Infinity;
  for (const hub of Object.values(BAY_AREA_HUBS)) {
    const dLat = hub.lat - lat;
    const dLng = hub.lng - lng;
    const dist = dLat * dLat + dLng * dLng;
    if (dist < bestDist) {
      bestDist = dist;
      best = hub.route;
    }
  }
  return best ? hubResult(best) : null;
}

// ─── 2. city name → region ─────────────────────────────────────────────────────

/**
 * Curated Bay Area city → hub route. Lowercased city name → route. Kept flat and
 * explicit so a boundary city lands in the RIGHT county-hub rather than the
 * geometrically-nearest one. Not exhaustive — unknown cities fall through to the
 * ZIP heuristic.
 */
const CITY_REGION: Record<string, HubRoute> = {
  // ── A: San Francisco ──
  "san francisco": "A",
  "sf": "A",

  // ── B: Santa Clara county / South Bay ──
  "san jose": "B",
  "santa clara": "B",
  "sunnyvale": "B",
  "mountain view": "B",
  "cupertino": "B",
  "campbell": "B",
  "los gatos": "B",
  "saratoga": "B",
  "milpitas": "B",
  "morgan hill": "B",
  "gilroy": "B",
  "palo alto": "B",
  "los altos": "B",
  "los altos hills": "B",
  "east palo alto": "B",
  "alviso": "B",

  // ── C: San Mateo county / Peninsula ──
  "san mateo": "C",
  "belmont": "C",
  "burlingame": "C",
  "millbrae": "C",
  "hillsborough": "C",
  "foster city": "C",
  "redwood city": "C",
  "san carlos": "C",
  "menlo park": "C",
  "atherton": "C",
  "portola valley": "C",
  "woodside": "C",
  "daly city": "C",
  "south san francisco": "C",
  "san bruno": "C",
  "brisbane": "C",
  "pacifica": "C",
  "half moon bay": "C",
  "colma": "C",

  // ── D: East Bay (Alameda + Contra Costa) ──
  "oakland": "D",
  "berkeley": "D",
  "alameda": "D",
  "emeryville": "D",
  "albany": "D",
  "el cerrito": "D",
  "richmond": "D",
  "san leandro": "D",
  "hayward": "D",
  "union city": "D",
  "fremont": "D",
  "newark": "D",
  "castro valley": "D",
  "dublin": "D",
  "pleasanton": "D",
  "livermore": "D",
  "san ramon": "D",
  "danville": "D",
  "walnut creek": "D",
  "concord": "D",
  "pleasant hill": "D",
  "martinez": "D",
  "lafayette": "D",
  "orinda": "D",
  "moraga": "D",
  "pittsburg": "D",
  "antioch": "D",
  "brentwood": "D",
  "oakley": "D",
  "hercules": "D",
  "pinole": "D",
  "san pablo": "D",

  // ── E: North Bay (Marin / Sonoma / Napa / Solano) ──
  "san rafael": "E",
  "novato": "E",
  "mill valley": "E",
  "sausalito": "E",
  "tiburon": "E",
  "corte madera": "E",
  "larkspur": "E",
  "san anselmo": "E",
  "fairfax": "E",
  "greenbrae": "E",
  "petaluma": "E",
  "santa rosa": "E",
  "rohnert park": "E",
  "sonoma": "E",
  "sebastopol": "E",
  "healdsburg": "E",
  "windsor": "E",
  "napa": "E",
  "american canyon": "E",
  "st helena": "E",
  "saint helena": "E",
  "calistoga": "E",
  "yountville": "E",
  "vallejo": "E",
  "benicia": "E",
  "fairfield": "E",
  "vacaville": "E",
  "suisun city": "E",
};

/**
 * Extract a region from a formatted address by matching the longest known city
 * name it contains. "123 Foo St, South San Francisco, CA 94080, USA" matches
 * "south san francisco" (C) rather than "san francisco" (A) because the longest
 * match wins.
 */
export function regionFromAddress(address: string | null | undefined): RegionResult | null {
  if (!address) return null;
  const hay = address.toLowerCase();
  let best: { route: HubRoute; len: number } | null = null;
  for (const [city, route] of Object.entries(CITY_REGION)) {
    // Word-boundary-ish contains: require the city token to be delimited so
    // "alameda" doesn't match inside "alameda county" spuriously (still fine)
    // and "napa" doesn't match "wynappa". A comma/space/edge boundary is enough
    // for formatted addresses.
    const idx = hay.indexOf(city);
    if (idx === -1) continue;
    const before = idx === 0 ? " " : hay[idx - 1];
    const after = idx + city.length >= hay.length ? " " : hay[idx + city.length];
    // Reject a match glued to another alphanumeric token (a letter OR a digit),
    // so "napa" inside "123napa" / "napafoo" is not treated as the city Napa.
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
    if (!best || city.length > best.len) best = { route, len: city.length };
  }
  return best ? hubResult(best.route) : null;
}

// ─── 3. ZIP prefix → region (coarse fallback) ──────────────────────────────────

/**
 * Napa + Solano ZIP codes that fall inside (or adjacent to) the East Bay 945xx /
 * 956xx numeric ranges. Enumerated because they can't be captured by a clean
 * range without also grabbing genuine East Bay (945xx) or Sacramento-area
 * (956xx) ZIPs. Napa: 94508/94515/94558/94559/94562/94567/94573/94574/94576/
 * 94581/94599. Solano: 94510/94512/94533/94534/94535/94571/94585/94589/94590/
 * 94591/94592/95620/95625/95687/95688/95696.
 */
const NORTH_BAY_ZIPS = new Set<number>([
  94508, 94510, 94512, 94515, 94533, 94534, 94535, 94558, 94559, 94562, 94567,
  94571, 94573, 94574, 94576, 94581, 94585, 94589, 94590, 94591, 94592, 94599,
  95620, 95625, 95687, 95688, 95696,
]);

/**
 * Coarse county-level ZIP classifier. Bay Area ZIPs overlap at boundaries, so
 * this is intentionally a LAST resort behind lat/lng and city-name matching.
 * Returns null for anything it can't confidently place.
 */
export function regionFromZip(zip: string | null | undefined): RegionResult | null {
  if (!zip) return null;
  const m = /(\d{5})/.exec(zip);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;

  // San Francisco: 94101–94199.
  if (n >= 94101 && n <= 94199) return hubResult("A");
  // Santa Clara / South Bay: 95001–95199 (San Jose metro).
  if (n >= 95001 && n <= 95199) return hubResult("B");
  // North Bay: Marin 94900–94999, Sonoma 95400–95499, plus the scattered
  // Napa + Solano pockets that interleave with the East Bay 945xx / 956xx
  // ranges (Napa, Vallejo, Benicia, Fairfield, Suisun, Vacaville, Dixon, …).
  // These are enumerated so they are NOT swept into East Bay below.
  if ((n >= 94900 && n <= 94999) || (n >= 95400 && n <= 95499) || NORTH_BAY_ZIPS.has(n)) {
    return hubResult("E");
  }
  // San Mateo / Peninsula: 94002–94099 (excluding the SF 941xx and Santa Clara
  // pockets handled by city-name matching above) + 94400–94499.
  if (n >= 94002 && n <= 94099) return hubResult("C");
  if (n >= 94400 && n <= 94499) return hubResult("C");
  // East Bay: Alameda + Contra Costa: 94500–94899 (Napa/Solano 945xx pockets
  // are handled above; anything left here is genuinely East Bay).
  if (n >= 94500 && n <= 94899) return hubResult("D");
  return null;
}

// ─── Combined classifier ───────────────────────────────────────────────────────

export interface RegionSignals {
  latitude?: number | null;
  longitude?: number | null;
  zipCode?: string | null;
  address?: string | null;
}

/**
 * Resolve a showroom's region from whatever geographic signals are available,
 * in priority order: coordinates → city name → ZIP. Returns null only when none
 * of the signals place the location in the Bay Area.
 */
export function classifyBayAreaRegion(signals: RegionSignals): RegionResult | null {
  const { latitude, longitude, zipCode, address } = signals;
  if (latitude != null && longitude != null) {
    const byCoords = regionFromLatLng(latitude, longitude);
    if (byCoords) return byCoords;
  }
  return regionFromAddress(address) ?? regionFromZip(zipCode) ?? null;
}
