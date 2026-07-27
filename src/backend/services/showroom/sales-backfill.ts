/**
 * @fileoverview One-shot backfill: explode the legacy
 * `showroom_store_sales.clearanceDetailsJson.items[]` JSON blobs into real
 * `sale_items` rows (0038 Phase A).
 *
 * Scope: only `isCurrent` snapshots — "what's on sale now". Historical snapshots
 * keep their JSON; we do not need exploded pre-0038 history. Idempotent: a
 * snapshot that already has `sale_items` rows is skipped, so re-running is safe.
 *
 * Old `ClearanceItem` has no images and no colors, so this creates neither —
 * those arrive with the Phase B scrape upgrade. Prices in the old blob are plain
 * USD numbers; we derive cents directly and keep a `$`-prefixed display text.
 */
import { drizzle } from "drizzle-orm/d1";
import { eq, inArray } from "drizzle-orm";

import {
  showroomStoreSales,
  saleItems,
  type ClearanceItem,
  type SaleItemInsert,
  type SaleItemCondition,
} from "@backend/db/schema/showroom/index";

/** Batch of single-row inserts — sale_items is wide, so never multi-row (100-param cap). */
const BATCH_STATEMENTS = 50;

function usdToCents(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function usdToText(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `$${n.toLocaleString("en-US")}`;
}

/** Best-effort condition read from the old free-text deal label / notes. */
function inferCondition(item: ClearanceItem): SaleItemCondition {
  const hay = `${item.dealLabel ?? ""} ${item.notes ?? ""}`.toLowerCase();
  if (/floor\s*model|floor\s*sample/.test(hay)) return "floor_model";
  if (/open\s*box/.test(hay)) return "open_box";
  if (/open\s*package/.test(hay)) return "open_package";
  if (/\breturn(ed|s)?\b/.test(hay)) return "return";
  if (/damag|scratch|dent|chip|crack/.test(hay)) return "damaged";
  return "new";
}

/** Diff anchor for a legacy item: url, else normalized brand+title. */
function deriveMatchKey(item: ClearanceItem): string | null {
  if (item.url) return item.url;
  const parts = [item.brand, item.title].filter(Boolean).join(" ").trim();
  if (!parts) return null;
  return parts.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface SalesBackfillResult {
  snapshotsSeen: number;
  snapshotsBackfilled: number;
  snapshotsSkipped: number;
  itemsInserted: number;
  itemsExpected: number;
}

export async function backfillSaleItems(
  env: Env,
): Promise<SalesBackfillResult> {
  const db = drizzle(env.DB);

  const snapshots = await db
    .select()
    .from(showroomStoreSales)
    .where(eq(showroomStoreSales.isCurrent, true))
    .all();

  // Which snapshots already have sale_items — skip them (idempotency).
  const already = new Set<number>();
  const ids = snapshots.map((s) => s.id);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    if (chunk.length === 0) continue;
    const rows = await db
      .select({ id: saleItems.saleSnapshotId })
      .from(saleItems)
      .where(inArray(saleItems.saleSnapshotId, chunk))
      .all();
    for (const r of rows) already.add(r.id);
  }

  const result: SalesBackfillResult = {
    snapshotsSeen: snapshots.length,
    snapshotsBackfilled: 0,
    snapshotsSkipped: 0,
    itemsInserted: 0,
    itemsExpected: 0,
  };

  const pending: SaleItemInsert[] = [];

  for (const snap of snapshots) {
    if (already.has(snap.id)) {
      result.snapshotsSkipped += 1;
      continue;
    }
    const details = snap.clearanceDetailsJson;
    const items = Array.isArray(details?.items) ? details.items : [];
    result.itemsExpected += items.length;
    if (items.length === 0) continue;

    for (const item of items) {
      pending.push({
        saleSnapshotId: snap.id,
        storeId: snap.storeId,
        cycleId: null,
        title: item.title,
        brandText: item.brand ?? null,
        categoryText: item.category ?? null,
        originalPrice: usdToText(item.originalPrice),
        originalPriceCents: usdToCents(item.originalPrice),
        salePrice: usdToText(item.salePrice),
        salePriceCents: usdToCents(item.salePrice),
        discountPct: item.discountPercent ?? null,
        dealTerms: item.dealLabel ?? null,
        condition: inferCondition(item),
        damageNotesMarkdown: item.notes ?? null,
        sourceUrl: item.url ?? null,
        matchKey: deriveMatchKey(item),
        isCurrent: snap.isCurrent,
        changeStatus: "new",
      });
    }
    result.snapshotsBackfilled += 1;
  }

  // Single-row inserts, batched. sale_items is wide (~40 cols) so a multi-row
  // insert would exceed D1's 100 bound-param cap; one row per statement stays
  // well under it, and db.batch runs each chunk atomically.
  for (let i = 0; i < pending.length; i += BATCH_STATEMENTS) {
    const chunk = pending.slice(i, i + BATCH_STATEMENTS);
    const stmts = chunk.map((row) => db.insert(saleItems).values(row));
    if (stmts.length === 0) continue;
    await db.batch(
      stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]],
    );
    result.itemsInserted += stmts.length;
  }

  return result;
}
