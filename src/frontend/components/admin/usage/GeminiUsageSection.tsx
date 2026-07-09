/**
 * @fileoverview Gemini usage section — first-party token ledger for the current
 * month, from GET /api/admin/integrations/gemini (backed by gemini_usage_log).
 * Gemini is called directly (bypassing AI Gateway), so this is the independent
 * accounting used to reconcile against provider billing. Read-only, no mock data.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
  fmtCompact,
  formatMonth,
  nf,
  RefreshButton,
  SectionError,
  SectionHeader,
  SectionLoading,
  StatCard,
} from "./shared";

interface GeminiFeature {
  feature: string;
  calls: number;
  totalTokens: number;
}

interface GeminiUsageResponse {
  month: string;
  totalCalls: number;
  okCalls: number;
  errorCalls: number;
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  byFeature: GeminiFeature[];
}

const CHART_FILLS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const featureChartConfig = { value: { label: "Tokens" } } satisfies ChartConfig;

export function GeminiUsageSection() {
  const [data, setData] = useState<GeminiUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchJson<GeminiUsageResponse>("/api/admin/integrations/gemini"));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load Gemini usage";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.byFeature
      .filter((f) => f.totalTokens > 0)
      .slice(0, 8)
      .map((f, i) => ({
        key: f.feature,
        label: f.feature,
        value: f.totalTokens,
        fill: CHART_FILLS[i % CHART_FILLS.length],
      }));
  }, [data]);

  const errorRate = useMemo(() => {
    if (!data || data.totalCalls === 0) return 0;
    return (data.errorCalls / data.totalCalls) * 100;
  }, [data]);

  return (
    <div>
      <SectionHeader
        title="Gemini"
        description="Direct Google Gemini API — first-party token ledger (not via AI Gateway)."
        actions={<RefreshButton loading={loading} onClick={load} />}
      />

      {loading ? (
        <SectionLoading />
      ) : error ? (
        <SectionError title="Couldn't load Gemini usage" message={error} onRetry={load} />
      ) : data ? (
        <div className="space-y-6">
          {/* Headline stats */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Total tokens"
              value={fmtCompact(data.totalTokens)}
              sub={`${nf.format(data.totalTokens)} this month`}
            />
            <StatCard
              label="Calls"
              value={nf.format(data.totalCalls)}
              sub={`${nf.format(data.okCalls)} ok · ${nf.format(data.errorCalls)} error`}
            />
            <StatCard
              label="Input tokens"
              value={fmtCompact(data.promptTokens)}
              sub="prompt"
            />
            <StatCard
              label="Output tokens"
              value={fmtCompact(data.candidatesTokens + data.thoughtsTokens)}
              sub={`${fmtCompact(data.candidatesTokens)} out · ${fmtCompact(data.thoughtsTokens)} reasoning`}
              tone={errorRate > 25 ? "warn" : "default"}
            />
          </div>

          {/* Tokens by feature */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-sm">Tokens by feature</CardTitle>
                  <CardDescription>
                    {formatMonth(data.month)} · attributed by calling surface
                  </CardDescription>
                </div>
                {data.errorCalls > 0 && (
                  <span className="font-mono text-[11px] text-amber-300">
                    {errorRate.toFixed(1)}% call error rate
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <div className="flex min-h-[120px] items-center justify-center text-sm text-muted-foreground">
                  No Gemini token usage recorded this month.
                </div>
              ) : (
                <ChartContainer
                  config={featureChartConfig}
                  className="w-full"
                  style={{ height: `${Math.max(140, chartData.length * 52)}px` }}
                >
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
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
                      tickFormatter={(v: number) => fmtCompact(v)}
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(_value, _name, item) => {
                            const d = item.payload as { value: number };
                            return (
                              <span className="font-medium tabular-nums text-foreground">
                                {nf.format(d.value)} tokens
                              </span>
                            );
                          }}
                        />
                      }
                    />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {chartData.map((entry) => (
                        <Cell key={entry.key} fill={entry.fill} />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="right"
                        formatter={(v) => fmtCompact(Number(v))}
                        style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }}
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Per-feature detail table */}
          {data.byFeature.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Per-feature detail</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border/40">
                  {data.byFeature.map((f) => (
                    <li
                      key={f.feature}
                      className="flex items-center justify-between px-4 py-2.5 text-sm"
                    >
                      <span className="font-mono text-xs text-foreground">{f.feature}</span>
                      <span className="flex items-center gap-4">
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {nf.format(f.calls)} calls
                        </span>
                        <span className="w-24 text-right font-mono font-medium tabular-nums text-foreground">
                          {nf.format(f.totalTokens)} tok
                        </span>
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
