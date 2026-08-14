import { estimateLineItems, rooms } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { reconcileQueueUrl } from "../../urls";

const MAPPING_STATUSES = ["unmapped", "ai_suggested", "confirmed", "rejected"] as const;

export const reconcileEstimateLine = defineTool({
  name: "reconcile_estimate_line",
  category: "budget",
  title: "Reconcile estimate line item",
  description:
    "Human-confirm write for an estimate line item's room/budget-track mapping — the SAME write PATCH /api/estimates/line-items/:id/reconcile does, and what the /admin/budget/reconcile HITL UI calls on confirm. This is the ONLY place `roomId` is ever written on estimate_line_items (list_reconciliation_queue's AI suggestion only stages a guess in aiSuggestedRoomId — never the real room). Provide any of roomId, budgetItemTrackId, mappingStatus; only provided fields are updated. If `roomId` is a positive integer it is validated against the live rooms table and rejected if it doesn't exist. If `roomId` is set and `mappingStatus` is omitted, mappingStatus auto-advances to 'confirmed'. budgetItemTrackId is the budget item's stable trackId (TEXT, no FK — never budget_tracker_items.id, which is revisioned).",
  inputShape: {
    lineItemId: z.number().int().positive().describe("estimate_line_items row id (see list_reconciliation_queue)"),
    roomId: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe("Room row id to confirm, or null to clear. Validated against rooms if a number."),
    budgetItemTrackId: z
      .string()
      .nullable()
      .optional()
      .describe("Budget item's stable trackId to link, or null to clear"),
    mappingStatus: z
      .enum(MAPPING_STATUSES)
      .optional()
      .describe("Override the mapping status explicitly (default: auto-advances to 'confirmed' when roomId is set)"),
  },
  annotations: WRITE,
  outputShape: {
    lineItem: looseObject({
      id: z.number().int(),
      description: z.string(),
      lineTotalCents: z.number().int().nullable(),
      roomId: z.number().int().nullable(),
      budgetItemTrackId: z.string().nullable(),
      mappingStatus: z.enum(MAPPING_STATUSES),
    }),
    url: urlField,
  },
  examples: [
    { title: "Confirm the AI-suggested room", args: { lineItemId: 42, roomId: 3 } },
    {
      title: "Confirm room + link a budget track",
      args: { lineItemId: 42, roomId: 3, budgetItemTrackId: "kitchen-cabinets" },
    },
    { title: "Reject a bad AI suggestion", args: { lineItemId: 42, mappingStatus: "rejected" } },
  ],
  handler: async ({ env, db }, input) => {
    const patch: Partial<typeof estimateLineItems.$inferInsert> = {};

    if ("roomId" in input) {
      if (input.roomId === null) {
        patch.roomId = null;
      } else if (typeof input.roomId === "number") {
        const room = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, input.roomId)).get();
        if (!room) toolError(`Room ${input.roomId} not found. Call list_rooms for valid ids.`);
        patch.roomId = input.roomId;
      }
    }

    if ("budgetItemTrackId" in input) {
      patch.budgetItemTrackId = input.budgetItemTrackId ?? null;
    }

    if (input.mappingStatus) {
      patch.mappingStatus = input.mappingStatus;
    }

    if (!input.mappingStatus) {
      if (typeof patch.roomId === "number") {
        patch.mappingStatus = "confirmed";
      } else if (patch.roomId === null) {
        patch.mappingStatus = "unmapped";
      }
    }

    if (Object.keys(patch).length === 0) {
      toolError("No fields to update — provide roomId, budgetItemTrackId, and/or mappingStatus.");
    }

    patch.datetimeUpdated = new Date();

    const [updated] = await db
      .update(estimateLineItems)
      .set(patch)
      .where(eq(estimateLineItems.id, input.lineItemId))
      .returning();
    if (!updated) toolError(`Line item ${input.lineItemId} not found. Call list_reconciliation_queue for valid ids.`);

    return {
      lineItem: {
        id: updated.id,
        description: updated.description,
        lineTotalCents: updated.lineTotalCents,
        roomId: updated.roomId,
        budgetItemTrackId: updated.budgetItemTrackId,
        mappingStatus: updated.mappingStatus as (typeof MAPPING_STATUSES)[number],
      },
      url: reconcileQueueUrl(env),
    };
  },
});
