/**
 * @fileoverview Move every child/support row from one showroom store onto another.
 *
 * Shared by BOTH merge paths so neither re-lists the ~25 FK tables that hang off a store:
 *   - `dedup_showroom_stores` (0046, Tier 1) — merging same-site duplicate STUBS;
 *   - the 0047 branch-collapse service (Tier 2) — folding a real BRANCH into the keeper.
 *
 * Two kinds of child table, handled differently:
 *   - SIMPLE_MOVE: per-event / per-item rows with no (store, x) uniqueness. Every loser
 *     row is simply repointed to the keeper.
 *   - DEDUP_MOVE: rows with a UNIQUE or logical (store, key…) identity. Moving a loser row
 *     the keeper already has would create a duplicate or trip a unique index, so a loser
 *     row is MOVED only if the keeper lacks that key; otherwise it is dropped as redundant.
 *
 * D1 caps a statement at 100 bound parameters, so every multi-id write is chunked.
 */
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
  storeNotes,
  storePaMapping,
  storeRating,
  storeResearch,
  storeSimilarMap,
  storeTagMapping,
} from "@backend/db";
import { inArray } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import type { RemodelDb } from "../../mcp/types";

const SIMPLE_MOVE: Array<{ label: string; table: SQLiteTable; col: SQLiteColumn; key: string }> = [
  { label: "store_notes", table: storeNotes, col: storeNotes.storeId, key: "storeId" },
  { label: "store_rating", table: storeRating, col: storeRating.storeId, key: "storeId" },
  { label: "showroom_store_ratings", table: showroomStoreRatings, col: showroomStoreRatings.storeId, key: "storeId" },
  { label: "showroom_pocs", table: showroomPocs, col: showroomPocs.showroomId, key: "showroomId" },
  // showroom_store_contacts is NOT here — it has a dedicated person-dedup pass
  // (remapContactsDeduped) so a merge does not recreate the same person twice.
  { label: "showroom_store_contact_log", table: showroomStoreContactLog, col: showroomStoreContactLog.storeId, key: "storeId" },
  {
    label: "showroom_store_contact_business_cards",
    table: showroomStoreContactBusinessCards,
    col: showroomStoreContactBusinessCards.storeId,
    key: "storeId",
  },
  { label: "showroom_store_sales", table: showroomStoreSales, col: showroomStoreSales.storeId, key: "storeId" },
  { label: "showroom_images", table: showroomImages, col: showroomImages.storeId, key: "storeId" },
  { label: "product_price_observations", table: productPriceObservations, col: productPriceObservations.showroomId, key: "showroomId" },
  { label: "drive_list_stops", table: driveListStops, col: driveListStops.showroomStoreId, key: "showroomStoreId" },
  { label: "shopping_journal_entries", table: shoppingJournalEntries, col: shoppingJournalEntries.storeId, key: "storeId" },
  { label: "store_research", table: storeResearch, col: storeResearch.storeId, key: "storeId" },
  { label: "showroom_scan_log", table: showroomScanLog, col: showroomScanLog.storeId, key: "storeId" },
  { label: "browser_run_pages", table: browserRunPages, col: browserRunPages.showroomId, key: "showroomId" },
  { label: "scraping_sitemap", table: scrapingSitemap, col: scrapingSitemap.showroomId, key: "showroomId" },
  { label: "product_photo_buckets", table: productPhotoBuckets, col: productPhotoBuckets.showroomId, key: "showroomId" },
  { label: "product_showroom_photos", table: productShowroomPhotos, col: productShowroomPhotos.showroomId, key: "showroomId" },
  { label: "showroom_photos_mapping", table: showroomPhotosMapping, col: showroomPhotosMapping.showroomId, key: "showroomId" },
  { label: "store_similar_map(parent)", table: storeSimilarMap, col: storeSimilarMap.parentStoreId, key: "parentStoreId" },
  { label: "store_similar_map(similar)", table: storeSimilarMap, col: storeSimilarMap.similarStoreId, key: "similarStoreId" },
];

