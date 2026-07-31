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
import { workerEmailInvoiceLineItems } from "@backend/db/schema/emails/worker_email_invoice_line_items";
import { workerEmailContracts } from "@backend/db/schema/emails/worker_email_contracts";
import { workerEmailStagedCompanies } from "@backend/db/schema/emails/worker_email_staged_companies";
import { companies } from "@backend/db/schema/directory/companies";
import { analyzeWithGemini, type AiAnalysis } from "./classify";
import { isHealthcheckSubject } from "@backend/services/health/email-loopback-markers";
import { registerShowroomContactFromEmail } from "./showroom-contact-autopopulate";
import {
  buildMatchContext,
  CATCH_ALL_PROFILE,
  resolveRoute,
  ROUTE_OVERRIDE_CONFIDENCE_FLOOR,
} from "./routes";
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
  /** Non-AI extracted text (0042) — set by runNonAiExtraction. */
  extractedText?: string | null;
  /** 0042: "extracted" | "needs_ai_ocr" | "none". */
  ocrStatus?: string;
}

/**
 * Classify an attachment for non-AI extraction (0042), pure. `document` →
 * deterministic `toMarkdown` text; `image` → needs a vision model (gated by
 * approval); `none` → not text-bearing.
 */
export function attachmentExtractionKind(
  mimeType: string | undefined | null,
  filename: string | undefined | null,
): "document" | "image" | "none" {
  const mt = mimeType ?? "";
  const fn = filename ?? "";
  const isPdf = mt.includes("pdf") || /\.pdf$/i.test(fn);
  const isDoc =
    mt.includes("word") || mt.includes("officedocument") || /\.(docx?|xlsx?)$/i.test(fn);
  if (isPdf || isDoc) return "document";
  if (mt.startsWith("image/")) return "image";
  return "none";
}

/**
 * NON-AI attachment text extraction (0042). PDF/DOCX/XLSX go through Workers AI
 * `env.AI.toMarkdown` — which for these document types is a DETERMINISTIC,
 * library-based conversion (no LLM/vision), the canonical Workers path for
 * document text (see services/documents/health.ts). Images cannot be OCR'd
 * without a vision model, so they are flagged `needs_ai_ocr` and left for the
 * approval-gated AI pass. Persists `extracted_text` + `ocr_status` and mutates
 * each record in place so the (deferred or immediate) AI pass can read the text
 * without re-fetching from R2.
 */
async function runNonAiExtraction(
  db: ReturnType<typeof drizzle>,
  env: Env,
  attachments: AttachmentRecord[],
): Promise<void> {
  for (const att of attachments) {
    const kind = attachmentExtractionKind(att.mimeType, att.filename);

    let extractedText: string | null = null;
    let ocrStatus = "none";

    if (kind === "document") {
      try {
        const object = await env.ARTIFACTS_BUCKET.get(att.r2Key);
        if (object) {
          const buf = await object.arrayBuffer();
          const blob = new Blob([buf], { type: att.mimeType });
          const result = await env.AI.toMarkdown({ name: att.filename, blob });
          if (result.format !== "error") extractedText = result.data;
        }
      } catch (err) {
        console.error(`[email-pipeline] toMarkdown failed for ${att.filename}:`, err);
      }
      ocrStatus = extractedText ? "extracted" : "none";
    } else if (kind === "image") {
      ocrStatus = "needs_ai_ocr";
    }

    att.extractedText = extractedText;
    att.ocrStatus = ocrStatus;
    try {
      await db
        .update(workerEmailAttachments)
        .set({ extractedText, ocrStatus })
        .where(eq(workerEmailAttachments.id, att.id));
    } catch (err) {
      // Persistence of derived text must never abort the pipeline (the in-memory
      // record still carries the text for this run's AI pass).
      console.error(`[email-pipeline] persist extracted_text failed for attachment ${att.id}:`, err);
    }
  }
}

/** Combine already-extracted attachment text into the AI prompt input. */
function buildAttachmentText(attachments: AttachmentRecord[]): string {
  return attachments
    .filter((a) => a.extractedText && a.extractedText.trim() !== "")
    .map((a) => `\n\n--- Attachment: ${a.filename} ---\n${a.extractedText}`)
    .join("");
}

/**
 * Best-effort embedding of email body + extracted attachment text into
 * Vectorize (0042) — non-interpretive (bge-large), safe to auto-run so the doc
 * is search/RAG-ready. Never throws into the pipeline.
 */
