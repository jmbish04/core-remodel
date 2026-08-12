import { estimateCompanies, estimateLineItems, estimateRevisions, estimates, rooms } from "@backend/db";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { formatCents } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { reconcileQueueUrl } from "../../urls";

const queueItemShape = looseObject({
  lineItemId: z.number().int(),
  description: z.string(),
  lineTotalCents: z.number().int().nullable(),
  mappingStatus: z.enum(["unmapped", "ai_suggested", "confirmed", "rejected"]),
  roomId: z.number().int().nullable(),
  budgetItemTrackId: z.string().nullable(),
  aiSuggestedRoomId: z.number().int().nullable(),
  aiSuggestedRoomName: z.string().nullable(),
  aiSuggestedCategory: z.string().nullable(),
  mappingConfidence: z.number().nullable(),
  estimateId: z.number().int().nullable(),
  company: looseObject({ id: z.number().int(), name: z.string() }).nullable(),
  revision: looseObject({ id: z.number().int(), revisionNumber: z.number().int() }).nullable(),
});

export const listReconciliationQueue = defineTool({
  name: "list_reconciliation_queue",
  category: "budget",
  title: "List estimate-line reconciliation queue",
  description:
    "List estimate line items still needing human room/budget mapping (mappingStatus 'unmapped' or 'ai_suggested') — the same HITL queue GET /api/estimates/reconcile/queue and the /admin/budget/reconcile UI show. Joined to the owning estimate/company/revision and (when an AI guess is staged) the suggested room's display name. Money is cents. Use reconcile_estimate_line to confirm or override a line.",
  inputShape: {
    limit: z.number().int().positive().max(200).optional().describe("Page size, default 50, max 200"),
    offset: z.number().int().nonnegative().optional().describe("Rows to skip, default 0"),
  },
  annotations: READ_ONLY,
  outputShape: {
    summary: z.string().describe("Human-readable one-line summary of the queue page"),
    items: z.array(queueItemShape),
    limit: z.number().int(),
    offset: z.number().int(),
    hasMore: z.boolean(),
    url: z.string().describe("Absolute URL of the reconciliation queue page"),
  },
  examples: [
    { title: "First page of the queue", args: {} },
    { title: "Next page", args: { limit: 50, offset: 50 } },
  ],
  handler: async ({ env, db }, input) => {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);

    const rowsPlusOne = await db
      .select({
        lineItem: estimateLineItems,
        estimateId: estimates.id,
        companyId: estimateCompanies.id,
        companyName: estimateCompanies.name,
        revisionId: estimateRevisions.id,
        revisionNumber: estimateRevisions.revisionNumber,
        suggestedRoomName: rooms.roomName,
      })
      .from(estimateLineItems)
      .leftJoin(estimateRevisions, eq(estimateLineItems.estimateRevisionId, estimateRevisions.id))
      .leftJoin(estimates, eq(estimateRevisions.estimateId, estimates.id))
      .leftJoin(estimateCompanies, eq(estimates.estimateCompanyId, estimateCompanies.id))
      .leftJoin(rooms, eq(estimateLineItems.aiSuggestedRoomId, rooms.id))
      .where(inArray(estimateLineItems.mappingStatus, ["unmapped", "ai_suggested"]))
      .orderBy(asc(estimateLineItems.datetimeCreated))
      .limit(limit + 1)
      .offset(offset)
      .all();

    const hasMore = rowsPlusOne.length > limit;
    const rows = rowsPlusOne.slice(0, limit);

    const items = rows.map((row) => ({
      lineItemId: row.lineItem.id,
      description: row.lineItem.description,
      lineTotalCents: row.lineItem.lineTotalCents,
      mappingStatus: row.lineItem.mappingStatus as "unmapped" | "ai_suggested" | "confirmed" | "rejected",
      roomId: row.lineItem.roomId,
      budgetItemTrackId: row.lineItem.budgetItemTrackId,
      aiSuggestedRoomId: row.lineItem.aiSuggestedRoomId,
      aiSuggestedRoomName: row.suggestedRoomName,
      aiSuggestedCategory: row.lineItem.aiSuggestedCategory,
      mappingConfidence: row.lineItem.mappingConfidence,
      estimateId: row.estimateId,
      company: row.companyId ? { id: row.companyId, name: row.companyName ?? "" } : null,
      revision: row.revisionId ? { id: row.revisionId, revisionNumber: row.revisionNumber ?? 0 } : null,
    }));

    // Page-scoped: this sums only the rows on THIS page, not the whole queue.
    // Say so explicitly so a chat consumer doesn't read it as the grand total.
    const pageCents = items.reduce((sum, it) => sum + (it.lineTotalCents ?? 0), 0);
    const summary =
      `${items.length} line item${items.length === 1 ? "" : "s"} pending reconciliation on this page ` +
      `(${formatCents(pageCents)} on this page)${hasMore ? " — more pending beyond this page" : ""}`;

    return { summary, items, limit, offset, hasMore, url: reconcileQueueUrl(env) };
  },
});
