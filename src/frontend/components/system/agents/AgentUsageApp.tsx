/**
 * @fileoverview AI cost dashboard — `/admin/system/agents/usage`.
 *
 * Spend for the current billing cycle, attributed to the agent that caused it.
 *
 * Retrofit note: the reference template invented its providers (OpenRoute
 * Primary, Northstar Claude Pool). These are the real `METERED_PROVIDERS`, and
 * the "budget events" feed is the actual circuit-breaker state from
 * `services/usage/metering.ts` — which can and does block calls today, with no
 * UI anywhere that says so.
 *
 * This page deliberately does NOT duplicate `/admin/integrations/usage`, which
 * owns the Google Maps free-tier quota. It links there instead.
 */
import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { adminGet, formatCount, formatUsd } from "./shared";

interface UsageRow {
  agent: string;
  agentLabel: string;
  provider: string;
  model: string;
  tokens: number;
  costUsd: number;
  calls: number;
  erroredCalls: number;
}

interface UsageResponse {
  since: string;
  totalCostUsd: number;
  totalTokens: number;
  unitCostPerMillion: number | null;
  ledgerCalls: number;
  gateway: {
    available: boolean;
    reason: string | null;
    month: string;
    totalRequests: number;
    erroredRequests: number;
    driftPct: number | null;
  };
  rows: UsageRow[];
}

interface OverviewResponse {
  cycleStart: string;
  providers: Array<{
    provider: string;
    allowed: boolean;
    spendUsd: number;
    ceilingUsd: number;
    reason: string;
    percent: number | null;
  }>;
  coverage: { instrumented: number; total: number };
}

