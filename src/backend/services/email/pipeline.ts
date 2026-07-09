/**
 * @fileoverview Inbound-email processing pipeline (post-routing).
 *
 * Invoked by `router.ts` after a {@link RouteDecision} has been made. The
 * pipeline is route-aware: the decision's {@link HandlingProfile} controls AI
 * analysis depth, and — for address-based routes — deterministically overrides
 * a low-confidence AI classification (`trustRouteOverAi`).
 *
 * Phases:
 *   0. Idempotency  — skip if this Message-ID was already ingested.
 *   1. Parse + forward detection (peel forward headers → real sender).
 *   2. Persist the email row (with the resolved route + reason).
 *   3. Attachments → R2 + text extraction (PDF via liteparse WASM, DOCX/XLSX
 *      via Workers AI `toMarkdown`).
 *   4. Company matching against the directory.
 *   5. AI classification + extraction (depth per route profile).
 *   6. Route override + downstream invoice/contract persistence.
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
import { parsePdfToMarkdown } from "@backend/services/documents/liteparse";
import { analyzeWithGemini, type AiAnalysis } from "./classify";
import { ROUTE_OVERRIDE_CONFIDENCE_FLOOR } from "./routes";
import type { RouteDecision } from "./types";

/** Arguments handed from the router to the pipeline. */
export interface ProcessEmailArgs {
  messageId: string;
  rawEmail: ArrayBuffer;
  from: string;
  to: string;
  decision: RouteDecision;
  env: Env;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1: Forward detection
// ═══════════════════════════════════════════════════════════════════════════

interface ForwardInfo {
  isForwarded: boolean;
  originalFromAddress: string | null;
  originalFromName: string | null;
  originalDate: string | null;
}

/**
 * Detect forwarded emails by scanning for common forward patterns in the body
 * text, then extract the original sender info from the forward header block.
 */
function detectForward(bodyText: string): ForwardInfo {
  const result: ForwardInfo = {
    isForwarded: false,
    originalFromAddress: null,
    originalFromName: null,
    originalDate: null,
  };

  if (!bodyText) return result;

  const forwardPatterns = [
    /---------- Forwarded message ----------/i,
    /Begin forwarded message/i,
    /-------- Original Message --------/i,
    /> From:/i,
    /Fwd:/i,
  ];

  if (!forwardPatterns.some((p) => p.test(bodyText))) return result;

  result.isForwarded = true;

  // Extract "From:" line from the forward block. Matches e.g.:
  //   From: John Smith <john@example.com>
  //   From: john@example.com
  const fromMatch = bodyText.match(
    /(?:From|De):\s*(?:([^<\n]+?)\s*<([^>]+)>|([^\s<>\n]+@[^\s<>\n]+))/i,
  );
  if (fromMatch) {
    result.originalFromName = fromMatch[1]?.trim() || null;
    result.originalFromAddress = fromMatch[2] || fromMatch[3] || null;
  }

  const dateMatch = bodyText.match(/(?:Date|Sent):\s*(.+?)(?:\n|$)/i);
  if (dateMatch) {
    result.originalDate = dateMatch[1].trim();
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 4: Company matching
// ═══════════════════════════════════════════════════════════════════════════

interface CompanyMatch {
  companyId: number | null;
  confidence: number;
  method: string; // "email_domain" | "name_fuzzy" | "staged"
}

const FREEMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
];

/**
 * Try to match the sender email to an existing company in the directory —
 * exact email, then shared domain (excluding freemail), then fuzzy name.
 */
async function matchCompany(
  senderEmail: string | null,
  senderName: string | null,
  env: Env,
): Promise<CompanyMatch> {
  if (!senderEmail) return { companyId: null, confidence: 0, method: "staged" };

  const db = drizzle(env.DB);
  const domain = senderEmail.split("@")[1]?.toLowerCase();

  // 1. Exact email match.
  const exactMatch = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.email, senderEmail.toLowerCase()))
    .limit(1);
  if (exactMatch.length > 0) {
    return {
      companyId: exactMatch[0].id,
      confidence: 0.95,
      method: "email_domain",
    };
  }

  // 2. Domain match (skip freemail domains — too noisy).
  if (domain && !FREEMAIL_DOMAINS.includes(domain)) {
    const domainMatch = await db
      .select({ id: companies.id })
      .from(companies)
      .where(like(companies.email, `%@${domain}`))
      .limit(1);
    if (domainMatch.length > 0) {
      return {
        companyId: domainMatch[0].id,
        confidence: 0.85,
        method: "email_domain",
      };
    }
  }

