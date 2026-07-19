/**
 * @fileoverview California region classifier — the single source of truth for
 * assigning a showroom to one procurement REGION from its geography rather than
 * from a free-text label. Showrooms are limited to California; the Bay Area is
 * covered at hub granularity, the rest of the state at metro granularity.
 *
 * Region codes mirror `store_bayarea_cities.hub_route`:
 *   Bay Area hubs (unchanged, legacy A–E):
 *     A → "SF Design District"         (San Francisco)
 *     B → "Silicon Valley & South Bay" (Santa Clara county / South Bay)
 *     C → "Peninsula / Mid-Market"     (San Mateo county / mid-peninsula)
 *     D → "East Bay"                   (Alameda + Contra Costa)
 *     E → "North Bay"                  (Marin / Sonoma / Napa / Solano)
 *   Rest of California:
 *     SAC  → "Sacramento / Capital"    (Sacramento metro + Sierra foothills)
 *     CCST → "Central Coast"           (Monterey / Santa Cruz / SLO / Santa Barbara)
 *     CVAL → "Central Valley"          (Stockton / Modesto / Fresno / Bakersfield)
 *     LA   → "Los Angeles / SoCal"     (LA / Orange / Inland Empire / Ventura)
 *     SD   → "San Diego"               (San Diego county)
 *     NST  → "North State"             (Redding / Chico / Humboldt / Tahoe)
 *
 * Classification is DYNAMIC and derived from the showroom's own address, in
 * priority order city → ZIP → coordinates (a city's region is a fixed curated
 * fact; nearest-centroid on coordinates is only a last resort). This lets both
 * the intake flow (capture the region once) and the directory API (a cheap
 * read-time fallback) resolve a region WITHOUT calling Places on page load.
 */

export type HubRoute = "A" | "B" | "C" | "D" | "E" | "SAC" | "CCST" | "CVAL" | "LA" | "SD" | "NST";

export interface BayAreaHub {
  route: HubRoute;
  /** Human-readable region name — matches `store_bayarea_cities.hub_name`. */
  name: string;
  /** Short region label used by filters and map markers. */
  label: string;
  /** Centroid used for nearest-region classification and map framing. */
  lat: number;
  lng: number;
}

/**
 * All California procurement regions, keyed by route code. The five Bay Area
 * hubs keep their legacy single-letter codes; broader metros use short mnemonic
 * codes. Ordered north-to-south-ish within Bay Area first, then outward.
 */
export const CA_REGIONS: Record<HubRoute, BayAreaHub> = {
  A: { route: "A", name: "SF Design District", label: "SF", lat: 37.7749, lng: -122.4194 },
  B: {
    route: "B",
    name: "Silicon Valley & South Bay",
    label: "South Bay",
    lat: 37.3382,
    lng: -121.8863,
  },
  C: {
    route: "C",
    name: "Peninsula / Mid-Market",
    label: "Peninsula",
    lat: 37.5072,
    lng: -122.2603,
  },
  D: { route: "D", name: "East Bay", label: "East Bay", lat: 37.8044, lng: -122.2712 },
  E: { route: "E", name: "North Bay", label: "North Bay", lat: 37.906, lng: -122.545 },
  SAC: {
    route: "SAC",
    name: "Sacramento / Capital",
    label: "Sacramento",
    lat: 38.5816,
    lng: -121.4944,
  },
  CCST: { route: "CCST", name: "Central Coast", label: "Central Coast", lat: 36.3, lng: -121.4 },
  CVAL: {
    route: "CVAL",
    name: "Central Valley",
    label: "Central Valley",
    lat: 36.74,
    lng: -119.78,
  },
  LA: {
    route: "LA",
    name: "Los Angeles / SoCal",
    label: "Los Angeles",
    lat: 34.0522,
    lng: -118.2437,
  },
  SD: { route: "SD", name: "San Diego", label: "San Diego", lat: 32.7157, lng: -117.1611 },
  NST: { route: "NST", name: "North State", label: "North State", lat: 39.8, lng: -122.0 },
};

