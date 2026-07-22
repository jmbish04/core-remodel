/**
 * @fileoverview Brand data-quality health checks.
 *
 * Three registered checks, split because they fail independently and each has a
 * different fix. Rolling them into one row would hide which is actually wrong.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";

import { brands } from "@backend/db/schema/brands/brands";
import { brandNameVariations } from "@backend/db/schema/brands/brand_name_variations";
import { brandCategories } from "@backend/db/schema/config/brand_categories";
import { brandImages } from "@backend/db/schema/brands/brand_images";
import { brandIntel } from "@backend/db/schema/brands/brand_intel";
import { brandProductLines } from "@backend/db/schema/brands/brand_product_lines";
import { brandTypeMappings } from "@backend/db/schema/brands/brand_type_mappings";
import { showroomBrandMappings } from "@backend/db/schema/brands/showroom_brand_mappings";
import { showroomStoreProducts } from "@backend/db/schema/showroom/store_products";
import {
  registerHealthCheck,
  scoreFromDefects,
  statusFromScore,
  type HealthResult,
} from "../registry";

/** Every table carrying a brand_id FK. Adding one here extends the orphan scan. */
const BRAND_FK_TABLES = [
  ["showroom_store_products", showroomStoreProducts],
  ["brand_categories", brandCategories],
  ["brand_images", brandImages],
  ["brand_intel", brandIntel],
  ["brand_product_lines", brandProductLines],
  ["brand_type_mappings", brandTypeMappings],
  ["showroom_brand_mappings", showroomBrandMappings],
  ["brand_name_variations", brandNameVariations],
] as const;

const nameKey = (n: string | null) =>
  String(n ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\b(inc|llc|ltd|corp|company|usa|group|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * 1. Live duplicate brands.
 *
 * Two ACTIVE rows for one company split its showroom mappings, so the directory
 * shows the brand twice with half its data each. Name matches only — a shared
 * website is not a duplicate (Silestone and Dekton are both cosentino.com).
 */
export const brandDuplicatesCheck = registerHealthCheck({
  slug: "brand-duplicates",
  name: "Brand duplicates",
  vertical: "brands",
  description:
    "Active brands that are the same company spelled differently, splitting their showroom and product mappings across rows.",
  async run(env: Env): Promise<HealthResult> {
    const db = drizzle(env.DB);
    const rows = await db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(eq(brands.isActive, true));

    const buckets = new Map<string, number[]>();
    for (const r of rows) {
      const k = nameKey(r.name);
      if (k) buckets.set(k, [...(buckets.get(k) ?? []), r.id]);
    }
    const dupes = [...buckets.entries()].filter(([, ids]) => ids.length > 1);

    const score = scoreFromDefects(dupes.length, 12);
    return {
      status: statusFromScore(score),
      score,
      summary: dupes.length
        ? `${dupes.length} brand name(s) held by more than one active row`
        : `No duplicate brands across ${rows.length} active brands`,
      stats: [
        { label: "Active brands", value: rows.length },
        { label: "Duplicate groups", value: dupes.length, problem: dupes.length > 0 },
      ],
      actionUrl: dupes.length ? "/admin/shopping/brands" : undefined,
      actionLabel: dupes.length ? "Review brands" : undefined,
    };
  },
});

/**
 * 2. Orphaned mappings on retired brands.
 *
 * A merge repoints every FK row to the survivor BEFORE flagging is_active=0.
 * Leftovers mean an interrupted merge — invisible otherwise, because the rows
 * still resolve; they just point at a brand nobody lists.
 */
export const brandOrphanCheck = registerHealthCheck({
  slug: "brand-orphaned-mappings",
  name: "Retired brand mappings",
  vertical: "brands",
  description:
    "Rows still pointing at a retired (soft-deleted) brand. A completed merge leaves none.",
  async run(env: Env): Promise<HealthResult> {
    const db = drizzle(env.DB);
    const retired = await db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.isActive, false));

    if (retired.length === 0) {
      return {
        status: "healthy",
        score: 100,
        summary: "No retired brands",
        stats: [{ label: "Retired brands", value: 0 }],
      };
    }

    const retiredIds = retired.map((r) => r.id);
    const perTable: Record<string, number> = {};
    let total = 0;

    for (const [label, table] of BRAND_FK_TABLES) {
      const [row] = await db
        .select({ n: sql<number>`count(*)` })
        .from(table)
        .where(sql`brand_id IN ${retiredIds}`);
      if (row?.n) {
        perTable[label] = row.n;
        total += row.n;
      }
    }

    const score = scoreFromDefects(total, 10);
    return {
      status: statusFromScore(score),
      score,
      summary: total
        ? `${total} row(s) still point at a retired brand`
        : `${retired.length} retired brand(s), all fully unmapped`,
      stats: [
        { label: "Retired brands", value: retired.length },
        { label: "Orphaned rows", value: total, problem: total > 0 },
        ...Object.entries(perTable).map(([label, value]) => ({
          label,
          value,
          problem: true,
        })),
      ],
    };
  },
});

/**
 * 3. Name coverage.
 *
 * Every brand needs exactly one is_primary variation. Zero means it renders
 * nameless once readers move off `brands.name`; more than one is impossible
 * (partial unique index) but checked anyway — an invariant worth verifying is
 * worth verifying from the outside.
 */
export const brandNameCoverageCheck = registerHealthCheck({
  slug: "brand-name-coverage",
  name: "Brand name coverage",
  vertical: "brands",
  description:
    "Every active brand must have exactly one primary name variation, and brands.name must match it.",
  async run(env: Env): Promise<HealthResult> {
    const db = drizzle(env.DB);
    const rows = await db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(eq(brands.isActive, true));

    const variations = await db
      .select({
        brandId: brandNameVariations.brandId,
        brandName: brandNameVariations.brandName,
        isPrimary: brandNameVariations.isPrimary,
      })
      .from(brandNameVariations)
      .where(eq(brandNameVariations.isActive, true));

    const primaries = new Map<number, string[]>();
    let aliasCount = 0;
    for (const v of variations) {
      if (v.isPrimary) {
        primaries.set(v.brandId, [...(primaries.get(v.brandId) ?? []), v.brandName]);
      } else {
        aliasCount += 1;
      }
    }

    const missing = rows.filter((r) => !(primaries.get(r.id) ?? []).length);
    const multiple = rows.filter((r) => (primaries.get(r.id) ?? []).length > 1);
    const mismatched = rows.filter((r) => {
      const p = primaries.get(r.id) ?? [];
      return p.length === 1 && p[0] !== r.name;
    });

    const defects = missing.length + multiple.length + mismatched.length;
    const score = scoreFromDefects(defects, 10);
    return {
      status: statusFromScore(score),
      score,
      summary: defects
        ? `${defects} brand(s) with a name problem`
        : `All ${rows.length} active brands named, ${aliasCount} alias(es) recorded`,
      stats: [
        { label: "Active brands", value: rows.length },
        { label: "Aliases recorded", value: aliasCount },
        { label: "Missing primary name", value: missing.length, problem: missing.length > 0 },
        { label: "Multiple primaries", value: multiple.length, problem: multiple.length > 0 },
        {
          label: "brands.name out of sync",
          value: mismatched.length,
          problem: mismatched.length > 0,
        },
      ],
    };
  },
});
