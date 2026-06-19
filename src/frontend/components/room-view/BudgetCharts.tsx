/**
 * BudgetCharts.tsx — shadcn/recharts-based charts for the BudgetSignals section.
 *
 * 1. **Horizontal Bar Chart** — breaks down the room budget range by item.
 *    Each bar shows the estimated mid-point, with the datum label rendered
 *    inside the bar (amount + pct).
 *
 * 2. **Pie Chart** — shows how this room's budget share compares to the full
 *    project-level budget. The current room slice is "exploded" outward.
 *    Outer labels show pct with connecting lines.
 *
 * All colors use the global monochromatic blue palette (--chart-1 … --chart-10)
 * set in global.css. No rainbow colors.
 *
 * Monolith styling: ring-1 ring-foreground/10, bg-card, no traditional borders.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { DollarSign, PieChartIcon, TrendingDown, TrendingUp } from "lucide-react";
import { formatCurrency, type BudgetItemRecord } from "./types";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Blue palette slots. Loops over these when items exceed 10. */
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
] as const;

/** Returns a chart color from the blue palette, cycling through. */
function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function centsToK(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${Math.round(dollars).toLocaleString()}`;
}

/** Truncates a title to `maxLen` chars, adding an ellipsis when clipped. */
function truncateTitle(title: string, maxLen = 30): string {
  if (title.length <= maxLen) return title;
  return `${title.slice(0, maxLen - 1)}…`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface BarDatum {
  name: string;
  fullName: string;
  midCents: number;
  midDollars: number;
  pct: number;
  fill: string;
}

interface PieSlice {
  name: string;
  midCents: number;
  midDollars: number;
  pct: number;
  fill: string;
  isCurrentRoom: boolean;
}

export interface BudgetChartsProps {
  items: BudgetItemRecord[];
  totalBudgetLowCents: number;
  totalBudgetHighCents: number;
  /** Full project budget (all rooms) mid-point in cents, if available. */
  projectBudgetMidCents?: number | null;
  /** The display name of the current room. */
  roomDisplayName: string;
}

// ─── Stat Scorecard ─────────────────────────────────────────────────────────

function ScoreCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/20 px-4 py-3 ring-1 ring-foreground/10">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <span className="text-lg font-bold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function BudgetCharts({
  items,
  totalBudgetLowCents,
  totalBudgetHighCents,
  projectBudgetMidCents,
  roomDisplayName,
}: BudgetChartsProps) {
  // ── Derived data ────────────────────────────────────────────────────────

  const roomMidCents = useMemo(
    () => Math.round((totalBudgetLowCents + totalBudgetHighCents) / 2),
    [totalBudgetLowCents, totalBudgetHighCents],
  );

  const barData: BarDatum[] = useMemo(() => {
    if (items.length === 0) return [];
    const mapped = items.map((item, idx) => {
      const low = item.estimatedLowCents ?? 0;
      const high = item.estimatedHighCents ?? 0;
      const mid = Math.round((low + high) / 2);
      return {
        name: truncateTitle(item.title, 28),
        fullName: item.title,
        midCents: mid,
        midDollars: mid / 100,
        pct: 0, // computed below
        fill: chartColor(idx),
      };
    });
    const total = mapped.reduce((s, d) => s + d.midCents, 0) || 1;
    for (const d of mapped) {
      d.pct = Math.round((d.midCents / total) * 100);
    }
    // Sort descending so biggest items are at top of horizontal bar chart.
    mapped.sort((a, b) => b.midCents - a.midCents);
    return mapped;
  }, [items]);

  // ── Pie data ────────────────────────────────────────────────────────────

  const pieData: PieSlice[] = useMemo(() => {
    // If we don't have a project-level budget to compare against, skip pie.
    if (!projectBudgetMidCents || projectBudgetMidCents <= 0) return [];
    const otherCents = Math.max(0, projectBudgetMidCents - roomMidCents);
    const total = projectBudgetMidCents || 1;
    const roomPct = Math.round((roomMidCents / total) * 100);
    const otherPct = 100 - roomPct;
    return [
      {
        name: roomDisplayName,
        midCents: roomMidCents,
        midDollars: roomMidCents / 100,
        pct: roomPct,
        fill: "var(--chart-1)",
        isCurrentRoom: true,
      },
      {
        name: "Other rooms",
        midCents: otherCents,
        midDollars: otherCents / 100,
        pct: otherPct,
        fill: "var(--chart-5)",
        isCurrentRoom: false,
      },
    ];
  }, [projectBudgetMidCents, roomMidCents, roomDisplayName]);

  // ── Chart configs ───────────────────────────────────────────────────────

  const barConfig: ChartConfig = useMemo(() => {
    const config: ChartConfig = {
      midDollars: { label: "Est. mid-point" },
    };
    for (const d of barData) {
      config[d.name] = { label: d.fullName, color: d.fill };
    }
    return config;
  }, [barData]);

  const pieConfig: ChartConfig = useMemo(() => {
    const config: ChartConfig = {
      midDollars: { label: "Budget share" },
    };
    for (const d of pieData) {
      config[d.name] = { label: d.name, color: d.fill };
    }
    return config;
  }, [pieData]);

  // ── Early bail ──────────────────────────────────────────────────────────

  if (items.length === 0) return null;

  // Chart height scales with item count, min 200, max 600.
  const barChartHeight = Math.min(600, Math.max(200, barData.length * 48));

  return (
    <div className="space-y-6">
      {/* ── Scorecards row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ScoreCard
          icon={<TrendingDown className="size-3.5" />}
          label="Low"
          value={formatCurrency(totalBudgetLowCents)}
        />
        <ScoreCard
          icon={<DollarSign className="size-3.5" />}
          label="Mid-point"
          value={formatCurrency(roomMidCents)}
        />
        <ScoreCard
          icon={<TrendingUp className="size-3.5" />}
          label="High"
          value={formatCurrency(totalBudgetHighCents)}
        />
        <ScoreCard
          icon={<PieChartIcon className="size-3.5" />}
          label="Items"
          value={String(items.length)}
        />
      </div>

      {/* ── Charts grid ──────────────────────────────────────────────── */}
      <div className={`grid gap-6 ${pieData.length > 0 ? "lg:grid-cols-3" : "lg:grid-cols-1"}`}>
        {/* Bar chart — 2/3 width when pie is present. */}
        <Card className={`ring-1 ring-foreground/10 ${pieData.length > 0 ? "lg:col-span-2" : ""}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Room Budget Breakdown</CardTitle>
            <CardDescription>
              Mid-point estimate per budget item · horizontal bars
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={barConfig}
              className="w-full"
              style={{ height: `${barChartHeight}px` }}
            >
              <BarChart
                data={barData}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                barCategoryGap="20%"
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--foreground)" }}
                />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => centsToK(v * 100)}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, _name, item) => {
                        const d = item.payload as BarDatum;
                        return (
                          <span className="font-medium tabular-nums text-foreground">
                            {formatCurrency(d.midCents)} ({d.pct}%)
                          </span>
                        );
                      }}
                      labelFormatter={(label) => {
                        // Find the full name for this truncated label
                        const found = barData.find((d) => d.name === label);
                        return found ? found.fullName : String(label);
                      }}
                    />
                  }
                />
                <Bar dataKey="midDollars" radius={[0, 6, 6, 0]}>
                  {barData.map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={entry.fill} />
                  ))}
                  <LabelList
                    dataKey="midCents"
                    position="insideRight"
                    formatter={(v: number) => {
                      const d = barData.find((item) => item.midCents === v);
                      if (!d) return centsToK(v);
                      return `${centsToK(v)} (${d.pct}%)`;
                    }}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      fill: "var(--foreground)",
                    }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Pie chart — project budget share. Only renders when project budget is known. */}
        {pieData.length > 0 && (
          <Card className="ring-1 ring-foreground/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Project Budget Share</CardTitle>
              <CardDescription>
                {roomDisplayName} vs. overall project
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center">
              <ChartContainer
                config={pieConfig}
                className="mx-auto aspect-square max-h-[260px] [&_.recharts-pie-label-text]:fill-foreground"
              >
                <PieChart>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, _name, item) => {
                          const d = item.payload as PieSlice;
                          return (
                            <span className="font-medium tabular-nums text-foreground">
                              {formatCurrency(d.midCents)} ({d.pct}%)
                            </span>
                          );
                        }}
                        hideLabel={false}
                        nameKey="name"
                      />
                    }
                  />
                  <Pie
                    data={pieData}
                    dataKey="midDollars"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, pct }: { name: string; pct: number }) =>
                      `${name} ${pct}%`
                    }
                    labelLine={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                  >
                    {pieData.map((entry, idx) => (
                      <Cell
                        key={`pie-${idx}`}
                        fill={entry.fill}
                        // "Explode" the current room slice outward
                        {...(entry.isCurrentRoom ? { style: { transform: "translate(6px, -4px)" } } : {})}
                        stroke="var(--background)"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              {/* Footer summary */}
              <div className="mt-3 flex flex-col items-center gap-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block size-2.5 rounded"
                    style={{ backgroundColor: "var(--chart-1)" }}
                  />
                  <span className="font-medium text-foreground">{roomDisplayName}</span>
                  <span className="tabular-nums">
                    {formatCurrency(roomMidCents)} ({pieData[0]?.pct ?? 0}%)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block size-2.5 rounded"
                    style={{ backgroundColor: "var(--chart-5)" }}
                  />
                  <span className="font-medium text-foreground">Other rooms</span>
                  <span className="tabular-nums">
                    {formatCurrency(pieData[1]?.midCents ?? 0)} ({pieData[1]?.pct ?? 0}%)
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default BudgetCharts;
