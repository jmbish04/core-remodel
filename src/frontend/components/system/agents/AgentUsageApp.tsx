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

import {
  ProviderHealthBadge,
  adminGet,
  formatCompact,
  formatCount,
  formatLatency,
  formatUptime,
  formatUsd,
  type ProviderHealth,
} from "./shared";

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

interface ProviderRow {
  provider: string;
  label: string;
  short: string;
  group: string;
  unit: string;
  priced: boolean;
  health: ProviderHealth;
  calls: number;
  errors: number;
  latencyMsP50: number | null;
  uptimeSeconds: number | null;
  lastCallAt: string | null;
  costUsd: number;
  tokens: number;
}

interface ProvidersResponse {
  windowHours: number;
  groups: Array<{
    group: string;
    label: string;
    blurb: string;
    costUsd: number;
    calls: number;
    tokens: number;
    providers: ProviderRow[];
  }>;
}

interface PricingResponse {
  staleAfterDays: number;
  count: number;
  freshness: Array<{
    provider: string;
    models: number;
    fetchedAt: string | null;
    stale: boolean;
    lastRun: { status: string; errorMessage: string | null; at: string } | null;
  }>;
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
/** Friendly name for a provider id, falling back to a title-cased form. */
function providerLabelOf(id: string): string {
  return (
    PROVIDER_LABEL[id] ??
    id
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/**
 * Mirrors `services/usage/provider-registry.ts`. Kept in sync by the
 * /providers endpoint, which is the source of truth — this map only covers the
 * two places (the mix bar and the breaker chips) that render a provider id
 * without having the row to hand.
 */
const PROVIDER_LABEL: Record<string, string> = {
  WORKERS_AI: "Workers AI",
  GEMINI: "Google Gemini",
  OPENAI: "OpenAI",
  ANTHROPIC: "Anthropic Claude",
  BROWSER_RENDERING: "Browser Rendering",
  CF_IMAGES: "Cloudflare Images",
  VECTORIZE: "Vectorize",
  DURABLE_OBJECT: "Durable Objects",
  GOOGLE_PLACES: "Google Places",
};

const PROVIDER_COLOR: Record<string, string> = {
  OPENAI: "bg-cyan-500",
  ANTHROPIC: "bg-orange-500",
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
  const [providers, setProviders] = React.useState<ProvidersResponse | null>(null);
  const [pricing, setPricing] = React.useState<PricingResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const qs = window === "cycle" ? "" : `?since=${window}`;
      const [u, o, pr, pc] = await Promise.all([
        adminGet<UsageResponse>(`/api/admin/agents/usage${qs}`),
        adminGet<OverviewResponse>("/api/admin/agents/overview"),
        adminGet<ProvidersResponse>("/api/admin/agents/providers?hours=24"),
        adminGet<PricingResponse>("/api/admin/agents/pricing"),
      ]);
      setUsage(u);
      setOverview(o);
      setProviders(pr);
      setPricing(pc);
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
        <Kpi label="Tokens" value={usage ? formatCompact(usage.totalTokens) : "—"} hint="Across every metered provider" />
        <Kpi
          label="Unit cost"
          value={usage?.unitCostPerMillion != null ? `${formatUsd(usage.unitCostPerMillion)} /1M` : "—"}
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

      {/* ── Provider mix, grouped by what kind of thing the provider is ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Provider mix</CardTitle>
          <p className="text-muted-foreground text-xs">
            Grouped by kind — a Cloudflare binding, a model vendor and a third-party API fail in
            different ways. Health, latency and uptime are over the last 24 hours.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {usage === null ? (
            <Skeleton className="h-2.5 w-full" />
          ) : totalCost === 0 ? (
            <p className="text-muted-foreground text-sm">
              No priced spend in this window yet. Token counts are still real — cost appears once
              the price catalog has an entry for the models being called.
            </p>
          ) : (
            <div className="bg-muted flex h-2.5 w-full items-center gap-0.5 overflow-hidden rounded-full">
              {byProvider.map(([prov, cost]) => (
                <div
                  key={prov}
                  className={cn("h-full", PROVIDER_COLOR[prov] ?? "bg-muted-foreground")}
                  style={{ width: `${(cost / totalCost) * 100}%` }}
                  title={`${providerLabelOf(prov)}: ${formatUsd(cost)}`}
                />
              ))}
            </div>
          )}

          {providers === null ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <Table className="min-w-[860px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead className="text-right">Uptime</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.groups.map((g) => (
                    <React.Fragment key={g.group}>
                      <TableRow className="bg-muted/45 hover:bg-muted/45">
                        <TableCell colSpan={4} className="h-10">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-foreground text-sm font-medium">{g.label}</span>
                            <span className="text-muted-foreground hidden truncate text-xs lg:inline">
                              {g.blurb}
                            </span>
                          </div>
                        </TableCell>
                        {/* Group subtotals, so a group reads without adding up its rows. */}
                        <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                          {formatCount(g.calls)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                          {formatCompact(g.tokens)}
                        </TableCell>
                        <TableCell className="text-foreground text-right text-xs font-medium tabular-nums">
                          {formatUsd(g.costUsd)}
                        </TableCell>
                      </TableRow>

                      {g.providers.map((row) => (
                        <TableRow key={row.provider}>
                          <TableCell>
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span
                                className={cn(
                                  "size-2 shrink-0 rounded-full",
                                  PROVIDER_COLOR[row.provider] ?? "bg-muted-foreground",
                                )}
                                aria-hidden
                              />
                              <div className="min-w-0">
                                {/* Friendly name, never the raw enum. */}
                                <div className="text-foreground truncate text-sm">{row.label}</div>
                                <div className="text-muted-foreground truncate text-xs">
                                  billed per {row.unit}
                                  {row.priced ? "" : " · not in the price catalog"}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <ProviderHealthBadge health={row.health} />
                          </TableCell>
                          <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                            {formatLatency(row.latencyMsP50)}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                            {formatUptime(row.uptimeSeconds)}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {formatCount(row.calls)}
                            {row.errors > 0 && (
                              <span className="text-destructive ml-1 text-xs">({row.errors} err)</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                            {formatCompact(row.tokens)}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {formatUsd(row.costUsd)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Breaker state stays visible; it can block calls today. */}
          <div className="flex flex-wrap items-center gap-2">
            {(overview?.providers ?? []).map((p) => {
              const state = !p.allowed
                ? { label: "Blocked", cls: "border-destructive/25 bg-destructive/10 text-destructive" }
                : p.percent !== null && p.percent >= 80
                  ? { label: "Nearing cap", cls: "border-warning/25 bg-warning/10 text-warning" }
                  : null;
              if (!state) return null;
              return (
                <Badge key={p.provider} variant="outline" className={state.cls}>
                  {providerLabelOf(p.provider)}: {state.label} — {formatUsd(p.spendUsd)} of{" "}
                  {formatUsd(p.ceilingUsd)}
                </Badge>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Price catalog freshness ─────────────────────────────────────── */}
      {pricing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Price catalog</CardTitle>
            <p className="text-muted-foreground text-xs">
              Published list prices, refreshed weekly. A silently broken parser looks exactly like
              accurate pricing unless staleness is shown, so it is shown.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{formatCount(pricing.count)} models priced</Badge>
            {pricing.freshness.map((f) => (
              <Badge
                key={f.provider}
                variant="outline"
                className={cn(
                  f.stale || f.lastRun?.status === "error"
                    ? "border-warning/25 bg-warning/10 text-warning"
                    : "border-success/25 bg-success/10 text-success",
                )}
                title={
                  f.lastRun?.errorMessage ??
                  (f.fetchedAt ? `last refreshed ${new Date(f.fetchedAt).toLocaleString()}` : "never refreshed")
                }
              >
                {providerLabelOf(f.provider)}: {formatCount(f.models)}
                {f.stale ? " · stale" : ""}
                {f.lastRun?.status === "error" ? " · last fetch failed" : ""}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

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
                        {formatCompact(a.tokens)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                        {formatCount(a.calls)}
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
