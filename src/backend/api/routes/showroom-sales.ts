/**
 * @fileoverview Showroom Sales / Clearance API — powers /admin/shopping/sales.
 *
 * Mounts at /api/showroom-sales.
 *
 *   GET  /            — current clearance snapshots, filtered + searched
 *   GET  /facets      — filter vocabulary, built DYNAMICALLY from live data
 *   POST /sweep       — run the sale sweep on demand (the weekly cron's job)
 *
 * Only `isCurrent` snapshots are served: the table keeps a history of every
 * change, but "what's on sale" means the newest snapshot per page.
 *
 * Search has two modes, because they answer different questions:
 *   - keyword (default) — substring match, for "show me the Kohler stuff"
 *   - rag (`mode=rag`)  — Vectorize similarity over the snapshot embeddings,
 *     for "marble remnants" matching a listing that never says "remnant"
 * RAG falls back to keyword when the query embeds to nothing or the index is
 * empty, so the page always returns something usable.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";

import {
  showroomStoreSales,
  showroomStores,
  type ClearanceDetails,
  type ClearanceItem,
} from "@backend/db/schema/showroom/index";
import { sweepShowroomSales } from "@backend/services/showroom/sales";

export const showroomSalesRouter = new Hono<{ Bindings: Env }>();

/** Workers-AI embedding model — must match the one the sweep indexes with. */
const EMBED_MODEL = "@cf/baai/bge-large-en-v1.5" as const;

/** Vectorize namespace the sweep writes sale snapshots under. */
const SALES_NAMESPACE = "showroom:sales";

/** How many vector hits to pull before mapping back to rows. */
const RAG_TOP_K = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One clearance item flattened with its owning store/snapshot, for the grid. */
interface SaleListItem extends ClearanceItem {
  saleId: number;
  storeId: number;
  storeName: string;
  storeCity: string | null;
  storeIconCfImagesUrl: string | null;
  sourceUrl: string;
  saleHeadline: string | null;
  saleEndsText: string | null;
  capturedAt: string | null;
  /** Vectorize similarity when the query ran in RAG mode; null otherwise. */
  score: number | null;
}

