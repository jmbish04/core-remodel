import { budgetTrackerItemRooms } from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, DESTRUCTIVE } from "../../types";

export const unlinkBudgetItemFromRoom = defineTool({
  name: "unlink_budget_item_from_room",
  category: "budget",
  title: "Unlink budget item from room",
  description:
    "Remove the join row connecting a budget item to a room. Deletes the link only — neither the budget item nor the room is affected.",
  inputShape: {
    budgetTrackerItemId: z.number().int().positive().describe("Budget item row id"),
    roomId: z.number().int().positive().describe("Room row id"),
  },
  annotations: DESTRUCTIVE,
  outputShape: {
    unlinked: z.boolean(),
    id: z.number().int(),
  },
  examples: [{ title: "Unlink item from a room", args: { budgetTrackerItemId: 12, roomId: 3 } }],
  handler: async ({ db }, input) => {
    const [existing] = await db
      .select()
      .from(budgetTrackerItemRooms)
      .where(
        and(
          eq(budgetTrackerItemRooms.budgetTrackerItemId, input.budgetTrackerItemId),
          eq(budgetTrackerItemRooms.roomId, input.roomId),
        ),
      )
      .limit(1);
    if (!existing) {
      toolError(
        `No link between budget item ${input.budgetTrackerItemId} and room ${input.roomId} — nothing to unlink.`,
      );
    }
    await db
      .delete(budgetTrackerItemRooms)
      .where(eq(budgetTrackerItemRooms.id, existing.id))
      .run();
    return { unlinked: true, id: existing.id };
  },
});
