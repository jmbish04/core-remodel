/**
 * @fileoverview AI classification + structured extraction for inbound email.
 *
 * Runs a single Gemini (via Cloudflare AI Gateway) call that classifies the
 * email and extracts invoice / contract structure. The prompt is assembled
 * per-route: the {@link HandlingProfile} tunes how much analysis is engaged
 * (`lean` invoices vs. `deep` adversarial contract review) and passes a
 * deterministic type hint when the recipient address already implies intent.
 *
 * All prompt text is built with ES6 template literals (never `.join('\n')`),
 * per the stack's AI-prompt-construction rule — literal `\n` sequences survive
 * transport boundaries and silently collapse prompt structure.
 */

import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";
import { stripJsonFence } from "@backend/utils/ai-json";
import { ANALYSIS_RESPONSE_SCHEMA } from "./extraction-schema";
import type { HandlingProfile } from "./types";

/** Structured result of the AI analysis stage. */
export interface AiAnalysis {
  classification: string;
  classificationConfidence: number;
  senderCompanyName: string | null;
  /** The sending person's job title/role, from the signature (for the type badge). */
  senderContactTitle: string | null;
  senderBusinessType: string | null;
  senderPhone: string | null;
  senderWebsite: string | null;
  senderLicenseNumber: string | null;
  reviewerFlags: Array<{
    level: "info" | "warning" | "critical";
    category: string;
    message: string;
  }>;
  invoiceData: {
    vendorName: string | null;
    /** retailer | contractor | supplier | marketplace | utility | service | other */
    merchantType?: string | null;
    invoiceNumber: string | null;
    /** Order/confirmation number (distinct from an invoice number). */
    orderNumber?: string | null;
    invoiceDate: string | null;
    dueDate: string | null;
    /** Free text ok, e.g. "Friday, July 24". */
    estimatedDeliveryDate?: string | null;
    subtotal: number | null;
    /** Order-level discount total (positive). */
    discount?: number | null;
    shipping?: number | null;
    tax: number | null;
    total: number | null;
    currency?: string | null;
    lineItems: Array<{
      description: string;
      brand?: string | null;
      modelNumber?: string | null;
      variant?: string | null;
      qty: number;
      unitPrice: number;
      total: number;
    }>;
  } | null;
  contractData: {
    contractType: string | null;
    partyName: string | null;
    counterpartyName: string | null;
    scopeSummary: string | null;
    totalValue: number | null;
    effectiveDate: string | null;
    completionDate: string | null;
    clauses: Array<{
      type: string;
      summary: string;
      riskLevel: string;
      fullText: string;
    }>;
    paymentMilestones: Array<{
      name: string;
      amount: number;
      trigger: string;
      dueDate: string | null;
    }>;
    recommendations: Array<{
      category: string;
      severity: string;
      title: string;
      detail: string;
      suggestedAction: string;
    }>;
  } | null;
}

/**
 * The contract-analysis section is expensive (verbatim clause extraction +
 * adversarial recommendations). It's included at `full`/`deep` depth and
 * emphasized at `deep`; at `lean` depth (invoice route) it is omitted so the
 * model stays focused and cheap.
 */
function contractSection(profile: HandlingProfile): string {
  if (profile.analysisDepth === "lean") {
    return `"contractData": null (this route handles invoices — do not perform contract clause analysis)`;
  }

  const adversarialEmphasis =
    profile.analysisDepth === "deep"
      ? `This email arrived on the CONTRACTS channel, so a contract is expected. Be exhaustive and adversarial on the homeowner's behalf — surface every missing protection, risky clause, and negotiation lever you can find.`
      : `If this is a contract or change order, be thorough and adversarial on behalf of the homeowner.`;

  return `"contractData": null or {
    "contractType": "contract" | "change_order" | "addendum" | "proposal",
    "partyName": "Contractor/vendor name",
    "counterpartyName": "Homeowner name",
    "scopeSummary": "2-3 sentence summary of the scope of work",
    "totalValue": number,
    "effectiveDate": "YYYY-MM-DD or null",
    "completionDate": "YYYY-MM-DD or null",
    "clauses": [
      {
        "type": "payment" | "warranty" | "lien_waiver" | "cancellation" | "delay" | "insurance" | "scope_exclusion" | "dispute" | "indemnity",
        "summary": "1-2 sentence summary",
        "riskLevel": "low" | "medium" | "high",
        "fullText": "Verbatim or near-verbatim clause text"
      }
    ],
    "paymentMilestones": [
      {"name": "string", "amount": number, "trigger": "string", "dueDate": "YYYY-MM-DD or null"}
    ],
    "recommendations": [
      {
        "category": "negotiate" | "add_clause" | "risk" | "question",
        "severity": "info" | "warning" | "critical",
        "title": "Short title",
        "detail": "Detailed explanation of why this matters",
        "suggestedAction": "What the homeowner should do or say"
      }
    ]
  }

${adversarialEmphasis} Consider:
- Missing protections (lien waivers, warranty, insurance requirements, delay penalties)
- Front-loaded payment schedules (industry standard is milestone-based)
- Vague scope definitions that could lead to disputes
- One-sided cancellation or dispute clauses
- Questions the homeowner should ask before signing
- Terms that should be negotiated (based on Bay Area construction norms)
- Comparison to industry standard practices`;
}