async function embedEmailContent(env: Env, emailId: number, text: string): Promise<void> {
  const clean = (text ?? "").trim();
  if (!clean) return;
  const chunks: string[] = [];
  for (let i = 0; i < clean.length && chunks.length < 10; i += 1000) {
    chunks.push(clean.slice(i, i + 1000));
  }
  try {
    const result = (await env.AI.run("@cf/baai/bge-large-en-v1.5", {
      text: chunks,
      gateway: { id: env.AI_GATEWAY_ID },
    } as Parameters<typeof env.AI.run>[1])) as { data: number[][] };
    const vectors = (result.data ?? [])
      .map((values, i) => ({
        id: `email:${emailId}:${i}`,
        values,
        metadata: { kind: "worker_email", email_id: emailId },
      }))
      .filter((v) => Array.isArray(v.values) && v.values.length > 0);
    if (vectors.length > 0) await env.VECTOR_INDEX.upsert(vectors);
  } catch (err) {
    console.error(`[email-pipeline] embedding failed for email ${emailId}:`, err);
  }
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
      source: decision.source ?? "worker",
      // Explicit (never rely on the fail-closed default): trusted worker email
      // runs AI inline; Gmail defers to pending_approval.
      aiStatus: decision.deferAiUntilApproval ? "pending_approval" : "auto_done",
    })
    .returning();

  // ── Health-check short-circuit ───────────────────────────────────────────
  // The email-loopback probe sends itself mail (subject prefix). We only need
  // the row + its verbatim body for the round-trip probe to verify extraction —
  // storing it is the whole point, but running the AI classifier on it would
  // burn model spend and pollute the invoice/contract tables. Mark it done and
  // stop. (The loopback state machine deletes this row once the cycle finishes.)
  if (isHealthcheckSubject(email.subject)) {
    await db
      .update(workerEmails)
      .set({ status: "processed" })
      .where(eq(workerEmails.id, insertedEmail.id));
    return;
  }

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

  // ── Phase 4.5: NON-AI extraction + embeddings (0042) ─────────────────────
  // Always runs — no interpretation, so it's safe on untrusted (Gmail) mail and
  // leaves the doc text-extracted + vector-indexed and "ready to go".
  await runNonAiExtraction(db, env, attachmentRecords);
  await embedEmailContent(env, insertedEmail.id, `${bodyText}${buildAttachmentText(attachmentRecords)}`);

  // ── AI trust gate (0042) ─────────────────────────────────────────────────
  // Gmail-sourced mail defers the AI extraction until a human approves it (see
  // RouteDecision.deferAiUntilApproval). Trusted worker email runs AI inline.
  if (decision.deferAiUntilApproval) {
    // ai_status was already set to pending_approval at insert; stop before AI.
    return;
  }

  await analyzeAndPersist({
    db,
    env,
    emailId: insertedEmail.id,
    decision,
    subject: email.subject || "",
    realSenderEmail,
    realSenderName,
    bodyText,
    attachments: attachmentRecords,
    companyMatch,
    listUnsubscribe: email.headers.some(
      (h: { key: string }) => h.key.toLowerCase() === "list-unsubscribe",
    ),
  });
}


/**
 * Context an analysis pass needs, independent of how the email arrived.
 *
 * Split out from {@link processEmail} so the same phases can run again later
 * against an already-persisted row — an extraction that failed (bad prompt,
 * provider outage, truncated body) used to be permanently stuck, because the
 * only path into analysis was a live inbound message that cannot be replayed.
 */
export interface AnalyzeArgs {
  db: ReturnType<typeof drizzle>;
  env: Env;
  emailId: number;
  decision: RouteDecision;
  subject: string;
  realSenderEmail: string;
  realSenderName: string | null;
  bodyText: string;
  attachments: AttachmentRecord[];
  companyMatch: { companyId: number | null };
  /** True when the inbound message carried a `List-Unsubscribe` header (bulk mail). */
  listUnsubscribe?: boolean;
}

/**
 * Phases 5-6 plus downstream persistence: classify, extract, stage a company,
 * and materialize invoice/receipt line items.
 *
 * Idempotent enough to re-run: callers that re-analyze an email should clear
 * its prior invoice/contract rows first (see {@link reprocessEmail}).
 */