const DEDUP_MOVE: Array<{
  label: string;
  table: SQLiteTable;
  col: SQLiteColumn;
  key: string;
  pk: SQLiteColumn;
  keyCols: SQLiteColumn[];
}> = [
  {
    label: "showroom_store_links",
    table: showroomStoreLinks,
    col: showroomStoreLinks.storeId,
    key: "storeId",
    pk: showroomStoreLinks.id,
    keyCols: [showroomStoreLinks.url, showroomStoreLinks.type],
  },
  {
    label: "showroom_store_hours",
    table: showroomStoreHours,
    col: showroomStoreHours.showroomId,
    key: "showroomId",
    pk: showroomStoreHours.id,
    keyCols: [showroomStoreHours.day],
  },
  {
    label: "store_tag_mapping",
    table: storeTagMapping,
    col: storeTagMapping.storeId,
    key: "storeId",
    pk: storeTagMapping.id,
    keyCols: [storeTagMapping.showroomTagId],
  },
  {
    label: "showroom_store_category_mapping",
    table: showroomStoreCategoryMapping,
    col: showroomStoreCategoryMapping.storeId,
    key: "storeId",
    pk: showroomStoreCategoryMapping.id,
    keyCols: [showroomStoreCategoryMapping.categoryId],
  },
  {
    label: "store_pa_mapping",
    table: storePaMapping,
    col: storePaMapping.storeId,
    key: "storeId",
    pk: storePaMapping.id,
    keyCols: [storePaMapping.productAreaId],
  },
  {
    label: "showroom_product_mappings",
    table: showroomProductMappings,
    col: showroomProductMappings.showroomId,
    key: "showroomId",
    pk: showroomProductMappings.id,
    keyCols: [showroomProductMappings.productId],
  },
  {
    label: "showroom_brand_mappings",
    table: showroomBrandMappings,
    col: showroomBrandMappings.showroomId,
    key: "showroomId",
    pk: showroomBrandMappings.id,
    keyCols: [showroomBrandMappings.brandId],
  },
];

const D1_IN_CHUNK = 90;
function chunk<T>(xs: T[], size = D1_IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
const changesOf = (r: unknown) => Number((r as { meta?: { changes?: number } })?.meta?.changes ?? 0);
const keyOf = (row: Record<string, unknown>, cols: SQLiteColumn[]) =>
  cols.map((c) => String(row[c.name] ?? "∅")).join("");

/**
 * Person identity for a contact — matches the from-pocs backfill key so the two dedup
 * paths agree on "the same person": normalized name + phones + email. GENERAL_CONTACT
 * rows (no name) collapse on phone/email.
 */
const contactKey = (r: Record<string, unknown>) =>
  [r.firstName, r.lastName, r.officePhoneNumber, r.mobilePhoneNumber, r.emailAddress]
    .map((v) => String(v ?? "").trim().toLowerCase())
    .join("|");

/**
 * Move `showroom_store_contacts` from losers onto the keeper WITHOUT recreating a person
 * the keeper already has. A loser contact whose person-key already exists on the keeper is
 * dropped; otherwise it is repointed. Moved contacts lose `is_primary` — the keeper keeps
 * its own primary, and two `is_primary` rows per (store, location) would trip
 * `ssc_one_primary_per_location`.
 *
 * ponytail: a moved contact keeps its `location_id` (it points at the loser's site row,
 * which the merge soft-deletes the STORE but not the location, so the FK stays valid). If
 * the keeper had zero contacts, the merged set ends with no primary — acceptable; re-flag
 * in the UI. Per-site location remap is the separate Phase-L concern.
 */
async function remapContactsDeduped(
  db: RemodelDb,
  keeperId: number,
  loserIds: number[],
): Promise<number> {
  let moved = 0;
  const keeperRows = await db
    .select()
    .from(showroomStoreContacts)
    .where(inArray(showroomStoreContacts.storeId, [keeperId]))
    .all();
  const seen = new Set(keeperRows.map((r) => contactKey(r as Record<string, unknown>)));

  for (const ids of chunk(loserIds)) {
    const rows = await db
      .select()
      .from(showroomStoreContacts)
      .where(inArray(showroomStoreContacts.storeId, ids))
      .all();
    const toDrop: number[] = [];
    const toMove: number[] = [];
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const id = Number(row.id);
      const k = contactKey(row);
      if (seen.has(k)) toDrop.push(id);
      else {
        seen.add(k);
        toMove.push(id);
      }
    }
    for (const part of chunk(toDrop))
      if (part.length)
        await db.delete(showroomStoreContacts).where(inArray(showroomStoreContacts.id, part)).run();
    for (const part of chunk(toMove))
      if (part.length) {
        const res = await db
          .update(showroomStoreContacts)
          .set({ storeId: keeperId, isPrimary: false })
          .where(inArray(showroomStoreContacts.id, part))
          .run();
        moved += changesOf(res);
      }
  }
  return moved;
}

