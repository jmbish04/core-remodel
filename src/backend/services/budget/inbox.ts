import type { DrizzleD1Database } from "drizzle-orm/d1";

/**
 * @fileoverview Phase 4 budget workbench — decision-inbox alert derivation.
 *
 * Single source of truth for the "what needs my attention" list, shared by
 * `GET /api/budget/inbox` (`src/backend/api/routes/budget-workbench.ts`) and
 * the `get_budget_inbox` MCP tool (`mcp/tools/budget/get_budget_inbox.ts`) —
 * same pattern as `services/budget/grid.ts` feeding both `GET /grid` and
 * `get_budget_grid`.
 *
 * Every alert is DERIVED from a live query, never fabricated: an alert type
 * is omitted entirely when its source set is empty (no "0 issues" alert).
 */
import { budgetFundingAccounts, budgetTrackerItems, estimateLineItems } from "@backend/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { loadRoomsFinance } from "./rooms-finance";

export type AlertSeverity = "critical" | "warning" | "info";

export type BudgetAlert = {
  /** Stable id — a bare type for singleton alerts, `type:entityId` for one-per-entity alerts. */
  id: string;
  type: "unmapped_estimate" | "over_range" | "no_funding" | "unphased_items";
  severity: AlertSeverity;
  title: string;
  detail: string;
  entity: Record<string, unknown>;
  action: { label: string; target: string };
};

export type BudgetInbox = { alerts: BudgetAlert[] };

/** Sort key — higher first. Not exported: an implementation detail of the derivation order below. */
const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 3, warning: 2, info: 1 };

/** Format an integer cents value as `$1,234.56` — local copy, avoids reaching into the MCP-only `mcp/format.ts`. */
function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Derive the decision-inbox alert list. Generic over `TSchema` for the same
 * reason as `loadBudgetGrid`/`loadRoomsFinance` — the MCP transport's
 * schema-less `drizzle()` client resolves against a wider schema param.
 */
export async function loadBudgetInbox<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(db: DrizzleD1Database<TSchema>): Promise<BudgetInbox> {
  const [unmappedLines, roomsFinance, fundingAccounts, unphasedItems] = await Promise.all([
    db
      .select({ id: estimateLineItems.id })
      .from(estimateLineItems)
      .where(inArray(estimateLineItems.mappingStatus, ["unmapped", "ai_suggested"]))
      .all(),
    loadRoomsFinance(db),
    db.select({ amountCents: budgetFundingAccounts.amountCents }).from(budgetFundingAccounts).all(),
    db
      .select({ id: budgetTrackerItems.id })
      .from(budgetTrackerItems)
      .where(and(eq(budgetTrackerItems.isActive, true), isNull(budgetTrackerItems.phaseId)))
      .all(),
  ]);

  const alerts: BudgetAlert[] = [];

  // --- unmapped_estimate: estimate lines still needing a room/budget mapping.
  if (unmappedLines.length > 0) {
    const n = unmappedLines.length;
    alerts.push({
      id: "unmapped_estimate",
      type: "unmapped_estimate",
      severity: "warning",
      title: `${n} estimate line item${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} room mapping`,
      detail: `${n} line item(s) are unmapped or only AI-suggested — confirm the room to fold them into the budget.`,
      entity: { type: "estimate_line_items", count: n },
      action: { label: "Open reconciliation queue", target: "/admin/budget/reconcile" },
    });
  }

  // --- over_range: one alert PER room that has blown past its committed midpoint.
  for (const room of roomsFinance.rooms) {
    if (room.spentCents > room.committedCents && room.committedCents > 0) {
      alerts.push({
        id: `over_range:${room.roomId}`,
        type: "over_range",
        severity: "critical",
        title: `${room.roomName} is over budget`,
        detail: `Spent ${formatCents(room.spentCents)} against ${formatCents(room.committedCents)} committed.`,
        entity: { type: "room", id: room.roomId, name: room.roomName },
        action: { label: "Review room budget", target: `/admin/budget/grid?roomId=${room.roomId}` },
      });
    }
  }

  // --- no_funding: money is going out but no funding account has been set up.
  const totalFundingCents = fundingAccounts.reduce((sum, f) => sum + f.amountCents, 0);
  const totalSpentCents = roomsFinance.totals.spentCents;
  if (totalFundingCents === 0 && totalSpentCents > 0) {
    alerts.push({
      id: "no_funding",
      type: "no_funding",
      severity: "critical",
      title: "No funding source configured",
      detail: `${formatCents(totalSpentCents)} has been spent but zero funding accounts are set up.`,
      entity: { type: "budget_funding_accounts", count: fundingAccounts.length },
      action: { label: "Set up funding", target: "/admin/budget/grid" },
    });
  }

  // --- unphased_items: active budget items with no build-phase assignment.
  if (unphasedItems.length > 0) {
    const n = unphasedItems.length;
    alerts.push({
      id: "unphased_items",
      type: "unphased_items",
      severity: "info",
      title: `${n} budget item${n === 1 ? "" : "s"} unphased`,
      detail: `${n} active budget item(s) have no build phase assigned yet.`,
      entity: { type: "budget_tracker_items", count: n },
      action: { label: "Assign phases in the grid", target: "/admin/budget/grid" },
    });
  }

  alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return { alerts };
}