export async function analyzeAndPersist(args: AnalyzeArgs): Promise<void> {
  const {
    db, env, emailId, decision, subject,
    realSenderEmail, realSenderName, bodyText, attachments, companyMatch, listUnsubscribe,
  } = args;
  // ── Phase 5: AI classification + extraction (depth per route) ────────────
  // Text was extracted (non-AI) in processEmail Phase 4.5 and stored on the
  // records. Fall back to extracting now if a caller passed un-extracted records
  // (e.g. an older reprocess path) so analysis never loses attachment context.
  if (attachments.some((a) => a.extractedText === undefined)) {
    await runNonAiExtraction(db, env, attachments);
  }
  const attachmentText = buildAttachmentText(attachments);

  // Graceful degradation: if the AI call fails outright (e.g. provider auth /
  // outage), do NOT strand the email at "pending". Fall back to the
  // route-derived type so an invoice sent to the invoices mailbox is still
  // recorded + surfaced for manual review, with a critical flag explaining why.
  let analysis: AiAnalysis;
  try {
    analysis = await analyzeWithGemini(
      env,
      decision.profile,
      subject,
      realSenderEmail,
      bodyText,
      attachmentText,
    );
  } catch (err) {
    console.error(
      `[email-pipeline] AI analysis failed for email ${emailId} ` +
        `(route=${decision.routeId}):`,
      err,
    );
    const fallbackType = decision.profile.expectedType ?? "general";
    analysis = {
      classification: fallbackType,
      classificationConfidence: 0,
      senderCompanyName: null,
      senderContactTitle: null,
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
      emailId: emailId,
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

  // ── Showroom contact auto-population ─────────────────────────────────────
  // Only when the sender did NOT match a directory company: register a showroom
  // contact from the signature — mapped to a showroom by domain/name, else saved
  // as a draft for the HITL inbox to map. Never breaks classification.
  if (!companyMatch.companyId) {
    try {
      await registerShowroomContactFromEmail(
        {
          senderEmail: realSenderEmail,
          // The From-header display name — the deterministic gate uses this (plus
          // the body signature) to identify a real person. NEVER the company.
          fromDisplayName: realSenderName,
          contactTitle: analysis.senderContactTitle,
          companyName: analysis.senderCompanyName,
          senderPhone: analysis.senderPhone,
          senderWebsite: analysis.senderWebsite,
          bodyText,
          listUnsubscribe,
        },
        env,
      );
    } catch (err) {
      console.error("[email-pipeline] showroom contact auto-populate failed:", err);
    }
  }

  await db
    .update(workerEmails)
    .set(updatePayload)
    .where(eq(workerEmails.id, emailId));

  // ── Downstream: invoice / receipt extraction + line-item staging ─────────
  // Both invoices (bills to pay) and receipts (completed purchases) carry line
  // items a reviewer links to the materials schedule. We persist the header AND
  // materialize each line item as an `unmatched` row so the HITL inbox can
  // link / create / skip it against `material_schedule_items`.
  if (
    (effectiveClassification === "invoice" ||
      effectiveClassification === "receipt") &&
    analysis.invoiceData
  ) {
    const inv = analysis.invoiceData;
    const [insertedInvoice] = await db
      .insert(workerEmailInvoices)
      .values({
        emailId: emailId,
        attachmentId: attachments[0]?.id || null,
        kind: effectiveClassification === "receipt" ? "receipt" : "invoice",
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
      })
      .returning();

    // Stage each extracted line item as an unmatched row pending a material link.
    // Chunk the insert: D1 caps a query at 100 bound parameters and each row
    // binds 6 columns, so a single multi-row INSERT of >16 rows would exceed it
    // (a big receipt can have many line items).
    const lineItems = inv.lineItems || [];
    if (insertedInvoice && lineItems.length > 0) {
      const rows = lineItems.map((li) => ({
        invoiceId: insertedInvoice.id,
        description: li.description ?? null,
        quantity: typeof li.qty === "number" ? li.qty : null,
        unitPrice: typeof li.unitPrice === "number" ? li.unitPrice : null,
        lineTotal: typeof li.total === "number" ? li.total : null,
        matchStatus: "unmatched",
      }));
      // Insert via chunked db.batch of single-row statements — the repo's D1
      // bulk-write convention; each statement stays well under D1's 100
      // bound-parameter cap regardless of how many line items a receipt has.
      const BATCH = 50;
      for (let i = 0; i < rows.length; i += BATCH) {
        const stmts = rows
          .slice(i, i + BATCH)
          .map((row) => db.insert(workerEmailInvoiceLineItems).values(row));
        await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
      }
    }

    await db
      .update(workerEmails)
      .set({ status: "processed" })
      .where(eq(workerEmails.id, emailId));

    // ── Material-room deduction (0030) ─────────────────────────────────────
    // Only when line items were actually created: promote each unmatched line
    // to a typed material and stage a room proposal (auto-confirming the
    // unambiguous ones). Best-effort — a deduction failure must never break
    // email processing, mirroring the showroom-contact guard above.
    if (lineItems.length > 0) {
      try {
        const { stageProposalsForReceipt } = await import(
          "@backend/services/materials/deduction"
        );
        const res = await stageProposalsForReceipt(db, env, emailId);
        console.log(
          `[email-pipeline] deduction for email ${emailId}: ` +
            `staged=${res.staged}, auto=${res.autoConfirmed}, skipped=${res.skipped}`,
        );
      } catch (err) {
        console.error(
          `[email-pipeline] material-room deduction failed for email ${emailId}:`,
          err,
        );
      }
    }
  }

  // ── Downstream: contract extraction ──────────────────────────────────────
  if (
    (effectiveClassification === "contract" ||
      effectiveClassification === "change_order") &&
    analysis.contractData
  ) {
    const c = analysis.contractData;
    await db.insert(workerEmailContracts).values({
      emailId: emailId,
      attachmentId: attachments[0]?.id || null,
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
      .where(eq(workerEmails.id, emailId));
  }

  console.log(
    `[email-pipeline] processed email ${emailId}: ` +
      `route=${decision.routeId}, classification=${effectiveClassification}, ` +
      `company=${companyMatch.companyId || "staged"}, ` +
      `flags=${flags.length}`,
  );
}

/**
 * Re-run analysis + extraction against an email already stored in D1.
 *
 * Inbound processing is one-shot: {@link processEmail} consumes a live message
 * that cannot be replayed, so an email whose extraction failed — a truncated
 * body, a provider outage, a prompt bug — stayed stuck forever with no way to
 * recover it short of asking the sender to send it again.
 *
 * That is not hypothetical. Three Costco receipts sat classified but with zero
 * extracted line items because the prompt truncated the body 98 characters
 * before the order summary; the fix was one line, but nothing could re-drive
 * the fixed code over the stored rows.
 *
 * Prior invoice/contract/staged-company rows for the email are deleted first so
 * a re-run REPLACES its output instead of accumulating duplicate line items on
 * every attempt. Line items cascade from `worker_email_invoices`.
 *
 * @param db     Drizzle client.
 * @param env    Worker env (AI + R2 bindings).
 * @param emailId `worker_emails.id` to re-analyze.
 * @returns The classification recorded, or null if the email does not exist.
 */
export async function reprocessEmail(
  db: ReturnType<typeof drizzle>,
  env: Env,
  emailId: number,
): Promise<{ classification: string | null; invoiceCount: number } | null> {
  const [email] = await db
    .select()
    .from(workerEmails)
    .where(eq(workerEmails.id, emailId))
    .limit(1);
  if (!email) return null;

  const attachments = await db
    .select()
    .from(workerEmailAttachments)
    .where(eq(workerEmailAttachments.emailId, emailId));

  // Clear prior derived rows so a re-run replaces rather than duplicates.
  //
  // Line items are NOT deleted explicitly: `worker_email_invoice_line_items`
  // declares `onDelete: "cascade"` on its invoice FK and D1 reports
  // `PRAGMA foreign_keys = 1`, so removing the invoice removes them. Verified
  // rather than assumed — inserting an invoice with 2 line items and deleting
  // only the invoice leaves 0 line items behind.
  //
  // Staged companies are re-created by the analysis pass when the sender still
  // matches nothing in the directory.
  await db.batch([
    db.delete(workerEmailInvoices).where(eq(workerEmailInvoices.emailId, emailId)),
    db.delete(workerEmailContracts).where(eq(workerEmailContracts.emailId, emailId)),
    db.delete(workerEmailStagedCompanies).where(eq(workerEmailStagedCompanies.emailId, emailId)),
  ]);

  // Re-derive the route from the stored recipient so the same handling profile
  // (expected type, analysis depth) applies as on first receipt.
  const ctx = buildMatchContext(
    email.toAddress || "",
    email.fromAddress || "",
    email.subject || "",
  );
  // resolveRoute returns null for a recipient we do not own. The email is
  // already stored, so re-analysis must still be possible — fall back to the
  // catch-all profile (AI-driven classification, no route intent).
  const decision: RouteDecision = resolveRoute(ctx) ?? {
    routeId: "general",
    reason: "reprocess: original recipient no longer matches a known route",
    profile: CATCH_ALL_PROFILE,
  };

  await analyzeAndPersist({
    db,
    env,
    emailId,
    decision,
    subject: email.subject || "",
    realSenderEmail: email.originalFromAddress || email.fromAddress || "",
    realSenderName: email.originalFromName || null,
    bodyText: email.bodyText || "",
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename || "",
      mimeType: a.mimeType || "",
      r2Key: a.r2Key,
      sizeBytes: a.sizeBytes ?? 0,
    })),
    companyMatch: { companyId: email.matchedCompanyId ?? null },
  });

  const [after] = await db
    .select()
    .from(workerEmails)
    .where(eq(workerEmails.id, emailId))
    .limit(1);
  const invoices = await db
    .select({ id: workerEmailInvoices.id })
    .from(workerEmailInvoices)
    .where(eq(workerEmailInvoices.emailId, emailId));

  return { classification: after?.classification ?? null, invoiceCount: invoices.length };
}
