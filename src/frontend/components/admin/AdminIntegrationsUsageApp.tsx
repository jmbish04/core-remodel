/**
 * @fileoverview AdminIntegrationsUsageApp — read-only Google Maps API usage
 * monitor for the Admin · Integrations surface.
 *
 * Watches monthly Google Maps request volume against the 10,000-call free-tier
 * quota. Each primary endpoint (Places Autocomplete, Place Details) gets its own
 * quota card with a div-based progress bar that turns amber past 85% usage
 * ("Approaching quota") and red at 100% ("Circuit breaker engaged — requests
 * return 429"). A summary card shows the aggregate for the month and a recharts
 * bar chart (via ChartContainer, OKLCH palette, foreground-forced text)
 * comparing autocomplete vs. details vs. any legacy "Other Maps calls".
 *
 * Read-only: no billing block, no mutations, no mock data. All numbers come from
 * GET /api/admin/integrations/usage.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// ─── Types ──────────────────────────────────────────────────────────────────

interface UsageResponse {
  month: string;
  limit: number;
  total_requests: number;
  percentage_used: number;
  by_endpoint: Record<string, number> & {
    autocomplete: number;
    details: number;
  };
  plan: string;
}

/** A single quota row derived from the usage response. */
interface QuotaRow {
  key: string;
  label: string;
  used: number;
  limit: number;
  /** used / limit — clamped to [0, 1] for the bar; percent kept separately. */
  fraction: number;
  percent: number;
  /** used / limit > 0.85 — bar + badge go amber. */
  warn: boolean;
  /** used >= limit — circuit breaker engaged (429s). */
  breaker: boolean;
}

