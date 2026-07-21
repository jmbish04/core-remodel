/**
 * @fileoverview Delivery sales tax rate — resolution, math, and history.
 *
 * One rate matters: the one that applies to goods delivered to the property.
 * CA district tax on delivered goods is sourced to the delivery location, so a
 * showroom in another county shipping here should be collecting at OUR rate.
 * A quote states what it charged; this states what it should have charged.
 *
 * The rate is resolved from CDTFA's address lookup — free, unauthenticated, no
 * key — using the property address already configured for the permit pipeline.
 * Verified live 2026-07-19; robots.txt permits it and the CDTFA data portal
 * policy carries no scraping or rate-limit clause.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { projectSystemVariables, salesTaxRates, type SalesTaxRate } from "@backend/db";

type Db = ReturnType<typeof drizzle>;

/** CDTFA address lookup. All three of address/city/zip are required — ZIP alone is rejected. */
const CDTFA_URL = "https://services.maps.cdtfa.ca.gov/api/taxrate/GetRateByAddress";

/** Config keys shared with `/admin/config/address` and the permit pipeline. */
const ADDRESS_KEYS = ["permits_target_address", "permits_target_city", "permits_target_zip"] as const;

// ─── math ────────────────────────────────────────────────────────────────────

/**
 * Percent to parts per million. 8.625 => 86250.
 *
 * `Math.round` is required, not cosmetic: 10.075 * 10_000 is 100749.99999999999
 * in IEEE 754, and truncation would yield a rate one ppm light on every quote it
 * touches.
 */
export function percentToPpm(percent: number): number {
  return Math.round(percent * 10_000);
}

/** Parts per million to percent. 86250 => 8.625. Display only. */
export function ppmToPercent(ppm: number): number {
  return ppm / 10_000;
}

/** Tax on merchandise at a ppm rate. Integer in, integer out. */
export function computeTaxCents(merchandiseCents: number, ratePpm: number): number {
  return Math.round((merchandiseCents * ratePpm) / 1_000_000);
}

/**
 * Back out the rate a quote actually applied, for quotes stating a tax amount
 * but no rate. Returns null when merchandise is missing or zero — never a
 * fallback, because a wrong derived rate would make a quote look checkable when
 * it is not.
 */
export function deriveRatePpm(taxCents: number, merchandiseCents: number): number | null {
  if (!merchandiseCents || merchandiseCents <= 0) return null;
  return Math.round((taxCents / merchandiseCents) * 1_000_000);
}

// ─── address ─────────────────────────────────────────────────────────────────

export interface PropertyAddress {
  address: string;
  city: string;
  zip: string;
  /** Single-line form, stored on the rate row for provenance. */
  formatted: string;
}

/**
 * The property address from config. Returns null if any part is unset — CDTFA
 * rejects a partial address, so an incomplete one is not worth sending.
 */
export async function getPropertyAddress(db: Db): Promise<PropertyAddress | null> {
  const rows = await db
    .select()
    .from(projectSystemVariables)
    .where(inArray(projectSystemVariables.variableKey, [...ADDRESS_KEYS]))
    .all();

  const byKey = new Map(rows.map((r) => [r.variableKey, r.valueText?.trim() ?? ""]));
  const address = byKey.get("permits_target_address") ?? "";
  const city = byKey.get("permits_target_city") ?? "";
  const zip = byKey.get("permits_target_zip") ?? "";
  if (!address || !city || !zip) return null;

  return { address, city, zip, formatted: `${address}, ${city} CA ${zip}` };
}

// ─── CDTFA ───────────────────────────────────────────────────────────────────

export interface CdtfaRate {
  ratePpm: number;
  jurisdiction: string | null;
  county: string | null;
  tac: string | null;
}

/**
 * Look up the rate for an address.
 *
 * Throws on a non-200 or an unusable payload so the caller can leave the stored
 * rate untouched rather than overwriting a good value with a failed fetch.
 *
 * CDTFA returns MORE than one entry when the geocode lands near a jurisdiction
 * boundary. That is ambiguous, not a menu — picking the first would produce a
 * confidently wrong rate. We throw instead and let a human set it manually.
 */
