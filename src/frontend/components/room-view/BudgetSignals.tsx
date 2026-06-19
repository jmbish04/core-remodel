import { Banknote, DollarSign, ListChecks, ReceiptText } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BudgetCharts } from "./BudgetCharts";
import { BudgetTable } from "./budget-table";
import { formatCurrency, ROOM_SECTION_IDS, type RoomDetailPayload } from "./types";

/**
 * BudgetSignals — full-width budget section (T3.5 / IMPLEMENTATION_PLAN §7.5).
 *
 * Layout (top → bottom):
 *   1. A row of budget stat cards derived from `detail.budget` (range, item
 *      count, count needing decisions, total estimated mid-point).
 *   2. A LIVE, paginated, searchable, status-filterable budget-items table
 *      ({@link BudgetTable}) that fetches from
 *      `GET /api/rooms/:roomId/budget-items?search=&status=&page=&pageSize=`.
 *      No mock data — the table is the source of truth for the row list.
 *   3. The estimate-revisions list (from `detail.estimates`) under the
 *      `estimates` anchor.
 *
 * ANCHORS (fixed contract from Round 3a — DO NOT remove):
 *   - root keeps `id={ROOM_SECTION_IDS.budget}` ("budget-signals")
 *   - an inner block keeps `id={ROOM_SECTION_IDS.estimates}` ("estimates")
 * Both are stat-card smooth-scroll targets, so they must always be present even
 * when their data is empty.
 *
 * Orchestrator contract: mounted with `{ roomCode, detail }`; props unchanged.
 * The stat cards read the synchronous `detail.budget` aggregate (cheap, always
 * present), while the interactive table fetches fresh on mount so search/filter/
 * pagination reflect the live server rather than the page-load snapshot.
 *
 * Monolith styling: ring/divide/bg-card separation, dark palette, no 1px
 * structural borders.
 */
export interface BudgetSignalsProps {
  roomCode: string;
  detail: RoomDetailPayload;
}

/** Shape of the project-budget overview (from /api/budget-tracker/overview). */
interface BudgetOverviewPayload {
  items?: { total?: number; mustNow?: { low?: number; high?: number } };
  funds?: { totalAllottedCents?: number };
}

/** A compact, reusable stat tile for the budget stat-card row. */
function BudgetStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-muted/20 px-4 py-4 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-xs uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-2 text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function BudgetSignals({ roomCode, detail }: BudgetSignalsProps) {
  const { budget, estimates } = detail;
  const hasBudget = budget.items.length > 0;

  // Project-level budget mid-point for the pie chart.
  const [projectBudgetMidCents, setProjectBudgetMidCents] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/budget-tracker/overview", { credentials: "include" });
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as BudgetOverviewPayload;
        // Build mid-point from must_now range (the core plan), since that's what
        // rooms are budgeted against. Fall back to totalAllottedCents if missing.
        const mustNow = payload.items?.mustNow;
        if (mustNow && typeof mustNow.low === "number" && typeof mustNow.high === "number") {
          setProjectBudgetMidCents(Math.round((mustNow.low + mustNow.high) / 2));
        } else if (typeof payload.funds?.totalAllottedCents === "number" && payload.funds.totalAllottedCents > 0) {
          setProjectBudgetMidCents(payload.funds.totalAllottedCents);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Derived stat-card values. These read the synchronous detail aggregate so the
  // cards paint instantly; the table below fetches its own paginated slice.
  const stats = useMemo(() => {
    const lowTotal = budget.totalBudgetLowCents;
    const highTotal = budget.totalBudgetHighCents;
    const midTotal =
      typeof lowTotal === "number" && typeof highTotal === "number"
        ? Math.round((lowTotal + highTotal) / 2)
        : null;

    // "Needs a decision" = items not yet resolved (anything other than
    // approved/done), a useful at-a-glance signal of outstanding budget work.
    const openCount = budget.items.filter(
      (item) => item.status !== "approved" && item.status !== "done",
    ).length;

    return {
      rangeLabel: hasBudget
        ? `${formatCurrency(lowTotal)} – ${formatCurrency(highTotal)}`
        : "No range yet",
      itemCount: budget.items.length,
      openCount,
      midLabel: midTotal != null ? formatCurrency(midTotal) : "n/a",
    };
  }, [budget, hasBudget]);

  return (
    <Card id={ROOM_SECTION_IDS.budget} className="scroll-mt-24 ring-1 ring-foreground/10">
      <CardHeader>
        <div className="flex items-center gap-2">
          <DollarSign className="size-4 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">Budget Signals</CardTitle>
            <CardDescription>
              Budget tracker rows and room-specific cost ranges
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Stat-card row. */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BudgetStat
            icon={<Banknote className="size-4" />}
            label="Room Range"
            value={stats.rangeLabel}
            hint="Low – high across linked items"
          />
          <BudgetStat
            icon={<ListChecks className="size-4" />}
            label="Budget Items"
            value={String(stats.itemCount)}
            hint={`${stats.openCount} need a decision`}
          />
          <BudgetStat
            icon={<DollarSign className="size-4" />}
            label="Estimated Mid-point"
            value={stats.midLabel}
            hint="Midpoint of the room range"
          />
          <BudgetStat
            icon={<ReceiptText className="size-4" />}
            label="Estimate Revisions"
            value={String(estimates.length)}
            hint="Vendor estimate versions"
          />
        </div>

        {/* ── Charts ─────────────────────────────────────────────── */}
        {hasBudget && (
          <BudgetCharts
            items={budget.items}
            totalBudgetLowCents={budget.totalBudgetLowCents}
            totalBudgetHighCents={budget.totalBudgetHighCents}
            projectBudgetMidCents={projectBudgetMidCents}
            roomDisplayName={detail.room.displayName}
          />
        )}

        {/* Live, paginated/searchable/filterable budget-items table. */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Budget Items
          </p>
          <BudgetTable roomId={detail.room.id} />
        </div>

        {/* Estimate revisions sub-section (anchored for the stats-row deep link). */}
        <div id={ROOM_SECTION_IDS.estimates} className="space-y-3 scroll-mt-24">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Estimate Revisions
          </p>
          {estimates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No estimate revisions are linked yet.</p>
          ) : (
            <div className="space-y-3">
              {estimates.map((estimate) => (
                <div
                  key={`${estimate.estimateId}-${estimate.id}`}
                  className="rounded-xl bg-card/40 p-4 ring-1 ring-foreground/10"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        {estimate.companyName || "Estimate"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Revision {estimate.revisionNumber} •{" "}
                        {estimate.statusName || "Status pending"}
                      </p>
                    </div>
                    {typeof estimate.totalAmountCents === "number" ? (
                      <Badge variant="outline">
                        {formatCurrency(estimate.totalAmountCents)}
                      </Badge>
                    ) : null}
                  </div>
                  {estimate.sourceSummary ? (
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {estimate.sourceSummary}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default BudgetSignals;