interface SaleRow {
  id: number;
  storeId: number;
  sourceUrl: string;
  ragUuid: string | null;
  timestamp: Date | null;
  clearanceDetailsJson: ClearanceDetails;
  storeName: string;
  storeCity: string | null;
  storeIconCfImagesUrl: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every current snapshot, joined to its store. */
async function loadCurrentSales(db: ReturnType<typeof drizzle>): Promise<SaleRow[]> {
  const rows = await db
    .select({
      id: showroomStoreSales.id,
      storeId: showroomStoreSales.storeId,
      sourceUrl: showroomStoreSales.sourceUrl,
      ragUuid: showroomStoreSales.ragUuid,
      timestamp: showroomStoreSales.timestamp,
      clearanceDetailsJson: showroomStoreSales.clearanceDetailsJson,
      storeName: showroomStores.name,
      storeCity: showroomStores.locationCity,
      storeIconCfImagesUrl: showroomStores.iconCfImagesUrl,
    })
    .from(showroomStoreSales)
    .innerJoin(showroomStores, eq(showroomStoreSales.storeId, showroomStores.id))
    .where(
      and(
        eq(showroomStoreSales.isCurrent, true),
        eq(showroomStores.isActive, true),
      ),
    )
    .orderBy(desc(showroomStoreSales.timestamp));

  return rows as SaleRow[];
}

/** Flatten snapshots into one entry per discounted item. */
function flattenItems(rows: SaleRow[], scoreByRagUuid?: Map<string, number>): SaleListItem[] {
  const out: SaleListItem[] = [];
  for (const row of rows) {
    const details = row.clearanceDetailsJson;
    for (const item of details?.items ?? []) {
      out.push({
        ...item,
        saleId: row.id,
        storeId: row.storeId,
        storeName: row.storeName,
        storeCity: row.storeCity,
        storeIconCfImagesUrl: row.storeIconCfImagesUrl,
        sourceUrl: row.sourceUrl,
        saleHeadline: details.saleHeadline ?? null,
        saleEndsText: details.saleEndsText ?? null,
        capturedAt: row.timestamp ? new Date(row.timestamp).toISOString() : null,
        score: row.ragUuid ? scoreByRagUuid?.get(row.ragUuid) ?? null : null,
      });
    }
  }
  return out;
}

/** Case-insensitive substring match across the fields a homeowner would type. */
function matchesKeyword(item: SaleListItem, q: string): boolean {
  const haystack = [
    item.title,
    item.brand,
    item.category,
    item.dealLabel,
    item.notes,
    item.storeName,
    item.saleHeadline,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/** Parse a repeatable query param: ?brand=A&brand=B. */
function multi(c: Context<{ Bindings: Env }>, key: string): string[] {
  const all = c.req.queries(key) ?? [];
  return all.map((v) => v.trim()).filter(Boolean);
}

/**
 * A numeric query param, or null when absent/blank/unparseable.
 *
 * Returning null (rather than NaN or 0) is what lets a caller distinguish
 * "no filter" from "filter at 0" — see the note at the call site.
 */
function numericQuery(c: Context<{ Bindings: Env }>, key: string): number | null {
  const raw = c.req.query(key);
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// GET / — filtered + searched clearance items
// ---------------------------------------------------------------------------

showroomSalesRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);

  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const mode = c.req.query("mode") === "rag" ? "rag" : "keyword";
  const brands = multi(c, "brand").map((v) => v.toLowerCase());
  const categories = multi(c, "category").map((v) => v.toLowerCase());
  const dealLabels = multi(c, "dealLabel").map((v) => v.toLowerCase());
  const storeIds = multi(c, "storeId").map(Number).filter(Number.isInteger);
  const cities = multi(c, "city").map((v) => v.toLowerCase());
  // Parse ONLY when the caller actually sent the param. `Number(undefined ?? "")`
  // is 0 — not NaN — so a naive Number.isFinite() guard treats an ABSENT filter
  // as "0", and the two filters below then silently drop every item with a price
  // (`salePrice <= 0`) or without a stated percent. Absent must mean absent.
  const minDiscount = numericQuery(c, "minDiscount");
  const maxPrice = numericQuery(c, "maxPrice");

  const rows = await loadCurrentSales(db);

  // ── RAG ─────────────────────────────────────────────────────────────────
  // Resolve the query to a set of ragUuids + scores first, then filter the
  // flattened items to those snapshots. Falls back to keyword on any failure —
  // an empty index must not mean an empty page.
  let scoreByRagUuid: Map<string, number> | undefined;
  let ragApplied = false;
  if (mode === "rag" && q) {
    try {
      scoreByRagUuid = await ragSearch(c.env, q);
      ragApplied = scoreByRagUuid.size > 0;
    } catch (err) {
      console.error("[showroom-sales] rag search failed, falling back to keyword:", err);
    }
  }

  const scoped =
    ragApplied && scoreByRagUuid
      ? rows.filter((r) => r.ragUuid && scoreByRagUuid.has(r.ragUuid))
      : rows;

  let items = flattenItems(scoped, scoreByRagUuid);

  // Keyword still applies in rag mode only when RAG produced nothing.
  if (q && !ragApplied) items = items.filter((i) => matchesKeyword(i, q));

  if (brands.length) items = items.filter((i) => i.brand && brands.includes(i.brand.toLowerCase()));
  if (categories.length) {
    items = items.filter((i) => i.category && categories.includes(i.category.toLowerCase()));
  }
  if (dealLabels.length) {
    items = items.filter((i) => i.dealLabel && dealLabels.includes(i.dealLabel.toLowerCase()));
  }
  if (storeIds.length) items = items.filter((i) => storeIds.includes(i.storeId));
  if (cities.length) {
    items = items.filter((i) => i.storeCity && cities.includes(i.storeCity.toLowerCase()));
  }
  if (minDiscount != null) {
    items = items.filter((i) => (i.discountPercent ?? -1) >= minDiscount);
  }
  if (maxPrice != null) {
    // An item with no stated price can't satisfy a price ceiling.
    items = items.filter((i) => i.salePrice != null && i.salePrice <= maxPrice);
  }

  // RAG hits sort by similarity; everything else by freshness then discount.
  items.sort((a, b) => {
    if (ragApplied) return (b.score ?? 0) - (a.score ?? 0);
    const t = (b.capturedAt ?? "").localeCompare(a.capturedAt ?? "");
    if (t !== 0) return t;
    return (b.discountPercent ?? 0) - (a.discountPercent ?? 0);
  });

  return c.json({
    items,
    total: items.length,
    mode: ragApplied ? "rag" : "keyword",
    snapshotCount: scoped.length,
  });
});

/** Embed the query and return ragUuid → score for the sale namespace. */
async function ragSearch(env: Env, query: string): Promise<Map<string, number>> {
  const embedding = (await env.AI.run(
    EMBED_MODEL,
    { text: [query] },
    { gateway: { id: env.AI_GATEWAY_ID } },
  )) as { data: number[][] };

  const values = embedding.data?.[0];
  const scores = new Map<string, number>();
  if (!values) return scores;

  const result = await env.RESEARCH_INDEX.query(values, {
    topK: RAG_TOP_K,
    namespace: SALES_NAMESPACE,
    returnMetadata: "indexed",
  });

  for (const match of result.matches ?? []) {
    const ragUuid = (match.metadata?.ragUuid as string | undefined) ?? null;
    if (ragUuid) scores.set(ragUuid, match.score ?? 0);
  }
  return scores;
}

// ---------------------------------------------------------------------------
// GET /facets — filter vocabulary built from live data
// ---------------------------------------------------------------------------

/**
 * The filter sidebar is built from whatever the extractor actually found — a
 * hardcoded category list would go stale the moment a showroom invents a new
 * one ("Floor models", "Scratch & dent"). Counts drive the "(128)" labels.
 */
showroomSalesRouter.get("/facets", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await loadCurrentSales(db);
  const items = flattenItems(rows);

  /** Count distinct values, preserving the first-seen casing for display. */
  const tally = (pick: (i: SaleListItem) => string | null | undefined) => {
    const counts = new Map<string, { value: string; count: number }>();
    for (const item of items) {
      const raw = pick(item)?.trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      const hit = counts.get(key);
      if (hit) hit.count++;
      else counts.set(key, { value: raw, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };

  const prices = items.map((i) => i.salePrice).filter((p): p is number => p != null);
  const discounts = items.map((i) => i.discountPercent).filter((d): d is number => d != null);

  const stores = new Map<number, { id: number; name: string; count: number }>();
  for (const item of items) {
    const hit = stores.get(item.storeId);
    if (hit) hit.count++;
    else stores.set(item.storeId, { id: item.storeId, name: item.storeName, count: 1 });
  }

  return c.json({
    brands: tally((i) => i.brand),
    categories: tally((i) => i.category),
    dealLabels: tally((i) => i.dealLabel),
    cities: tally((i) => i.storeCity),
    stores: [...stores.values()].sort((a, b) => b.count - a.count),
    priceRange: prices.length
      ? { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) }
      : null,
    discountRange: discounts.length
      ? { min: Math.floor(Math.min(...discounts)), max: Math.ceil(Math.max(...discounts)) }
      : null,
    totalItems: items.length,
    storeCount: stores.size,
  });
});

// ---------------------------------------------------------------------------
// GET /store/:id — current clearance for ONE store (the viewport alert)
// ---------------------------------------------------------------------------

showroomSalesRouter.get("/store/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) {
    return c.json({ error: "Invalid store id" }, 400);
  }

  const rows = await db
    .select({
      id: showroomStoreSales.id,
      sourceUrl: showroomStoreSales.sourceUrl,
      timestamp: showroomStoreSales.timestamp,
      clearanceDetailsJson: showroomStoreSales.clearanceDetailsJson,
    })
    .from(showroomStoreSales)
    .where(
      and(
        eq(showroomStoreSales.storeId, storeId),
        eq(showroomStoreSales.isCurrent, true),
      ),
    )
    .orderBy(desc(showroomStoreSales.timestamp));

  // Only surface snapshots that actually found something — a page that changed
  // but lists nothing is recorded (so the alert can clear) but is not an alert.
  const active = rows.filter((r) => (r.clearanceDetailsJson?.items?.length ?? 0) > 0);

  return c.json({
    sales: active.map((r) => ({
      id: r.id,
      sourceUrl: r.sourceUrl,
      capturedAt: r.timestamp ? new Date(r.timestamp).toISOString() : null,
      details: r.clearanceDetailsJson,
    })),
    itemCount: active.reduce((n, r) => n + (r.clearanceDetailsJson?.items?.length ?? 0), 0),
  });
});

// ---------------------------------------------------------------------------
// POST /sweep — run the sweep on demand
// ---------------------------------------------------------------------------

/**
 * Manual trigger for the weekly sweep — used to verify the pipeline without
 * waiting for Monday, and to catch up after a failed cron. Bounded by `limit`
 * for the same reason the cron is.
 */
showroomSalesRouter.post("/sweep", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const limit = Number((body as { limit?: unknown }).limit ?? 20);
  const summary = await sweepShowroomSales(c.env, {
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
  });
  return c.json({ ok: true, ...summary });
});