  // 3. Fuzzy name match.
  if (senderName) {
    const allCompanies = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.isArchived, false));

    const normalizedSender = senderName.toLowerCase().replace(/[^a-z0-9]/g, "");
    // Guard against an empty normalized sender (e.g. a name that is all
    // punctuation/emoji): "".includes("") and x.includes("") are always true,
    // which would false-positive match the first company in the directory.
    if (normalizedSender) {
      for (const company of allCompanies) {
        if (!company.name) continue;
        const normalizedCompany = company.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        if (
          normalizedCompany.includes(normalizedSender) ||
          normalizedSender.includes(normalizedCompany)
        ) {
          return {
            companyId: company.id,
            confidence: 0.7,
            method: "name_fuzzy",
          };
        }
      }
    }
  }

  return { companyId: null, confidence: 0, method: "staged" };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3: Attachment text extraction
// ═══════════════════════════════════════════════════════════════════════════

interface AttachmentRecord {
  id: number;
  filename: string;
  mimeType: string;
  r2Key: string;
  sizeBytes: number;
}

/**
 * Extract text from PDF/DOCX/XLSX attachments for AI analysis. PDFs use the
 * liteparse WASM path (local, no external call) with a Workers-AI `toMarkdown`
 * fallback; Office docs go straight to `toMarkdown`.
 */
async function extractAttachmentText(
  attachments: AttachmentRecord[],
  env: Env,
): Promise<string> {
  let attachmentText = "";

  for (const att of attachments) {
    const isPdf =
      att.mimeType?.includes("pdf") || att.filename?.endsWith(".pdf");
    const isDoc =
      att.mimeType?.includes("word") ||
      att.mimeType?.includes("officedocument") ||
      att.filename?.match(/\.(docx?|xlsx?)$/i);

    if (isPdf) {
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
        console.error(
          `[email-pipeline] liteparse-wasm failed for ${att.filename}:`,
          err,
        );
        // Fallback to Workers AI toMarkdown if WASM fails.
        try {
          const object = await env.ARTIFACTS_BUCKET.get(att.r2Key);
          if (object) {
            const buf = await object.arrayBuffer();
            const blob = new Blob([buf], { type: att.mimeType });
            const result = await env.AI.toMarkdown({
              name: att.filename,
              blob,
            });
            if (result.format !== "error") {
              attachmentText += `\n\n--- Attachment: ${att.filename} ---\n${result.data}`;
            }
          }
        } catch (fallbackErr) {
          console.error(
            `[email-pipeline] AI.toMarkdown fallback also failed for ${att.filename}:`,
            fallbackErr,
          );
        }
      }
    } else if (isDoc) {
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
        console.error(
          `[email-pipeline] toMarkdown failed for ${att.filename}:`,
          err,
        );
      }
    }
  }

  return attachmentText;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main pipeline
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process a routed inbound email end-to-end. Idempotent on Message-ID.
 */