/**
 * Move every child/support row from `loserIds` onto `keeperId`. DEDUP_MOVE tables drop a
 * loser row the keeper already has (by its identity columns); SIMPLE_MOVE tables repoint
 * everything; `showroom_store_contacts` gets a dedicated person-dedup pass. Returns the
 * number of rows moved. Does NOT touch `showroom_stores` itself — the caller decides when
 * to soft-delete the loser.
 */
export async function remapStoreChildren(
  db: RemodelDb,
  keeperId: number,
  loserIds: number[],
): Promise<number> {
  if (loserIds.length === 0) return 0;
  let moved = await remapContactsDeduped(db, keeperId, loserIds);

  for (const t of DEDUP_MOVE) {
    const keeperRows = await db.select().from(t.table).where(inArray(t.col, [keeperId])).all();
    const keeperKeys = new Set(
      keeperRows.map((r) => keyOf(r as Record<string, unknown>, t.keyCols)),
    );
    for (const ids of chunk(loserIds)) {
      const dupeRows = await db.select().from(t.table).where(inArray(t.col, ids)).all();
      const toMove: number[] = [];
      const toDrop: number[] = [];
      for (const r of dupeRows) {
        const row = r as Record<string, unknown>;
        const id = Number(row[t.pk.name]);
        if (keeperKeys.has(keyOf(row, t.keyCols))) toDrop.push(id);
        else {
          toMove.push(id);
          keeperKeys.add(keyOf(row, t.keyCols));
        }
      }
      for (const part of chunk(toDrop))
        if (part.length) await db.delete(t.table).where(inArray(t.pk, part)).run();
      for (const part of chunk(toMove))
        if (part.length) {
          const res = await db
            .update(t.table)
            .set({ [t.key]: keeperId } as Record<string, number>)
            .where(inArray(t.pk, part))
            .run();
          moved += changesOf(res);
        }
    }
  }

  for (const t of SIMPLE_MOVE) {
    for (const ids of chunk(loserIds)) {
      const res = await db
        .update(t.table)
        .set({ [t.key]: keeperId } as Record<string, number>)
        .where(inArray(t.col, ids))
        .run();
      moved += changesOf(res);
    }
  }

  return moved;
}

/** Count the child/support rows currently attached to a set of stores (the review signal). */
export async function countStoreChildren(
  db: RemodelDb,
  storeIds: number[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (storeIds.length === 0) return counts;
  // Contacts have a dedicated dedup pass (not in SIMPLE_MOVE) — count them explicitly.
  let contactTotal = 0;
  for (const ids of chunk(storeIds)) {
    const rows = await db
      .select({ id: showroomStoreContacts.id })
      .from(showroomStoreContacts)
      .where(inArray(showroomStoreContacts.storeId, ids))
      .all();
    contactTotal += rows.length;
  }
  if (contactTotal > 0) counts["showroom_store_contacts"] = contactTotal;
  for (const fk of [...SIMPLE_MOVE, ...DEDUP_MOVE]) {
    let total = 0;
    for (const ids of chunk(storeIds)) {
      const rows = await db.select({ id: fk.col }).from(fk.table).where(inArray(fk.col, ids)).all();
      total += rows.length;
    }
    if (total > 0) counts[fk.label] = total;
  }
  return counts;
}
