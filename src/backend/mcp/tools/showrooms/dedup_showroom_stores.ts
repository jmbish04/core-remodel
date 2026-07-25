import {
  browserRunPages,
  driveListStops,
  productPhotoBuckets,
  productPriceObservations,
  productShowroomPhotos,
  scrapingSitemap,
  shoppingJournalEntries,
  showroomBrandMappings,
  showroomImages,
  showroomPhotosMapping,
  showroomPocs,
  showroomProductMappings,
  showroomScanLog,
  showroomStoreCategoryMapping,
  showroomStoreContactBusinessCards,
  showroomStoreContactLog,
  showroomStoreContacts,
  showroomStoreHours,
  showroomStoreLinks,
  showroomStoreRatings,
  showroomStoreSales,
  showroomStores,
  storePaMapping,
  storeRating,
  storeResearch,
  storeSimilarMap,
  storeTagMapping,
} from "@backend/db";
import { count, inArray } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { defineTool, DESTRUCTIVE } from "../../types";

/**
 * Every child column that holds a FK to `showroom_stores`, enumerated from the
 * schema (grep `references(() => showroomStores.id)`) — NOT from memory. Used to
 * COUNT attached rows in the dry-run so a human can see what data each duplicate
 * carries before anything is deleted. `{table, col}` is carried together so the
 * count query stays fully typed.
 */
const CHILD_FKS: Array<{ label: string; table: SQLiteTable; col: SQLiteColumn }> = [
  { label: "store_rating", table: storeRating, col: storeRating.storeId },
  { label: "showroom_store_ratings", table: showroomStoreRatings, col: showroomStoreRatings.storeId },
  { label: "showroom_pocs", table: showroomPocs, col: showroomPocs.showroomId },
  { label: "showroom_store_contacts", table: showroomStoreContacts, col: showroomStoreContacts.storeId },
  { label: "showroom_store_contact_log", table: showroomStoreContactLog, col: showroomStoreContactLog.storeId },
  {
    label: "showroom_store_contact_business_cards",
    table: showroomStoreContactBusinessCards,
    col: showroomStoreContactBusinessCards.storeId,
  },
  { label: "showroom_store_sales", table: showroomStoreSales, col: showroomStoreSales.storeId },
  { label: "showroom_images", table: showroomImages, col: showroomImages.storeId },
  { label: "product_price_observations", table: productPriceObservations, col: productPriceObservations.showroomId },
  { label: "drive_list_stops", table: driveListStops, col: driveListStops.showroomStoreId },
  { label: "shopping_journal_entries", table: shoppingJournalEntries, col: shoppingJournalEntries.storeId },
  // redundant / seeded / scrape / mapping — dropped on delete, not moved
  { label: "showroom_store_links", table: showroomStoreLinks, col: showroomStoreLinks.storeId },
  { label: "showroom_store_hours", table: showroomStoreHours, col: showroomStoreHours.showroomId },
  { label: "store_research", table: storeResearch, col: storeResearch.storeId },
  { label: "browser_run_pages", table: browserRunPages, col: browserRunPages.showroomId },
  { label: "showroom_photos_mapping", table: showroomPhotosMapping, col: showroomPhotosMapping.showroomId },
  { label: "store_pa_mapping", table: storePaMapping, col: storePaMapping.storeId },
  { label: "store_similar_map(parent)", table: storeSimilarMap, col: storeSimilarMap.parentStoreId },
  { label: "store_similar_map(similar)", table: storeSimilarMap, col: storeSimilarMap.similarStoreId },
  {
    label: "showroom_store_category_mapping",
    table: showroomStoreCategoryMapping,
    col: showroomStoreCategoryMapping.storeId,
  },
  { label: "store_tag_mapping", table: storeTagMapping, col: storeTagMapping.storeId },
  { label: "showroom_product_mappings", table: showroomProductMappings, col: showroomProductMappings.showroomId },
  { label: "showroom_brand_mappings", table: showroomBrandMappings, col: showroomBrandMappings.showroomId },
  { label: "product_photo_buckets", table: productPhotoBuckets, col: productPhotoBuckets.showroomId },
  { label: "product_showroom_photos", table: productShowroomPhotos, col: productShowroomPhotos.showroomId },
  { label: "showroom_scan_log", table: showroomScanLog, col: showroomScanLog.storeId },
  { label: "scraping_sitemap", table: scrapingSitemap, col: scrapingSitemap.showroomId },
];

