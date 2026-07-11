/**
 * Normalize a model number into a stable dedup key: uppercase, then strip every
 * character that isn't A–Z or 0–9. "MS 604-01" -> "MS60401". Returns null for
 * null/undefined/empty so no-model# products never collide on a unique index
 * (SQLite treats NULLs as distinct).
 */
export function normalizeModelKey(
  input: string | null | undefined
): string | null {
  if (input == null) return null;
  const key = String(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return key.length > 0 ? key : null;
}
