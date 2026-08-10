#!/usr/bin/env node
/**
 * QC — showroom locations UI (viewport spot + modal + directory chips).
 * Run: node scripts/qc/pr_375.mjs --preview   (or bare for prod)
 *
 * Backend-only assertions (the UI is React; verified visually). Covers the two endpoints the
 * feature adds:
 *   1. GET /api/showroom-stores/:id/locations — full locations[] sorted by city asc, plus the
 *      business phone/website and active POCs, for the modal.
 *   2. GET /api/showroom-stores — every store row now carries locationCount + locationCities
 *      (unique, sorted asc), for the directory card chips.
 * Uses Jack London Kitchen and Bath (store 116) — a real 5-city chain — as the multi-location
 * fixture, and asserts a single-location store returns count 1.
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const isPreview = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC showroom-locations-ui against ${BASE}${isPreview ? " (preview)" : ""}\n`);

const isSortedAsc = (xs) => xs.every((v, i) => i === 0 || xs[i - 1].localeCompare(v) <= 0);

try {
  // ── 1. list enrichment ────────────────────────────────────────────────────
  const list = await c.get("/api/showroom-stores");
  check("/api/showroom-stores 200", list.status === 200, `status=${list.status}`);
  const stores = list.json?.stores ?? [];
  check("list returned stores", stores.length > 0, `count=${stores.length}`);

  const withCount = stores.filter((s) => typeof s.locationCount === "number");
  check("every store carries locationCount", withCount.length === stores.length);
  const withCities = stores.filter((s) => Array.isArray(s.locationCities));
  check("every store carries locationCities[]", withCities.length === stores.length);

  const badSort = stores.filter((s) => !isSortedAsc(s.locationCities ?? []));
  check("locationCities sorted asc everywhere", badSort.length === 0, `offenders=${badSort.length}`);
  const dupeCities = stores.filter(
    (s) => new Set(s.locationCities ?? []).size !== (s.locationCities ?? []).length,
  );
  check("locationCities unique everywhere", dupeCities.length === 0);

  const jl = stores.find((s) => s.id === 116);
  if (jl) {
    check("store 116 has locationCount >= 2", (jl.locationCount ?? 0) >= 2, `count=${jl.locationCount}`);
    check("store 116 cities sorted asc", isSortedAsc(jl.locationCities ?? []), JSON.stringify(jl.locationCities));
  } else {
    info("store 116 not in the active list — skipping the multi-location card assertion");
  }

  // ── 2. locations detail endpoint ──────────────────────────────────────────
  const loc = await c.get("/api/showroom-stores/116/locations");
  if (loc.status === 404) {
    info("store 116 absent on this base — skipping the /locations detail assertions");
  } else {
    check("/116/locations 200", loc.status === 200, `status=${loc.status}`);
    const j = loc.json ?? {};
    check("returns a locations array", Array.isArray(j.locations), typeof j.locations);
    check("locations sorted by city asc", isSortedAsc((j.locations ?? []).map((l) => l.city ?? "")));
    check(
      "each location has an address + a map anchor (placeId | coords | address)",
      (j.locations ?? []).every(
        (l) => l.placeId || (l.latitude != null && l.longitude != null) || l.address,
      ),
    );
    check("exposes storePhone / storeWebsite keys", "storePhone" in j && "storeWebsite" in j);
    check("returns pocs array", Array.isArray(j.pocs));
  }

  // ── 3. single-location store returns count 1 ──────────────────────────────
  const single = stores.find((s) => (s.locationCount ?? 0) === 1);
  if (single) {
    const sl = await c.get(`/api/showroom-stores/${single.id}/locations`);
    check(
      `single-location store ${single.id} returns exactly 1 location`,
      (sl.json?.locations?.length ?? 0) === 1,
      `got ${sl.json?.locations?.length}`,
    );
  } else {
    info("no single-location store found to assert the count-1 case");
  }

  // ── 4. maps key endpoint still serves (map is additive; note Embed API status) ──
  const key = await c.get("/api/places/maps-js-key");
  check("/api/places/maps-js-key reachable", key.status === 200 || key.status === 503, `status=${key.status}`);
  info(
    "NOTE: the pin map uses the Google Maps Embed API. If it is not enabled on the project the " +
      "iframe 403s and the modal shows an 'Open in Google Maps' link instead — the map is additive, " +
      "never a hard dependency.",
  );
} catch (err) {
  console.error("\nQC threw:", err?.message ?? err);
  process.exitCode = 1;
}

summary();
