import { budgetTrackerItemRooms, budgetTrackerItems } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { cents, toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { budgetUrl } from "../../urls";
import { activeBudgetItem, budgetItemDto } from "./_shared";

export const updateBudgetItem = defineTool({
  name: "update_budget_item",
  category: "budget",
  title: "Update budget item (new revision)",
  description:
    "Revision-aware edit. Loads the ACTIVE revision (by `id` or `trackId`), inserts a NEW revision row with your changed fields merged over the current values (`revisionNumber + 1`, same `trackId`, `isActive = true`), then flips the old row to `isActive = false` and points its `replacedByItemId` at the new row. Only the fields you pass change. Returns the new active revision.",
  inputShape: {
    id: z.number().int().positive().optional().describe("Numeric id of the current active revision"),
    trackId: z.string().min(1).optional().describe("Stable track id (resolves to the active revision)"),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.string().optional(),
    executionClass: z.string().optional(),
    itemType: z.string().optional(),
    estimatedLowCents: z.number().int().optional().describe("Low estimate in integer cents"),
    estimatedHighCents: z.number().int().optional().describe("High estimate in integer cents"),
    scenarioId: z.string().optional(),
  },
  annotations: WRITE,
  outputShape: {
    updated: z.boolean(),
    item: looseObject({
      id: z.number().int(),
      trackId: z.string(),
      title: z.string().nullable(),
      status: z.string().nullable(),
      estimatedLowCents: z.number().int().nullable(),
      estimatedHighCents: z.number().int().nullable(),
      estimatedLow: z.string(),
      estimatedHigh: z.string(),
    }),
    url: urlField,
  },
  examples: [
    { title: "Approve an item", args: { id: 12, status: "approved" } },
    { title: "Revise estimate", args: { trackId: "b1e2...", estimatedHighCents: 1500000 } },
  ],
  handler: async ({ env, db }, input) => {
    if (input.id == null && !input.trackId) toolError("Provide either `id` or `trackId`.");
    const current = await activeBudgetItem(db, { id: input.id, trackId: input.trackId });
    if (!current) {
      toolError(`Budget item not found (${input.id ?? input.trackId}). Call list_budget_items for valid ids.`);
    }

    // Merge only supplied fields over the current revision's values.
    const merged = {
      trackId: current.trackId,
      revisionNumber: current.revisionNumber + 1,
      isActive: true,
      isDraft: current.isDraft,
      itemType: input.itemType ?? current.itemType,
      executionClass: input.executionClass ?? current.executionClass,
      optionGroup: current.optionGroup,
      optionKey: current.optionKey,
      title: input.title ?? current.title,
      description: input.description !== undefined ? input.description : current.description,
      status: input.status ?? current.status,
      riskLevel: current.riskLevel,
      isBottleneck: current.isBottleneck,
      bottleneckReason: current.bottleneckReason,
      estimatedLowCents:
        input.estimatedLowCents !== undefined ? cents(input.estimatedLowCents) ?? null : current.estimatedLowCents,
      estimatedHighCents:
        input.estimatedHighCents !== undefined
          ? cents(input.estimatedHighCents) ?? null
          : current.estimatedHighCents,
      scenarioId: input.scenarioId !== undefined ? input.scenarioId : current.scenarioId,
      owner: current.owner,
      aiRationale: current.aiRationale,
    };

    const [next] = await db.insert(budgetTrackerItems).values(merged).returning();

    // Carry the room links forward. budgetTrackerItemRooms points at the row
    // `id`, so a new revision would otherwise orphan every room association
    // (they'd vanish from get_budget_item / list_budget_items / the report).
    const roomLinks = await db
      .select()
      .from(budgetTrackerItemRooms)
      .where(eq(budgetTrackerItemRooms.budgetTrackerItemId, current.id))
      .all();
    if (roomLinks.length > 0) {
      await db
        .insert(budgetTrackerItemRooms)
        .values(roomLinks.map((link) => ({ budgetTrackerItemId: next.id, roomId: link.roomId })))
        .run();
    }

    // Retire the prior revision and chain it to the new one.
    await db
      .update(budgetTrackerItems)
      .set({ isActive: false, replacedByItemId: next.id, replacedAt: new Date() })
      .where(eq(budgetTrackerItems.id, current.id))
      .run();

    return { updated: true, item: budgetItemDto(next), url: budgetUrl(env) };
  },
});
