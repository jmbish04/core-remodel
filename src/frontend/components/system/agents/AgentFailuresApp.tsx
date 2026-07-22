/**
 * @fileoverview Failure triage — `/admin/system/agents/failed`.
 *
 * Two views over the same window:
 *   - Grouped by (error_code, agent, operation) — "five runs failed the same
 *     way", the question no per-feature status column in this codebase can
 *     answer today.
 *   - Flat, so an individual failure can be found and opened.
 *
 * Retrofit note: the reference template's KPI cards were invented
 * (Exposure / Backoff / Owners / Payload). These four are computed from the
 * ledger and each one is actionable.
 */
import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
  AgentIdentity,
  AttemptBadge,
  ErrorCodeChip,
  RunStatusBadge,
  SurfaceBadge,
  adminGet,
  adminPost,
  formatDuration,
  formatRelative,
  type RunSummary,
} from "./shared";

interface FailureGroup {
  errorCode: string | null;
  agent: string;
  agentLabel: string;
  operation: string;
  count: number;
  latest: string | null;
  sampleRunId: number;
}

interface FailuresResponse {
  count: number;
  totalRuns: number;
  groups: FailureGroup[];
}

interface OverviewResponse {
  counts: Record<string, number>;
  coverage: { instrumented: number; total: number };
  providers: Array<{ provider: string; allowed: boolean; spendUsd: number; ceilingUsd: number }>;
}

const WINDOWS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

