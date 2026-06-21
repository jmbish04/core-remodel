import { ClipboardList, DollarSign, FileStack, Loader2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { Cell, Label, Pie, PieChart } from "recharts";

import { Badge } from "@/components/ui/badge";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import {
  formatCurrency,
  ROOM_SECTION_IDS,
  type ActionItemRecord,
  type RoomDetailPayload,
  type TaskStats,
} from "./types";

/**
 * RoomStatsRow (T3.2) — three clickable stat cards directly below the hero.
 *
 * All values are LIVE (no mock data):
 *   1. Budget Range — the room's low–high range from the detail payload, plus a
 *      sub-stat showing the room midpoint as a % of the total project budget
 *      when that total is derivable.
 *   2. Estimate count — number of estimate revisions in the detail payload.
 *   3. Task Progress — a donut driven by `GET /api/planning/tasks/stats?roomId=`
 *      ({open,in_progress,blocked,delayed,done,total}); if the room has zero
 *      planning tasks the card falls back to the room's `actionItems`
 *      (done = status "done"/"complete").
 *
 * Clicking a card smooth-scrolls to its section anchor (budget-signals /
 * estimates / tasks) using the shared `ROOM_SECTION_IDS`.
 *
 * Charts follow the Monolith rule: recharts wrapped in shadcn `ChartContainer`
 * with the OKLCH `--chart-N` palette; the center label is forced to
 * `fill-foreground`.
 */
export interface RoomStatsRowProps {
  detail: RoomDetailPayload;
  /** Total project budget midpoint in cents, when known, for the % sub-stat. */
  projectBudgetMidCents?: number | null;
}

/** Buckets a room's action items into done/total when used as a task fallback. */
function actionItemsToProgress(actionItems: ActionItemRecord[]): { done: number; total: number } {
  const total = actionItems.length;
  const done = actionItems.filter((item) => {
    const status = item.status?.toLowerCase() ?? "";
    return status === "done" || status === "complete" || status === "completed";
  }).length;
  return { done, total };
}

/** Smoothly scrolls to a section id without changing the URL hash history. */
function scrollToSection(id: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

const TASK_CHART_CONFIG: ChartConfig = {
  done: { label: "Done", color: "var(--chart-1)" },
  in_progress: { label: "In progress", color: "var(--chart-2)" },
  blocked: { label: "Blocked", color: "var(--chart-3)" },
  delayed: { label: "Delayed", color: "var(--chart-4)" },
  open: { label: "Open", color: "var(--chart-5)" },
};

export function RoomStatsRow({ detail, projectBudgetMidCents }: RoomStatsRowProps) {
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [taskLoading, setTaskLoading] = useState(true);

  // Pull live planning-task stats scoped to this room. A failure is non-fatal:
  // the card silently falls back to action items so the page never half-breaks.
  useEffect(() => {
    let cancelled = false;
    setTaskLoading(true);
    void (async () => {
      try {
        const response = await fetch(
          `/api/planning/tasks/stats?roomId=${encodeURIComponent(String(detail.room.id))}`,
          { credentials: "include" },
        );
        const payload = (await response.json()) as { success?: boolean; stats?: TaskStats };
        if (!cancelled && response.ok && payload.success && payload.stats) {
          setTaskStats(payload.stats);
        }
      } catch {
        // Swallow → fallback path handles the empty case; nothing user-facing.
      } finally {
        if (!cancelled) setTaskLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.room.id]);

  // Budget range + % of project.
  const hasBudget = detail.budget.items.length > 0;
  const budgetLabel = hasBudget
    ? `${formatCurrency(detail.budget.totalBudgetLowCents)} – ${formatCurrency(detail.budget.totalBudgetHighCents)}`
    : "No range yet";
  const roomMidCents = hasBudget
    ? Math.round((detail.budget.totalBudgetLowCents + detail.budget.totalBudgetHighCents) / 2)
    : 0;
  const budgetPct =
    hasBudget && projectBudgetMidCents && projectBudgetMidCents > 0
      ? Math.round((roomMidCents / projectBudgetMidCents) * 100)
      : null;

  // Task progress: prefer planning tasks, else action items.
  const usingPlanning = (taskStats?.total ?? 0) > 0;
  const fallback = useMemo(() => actionItemsToProgress(detail.actionItems), [detail.actionItems]);
  const progressTotal = usingPlanning ? taskStats!.total : fallback.total;
  const progressDone = usingPlanning ? taskStats!.done : fallback.done;
  const progressPct = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;

  // Donut data: each non-zero status bucket becomes a slice. When no tasks
  // exist we render a single muted ring so the card still reads as a chart.
  const donutData = useMemo(() => {
    if (usingPlanning && taskStats) {
      return [
        { key: "done", value: taskStats.done },
        { key: "in_progress", value: taskStats.in_progress },
        { key: "blocked", value: taskStats.blocked },
        { key: "delayed", value: taskStats.delayed },
        { key: "open", value: taskStats.open },
      ].filter((slice) => slice.value > 0);
    }
    if (fallback.total > 0) {
      return [
        { key: "done", value: fallback.done },
        { key: "open", value: fallback.total - fallback.done },
      ].filter((slice) => slice.value > 0);
    }
    return [];
  }, [fallback, taskStats, usingPlanning]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {/* Budget Range. */}
      <StatCard
        targetId={ROOM_SECTION_IDS.budget}
        icon={<DollarSign className="size-4" />}
        label="Budget Range"
      >
        <p className="text-2xl font-semibold tracking-tight">{budgetLabel}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{detail.budget.items.length} budget items</Badge>
          {budgetPct != null ? (
            <Badge variant="outline">{budgetPct}% of project budget</Badge>
          ) : null}
        </div>
      </StatCard>

      {/* Estimate count. */}
      <StatCard
        targetId={ROOM_SECTION_IDS.estimates}
        icon={<FileStack className="size-4" />}
        label="Estimate Revisions"
      >
        <p className="text-2xl font-semibold tracking-tight">{detail.estimates.length}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {detail.estimates.length === 0
            ? "No estimate revisions linked yet"
            : "Latest contractor estimate revisions for this room"}
        </p>
      </StatCard>

      {/* Task Progress donut. */}
      <StatCard
        targetId={ROOM_SECTION_IDS.tasks}
        icon={<ClipboardList className="size-4" />}
        label="Task Progress"
      >
        <div className="flex items-center gap-4">
          <div className="relative size-24 shrink-0">
            {taskLoading ? (
              <div className="flex size-full items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : donutData.length > 0 ? (
              <ChartContainer
                config={TASK_CHART_CONFIG}
                className="aspect-square size-24"
                initialDimension={{ width: 96, height: 96 }}
              >
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="key"
                    innerRadius={30}
                    outerRadius={46}
                    strokeWidth={0}
                    startAngle={90}
                    endAngle={-270}
                  >
                    {donutData.map((slice) => (
                      <Cell key={slice.key} fill={`var(--color-${slice.key})`} />
                    ))}
                    <Label
                      position="center"
                      className="fill-foreground"
                      content={({ viewBox }) => {
                        if (!viewBox || !("cx" in viewBox)) return null;
                        return (
                          <text
                            x={viewBox.cx}
                            y={viewBox.cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            className="fill-foreground"
                          >
                            <tspan className="fill-foreground text-base font-semibold">
                              {progressPct}%
                            </tspan>
                          </text>
                        );
                      }}
                    />
                  </Pie>
                </PieChart>
              </ChartContainer>
            ) : (
              <div className="flex size-full items-center justify-center rounded-full bg-muted/30 text-xs text-muted-foreground">
                0%
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-semibold tracking-tight">
              {progressDone}/{progressTotal}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {progressTotal === 0
                ? "No tasks tracked yet"
                : usingPlanning
                  ? "Planning tasks complete"
                  : "Action items complete"}
            </p>
          </div>
        </div>
      </StatCard>
    </div>
  );
}

/**
 * A single clickable stat card. Rendered as a real `<button>` (styled like the
 * shadcn Card surface: `bg-card` + `ring-1 ring-foreground/10`, no 1px border)
 * so it is keyboard- and screen-reader-accessible; clicking smooth-scrolls to
 * `targetId`.
 */
function StatCard(props: {
  targetId: string;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  const { targetId, icon, label, children } = props;
  return (
    <button
      type="button"
      onClick={() => scrollToSection(targetId)}
      aria-label={`Jump to ${label}`}
      className={cn(
        "flex w-full cursor-pointer flex-col rounded-xl bg-card p-4 text-left text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-3">{children}</div>
    </button>
  );
}

export default RoomStatsRow;