/**
 * Back-compat alias. The five original Bay Area hubs plus the statewide regions
 * now live in {@link CA_REGIONS}; older references to `BAY_AREA_HUBS` keep working.
 */
export const BAY_AREA_HUBS = CA_REGIONS;

export interface RegionResult {
  route: HubRoute;
  name: string;
}

function hubResult(route: HubRoute): RegionResult {
  return { route, name: CA_REGIONS[route].name };
}

// ─── 1. lat/lng → nearest region centroid ──────────────────────────────────────

/**
 * Generous bounding box covering the state of California (plus a little slop at
 * the edges). Coordinates outside it are treated as NOT in California — used
 * both to reject out-of-state intakes and to guard the nearest-centroid fallback
 * from force-fitting a far-away point onto a California region.
 */
export function isInCalifornia(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= 32.3 && lat <= 42.2 && lng >= -124.6 && lng <= -114.0;
}

/**
 * Classify a coordinate to the nearest region centroid (squared Euclidean
 * distance in lat/lng space — fine at this scale). Returns null when the point
 * is outside California.
 */
export function regionFromLatLng(lat: number, lng: number): RegionResult | null {
  if (!isInCalifornia(lat, lng)) return null;

  let best: HubRoute | null = null;
  let bestDist = Infinity;
  for (const hub of Object.values(CA_REGIONS)) {
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
  sf: "A",

  // ── B: Santa Clara county / South Bay ──
  "san jose": "B",
  "santa clara": "B",
  sunnyvale: "B",
  "mountain view": "B",
  cupertino: "B",
  campbell: "B",
  "los gatos": "B",
  saratoga: "B",
  milpitas: "B",
  "morgan hill": "B",
  gilroy: "B",
  "palo alto": "B",
  "los altos": "B",
  "los altos hills": "B",
  "east palo alto": "B",
  alviso: "B",

  // ── C: San Mateo county / Peninsula ──
  "san mateo": "C",
  belmont: "C",
  burlingame: "C",
  millbrae: "C",
  hillsborough: "C",
  "foster city": "C",
  "redwood city": "C",
  "san carlos": "C",
  "menlo park": "C",
  atherton: "C",
  "portola valley": "C",
  woodside: "C",
  "daly city": "C",
  "south san francisco": "C",
  "san bruno": "C",
  brisbane: "C",
  pacifica: "C",
  "half moon bay": "C",
  colma: "C",

  // ── D: East Bay (Alameda + Contra Costa) ──
  oakland: "D",
  berkeley: "D",
  alameda: "D",
  emeryville: "D",
  albany: "D",
  "el cerrito": "D",
  richmond: "D",
  "san leandro": "D",
  hayward: "D",
  "union city": "D",
  fremont: "D",
  newark: "D",
  "castro valley": "D",
  dublin: "D",
  pleasanton: "D",
  livermore: "D",
  "san ramon": "D",
  danville: "D",
  "walnut creek": "D",
  concord: "D",
  "pleasant hill": "D",
  martinez: "D",
  lafayette: "D",
  orinda: "D",
  moraga: "D",
  pittsburg: "D",
  antioch: "D",
  brentwood: "D",
  oakley: "D",
  hercules: "D",
  pinole: "D",
  "san pablo": "D",

  // ── E: North Bay (Marin / Sonoma / Napa / Solano) ──
  "san rafael": "E",
  novato: "E",
  "mill valley": "E",
  sausalito: "E",
  tiburon: "E",
  "corte madera": "E",
  larkspur: "E",
  "san anselmo": "E",
  fairfax: "E",
  greenbrae: "E",
  petaluma: "E",
  "santa rosa": "E",
  "rohnert park": "E",
  sonoma: "E",
  sebastopol: "E",
  healdsburg: "E",
  windsor: "E",
  napa: "E",
  "american canyon": "E",
  "st helena": "E",
  "saint helena": "E",
  calistoga: "E",
  yountville: "E",
  vallejo: "E",
  benicia: "E",
  fairfield: "E",
  vacaville: "E",
  "suisun city": "E",

  // ── SAC: Sacramento / Capital Region ──
  sacramento: "SAC",
  "west sacramento": "SAC",
  "elk grove": "SAC",
  roseville: "SAC",
  folsom: "SAC",
  "rancho cordova": "SAC",
  "citrus heights": "SAC",
  rocklin: "SAC",
  "el dorado hills": "SAC",
  davis: "SAC",
  woodland: "SAC",
  auburn: "SAC",
  lincoln: "SAC",

  // ── CCST: Central Coast (Monterey / Santa Cruz / SLO / Santa Barbara) ──
  monterey: "CCST",
  carmel: "CCST",
  "carmel-by-the-sea": "CCST",
  "pacific grove": "CCST",
  seaside: "CCST",
  salinas: "CCST",
  "santa cruz": "CCST",
  "scotts valley": "CCST",
  capitola: "CCST",
  watsonville: "CCST",
  "san luis obispo": "CCST",
  "paso robles": "CCST",
  "pismo beach": "CCST",
  "santa maria": "CCST",
  "santa barbara": "CCST",
  goleta: "CCST",
  montecito: "CCST",
  hollister: "CCST",

  // ── CVAL: Central Valley (Stockton / Modesto / Fresno / Bakersfield) ──
  stockton: "CVAL",
  tracy: "CVAL",
  manteca: "CVAL",
  lodi: "CVAL",
  modesto: "CVAL",
  turlock: "CVAL",
  ceres: "CVAL",
  merced: "CVAL",
  fresno: "CVAL",
  clovis: "CVAL",
  visalia: "CVAL",
  tulare: "CVAL",
  bakersfield: "CVAL",

  // ── LA: Los Angeles / SoCal (LA / Orange / Inland Empire / Ventura) ──
  "los angeles": "LA",
  "long beach": "LA",
  pasadena: "LA",
  "santa monica": "LA",
  "beverly hills": "LA",
  "west hollywood": "LA",
  "culver city": "LA",
  glendale: "LA",
  burbank: "LA",
  torrance: "LA",
  malibu: "LA",
  calabasas: "LA",
  "thousand oaks": "LA",
  ventura: "LA",
  oxnard: "LA",
  anaheim: "LA",
  irvine: "LA",
  "santa ana": "LA",
  "newport beach": "LA",
  "huntington beach": "LA",
  "costa mesa": "LA",
  riverside: "LA",
  "san bernardino": "LA",
  ontario: "LA",
  "palm springs": "LA",

  // ── SD: San Diego county ──
  "san diego": "SD",
  "la jolla": "SD",
  "chula vista": "SD",
  carlsbad: "SD",
  encinitas: "SD",
  "del mar": "SD",
  oceanside: "SD",
  escondido: "SD",
  coronado: "SD",
  "solana beach": "SD",

  // ── NST: North State (Redding / Chico / Humboldt / Tahoe) ──
  redding: "NST",
  chico: "NST",
  eureka: "NST",
  truckee: "NST",
  "south lake tahoe": "NST",
};

/**
 * Match the longest known Bay Area city name contained in a formatted address,
 * returning both the canonical (lowercased) city key and its hub route.
 * "123 Foo St, South San Francisco, CA 94080, USA" matches "south san francisco"
 * (C) rather than "san francisco" (A) because the longest match wins.
 */
export function matchCityInAddress(
  address: string | null | undefined,
): { city: string; route: HubRoute } | null {
  if (!address) return null;
  const hay = address.toLowerCase();
  let best: { city: string; route: HubRoute; len: number } | null = null;
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
    if (!best || city.length > best.len) best = { city, route, len: city.length };
  }
  return best ? { city: best.city, route: best.route } : null;
}

