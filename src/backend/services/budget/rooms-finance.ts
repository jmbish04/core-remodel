import type { DrizzleD1Database } from "drizzle-orm/d1";

/**
 * @fileoverview Phase 4 budget workbench — per-room finance rollup.
 *
 * Single source of truth for turning committed (estimated) vs spent (actual)
 * money into a per-room picture, plus an open-materials count. Extracted as a
 * service (mirrors `services/budget/grid.ts`) so `GET /api/budget/rooms-finance`
 * (`src/backend/api/routes/budget-workbench.ts`) and the inbox service
 * (`services/budget/inbox.ts`, which needs the per-room over-budget check)
 * both read the exact same rollup — no second copy of the aggregation.
 *
 * SQL approach: full active-row table scans (rooms, active
 * budget_tracker_items, budget_tracker_item_rooms, active budget_expense_entries,
 * active material_schedule_items) with NO `inArray()` — every row already
 * carries its own `roomId` (or room link), so the group-by is a plain JS `Map`
 * reduction, matching the `byRoomMap`/`byCategoryMap` idiom already used in
 * `mcp/tools/analytics/get_budget_report.ts`. This is a single home
 * renovation (dozens of rooms/items, not thousands), so full scans stay
 * nowhere near D1's 100-bound-param cap — chunking would be dead code here.
 */
import {
  budgetExpenseEntries,
  budgetTrackerItemRooms,
  budgetTrackerItems,
  materialScheduleItems,
  rooms,
} from "@backend/db";
import { eq } from "drizzle-orm";

export type RoomFinance = {
  roomId: number;
  roomName: string;
  committedCents: number;
  spentCents: number;
  remainingCents: number;
  openMaterials: number;
  riskLevel: "over" | "watch" | "ok";
};

export type RoomsFinance = {
  rooms: RoomFinance[];
  totals: {
    committedCents: number;
    spentCents: number;
    remainingCents: number;
    openMaterials: number;
  };
};

/**
 * Midpoint of an estimate range. Falls back to whichever bound is present
 * (mirrors the same fallback used when seeding the plan schedule in
 * `budget-grid.ts`'s `/grid/seed`); returns 0 when neither bound is set.
 */
function midpointCents(low: number | null, high: number | null): number {
  if (low == null && high == null) return 0;
  if (low == null) return high as number;
  if (high == null) return low;
  return Math.round((low + high) / 2);
}

/** 'over' if spending has blown past a nonzero commitment, 'watch' at 80%+, else 'ok'. */
function riskLevel(spentCents: number, committedCents: number): RoomFinance["riskLevel"] {
  if (committedCents === 0 && spentCents > 0) return "over"; // spend against zero commitment is over-budget
  if (spentCents > committedCents && committedCents > 0) return "over";
  if (spentCents > 0.8 * committedCents) return "watch";
  return "ok";
}

/**
 * Load the per-room committed/spent/remaining/open-materials rollup for every
 * active room. Generic over `TSchema` for the same reason as
 * `loadBudgetGrid` — the MCP transport's schema-less `drizzle()` client can
 * resolve against `DrizzleD1Database<Record<string, unknown>>` instead of the
 * default `Record<string, never>>`.
 */
export async function loadRoomsFinance<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(db: DrizzleD1Database<TSchema>): Promise<RoomsFinance> {
  const [activeRooms, activeItems, itemRoomLinks, activeExpenses, activeMaterials] =
    await Promise.all([
      db
        .select({ id: rooms.id, roomName: rooms.roomName })
        .from(rooms)
        .where(eq(rooms.isActive, true))
        .all(),
      db
        .select({
          id: budgetTrackerItems.id,
          estimatedLowCents: budgetTrackerItems.estimatedLowCents,
          estimatedHighCents: budgetTrackerItems.estimatedHighCents,
        })
        .from(budgetTrackerItems)
        .where(eq(budgetTrackerItems.isActive, true))
        .all(),
      db.select().from(budgetTrackerItemRooms).all(),
      db
        .select({
          roomId: budgetExpenseEntries.roomId,
          amountCents: budgetExpenseEntries.amountCents,
        })
        .from(budgetExpenseEntries)
        .where(eq(budgetExpenseEntries.isActive, true))
        .all(),
      db
        .select({
          roomId: materialScheduleItems.roomId,
          isPurchased: materialScheduleItems.isPurchased,
        })
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.isActive, true))
        .all(),
    ]);

  const itemById = new Map(activeItems.map((item) => [item.id, item]));

  // committedCents: the FULL midpoint per room LINK — an item mapped to two
  // rooms contributes its whole midpoint to each (no splitting). Mirrors
  // get_budget_report.ts's `byRoomMap` aggregation, same M:N shape.
  //
  // ponytail: known limitation — an item mapped to N rooms gives each room
  // the full commitment, so a per-room over/watch check can under-trigger
  // vs the portfolio total (which counts that item's midpoint once). See
  // `totals` below, computed independently from the room split for this
  // reason, and `inbox.ts`'s over_range alert which has the same caveat.
  const committedByRoom = new Map<number, number>();
  for (const link of itemRoomLinks) {
    const item = itemById.get(link.budgetTrackerItemId);
    if (!item) continue; // link points at an inactive/superseded item revision
    const mid = midpointCents(item.estimatedLowCents, item.estimatedHighCents);
    committedByRoom.set(link.roomId, (committedByRoom.get(link.roomId) ?? 0) + mid);
  }

  const spentByRoom = new Map<number, number>();
  for (const expense of activeExpenses) {
    if (expense.roomId == null) continue; // portfolio/category-level expense, not room-attributed
    spentByRoom.set(expense.roomId, (spentByRoom.get(expense.roomId) ?? 0) + expense.amountCents);
  }

  const openMaterialsByRoom = new Map<number, number>();
  for (const material of activeMaterials) {
    if (material.isPurchased) continue; // "open" = not yet purchased (false or null both count)
    openMaterialsByRoom.set(material.roomId, (openMaterialsByRoom.get(material.roomId) ?? 0) + 1);
  }

  const roomsOut: RoomFinance[] = activeRooms.map((room) => {
    const committedCents = committedByRoom.get(room.id) ?? 0;
    const spentCents = spentByRoom.get(room.id) ?? 0;
    return {
      roomId: room.id,
      roomName: room.roomName,
      committedCents,
      spentCents,
      remainingCents: committedCents - spentCents,
      openMaterials: openMaterialsByRoom.get(room.id) ?? 0,
      riskLevel: riskLevel(spentCents, committedCents),
    };
  });

  // Totals are computed DIRECTLY from the active source arrays, independent
  // of the per-room split above — summing the room rows instead would (a)
  // double-count an item's commitment once per room it's linked to, and
  // (b) drop portfolio-level (roomId=null) expenses/materials entirely.
  const committedCents = activeItems.reduce(
    (sum, item) => sum + midpointCents(item.estimatedLowCents, item.estimatedHighCents),
    0,
  );
  const spentCents = activeExpenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const openMaterials = activeMaterials.reduce(
    (count, material) => count + (material.isPurchased ? 0 : 1),
    0,
  );
  const totals = {
    committedCents,
    spentCents,
    remainingCents: committedCents - spentCents,
    openMaterials,
  };

  return { rooms: roomsOut, totals };
}
