/**
 * @fileoverview Maps usage section — Google Maps Platform monthly free-tier
 * quota. Ported from the original AdminIntegrationsUsageApp; self-fetches
 * GET /api/admin/integrations/usage. Read-only, no mock data.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  fetchJson,
  formatMonth,
  MeterBar,
  nf,
  RefreshButton,
  SectionError,
  SectionHeader,
  SectionLoading,
} from "./shared";

interface SkuCounts {
  places: number;
  geocoding: number;
  routes: number;
}

interface UsageResponse {
  month: string;
  limit: number;
  total_requests: number;
  percentage_used: number;
  by_endpoint: Record<string, number> & { autocomplete: number; details: number };
  by_sku?: SkuCounts;
  quotas?: SkuCounts;
  plan: string;
}

const SKU_LABELS: Record<keyof SkuCounts, string> = {
  places: "Places API",
  geocoding: "Geocoding API",
  routes: "Routes API",
};

interface QuotaRow {
  key: string;
  label: string;
  used: number;
  limit: number;
  fraction: number;
  percent: number;
  warn: boolean;
  breaker: boolean;
}

const WARN_THRESHOLD = 0.85;

function makeRow(key: string, label: string, used: number, limit: number): QuotaRow {
  const safeLimit = limit > 0 ? limit : 1;
  return {
    key,
    label,
    used,
    limit,
    fraction: Math.min(1, Math.max(0, used / safeLimit)),
    percent: (used / safeLimit) * 100,
    warn: used / safeLimit > WARN_THRESHOLD,
    breaker: used >= limit,
  };
}

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
        <MeterBar
          fraction={row.fraction}
          tone={row.breaker ? "danger" : row.warn ? "warn" : "default"}
        />
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
            <span className="text-[10px] font-medium text-destructive">Requests return 429</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface ChartDatum {
  key: string;
  label: string;
  value: number;
  fill: string;
}

const summaryChartConfig = { value: { label: "Requests" } } satisfies ChartConfig;

function UsageSummaryChart({ data }: { data: ChartDatum[] }) {
  if (data.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-sm text-muted-foreground">
        No requests recorded this month.
      </div>
    );
  }
  const height = Math.max(140, data.length * 56);
  return (
    <ChartContainer config={summaryChartConfig} className="w-full" style={{ height: `${height}px` }}>
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
              formatter={(_value, _name, item) => {
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

export function MapsUsageSection() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchJson<UsageResponse>("/api/admin/integrations/usage"));
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

  const rows = useMemo<QuotaRow[]>(() => {
    if (!data) return [];
    return [
      makeRow("autocomplete", "Places Autocomplete", data.by_endpoint.autocomplete ?? 0, data.limit),
      makeRow("details", "Place Details", data.by_endpoint.details ?? 0, data.limit),
    ];
  }, [data]);

  const skuRows = useMemo<QuotaRow[]>(() => {
    if (!data?.by_sku || !data?.quotas) return [];
    return (Object.keys(SKU_LABELS) as (keyof SkuCounts)[]).map((sku) =>
      makeRow(sku, SKU_LABELS[sku], data.by_sku![sku] ?? 0, data.quotas![sku] ?? 0),
    );
  }, [data]);

  const otherEntries = useMemo(() => {
    if (!data) return [] as { key: string; value: number }[];
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
      { key: "autocomplete", label: "Places Autocomplete", value: data.by_endpoint.autocomplete ?? 0, fill: "var(--chart-1)" },
      { key: "details", label: "Place Details", value: data.by_endpoint.details ?? 0, fill: "var(--chart-2)" },
    ];
    if (otherTotal > 0) {
      base.push({ key: "other", label: "Other Maps calls", value: otherTotal, fill: "var(--chart-3)" });
    }
    return base.filter((d) => d.value > 0);
  }, [data, otherTotal]);

  return (
    <div>
      <SectionHeader
        title="Google Maps"
        description="Places / Routes — monthly free-tier quota."
        actions={
          <>
            {data?.plan === "free_tier" && (
              <Badge className="bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">
                Free Tier
              </Badge>
            )}
            <RefreshButton loading={loading} onClick={load} />
          </>
        }
      />

      {loading ? (
        <SectionLoading />
      ) : error ? (
        <SectionError title="Couldn't load Google Maps usage" message={error} onRetry={load} />
      ) : data ? (
        <div className="space-y-6">
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {rows.map((row) => (
              <QuotaCard key={row.key} row={row} />
            ))}
          </div>

          {skuRows.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">Per-API hard blocks</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Each Google Maps SKU is capped and blocked independently — an exhausted API stops on
                its own while the others keep working.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {skuRows.map((row) => (
                  <QuotaCard key={row.key} row={row} />
                ))}
              </div>
            </div>
          )}

          {otherEntries.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Other Maps calls</CardTitle>
                <CardDescription>
                  Legacy commute endpoints · {nf.format(otherTotal)} total
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border/40">
                  {otherEntries.map((entry) => (
                    <li
                      key={entry.key}
                      className="flex items-center justify-between px-4 py-2.5 text-sm"
                    >
                      <span className="font-mono text-xs text-muted-foreground">{entry.key}</span>
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
    </div>
  );
}
