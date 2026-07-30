/**
 * @fileoverview Native structured-output schema for inbound-email analysis.
 *
 * Passed to Gemini as `config.responseSchema` so the model is FORCED to emit
 * exactly this shape instead of free-writing JSON-in-prose. Prompt-only schemas
 * let the model hand-wave — e.g. flagging "the total is not stated, check your
 * payment method" on a receipt whose total is printed. A real responseSchema
 * makes every field a first-class property the model must fill from the email.
 *
 * Field names mirror {@link AiAnalysis} in `classify.ts` for a 1:1 map. Extra
 * receipt fields (merchantType, orderNumber, discount, shipping, per-item
 * brand/model/variant) are additive — older consumers ignore them; they persist
 * in `extracted_raw_json` until surfaced.
 */

import { Type, type Schema } from "@google/genai";

const s = (nullable = true) => ({ type: Type.STRING, nullable });
const n = (nullable = true) => ({ type: Type.NUMBER, nullable });

const lineItem: Schema = {
  type: Type.OBJECT,
  properties: {
    description: s(false),
    brand: s(),
    modelNumber: s(),
    variant: s(), // colour / size / style, e.g. "Olive · M"
    qty: n(false),
    unitPrice: n(false),
    total: n(false),
  },
  required: ["description", "qty", "unitPrice", "total"],
};

const invoiceData: Schema = {
  type: Type.OBJECT,
  nullable: true,
  properties: {
    vendorName: s(),
    merchantType: {
      type: Type.STRING,
      nullable: true,
      enum: ["retailer", "contractor", "supplier", "marketplace", "utility", "service", "other"],
    },
    invoiceNumber: s(),
    orderNumber: s(),
    invoiceDate: s(), // YYYY-MM-DD
    dueDate: s(), // YYYY-MM-DD
    estimatedDeliveryDate: s(), // free text ok, e.g. "Friday, July 24"
    subtotal: n(),
    discount: n(), // order-level discount total, positive
    shipping: n(),
    tax: n(),
    total: n(),
    currency: s(),
    lineItems: { type: Type.ARRAY, items: lineItem },
  },
  // All non-optional AiAnalysis.invoiceData fields — required (but nullable) so
  // the model always emits the key (as null when absent) rather than omitting it.
  required: ["vendorName", "invoiceNumber", "invoiceDate", "dueDate", "subtotal", "tax", "total", "lineItems"],
};

const clause: Schema = {
  type: Type.OBJECT,
  properties: {
    type: s(false),
    summary: s(false),
    riskLevel: { type: Type.STRING, enum: ["low", "medium", "high"] },
    fullText: s(false),
  },
  required: ["type", "summary", "riskLevel", "fullText"],
};

const milestone: Schema = {
  type: Type.OBJECT,
  properties: {
    name: s(false),
    amount: n(false),
    trigger: s(false),
    dueDate: s(),
  },
  required: ["name", "amount", "trigger"],
};

const recommendation: Schema = {
  type: Type.OBJECT,
  properties: {
    category: s(false),
    severity: { type: Type.STRING, enum: ["info", "warning", "critical"] },
    title: s(false),
    detail: s(false),
    suggestedAction: s(false),
  },
  required: ["category", "severity", "title", "detail", "suggestedAction"],
};

const contractData: Schema = {
  type: Type.OBJECT,
  nullable: true,
  properties: {
    contractType: s(),
    partyName: s(),
    counterpartyName: s(),
    scopeSummary: s(),
    totalValue: n(),
    effectiveDate: s(),
    completionDate: s(),
    clauses: { type: Type.ARRAY, items: clause },
    paymentMilestones: { type: Type.ARRAY, items: milestone },
    recommendations: { type: Type.ARRAY, items: recommendation },
  },
  required: [
    "contractType",
    "partyName",
    "counterpartyName",
    "scopeSummary",
    "totalValue",
    "effectiveDate",
    "completionDate",
    "clauses",
    "paymentMilestones",
    "recommendations",
  ],
};

const flag: Schema = {
  type: Type.OBJECT,
  properties: {
    level: { type: Type.STRING, enum: ["info", "warning", "critical"] },
    category: {
      type: Type.STRING,
      enum: [
        "payment",
        "clause_risk",
        "missing_protection",
        "negotiation_tip",
        "follow_up_question",
        "company_match",
        "general",
      ],
    },
    message: s(false),
  },
  required: ["level", "category", "message"],
};

/** Full analysis response schema — passed verbatim as `config.responseSchema`. */
export const ANALYSIS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    classification: {
      type: Type.STRING,
      enum: ["invoice", "contract", "change_order", "estimate", "receipt", "shipping", "general"],
    },
    classificationConfidence: n(false),
    senderCompanyName: s(),
    senderContactName: s(),
    senderContactTitle: s(),
    senderBusinessType: s(),
    senderPhone: s(),
    senderWebsite: s(),
    senderLicenseNumber: s(),
    reviewerFlags: { type: Type.ARRAY, items: flag },
    invoiceData,
    contractData,
  },
  // invoiceData/contractData are nullable but required — the model must emit
  // them explicitly as null when not applicable, matching the AiAnalysis shape.
  required: [
    "classification",
    "classificationConfidence",
    "senderCompanyName",
    "senderContactName",
    "senderContactTitle",
    "senderBusinessType",
    "senderPhone",
    "senderWebsite",
    "senderLicenseNumber",
    "reviewerFlags",
    "invoiceData",
    "contractData",
  ],
};
