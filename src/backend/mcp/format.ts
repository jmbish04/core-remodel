/**
 * @fileoverview Shared formatting + validation helpers for MCP tools.
 *
 * Money is cents end-to-end (matches the `*Cents` D1 columns). List tools use
 * `paginate()` to return a consistent envelope. `toolError()` throws with an
 * actionable message that the transport surfaces as an `isError` result.
 */

/** Throw a tool error with an actionable message (never leak internals). */
export function toolError(message: string): never {
  throw new Error(message);
}

/** Format an integer cents value as a `$1,234.56` string for readability. */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "$0.00";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rem = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${rem}`;
}

/** Coerce an unknown to a finite number or return `undefined`. */
export function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce an unknown to a finite integer of cents, or `undefined`. */
export function cents(v: unknown): number | undefined {
  const n = num(v);
  return n == null ? undefined : Math.round(n);
}

/** Standard pagination envelope for list tools. */
export interface Page<T> {
  items: T[];
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
}

/**
 * Slice an already-fetched array into a pagination envelope. For D1 the full
 * result sets here are small (a single home's rooms/budget/materials), so
 * in-memory slicing is fine and keeps the query layer simple; switch to
 * SQL LIMIT/OFFSET if any table grows large.
 */
export function paginate<T>(all: T[], limit = 50, offset = 0): Page<T> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const safeOffset = Math.max(0, offset);
  const items = all.slice(safeOffset, safeOffset + safeLimit);
  const end = safeOffset + items.length;
  return {
    items,
    total: all.length,
    count: items.length,
    offset: safeOffset,
    has_more: end < all.length,
    next_offset: end < all.length ? end : null,
  };
}

/** Case-insensitive substring match helper for free-text filters. */
export function matchesQuery(haystack: (string | null | undefined)[], q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return haystack.some((h) => (h ?? "").toLowerCase().includes(needle));
}