/**
 * A one-line intent hint injected when the recipient address deterministically
 * implies a type (e.g. mail to the invoices mailbox). Guides — but does not
 * force — the classifier; the caller applies the hard override separately.
 */
function expectedTypeHint(profile: HandlingProfile): string {
  if (!profile.expectedType) return "";
  return `ROUTING HINT: This email was delivered to the ${profile.expectedType.toUpperCase()} channel, so it is very likely a ${profile.expectedType}. Prefer that classification unless the content clearly contradicts it.\n`;
}

/**
 * How much email body reaches the model. Gemini 2.5 Flash carries a ~1M-token
 * context, so this is a cost/abuse ceiling rather than a model limit — 24k
 * characters is roughly 6k tokens, and a retail order confirmation is ~12k.
 */
const BODY_CHAR_BUDGET = 24_000;
/** Same idea for attachment text, which is usually the larger of the two. */
const ATTACHMENT_CHAR_BUDGET = 48_000;

/**
 * Clamp long text for a prompt while KEEPING THE END.
 *
 * A naive `.slice(0, n)` is the wrong shape for commerce email. The order
 * summary — subtotal, discount, shipping, tax, total — is always at the BOTTOM,
 * under a long header of tracking links, marketing blocks and image alt text.
 * Cutting the tail throws away precisely the numbers the extractor exists to
 * read, and the model then (correctly) reports that no total was present.
 *
 * That is not hypothetical: a 12,481-char Costco receipt was cut at 8,000, and
 * "Subtotal" began at 8,098 — 98 characters past the knife. The model returned
 * `invoiceData: null` and flagged "the email does not explicitly state the
 * total amount paid", while `Total  $5,105.33` sat in the untransmitted tail.
 *
 * So keep a generous head for context and a fixed tail for the totals, with an
 * explicit marker between them so the model knows material was removed rather
 * than inferring the document simply ends mid-sentence.
 */
export function clampForPrompt(text: string, budget: number): string {
  const value = text || "";
  if (value.length <= budget) return value;

  // Weighted toward the tail: order summaries, signatures and totals live
  // there, while the head is mostly boilerplate once past the first screenful.
  const headChars = Math.floor(budget * 0.6);
  const tailChars = budget - headChars;
  const omitted = value.length - budget;

  return (
    value.slice(0, headChars) +
    `\n\n[... ${omitted.toLocaleString()} characters omitted from the middle of this email ...]\n\n` +
    value.slice(-tailChars)
  );
}

/**
 * Build the full analysis prompt for a given route profile + email content.
 */
