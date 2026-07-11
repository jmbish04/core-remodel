/**
 * Parse a free-text price ("$1,299.00", "1,299", "1299") to INTEGER CENTS, or
 * null when there is no parseable number ("call for pricing"). Keeps only digits
 * and the decimal point, then ×100 rounded. Best-effort and HITL-correctable.
 */
export function parsePriceCents(
  input: string | null | undefined
): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const dollars = Number.parseFloat(cleaned);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/**
 * Parse a free-text discount ("15%", "15", "15% off") to a percent as a real
 * number, or null when no number is present. Best-effort; a dollars-off markdown
 * won't yield a meaningful percent — leave the text and null the numeric.
 */
export function parseDiscountPct(
  input: string | null | undefined
): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const pct = Number.parseFloat(cleaned);
  return Number.isFinite(pct) ? pct : null;
}
