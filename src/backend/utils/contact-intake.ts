/**
 * @fileoverview Contact intake helpers — turn messy, human-entered contact data
 * (business cards, POC blobs) into clean `showroom_store_contacts` fields.
 *
 * Used by BOTH the live contacts API/MCP create path and the one-off pocs
 * backfill, so the "field it out" logic stays in one place: split a full name,
 * pull labeled numbers out of a mixed phone string, and infer the contact type
 * from a job title.
 */

export type ContactType =
  | "GENERAL_CONTACT"
  | "SALES"
  | "ESTIMATOR"
  | "MANAGER"
  | "CUSTOMER_SERVICE"
  | "OTHER";

export const CONTACT_TYPES: readonly ContactType[] = [
  "GENERAL_CONTACT",
  "SALES",
  "ESTIMATOR",
  "MANAGER",
  "CUSTOMER_SERVICE",
  "OTHER",
] as const;

/** Split "Jane Q. Smith" → { firstName: "Jane", lastName: "Q. Smith" }. */
export function splitFullName(full: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const name = (full ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { firstName: null, lastName: null };
  const parts = name.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** A number pulled from a mixed phone string, tagged by the label beside it. */
export interface LabeledPhones {
  /** cell / mobile. */
  mobile: string | null;
  /** the person's direct / desk line. */
  office: string | null;
  /** an office / main / general line — belongs to the STORE, not the person. */
  general: string | null;
  fax: string | null;
  /** office extension when present ("x123" / "ext 123"). */
  extension: string | null;
}

const PHONE_RE = /(\+?\d[\d().\-\s]{6,}\d)/;
const EXT_RE = /(?:ext\.?|x|extension)\s*(\d{1,6})/i;

/**
 * Parse a human phone string that may pack several labeled numbers, e.g.
 *   "(510) 809-5741 cell · (510) 447-5016 direct · (510) 236-7960 office"
 * into typed slots. An unlabeled single number defaults to `office` (the
 * person's line). A number labeled office/main/general is treated as the
 * store's general line so the caller can upsert a GENERAL_CONTACT from it.
 */
export function parsePhoneField(raw: string | null | undefined): LabeledPhones {
  const out: LabeledPhones = { mobile: null, office: null, general: null, fax: null, extension: null };
  if (!raw) return out;

  // Split on common multi-value separators.
  const segments = raw.split(/[·;\n]|(?:\s+\|\s+)/).map((s) => s.trim()).filter(Boolean);
  const list = segments.length > 0 ? segments : [raw];

  let sawLabeled = false;
  for (const seg of list) {
    const phoneMatch = PHONE_RE.exec(seg);
    if (!phoneMatch) continue;
    const number = phoneMatch[1].trim();
    const label = seg.toLowerCase();

    const ext = EXT_RE.exec(seg);
    if (ext && !out.extension) out.extension = ext[1];

    if (/\b(cell|mobile|cel|mob)\b/.test(label)) {
      out.mobile ??= number;
      sawLabeled = true;
    } else if (/\bfax\b/.test(label)) {
      out.fax ??= number;
      sawLabeled = true;
    } else if (/\b(office|main|general|store|front|reception)\b/.test(label)) {
      out.general ??= number;
      sawLabeled = true;
    } else if (/\b(direct|desk|line|tel|phone|work)\b/.test(label)) {
      out.office ??= number;
      sawLabeled = true;
    } else {
      // Unlabeled — first unlabeled number is the person's office/direct line.
      out.office ??= number;
    }
  }
  // If nothing was labeled and we only found one number, it's the office line
  // (already set above). Nothing else to do.
  void sawLabeled;
  return out;
}

/** Infer a contact type from a job title. Defaults to OTHER. */
export function inferContactType(title: string | null | undefined): ContactType {
  const t = (title ?? "").toLowerCase();
  if (!t) return "OTHER";
  if (/\b(sales|account|rep\b|representative|consultant|advisor|specialist|designer)\b/.test(t))
    return "SALES";
  if (/\b(estimat|takeoff|quote)\b/.test(t)) return "ESTIMATOR";
  if (/\b(manager|director|owner|principal|president|lead|supervisor|gm\b)\b/.test(t))
    return "MANAGER";
  if (/\b(customer service|support|service|reception|front desk|concierge)\b/.test(t))
    return "CUSTOMER_SERVICE";
  return "OTHER";
}