/**
 * Extract a region from a formatted address by matching the longest known city
 * name it contains.
 */
export function regionFromAddress(address: string | null | undefined): RegionResult | null {
  const m = matchCityInAddress(address);
  return m ? hubResult(m.route) : null;
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
  94508, 94510, 94512, 94515, 94533, 94534, 94535, 94558, 94559, 94562, 94567, 94571, 94573, 94574,
  94576, 94581, 94585, 94589, 94590, 94591, 94592, 94599, 95620, 95625, 95687, 95688, 95696,
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

  // ── Rest of California (coarse metro buckets; city-name matching above wins) ──

  // Southern California: LA basin 90xxx–91xxx.
  if (n >= 90001 && n <= 91999) return hubResult("LA");
  // San Diego county: 92000–92199.
  if (n >= 92000 && n <= 92199) return hubResult("SD");
  // Inland Empire / Orange / desert (Riverside, San Bernardino, OC): 92200–92899.
  if (n >= 92200 && n <= 92899) return hubResult("LA");
  // Ventura county: 93000–93099 (SoCal).
  if (n >= 93000 && n <= 93099) return hubResult("LA");
  // Santa Barbara: 93100–93199 (Central Coast).
  if (n >= 93100 && n <= 93199) return hubResult("CCST");
  // Kern / Tulare (Bakersfield, Delano): 93200–93399.
  if (n >= 93200 && n <= 93399) return hubResult("CVAL");
  // San Luis Obispo: 93400–93499 (Central Coast).
  if (n >= 93400 && n <= 93499) return hubResult("CCST");
  // Kern / Mojave: 93500–93599.
  if (n >= 93500 && n <= 93599) return hubResult("CVAL");
  // Fresno / Madera / Visalia: 93600–93799.
  if (n >= 93600 && n <= 93799) return hubResult("CVAL");
  // Monterey / Salinas: 93900–93999 (Central Coast).
  if (n >= 93900 && n <= 93999) return hubResult("CCST");
  // San Joaquin / Stanislaus / Merced (Stockton, Modesto): 95200–95399.
  if (n >= 95200 && n <= 95399) return hubResult("CVAL");
  // Humboldt / far north coast (Eureka): 95500–95599.
  if (n >= 95500 && n <= 95599) return hubResult("NST");
  // Sacramento metro: 95600–95899 (Solano 956xx pockets already returned E above).
  if (n >= 95600 && n <= 95899) return hubResult("SAC");
  // Yuba / Sutter / Butte (Marysville, Chico): 95900–95999.
  if (n >= 95900 && n <= 95999) return hubResult("NST");
  // Shasta / Sierra / Tahoe (Redding, Susanville, Truckee): 96000–96199.
  if (n >= 96000 && n <= 96199) return hubResult("NST");
  return null;
}

