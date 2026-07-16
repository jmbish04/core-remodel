import {
  budgetExpenseEntries,
  budgetFundingAccounts,
  budgetTrackerItemRooms,
  budgetTrackerItems,
  rooms,
} from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { formatCents } from "../../format";
import { looseObject } from "../../schemas";
import { READ_ONLY, defineTool } from "../../types";

/** Classify an actual against an estimate range. */
function classify(
  actualCents: number,
  lowCents: number | null,
  highCents: number | null,
): "below" | "at" | "over" | "no_estimate" {
  if (lowCents == null && highCents == null) return "no_estimate";
  const low = lowCents ?? highCents ?? 0;
  const high = highCents ?? lowCents ?? 0;
  if (actualCents > high) return "over";
  if (actualCents < low) return "below";
  return "at";
}

export const getBudgetReport = defineTool({
    name: "get_budget_report",
    category: "budget",
    title: "Budget vs actual report",
    description:
      "Portfolio budget health: total funding, total estimated (low/high), total actual spend, remaining vs funding, and an overall below/at/over flag. Also breaks actuals down BY CATEGORY and estimates BY ROOM. NOTE: actual expenses are attributed at the category/portfolio level (they are not line-item-linked to budget items); per-room figures are ESTIMATES from the budget↔room links. Counts every ACTIVE line item — including drafts — by default (budget items default to isDraft=true, so excluding them would zero out the report and mismatch list_budget_items). Pass includeDrafts=false to count only finalized (non-draft) items.",
    inputShape: {
      includeDrafts: z
        .boolean()
        .default(true)
        .describe(
          "Include draft budget items in the totals. Default TRUE so the report matches the active items list_budget_items returns (items are drafts by default). Set false to exclude drafts.",
        ),
    },
    annotations: READ_ONLY,
    outputShape: {
      attribution: z.string(),
      totals: z.object({
        funding: z.string(),
        fundingCents: z.number().int(),
        estimatedLow: z.string(),
        estimatedHigh: z.string(),
        estimatedLowCents: z.number().int(),
        estimatedHighCents: z.number().int(),
        actual: z.string(),
        actualCents: z.number().int(),
        remainingVsFunding: z.string(),
        remainingVsFundingCents: z.number().int(),
      }),
      overallStatus: z.enum(["below", "at", "over", "no_estimate"]),
      activeItemCount: z.number().int(),
      expenseCount: z.number().int(),
      byCategory: z.array(
        looseObject({
          category: z.string(),
          actualCents: z.number().int(),
          actual: z.string(),
        }),
      ),
      byRoom: z.array(
        looseObject({
          roomId: z.number().int(),
          roomName: z.string(),
          estimatedLow: z.string(),
          estimatedHigh: z.string(),
          estimatedLowCents: z.number().int(),
          estimatedHighCents: z.number().int(),
        }),
      ),
    },
    examples: [{ title: "Full report", args: {} }],
    handler: async ({ db }, input) => {
      // Defaults TRUE: budget items are created with isDraft=true, so excluding
      // drafts would zero the whole report and contradict list_budget_items
      // (agent bug #1). `.default(true)` on the input schema advertises the
      // default to clients; the `?? true` is a defensive guard in case a
      // transport hands the raw args through without applying the zod default.
      const includeDrafts = input.includeDrafts ?? true;

      const [items, expenses, funding, itemRooms, allRooms] = await Promise.all([
        db.select().from(budgetTrackerItems).where(eq(budgetTrackerItems.isActive, true)).all(),
        db.select().from(budgetExpenseEntries).where(eq(budgetExpenseEntries.isActive, true)).all(),
        db.select().from(budgetFundingAccounts).all(),
        db.select().from(budgetTrackerItemRooms).all(),
        db.select().from(rooms).where(eq(rooms.isActive, true)).all(),
      ]);

      const activeItems = includeDrafts ? items : items.filter((i) => !i.isDraft);

      const estLow = activeItems.reduce((s, i) => s + (i.estimatedLowCents ?? 0), 0);
      const estHigh = activeItems.reduce((s, i) => s + (i.estimatedHighCents ?? 0), 0);
      const actual = expenses.reduce((s, e) => s + (e.amountCents ?? 0), 0);
      const fundingTotal = funding.reduce((s, f) => s + (f.amountCents ?? 0), 0);

      // Actuals by category.
      const byCategoryMap = new Map<string, number>();
      for (const e of expenses) {
        byCategoryMap.set(e.category, (byCategoryMap.get(e.category) ?? 0) + (e.amountCents ?? 0));
      }
      const byCategory = [...byCategoryMap.entries()]
        .map(([category, cents]) => ({ category, actualCents: cents, actual: formatCents(cents) }))
        .sort((a, b) => b.actualCents - a.actualCents);

      // Estimates by room (from the budget↔room join).
      const itemById = new Map(activeItems.map((i) => [i.id, i]));
      const roomName = new Map(allRooms.map((r) => [r.id, r.roomName]));
      const byRoomMap = new Map<number, { low: number; high: number }>();
      for (const link of itemRooms) {
        const item = itemById.get(link.budgetTrackerItemId);
        if (!item) continue;
        const agg = byRoomMap.get(link.roomId) ?? { low: 0, high: 0 };
        agg.low += item.estimatedLowCents ?? 0;
        agg.high += item.estimatedHighCents ?? 0;
        byRoomMap.set(link.roomId, agg);
      }
      const byRoom = [...byRoomMap.entries()]
        .map(([roomId, agg]) => ({
          roomId,
          roomName: roomName.get(roomId) ?? `room ${roomId}`,
          estimatedLow: formatCents(agg.low),
          estimatedHigh: formatCents(agg.high),
          estimatedLowCents: agg.low,
          estimatedHighCents: agg.high,
        }))
        .sort((a, b) => b.estimatedHighCents - a.estimatedHighCents);

      return {
        attribution:
          "Actuals are portfolio/category level (expenses are not line-item-linked). Per-room figures are estimates.",
        totals: {
          funding: formatCents(fundingTotal),
          fundingCents: fundingTotal,
          estimatedLow: formatCents(estLow),
          estimatedHigh: formatCents(estHigh),
          estimatedLowCents: estLow,
          estimatedHighCents: estHigh,
          actual: formatCents(actual),
          actualCents: actual,
          remainingVsFunding: formatCents(fundingTotal - actual),
          remainingVsFundingCents: fundingTotal - actual,
        },
        overallStatus: classify(actual, estLow, estHigh),
        activeItemCount: activeItems.length,
        expenseCount: expenses.length,
        byCategory,
        byRoom,
      };
    },
  });
