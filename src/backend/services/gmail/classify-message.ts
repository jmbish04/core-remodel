/**
 * @fileoverview Deterministic message classification + reply-quote trimming for
 * the Gmail Comms Hub (0041). NO AI here — these are pure text-pattern matchers
 * so ingestion stays cheap and every decision is explainable (we store the
 * exact phrase that triggered a spam flag in `gmail_messages.spam_rationale`).
 *
 * Consumed by both ingestion insert sites (`ingestion.ts`, `ingest-gate.ts`) to
 * set `classification` / `is_spam` / `spam_rationale`, and by the thread-view
 * API to trim quoted replies for display.
 */

import { parseEmailAddress } from "./participants";

export type MessageClassification = "normal" | "promotional" | "receipt" | "invoice" | "quote";

export interface MessageClassificationResult {
  classification: MessageClassification;
  isSpam: boolean;
  /** The phrase that set is_spam (for spam_rationale). null when not spam. */
  spamRationale: string | null;
}

/**
 * Bulk/marketing phrases. Presence of any (in the lowercased body) marks the
 * message spam — it is still ingested (sale/deal blasts stay visible, and it
 * proves ingestion works) but lands in the Spam folder, out of the main inbox.
 * The matched phrase is recorded verbatim as the rationale.
 */
export const SPAM_PHRASES: readonly string[] = [
  "unsubscribe",
  "mailing list",
  "view this email in a browser",
  "view this email in your browser",
  "view in browser",
  "view online",
  "manage preferences",
  "manage your preferences",
  "update your preferences",
  "email preferences",
  "you are receiving this",
  "you're receiving this",
  "no longer wish to receive",
  "opt out",
  "opt-out",
  "this is a promotional",
  "privacy policy | ", // footer separator common to blasts
];

/**
 * Exact sender addresses always treated as spam (bulk/marketing senders the
 * user has explicitly flagged). Lowercased.
 */
export const SPAM_SENDER_ADDRESSES: ReadonlySet<string> = new Set([
  "rejuvenation@e.rejuvenation.com",
]);

/**
 * Marketing/ESP subdomain prefixes. Bulk blasts almost always send from a
 * dedicated `e.brand.com` / `email.brand.com` style subdomain, never the brand's
 * root domain. Conservative set — excludes `mail.`/`info.` which are commonly
 * legit/transactional.
 */
const BULK_SENDER_SUBDOMAINS: readonly string[] = [
  "e.",
  "email.",
  "mailer.",
  "em.",
  "mktg.",
  "marketing.",
  "news.",
  "newsletter.",
  "nl.",
];

/** Purchase-document keywords. */
const RECEIPT_KEYWORDS: readonly { word: string; type: MessageClassification }[] = [
  { word: "order confirmation", type: "receipt" },
  { word: "receipt", type: "receipt" },
  { word: "invoice", type: "invoice" },
  { word: "quote", type: "quote" },
  { word: "quotation", type: "quote" },
];

/**
 * Classify a message from its subject + body (both will be lowercased here) and
 * whether it carries attachments.
 *
 * Rules (see 0041 plan):
 *  - Spam: body contains any SPAM_PHRASES → isSpam, rationale = matched phrase.
 *  - Receipt/invoice/quote: subject OR body contains a purchase keyword AND
 *    (a "$" appears OR the message hasAttachments) → classification = doc type.
 *  - Else normal.
 * Spam and receipt are independent: a promo carrying a real quote is
 * `classification: "quote"` AND `isSpam: true` (kept in Receipts, still flagged).
 */
export function classifyMessage(input: {
  from?: string;
  subject: string;
  body: string;
  hasAttachments: boolean;
}): MessageClassificationResult {
  const subject = (input.subject ?? "").toLowerCase();
  const body = (input.body ?? "").toLowerCase();
  const haystack = `${subject}\n${body}`;

  // Spam (independent of receipt). Sender rules are the most specific, so they
  // win the rationale; fall back to body-phrase matching.
  let isSpam = false;
  let spamRationale: string | null = null;

  const sender = parseEmailAddress(input.from ?? "");
  if (sender) {
    if (SPAM_SENDER_ADDRESSES.has(sender.email)) {
      isSpam = true;
      spamRationale = `sender: ${sender.email}`;
    } else if (BULK_SENDER_SUBDOMAINS.some((p) => sender.domain.startsWith(p))) {
      isSpam = true;
      spamRationale = `bulk sender: ${sender.domain}`;
    }
  }

  if (!isSpam) {
    for (const phrase of SPAM_PHRASES) {
      if (body.includes(phrase)) {
        isSpam = true;
        spamRationale = phrase;
        break;
      }
    }
  }

  // Receipt/invoice/quote.
  const hasMoney = haystack.includes("$");
  let receiptType: MessageClassification | null = null;
  if (hasMoney || input.hasAttachments) {
    for (const { word, type } of RECEIPT_KEYWORDS) {
      if (haystack.includes(word)) {
        receiptType = type;
        break;
      }
    }
  }

  const classification: MessageClassification = receiptType ?? (isSpam ? "promotional" : "normal");

  return { classification, isSpam, spamRationale };
}

/**
 * Markers that begin a quoted-reply / forwarded block, Gmail-style. The first
 * match (earliest offset) is where the "new" content ends.
 */
const QUOTE_MARKERS: readonly RegExp[] = [
  // "On Mon, Jan 1, 2026 at 9:00 AM, Jane <j@x.com> wrote:"
  /^\s*On .+?\bwrote:\s*$/im,
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^_{5,}\s*$/m, // Outlook divider line
  /^\s*From:\s.+\n\s*Sent:\s.+/im, // Outlook forwarded header block
  /^\s*-{2,}\s*Forwarded message\s*-{2,}/im,
];

export interface TrimmedBody {
  /** The new message content (quoted/forwarded tail removed). */
  visible: string;
  /** The removed quoted/forwarded tail, or "" if there was none. */
  quoted: string;
}

/**
 * Split a plaintext body into its new content and the trimmed quoted-reply
 * tail, mimicking Gmail's "…" collapse. Conservative: cuts at the EARLIEST
 * recognized marker; if none is found, everything is `visible` and `quoted`
 * is empty. Also collapses a trailing run of `>`-quoted lines.
 */
export function trimQuotedReply(body: string): TrimmedBody {
  if (!body) return { visible: "", quoted: "" };

  let cut = body.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(body);
    if (m && m.index < cut) cut = m.index;
  }

  // Also catch a trailing block of lines that all start with ">".
  if (cut === body.length) {
    const lines = body.split("\n");
    let i = lines.length - 1;
    // walk up over trailing blank + quoted lines
    let firstQuoted = -1;
    while (i >= 0) {
      const line = lines[i].trim();
      if (line === "") {
        i--;
        continue;
      }
      if (line.startsWith(">")) {
        firstQuoted = i;
        i--;
        continue;
      }
      break;
    }
    if (firstQuoted !== -1) {
      cut = lines.slice(0, firstQuoted).join("\n").length;
    }
  }

  const visible = body.slice(0, cut).replace(/\s+$/, "");
  const quoted = body.slice(cut).replace(/^\s+/, "");
  return { visible, quoted };
}
