import { budgetTrackerItemRooms, budgetTrackerItems, rooms } from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";
import { budgetUrl } from "../../urls";

export const linkBudgetItemToRoom = defineTool({
  name: "link_budget_item_to_room",
  category: "budget",
  title: "Link budget item to room",
  description:
    "Attach a budget item (by row id) to a room (by row id) via the join table. Idempotent — if the (budgetTrackerItemId, roomId) pair already exists it is a no-op. Both records must exist.",
  inputShape: {
    budgetTrackerItemId: z.number().int().positive().describe("Budget item row id (see list_budget_items)"),
    roomId: z.number().int().positive().describe("Room row id (see list_rooms)"),
  },
  annotations: WRITE_IDEMPOTENT,
  outputShape: {
    linked: z.boolean(),
    created: z.boolean(),
    id: z.number().int(),
    url: urlField,
  },
  examples: [{ title: "Link item to a room", args: { budgetTrackerItemId: 12, roomId: 3 } }],
  handler: async ({ env, db }, input) => {
    const [item] = await db
      .select()
      .from(budgetTrackerItems)
      .where(eq(budgetTrackerItems.id, input.budgetTrackerItemId))
      .limit(1);
    if (!item) toolError(`Budget item ${input.budgetTrackerItemId} not found. Call list_budget_items for valid ids.`);

    const [room] = await db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1);
    if (!room) toolError(`Room ${input.roomId} not found. Call list_rooms for valid ids.`);

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
    if (existing) return { linked: true, created: false, id: existing.id, url: budgetUrl(env) };

    const [created] = await db
      .insert(budgetTrackerItemRooms)
      .values({ budgetTrackerItemId: input.budgetTrackerItemId, roomId: input.roomId })
      .returning();
    return { linked: true, created: true, id: created.id, url: budgetUrl(env) };
  },
});
