/**
 * @fileoverview Helpers for `showroom_store_links` — the source of truth for a
 * showroom's external URLs (website + socials + misc), replacing the flat
 * `website_url` / `instagram_url` / `facebook_url` / `pinterest_url` columns
 * that used to live on `showroom_stores`.
 *
 * Callers send a `links[]` payload and never touch the table shape; the worker
 * fields it out. Read paths that used to read `store.websiteUrl` now call
 * `getStoreWebsiteUrl`, and API responses derive the legacy flat fields via
 * `linksToLegacyUrls` so existing consumers keep working.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { showroomStoreLinks } from "@backend/db/schema/showroom/index";

export type ShowroomLinkType =
  | "WEBSITE"
  | "INSTAGRAM"
  | "PINTEREST"
  | "FACEBOOK"
  | "OTHER";

export const SHOWROOM_LINK_TYPES: readonly ShowroomLinkType[] = [
  "WEBSITE",
  "INSTAGRAM",
  "PINTEREST",
  "FACEBOOK",
  "OTHER",
] as const;

/** A link as sent by an API/MCP caller. */
export interface StoreLinkInput {
  url: string;
  type: ShowroomLinkType;
  urlNotes?: string | null;
}

/** The link fields returned to consumers. */
export interface StoreLinkRow {
  id: number;
  url: string;
  type: ShowroomLinkType;
  urlNotes: string | null;
}

/** Legacy flat URL fields derived from a link set (first of each type wins). */
export interface LegacyStoreUrls {
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  pinterestUrl: string | null;
}

// Broad db type so any `drizzle(env.DB)` instance is accepted.
type Db = DrizzleD1Database<Record<string, unknown>>;

// D1 rejects a query with >100 bound params; chunk `inArray` id lists below it.
const D1_IN_CHUNK = 90;

/** First URL of a given type in a link set, or null. */
function firstOfType(links: StoreLinkRow[], type: ShowroomLinkType): string | null {
  return links.find((l) => l.type === type)?.url ?? null;
}

/** Derive the legacy flat URL fields from a store's links. */
export function linksToLegacyUrls(links: StoreLinkRow[]): LegacyStoreUrls {
  return {
    websiteUrl: firstOfType(links, "WEBSITE"),
    instagramUrl: firstOfType(links, "INSTAGRAM"),
    facebookUrl: firstOfType(links, "FACEBOOK"),
    pinterestUrl: firstOfType(links, "PINTEREST"),
  };
}

/** The primary website URL for a store — its first WEBSITE link, or null. */
export async function getStoreWebsiteUrl(db: Db, storeId: number): Promise<string | null> {
  const [row] = await db
    .select({ url: showroomStoreLinks.url })
    .from(showroomStoreLinks)
    .where(and(eq(showroomStoreLinks.storeId, storeId), eq(showroomStoreLinks.type, "WEBSITE")))
    .orderBy(showroomStoreLinks.id)
    .limit(1);
  return row?.url ?? null;
}

/** All links for one store, ordered by type priority then id. */
export async function getStoreLinks(db: Db, storeId: number): Promise<StoreLinkRow[]> {
  const rows = await db
    .select({
      id: showroomStoreLinks.id,
      url: showroomStoreLinks.url,
      type: showroomStoreLinks.type,
      urlNotes: showroomStoreLinks.urlNotes,
    })
    .from(showroomStoreLinks)
    .where(eq(showroomStoreLinks.storeId, storeId))
    .orderBy(showroomStoreLinks.id);
  return sortLinks(rows as StoreLinkRow[]);
}

/** Links for many stores → Map keyed by storeId (empty array when a store has none). */
export async function getStoreLinksMap(
  db: Db,
  storeIds: number[],
): Promise<Map<number, StoreLinkRow[]>> {
  const map = new Map<number, StoreLinkRow[]>();
  for (const id of storeIds) map.set(id, []);
  if (storeIds.length === 0) return map;

  // D1 caps a query at 100 bound params — chunk the id list so a directory of
  // 120+ stores doesn't blow the limit. inArray([]) is invalid SQL, but the
  // empty case already returned above.
  for (let i = 0; i < storeIds.length; i += D1_IN_CHUNK) {
    const rows = await db
      .select({
        id: showroomStoreLinks.id,
        storeId: showroomStoreLinks.storeId,
        url: showroomStoreLinks.url,
        type: showroomStoreLinks.type,
        urlNotes: showroomStoreLinks.urlNotes,
      })
      .from(showroomStoreLinks)
      .where(inArray(showroomStoreLinks.storeId, storeIds.slice(i, i + D1_IN_CHUNK)));

    for (const r of rows) {
      const list = map.get(r.storeId);
      const link: StoreLinkRow = { id: r.id, url: r.url, type: r.type, urlNotes: r.urlNotes };
      if (list) list.push(link);
      else map.set(r.storeId, [link]);
    }
  }
  for (const [id, list] of map) map.set(id, sortLinks(list));
  return map;
}

const TYPE_ORDER: Record<ShowroomLinkType, number> = {
  WEBSITE: 0,
  INSTAGRAM: 1,
  FACEBOOK: 2,
  PINTEREST: 3,
  OTHER: 4,
};

/** Stable display order: WEBSITE, socials, OTHER; then insertion (id). */
function sortLinks(links: StoreLinkRow[]): StoreLinkRow[] {
  return [...links].sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.id - b.id);
}

/** Normalize + validate a link input; returns null when the url is empty. */
function cleanLink(input: StoreLinkInput): StoreLinkInput | null {
  const url = (input.url ?? "").trim();
  if (!url) return null;
  return {
    url,
    type: SHOWROOM_LINK_TYPES.includes(input.type) ? input.type : "OTHER",
    urlNotes: input.urlNotes?.trim() || null,
  };
}

/**
 * Replace ALL links for a store with the given set (delete + insert). Used by
 * create/update where the caller sends the full desired link list. No-op insert
 * when `links` is empty (all links removed).
 */
export async function replaceStoreLinks(
  db: Db,
  storeId: number,
  links: StoreLinkInput[],
): Promise<void> {
  await db.delete(showroomStoreLinks).where(eq(showroomStoreLinks.storeId, storeId));
  const clean = links.map(cleanLink).filter((l): l is StoreLinkInput => l !== null);
  if (clean.length === 0) return;
  await db.insert(showroomStoreLinks).values(
    clean.map((l) => ({ storeId, url: l.url, type: l.type, urlNotes: l.urlNotes ?? null })),
  );
}

/**
 * Build a `links[]` set from the legacy flat URL fields — used by intake create
 * paths (and the column backfill) that still carry discrete website/social
 * fields. Skips blank values.
 */
export function legacyUrlsToLinks(urls: Partial<LegacyStoreUrls>): StoreLinkInput[] {
  const out: StoreLinkInput[] = [];
  if (urls.websiteUrl?.trim()) out.push({ url: urls.websiteUrl.trim(), type: "WEBSITE" });
  if (urls.instagramUrl?.trim()) out.push({ url: urls.instagramUrl.trim(), type: "INSTAGRAM" });
  if (urls.facebookUrl?.trim()) out.push({ url: urls.facebookUrl.trim(), type: "FACEBOOK" });
  if (urls.pinterestUrl?.trim()) out.push({ url: urls.pinterestUrl.trim(), type: "PINTEREST" });
  return out;
}