export function AgentFailuresApp() {
  const [since, setSince] = React.useState("7d");
  const [view, setView] = React.useState<"grouped" | "flat">("grouped");
  const [agentFilter, setAgentFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");

  const [groups, setGroups] = React.useState<FailuresResponse | null>(null);
  const [runs, setRuns] = React.useState<RunSummary[] | null>(null);
  const [overview, setOverview] = React.useState<OverviewResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState<number | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [g, r, o] = await Promise.all([
        adminGet<FailuresResponse>(`/api/admin/agents/failures?since=${since}`),
        adminGet<{ runs: RunSummary[] }>(
          `/api/admin/agents/runs?status=failed,cancelled&since=${since}&limit=300`,
        ),
        adminGet<OverviewResponse>(`/api/admin/agents/overview?since=${since}`),
      ]);
      setGroups(g);
      setRuns(r.runs);
      setOverview(o);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [since]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const agents = React.useMemo(() => {
    const set = new Map<string, string>();
    for (const g of groups?.groups ?? []) set.set(g.agent, g.agentLabel);
    for (const r of runs ?? []) set.set(r.agent, r.agentLabel);
    return [...set.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [groups, runs]);

  const visibleGroups = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return (groups?.groups ?? []).filter((g) => {
      if (agentFilter !== "all" && g.agent !== agentFilter) return false;
      if (!q) return true;
      return (
        (g.errorCode ?? "").toLowerCase().includes(q) ||
        g.agentLabel.toLowerCase().includes(q) ||
        g.operation.toLowerCase().includes(q)
      );
    });
  }, [groups, agentFilter, query]);

  const visibleRuns = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return (runs ?? []).filter((r) => {
      if (agentFilter !== "all" && r.agent !== agentFilter) return false;
      if (!q) return true;
      return (
        (r.errorCode ?? "").toLowerCase().includes(q) ||
        (r.errorMessage ?? "").toLowerCase().includes(q) ||
        r.agentLabel.toLowerCase().includes(q) ||
        r.operation.toLowerCase().includes(q) ||
        (r.targetLabel ?? "").toLowerCase().includes(q) ||
        String(r.id) === q
      );
    });
  }, [runs, agentFilter, query]);

  const retry = async (id: number) => {
    setRetrying(id);
    setNotice(null);
    try {
      const res = await adminPost<{ runId?: number }>(`/api/admin/agents/runs/${id}/retry`);
      setNotice(`RUN-${id} queued for retry as RUN-${res?.runId}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(null);
    }
  };

  // ── KPI cards. Each is computed, and each one is actionable. ──────────────
  const blockedProviders = (overview?.providers ?? []).filter((p) => !p.allowed);
  const backoff = (runs ?? []).filter((r) => r.attempt > 1).length;
  const replayable = (runs ?? []).filter((r) => r.status === "failed").length;
  const cov = overview?.coverage;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Failed Runs</h2>
            <Badge
              variant="outline"
              className="border-destructive/25 bg-destructive/10 text-destructive tabular-nums"
            >
              {groups?.totalRuns ?? 0} failed
            </Badge>
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {groups?.count ?? 0} distinct failure {groups?.count === 1 ? "mode" : "modes"} in this window.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={agentFilter} onValueChange={(v) => setAgentFilter(String(v))}>
            <SelectTrigger className="w-[190px]" aria-label="Filter by agent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {agents.map(([slug, label]) => (
                <SelectItem key={slug} value={slug}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={since} onValueChange={(v) => setSince(String(v))}>
            <SelectTrigger className="w-[160px]" aria-label="Time window">
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
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load failures</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertTitle>Retry queued</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {/* ── KPI cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Blocked by spend"
          value={String(blockedProviders.length)}
          hint={
            blockedProviders.length
              ? blockedProviders.map((p) => p.provider).join(", ")
              : "No provider is over its ceiling"
          }
          tone={blockedProviders.length ? "bad" : "ok"}
        />
        <Kpi
          label="In backoff"
          value={String(backoff)}
          hint="Runs on attempt 2 or higher"
          tone={backoff ? "warn" : "ok"}
        />
        <Kpi
          label="Coverage"
          value={cov ? `${cov.instrumented}/${cov.total}` : "—"}
          hint="Surfaces reporting to the ledger"
          tone={cov && cov.instrumented < cov.total ? "warn" : "ok"}
        />
        <Kpi
          label="Replayable"
          value={String(replayable)}
          hint="Failed runs that can be retried"
          tone="ok"
        />
      </div>

      {/* ── View switch + search ───────────────────────────────────────── */}
      <div className="bg-muted/20 flex flex-col gap-3 border-y px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search error code, message, agent, target, or run id…"
          aria-label="Search failures"
          className="w-full lg:max-w-sm"
        />
        <div className="flex items-center gap-1.5">
          <Button
            variant={view === "grouped" ? "default" : "outline"}
            onClick={() => setView("grouped")}
          >
            Grouped by cause
          </Button>
          <Button variant={view === "flat" ? "default" : "outline"} onClick={() => setView("flat")}>
            Every run
          </Button>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="w-full overflow-x-auto border-b">
        {groups === null && !error ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : view === "grouped" ? (
          visibleGroups.length === 0 ? (
            <EmptyState coverage={cov} />
          ) : (
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Error</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Latest</TableHead>
                  <TableHead className="text-right">Sample</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleGroups.map((g) => (
                  <TableRow key={`${g.errorCode}-${g.agent}-${g.operation}`}>
                    <TableCell>
                      <ErrorCodeChip code={g.errorCode} />
                    </TableCell>
                    <TableCell>
                      <AgentIdentity run={{ agentLabel: g.agentLabel, operation: g.operation }} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="outline"
                        className={cn(
                          "tabular-nums",
                          g.count >= 5 && "border-destructive/25 bg-destructive/10 text-destructive",
                        )}
                      >
                        {g.count}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                      {formatRelative(g.latest)}
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        className="text-sm underline-offset-2 hover:underline"
                        href={`/admin/system/agents/queue/${g.sampleRunId}`}
                      >
                        RUN-{g.sampleRunId}
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        ) : visibleRuns.length === 0 ? (
          <EmptyState coverage={cov} />
        ) : (
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Surface</TableHead>
                <TableHead>Error</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Last attempt</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRuns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[300px]">
                    <a
                      href={`/admin/system/agents/queue/${r.id}`}
                      className="hover:text-primary flex min-w-0 flex-col gap-0.5"
                    >
                      <span className="truncate text-sm font-medium">
                        {r.targetLabel ?? `${r.agentLabel} · ${r.operation}`}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        RUN-{r.id}
                        {r.errorMessage ? ` · ${r.errorMessage}` : ""}
                      </span>
                    </a>
                  </TableCell>
                  <TableCell className="w-[190px]">
                    <AgentIdentity run={r} />
                  </TableCell>
                  <TableCell className="w-[140px]">
                    <SurfaceBadge surface={r.surface} />
                  </TableCell>
                  <TableCell className="w-[180px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ErrorCodeChip code={r.errorCode} />
                      <AttemptBadge attempt={r.attempt} />
                      {r.status !== "failed" && <RunStatusBadge status={r.status} />}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground w-[110px] text-right text-sm tabular-nums">
                    {formatDuration(r.durationMs)}
                  </TableCell>
                  <TableCell className="text-muted-foreground w-[130px] text-right text-sm tabular-nums">
                    {formatRelative(r.createdAt)}
                  </TableCell>
                  <TableCell className="w-[110px] text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retrying !== null}
                      onClick={() => void retry(r.id)}
                    >
                      {retrying === r.id ? "…" : "Retry"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
        <a className="hover:text-foreground underline" href="/admin/system/agents/queue">
          Run queue
        </a>
        <a className="hover:text-foreground underline" href="/admin/system/agents/usage">
          Cost dashboard
        </a>
      </div>
    </div>
  );
}

/**
 * Empty state that refuses to say "all good".
 *
 * If most surfaces are not instrumented, zero failures means zero visibility,
 * not zero problems — and saying otherwise here would recreate the exact blind
 * spot this page exists to remove.
 */
function EmptyState({ coverage }: { coverage?: { instrumented: number; total: number } }) {
  const partial = coverage && coverage.instrumented < coverage.total;
  return (
    <div className="p-8 text-center">
      <p className="text-sm font-medium">No failures recorded in this window.</p>
      <p className="text-muted-foreground mt-1 text-sm">
        {partial
          ? `Only ${coverage.instrumented} of ${coverage.total} surfaces report to the ledger, so this is not the same as "nothing failed".`
          : "Every declared surface is reporting, so this window really was clean."}
      </p>
    </div>
  );
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
  tone: "ok" | "warn" | "bad";
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
            tone === "bad" && "text-destructive",
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

export default AgentFailuresApp;
