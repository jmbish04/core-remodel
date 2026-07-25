import { showroomStores } from "@backend/db";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { defineTool, DESTRUCTIVE } from "../../types";

/**
 * Every child table that carries a foreign key to `showroom_stores`, with the
 * column that holds it. Enumerated from the schema (grep
 * `references(() => showroomStores.id)`), NOT from memory — a missed table
 * orphans rows or, on a NO-ACTION FK, blocks the delete outright.
 *
 * `uniqueMapping` marks join tables with a UNIQUE (store, x) index where a
 * reparent could collide with a row the winner already owns. For those we
 * `UPDATE OR IGNORE` (skip the colliding loser row) and let the loser's
 * ON DELETE CASCADE remove the skipped row afterwards — every uniqueMapping
 * table here is a cascade table, so nothing is orphaned. All others are plain
 * `UPDATE` so the row definitely moves before the loser is deleted.
 */
const CHILD_FKS: Array<{ table: string; col: string; uniqueMapping: boolean }> = [
  { table: "store_notes", col: "store_id", uniqueMapping: false },
  { table: "store_pa_mapping", col: "store_id", uniqueMapping: true },
  { table: "product_photo_buckets", col: "showroom_id", uniqueMapping: false },
  { table: "showroom_pocs", col: "showroom_id", uniqueMapping: false },
  { table: "product_showroom_photos", col: "showroom_id", uniqueMapping: false },
  { table: "showroom_store_links", col: "store_id", uniqueMapping: false },
  { table: "showroom_store_sales", col: "store_id", uniqueMapping: false },
  { table: "showroom_scan_log", col: "store_id", uniqueMapping: false },
  { table: "store_research", col: "store_id", uniqueMapping: false },
  { table: "store_similar_map", col: "parent_store_id", uniqueMapping: true },
  { table: "store_similar_map", col: "similar_store_id", uniqueMapping: true },
  { table: "showroom_store_hours", col: "showroom_id", uniqueMapping: false },
  { table: "showroom_photos_mapping", col: "showroom_id", uniqueMapping: true },
  { table: "showroom_images", col: "store_id", uniqueMapping: false },
  { table: "browser_run_pages", col: "showroom_id", uniqueMapping: false },
  { table: "store_rating", col: "store_id", uniqueMapping: false },
  { table: "showroom_store_ratings", col: "store_id", uniqueMapping: false },
  { table: "product_price_observations", col: "showroom_id", uniqueMapping: false },
  { table: "showroom_store_category_mapping", col: "store_id", uniqueMapping: true },
  { table: "store_tag_mapping", col: "store_id", uniqueMapping: true },
  { table: "showroom_store_contacts", col: "store_id", uniqueMapping: false },
  { table: "showroom_store_contact_log", col: "store_id", uniqueMapping: false },
  { table: "showroom_store_contact_business_cards", col: "store_id", uniqueMapping: false },
  { table: "scraping_sitemap", col: "showroom_id", uniqueMapping: false },
  { table: "showroom_product_mappings", col: "showroom_id", uniqueMapping: true },
  { table: "showroom_brand_mappings", col: "showroom_id", uniqueMapping: true },
  { table: "drive_list_stops", col: "showroom_store_id", uniqueMapping: false },
  { table: "shopping_journal_entries", col: "store_id", uniqueMapping: false },
];

/** lowercase, collapse whitespace — for grouping identical store identities. */
const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** City for the grouping key: prefer the granular column, else the `City, ST`
 * tail of the address. Two rows only merge when name AND city match, so distinct
 * branches of a chain (different cities) never collapse together. */
function cityKey(row: { locationCity: string | null; locationAddress: string | null }): string {
  if (row.locationCity) return norm(row.locationCity);
  const addr = row.locationAddress ?? "";
  // "1100 Industrial Rd Ste 17, San Carlos, CA 94070, USA" → "san carlos"
  const parts = addr.split(",").map((p) => p.trim());
  // find the segment before the "CA 94070" / "CA" state segment
  for (let i = 0; i < parts.length; i++) {
    if (/^[A-Z]{2}(\s+\d{5})?$/.test(parts[i]) && i > 0) return norm(parts[i - 1]);
  }
  return norm(parts[0]);
}

type StoreRow = typeof showroomStores.$inferSelect;

/** Enrichment score — higher wins. A real street address (zip present) or a
 * placeId is what distinguishes a genuine store row from a city-only re-seed
 * shell; coords/icon/hero/phone break further ties; lowest id breaks the rest. */
function score(r: StoreRow): number {
  let s = 0;
  if (r.zipCode) s += 100;
  if (r.placeId) s += 40;
  if (r.latitude != null && r.longitude != null) s += 20;
  if (r.iconCfImagesUrl) s += 10;
  if (r.heroImageCfImagesUrl) s += 10;
  if (r.phoneNumber) s += 5;
  if (r.locationAddress && /\d/.test(r.locationAddress)) s += 3; // has a street number
  return s;
}

/** A row is "real" (a distinct genuine location) if it has a zip or a placeId.
 * Shells (city-only re-seed clones) have neither. */
const isReal = (r: StoreRow) => Boolean(r.zipCode) || Boolean(r.placeId);

