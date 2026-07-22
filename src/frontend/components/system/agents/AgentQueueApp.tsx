/**
 * @fileoverview Agent run queue — `/admin/system/agents/queue`.
 *
 * Every agent execution, grouped by status, newest first.
 *
 * Retrofit note: the reference template rendered owner avatars and a
 * Production / Staging / Development badge. Neither exists here — there are no
 * per-run human owners and there is exactly one environment — so those columns
 * carry the agent identity and the execution surface instead. See
 * `shared.tsx` for the full vocabulary.
 */
import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
  AgentIdentity,
  AttemptBadge,
  ErrorCodeChip,
  RunStatusBadge,
  STATUS_GROUP_ORDER,
  STATUS_META,
  StepProgressRing,
  SurfaceBadge,
  adminGet,
  formatCount,
  formatDuration,
  formatRelative,
  type RunStatus,
  type RunSummary,
} from "./shared";

interface OverviewResponse {
  counts: Record<string, number>;
  runaways: Array<{ agent: string; agentLabel: string; lastHour: number; baselinePerHour: number; ratio: number }>;
  coverage: { instrumented: number; total: number; percent: number; missing: string[] };
  providers: Array<{ provider: string; allowed: boolean; spendUsd: number; ceilingUsd: number; percent: number | null }>;
}

interface RunsResponse {
  count: number;
  runs: RunSummary[];
}

const WINDOWS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

/** Poll cadence. Deliberately not SSE — see the comment on `useNow` below. */
const POLL_MS = 10_000;