const WARN_THRESHOLD = 0.85;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format an ISO "2026-07" month key as "July 2026" for display. */
function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  const year = Number(y);
  const monthIdx = Number(m) - 1;
  if (Number.isNaN(year) || Number.isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) {
    return month;
  }
  return new Date(Date.UTC(year, monthIdx, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function makeRow(key: string, label: string, used: number, limit: number): QuotaRow {
  const safeLimit = limit > 0 ? limit : 1;
  const percent = (used / safeLimit) * 100;
  const fraction = Math.min(1, Math.max(0, used / safeLimit));
  return {
    key,
    label,
    used,
    limit,
    fraction,
    percent,
    warn: used / safeLimit > WARN_THRESHOLD,
    breaker: used >= limit,
  };
}

const nf = new Intl.NumberFormat("en-US");

// ─── Progress bar (div-based, Monolith — no 1px borders) ───────────────────────

function QuotaBar({ row }: { row: QuotaRow }) {
  const pct = Math.round(row.fraction * 100);
  const fillColor = row.breaker
    ? "hsl(var(--destructive))"
    : row.warn
      ? "rgb(245 158 11)" // amber-500
      : "hsl(var(--chart-1))";
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={Math.round(row.percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${row.label} usage`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, backgroundColor: fillColor }}
      />
    </div>
  );
}

// ─── Quota row card ────────────────────────────────────────────────────────────

function QuotaCard({ row }: { row: QuotaRow }) {
  return (
    <Card
      className={
        row.breaker
          ? "ring-1 ring-destructive/40"
          : row.warn
            ? "ring-1 ring-amber-500/40"
            : undefined
      }
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{row.label}</CardTitle>
          {row.breaker ? (
            <Badge className="gap-1 bg-destructive/15 text-destructive ring-1 ring-destructive/30">
              <ShieldAlert className="size-3" />
              Circuit breaker
            </Badge>
          ) : row.warn ? (
            <Badge className="gap-1 bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">
              <AlertTriangle className="size-3" />
              Approaching quota
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
            {nf.format(row.used)}
          </span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {nf.format(row.used)} / {nf.format(row.limit)}
          </span>
        </div>
        <QuotaBar row={row} />
        <div className="flex items-center justify-between text-[11px]">
          <span
            className={
              row.breaker
                ? "font-medium text-destructive"
                : row.warn
                  ? "font-medium text-amber-300"
                  : "text-muted-foreground"
            }
          >
            {row.percent.toFixed(1)}% of quota used
          </span>
          {row.breaker && (
            <span className="text-[10px] font-medium text-destructive">
              Requests return 429
            </span>
          )}
        </div>
        {row.breaker && (
          <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
            Circuit breaker engaged — new {row.label} requests return 429 until the
            monthly quota resets.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Summary chart ─────────────────────────────────────────────────────────────

interface ChartDatum {
  key: string;
  label: string;
  value: number;
  fill: string;
}

const summaryChartConfig = {
  value: { label: "Requests" },
} satisfies ChartConfig;

function UsageSummaryChart({ data }: { data: ChartDatum[] }) {
  if (data.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-sm text-muted-foreground">
        No requests recorded this month.
      </div>
    );
  }
  // Height scales with row count for readable horizontal bars.
  const height = Math.max(140, data.length * 56);
  return (
    <ChartContainer
      config={summaryChartConfig}
      className="w-full"
      style={{ height: `${height}px` }}
    >
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
        barCategoryGap="24%"
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <YAxis
          type="category"
          dataKey="label"
          width={150}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "var(--foreground)" }}
        />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => nf.format(v)}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, _name, item) => {
                const d = item.payload as ChartDatum;
                return (
                  <span className="font-medium tabular-nums text-foreground">
                    {nf.format(d.value)} requests
                  </span>
                );
              }}
            />
          }
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]}>
          {data.map((entry) => (
            <Cell key={entry.key} fill={entry.fill} />
          ))}
          <LabelList
            dataKey="value"
            position="insideRight"
            formatter={(v) => nf.format(Number(v))}
            style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

// ─── States ────────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-24 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="h-40 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
        <div className="h-40 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="ring-1 ring-destructive/30">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            Couldn&apos;t load Google Maps usage
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────

export function AdminIntegrationsUsageApp() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/integrations/usage", {
        credentials: "include",
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
      }
      const json = (await res.json()) as UsageResponse;
      setData(json);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load usage";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The two primary quota rows are fixed; autocomplete + details always present.
  const rows = useMemo<QuotaRow[]>(() => {
    if (!data) return [];
    return [
      makeRow(
        "autocomplete",
        "Places Autocomplete",
        data.by_endpoint.autocomplete ?? 0,
        data.limit,
      ),
      makeRow(
        "details",
        "Place Details",
        data.by_endpoint.details ?? 0,
        data.limit,
      ),
    ];
  }, [data]);

  // Any extra keys beyond the two primaries are legacy commute calls — surfaced
  // in the "Other Maps calls" section (e.g. "places:searchText",
  // "routes:computeRoutes").
  const otherEntries = useMemo<{ key: string; value: number }[]>(() => {
    if (!data) return [];
    return Object.entries(data.by_endpoint)
      .filter(([key]) => key !== "autocomplete" && key !== "details")
      .map(([key, value]) => ({ key, value: Number(value) || 0 }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [data]);

  const otherTotal = useMemo(
    () => otherEntries.reduce((sum, e) => sum + e.value, 0),
    [otherEntries],
  );

  const chartData = useMemo<ChartDatum[]>(() => {
    if (!data) return [];
    const base: ChartDatum[] = [
      {
        key: "autocomplete",
        label: "Places Autocomplete",
        value: data.by_endpoint.autocomplete ?? 0,
        fill: "var(--chart-1)",
      },
      {
        key: "details",
        label: "Place Details",
        value: data.by_endpoint.details ?? 0,
        fill: "var(--chart-2)",
      },
    ];
    if (otherTotal > 0) {
      base.push({
        key: "other",
        label: "Other Maps calls",
        value: otherTotal,
        fill: "var(--chart-3)",
      });
    }
    return base.filter((d) => d.value > 0);
  }, [data, otherTotal]);

  const isFreeTier = data?.plan === "free_tier";

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MapPin className="size-4" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              Integrations · Usage
            </h1>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Google Maps API — monthly free-tier quota monitoring.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isFreeTier && (
            <Badge className="bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">
              Current Plan: Free Tier
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : data ? (
        <div className="space-y-6">
          {/* Summary card */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-sm">Monthly Usage Summary</CardTitle>
                  <CardDescription>
                    {formatMonth(data.month)} · all Google Maps API calls
                  </CardDescription>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                    {nf.format(data.total_requests)}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    / {nf.format(data.limit)} ({data.percentage_used}%)
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <UsageSummaryChart data={chartData} />
            </CardContent>
          </Card>

          {/* Primary quota rows — stack on narrow, side-by-side on md+ */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {rows.map((row) => (
              <QuotaCard key={row.key} row={row} />
            ))}
          </div>

          {/* Other Maps calls — legacy commute keys beyond the two primaries */}
          {otherEntries.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Other Maps calls</CardTitle>
                <CardDescription>
                  Legacy commute endpoints beyond Autocomplete and Place Details ·{" "}
                  {nf.format(otherTotal)} total
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border/40">
                  {otherEntries.map((entry) => (
                    <li
                      key={entry.key}
                      className="flex items-center justify-between px-4 py-2.5 text-sm"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {entry.key}
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {nf.format(entry.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
    </main>
  );
}
