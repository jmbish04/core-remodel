/**
 * @fileoverview Inbound email handler — multi-phase AI agent pipeline.
 *
 * Phase 1: Parse + detect forward + extract original sender
 * Phase 2: Company matching (email domain → companies table)
 * Phase 3: AI classification via Gemini (expanded categories + structured extraction)
 * Phase 4: Document extraction (PDF/images via env.AI.toMarkdown + Gemini structured)
 * Phase 5: Reviewer flags (deep contract clause analysis, follow-up questions, risk)
 *
 * PDF parsing uses `env.AI.toMarkdown()` (the Workers-native substitute for
 * @llamaindex/liteparse — see src/backend/services/documents/extraction.ts).
 * Structured LLM calls use @google/genai via Cloudflare AI Gateway.
 */

import PostalMime from "postal-mime";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { workerEmails } from "@backend/db/schema/emails/worker_emails";
import { workerEmailAttachments } from "@backend/db/schema/emails/worker_email_attachments";
import { workerEmailInvoices } from "@backend/db/schema/emails/worker_email_invoices";
import { workerEmailContracts } from "@backend/db/schema/emails/worker_email_contracts";
import { workerEmailStagedCompanies } from "@backend/db/schema/emails/worker_email_staged_companies";
import { companies } from "@backend/db/schema/directory/companies";
import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";
import { parsePdfToMarkdown } from "@backend/services/documents/liteparse";

// ═══════════════════════════════════════════════════════════════════════════
// Public entry point
// ═══════════════════════════════════════════════════════════════════════════

export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
  ctx: ExecutionContext,
) {
  const rawEmail = await new Response(message.raw).arrayBuffer();
  const messageId = message.headers.get("Message-ID") || crypto.randomUUID();

  // Fire-and-forget background processing
  ctx.waitUntil(
    processEmail(messageId, rawEmail, message.from, message.to, env).catch(
      (err) => console.error("[email-handler] processEmail failed:", err),
    ),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1: Parse + Forward Detection
// ═══════════════════════════════════════════════════════════════════════════

interface ForwardInfo {
  isForwarded: boolean;
  originalFromAddress: string | null;
  originalFromName: string | null;
  originalDate: string | null;
}

/**
 * Detect forwarded emails by scanning for common forward patterns in the
 * body text. Extract the original sender info from the forward header block.
 */
function detectForward(bodyText: string): ForwardInfo {
  const result: ForwardInfo = {
    isForwarded: false,
    originalFromAddress: null,
    originalFromName: null,
    originalDate: null,
  };

  if (!bodyText) return result;

  // Common forward header patterns
  const forwardPatterns = [
    /---------- Forwarded message ----------/i,
    /Begin forwarded message/i,
    /-------- Original Message --------/i,
    /> From:/i,
    /Fwd:/i,
  ];

  if (!forwardPatterns.some((p) => p.test(bodyText))) return result;

  result.isForwarded = true;

  // Extract "From:" line from the forward block
  // Matches patterns like:
  //   From: John Smith <john@example.com>
  //   From: john@example.com
  const fromMatch = bodyText.match(
    /(?:From|De):\s*(?:([^<\n]+?)\s*<([^>]+)>|([^\s<>\n]+@[^\s<>\n]+))/i,
  );
  if (fromMatch) {
    result.originalFromName = fromMatch[1]?.trim() || null;
    result.originalFromAddress = fromMatch[2] || fromMatch[3] || null;
  }

  // Extract "Date:" line
  const dateMatch = bodyText.match(
    /(?:Date|Sent):\s*(.+?)(?:\n|$)/i,
  );
  if (dateMatch) {
    result.originalDate = dateMatch[1].trim();
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: Company Matching
// ═══════════════════════════════════════════════════════════════════════════

interface CompanyMatch {
  companyId: number | null;
  confidence: number;
  method: string; // "email_domain" | "name_fuzzy" | "staged"
}

/**
 * Try to match the sender email to an existing company in the directory.
 * Falls back to domain matching, then to AI fuzzy name matching.
 */
async function matchCompany(
  senderEmail: string | null,
  senderName: string | null,
  env: Env,
): Promise<CompanyMatch> {
  if (!senderEmail) return { companyId: null, confidence: 0, method: "staged" };

  const db = drizzle(env.DB);
  const domain = senderEmail.split("@")[1]?.toLowerCase();

  // 1. Exact email match on the companies table
  if (senderEmail) {
    const exactMatch = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.email, senderEmail.toLowerCase()))
      .limit(1);

    if (exactMatch.length > 0) {
      return { companyId: exactMatch[0].id, confidence: 0.95, method: "email_domain" };
    }
  }

  // 2. Domain match — check if any company email shares the same domain
  if (domain && !["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com"].includes(domain)) {
    const domainMatch = await db
      .select({ id: companies.id })
      .from(companies)
      .where(like(companies.email, `%@${domain}`))
      .limit(1);

    if (domainMatch.length > 0) {
      return { companyId: domainMatch[0].id, confidence: 0.85, method: "email_domain" };
    }
  }

  // 3. Fuzzy name match — check if company name appears similar to sender name
  if (senderName) {
    const allCompanies = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.isArchived, false));

    const normalizedSender = senderName.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const company of allCompanies) {
      const normalizedCompany = company.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (
        normalizedCompany.includes(normalizedSender) ||
        normalizedSender.includes(normalizedCompany)
      ) {
        return { companyId: company.id, confidence: 0.7, method: "name_fuzzy" };
      }
    }
  }

  // No match found — will be staged
  return { companyId: null, confidence: 0, method: "staged" };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3: AI Classification + Extraction via Gemini
