import { showroomStoreLinks, showroomStores } from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

// Accept a D1 drizzle client regardless of its schema generic — the route uses
// the bare `drizzle(env.DB)` type while MCP handlers carry a schema generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyD1Db = DrizzleD1Database<any>;

/**
 * Duplicate detection for showroom_stores, shared by the create endpoint and the
 * MCP create/import tools so NO path can add a store that already exists.
 *
 * Matches (in the order checked) an ACTIVE store by:
 *   1. Google `place_id`   — exact (also enforced by a unique index)
 *   2. phone number        — compared digits-only
 *   3. street address      — compared normalized (lowercased, alphanumerics only)
 *   4. website URL         — compared by hostname (via showroom_store_links)
 * Address is checked before website because it needs no extra query; website
 * requires loading the links table. Empty/blank inputs are ignored (guarded by
 * minimum-length checks), so a missing phone/address can't match a blank column.
 *
 * The table is small (~160 rows), so this loads the candidate columns once and
 * compares in memory rather than fighting SQL normalization.
 *
 * NOTE: this is a best-effort pre-check, not a hard constraint. Only `place_id`
 * has a DB unique index; two truly-concurrent inserts sharing only a phone/
 * website/address could still both pass. That is acceptable here (single-user
 * intake) and preferable to unique indexes on those columns, which would wrongly
 * reject legitimate distinct suites at one address / shared call-center numbers.
 */
export type DuplicateMatch = {
  id: number;
  name: string | null;
  reason: "place_id" | "phone" | "website" | "address";
  /**
   * The matched store's own Google `place_id`, or null when it has none. Lets
   * callers distinguish a store that is ALREADY located (has a placeId → a true
   * duplicate) from a bare stub matched only by phone/address/website (no
   * placeId yet → adopt the incoming location rather than reject it).
   */
  placeId: string | null;
};

export type DuplicateCheckInput = {
  placeId?: string | null;
  phoneNumber?: string | null;
  websiteUrl?: string | null;
  locationAddress?: string | null;
  /** Exclude this store id from the match (when re-checking an existing row). */
  ignoreId?: number | null;
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const normAddr = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function host(u: string | null | undefined): string {
  if (!u) return "";
  try {
    return new URL(u.includes("://") ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Find an existing ACTIVE showroom store that duplicates the given input.
 * Checks place_id, phone, address, then website (see module doc for ordering).
 * @param db - A Drizzle D1 client (schema-typed or bare).
 * @param input - Candidate fields to match against existing stores.
 * @returns The matching store `{ id, name, reason }`, or null if none.
 */
export async function findDuplicateStore(
  db: AnyD1Db,
  input: DuplicateCheckInput,
): Promise<DuplicateMatch | null> {
  const wantPlace = input.placeId?.trim() || null;
  const wantPhone = digits(input.phoneNumber);
  const wantHost = host(input.websiteUrl);
  const wantAddr = normAddr(input.locationAddress);
  if (!wantPlace && !wantPhone && !wantHost && !wantAddr) return null;

  const rows = await db
    .select({
      id: showroomStores.id,
      name: showroomStores.name,
      placeId: showroomStores.placeId,
      phoneNumber: showroomStores.phoneNumber,
      locationAddress: showroomStores.locationAddress,
    })
    .from(showroomStores)
    .where(eq(showroomStores.isActive, true))
    .all();

  const candidates = rows.filter((r) => r.id !== input.ignoreId);

  // 1. place_id
  if (wantPlace) {
    const hit = candidates.find((r) => r.placeId && r.placeId === wantPlace);
    if (hit) return { id: hit.id, name: hit.name, reason: "place_id", placeId: hit.placeId };
  }
  // 2. phone (digits)
  if (wantPhone.length >= 7) {
    const hit = candidates.find((r) => digits(r.phoneNumber) === wantPhone);
    if (hit) return { id: hit.id, name: hit.name, reason: "phone", placeId: hit.placeId };
  }
  // 3. address (normalized) — cheap, no extra query
  if (wantAddr.length >= 8) {
    const hit = candidates.find((r) => normAddr(r.locationAddress) === wantAddr);
    if (hit) return { id: hit.id, name: hit.name, reason: "address", placeId: hit.placeId };
  }
  // 4. website host — needs the links table (URLs live there now). Chunk the
  // id list under D1's 100-bound-param cap.
  if (wantHost) {
    const ids = candidates.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 90) {
      const links = await db
        .select({ storeId: showroomStoreLinks.storeId, url: showroomStoreLinks.url })
        .from(showroomStoreLinks)
        .where(
          and(eq(showroomStoreLinks.type, "WEBSITE"), inArray(showroomStoreLinks.storeId, ids.slice(i, i + 90))),
        )
        .all();
      const match = links.find((l) => host(l.url) === wantHost);
      if (match) {
        const hit = candidates.find((r) => r.id === match.storeId);
        if (hit) return { id: hit.id, name: hit.name, reason: "website", placeId: hit.placeId };
      }
    }
  }
  return null;
}
