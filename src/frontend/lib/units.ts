/**
 * @fileoverview Unit system + conversions for the measurements surface (0006).
 *
 * Measurements are stored CANONICALLY in US/imperial terms (feet + inches; areas in
 * square feet) — see `src/backend/db/schema/home/measurements.ts`.  This module is
 * the single place that converts those canonical values to/from metric for DISPLAY
 * and DATA ENTRY, so contractors / suppliers who work natively in metric can both
 * read and type values in their own units while the database stays consistent.
 *
 * Conversions use exact factors (1 in = 0.0254 m, 1 sq ft = 0.09290304 m²), so a
 * value entered in metric and converted to canonical inches round-trips back with
 * negligible (sub-millimetre) error because the `inches` column is `real`.
 *
 * Pure module — no React.  The active unit preference lives in `use-unit-system.ts`.
 */

/** The two unit systems the UI can render / accept input in. */
export type UnitSystem = "imperial" | "metric";

const M_PER_INCH = 0.0254;
const INCHES_PER_FOOT = 12;
const SQM_PER_SQFT = 0.09290304;

/** Human labels for each unit system (used in toggles + suffixes). */
export const UNIT_LABEL: Record<UnitSystem, { label: string; length: string; area: string }> = {
  imperial: { label: "US", length: "ft / in", area: "sq ft" },
  metric: { label: "Metric", length: "m", area: "m²" },
};

// ---------------------------------------------------------------------------
// Numeric conversions
// ---------------------------------------------------------------------------

/** Combine a feet + inches pair into a single total-inches value. */
export function feetInchesToTotalInches(feet: number | null, inches: number | null): number {
  return (feet ?? 0) * INCHES_PER_FOOT + (inches ?? 0);
}

/** Convert a canonical feet + inches length to metres. */
export function feetInchesToMeters(feet: number | null, inches: number | null): number {
  return feetInchesToTotalInches(feet, inches) * M_PER_INCH;
}

/**
 * Convert metres to a canonical { feet (whole), inches (real) } pair for storage.
 * Inches keep their fractional part so the value round-trips cleanly.
 */
export function metersToFeetInches(meters: number): { feet: number; inches: number } {
  const totalInches = meters / M_PER_INCH;
  const feet = Math.floor(totalInches / INCHES_PER_FOOT);
  const inches = totalInches - feet * INCHES_PER_FOOT;
  return { feet, inches };
}

/** Square feet → square metres. */
export function sqftToSqm(sqft: number): number {
  return sqft * SQM_PER_SQFT;
}

/** Square metres → square feet. */
export function sqmToSqft(sqm: number): number {
  return sqm / SQM_PER_SQFT;
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/** Format a number with up to `maxDecimals` places, trimming trailing zeros. */
export function trimDecimals(value: number, maxDecimals: number): string {
  const fixed = value.toFixed(maxDecimals);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

/**
 * Format a canonical feet + inches length for display in the active unit.
 * Returns null when both feet and inches are absent.
 *   imperial → `11'6"` (inches rounded to 1 dp, trimmed)
 *   metric   → `3.66 m`
 */
export function formatLength(
  feet: number | null,
  inches: number | null,
  system: UnitSystem,
): string | null {
  if (feet == null && inches == null) return null;
  if (system === "metric") {
    return `${feetInchesToMeters(feet, inches).toFixed(2)} m`;
  }
  return `${feet ?? 0}'${trimDecimals(inches ?? 0, 1)}"`;
}

/**
 * Format a canonical square-footage area for display in the active unit.
 * Returns null when sqft is null.
 *   imperial → `77.28 sq ft`
 *   metric   → `7.18 m²`
 */
export function formatAreaFromSqFt(sqft: number | null, system: UnitSystem): string | null {
  if (sqft == null) return null;
  if (system === "metric") {
    return `${sqftToSqm(sqft).toFixed(2)} m²`;
  }
  return `${trimDecimals(sqft, 2)} sq ft`;
}