export async function fetchRateFromCdtfa(addr: PropertyAddress): Promise<CdtfaRate> {
  const url = `${CDTFA_URL}?address=${encodeURIComponent(addr.address)}&city=${encodeURIComponent(addr.city)}&zip=${encodeURIComponent(addr.zip)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CDTFA lookup failed (${res.status})`);

  const body = (await res.json()) as {
    taxRateInfo?: { rate?: number; jurisdiction?: string; county?: string; tac?: string }[];
  };
  const hits = body.taxRateInfo ?? [];

  if (hits.length === 0) throw new Error(`CDTFA returned no rate for ${addr.formatted}`);
  if (hits.length > 1) {
    throw new Error(
      `CDTFA returned ${hits.length} candidate rates for ${addr.formatted} — the address sits ` +
        `near a jurisdiction boundary. Set the rate manually rather than guessing.`,
    );
  }

  const hit = hits[0];
  if (typeof hit.rate !== "number") throw new Error("CDTFA response had no numeric rate");

  return {
    // `rate` is a decimal fraction (0.08625). Math.round because 0.1075 * 1e6 is
    // 107500.00000000001 in IEEE 754.
    ratePpm: Math.round(hit.rate * 1_000_000),
    jurisdiction: hit.jurisdiction ?? null,
    county: hit.county ?? null,
    tac: hit.tac ?? null,
  };
}

// ─── history ─────────────────────────────────────────────────────────────────

/** The rate currently in effect, or null if none has been resolved yet. */
export async function getCurrentRate(db: Db): Promise<SalesTaxRate | null> {
  const [row] = await db
    .select()
    .from(salesTaxRates)
    .where(isNull(salesTaxRates.effectiveTo))
    .orderBy(desc(salesTaxRates.effectiveFrom))
    .limit(1);
  return row ?? null;
}

/** Every rate ever in effect, newest first. */
export async function listRateHistory(db: Db): Promise<SalesTaxRate[]> {
  return db.select().from(salesTaxRates).orderBy(desc(salesTaxRates.effectiveFrom)).all();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Record a new rate, closing whatever was in effect.
 *
 * The close and the insert are issued together via `db.batch()` — D1 runs a
 * batch as one all-or-nothing unit, so it cannot leave the property with no
 * active rate. (D1 has no interactive transactions; `db.transaction()` is a
 * no-op there, which is why this uses batch.)
 *
 * Never UPDATEs `ratePpm` on an existing row. Every rate change goes through
 * here, so a quote issued last quarter still reconciles against the rate that
 * was live when it was written.
 */
export async function recordRate(
  db: Db,
  next: {
    ratePpm: number;
    jurisdiction?: string | null;
    county?: string | null;
    tac?: string | null;
    source: "cdtfa_api" | "manual";
    resolvedAddress?: string | null;
    notes?: string | null;
  },
): Promise<SalesTaxRate> {
  const effectiveFrom = today();
  const current = await getCurrentRate(db);

  // Same rate from the same source — nothing changed, don't churn the history.
  if (current && current.ratePpm === next.ratePpm && current.source === next.source) {
    await db
      .update(salesTaxRates)
      .set({ updatedAt: new Date() })
      .where(eq(salesTaxRates.id, current.id));
    return current;
  }

  const statements: unknown[] = [];
  if (current) {
    statements.push(
      db
        .update(salesTaxRates)
        .set({ effectiveTo: effectiveFrom, updatedAt: new Date() })
        .where(and(eq(salesTaxRates.id, current.id), isNull(salesTaxRates.effectiveTo))),
    );
  }
  statements.push(
    db
      .insert(salesTaxRates)
      .values({ ...next, effectiveFrom, effectiveTo: null })
      .returning(),
  );

  const results = (await db.batch(statements as never)) as unknown[];
  const inserted = results[results.length - 1] as SalesTaxRate[];
  return inserted[0];
}

/**
 * The delivery rate, resolving it from CDTFA on first use.
 *
 * `force` re-checks even when a rate is already stored (the "Re-check" button).
 * A manual override is never silently replaced by a lookup — that would undo a
 * deliberate human decision — so a forced re-check on a manual rate is only
 * recorded if the caller passes `overrideManual`.
 */
export async function ensureDeliveryRate(
  db: Db,
  opts: { force?: boolean; overrideManual?: boolean } = {},
): Promise<{ rate: SalesTaxRate | null; address: PropertyAddress | null; error?: string }> {
  const current = await getCurrentRate(db);
  const address = await getPropertyAddress(db);

  if (current && !opts.force) return { rate: current, address };
  if (current?.source === "manual" && !opts.overrideManual) return { rate: current, address };

  if (!address) {
    return {
      rate: current,
      address: null,
      error:
        "Property address is incomplete. Set address, city and ZIP in Address & Permits before looking up a rate.",
    };
  }

  try {
    const found = await fetchRateFromCdtfa(address);
    const rate = await recordRate(db, {
      ...found,
      source: "cdtfa_api",
      resolvedAddress: address.formatted,
    });
    return { rate, address };
  } catch (err) {
    // Keep whatever is stored — a failed lookup must not erase a good rate.
    return { rate: current, address, error: (err as Error).message };
  }
}