const WINDOWS = [
  { value: "cycle", label: "Current billing cycle" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

/** Stable colour per provider so the bar and the legend always agree. */
const PROVIDER_COLOR: Record<string, string> = {
  GEMINI: "bg-violet-500",
  WORKERS_AI: "bg-sky-500",
  BROWSER_RENDERING: "bg-amber-500",
  GOOGLE_PLACES: "bg-emerald-500",
  CF_IMAGES: "bg-rose-500",
  VECTORIZE: "bg-teal-500",
  DURABLE_OBJECT: "bg-indigo-500",
};

export function AgentUsageApp() {
  const [window, setWindow] = React.useState("cycle");
  const [usage, setUsage] = React.useState<UsageResponse | null>(null);
  const [overview, setOverview] = React.useState<OverviewResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const qs = window === "cycle" ? "" : `?since=${window}`;
      const [u, o] = await Promise.all([
        adminGet<UsageResponse>(`/api/admin/agents/usage${qs}`),
        adminGet<OverviewResponse>("/api/admin/agents/overview"),
      ]);
      setUsage(u);
      setOverview(o);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [window]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Spend by provider, derived from the same rows the table shows so the two
  // can never disagree.
  const byProvider = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of usage?.rows ?? []) m.set(r.provider, (m.get(r.provider) ?? 0) + r.costUsd);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [usage]);

  const byAgent = React.useMemo(() => {
    const m = new Map<string, { label: string; cost: number; tokens: number; calls: number; errors: number }>();
    for (const r of usage?.rows ?? []) {
      const cur = m.get(r.agent) ?? { label: r.agentLabel, cost: 0, tokens: 0, calls: 0, errors: 0 };
      cur.cost += r.costUsd;
      cur.tokens += r.tokens;
      cur.calls += r.calls;
      cur.errors += r.erroredCalls;
      m.set(r.agent, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
  }, [usage]);

  const totalCost = usage?.totalCostUsd ?? 0;
  const blocked = (overview?.providers ?? []).filter((p) => !p.allowed);
  const nearing = (overview?.providers ?? []).filter(
    (p) => p.allowed && p.percent !== null && p.percent >= 80,
  );
  const unattributed = byAgent.find(([a]) => a === "(unattributed)")?.[1]?.cost ?? 0;
  const attributedPct = totalCost > 0 ? Math.round(((totalCost - unattributed) / totalCost) * 100) : null;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">AI Cost</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Model spend, token pace and breaker state — attributed to the agent that caused it.
          </p>
        </div>
        <Select value={window} onValueChange={(v) => setWindow(String(v))}>
          <SelectTrigger className="w-[210px]" aria-label="Time window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load usage</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {blocked.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Spend breaker is blocking calls</AlertTitle>
          <AlertDescription>
            {blocked.map((p) => `${p.provider}: ${p.reason}`).join(" · ")}. Calls to these providers
            are being refused right now — clear the breaker from{" "}
            <a className="underline" href="/admin/config/usage">
              usage config
            </a>
            .
          </AlertDescription>
        </Alert>
      )}

      {/* ── KPI cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Spend" value={usage ? formatUsd(totalCost) : "—"} hint={windowLabel(window, usage?.since)} />
        <Kpi label="Tokens" value={usage ? formatCount(usage.totalTokens) : "—"} hint="Across every metered provider" />
        <Kpi
          label="Unit cost"
          value={usage?.unitCostPerMillion != null ? `$${usage.unitCostPerMillion.toFixed(2)}/1M` : "—"}
          hint={usage?.unitCostPerMillion == null ? "No tokens reported yet" : "Dollars per million tokens"}
        />
        <Kpi
          label="Attributed"
          value={attributedPct === null ? "—" : `${attributedPct}%`}
          hint={
            attributedPct === null
              ? "No spend in this window"
              : `${formatUsd(unattributed)} not tied to a run`
          }
          tone={attributedPct !== null && attributedPct < 50 ? "warn" : undefined}
        />
      </div>

      {/* ── Provider mix ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Provider mix</CardTitle>
          <p className="text-muted-foreground text-xs">
            Share of spend, with each provider&apos;s breaker state.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {usage === null ? (
            <Skeleton className="h-2.5 w-full" />
          ) : totalCost === 0 ? (
            <p className="text-muted-foreground text-sm">
              No cost recorded in this window. Note that `estimated_cost_usd` is null until a rate
              table exists for a provider — token counts are still real.
            </p>
          ) : (
            <div className="bg-muted flex h-2.5 w-full items-center gap-0.5 overflow-hidden rounded-full">
              {byProvider.map(([p, cost]) => (
                <div
                  key={p}
                  className={cn("h-full", PROVIDER_COLOR[p] ?? "bg-muted-foreground")}
                  style={{ width: `${(cost / totalCost) * 100}%` }}
                  title={`${p}: ${formatUsd(cost)}`}
                />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            {(overview?.providers ?? []).map((p) => {
              const cost = byProvider.find(([n]) => n === p.provider)?.[1] ?? 0;
              const state = !p.allowed
                ? { label: "Blocked", cls: "border-destructive/25 bg-destructive/10 text-destructive" }
                : p.percent !== null && p.percent >= 80
                  ? { label: "Nearing cap", cls: "border-warning/25 bg-warning/10 text-warning" }
                  : { label: "Within budget", cls: "border-success/25 bg-success/10 text-success" };
              return (
                <div
                  key={p.provider}
                  className="bg-muted/30 flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        PROVIDER_COLOR[p.provider] ?? "bg-muted-foreground",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <div className="text-foreground truncate font-mono text-xs font-medium">
                        {p.provider}
                      </div>
                      <div className="text-muted-foreground truncate text-xs">
                        {formatUsd(p.spendUsd)} of {formatUsd(p.ceilingUsd)} ceiling
                        {p.percent !== null ? ` · ${p.percent}%` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-foreground text-sm tabular-nums">{formatUsd(cost)}</span>
                    <Badge variant="outline" className={state.cls}>
                      {state.label}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>

          {nearing.length > 0 && blocked.length === 0 && (
            <p className="text-warning text-xs">
              {nearing.map((p) => p.provider).join(", ")} above 80% of ceiling.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Cost by agent ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cost by agent</CardTitle>
          <p className="text-muted-foreground text-xs">
            The join `gemini_usage_log.agent_run_id` exists for. Rows recorded before that column
            landed, or made outside a run, group as “(unattributed)”.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            {usage === null ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : byAgent.length === 0 ? (
              <p className="text-muted-foreground p-6 text-center text-sm">
                No usage recorded in this window.
              </p>
            ) : (
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Errored</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byAgent.map(([agent, a]) => (
                    <TableRow key={agent}>
                      <TableCell>
                        <span
                          className={cn(
                            "text-sm",
                            agent === "(unattributed)" && "text-muted-foreground italic",
                          )}
                        >
                          {a.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatUsd(a.cost)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                        {formatCount(a.tokens)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                        {a.calls}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {a.errors > 0 ? (
                          <Badge
                            variant="outline"
                            className="border-destructive/25 bg-destructive/10 text-destructive"
                          >
                            {a.errors}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                        {totalCost > 0 ? `${Math.round((a.cost / totalCost) * 100)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Reconciliation. A silent 20% gap between our ledger and Cloudflare's
          own rollup means instrumentation is missing, and that has to be
          visible on the page that claims to know what things cost. */}
      {usage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Reconciliation</CardTitle>
            <p className="text-muted-foreground text-xs">
              Our ledger against Cloudflare&apos;s independent AI Gateway rollup.
            </p>
          </CardHeader>
          <CardContent>
            {!usage.gateway.available ? (
              <p className="text-muted-foreground text-sm">
                Gateway rollup unavailable{usage.gateway.reason ? ` — ${usage.gateway.reason}` : ""}.
                The ledger total stands alone and cannot be cross-checked right now.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span>
                  <span className="text-muted-foreground">Ledger calls</span>{" "}
                  <span className="tabular-nums">{usage.ledgerCalls.toLocaleString()}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">Gateway requests ({usage.gateway.month})</span>{" "}
                  <span className="tabular-nums">
                    {usage.gateway.totalRequests.toLocaleString()}
                  </span>
                </span>
                <span>
                  <span className="text-muted-foreground">Drift</span>{" "}
                  {usage.gateway.driftPct === null ? (
                    <span className="text-muted-foreground">unknown</span>
                  ) : (
                    <Badge
                      variant="outline"
                      className={cn(
                        "tabular-nums",
                        Math.abs(usage.gateway.driftPct) > 20 &&
                          "border-warning/25 bg-warning/10 text-warning",
                      )}
                    >
                      {usage.gateway.driftPct > 0 ? "+" : ""}
                      {usage.gateway.driftPct}%
                    </Badge>
                  )}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">
        Google Maps free-tier quota lives on{" "}
        <a className="hover:text-foreground underline" href="/admin/integrations/usage">
          Integrations Usage
        </a>{" "}
        and is not duplicated here.{" "}
        <a className="hover:text-foreground underline" href="/admin/system/agents/queue">
          Run queue
        </a>{" "}
        ·{" "}
        <a className="hover:text-foreground underline" href="/admin/system/agents/failed">
          Failure sheet
        </a>
      </p>
    </div>
  );
}

function windowLabel(w: string, since?: string): string {
  if (w !== "cycle") return WINDOWS.find((x) => x.value === w)?.label ?? w;
  return since ? `Cycle started ${new Date(since).toLocaleDateString()}` : "Current billing cycle";
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "warn";
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </span>
        <span
          className={cn(
            "text-2xl leading-none font-semibold tracking-tight tabular-nums",
            tone === "warn" && "text-warning",
          )}
        >
          {value}
        </span>
        <span className="text-muted-foreground truncate text-xs" title={hint}>
          {hint}
        </span>
      </CardContent>
    </Card>
  );
}

export default AgentUsageApp;