function buildPrompt(
  profile: HandlingProfile,
  subject: string,
  from: string,
  bodyText: string,
  attachmentText: string,
): string {
  return `You are an expert construction/renovation project assistant analyzing an email received by a homeowner managing a residential remodel in the San Francisco Bay Area.

${expectedTypeHint(profile)}Your job is to:
1. CLASSIFY the email into exactly one category
2. EXTRACT structured data if it's an invoice or contract
3. IDENTIFY the sending company's details from signatures/letterhead
4. GENERATE actionable reviewer flags for the homeowner

If this is a FORWARDED email, look past the forward headers to analyze the ORIGINAL message content.

Respond with ONLY valid JSON matching this schema:
{
  "classification": "invoice" | "contract" | "change_order" | "estimate" | "receipt" | "shipping" | "general",
  "classificationConfidence": 0.0-1.0,
  "senderCompanyName": "string or null",
  "senderContactTitle": "string or null (the sending person's job title/role from the signature, e.g. 'Sales Consultant', 'Estimator', 'Showroom Manager')",
  "senderBusinessType": "string or null (e.g. 'General Contractor', 'Architect', 'Plumber', 'Material Vendor')",
  "senderPhone": "string or null",
  "senderWebsite": "string or null",
  "senderLicenseNumber": "string or null",
  "reviewerFlags": [
    {
      "level": "info" | "warning" | "critical",
      "category": "payment" | "clause_risk" | "missing_protection" | "negotiation_tip" | "follow_up_question" | "company_match" | "general",
      "message": "Clear, actionable message for the homeowner"
    }
  ],
  "invoiceData": null or {
    "vendorName": "string (store / supplier / laborer)",
    "merchantType": "retailer | contractor | supplier | marketplace | utility | service | other",
    "invoiceNumber": "string",
    "orderNumber": "string (order/confirmation number, if distinct)",
    "invoiceDate": "YYYY-MM-DD",
    "dueDate": "YYYY-MM-DD or null",
    "estimatedDeliveryDate": "string or null (free text ok)",
    "subtotal": number,
    "discount": number (order-level discount total, positive),
    "shipping": number,
    "tax": number,
    "total": number,
    "currency": "string",
    "lineItems": [{"description": "string", "brand": "string or null", "modelNumber": "string or null", "variant": "string or null", "qty": number, "unitPrice": number, "total": number}]
  },
  ${contractSection(profile)}
}

IMPORTANT — populate "invoiceData" for BOTH invoices AND receipts (a receipt is a
completed purchase, e.g. a store order confirmation). For a receipt, set
"invoiceNumber" to the order/receipt number, "dueDate" to null, and include EVERY
purchased product as its own entry in "lineItems" with its brand + model number +
variant where shown (this is how the homeowner links each purchased item back to
their materials schedule). Extract all line items — do not summarize or omit any.
Read the order summary and copy the EXACT amounts printed: subtotal, discount,
shipping, tax, and total. These are almost always shown on the email — do NOT
claim a total is unknown or tell the reviewer to "check their payment method" if a
Total / Order Total is present; only emit a "payment" flag about a missing amount
if the total is truly not printed anywhere.

EMAIL CONTENT:
Subject: ${subject || "No Subject"}
From: ${from}
Date: ${new Date().toISOString()}
Body:
${clampForPrompt(bodyText, BODY_CHAR_BUDGET)}

${attachmentText ? `ATTACHMENT CONTENT (extracted text):\n${clampForPrompt(attachmentText, ATTACHMENT_CHAR_BUDGET)}` : ""}`;
}

/**
 * The model occasionally emits a "we can't see the total, check your payment
 * method" flag even when the total is printed on the email. If a total was
 * extracted, drop those self-contradicting payment flags. Mutates in place.
 */
function dropContradictoryPaymentFlags(analysis: AiAnalysis): void {
  if (!analysis || typeof analysis !== "object") return;
  if (typeof analysis.invoiceData?.total !== "number") return;
  analysis.reviewerFlags = (analysis.reviewerFlags || []).filter((f) => {
    if (f.category !== "payment") return true;
    return !/(not (explicitly |clearly )?(state|list|show|specif|includ|mention)|check your payment method|final charge|unclear|unknown)/i.test(
      f.message,
    );
  });
}

/**
 * Classify + extract structured data from an email using Gemini.
 *
 * @param env Worker env (AI Gateway client factory).
 * @param profile Route handling profile — tunes prompt depth + type hint.
 * @param subject Email subject.
 * @param from Real sender address (post forward-unwrap).
 * @param bodyText Plain-text body.
 * @param attachmentText Concatenated extracted attachment text.
 * @returns The parsed {@link AiAnalysis}, or a safe fallback on parse failure.
 */
export async function analyzeWithGemini(
  env: Env,
  profile: HandlingProfile,
  subject: string,
  from: string,
  bodyText: string,
  attachmentText: string,
): Promise<AiAnalysis> {
  const ai = await createGeminiAiGatewayClient(env, "email_classify");
  const prompt = buildPrompt(profile, subject, from, bodyText, attachmentText);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: ANALYSIS_RESPONSE_SCHEMA,
      temperature: 0.1,
    },
  });

  const rawText = response.text || "";

  try {
    const cleaned = stripJsonFence(rawText);
    const analysis = JSON.parse(cleaned) as AiAnalysis;
    dropContradictoryPaymentFlags(analysis);
    return analysis;
  } catch (err) {
    console.error(
      "[email-classify] Failed to parse Gemini response:",
      err,
      rawText.slice(0, 500),
    );
    return {
      classification: "general",
      classificationConfidence: 0.3,
      senderCompanyName: null,
      senderContactTitle: null,
      senderBusinessType: null,
      senderPhone: null,
      senderWebsite: null,
      senderLicenseNumber: null,
      reviewerFlags: [
        {
          level: "warning",
          category: "general",
          message:
            "AI analysis could not fully parse this email — manual review recommended.",
        },
      ],
      invoiceData: null,
      contractData: null,
    };
  }
}
