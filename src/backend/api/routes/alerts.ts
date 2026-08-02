/**
 * @fileoverview Global alerts aggregator (0042 P3).
 *
 * The user has no single "things need my attention" surface — each HITL queue is
 * siloed. This endpoint UNIONs the domain staged/unread tables into one
 * normalized feed for the header bell + /admin/alerts, WITHOUT duplicating data:
 * every alert carries the id + a deep-link to its existing review surface.
 *
 *   email_received   → unread gmail_messages
 *   pending_ai       → worker_emails awaiting the user's OK to AI-process (0042)
 *   invoice_review   → extracted worker_email_invoices not yet confirmed
 *   room_proposal    → staged material_room_proposals
 */
import { Hono } from "hono";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { gmailMessages } from "@backend/db/schema/gmail/gmail_messages";
import { workerEmails } from "@backend/db/schema/emails/worker_emails";
import { workerEmailInvoices } from "@backend/db/schema/emails/worker_email_invoices";
import { materialRoomProposals } from "@backend/db/schema/materials/material_room_proposals";

export const alertsRouter = new Hono<{ Bindings: Env }>();

/** Per-source cap so one noisy source can't drown the feed. */
const PER_SOURCE = 50;

export type AlertKind = "email_received" | "pending_ai" | "invoice_review" | "room_proposal";

export interface Alert {
  /** Stable per-alert id, e.g. "pending_ai:123". */
  id: string;
  kind: AlertKind;
  title: string;
  context: string;
  timestamp: number | null;
  /** Deep-link to the existing review surface for this item. */
  route: string;
}

/**
 * Converts a Date or number to milliseconds since epoch.
 *
 * @param v The date, number, or null/undefined value to convert.
 * @returns The timestamp in milliseconds, or null if the input is invalid or missing.
 */
function toMs(v: Date | number | null | undefined): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Number(v);
  return Number.isFinite(t) ? t : null;
}

alertsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);

  const [unreadMail, pendingAi, invoices, proposals] = await Promise.all([
    db
      .select({
        id: gmailMessages.id,
        threadId: gmailMessages.threadId,
        subject: gmailMessages.subject,
        from: gmailMessages.fromRecipient,
        ts: gmailMessages.timestamp,
      })
      .from(gmailMessages)
      .where(and(isNull(gmailMessages.readAt), isNull(gmailMessages.deletedAt)))
      .orderBy(desc(gmailMessages.timestamp))
      .limit(PER_SOURCE)
      .all(),
    db
      .select({
        id: workerEmails.id,
        subject: workerEmails.subject,
        from: workerEmails.fromAddress,
        ts: workerEmails.createdAt,
      })
      .from(workerEmails)
      .where(eq(workerEmails.aiStatus, "pending_approval"))
      .orderBy(desc(workerEmails.createdAt))
      .limit(PER_SOURCE)
      .all(),
    db
      .select({
        id: workerEmailInvoices.id,
        vendor: workerEmailInvoices.vendorName,
        total: workerEmailInvoices.total,
        kind: workerEmailInvoices.kind,
        storeId: workerEmailInvoices.showroomStoreId,
        ts: workerEmailInvoices.createdAt,
      })
      .from(workerEmailInvoices)
      .where(eq(workerEmailInvoices.status, "draft"))
      .orderBy(desc(workerEmailInvoices.createdAt))
      .limit(PER_SOURCE)
      .all(),
    db
      .select({ id: materialRoomProposals.id, ts: materialRoomProposals.createdAt })
      .from(materialRoomProposals)
      .where(eq(materialRoomProposals.status, "staged"))
      .orderBy(desc(materialRoomProposals.createdAt))
      .limit(PER_SOURCE)
      .all(),
  ]);

  const alerts: Alert[] = [
    ...pendingAi.map((e) => ({
      id: `pending_ai:${e.id}`,
      kind: "pending_ai" as const,
      title: "Email awaiting your OK to AI-process",
      context: `${e.subject ?? "(no subject)"} — ${e.from ?? ""}`.trim(),
      timestamp: toMs(e.ts),
      route: `/admin/inbox`,
    })),
    ...invoices.map((v) => ({
      id: `invoice_review:${v.id}`,
      kind: "invoice_review" as const,
      title: `${v.kind === "receipt" ? "Receipt" : "Invoice"} to review${v.vendor ? ` — ${v.vendor}` : ""}`,
      context: v.total != null ? `Total ${v.total}` : "Extracted from email",
      timestamp: toMs(v.ts),
      // Pin to the store viewport when the quote resolved to a showroom (0042
      // P4) so a click lands on that store's pending-quote panel; otherwise the
      // global receipt-review queue.
      route: v.storeId
        ? `/admin/shopping/store/${v.storeId}/brands-products`
        : `/admin/shopping/receipt-review`,
    })),
    ...unreadMail.map((m) => ({
      id: `email_received:${m.id}`,
      kind: "email_received" as const,
      title: `New email${m.from ? ` from ${m.from}` : ""}`,
      context: m.subject ?? "(no subject)",
      timestamp: toMs(m.ts),
      // Deep-link straight to the thread so a click opens the email, not the list.
      route: `/admin/inbox/gmail?thread=${encodeURIComponent(m.threadId)}`,
    })),
    ...proposals.map((p) => ({
      id: `room_proposal:${p.id}`,
      kind: "room_proposal" as const,
      title: "Material → room proposal to confirm",
      context: "Staged from a receipt",
      timestamp: toMs(p.ts),
      route: `/admin/shopping/receipt-review`,
    })),
  ].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  const counts = {
    email_received: unreadMail.length,
    pending_ai: pendingAi.length,
    invoice_review: invoices.length,
    room_proposal: proposals.length,
    total: alerts.length,
  };

  return c.json({ success: true as const, counts, alerts });
});

/** Lightweight count-only endpoint for the header bell badge. */
alertsRouter.get("/count", async (c) => {
  const db = drizzle(c.env.DB);
  const [mail, ai, inv, prop] = await Promise.all([
    db
      .select({ n: count() })
      .from(gmailMessages)
      .where(and(isNull(gmailMessages.readAt), isNull(gmailMessages.deletedAt)))
      .all(),
    db.select({ n: count() }).from(workerEmails).where(eq(workerEmails.aiStatus, "pending_approval")).all(),
    db.select({ n: count() }).from(workerEmailInvoices).where(eq(workerEmailInvoices.status, "draft")).all(),
    db.select({ n: count() }).from(materialRoomProposals).where(eq(materialRoomProposals.status, "staged")).all(),
  ]);
  const total = (mail[0]?.n ?? 0) + (ai[0]?.n ?? 0) + (inv[0]?.n ?? 0) + (prop[0]?.n ?? 0);
  return c.json({ success: true as const, total });
});
