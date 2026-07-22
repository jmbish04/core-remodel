import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

interface Usage {
  windowDays: number;
  totals: {
    aiCalls: number;
    aiCostUsd: number;
    aiCallsPriced: number;
    aiCallsTotal: number;
    aiTokens: number;
    mcpCalls: number;
    mcpErrors: number;
    mcpAvgMs: number;
  };
  byModel: Array<{
    model: string;
    calls: number;
    totalTokens: number;
    costUsd: number;
    errors: number;
  }>;
  byFeature: Array<{ feature: string; calls: number; costUsd: number }>;
}

const fmt = new Intl.NumberFormat();
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/**
 * Integration usage over the real ledgers — `gemini_usage_log` (token counts and
 * per-call cost we record ourselves, independent of the provider dashboard) and
 * `mcp_tool_invocations`.
 */
export function IntegrationUsageApp() {
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/system/integration-usage?days=30", { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<Usage>) : Promise.reject(new Error(`${r.status}`))))
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Failed to load usage: {error}
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const { totals } = data;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`AI calls (${data.windowDays}d)`} value={fmt.format(totals.aiCalls)} />
        {/* Only show a cost figure when most calls are actually priced.
            `estimated_cost_usd` is populated for a tiny fraction of rows today,
            so a bare total would read as "we spent a tenth of a cent" when the
            truth is "almost nothing is priced". */}
        <Stat
          label="AI cost"
          value={
            totals.aiCallsPriced === 0
              ? "not tracked"
              : totals.aiCallsPriced < totals.aiCallsTotal * 0.5
                ? `${usd(totals.aiCostUsd)}*`
                : usd(totals.aiCostUsd)
          }
          sub={
            totals.aiCallsPriced < totals.aiCallsTotal
              ? `*only ${fmt.format(totals.aiCallsPriced)} of ${fmt.format(totals.aiCallsTotal)} calls priced`
              : undefined
          }
          problem={totals.aiCallsPriced < totals.aiCallsTotal * 0.5}
        />
        <Stat label="Tokens" value={fmt.format(totals.aiTokens)} />
        <Stat
          label="MCP calls"
          value={fmt.format(totals.mcpCalls)}
          sub={`${totals.mcpErrors} error${totals.mcpErrors === 1 ? "" : "s"} · ${totals.mcpAvgMs}ms avg`}
          problem={totals.mcpErrors > 0}
        />
      </div>

      <UsageTable
        title="By model"
        rows={data.byModel.map((m) => ({
          key: m.model,
          label: m.model,
          calls: m.calls,
          cost: m.costUsd,
          extra: `${fmt.format(m.totalTokens)} tokens${m.errors ? ` · ${m.errors} errors` : ""}`,
          problem: m.errors > 0,
        }))}
      />
      <UsageTable
        title="By feature"
        rows={data.byFeature.map((f) => ({
          key: f.feature,
          label: f.feature,
          calls: f.calls,
          cost: f.costUsd,
        }))}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  problem,
}: {
  label: string;
  value: string;
  sub?: string;
  problem?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={
            problem
              ? "font-mono text-2xl font-semibold tabular-nums text-amber-400"
              : "font-mono text-2xl font-semibold tabular-nums"
          }
        >
          {value}
        </p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function UsageTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    key: string;
    label: string;
    calls: number;
    cost: number;
    extra?: string;
    problem?: boolean;
  }>;
}) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h2>
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border/40 last:border-0">
                <td className="py-2 pr-4 font-mono text-xs">{r.label}</td>
                <td className="py-2 pr-4 text-right font-mono text-xs tabular-nums">
                  {fmt.format(r.calls)}
                </td>
                <td className="py-2 pr-4 text-right font-mono text-xs tabular-nums text-emerald-400">
                  {usd(r.cost)}
                </td>
                <td
                  className={
                    r.problem
                      ? "py-2 text-right text-[11px] text-amber-400"
                      : "py-2 text-right text-[11px] text-muted-foreground"
                  }
                >
                  {r.extra ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
