/**
 * @fileoverview Showroom store LOCATIONS — the 1:many sites behind one business row.
 *
 * A `showroom_stores` row is a BUSINESS (Studio Belmont, TAZ, a plumbing chain). Its
 * physical sites live in `showroom_store_locations`, one row each, joined by `store_id`.
 * A chain with Belmont + San Jose + SF + Emeryville + San Carlos showrooms is ONE store
 * row and FIVE location rows — never five stores.
 *
 * Two derivations are deliberate and must not become stored columns:
 *
 *  - **`address`** is assembled from the structured parts at read time. There is no
 *    `location_address` column on the table on purpose: a free-text formatted address
 *    gets abused by AI enrichment ("SF Bay area"), so it is a parse SOURCE only.
 *  - **`isPrimary`** is the location whose `place_id` matches the parent store's
 *    `place_id` (else the lowest id). A stored `is_primary` flag would drift the first
 *    time a site closed or a place id was corrected.
 *
 * The hub/city display fields come from the `store_bayarea_cities` join — a real FK, not
 * a denormalized copy.
 */
import { showroomStores, showroomStoreLocations, storeBayareaCities } from "@backend/db";
import { eq, inArray } from "drizzle-orm";

import type { RemodelDb } from "../../mcp/types";

/** The structured address parts a location carries. All nullable — most rows are partial. */
export interface ShowroomAddressParts {
  streetNumber?: string | null;
  streetName?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

export interface ShowroomLocationDto {
  id: number;
  storeId: number;
  /** Derived display address — never stored. `null` when no part is populated. */
  address: string | null;
  streetNumber: string | null;
  streetName: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  googleMapsLink: string | null;
  bayAreaCityId: number | null;
  /** From the `store_bayarea_cities` join — display only, never copied into this table. */
  bayAreaCityName: string | null;
  hubRoute: string | null;
  hubName: string | null;
  /** Derived: matches the parent store's `place_id`, else the lowest-id location. */
  isPrimary: boolean;
  notes: string | null;
  notesMarkdown: string | null;
  notesHtml: string | null;
}

/**
 * Assemble a display address from the structured parts, skipping anything blank.
 *
 * `"123"` + `"Main St"` + `"San Carlos"` + `"CA"` + `"94070"`
 *   → `"123 Main St, San Carlos, CA 94070"`
 *
 * Returns `null` when nothing is populated, so a caller can tell "no address on file"
 * apart from an empty string.
 */
export function formatShowroomAddress(parts: ShowroomAddressParts): string | null {
  const clean = (v: string | null | undefined) => v?.trim() || "";

  const street = [clean(parts.streetNumber), clean(parts.streetName)].filter(Boolean).join(" ");
  const stateZip = [clean(parts.state), clean(parts.zipCode)].filter(Boolean).join(" ");
  const line = [street, clean(parts.city), stateZip].filter(Boolean).join(", ");

  return line || null;
}

/**
 * ponytail: 3 lines beats importing a chunk helper from an unrelated service domain.
 * D1 rejects any statement with >100 bound parameters, and the id list here is caller
 * supplied, so it is never ours to bound — chunk it.
 */
function chunk<T>(values: T[], size = 20): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function toDto(
  row: typeof showroomStoreLocations.$inferSelect,
  city: typeof storeBayareaCities.$inferSelect | null,
  isPrimary: boolean,
): ShowroomLocationDto {
  return {
    id: row.id,
    storeId: row.storeId,
    address: formatShowroomAddress(row),
    streetNumber: row.streetNumber,
    streetName: row.streetName,
    city: row.city,
    state: row.state,
    zipCode: row.zipCode,
    latitude: row.latitude,
    longitude: row.longitude,
    placeId: row.placeId,
    googleMapsLink: row.googleMapsLink,
    bayAreaCityId: row.bayAreaCityId,
    bayAreaCityName: city?.bayAreaCityName ?? null,
    hubRoute: city?.hubRoute ?? null,
    hubName: city?.hubName ?? null,
    isPrimary,
    notes: row.notes,
    notesMarkdown: row.notesMarkdown,
    notesHtml: row.notesHtml,
  };
}

/** Mark exactly one location primary: the place_id match, else the lowest id. */
function markPrimary(
  rows: { location: typeof showroomStoreLocations.$inferSelect; city: typeof storeBayareaCities.$inferSelect | null }[],
  storePlaceId: string | null | undefined,
): ShowroomLocationDto[] {
  const sorted = [...rows].sort((a, b) => a.location.id - b.location.id);
  const primaryId =
    (storePlaceId ? sorted.find((r) => r.location.placeId === storePlaceId)?.location.id : null) ??
    sorted[0]?.location.id ??
    null;

  return sorted.map((r) => toDto(r.location, r.city, r.location.id === primaryId));
}

/**
 * Load every location for the given stores, keyed by `storeId`.
 *
 * Stores with no location row are simply absent from the map — callers should treat a
 * miss as an empty array rather than an error, because a store created by a writer that
 * predates this model will not have one until the backfill re-runs.
 */
export async function loadStoreLocations(
  db: RemodelDb,
  storeIds: number[],
): Promise<Map<number, ShowroomLocationDto[]>> {
  // Array.from, not spread — this tsconfig targets below es2015, so Set/Map spread is an error.
  const ids = Array.from(new Set(storeIds)).filter((id) => Number.isInteger(id));
  const out = new Map<number, ShowroomLocationDto[]>();
  if (ids.length === 0) return out;

  const grouped = new Map<
    number,
    { location: typeof showroomStoreLocations.$inferSelect; city: typeof storeBayareaCities.$inferSelect | null }[]
  >();
  const storePlaceIds = new Map<number, string | null>();

  for (const part of chunk(ids)) {
    const rows = await db
      .select({ location: showroomStoreLocations, city: storeBayareaCities })
      .from(showroomStoreLocations)
      .leftJoin(storeBayareaCities, eq(showroomStoreLocations.bayAreaCityId, storeBayareaCities.id))
      .where(inArray(showroomStoreLocations.storeId, part))
      .all();

    for (const r of rows) {
      const list = grouped.get(r.location.storeId) ?? [];
      list.push(r);
      grouped.set(r.location.storeId, list);
    }

    // The parent's place_id is what designates the primary site.
    const stores = await db
      .select({ id: showroomStores.id, placeId: showroomStores.placeId })
      .from(showroomStores)
      .where(inArray(showroomStores.id, part))
      .all();
    for (const s of stores) storePlaceIds.set(s.id, s.placeId);
  }

  for (const [storeId, rows] of Array.from(grouped.entries())) {
    out.set(storeId, markPrimary(rows, storePlaceIds.get(storeId)));
  }
  return out;
}

/** Convenience for the single-store case (`get_showroom`). */
export async function loadOneStoreLocations(
  db: RemodelDb,
  storeId: number,
): Promise<ShowroomLocationDto[]> {
  return (await loadStoreLocations(db, [storeId])).get(storeId) ?? [];
}

/**
 * Count locations per store in one query — for list views that want the number without
 * paying for the full rows. Same 20-id chunking.
 */
export async function loadStoreLocationCounts(
  db: RemodelDb,
  storeIds: number[],
): Promise<Map<number, number>> {
  // Array.from, not spread — this tsconfig targets below es2015, so Set/Map spread is an error.
  const ids = Array.from(new Set(storeIds)).filter((id) => Number.isInteger(id));
  const counts = new Map<number, number>();
  if (ids.length === 0) return counts;

  for (const part of chunk(ids)) {
    const rows = await db
      .select({ storeId: showroomStoreLocations.storeId })
      .from(showroomStoreLocations)
      .where(inArray(showroomStoreLocations.storeId, part))
      .all();
    for (const r of rows) counts.set(r.storeId, (counts.get(r.storeId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Map every known Google `place_id` to the store that owns it — LOCATIONS FIRST.
 *
 * This is the fix for the duplicate-store failure mode. A chain's second site only ever
 * carries its `place_id` on the location row; the store's own `place_id` describes the
 * primary site alone. Any dedupe check that reads `showroom_stores.place_id` on its own
 * therefore reports a real, already-registered branch as "not known" — and the caller
 * happily creates a second store for a business it already has.
 *
 * Pass `placeIds` to scope the lookup, or omit it to load the whole directory (the tables
 * are in the low thousands of rows, and one scan beats N queries for a batch).
 */
export async function loadPlaceIdOwners(
  db: RemodelDb,
  placeIds?: string[],
): Promise<Map<string, number>> {
  const owners = new Map<string, number>();
  const wanted = placeIds ? Array.from(new Set(placeIds.filter(Boolean))) : null;
  if (wanted && wanted.length === 0) return owners;

  // Stores first, locations second — so a location's owner wins on any disagreement,
  // since the location row is the authoritative home of a site's place id.
  const storeRows = wanted
    ? (
        await Promise.all(
          chunk(wanted).map((part) =>
            db
              .select({ id: showroomStores.id, placeId: showroomStores.placeId })
              .from(showroomStores)
              .where(inArray(showroomStores.placeId, part))
              .all(),
          ),
        )
      ).flat()
    : await db
        .select({ id: showroomStores.id, placeId: showroomStores.placeId })
        .from(showroomStores)
        .all();
  for (const r of storeRows) if (r.placeId) owners.set(r.placeId, r.id);

  const locationRows = wanted
    ? (
        await Promise.all(
          chunk(wanted).map((part) =>
            db
              .select({
                storeId: showroomStoreLocations.storeId,
                placeId: showroomStoreLocations.placeId,
              })
              .from(showroomStoreLocations)
              .where(inArray(showroomStoreLocations.placeId, part))
              .all(),
          ),
        )
      ).flat()
    : await db
        .select({
          storeId: showroomStoreLocations.storeId,
          placeId: showroomStoreLocations.placeId,
        })
        .from(showroomStoreLocations)
        .all();
  for (const r of locationRows) if (r.placeId) owners.set(r.placeId, r.storeId);

  return owners;
}

/**
 * Match a city name to an existing `store_bayarea_cities` row (case-insensitive), so a new
 * location lands in the right region cluster.
 *
 * Returns `null` when there is no match — deliberately. Minting a definition row from an
 * unvalidated string is how a vocabulary fills with typos; a genuinely new city is added
 * through the showroom onboarding path, which geocodes it first.
 */
export async function resolveBayAreaCityId(
  db: RemodelDb,
  cityName: string | null | undefined,
): Promise<number | null> {
  const wanted = cityName?.trim().toLowerCase();
  if (!wanted) return null;

  const rows = await db
    .select({ id: storeBayareaCities.id, name: storeBayareaCities.bayAreaCityName })
    .from(storeBayareaCities)
    .all();

  return rows.find((r) => r.name?.trim().toLowerCase() === wanted)?.id ?? null;
}

/**
 * The legacy `showroom_stores` address columns are still what every un-migrated reader
 * (the API routes, the frontend, drive routing, Tesla nav) uses. Until plan 0031 Phase B
 * repoints them, a write to the PRIMARY location must mirror back, or those readers go
 * stale. Non-primary sites deliberately touch the store row not at all.
 *
 * Returns the patch to apply, or `null` when there is nothing to mirror.
 */
export function primaryLocationStorePatch(
  location: typeof showroomStoreLocations.$inferSelect,
): Record<string, unknown> {
  return {
    locationAddress: formatShowroomAddress(location),
    locationStreetNumber: location.streetNumber,
    locationStreetName: location.streetName,
    locationCity: location.city,
    locationState: location.state,
    locationZipCode: location.zipCode,
    zipCode: location.zipCode,
    latitude: location.latitude,
    longitude: location.longitude,
    placeId: location.placeId,
    googleMapsLink: location.googleMapsLink,
    bayAreaCityId: location.bayAreaCityId,
  };
}

/** ponytail: self-check for the one bit of real logic here — the address assembler. */
export function __selfCheck(): void {
  const full = formatShowroomAddress({
    streetNumber: "123",
    streetName: "Main St",
    city: "San Carlos",
    state: "CA",
    zipCode: "94070",
  });
  console.assert(full === "123 Main St, San Carlos, CA 94070", `full: ${full}`);

  const partial = formatShowroomAddress({ city: "Emeryville", state: "CA" });
  console.assert(partial === "Emeryville, CA", `partial: ${partial}`);

  const blank = formatShowroomAddress({ streetName: "  ", city: null });
  console.assert(blank === null, `blank: ${blank}`);
}