// ═══════════════════════════════════════════════════════════════════════════

interface AiAnalysis {
  classification: string;
  classificationConfidence: number;
  senderCompanyName: string | null;
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
    invoiceNumber: string | null;
    invoiceDate: string | null;
    dueDate: string | null;
    subtotal: number | null;
    tax: number | null;
    total: number | null;
    lineItems: Array<{ description: string; qty: number; unitPrice: number; total: number }>;
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

const ANALYSIS_PROMPT = `You are an expert construction/renovation project assistant analyzing an email received by a homeowner managing a residential remodel in the San Francisco Bay Area.

Your job is to:
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
    "vendorName": "string",
    "invoiceNumber": "string",
    "invoiceDate": "YYYY-MM-DD",
    "dueDate": "YYYY-MM-DD or null",
    "subtotal": number,
    "tax": number,
    "total": number,
    "lineItems": [{"description": "string", "qty": number, "unitPrice": number, "total": number}]
  },
  "contractData": null or {
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
}

For CONTRACT recommendations, be thorough and adversarial on behalf of the homeowner. Consider:
- Missing protections (lien waivers, warranty, insurance requirements, delay penalties)
- Front-loaded payment schedules (industry standard is milestone-based)
- Vague scope definitions that could lead to disputes
- One-sided cancellation or dispute clauses
- Questions the homeowner should ask before signing
- Terms that should be negotiated (based on Bay Area construction norms)
- Comparison to industry standard practices

EMAIL CONTENT:
Subject: {SUBJECT}
From: {FROM}
Date: {DATE}
Body:
{BODY}

{ATTACHMENT_TEXT}`;

async function analyzeWithGemini(
  env: Env,
  subject: string,
  from: string,
  bodyText: string,
  attachmentText: string,
): Promise<AiAnalysis> {
  const ai = await createGeminiAiGatewayClient(env);

  const prompt = ANALYSIS_PROMPT
    .replace("{SUBJECT}", subject || "No Subject")
    .replace("{FROM}", from)
    .replace("{DATE}", new Date().toISOString())
    .replace("{BODY}", (bodyText || "").slice(0, 8000))
    .replace(
      "{ATTACHMENT_TEXT}",
      attachmentText
        ? `ATTACHMENT CONTENT (extracted text):\n${attachmentText.slice(0, 16000)}`
        : "",
    );

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const rawText = response.text || "";

  try {
    // Strip markdown code fences if present
    const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as AiAnalysis;
  } catch (err) {
    console.error("[email-handler] Failed to parse Gemini response:", err, rawText.slice(0, 500));
    return {
      classification: "general",
      classificationConfidence: 0.3,
      senderCompanyName: null,
      senderBusinessType: null,
      senderPhone: null,
      senderWebsite: null,
      senderLicenseNumber: null,
      reviewerFlags: [
        {
          level: "warning",
          category: "general",
          message: "AI analysis could not fully parse this email — manual review recommended.",
        },
      ],
      invoiceData: null,
      contractData: null,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Pipeline
// ═══════════════════════════════════════════════════════════════════════════

async function processEmail(
  messageId: string,
  rawEmail: ArrayBuffer,
  from: string,
  to: string,
  env: Env,
) {
  const db = drizzle(env.DB);
  const parser = new PostalMime();

  const email = await parser.parse(rawEmail);
  const bodyText = email.text || "";

  // ── Phase 1: Detect forward ──────────────────────────────────────────
  const forward = detectForward(bodyText);

  // The "real" sender is the original sender in a forward, or the envelope sender
  const realSenderEmail = forward.originalFromAddress || from;
  const realSenderName = forward.originalFromName || null;

  // ── Insert email row ─────────────────────────────────────────────────
  const [insertedEmail] = await db
    .insert(workerEmails)
    .values({
      messageId,
      fromAddress: from,
      toAddress: to,
      subject: email.subject || "No Subject",
      bodyText,
      bodyHtml: email.html || "",
      rawHeaders: JSON.stringify(
        email.headers.reduce((acc: Record<string, string>, h: any) => {
          acc[h.key] = h.value;
          return acc;
        }, {}),
      ),
      isForwarded: forward.isForwarded,
      originalFromAddress: forward.originalFromAddress,
      originalFromName: forward.originalFromName,
      originalDate: forward.originalDate,
      status: "pending",
    })
    .returning();

  // ── Process attachments ──────────────────────────────────────────────
  const attachmentRecords: Array<{ id: number; filename: string; mimeType: string; r2Key: string; sizeBytes: number }> = [];

  for (const attachment of email.attachments) {
    if (!attachment.content) continue;

    const filename = attachment.filename || `attachment-${crypto.randomUUID()}`;
    const r2Key = `emails/${insertedEmail.id}/${filename}`;

    await env.ARTIFACTS_BUCKET.put(r2Key, attachment.content, {
      httpMetadata: { contentType: attachment.mimeType },
    });

    const [record] = await db
      .insert(workerEmailAttachments)
      .values({
        emailId: insertedEmail.id,
        filename,
        mimeType: attachment.mimeType,
        sizeBytes: (attachment.content as ArrayBuffer).byteLength,
        r2Key,
      })
      .returning();

    attachmentRecords.push({ ...record, filename, mimeType: attachment.mimeType, r2Key, sizeBytes: (attachment.content as ArrayBuffer).byteLength });
  }

  // ── Phase 2: Company matching ────────────────────────────────────────
  const companyMatch = await matchCompany(realSenderEmail, realSenderName, env);

  if (companyMatch.companyId) {
    await db
      .update(workerEmails)
      .set({
        matchedCompanyId: companyMatch.companyId,
        companyMatchConfidence: companyMatch.confidence,
        companyMatchMethod: companyMatch.method,
      })
      .where(eq(workerEmails.id, insertedEmail.id));
  }

  // ── Extract text from PDF/doc attachments for AI analysis ────────────
  // PDFs: liteparse-wasm (local WASM, no external API call)
  // DOCX/XLSX: env.AI.toMarkdown() (Workers AI binding)
  let attachmentText = "";
  for (const att of attachmentRecords) {
    const isPdf = att.mimeType?.includes("pdf") || att.filename?.endsWith(".pdf");
    const isDoc =
      att.mimeType?.includes("word") ||
      att.mimeType?.includes("officedocument") ||
      att.filename?.match(/\.(docx?|xlsx?)$/i);

    if (isPdf) {
      // ── LiteParse WASM — local PDF parsing in the isolate ─────────
      try {
        const object = await env.ARTIFACTS_BUCKET.get(att.r2Key);
        if (object) {
          const buf = await object.arrayBuffer();
          const markdown = await parsePdfToMarkdown(buf);
          if (markdown) {
            attachmentText += `\n\n--- Attachment: ${att.filename} ---\n${markdown}`;
          }
        }
      } catch (err) {
        console.error(`[email-handler] liteparse-wasm failed for ${att.filename}:`, err);
        // Fallback to Workers AI toMarkdown if WASM fails
        try {
          const object = await env.ARTIFACTS_BUCKET.get(att.r2Key);
          if (object) {
            const buf = await object.arrayBuffer();
            const blob = new Blob([buf], { type: att.mimeType });
            const result = await env.AI.toMarkdown({ name: att.filename, blob });
            if (result.format !== "error") {
              attachmentText += `\n\n--- Attachment: ${att.filename} ---\n${result.data}`;
            }
          }
        } catch (fallbackErr) {
          console.error(`[email-handler] AI.toMarkdown fallback also failed for ${att.filename}:`, fallbackErr);
        }
      }
    } else if (isDoc) {
      // ── DOCX/XLSX — use Workers AI toMarkdown ─────────────────────
      try {
        const object = await env.ARTIFACTS_BUCKET.get(att.r2Key);
        if (object) {
          const buf = await object.arrayBuffer();
          const blob = new Blob([buf], { type: att.mimeType });
          const result = await env.AI.toMarkdown({ name: att.filename, blob });
          if (result.format !== "error") {
            attachmentText += `\n\n--- Attachment: ${att.filename} ---\n${result.data}`;
          }
        }
      } catch (err) {
        console.error(`[email-handler] toMarkdown failed for ${att.filename}:`, err);
      }
    }
  }

  // ── Phase 3 + 4 + 5: AI analysis via Gemini ─────────────────────────
  const analysis = await analyzeWithGemini(
    env,
    email.subject || "",
    realSenderEmail,
    bodyText,
    attachmentText,
  );

  // ── Update email with classification + flags ─────────────────────────
  const updatePayload: Record<string, any> = {
    classification: analysis.classification,
    classificationConfidence: analysis.classificationConfidence,
    aiReviewerFlags: JSON.stringify(analysis.reviewerFlags || []),
    status: "classified",
  };

  // If no company match was found, stage one using AI-extracted info
  if (!companyMatch.companyId && analysis.senderCompanyName) {
    await db.insert(workerEmailStagedCompanies).values({
      emailId: insertedEmail.id,
      suggestedName: analysis.senderCompanyName,
      suggestedEmail: realSenderEmail,
      suggestedPhone: analysis.senderPhone,
      suggestedWebsite: analysis.senderWebsite,
      suggestedBusinessType: analysis.senderBusinessType,
      suggestedLicenseNumber: analysis.senderLicenseNumber,
      status: "staged",
    });

    updatePayload.companyMatchMethod = "staged";

    // Add a reviewer flag about the unmatched company
    const flags = analysis.reviewerFlags || [];
    flags.push({
      level: "warning",
      category: "company_match",
      message: `Sender "${analysis.senderCompanyName}" (${realSenderEmail}) is not in your contractor directory — staged for review.`,
    });
    updatePayload.aiReviewerFlags = JSON.stringify(flags);
  }

  await db
    .update(workerEmails)
    .set(updatePayload)
    .where(eq(workerEmails.id, insertedEmail.id));

  // ── Store invoice extraction ─────────────────────────────────────────
  if (analysis.classification === "invoice" && analysis.invoiceData) {
    const inv = analysis.invoiceData;
    await db.insert(workerEmailInvoices).values({
      emailId: insertedEmail.id,
      attachmentId: attachmentRecords[0]?.id || null,
      vendorName: inv.vendorName,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      subtotal: inv.subtotal,
      tax: inv.tax,
      total: inv.total,
      lineItemsJson: JSON.stringify(inv.lineItems || []),
      extractedRawJson: JSON.stringify(analysis),
      confidence: analysis.classificationConfidence,
      status: "draft",
    });

    await db
      .update(workerEmails)
      .set({ status: "processed" })
      .where(eq(workerEmails.id, insertedEmail.id));
  }

  // ── Store contract extraction ────────────────────────────────────────
  if (
    (analysis.classification === "contract" || analysis.classification === "change_order") &&
    analysis.contractData
  ) {
    const c = analysis.contractData;
    await db.insert(workerEmailContracts).values({
      emailId: insertedEmail.id,
      attachmentId: attachmentRecords[0]?.id || null,
      contractType: c.contractType,
      partyName: c.partyName,
      counterpartyName: c.counterpartyName,
      scopeSummary: c.scopeSummary,
      totalValue: c.totalValue,
      effectiveDate: c.effectiveDate,
      completionDate: c.completionDate,
      clausesJson: JSON.stringify(c.clauses || []),
      paymentMilestonesJson: JSON.stringify(c.paymentMilestones || []),
      aiRecommendationsJson: JSON.stringify(c.recommendations || []),
      extractedRawJson: JSON.stringify(analysis),
      confidence: analysis.classificationConfidence,
      status: "draft",
    });

    await db
      .update(workerEmails)
      .set({ status: "processed" })
      .where(eq(workerEmails.id, insertedEmail.id));
  }

  console.log(
    `[email-handler] Processed email ${insertedEmail.id}: ` +
      `classification=${analysis.classification}, ` +
      `company=${companyMatch.companyId || "staged"}, ` +
      `forward=${forward.isForwarded}, ` +
      `flags=${(analysis.reviewerFlags || []).length}`,
  );
}