export const dedupShowroomStores = defineTool({
  name: "dedup_showroom_stores",
  category: "showrooms",
  title: "Dedup showroom stores (dry-run by default)",
  description:
    "Collapse duplicate `showroom_stores` rows left by a non-idempotent seed that was run multiple times. Groups " +
    "stores by (normalized name + city); within a group it keeps the most-enriched row (real street address / " +
    "placeId / coords / icon; lowest id breaks ties) and treats the rest as duplicates. SAFETY: a group where TWO " +
    "or more rows are 'real' (each has its own zip or placeId) is treated as distinct branches of a chain and " +
    "SKIPPED — never merged — so 'All Natural Stone' in four cities is left untouched. DRY-RUN by default: it " +
    "reports the full keep/delete map plus, per duplicate, the count of child rows in every table with a FK to the " +
    "store (so you can see whether any real data is attached). Pass `apply:true` ONLY after a human has approved " +
    "the dry-run map — it reparents every child FK from each duplicate to the row being kept (UPDATE OR IGNORE for " +
    "unique-mapping join tables, whose skipped rows are then cleaned by ON DELETE CASCADE) and then deletes the " +
    "duplicate rows, in db.batch() units (D1 has no transactions), chunked under the 100-bound-parameter cap.",
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
    { title: "Dry run — show the keep/delete map + child counts", args: {} },
    { title: "Apply after approval", args: { apply: true } },
  ],
  handler: async ({ db }, input) => {
    const apply = input.apply === true;

    const all = await db.select().from(showroomStores).all();

    // Group by (name, city).
    const groups = new Map<string, StoreRow[]>();
    for (const r of all) {
      const key = `${norm(r.name)}||${cityKey(r)}`;
      const arr = groups.get(key);
      if (arr) arr.push(r);
      else groups.set(key, [r]);
    }

    type Plan = { key: string; keepId: number; keepName: string; deleteIds: number[] };
    const plans: Plan[] = [];
    const ambiguous: Array<{ key: string; ids: number[]; reason: string }> = [];

    for (const [key, rows] of groups) {
      if (rows.length < 2) continue; // unique — nothing to do
      const reals = rows.filter(isReal);
      if (reals.length >= 2) {
        // Two distinct genuine locations sharing (name, city). Do NOT merge —
        // that would destroy a real store. Leave the whole group for a human.
        ambiguous.push({
          key,
          ids: rows.map((r) => r.id).sort((a, b) => a - b),
          reason: `${reals.length} rows have their own zip/placeId — distinct locations, not duplicates`,
        });
        continue;
      }
      // 0 or 1 real row: the rest are city-only shells → safe to collapse.
      const sorted = [...rows].sort((a, b) => score(b) - score(a) || a.id - b.id);
      const keep = sorted[0];
      const deleteIds = sorted.slice(1).map((r) => r.id);
      plans.push({ key, keepId: keep.id, keepName: keep.name, deleteIds });
    }

    plans.sort((a, b) => a.keepId - b.keepId);
    const scoped = input.limitGroups ? plans.slice(0, input.limitGroups) : plans;
    const allDeleteIds = scoped.flatMap((p) => p.deleteIds);

    // Count child rows attached to the delete-ids, per table. This is the
    // "is any real data attached?" signal the human reviews before approving.
    const D1_IN_CHUNK = 90;
    const childCounts: Record<string, number> = {};
    if (allDeleteIds.length > 0) {
      for (const fk of CHILD_FKS) {
        let total = 0;
        for (let i = 0; i < allDeleteIds.length; i += D1_IN_CHUNK) {
          const chunk = allDeleteIds.slice(i, i + D1_IN_CHUNK);
          const rows = await db.all<{ n: number }>(
            sql`SELECT COUNT(*) AS n FROM ${sql.raw(fk.table)} WHERE ${sql.raw(fk.col)} IN (${sql.join(
              chunk.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );
          total += Number(rows?.[0]?.n ?? 0);
        }
        if (total > 0) childCounts[`${fk.table}.${fk.col}`] = total;
      }
    }

    if (!apply) {
      return {
        mode: "dry-run",
        totalStores: all.length,
        duplicateGroups: scoped.length,
        rowsToDelete: allDeleteIds.length,
        rowsAfter: all.length - allDeleteIds.length,
        ambiguousGroupsSkipped: ambiguous,
        childRowsToReparent: childCounts,
        plan: scoped.map((p) => ({ keepId: p.keepId, keepName: p.keepName, deleteIds: p.deleteIds })),
        note:
          "Nothing was written. Review the plan + childRowsToReparent, then re-run with apply:true to execute. " +
          "ambiguousGroupsSkipped are left untouched on purpose.",
      };
    }

    // ── APPLY ────────────────────────────────────────────────────────────────
    // Reparent every child FK from the losers to the keeper, then delete losers.
    // Sequential per group so a keepId is never itself a deleteId elsewhere.
    let reparented = 0;
    for (const p of scoped) {
      if (p.deleteIds.length === 0) continue;
      for (const fk of CHILD_FKS) {
        for (let i = 0; i < p.deleteIds.length; i += D1_IN_CHUNK) {
          const chunk = p.deleteIds.slice(i, i + D1_IN_CHUNK);
          const verb = fk.uniqueMapping ? sql.raw("UPDATE OR IGNORE") : sql.raw("UPDATE");
          const res = await db.run(
            sql`${verb} ${sql.raw(fk.table)} SET ${sql.raw(fk.col)} = ${p.keepId} WHERE ${sql.raw(
              fk.col,
            )} IN (${sql.join(
              chunk.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );
          reparented += Number((res as { meta?: { changes?: number } })?.meta?.changes ?? 0);
        }
      }
    }

    // Delete the losers. Cascade removes any OR-IGNORE-skipped rows in the
    // unique-mapping (cascade) tables.
    let deleted = 0;
    for (let i = 0; i < allDeleteIds.length; i += D1_IN_CHUNK) {
      const chunk = allDeleteIds.slice(i, i + D1_IN_CHUNK);
      const res = await db.delete(showroomStores).where(inArray(showroomStores.id, chunk)).run();
      deleted += Number((res as { meta?: { changes?: number } })?.meta?.changes ?? 0);
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