export async function processEmail(args: ProcessEmailArgs): Promise<void> {
  const { messageId, rawEmail, from, to, decision, env } = args;
  const db = drizzle(env.DB);

  // ── Phase 0: Idempotency guard ───────────────────────────────────────────
  // Email Service can redeliver a message (retries, at-least-once semantics).
  // `worker_emails.message_id` is UNIQUE, so a duplicate insert would throw
  // inside `waitUntil` and be lost. Short-circuit known Message-IDs instead.
  const existing = await db
    .select({ id: workerEmails.id })
    .from(workerEmails)
    .where(eq(workerEmails.messageId, messageId))
    .limit(1);
  if (existing.length > 0) {
    console.log(
      `[email-pipeline] duplicate Message-ID "${messageId}" (row ${existing[0].id}) — skipping`,
    );
    return;
  }

  const parser = new PostalMime();
  const email = await parser.parse(rawEmail);
  const bodyText = email.text || "";

  // ── Phase 1: Forward detection ───────────────────────────────────────────
  const forward = detectForward(bodyText);
  const realSenderEmail = forward.originalFromAddress || from;
  const realSenderName = forward.originalFromName || null;

  // ── Phase 2: Persist the email row (with routing metadata) ───────────────
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
      route: decision.routeId,
      routeReason: decision.reason,
      status: "pending",
    })
    .returning();

  // ── Phase 3: Attachments → R2 ────────────────────────────────────────────
  const attachmentRecords: AttachmentRecord[] = [];
  for (const attachment of email.attachments) {
    if (!attachment.content) continue;

    const filename = attachment.filename || `attachment-${crypto.randomUUID()}`;
    const r2Key = `emails/${insertedEmail.id}/${filename}`;

    await env.ARTIFACTS_BUCKET.put(r2Key, attachment.content, {
      httpMetadata: { contentType: attachment.mimeType },
    });

    const sizeBytes = (attachment.content as ArrayBuffer).byteLength;
    const [record] = await db
      .insert(workerEmailAttachments)
      .values({
        emailId: insertedEmail.id,
        filename,
        mimeType: attachment.mimeType,
        sizeBytes,
        r2Key,
      })
      .returning();

    attachmentRecords.push({
      id: record.id,
      filename,
      mimeType: attachment.mimeType,
      r2Key,
      sizeBytes,
    });
  }

  // ── Phase 4: Company matching ────────────────────────────────────────────
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

  // ── Phase 5: AI classification + extraction (depth per route) ────────────
  const attachmentText = await extractAttachmentText(attachmentRecords, env);

  // Graceful degradation: if the AI call fails outright (e.g. provider auth /
  // outage), do NOT strand the email at "pending". Fall back to the
  // route-derived type so an invoice sent to the invoices mailbox is still
  // recorded + surfaced for manual review, with a critical flag explaining why.
  let analysis: AiAnalysis;
  try {
    analysis = await analyzeWithGemini(
      env,
      decision.profile,
      email.subject || "",
      realSenderEmail,
      bodyText,
      attachmentText,
    );
  } catch (err) {
    console.error(
      `[email-pipeline] AI analysis failed for email ${insertedEmail.id} ` +
        `(route=${decision.routeId}):`,
      err,
    );
    const fallbackType = decision.profile.expectedType ?? "general";
    analysis = {
      classification: fallbackType,
      classificationConfidence: 0,
      senderCompanyName: null,
      senderBusinessType: null,
      senderPhone: null,
      senderWebsite: null,
      senderLicenseNumber: null,
      reviewerFlags: [
        {
          level: "critical",
          category: "general",
          message: `Automated analysis was unavailable (${String(err).slice(
            0,
            200,
          )}). Classified as "${fallbackType}" from the receiving mailbox (${decision.routeId}) — please review manually.`,
        },
      ],
      invoiceData: null,
      contractData: null,
    };
  }

  // ── Phase 6: Route override + reviewer flags ─────────────────────────────
  // Address-based routes carry strong intent. If the classifier is unsure but
  // the route knows the type, trust the route and record why.
  const flags = analysis.reviewerFlags || [];
  let effectiveClassification = analysis.classification;

  if (
    decision.profile.trustRouteOverAi &&
    decision.profile.expectedType &&
    analysis.classificationConfidence < ROUTE_OVERRIDE_CONFIDENCE_FLOOR &&
    analysis.classification !== decision.profile.expectedType
  ) {
    console.log(
      `[email-pipeline] route override: AI="${analysis.classification}" ` +
        `(conf=${analysis.classificationConfidence}) → "${decision.profile.expectedType}" ` +
        `(route=${decision.routeId})`,
    );
    flags.push({
      level: "info",
      category: "general",
      message: `Classified as "${decision.profile.expectedType}" based on the receiving mailbox (${decision.routeId}); the AI was only ${Math.round(
        analysis.classificationConfidence * 100,
      )}% confident on its own.`,
    });
    effectiveClassification = decision.profile.expectedType;
  }

  const updatePayload: Record<string, any> = {
    classification: effectiveClassification,
    classificationConfidence: analysis.classificationConfidence,
    status: "classified",
  };

  // If no company match was found, stage one using AI-extracted info.
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
    flags.push({
      level: "warning",
      category: "company_match",
      message: `Sender "${analysis.senderCompanyName}" (${realSenderEmail}) is not in your contractor directory — staged for review.`,
    });
  }

  updatePayload.aiReviewerFlags = JSON.stringify(flags);

  await db
    .update(workerEmails)
    .set(updatePayload)
    .where(eq(workerEmails.id, insertedEmail.id));

  // ── Downstream: invoice extraction ───────────────────────────────────────
  if (effectiveClassification === "invoice" && analysis.invoiceData) {
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

  // ── Downstream: contract extraction ──────────────────────────────────────
  if (
    (effectiveClassification === "contract" ||
      effectiveClassification === "change_order") &&
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
    `[email-pipeline] processed email ${insertedEmail.id}: ` +
      `route=${decision.routeId}, classification=${effectiveClassification}, ` +
      `company=${companyMatch.companyId || "staged"}, ` +
      `forward=${forward.isForwarded}, flags=${flags.length}`,
  );
}
