/**
 * @fileoverview Deterministic (NO-AI) gate deciding whether an inbound email is
 * worth minting a showroom CONTACT from. The email is always captured elsewhere;
 * this only guards contact creation, so bulk/marketing blasts and automated
 * `no-reply@` senders never pollute the phonebook — we only want PEOPLE.
 *
 * Pure worker code, no D1/env/AI, so it is unit-testable in isolation and cheap
 * to run on every inbound message. Reuses the person-name helpers from
 * `contact-intake` and the exclusion sets from the Gmail ingest gate.
 */
import { isExcludedSender } from "@backend/services/gmail/ingest-gate-domains";
import { looksLikePersonName, parseEmailIdentity, titleCaseName } from "./contact-intake";

/**
 * Local-parts that are machines/mailboxes, never a person. Anchored to the whole
 * local-part (optionally with a `.`/`-`/`_`/`+` suffix, e.g. `no-reply-2`,
 * `bounce+abc`). Role mailboxes like `sales@`/`info@` are deliberately NOT here —
 * a real person can sign a `sales@` email, so those are gated on the signature
 * check instead of hard-rejected.
 */
const AUTOMATED_LOCALPART =
  /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|bounce|bounces|mailer|mail|email|notification|notifications|notify|alert|alerts|automated|auto|autoresponder|system|daemon|newsletter|news|marketing|mailing|mailings|campaign|updates|update|digest|noreply)([.\-_+].*)?$/i;

/** Bulk/marketing tells in the body — the phrases mass-mail templates carry. */
const BULK_BODY_SIGNALS = [
  /\bunsubscribe\b/i,
  /view (this|it|the)?\s*(e-?mail|message|newsletter)?\s*in (your )?browser/i,
  /view (this|it|the)?\s*(e-?mail|message|newsletter)?\s*online/i,
  /manage (your )?(e-?mail )?preferences/i,
  /update your (e-?mail )?preferences/i,
  /you('|’)?re receiving this (e-?mail|message)/i,
  /you are receiving this (e-?mail|message)/i,
  /this is an automated (e-?mail|message|response)/i,
  /do not reply to this (e-?mail|message)/i,
  /no longer wish to receive/i,
  /opt[- ]?out/i,
];

/** Sign-off cue words that a person's name usually follows in a signature. */
const SIGNOFF_CUE =
  /^(best|best regards|regards|kind regards|warm regards|warmest regards|thanks|thank you|thanks so much|many thanks|sincerely|cheers|respectfully|all the best|talk soon|yours truly|warmly|with thanks)\b[\s,]*$/i;

/** Is the sender an automated / machine mailbox (no-reply, mailer-daemon, …)? */
export function isAutomatedSender(email: string | null | undefined): boolean {
  const local = (email ?? "").toLowerCase().trim().split("@")[0];
  if (!local) return false;
  return AUTOMATED_LOCALPART.test(local);
}

/** Does the body carry mass-mail / marketing tells (unsubscribe, view-in-browser…)? */
export function hasBulkMarketingSignals(bodyText: string | null | undefined): boolean {
  const t = bodyText ?? "";
  if (!t) return false;
  return BULK_BODY_SIGNALS.some((re) => re.test(t));
}

/**
 * Best-effort extraction of a PERSON's name from an email signature — no AI.
 * Two passes over the plain-text body:
 *   1. A sign-off cue line ("Best regards,") followed by a person-name line.
 *   2. Otherwise, scan the tail (where signatures live) for a person-name line
 *      that sits next to a phone / email / "|" separator (signature furniture).
 * Returns a title-cased name or null. `fromEmail`, when its local-part shares a
 * token with the candidate, breaks ties toward the matching name.
 */
export function extractSignatureName(
  bodyText: string | null | undefined,
  fromEmail?: string | null,
): string | null {
  const lines = (bodyText ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  // Pass 1: a sign-off cue, then the next person-like line.
  for (let i = 0; i < lines.length; i++) {
    if (!SIGNOFF_CUE.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const name = cleanNameLine(lines[j]);
      if (name && looksLikePersonName(name)) return titleCaseName(name);
    }
  }

  // Pass 2: scan the tail; a person-name line must sit next to signature
  // furniture (phone / email / separators) or match the From local-part — a bare
  // person-like line is NOT enough, or ordinary sentences ("No signature here")
  // get mistaken for names.
  const tail = lines.slice(Math.max(0, lines.length - 15));
  const localToken = (fromEmail ?? "").toLowerCase().split("@")[0]?.replace(/[._-]/g, "");
  for (let i = 0; i < tail.length; i++) {
    const name = cleanNameLine(tail[i]);
    if (!name || !looksLikePersonName(name)) continue;
    const neighbours = [tail[i - 1], tail[i + 1]].filter(Boolean).join(" ");
    const nearFurniture = /(\+?\d[\d().\-\s]{6,}\d)|@|\||·|www\.|https?:\/\//.test(neighbours);
    const matchesFrom =
      !!localToken && localToken.length >= 4 && name.toLowerCase().replace(/\s/g, "").includes(localToken.slice(0, 4));
    if (nearFurniture || matchesFrom) return titleCaseName(name);
  }
  return null;
}

/** Strip trailing title/role after a comma/dash so "Nancy Ruiz, Sales" → "Nancy Ruiz". */
function cleanNameLine(line: string): string {
  return line.split(/[,|·]|\s-\s|\s–\s/)[0].trim();
}

export interface ContactWorthiness {
  /** Create a contact from this sender? */
  create: boolean;
  /** Why — for logging / HITL context. */
  reason: string;
  /** The person's name when one was identified (title-cased), else null. */
  personName: string | null;
}

/**
 * Decide whether an inbound email should mint a showroom contact, and with what
 * person name. Rejects (create=false, email still captured upstream) when the
 * sender is ours/excluded, an automated mailbox, a bulk/marketing blast, or when
 * no actual person can be identified from the From display name or a signature.
 */
export function evaluateContactWorthiness(input: {
  fromEmail: string | null | undefined;
  /** The From display name, when the header carried one. */
  fromDisplayName?: string | null;
  bodyText?: string | null;
  /** True when the message carried a `List-Unsubscribe` header (bulk mail). */
  listUnsubscribe?: boolean;
}): ContactWorthiness {
  const { email, displayName } = parseEmailIdentity(input.fromEmail ?? input.fromDisplayName ?? null);
  const address = email ?? (input.fromEmail ?? "").toLowerCase().trim();
  if (!address) return { create: false, reason: "no sender address", personName: null };

  if (isExcludedSender(input.fromEmail) || isExcludedSender(address))
    return { create: false, reason: "excluded (our own) sender", personName: null };
  if (isAutomatedSender(address))
    return { create: false, reason: "automated / no-reply sender", personName: null };
  if (input.listUnsubscribe)
    return { create: false, reason: "bulk mail (List-Unsubscribe header)", personName: null };
  if (hasBulkMarketingSignals(input.bodyText))
    return { create: false, reason: "bulk/marketing body signals", personName: null };

  // Require a real PERSON: the From display name (when person-like) or a name
  // pulled from the body signature. Company/role-only senders create no contact.
  const fromName =
    (input.fromDisplayName?.trim() || displayName) &&
    looksLikePersonName(input.fromDisplayName?.trim() || displayName)
      ? titleCaseName(input.fromDisplayName?.trim() || displayName)
      : null;
  const personName = fromName ?? extractSignatureName(input.bodyText, address);
  if (!personName) return { create: false, reason: "no person identified", personName: null };

  return { create: true, reason: "person identified", personName };
}
