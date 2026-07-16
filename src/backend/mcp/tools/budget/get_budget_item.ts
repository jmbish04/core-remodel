import { budgetTrackerItemRooms } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, READ_ONLY } from "../../types";
import { activeBudgetItem, budgetItemDto } from "./_shared";

export const getBudgetItem = defineTool({
  name: "get_budget_item",
  category: "budget",
  title: "Get budget item detail",
  description:
    "Full detail for one ACTIVE budget item revision by numeric `id` OR stable `trackId`. Includes the room ids it is linked to. NOTE: expense entries have no direct FK to budget items, so no actuals total is joined here — use `list_expenses` (filter by category/item) to find related actuals.",
  inputShape: {
    id: z.number().int().positive().optional().describe("Numeric row id of a specific revision"),
    trackId: z.string().min(1).optional().describe("Stable track id (resolves to the active revision)"),
  },
  annotations: READ_ONLY,
  outputShape: {
    id: z.number().int(),
    trackId: z.string(),
    revisionNumber: z.number().int(),
    isActive: z.boolean(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    status: z.string().nullable(),
    itemType: z.string().nullable(),
    executionClass: z.string().nullable(),
    scenarioId: z.string().nullable(),
    estimatedLowCents: z.number().int().nullable(),
    estimatedHighCents: z.number().int().nullable(),
    estimatedLow: z.string(),
    estimatedHigh: z.string(),
    roomIds: z.array(z.number().int()),
  },
  examples: [
    { title: "By id", args: { id: 12 } },
    { title: "By trackId", args: { trackId: "b1e2..." } },
  ],
  handler: async ({ db }, input) => {
    if (input.id == null && !input.trackId) toolError("Provide either `id` or `trackId`.");
    const item = await activeBudgetItem(db, { id: input.id, trackId: input.trackId });
    if (!item) {
      toolError(`Budget item not found (${input.id ?? input.trackId}). Call list_budget_items for valid ids.`);
    }

    const links = await db
      .select({ roomId: budgetTrackerItemRooms.roomId })
      .from(budgetTrackerItemRooms)
      .where(eq(budgetTrackerItemRooms.budgetTrackerItemId, item.id))
      .all();

    return {
      ...budgetItemDto(item),
      roomIds: links.map((l) => l.roomId),
    };
  },
});
