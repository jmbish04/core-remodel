/**
 * Cross-trade contractor matching (SPEC Phase 3).
 *
 * Given a contractor's identity captured from an anchor (open 126 Colby) permit,
 * build a single OR-combined SoQL `$where` per contact dataset that finds that
 * contractor's other permits, then classify each returned row's match strategy +
 * confidence in JS. Running one combined query per (contractor × dataset) keeps
 * SODA call volume sane; the JS classifier recovers which rule actually matched.
 *
 * Strategy cascade (highest confidence first):
 *   1. license          — CSLB license equality                       (high)
 *   2. sf_biz_license    — SF business license equality                (high)
 *   3. firm_name         — firm/company name exact equality            (medium)
 *   4. person_name       — first + last name equality (building only)  (medium)
 *   5. name_tokens       — every token of the contractor name CONTAINED in firm name (low)
 *   6. address_tokens    — first 2 tokens of firm address CONTAINED in firm address (low)
 */

import {
  escapeSoqlLiteral,
  normalizeText,
  type SodaRow,
  toNullableString,
} from "./soda";
import type { ContactDatasetConfig } from "./datasets";

export type MatchStrategy =
  | "license"
  | "sf_biz_license"
  | "firm_name"
  | "person_name"
  | "name_tokens"
  | "address_tokens";

export type MatchConfidence = "high" | "medium" | "low";

export const CONFIDENCE_BY_STRATEGY: Record<MatchStrategy, MatchConfidence> = {
  license: "high",
  sf_biz_license: "high",
  firm_name: "medium",
  person_name: "medium",
  name_tokens: "low",
  address_tokens: "low",
};

/** Strategies ordered best → worst, so the classifier can pick the strongest hit. */
const STRATEGY_PRIORITY: MatchStrategy[] = [
  "license",
  "sf_biz_license",
  "firm_name",
  "person_name",
  "name_tokens",
  "address_tokens",
];

/** A contractor's identity, read off an anchor permit contact. */
export type ContractorIdentity = {
  /** Display name — person name when available, else firm. */
  contactName: string;
  firstName: string | null;
  lastName: string | null;
  firmName: string | null;
  firmAddress: string | null;
  /** All CSLB licenses seen for this contractor (deduped, validated). */
  licenseNumbers: string[];
  sfBusinessLicense: string | null;
};

/**
 * Noise tokens dropped from firm-name token matching so we don't match every
 * incorporated firm. The anchor name we tokenize is usually a short person name,
 * so this mostly guards the firm-name fallback.
 */
const NOISE_TOKENS = new Set([
  "inc",
  "co",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "company",
  "the",
  "of",
  "and",
  "&",
]);

/** A CSLB / SF license is usable for matching only if it's non-trivial. */
export function isValidLicense(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 4) return false;
  return /[1-9]/.test(trimmed); // not all zeros / empties
}

/** Lowercase, split on non-alphanumerics, drop empties. */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Meaningful tokens of a contractor name for the firm-name CONTAINS strategy:
 * noise-filtered, length ≥ 2. Falls back to the raw tokens if filtering empties.
 */
export function contractorNameTokens(identity: ContractorIdentity): string[] {
  const base =
    identity.firstName && identity.lastName
      ? `${identity.firstName} ${identity.lastName}`
      : identity.firmName || identity.contactName;
  const raw = tokenize(base);
  // Only meaningful tokens. If none remain (e.g. "The Co"), the caller skips the
  // name-token strategy rather than matching on noise across the whole dataset.
  return raw.filter((token) => !NOISE_TOKENS.has(token) && token.length >= 2);
}

/** First two non-empty tokens of the firm address (e.g. "1340", "donner"). */
export function firmAddressTokens(identity: ContractorIdentity): string[] {
  if (!identity.firmAddress) return [];
  return tokenize(identity.firmAddress).slice(0, 2);
}

function likeContains(field: string, token: string): string {
  return `lower(\`${field}\`) like '%${escapeSoqlLiteral(token.toLowerCase())}%'`;
}

function inList(field: string, values: string[]): string {
  const escaped = values.map((value) => `'${escapeSoqlLiteral(value)}'`).join(",");
  return `\`${field}\` in (${escaped})`;
}

/**
 * Build the OR-combined `$where` that finds this contractor's permits in the
 * given contact dataset, or null when no strategy applies to that dataset.
 */
