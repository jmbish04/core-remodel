/**
 * @fileoverview Shared helpers for the Budget MCP tools.
 *
 * MONEY — all amounts are integer cents end-to-end (the `*Cents` columns).
 * Output objects echo both the raw `*Cents` integer and a human `$` string via
 * `formatCents` so agents never have to divide by 100 themselves.
 */
import { budgetExpenseEntries, budgetTrackerItems } from "@backend/db";
import { and, eq } from "drizzle-orm";

import { formatCents } from "../../format";
import { type RemodelDb } from "../../types";

/** Shape a budget tracker item revision for tool output (money as cents + `$`). */
export function budgetItemDto(b: typeof budgetTrackerItems.$inferSelect) {
  return {
    id: b.id,
    trackId: b.trackId,
    revisionNumber: b.revisionNumber,
    isActive: b.isActive,
    title: b.title,
    description: b.description,
    status: b.status,
    itemType: b.itemType,
    executionClass: b.executionClass,
    scenarioId: b.scenarioId,
    estimatedLowCents: b.estimatedLowCents,
    estimatedHighCents: b.estimatedHighCents,
    estimatedLow: formatCents(b.estimatedLowCents),
    estimatedHigh: formatCents(b.estimatedHighCents),
  };
}

/** Shape an expense entry revision for tool output (money as cents + `$`). */
export function expenseDto(e: typeof budgetExpenseEntries.$inferSelect) {
  return {
    id: e.id,
    trackId: e.trackId,
    revisionNumber: e.revisionNumber,
    isActive: e.isActive,
    item: e.item,
    category: e.category,
    amountCents: e.amountCents,
    amount: formatCents(e.amountCents),
    vendorName: e.vendorName,
    dateIncurred: e.dateIncurred ? e.dateIncurred.toISOString() : null,
    sourceType: e.sourceType,
    sourceRef: e.sourceRef,
    scenarioId: e.scenarioId,
  };
}

/** Load the current (active) budget item revision by numeric id or stable trackId. */
export async function activeBudgetItem(
  db: RemodelDb,
  by: { id?: number; trackId?: string },
): Promise<typeof budgetTrackerItems.$inferSelect | undefined> {
  if (by.id != null) {
    const [row] = await db.select().from(budgetTrackerItems).where(eq(budgetTrackerItems.id, by.id)).limit(1);
    return row;
  }
  if (by.trackId) {
    const [row] = await db
      .select()
      .from(budgetTrackerItems)
      .where(and(eq(budgetTrackerItems.trackId, by.trackId), eq(budgetTrackerItems.isActive, true)))
      .limit(1);
    return row;
  }
  return undefined;
}