// ─── Combined classifier ───────────────────────────────────────────────────────

export interface RegionSignals {
  latitude?: number | null;
  longitude?: number | null;
  zipCode?: string | null;
  address?: string | null;
  /** Parsed locality (Google `locality` address component), e.g. "San Bruno". */
  city?: string | null;
}

/**
 * Resolve a showroom's region from whatever geographic signals are available.
 *
 * Priority is CITY / ADDRESS → ZIP → coordinates, deliberately in that order:
 * a city's hub is a fixed, curated fact (San Bruno is always the Peninsula hub),
 * whereas nearest-centroid on lat/lng misfiles boundary cities — San Bruno sits
 * geometrically closer to the SF centroid than the Peninsula centroid, so a
 * coordinates-first classifier wrongly stamps it "SF Design District". The
 * centroid is therefore only a LAST resort, used when we cannot name the city
 * from its address or place it by ZIP.
 *
 * Returns null only when none of the signals place the location in California.
 */
export function classifyBayAreaRegion(signals: RegionSignals): RegionResult | null {
  const { latitude, longitude, zipCode, address, city } = signals;
  // 1. Parsed locality — the strongest, unambiguous city signal.
  if (city) {
    const route = CITY_REGION[city.trim().toLowerCase()];
    if (route) return hubResult(route);
  }
  // 2. City name matched inside the formatted address.
  const byAddress = regionFromAddress(address);
  if (byAddress) return byAddress;
  // 3. ZIP-prefix fallback.
  const byZip = regionFromZip(zipCode);
  if (byZip) return byZip;
  // 4. Nearest region centroid — last resort, coarse at region boundaries.
  if (latitude != null && longitude != null) {
    return regionFromLatLng(latitude, longitude);
  }
  return null;
}

