/**
 * @fileoverview MCP tools — Budget analytics.
 *
 * `get_budget_report` answers "are we below / at / over budget?" and
 * `get_reallocation_options` helps answer "I saved $X — where should it go?".
 *
 * SCHEMA REALITY: actual expenses (`budget_expense_entries`) are NOT
 * foreign-keyed to budget line items (`budget_tracker_items`) — they only share
 * a free-text `category` (and optional `optionGroup`). So attribution of
 * actuals is honest at the PORTFOLIO and CATEGORY level, not per line item.
 * Estimates roll up per room via the `budget_tracker_item_rooms` join. Each
 * tool's output states its attribution level so the agent doesn't over-claim.
 */
import {
  budgetExpenseEntries,
  budgetFundingAccounts,
  budgetTrackerItemRooms,
  budgetTrackerItems,
  materialScheduleItems,
  rooms,
} from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { formatCents, num } from "../format";
import { looseObject } from "../schemas";
import { READ_ONLY, defineTool, type RemodelTool } from "../types";

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

export const analyticsTools: RemodelTool[] = [
  defineTool({
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
  }),

  defineTool({
    name: "get_reallocation_options",
    category: "budget",
    title: "Reallocation options for a saving",
    description:
      "Given a saving (e.g. you spent less than budgeted on the fridge), surface candidate places to apply it: active, not-yet-done budget items ranked by estimated ceiling, optionally filtered to a room, plus rooms that still have unpurchased materials. This returns DATA for you to advise on — it does not move any money. Apply a decision with update_budget_item.",
    inputShape: {
      savedCents: z.number().int().describe("The amount saved, in cents (informational)"),
      focusRoomId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Restrict candidate budget items to this room"),
      limit: z.number().int().positive().max(50).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      saving: z.string(),
      savingCents: z.number().int(),
      note: z.string(),
      candidateBudgetItems: z.array(
        looseObject({
          id: z.number().int(),
          trackId: z.string(),
          title: z.string().nullable(),
          status: z.string().nullable(),
          executionClass: z.string().nullable(),
          estimatedHigh: z.string(),
          estimatedHighCents: z.number().int(),
          rooms: z.array(z.string()),
        }),
      ),
      roomsNeedingMaterials: z.array(
        looseObject({
          room: z.string(),
          unpurchasedMaterials: z.number().int(),
        }),
      ),
    },
    examples: [
      { title: "Where to apply $5,000", args: { savedCents: 500000 } },
      { title: "Into the primary bath", args: { savedCents: 500000, focusRoomId: 3 } },
    ],
    handler: async ({ db }, input) => {
      const savedCents = num(input.savedCents) ?? 0;
      const limit = input.limit ?? 15;

      const [items, itemRooms, materials, allRooms] = await Promise.all([
        db.select().from(budgetTrackerItems).where(eq(budgetTrackerItems.isActive, true)).all(),
        db.select().from(budgetTrackerItemRooms).all(),
        db.select().from(materialScheduleItems).all(),
        db.select().from(rooms).where(eq(rooms.isActive, true)).all(),
      ]);
      const roomName = new Map(allRooms.map((r) => [r.id, r.roomName]));

      // roomId set per budget item (for optional focus filtering).
      const roomsByItem = new Map<number, number[]>();
      for (const l of itemRooms) {
        const arr = roomsByItem.get(l.budgetTrackerItemId) ?? [];
        arr.push(l.roomId);
        roomsByItem.set(l.budgetTrackerItemId, arr);
      }

      const candidates = items
        .filter((i) => i.status !== "done" && !i.isDraft)
        .filter((i) =>
          input.focusRoomId == null
            ? true
            : (roomsByItem.get(i.id) ?? []).includes(input.focusRoomId),
        )
        .map((i) => ({
          id: i.id,
          trackId: i.trackId,
          title: i.title,
          status: i.status,
          executionClass: i.executionClass,
          estimatedHigh: formatCents(i.estimatedHighCents),
          estimatedHighCents: i.estimatedHighCents ?? 0,
          rooms: (roomsByItem.get(i.id) ?? []).map((rid) => roomName.get(rid) ?? `room ${rid}`),
        }))
        .sort((a, b) => b.estimatedHighCents - a.estimatedHighCents)
        .slice(0, limit);

      // Rooms with unpurchased materials — natural places for extra budget.
      const unpurchasedByRoom = new Map<string, number>();
      for (const m of materials) {
        if (m.isPurchased) continue;
        const key = m.roomName ?? (m.roomId != null ? roomName.get(m.roomId) ?? "" : "");
        if (!key) continue;
        unpurchasedByRoom.set(key, (unpurchasedByRoom.get(key) ?? 0) + 1);
      }
      const roomsNeedingMaterials = [...unpurchasedByRoom.entries()]
        .map(([room, count]) => ({ room, unpurchasedMaterials: count }))
        .sort((a, b) => b.unpurchasedMaterials - a.unpurchasedMaterials);

      return {
        saving: formatCents(savedCents),
        savingCents: savedCents,
        note: "Advisory only — apply a decision with update_budget_item (adjust estimatedLow/HighCents).",
        candidateBudgetItems: candidates,
        roomsNeedingMaterials,
      };
    },
  }),
];