export function buildContactMatchWhere(
  identity: ContractorIdentity,
  config: ContactDatasetConfig,
): string | null {
  const clauses: string[] = [];

  // 1. license
  const licenses = identity.licenseNumbers.filter(isValidLicense);
  if (licenses.length > 0 && config.licenseFields.length > 0) {
    const licenseClauses = config.licenseFields.map((field) => inList(field, licenses));
    clauses.push(`(${licenseClauses.join(" OR ")})`);
  }

  // 2. sf business license
  if (isValidLicense(identity.sfBusinessLicense) && config.sfBizField) {
    clauses.push(
      `\`${config.sfBizField}\` = '${escapeSoqlLiteral(identity.sfBusinessLicense as string)}'`,
    );
  }

  // 3. firm name exact
  if (identity.firmName) {
    clauses.push(
      `lower(\`${config.firmNameField}\`) = '${escapeSoqlLiteral(
        normalizeText(identity.firmName),
      )}'`,
    );
  }

  // 4. person name (datasets that carry person-name columns only)
  if (config.personNameFields.length === 2 && identity.firstName && identity.lastName) {
    const [firstField, lastField] = config.personNameFields;
    clauses.push(
      `(lower(\`${firstField}\`) = '${escapeSoqlLiteral(
        identity.firstName.toLowerCase(),
      )}' AND lower(\`${lastField}\`) = '${escapeSoqlLiteral(identity.lastName.toLowerCase())}')`,
    );
  }

  // 5. name tokens → firm name (every token CONTAINED). Requires ≥2 meaningful
  //    tokens so a single common surname can't match half the dataset.
  const nameTokens = contractorNameTokens(identity);
  if (nameTokens.length >= 2) {
    const tokenClauses = nameTokens.map((token) => likeContains(config.firmNameField, token));
    clauses.push(`(${tokenClauses.join(" AND ")})`);
  }

  // 6. address tokens → firm address (first 2 tokens CONTAINED), corroborated by
  //    a name-token overlap. Business addresses are frequently shared (filing
  //    bureaus, office buildings) — live data shows one shared address
  //    ("1555 Yosemite Av") spans dozens of unrelated firms — so address alone is
  //    never sufficient; it must co-occur with at least one name token.
  const addrTokens = firmAddressTokens(identity);
  // Require at least as many address tokens as address fields, so an electrical
  // contact (street_number + street) can't match on street number alone.
  if (
    addrTokens.length >= config.firmAddressFields.length &&
    config.firmAddressFields.length > 0 &&
    nameTokens.length > 0
  ) {
    const addressClause = buildAddressTokenClause(addrTokens, config.firmAddressFields);
    const nameOverlap = nameTokens
      .map((token) => likeContains(config.firmNameField, token))
      .join(" OR ");
    clauses.push(`(${addressClause} AND (${nameOverlap}))`);
  }

  if (clauses.length === 0) return null;
  return clauses.join(" OR ");
}

/**
 * Address-token clause. A single address column matches every token against it;
 * a two-column split (electrical street_number + street) maps token-1 → first
 * column, token-2 → second column.
 */
function buildAddressTokenClause(tokens: string[], fields: string[]): string {
  if (fields.length >= 2) {
    const parts = tokens
      .slice(0, fields.length)
      .map((token, index) => likeContains(fields[index], token));
    return `(${parts.join(" AND ")})`;
  }
  const field = fields[0];
  const parts = tokens.map((token) => likeContains(field, token));
  return `(${parts.join(" AND ")})`;
}

// ---------------------------------------------------------------------------
// Classification (re-test rules against a returned row)
// ---------------------------------------------------------------------------

function rowValue(row: SodaRow, field: string): string | null {
  return toNullableString(row[field]);
}

function rowContainsAll(row: SodaRow, field: string, tokens: string[]): boolean {
  const value = rowValue(row, field);
  if (!value) return false;
  const lower = value.toLowerCase();
  return tokens.every((token) => lower.includes(token.toLowerCase()));
}

/**
 * Determine the strongest strategy a returned contact row satisfies (or null).
 * Mirrors {@link buildContactMatchWhere} so the OR-query result can be labeled.
 */
export function classifyContactMatch(
  row: SodaRow,
  identity: ContractorIdentity,
  config: ContactDatasetConfig,
): { strategy: MatchStrategy; confidence: MatchConfidence } | null {
  const licenses = new Set(identity.licenseNumbers.filter(isValidLicense));

  const satisfies = (strategy: MatchStrategy): boolean => {
    switch (strategy) {
      case "license":
        return config.licenseFields.some((field) => {
          const value = rowValue(row, field);
          return value ? licenses.has(value.trim()) : false;
        });
      case "sf_biz_license": {
        if (!isValidLicense(identity.sfBusinessLicense)) return false;
        const value = rowValue(row, config.sfBizField);
        return value?.trim() === identity.sfBusinessLicense?.trim();
      }
      case "firm_name": {
        if (!identity.firmName) return false;
        const value = rowValue(row, config.firmNameField);
        return value ? normalizeText(value) === normalizeText(identity.firmName) : false;
      }
      case "person_name": {
        if (config.personNameFields.length !== 2) return false;
        if (!identity.firstName || !identity.lastName) return false;
        const [firstField, lastField] = config.personNameFields;
        const first = rowValue(row, firstField);
        const last = rowValue(row, lastField);
        return (
          first?.toLowerCase() === identity.firstName.toLowerCase() &&
          last?.toLowerCase() === identity.lastName.toLowerCase()
        );
      }
      case "name_tokens": {
        const tokens = contractorNameTokens(identity);
        return tokens.length >= 2 && rowContainsAll(row, config.firmNameField, tokens);
      }
      case "address_tokens": {
        const tokens = firmAddressTokens(identity);
        const nameTokens = contractorNameTokens(identity);
        if (tokens.length < config.firmAddressFields.length || config.firmAddressFields.length === 0)
          return false;
        if (nameTokens.length === 0) return false;
        const addressMatches =
          config.firmAddressFields.length >= 2
            ? tokens
                .slice(0, config.firmAddressFields.length)
                .every((token, index) =>
                  rowContainsAll(row, config.firmAddressFields[index], [token]),
                )
            : rowContainsAll(row, config.firmAddressFields[0], tokens);
        if (!addressMatches) return false;
        // Corroborate with a name-token overlap (address alone is too noisy).
        const firmName = rowValue(row, config.firmNameField)?.toLowerCase() ?? "";
        return nameTokens.some((token) => firmName.includes(token.toLowerCase()));
      }
    }
  };

  for (const strategy of STRATEGY_PRIORITY) {
    if (satisfies(strategy)) {
      return { strategy, confidence: CONFIDENCE_BY_STRATEGY[strategy] };
    }
  }
  return null;
}