// ─── California membership (intake gate) ────────────────────────────────────────

/** Parse a 5-digit ZIP from a bare value or a state-anchored formatted address. */
function parseZip5(zipCode: string | null | undefined, address?: string | null): number | null {
  const direct = zipCode ? /(\d{5})/.exec(zipCode) : null;
  if (direct) return parseInt(direct[1], 10);
  if (address) {
    const anchored = /\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b/i.exec(address);
    if (anchored) return parseInt(anchored[1], 10);
  }
  return null;
}

export interface CaliforniaSignals {
  state?: string | null;
  zipCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
}

/**
 * Decide whether a location is in California. Showrooms are limited to CA, but
 * the gate is deliberately conservative: it only reports `false` when there is a
 * POSITIVE out-of-state signal (an explicit non-CA state, a ZIP outside the CA
 * 90001–96199 band, or coordinates outside the state box). A location with no
 * usable geo signal is allowed through — we never block an intake we can't prove
 * is out of state. Signals are weighed most-authoritative first: explicit state,
 * then ZIP, then coordinates, then an address mention.
 */
export function isCaliforniaLocation(sig: CaliforniaSignals): boolean {
  const state = sig.state?.trim().toLowerCase();
  if (state) return state === "ca" || state === "california" || state === "calif";

  const zip = parseZip5(sig.zipCode, sig.address);
  if (zip != null) return zip >= 90001 && zip <= 96199;

  if (sig.latitude != null && sig.longitude != null) {
    return isInCalifornia(sig.latitude, sig.longitude);
  }

  if (sig.address && /\bcalif(?:ornia)?\b|,\s*ca\b/i.test(sig.address)) return true;

  // No signal proves out-of-state — allow it through.
  return true;
}

// ─── City-record resolution (FK, not free text) ────────────────────────────────

export interface CityResolution {
  /** Canonical, display-cased city name, e.g. "San Bruno". */
  name: string;
  /** Hub route the city belongs to (A–E). */
  route: HubRoute;
  /** Human-readable hub name for the route. */
  hubName: string;
}

/** Title-case a lowercased city key ("south san francisco" → "South San Francisco"). */
function titleCaseCity(key: string): string {
  return key.replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

/**
 * Resolve the specific Bay Area CITY a showroom belongs to from its geographic
 * signals — the value that should back a `bay_area_city_id` foreign key rather
 * than any free-text label. Coordinates and ZIP are honoured through the shared
 * region classifier, but the CITY itself is identified from the authoritative
 * locality: the parsed `city` component (exactly as Google returned it for these
 * coordinates) is preferred, falling back to the longest known city name found
 * in the formatted address.
 *
 * Returns null when the location cannot be tied to a curated Bay Area city; the
 * caller then leaves the FK unset (the region hub may still be derivable).
 */
export function resolveCityName(signals: RegionSignals): CityResolution | null {
  // 1. Parsed locality — authoritative when it is a curated Bay Area city.
  const parsed = signals.city?.trim();
  if (parsed) {
    const route = CITY_REGION[parsed.toLowerCase()];
    if (route) return { name: parsed, route, hubName: BAY_AREA_HUBS[route].name };
  }
  // 2. Longest city-name match inside the formatted address.
  const m = matchCityInAddress(signals.address);
  if (m) {
    return { name: titleCaseCity(m.city), route: m.route, hubName: BAY_AREA_HUBS[m.route].name };
  }
  return null;
}
