import { budgetTrackerItemRooms, budgetTrackerItems } from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { matchesQuery, paginate } from "../../format";
import { looseObject, pageOutput } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { budgetItemDto } from "./_shared";

export const listBudgetItems = defineTool({
  name: "list_budget_items",
  category: "budget",
  title: "List budget items",
  description:
    "List ACTIVE budget line items (current revision only). Optional filters: `roomId` (items linked to that room via the join table), `status`, `executionClass`, and free-text `q` over title/description. Paginated. Money is returned as both `*Cents` integers and `$` strings.",
  inputShape: {
    roomId: z.number().int().positive().optional().describe("Only items linked to this room id (see list_rooms)"),
    status: z.string().optional().describe("Exact status: open | researching | blocked | approved | done"),
    executionClass: z
      .string()
      .optional()
      .describe("Exact execution class: must_now | future_tbd | option"),
    q: z.string().optional().describe("Free-text filter over title / description"),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: READ_ONLY,
  outputShape: {
    ...pageOutput(
      looseObject({
        id: z.number().int(),
        trackId: z.string(),
        title: z.string().nullable(),
        status: z.string().nullable(),
        estimatedLowCents: z.number().int().nullable(),
        estimatedHighCents: z.number().int().nullable(),
        estimatedLow: z.string(),
        estimatedHigh: z.string(),
      }),
    ),
  },
  examples: [
    { title: "All active items", args: {} },
    { title: "Open items for a room", args: { roomId: 3, status: "open" } },
  ],
  handler: async ({ db }, input) => {
    const conds = [eq(budgetTrackerItems.isActive, true)];
    if (input.status) conds.push(eq(budgetTrackerItems.status, input.status));
    if (input.executionClass) conds.push(eq(budgetTrackerItems.executionClass, input.executionClass));

    // Room filter runs through the join table: resolve linked item ids first.
    if (input.roomId != null) {
      const links = await db
        .select({ budgetTrackerItemId: budgetTrackerItemRooms.budgetTrackerItemId })
        .from(budgetTrackerItemRooms)
        .where(eq(budgetTrackerItemRooms.roomId, input.roomId))
        .all();
      const ids = links.map((l) => l.budgetTrackerItemId);
      if (ids.length === 0) return paginate([], input.limit ?? 50, input.offset ?? 0);
      conds.push(inArray(budgetTrackerItems.id, ids));
    }

    const all = await db
      .select()
      .from(budgetTrackerItems)
      .where(and(...conds))
      .all();

    const filtered = input.q
      ? all.filter((b) => matchesQuery([b.title, b.description], input.q as string))
      : all;

    return paginate(filtered.map(budgetItemDto), input.limit ?? 50, input.offset ?? 0);
  },
});
