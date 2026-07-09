import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { workerEmails } from "@backend/db/schema/emails/worker_emails";
import { workerEmailAttachments } from "@backend/db/schema/emails/worker_email_attachments";
import { workerEmailInvoices } from "@backend/db/schema/emails/worker_email_invoices";
import { workerEmailInvoiceLineItems } from "@backend/db/schema/emails/worker_email_invoice_line_items";
import { workerEmailStagedCompanies } from "@backend/db/schema/emails/worker_email_staged_companies";
import { workerEmailContracts } from "@backend/db/schema/emails/worker_email_contracts";
import { companies } from "@backend/db/schema/directory/companies";
import { materialScheduleItems } from "@backend/db/schema/materials/schedule_item";

export const workerEmailsRouter = new Hono<{ Bindings: Env }>();

/** Build a human-readable purchase note recorded on a linked material. */
function buildPurchaseNote(
  invoice: { vendorName?: string | null; invoiceDate?: string | null } | undefined,
  lineItem: { lineTotal?: number | null },
): string {
  const vendor = invoice?.vendorName || "unknown vendor";
  const date = invoice?.invoiceDate || "";
  const price =
    typeof lineItem?.lineTotal === "number" ? `$${lineItem.lineTotal.toFixed(2)}` : "";
  const parts = [`Purchased from ${vendor}`];
  if (price) parts.push(price);
  if (date) parts.push(`on ${date}`);
  return `${parts.join(" ")} (via email receipt).`;
}

/** Append a note line to an existing (possibly null) notes field. */
function appendNote(existing: string | null | undefined, addition: string): string {
  return existing && existing.trim() ? `${existing}\n${addition}` : addition;
}

// ═══════════════════════════════════════════════════════════════════════════
// Email CRUD
// ═══════════════════════════════════════════════════════════════════════════

workerEmailsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const status = c.req.query("status");
  const classification = c.req.query("classification");

  const conditions = [];
  if (status) conditions.push(eq(workerEmails.status, status));
  if (classification) conditions.push(eq(workerEmails.classification, classification));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const emails = await db
    .select()
    .from(workerEmails)
    .where(whereClause)
    .orderBy(desc(workerEmails.createdAt))
    .limit(50);

  return c.json({ emails });
});

workerEmailsRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = parseInt(c.req.param("id"));

  const [email] = await db
    .select()
    .from(workerEmails)
    .where(eq(workerEmails.id, id))
    .limit(1);
  if (!email) return c.json({ error: "Email not found" }, 404);

  const attachments = await db
    .select()
    .from(workerEmailAttachments)
    .where(eq(workerEmailAttachments.emailId, id));

  const invoices = await db
    .select()
    .from(workerEmailInvoices)
    .where(eq(workerEmailInvoices.emailId, id));

  const invoicesWithLines = await Promise.all(
    invoices.map(async (invoice: (typeof invoices)[number]) => {
      const lineItems = await db
        .select()
        .from(workerEmailInvoiceLineItems)
        .where(eq(workerEmailInvoiceLineItems.invoiceId, invoice.id));
      return { ...invoice, lineItems };
    }),
  );

  const contracts = await db
    .select()
    .from(workerEmailContracts)
    .where(eq(workerEmailContracts.emailId, id));

  const [stagedCompany] = await db
    .select()
    .from(workerEmailStagedCompanies)
    .where(eq(workerEmailStagedCompanies.emailId, id))
    .limit(1);

  let matchedCompany = null;
  if (email.matchedCompanyId) {
    const [mc] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, email.matchedCompanyId))
      .limit(1);
    matchedCompany = mc || null;
  }

  return c.json({
    email,
    attachments,
    invoices: invoicesWithLines,
    contracts,
    stagedCompany: stagedCompany || null,
    matchedCompany,
    reviewerFlags: email.aiReviewerFlags ? JSON.parse(email.aiReviewerFlags) : [],
  });
});

workerEmailsRouter.patch("/:id/status", async (c) => {
  const db = drizzle(c.env.DB);
  const id = parseInt(c.req.param("id"));

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const statusSchema = z.object({
    status: z.string(),
    reviewNotes: z.string().optional().nullable(),
  });

  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const { status, reviewNotes } = parsed.data;

  const [updated] = await db
    .update(workerEmails)
    .set({ status, reviewNotes, reviewedAt: new Date() })
    .where(eq(workerEmails.id, id))
    .returning();

  return c.json({ email: updated });
});

