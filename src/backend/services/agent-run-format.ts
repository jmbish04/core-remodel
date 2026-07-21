/**
 * @fileoverview Pure formatting/redaction helpers for the agent run ledger.
 *
 * Split out from `agent-runs.ts` (which imports drizzle and the D1 schema) so
 * these can be unit-tested with plain `node` and no bindings. The redaction
 * here is a security boundary, not a nicety — tool arguments routinely carry
 * API keys and the ledger is readable from an admin page — so it needs a test
 * that can actually run.
 */

/** Cap on any single JSON blob written to the ledger. */
export const MAX_JSON_CHARS = 4_000;

/**
 * Keys whose values are redacted before they can reach D1.
 *
 * `_api$` is here because a unit test caught the original pattern letting
 * `GOOGLE_MAPS_API` through — it matched neither `key` nor `apikey`, and that
 * is the exact env var name this codebase uses for a live billable secret.
 */
const SECRET_KEY_PATTERN =
  /(key|token|secret|password|passwd|credential|authorization|cookie|bearer|_api$)/i;

/**
 * Serialize a value for the ledger: redact secret-ish keys, then size-cap.
 *
 * Never throws. A circular or unserializable value records that fact rather
 * than taking down the run that produced it.
 */
export function safeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const json = JSON.stringify(value, (key, val) =>
      SECRET_KEY_PATTERN.test(key) ? "[redacted]" : val,
    );
    if (!json) return null;
    if (json.length <= MAX_JSON_CHARS) return json;
    // Truncating raw JSON produces INVALID JSON, which then throws in the UI's
    // JSON.parse and breaks SQLite's json_extract/json_each on this column.
    // Wrap the preview in a valid envelope so an oversized payload stays
    // machine-readable instead of poisoning every consumer.
    return JSON.stringify({
      _truncated: true,
      _originalLength: json.length,
      preview: json.slice(0, MAX_JSON_CHARS),
    });
  } catch {
    return JSON.stringify({ _unserializable: true });
  }
}

/**
 * Pull a stable, groupable code out of an arbitrary error.
 *
 * The point is that "5 runs failed with MAPS_QUOTA_EXCEEDED" reads as one
 * problem, while five raw stack traces read as five unrelated incidents.
 * Prefers an explicit SCREAMING_SNAKE code, then an HTTP status, then the
 * error class name.
 */
export function errorCodeOf(error: unknown): string {
  if (error === null || error === undefined) return "UNKNOWN";

  // 1. An explicit `code` property — the Node/JS convention, and the most
  //    trustworthy signal there is (ETIMEDOUT, ENOTFOUND, SQLITE_ERROR...).
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim() !== "") return code;
    if (typeof code === "number") return String(code);
  }

  const message = error instanceof Error ? error.message : String(error);

  // 2. A SCREAMING_SNAKE code in the message. The underscore is REQUIRED:
  //    without it the pattern also matched incidental acronyms — JSON, HTTP,
  //    NULL, GET — so "Failed to parse JSON response" grouped under "JSON"
  //    and unrelated failures collapsed together, destroying the exact
  //    grouping this function exists to provide.
  const explicit = message.match(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/);
  if (explicit) return explicit[1];

  const status = message.match(/\b([1-5]\d{2})\b/);
  if (status) return status[1];

  // `constructor.name`, not `.name`: subclassing Error does NOT set `.name`,
  // so `class TimeoutError extends Error {}` reports "Error" and would collapse
  // every distinct error class into one useless bucket.
  if (error instanceof Error) {
    const className = error.constructor?.name;
    if (className && className !== "Error") return className;
  }
  return "ERROR";
}

/** Normalize any thrown value to a human-readable message. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
