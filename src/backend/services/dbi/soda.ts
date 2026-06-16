/**
 * Shared low-level client + helpers for the SF DBI open-data (SODA) API at
 * `data.sfgov.org`. These primitives are dataset-agnostic and are consumed by
 * every permits sync module (target permits, contractor matching, activity
 * detection). Keeping them here keeps the per-phase modules small and focused.
 */

export type SodaRow = Record<string, unknown>;

/** A single column descriptor from a dataset's `/api/views/{id}.json` metadata. */
export type FieldMeta = {
  fieldName: string;
  displayName: string;
  /** Lowercased, alphanumeric-only `${fieldName} ${displayName}` for fuzzy matching. */
  normalized: string;
};

export type DatasetMetadata = {
  fields: FieldMeta[];
};

export const SODA_HOST = "https://data.sfgov.org";
export const SODA_PAGE_LIMIT = 1000;

/**
 * Row keys whose values churn on every SODA load (load timestamps, computed
 * region columns, Socrata system fields). Pruned before hashing so we don't
 * record a spurious revision every sync.
 */
export const VOLATILE_ROW_KEYS = new Set([
  "data_loaded_at",
  "data_as_of",
  ":updated_at",
  ":created_at",
  ":id",
  ":version",
  ":position",
  ":@computed_region_jwn9_ihcz",
  ":@computed_region_yftq_j783",
  ":@computed_region_h4ep_8xdi",
  ":@computed_region_26cr_cadq",
  ":@computed_region_ajp5_b2md",
  ":@computed_region_n4xg_c4py",
  ":@computed_region_rxqg_mtj9",
  ":@computed_region_qgnn_b9vv",
  ":@computed_region_k4du-7f2p",
  ":@computed_region_6qbp_sg9q",
  ":@computed_region_jx4q_fizf",
  ":@computed_region_bh8s_q3mv",
]);

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

/** Trim, lowercase, and collapse internal whitespace. */
export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Lowercase and strip every non-alphanumeric character (for field-name matching). */
export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Normalize a street address for `LIKE`/`includes` comparisons (expands st/ave/rd). */
export function normalizeAddress(value: string | null): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\bst\b/g, "street")
    .replace(/\bave\b/g, "avenue")
    .replace(/\brd\b/g, "road")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keep only digits (incl. leading zeros) from a block/lot value; null when none. */
export function normalizeBlockLot(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length > 0 ? digits : null;
}

/** Coerce a SODA cell to a trimmed non-empty string, or null. */
export function toNullableString(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** Parse a lat/long string to a fixed-6 string, or null when not finite. */
export function coerceLatLong(value: string | null): string | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed.toFixed(6);
}

/** Parse a date string to a Date, or null when invalid. */
export function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

// ---------------------------------------------------------------------------
// SoQL
// ---------------------------------------------------------------------------

/** Escape a string for safe inclusion inside a single-quoted SoQL literal. */
export function escapeSoqlLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// Object / hashing utils
// ---------------------------------------------------------------------------

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively sort object keys so JSON serialization is stable for hashing. */
export function stableSortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortObject(entry));
  }
  if (!isObject(value)) {
    return value;
  }
  const sortedEntries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableSortObject(entry)] as const);
  return Object.fromEntries(sortedEntries);
}

/** Drop {@link VOLATILE_ROW_KEYS} so change-hashes are stable across loads. */
export function pruneVolatileRow(row: SodaRow): SodaRow {
  const next: SodaRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (VOLATILE_ROW_KEYS.has(key.toLowerCase())) continue;
    next[key] = value;
  }
  return next;
}