/** DROP (explicit): non-cascade artifact tables. Their loser rows must be
 * deleted before the store delete, or the NO-ACTION FK blocks it. Everything
 * else in the "drop" category is a cascade table and needs no action. */
const DROP_EXPLICIT: Array<{ table: SQLiteTable; col: SQLiteColumn }> = [
  { table: productPhotoBuckets, col: productPhotoBuckets.showroomId },
  { table: productShowroomPhotos, col: productShowroomPhotos.showroomId },
  { table: showroomScanLog, col: showroomScanLog.storeId },
  { table: scrapingSitemap, col: scrapingSitemap.showroomId },
];

type StoreRow = {
  id: number;
  name: string;
  locationCity: string | null;
  locationAddress: string | null;
  zipCode: string | null;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  iconCfImagesUrl: string | null;
  heroImageCfImagesUrl: string | null;
  phoneNumber: string | null;
};

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** City for the grouping key: the granular column, else the `City, ST` tail of
 * the address. Two rows only merge when name AND city match, so distinct
 * branches of a chain (different cities) never collapse together. */
function cityKey(row: StoreRow): string {
  if (row.locationCity) return norm(row.locationCity);
  const parts = (row.locationAddress ?? "").split(",").map((p) => p.trim());
  for (let i = 1; i < parts.length; i++) {
    if (/^[A-Z]{2}(\s+\d{5})?$/.test(parts[i])) return norm(parts[i - 1]);
  }
  return norm(parts[0]);
}

/** Enrichment score — higher wins. Zip/placeId distinguish a genuine store from
 * a city-only re-seed shell; coords/icon/hero/phone break ties; lowest id last. */
function score(r: StoreRow): number {
  let s = 0;
  if (r.zipCode) s += 100;
  if (r.placeId) s += 40;
  if (r.latitude != null && r.longitude != null) s += 20;
  if (r.iconCfImagesUrl) s += 10;
  if (r.heroImageCfImagesUrl) s += 10;
  if (r.phoneNumber) s += 5;
  if (r.locationAddress && /\d/.test(r.locationAddress)) s += 3;
  return s;
}

/** "Real" = a distinct genuine location (zip or placeId). Shells have neither. */
const isReal = (r: StoreRow) => Boolean(r.zipCode) || Boolean(r.placeId);

