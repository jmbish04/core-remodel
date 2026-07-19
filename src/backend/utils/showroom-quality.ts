/**
 * @fileoverview Intake data-quality guards for showroom stores.
 *
 * THE PROBLEM THIS EXISTS TO STOP. Audited 2026-07-16, 146 prod stores:
 *   - 86 had ZERO categories
 *   - 78 had no logo
 *   - 4 carried a region where a street address belongs ("Bay Area, CA")
 *
 * None of it was caught at intake, because `POST /api/showroom-stores` typed
 * `locationAddress` as `z.string().optional().nullable()` and defaulted
 * `categoryIds` to `[]`. Anything parsed. The data was fixed by backfill twice
 * before and rotted again both times, because the door was never closed.
 *
 * THE POSTURE IS "WARN, DON'T BLOCK" — with one exception.
 * Hard-rejecting an intake would be worse than the bad data: Justin adds
 * showrooms from his phone mid-visit, and a store with a fuzzy address still
 * beats no store. So these return structured warnings the route attaches to the
 * response (and logs), rather than 400s. The single hard failure is a
 * syntactically impossible address, which is always a bug rather than a
 * judgement call.
 *
 * Pure — no imports, no bindings — so `scripts/tests/test_showroom_quality.mjs`
 * can exercise it with plain node.
 */

/** One thing wrong with an intake payload. */
export interface QualityWarning {
  field: string;
  code: string;
  message: string;
  /** `error` blocks the write; `warn` is advisory and returned to the caller. */
  severity: "warn" | "error";
}

/**
 * Region names that get typed into an address box when the real address is
 * unknown. Each of these is a real value found in prod.
 */
const REGION_ONLY_RE =
  /^\s*(bay area|sf bay area|san francisco bay area|greater bay area|various|multiple|tbd|n\/?a|unknown|by appointment)\b/i;

/**
 * True when the string looks like a real street address: starts with a street
 * number, has a street name, a comma, and a 5-digit ZIP.
 *
 * Mirrors `addressQuality()` in scripts/showroom-audit.mjs — the audit and the
 * intake guard must agree on what "proper" means or the backfill will keep
 * re-flagging rows the intake just accepted.
 */
export function isProperStreetAddress(addr: string | null | undefined): boolean {
  const s = (addr ?? "").trim();
  if (!s) return false;
  if (REGION_ONLY_RE.test(s)) return false;
  if (!/^\s*\d+[\w-]*\s+\S/.test(s)) return false;
  if (!s.includes(",")) return false;
  return /\b\d{5}(-\d{4})?\b/.test(s);
}

/** Strip a leading annotation ("*BY APPOINTMENT ONLY*, 1998 Republic Ave, …"). */
export function stripAddressAnnotation(addr: string): string {
  const m = /^[^\d,]*[*(].*?[*)]\s*,\s*(.+)$/.exec(addr.trim());
  return m && /^\s*\d/.test(m[1]) ? m[1].trim() : addr.trim();
}

/** What the guard needs from an intake payload. */
export interface IntakeQualityInput {
  name?: string | null;
  locationAddress?: string | null;
  categoryIds?: number[] | null;
  links?: Array<{ url: string; type: string }> | null;
  websiteUrl?: string | null;
}

/**
 * Inspect an intake payload and return everything wrong with it.
 *
 * The caller decides what to do: the HTTP route attaches warnings to the 201
 * response so the UI can surface them, and rejects only on `severity: "error"`.
 */
export function assessIntakeQuality(input: IntakeQualityInput): QualityWarning[] {
  const out: QualityWarning[] = [];

  // ── Address ──────────────────────────────────────────────────────────────
  const addr = input.locationAddress?.trim() ?? "";
  if (!addr) {
    out.push({
      field: "locationAddress",
      code: "address_missing",
      message: "No address. The store will not appear on the map or in drive routing.",
      severity: "warn",
    });
  } else if (REGION_ONLY_RE.test(addr)) {
    // The exact shape of the 4 broken prod rows. Not a typo — a placeholder.
    out.push({
      field: "locationAddress",
      code: "address_region_only",
      message: `"${addr}" is a region, not a street address. Add the street number, city and ZIP.`,
      severity: "warn",
    });
  } else if (!isProperStreetAddress(addr)) {
    const cleaned = stripAddressAnnotation(addr);
    out.push({
      field: "locationAddress",
      code: "address_incomplete",
      message: isProperStreetAddress(cleaned)
        ? `Address carries a leading note; "${cleaned}" is the usable form.`
        : `"${addr}" does not look like a full street address (expected "123 Main St, City, ST 94577").`,
      severity: "warn",
    });
  }

  // ── Categories ───────────────────────────────────────────────────────────
  // The single biggest gap: 86 of 146 stores. A store with no category is
  // invisible to every category filter in the directory.
  if (!input.categoryIds || input.categoryIds.length === 0) {
    out.push({
      field: "categoryIds",
      code: "categories_missing",
      message:
        "No categories. The store will not surface in any category filter. " +
        "Inference will attempt to fill this from the name — verify it landed.",
      severity: "warn",
    });
  }

  // ── Website ──────────────────────────────────────────────────────────────
  // No website means no scrape, no favicon, no brands — a permanently thin row.
  const hasWebsite =
    Boolean(input.websiteUrl?.trim()) ||
    Boolean(input.links?.some((l) => l.type === "WEBSITE" && l.url.trim()));
  if (!hasWebsite) {
    out.push({
      field: "links",
      code: "website_missing",
      message:
        "No website link. Scrape, favicon and brand extraction all key off it, " +
        "so this store stays thin until one is added.",
      severity: "warn",
    });
  }

  // ── Name ─────────────────────────────────────────────────────────────────
  // The only hard error: without a name nothing downstream can classify it, and
  // an empty name is always a bug rather than a judgement call.
  if (!input.name?.trim()) {
    out.push({
      field: "name",
      code: "name_missing",
      message: "A store name is required.",
      severity: "error",
    });
  }

  return out;
}

/** True when any warning is severe enough to reject the write. */
export function hasBlockingIssue(warnings: QualityWarning[]): boolean {
  return warnings.some((w) => w.severity === "error");
}