/** Split an array into chunks of at most `size`. */
export function chunkArray<T>(values: T[], size: number): T[][] {
  if (size <= 0) return [values];
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/** Hex SHA-256 of a string (Web Crypto). */
export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((entry) => entry.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/**
 * Map a raw permit status string to a coarse category. Used to decide whether a
 * permit is open (active) or terminal (completed/cancelled).
 */
export function statusToCategory(status: string | null): string | null {
  if (!status) return null;
  const normalized = normalizeText(status);
  if (
    normalized.includes("closed") ||
    normalized.includes("complete") ||
    normalized.includes("completed") ||
    normalized.includes("final")
  ) {
    return "completed";
  }
  if (
    normalized.includes("issued") ||
    normalized.includes("approved") ||
    normalized.includes("active") ||
    normalized.includes("in progress") ||
    normalized.includes("inspection")
  ) {
    return "in_progress";
  }
  if (
    normalized.includes("pending") ||
    normalized.includes("submitted") ||
    normalized.includes("review") ||
    normalized.includes("filed")
  ) {
    return "pending";
  }
  if (
    normalized.includes("cancel") ||
    normalized.includes("void") ||
    normalized.includes("deny") ||
    normalized.includes("withdraw") ||
    normalized.includes("expire") ||
    normalized.includes("revoke")
  ) {
    return "cancelled";
  }
  return "other";
}

/**
 * A permit is "closed" (terminal) when it has a closed/completed date or its
 * status category is completed/cancelled. Everything else — including `issued`
 * and `filed` — is treated as open/active.
 */
export function isClosedStatus(
  statusCategory: string | null,
  closedDate: string | null,
): boolean {
  if (closedDate) return true;
  return statusCategory === "completed" || statusCategory === "cancelled";
}

// ---------------------------------------------------------------------------
// Field resolution
// ---------------------------------------------------------------------------

/** Find the first dataset field whose normalized name contains any pattern. */
export function findFieldName(
  fields: FieldMeta[],
  patterns: string[],
): string | null {
  const normalizedPatterns = patterns.map((pattern) => normalizeKey(pattern));
  for (const field of fields) {
    if (normalizedPatterns.some((pattern) => field.normalized.includes(pattern))) {
      return field.fieldName;
    }
  }
  return null;
}

/**
 * Extract a value from a row by trying the metadata-resolved field first, then
 * falling back to any row key whose normalized name contains a pattern.
 */
export function extractFieldValue(
  row: SodaRow,
  fields: FieldMeta[],
  patterns: string[],
): string | null {
  const fieldName = findFieldName(fields, patterns);
  if (fieldName && row[fieldName] !== undefined) {
    return toNullableString(row[fieldName]);
  }
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeKey(key);
    if (patterns.some((pattern) => normalized.includes(normalizeKey(pattern)))) {
      const resolved = toNullableString(value);
      if (resolved) return resolved;
    }
  }
  return null;
}

/** Parse the `columns` array from dataset metadata into {@link FieldMeta}. */
export function toFieldMeta(value: unknown): FieldMeta[] {
  if (!Array.isArray(value)) return [];
  const rows: FieldMeta[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const fieldName = toNullableString(entry.fieldName);
    if (!fieldName) continue;
    const displayName = toNullableString(entry.name) || fieldName;
    rows.push({
      fieldName,
      displayName,
      normalized: normalizeKey(`${fieldName} ${displayName}`),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const metadataCache = new Map<string, DatasetMetadata | null>();

/** Fetch + cache a dataset's column metadata (null on failure). */
export async function fetchDatasetMetadata(
  datasetId: string,
): Promise<DatasetMetadata | null> {
  if (metadataCache.has(datasetId)) {
    return metadataCache.get(datasetId) || null;
  }
  try {
    const response = await fetch(`${SODA_HOST}/api/views/${datasetId}.json`);
    if (!response.ok) {
      metadataCache.set(datasetId, null);
      return null;
    }
    const payload = (await response.json()) as { columns?: unknown };
    const metadata: DatasetMetadata = { fields: toFieldMeta(payload.columns) };
    metadataCache.set(datasetId, metadata);
    return metadata;
  } catch {
    metadataCache.set(datasetId, null);
    return null;
  }
}

/**
 * Page through a SODA dataset resource, deduping identical rows, up to `maxRows`.
 * `params` are SoQL params (`$where`, `$q`, `$order`, `$select`, …); empty values
 * are skipped. Throws on a non-OK HTTP response.
 */
export async function fetchSodaRows(
  datasetId: string,
  params: Record<string, string>,
  maxRows = 3000,
): Promise<SodaRow[]> {
  const rows: SodaRow[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (offset < maxRows) {
    const url = new URL(`${SODA_HOST}/resource/${datasetId}.json`);
    for (const [key, value] of Object.entries(params)) {
      if (!value) continue;
      url.searchParams.set(key, value);
    }
    url.searchParams.set("$limit", String(Math.min(SODA_PAGE_LIMIT, maxRows - offset)));
    url.searchParams.set("$offset", String(offset));

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`SODA ${datasetId} request failed: ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload) || payload.length === 0) break;

    for (const entry of payload) {
      if (!isObject(entry)) continue;
      const stringified = JSON.stringify(entry);
      if (seen.has(stringified)) continue;
      seen.add(stringified);
      rows.push(entry);
    }

    if (payload.length < SODA_PAGE_LIMIT) break;
    offset += payload.length;
  }

  return rows;
}