const D1_IN_CHUNK = 90;
function chunk<T>(xs: T[], size = D1_IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

const changesOf = (r: unknown) => Number((r as { meta?: { changes?: number } })?.meta?.changes ?? 0);

/**
 * dedup_showroom_stores — collapse duplicate showroom_stores rows left by the
 * non-idempotent seed running multiple times.
 *
 * Grouping: (normalized name + city). Winner = most-enriched row. SAFETY: a
 * group with >=2 "real" rows (each with its own zip/placeId) is treated as
 * distinct chain branches and SKIPPED, never merged.
 *
 * Per-table policy on apply (why not a blind reparent-everything):
 *  - REPARENT — user data worth keeping (notes/ratings/pocs/contacts/sales/
 *    images/price/drive-stops/journal): moved loser -> winner.
 *  - DROP — rows the winner already has or does not need (the seeded WEBSITE
 *    link, hours, scrape logs, unique-index join mappings): left for the loser's
 *    ON DELETE CASCADE. Reparenting these would DUPLICATE the winner's data —
 *    showroom_store_links has no unique index, so a moved shell link becomes a
 *    second website link on the winner.
 *  - DROP (explicit) — non-cascade artifact tables (photo buckets, product
 *    photos, scan log, sitemap): their loser rows are deleted first, since
 *    NO-ACTION would otherwise block the store delete.
 * The dry-run prints per-table child counts so any unexpected attached data is
 * visible before apply. All writes go through db.batch() (D1 has no
 * transactions) in <=90-param chunks.
 */
export const dedupShowroomStores = defineTool({
  name: "dedup_showroom_stores",
  category: "showrooms",
  title: "Dedup showroom stores (dry-run by default)",
  description:
    "Collapse duplicate `showroom_stores` rows left by a non-idempotent seed run multiple times. Groups by " +
    "(normalized name + city), keeps the most-enriched row, treats the rest as duplicates. SAFETY: a group with " +
    "TWO+ 'real' rows (each with its own zip/placeId) is distinct chain branches and is SKIPPED, never merged. " +
    "DRY-RUN by default: reports the keep/delete map + per-table child-row counts (so attached data is visible " +
    "before deletion). apply:true reparents user-data child rows (notes/ratings/pocs/contacts/sales/images/price/" +
    "drive-stops/journal) to the keeper, DROPS redundant/seeded/scrape/mapping rows (cascade, or explicit delete " +
    "for non-cascade tables — reparenting the seeded WEBSITE link would duplicate it, since showroom_store_links " +
    "has no unique index), then deletes the losers. All writes go through db.batch() in <=90-param chunks. Run " +
    "apply ONLY after a human has approved the dry-run map.",
  inputShape: {
    apply: z
      .boolean()
      .optional()
      .describe("false/omitted = dry run (writes nothing). true = perform the reparent + delete."),
    limitGroups: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Cap the number of duplicate groups processed this call (for pacing). Default: all."),
  },
  annotations: DESTRUCTIVE,
  examples: [
    { title: "Dry run — keep/delete map + child counts", args: {} },
    { title: "Apply after approval", args: { apply: true } },
  ],
  handler: async ({ db }, input) => {
    const apply = input.apply === true;

    const all: StoreRow[] = await db
      .select({
        id: showroomStores.id,
        name: showroomStores.name,
        locationCity: showroomStores.locationCity,
        locationAddress: showroomStores.locationAddress,
        zipCode: showroomStores.zipCode,
        placeId: showroomStores.placeId,
        latitude: showroomStores.latitude,
        longitude: showroomStores.longitude,
        iconCfImagesUrl: showroomStores.iconCfImagesUrl,
        heroImageCfImagesUrl: showroomStores.heroImageCfImagesUrl,
        phoneNumber: showroomStores.phoneNumber,
      })
      .from(showroomStores)
      .all();

    const groups = new Map<string, StoreRow[]>();
    for (const r of all) {
      const key = `${norm(r.name)}||${cityKey(r)}`;
      const arr = groups.get(key);
      if (arr) arr.push(r);
      else groups.set(key, [r]);
    }

    type Plan = { keepId: number; keepName: string; deleteIds: number[] };
    const plans: Plan[] = [];
    const ambiguous: Array<{ key: string; ids: number[]; reason: string }> = [];

    for (const [key, rows] of groups) {
      if (rows.length < 2) continue;
      const reals = rows.filter(isReal);
      if (reals.length >= 2) {
        ambiguous.push({
          key,
          ids: rows.map((r) => r.id).sort((a, b) => a - b),
          reason: `${reals.length} rows have their own zip/placeId — distinct locations, not duplicates`,
        });
        continue;
      }
      const sorted = [...rows].sort((a, b) => score(b) - score(a) || a.id - b.id);
      plans.push({
        keepId: sorted[0].id,
        keepName: sorted[0].name,
        deleteIds: sorted.slice(1).map((r) => r.id),
      });
    }

    plans.sort((a, b) => a.keepId - b.keepId);
    const scoped = input.limitGroups ? plans.slice(0, input.limitGroups) : plans;
    const allDeleteIds = scoped.flatMap((p) => p.deleteIds);

    // Per-table child-row counts on the delete set (the review signal).
    const childCounts: Record<string, number> = {};
    for (const fk of CHILD_FKS) {
      let total = 0;
      for (const ids of chunk(allDeleteIds)) {
        const [row] = await db.select({ n: count() }).from(fk.table).where(inArray(fk.col, ids));
        total += row?.n ?? 0;
      }
      if (total > 0) childCounts[fk.label] = total;
    }

    if (!apply) {
      return {
        mode: "dry-run",
        totalStores: all.length,
        duplicateGroups: scoped.length,
        rowsToDelete: allDeleteIds.length,
        rowsAfter: all.length - allDeleteIds.length,
        ambiguousGroupsSkipped: ambiguous,
        childRowCounts: childCounts,
        plan: scoped,
        note:
          "Nothing was written. Review the plan + childRowCounts, then re-run with apply:true. User-data rows are " +
          "reparented to the keeper; seeded/scrape/mapping rows are dropped via cascade. ambiguousGroupsSkipped are " +
          "left untouched.",
      };
    }

    // ── APPLY: reparent user data, drop non-cascade artifacts, delete losers.
    let reparented = 0;
    let deleted = 0;
    for (const p of scoped) {
      if (p.deleteIds.length === 0) continue;
      for (const ids of chunk(p.deleteIds)) {
        // REPARENT (explicit + typed) — user data moved to the keeper.
        const reparentStmts = [
          db.update(storeRating).set({ storeId: p.keepId }).where(inArray(storeRating.storeId, ids)),
          db.update(showroomStoreRatings).set({ storeId: p.keepId }).where(inArray(showroomStoreRatings.storeId, ids)),
          db.update(showroomPocs).set({ showroomId: p.keepId }).where(inArray(showroomPocs.showroomId, ids)),
          db.update(showroomStoreContacts).set({ storeId: p.keepId }).where(inArray(showroomStoreContacts.storeId, ids)),
          db.update(showroomStoreContactLog).set({ storeId: p.keepId }).where(inArray(showroomStoreContactLog.storeId, ids)),
          db
            .update(showroomStoreContactBusinessCards)
            .set({ storeId: p.keepId })
            .where(inArray(showroomStoreContactBusinessCards.storeId, ids)),
          db.update(showroomStoreSales).set({ storeId: p.keepId }).where(inArray(showroomStoreSales.storeId, ids)),
          db.update(showroomImages).set({ storeId: p.keepId }).where(inArray(showroomImages.storeId, ids)),
          db
            .update(productPriceObservations)
            .set({ showroomId: p.keepId })
            .where(inArray(productPriceObservations.showroomId, ids)),
          db.update(driveListStops).set({ showroomStoreId: p.keepId }).where(inArray(driveListStops.showroomStoreId, ids)),
          db.update(shoppingJournalEntries).set({ storeId: p.keepId }).where(inArray(shoppingJournalEntries.storeId, ids)),
        ];
        // DROP (explicit) — non-cascade artifact tables removed first.
        const dropStmts = DROP_EXPLICIT.map((d) => db.delete(d.table).where(inArray(d.col, ids)));
        const deleteStmt = db.delete(showroomStores).where(inArray(showroomStores.id, ids));

        const batch = [...reparentStmts, ...dropStmts, deleteStmt];
        const res = await db.batch(batch as [(typeof batch)[number], ...(typeof batch)[number][]]);

        for (let i = 0; i < reparentStmts.length; i++) reparented += changesOf(res[i]);
        deleted += changesOf(res[res.length - 1]);
      }
    }

    return {
      mode: "apply",
      totalStoresBefore: all.length,
      duplicateGroups: scoped.length,
      childRowsReparented: reparented,
      rowsDeleted: deleted,
      totalStoresAfter: all.length - deleted,
      ambiguousGroupsSkipped: ambiguous,
    };
  },
});