// ═══════════════════════════════════════════════════════════════════════════
// Attachments
// ═══════════════════════════════════════════════════════════════════════════

workerEmailsRouter.get("/:id/attachments/:attachmentId/download", async (c) => {
  const db = drizzle(c.env.DB);
  const attachmentId = parseInt(c.req.param("attachmentId"));

  const [attachment] = await db
    .select()
    .from(workerEmailAttachments)
    .where(eq(workerEmailAttachments.id, attachmentId))
    .limit(1);
  if (!attachment) return c.json({ error: "Attachment not found" }, 404);

  const object = await c.env.ARTIFACTS_BUCKET.get(attachment.r2Key);
  if (!object) return c.json({ error: "File not found in R2" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  const safeFilename = encodeURIComponent(attachment.filename || "attachment");
  headers.set("Content-Disposition", "inline; filename*=UTF-8''" + safeFilename);

  return new Response(object.body, { headers });
});

// ═══════════════════════════════════════════════════════════════════════════
// Invoices (HITL)
// ═══════════════════════════════════════════════════════════════════════════

workerEmailsRouter.patch("/:id/invoices/:invoiceId", async (c) => {
  const db = drizzle(c.env.DB);
  const invoiceId = parseInt(c.req.param("invoiceId"));
  const updates = await c.req.json();

  const [updated] = await db
    .update(workerEmailInvoices)
    .set({
      vendorName: updates.vendorName,
      invoiceNumber: updates.invoiceNumber,
      invoiceDate: updates.invoiceDate,
      dueDate: updates.dueDate,
      subtotal: updates.subtotal,
      tax: updates.tax,
      total: updates.total,
      notes: updates.notes,
      updatedAt: new Date(),
    })
    .where(eq(workerEmailInvoices.id, invoiceId))
    .returning();

  return c.json({ invoice: updated });
});

workerEmailsRouter.post("/:id/invoices/:invoiceId/confirm", async (c) => {
  const db = drizzle(c.env.DB);
  const invoiceId = parseInt(c.req.param("invoiceId"));

  const [updated] = await db
    .update(workerEmailInvoices)
    .set({ status: "confirmed", confirmedAt: new Date(), confirmedBy: "Admin" })
    .where(eq(workerEmailInvoices.id, invoiceId))
    .returning();

  return c.json({ invoice: updated });
});

workerEmailsRouter.post("/:id/invoices/:invoiceId/reject", async (c) => {
  const db = drizzle(c.env.DB);
  const invoiceId = parseInt(c.req.param("invoiceId"));

  const [updated] = await db
    .update(workerEmailInvoices)
    .set({ status: "rejected" })
    .where(eq(workerEmailInvoices.id, invoiceId))
    .returning();

  return c.json({ invoice: updated });
});

// ═══════════════════════════════════════════════════════════════════════════
// Line Items → Material Schedule linking (HITL)
//
// Each invoice/receipt line item is materialized as an `unmatched` row at
// ingest. The reviewer resolves it to the materials schedule one of three ways:
//   link            → attach to an EXISTING material_schedule_item
//   create-material → create a NEW material from the line item, then attach
//   skip            → dismiss (not a trackable material)
// Linking a receipt line item marks the material as purchased and records the
// vendor / price / date in the material's notes.
// ═══════════════════════════════════════════════════════════════════════════

/** Link a line item to an existing material schedule item + mark it purchased. */
workerEmailsRouter.patch(
  "/:id/invoices/:invoiceId/line-items/:lineItemId/link",
  async (c) => {
    const db = drizzle(c.env.DB);
    const lineItemId = parseInt(c.req.param("lineItemId"));
    const body = await c.req.json().catch(() => ({}));
    const materialId = Number(body.materialScheduleItemId);
    if (!Number.isInteger(materialId)) {
      return c.json({ error: "materialScheduleItemId (integer) is required" }, 400);
    }

    const [lineItem] = await db
      .select()
      .from(workerEmailInvoiceLineItems)
      .where(eq(workerEmailInvoiceLineItems.id, lineItemId))
      .limit(1);
    if (!lineItem) return c.json({ error: "Line item not found" }, 404);

    const [invoice] = await db
      .select()
      .from(workerEmailInvoices)
      .where(eq(workerEmailInvoices.id, lineItem.invoiceId))
      .limit(1);

    const [material] = await db
      .select()
      .from(materialScheduleItems)
      .where(eq(materialScheduleItems.id, materialId))
      .limit(1);
    if (!material) return c.json({ error: "Material schedule item not found" }, 404);

    const [updatedLine] = await db
      .update(workerEmailInvoiceLineItems)
      .set({
        materialScheduleItemId: materialId,
        matchStatus: "matched",
        updatedAt: new Date(),
      })
      .where(eq(workerEmailInvoiceLineItems.id, lineItemId))
      .returning();

    await db
      .update(materialScheduleItems)
      .set({
        isPurchased: true,
        notes: appendNote(material.notes, buildPurchaseNote(invoice, lineItem)),
        updatedAt: new Date(),
      })
      .where(eq(materialScheduleItems.id, materialId));

    return c.json({ lineItem: updatedLine, materialId });
  },
);

/** Create a new material schedule item from a line item, then link it. */
workerEmailsRouter.post(
  "/:id/invoices/:invoiceId/line-items/:lineItemId/create-material",
  async (c) => {
    const db = drizzle(c.env.DB);
    const lineItemId = parseInt(c.req.param("lineItemId"));
    const body = await c.req.json().catch(() => ({}));

    const [lineItem] = await db
      .select()
      .from(workerEmailInvoiceLineItems)
      .where(eq(workerEmailInvoiceLineItems.id, lineItemId))
      .limit(1);
    if (!lineItem) return c.json({ error: "Line item not found" }, 404);

    const [invoice] = await db
      .select()
      .from(workerEmailInvoices)
      .where(eq(workerEmailInvoices.id, lineItem.invoiceId))
      .limit(1);

    const title = String(body.title || lineItem.description || "Untitled material").slice(0, 200);

    const [material] = await db
      .insert(materialScheduleItems)
      .values({
        title,
        roomName: body.roomName || null,
        isPurchased: true,
        notes: buildPurchaseNote(invoice, lineItem),
      })
      .returning();

    const [updatedLine] = await db
      .update(workerEmailInvoiceLineItems)
      .set({
        materialScheduleItemId: material.id,
        matchStatus: "created",
        updatedAt: new Date(),
      })
      .where(eq(workerEmailInvoiceLineItems.id, lineItemId))
      .returning();

    return c.json({ lineItem: updatedLine, material });
  },
);

/** Skip a line item (not a trackable material). */
workerEmailsRouter.post(
  "/:id/invoices/:invoiceId/line-items/:lineItemId/skip",
  async (c) => {
    const db = drizzle(c.env.DB);
    const lineItemId = parseInt(c.req.param("lineItemId"));

    const [updatedLine] = await db
      .update(workerEmailInvoiceLineItems)
      .set({ matchStatus: "skipped", updatedAt: new Date() })
      .where(eq(workerEmailInvoiceLineItems.id, lineItemId))
      .returning();
    if (!updatedLine) return c.json({ error: "Line item not found" }, 404);

    return c.json({ lineItem: updatedLine });
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// Contracts (HITL)
// ═══════════════════════════════════════════════════════════════════════════

workerEmailsRouter.patch("/:id/contracts/:contractId", async (c) => {
  const db = drizzle(c.env.DB);
  const contractId = parseInt(c.req.param("contractId"));
  const updates = await c.req.json();

  const [updated] = await db
    .update(workerEmailContracts)
    .set({
      partyName: updates.partyName,
      counterpartyName: updates.counterpartyName,
      scopeSummary: updates.scopeSummary,
      totalValue: updates.totalValue,
      effectiveDate: updates.effectiveDate,
      completionDate: updates.completionDate,
      notes: updates.notes,
      updatedAt: new Date(),
    })
    .where(eq(workerEmailContracts.id, contractId))
    .returning();

  return c.json({ contract: updated });
});

workerEmailsRouter.post("/:id/contracts/:contractId/confirm", async (c) => {
  const db = drizzle(c.env.DB);
  const contractId = parseInt(c.req.param("contractId"));

  const [updated] = await db
    .update(workerEmailContracts)
    .set({ status: "confirmed", confirmedAt: new Date(), confirmedBy: "Admin" })
    .where(eq(workerEmailContracts.id, contractId))
    .returning();

  return c.json({ contract: updated });
});

workerEmailsRouter.post("/:id/contracts/:contractId/reject", async (c) => {
  const db = drizzle(c.env.DB);
  const contractId = parseInt(c.req.param("contractId"));

  const [updated] = await db
    .update(workerEmailContracts)
    .set({ status: "rejected" })
    .where(eq(workerEmailContracts.id, contractId))
    .returning();

  return c.json({ contract: updated });
});

// ═══════════════════════════════════════════════════════════════════════════
// Staged Companies (HITL)
// ═══════════════════════════════════════════════════════════════════════════

workerEmailsRouter.get("/:id/staged-company", async (c) => {
  const db = drizzle(c.env.DB);
  const emailId = parseInt(c.req.param("id"));

  const [staged] = await db
    .select()
    .from(workerEmailStagedCompanies)
    .where(eq(workerEmailStagedCompanies.emailId, emailId))
    .limit(1);

  return c.json({ stagedCompany: staged || null });
});

workerEmailsRouter.post("/:id/staged-company/confirm", async (c) => {
  const db = drizzle(c.env.DB);
  const emailId = parseInt(c.req.param("id"));
  const overrides = await c.req.json().catch(() => ({}));

  const [staged] = await db
    .select()
    .from(workerEmailStagedCompanies)
    .where(eq(workerEmailStagedCompanies.emailId, emailId))
    .limit(1);
  if (!staged) return c.json({ error: "No staged company found" }, 404);

  const [newCompany] = await db
    .insert(companies)
    .values({
      name: overrides.name || staged.suggestedName || "Unknown Company",
      email: overrides.email || staged.suggestedEmail,
      phone: overrides.phone || staged.suggestedPhone,
      website: overrides.website || staged.suggestedWebsite,
      licenseNumber: overrides.licenseNumber || staged.suggestedLicenseNumber,
      notes: `Auto-created from email #${emailId}. Business type: ${staged.suggestedBusinessType || "unknown"}.`,
    })
    .returning();

  await db
    .update(workerEmailStagedCompanies)
    .set({ status: "confirmed", confirmedCompanyId: newCompany.id, updatedAt: new Date() })
    .where(eq(workerEmailStagedCompanies.id, staged.id));

  await db
    .update(workerEmails)
    .set({
      matchedCompanyId: newCompany.id,
      companyMatchConfidence: 1.0,
      companyMatchMethod: "manual",
    })
    .where(eq(workerEmails.id, emailId));

  return c.json({ company: newCompany });
});

workerEmailsRouter.post("/:id/staged-company/merge/:companyId", async (c) => {
  const db = drizzle(c.env.DB);
  const emailId = parseInt(c.req.param("id"));
  const companyId = parseInt(c.req.param("companyId"));

  const [staged] = await db
    .select()
    .from(workerEmailStagedCompanies)
    .where(eq(workerEmailStagedCompanies.emailId, emailId))
    .limit(1);
  if (!staged) return c.json({ error: "No staged company found" }, 404);

  const [target] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!target) return c.json({ error: "Target company not found" }, 404);

  await db
    .update(workerEmailStagedCompanies)
    .set({ status: "merged", confirmedCompanyId: companyId, updatedAt: new Date() })
    .where(eq(workerEmailStagedCompanies.id, staged.id));

  await db
    .update(workerEmails)
    .set({
      matchedCompanyId: companyId,
      companyMatchConfidence: 1.0,
      companyMatchMethod: "manual",
    })
    .where(eq(workerEmails.id, emailId));

  return c.json({ company: target });
});

workerEmailsRouter.post("/:id/staged-company/reject", async (c) => {
  const db = drizzle(c.env.DB);
  const emailId = parseInt(c.req.param("id"));

  const [staged] = await db
    .select()
    .from(workerEmailStagedCompanies)
    .where(eq(workerEmailStagedCompanies.emailId, emailId))
    .limit(1);
  if (!staged) return c.json({ error: "No staged company found" }, 404);

  await db
    .update(workerEmailStagedCompanies)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(workerEmailStagedCompanies.id, staged.id));

  return c.json({ success: true });
});