export function AgentQueueApp() {
  const [since, setSince] = React.useState("24h");
  const [query, setQuery] = React.useState("");
  const [attentionOnly, setAttentionOnly] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  const [overview, setOverview] = React.useState<OverviewResponse | null>(null);
  const [runs, setRuns] = React.useState<RunSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [o, r] = await Promise.all([
        adminGet<OverviewResponse>(`/api/admin/agents/overview?since=${since}`),
        adminGet<RunsResponse>(`/api/admin/agents/runs?since=${since}&limit=300`),
      ]);
      setOverview(o);
      setRuns(r.runs);
      setError(null);
      setFetchedAt(Date.now());
    } catch (e) {
      // Surface it. An empty page during an incident is the failure mode this
      // whole feature exists to eliminate — it must never look like "all clear".
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [since]);

  React.useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const filtered = React.useMemo(() => {
    if (!runs) return [];
    const q = query.trim().toLowerCase();
    return runs.filter((r) => {
      if (attentionOnly && !["failed", "needs_approval"].includes(r.status)) return false;
      if (!q) return true;
      return (
        r.agentLabel.toLowerCase().includes(q) ||
        r.operation.toLowerCase().includes(q) ||
        (r.targetLabel ?? "").toLowerCase().includes(q) ||
        (r.errorCode ?? "").toLowerCase().includes(q) ||
        String(r.id) === q
      );
    });
  }, [runs, query, attentionOnly]);

  const groups = React.useMemo(() => {
    const by = new Map<RunStatus, RunSummary[]>();
    for (const r of filtered) by.set(r.status, [...(by.get(r.status) ?? []), r]);
    return STATUS_GROUP_ORDER.filter((s) => by.has(s)).map((s) => ({
      status: s,
      runs: by.get(s) ?? [],
    }));
  }, [filtered]);

  const toggle = (s: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const counts = overview?.counts ?? {};
  const attention = (counts.failed ?? 0) + (counts.needs_approval ?? 0);

  return (
    <div className="flex w-full flex-col gap-4">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Run Queue</h2>
            <span className="flex items-center gap-1.5">
              <span className="relative flex size-2 shrink-0" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-muted-foreground hidden text-sm sm:block">
                {fetchedAt ? `updated ${formatRelative(new Date(fetchedAt).toISOString())}` : "Live"}
              </span>
            </span>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Every agent execution across {overview?.coverage.total ?? 27} declared surfaces.
          </p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Stat label="Runs" value={filtered.length} />
          <Stat label="Failed" value={counts.failed ?? 0} tone={counts.failed ? "bad" : undefined} />
          <Stat
            label="Needs approval"
            value={counts.needs_approval ?? 0}
            tone={counts.needs_approval ? "warn" : undefined}
          />
          <Stat label="Running" value={counts.running ?? 0} />
        </div>
      </div>

      {/* ── Alarms ────────────────────────────────────────────────────── */}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load the run queue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {overview?.runaways.map((r) => (
        <Alert key={r.agent} variant="destructive">
          <AlertTitle>Possible runaway — {r.agentLabel}</AlertTitle>
          <AlertDescription>
            {r.lastHour} runs in the last hour against a 7-day baseline of {r.baselinePerHour}/h ({r.ratio}×).
            This is the shape of the orchestrator incident that ran for weeks before anyone noticed.
          </AlertDescription>
        </Alert>
      ))}

      {overview && overview.coverage.missing.length > 0 && (
        <Alert>
          <AlertTitle>
            {overview.coverage.instrumented} of {overview.coverage.total} surfaces are reporting
          </AlertTitle>
          <AlertDescription>
            <p className="mb-1">
              The rest have never written a run, so their failures are still invisible. An empty
              queue below does not mean everything is healthy.
            </p>
            <p className="text-muted-foreground font-mono text-xs">
              {overview.coverage.missing.join(", ")}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Filters ───────────────────────────────────────────────────── */}
      <div className="bg-muted/20 flex flex-col gap-3 border-y px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agent, operation, target, error code, or run id…"
          aria-label="Search agent runs"
          className="w-full lg:max-w-sm"
        />
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 lg:justify-end">
          <Button
            variant={attentionOnly ? "default" : "outline"}
            onClick={() => setAttentionOnly((v) => !v)}
          >
            Attention {attention > 0 ? `(${attention})` : ""}
          </Button>
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
          <Button variant="outline" onClick={() => setCollapsed(new Set())}>
            Expand all
          </Button>
        </div>
      </div>

      {/* ── Grid ──────────────────────────────────────────────────────── */}
      <div className="w-full overflow-x-auto border-b">
        {runs === null && !error ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">
            No runs in this window.{" "}
            {overview && overview.coverage.missing.length > 0
              ? "Note that most surfaces are not instrumented yet — see the banner above."
              : ""}
          </p>
        ) : (
          <Table className="min-w-[900px]">
            <TableBody>
              {groups.map((g) => {
                const isCollapsed = collapsed.has(g.status);
                const meta = STATUS_META[g.status];
                return (
                  <React.Fragment key={g.status}>
                    <TableRow className="bg-muted/45 hover:bg-muted/45">
                      <TableCell colSpan={7} className="h-11">
                        <button
                          type="button"
                          onClick={() => toggle(g.status)}
                          aria-expanded={!isCollapsed}
                          className="flex w-full min-w-0 items-center gap-2 text-left"
                        >
                          <span
                            className={cn(
                              "text-muted-foreground shrink-0 transition-transform",
                              !isCollapsed && "rotate-90",
                            )}
                            aria-hidden
                          >
                            ›
                          </span>
                          <span className={cn("size-2.5 shrink-0 rounded-full", meta.dot)} aria-hidden />
                          <span className="text-foreground shrink-0 text-sm font-medium">
                            {meta.group}
                          </span>
                          <Badge variant="outline" className="shrink-0">
                            {g.runs.length}
                          </Badge>
                          <span className="text-muted-foreground ml-auto hidden truncate text-sm lg:block">
                            {meta.blurb}
                          </span>
                        </button>
                      </TableCell>
                    </TableRow>

                    {!isCollapsed &&
                      g.runs.map((r) => (
                        <TableRow key={r.id} className="hover:bg-muted/40">
                          <TableCell className="max-w-[380px]">
                            <a
                              href={`/admin/system/agents/queue/${r.id}`}
                              className="group/title flex min-w-0 flex-col gap-0.5"
                            >
                              <span className="group-hover/title:text-primary text-foreground truncate text-sm font-medium transition-colors">
                                {r.targetLabel ?? `${r.agentLabel} · ${r.operation}`}
                              </span>
                              <span className="text-muted-foreground truncate text-xs">
                                RUN-{r.id}
                                {r.targetType ? ` · ${r.targetType} ${r.targetId ?? ""}` : ""}
                                {r.errorMessage ? ` · ${r.errorMessage}` : ""}
                              </span>
                            </a>
                          </TableCell>
                          <TableCell className="w-[200px]">
                            <AgentIdentity run={r} />
                          </TableCell>
                          <TableCell className="w-[140px]">
                            <SurfaceBadge surface={r.surface} />
                          </TableCell>
                          <TableCell className="w-[120px] text-right">
                            <span className="text-muted-foreground text-sm tabular-nums">
                              {formatRelative(r.createdAt)}
                            </span>
                          </TableCell>
                          <TableCell className="w-[110px] text-right">
                            <span className="text-muted-foreground text-sm tabular-nums">
                              {formatDuration(r.durationMs)}
                            </span>
                          </TableCell>
                          <TableCell className="w-[110px]">
                            <StepProgressRing
                              percent={r.percent}
                              done={r.stepsDone}
                              total={r.stepsTotal}
                            />
                          </TableCell>
                          <TableCell className="w-[190px]">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <AttemptBadge attempt={r.attempt} />
                              {r.status === "failed" ? (
                                <ErrorCodeChip code={r.errorCode} />
                              ) : (
                                <RunStatusBadge status={r.status} />
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <div className="text-muted-foreground flex flex-col gap-2 text-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-foreground font-medium">Queue mix</span>
          {STATUS_GROUP_ORDER.filter((s) => counts[s]).map((s) => (
            <Badge key={s} variant="outline">
              {STATUS_META[s].label}: {counts[s]}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <a className="hover:text-foreground underline" href="/admin/system/agents/failed">
            Failure sheet
          </a>
          <a className="hover:text-foreground underline" href="/admin/system/agents/usage">
            Cost dashboard
          </a>
          <a className="hover:text-foreground underline" href="/admin/mcp-ops">
            MCP transport
          </a>
          <a className="hover:text-foreground underline" href="/admin/workflows">
            Cron schedules
          </a>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "bad" | "warn";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 sm:border-l sm:pl-3 sm:first:border-l-0 sm:first:pl-0">
      <span className="text-muted-foreground truncate text-xs font-medium">{label}</span>
      <Badge
        variant="outline"
        className={cn(
          "tabular-nums",
          tone === "bad" && "border-destructive/25 bg-destructive/10 text-destructive",
          tone === "warn" && "border-warning/25 bg-warning/10 text-warning",
        )}
      >
        {formatCount(value)}
      </Badge>
    </div>
  );
}

export default AgentQueueApp;
