/**
 * @fileoverview `/admin/health` — the health dashboard island.
 *
 * Shape: a vertical timeline, one section per module group (Storage, API,
 * Durable Objects & Workflows, AI, Cost, Media, Integrations, MCP, Domain data).
 * Each section is a sticky header + a rail of probe rows; a row expands into the
 * probe's own runbook (what success means, what failure means, troubleshooting,
 * the DevOps playbook, the file that owns it, the bindings it touches).
 *
 * Two loads:
 *  - on mount, the catalogue (`GET /api/health/catalogue`) and the last persisted
 *    session (`GET /api/health/session/latest`) — so the page is populated before
 *    anything is probed;
 *  - on click, a live session (`POST /api/health/session`), during which every row
 *    becomes a pulsing skeleton and the button carries the spinner.
 *
 * Mobile first: single column, full-width rows, sticky section headers, the
 * control bar collapsing to stacked blocks; the two-column split and the wider
 * runbook grid only appear from `sm`/`lg` up.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  FileCode2,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TestResult = "SUCCESS" | "DEGRADED" | "FAILURE";
type Severity = "HIGH" | "MEDIUM" | "LOW";

interface CatalogueTest {
  name: string;
  displayName: string;
  description: string;
  healthTsFilepath: string;
  bindingTypesTested: string[];
  whatSuccessMeans: string;
  whatFailureMeans: string;
  troubleshootingSteps: string;
  devOpsPlaybook: string;
  isBillingRisk: boolean;
  severity: Severity;
}

interface CatalogueGroup {
  id: string;
  label: string;
  blurb: string;
  tests: CatalogueTest[];
}

interface ProbeRun {
  name: string;
  result: TestResult;
  details: string;
  durationMs: number;
}

interface SessionResult {
  sessionUuid: string;
  timestamp: string;
  triggeredBy: string;
  overall: TestResult;
  counts: { success: number; degraded: number; failure: number };
  totalDurationMs: number;
  runs: ProbeRun[];
}

/** One tone per outcome, used for the rail dot, the badge and the row ring. */
const TONE: Record<
  TestResult,
  { label: string; chip: string; dot: string; Icon: typeof CheckCircle2 }
> = {
  SUCCESS: {
    label: "Success",
    chip: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30",
    dot: "bg-emerald-500/15 text-emerald-400",
    Icon: CheckCircle2,
  },
  DEGRADED: {
    label: "Degraded",
    chip: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30",
    dot: "bg-amber-500/15 text-amber-400",
    Icon: AlertTriangle,
  },
  FAILURE: {
    label: "Failure",
    chip: "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30",
    dot: "bg-rose-500/15 text-rose-400",
    Icon: XCircle,
  },
};

const SEVERITY_CHIP: Record<Severity, string> = {
  HIGH: "text-rose-400/90",
  MEDIUM: "text-amber-400/90",
  LOW: "text-muted-foreground",
};

type Filter = "all" | "problems" | "billing";

function StatusChip({ result }: { result: TestResult }) {
  const tone = TONE[result];
  return (
    <Badge className={cn("gap-1 border-0 font-mono text-[10px] tracking-wide", tone.chip)}>
      <tone.Icon className="size-3" />
      {tone.label.toUpperCase()}
    </Badge>
  );
}

/** The pulsing placeholder a row becomes while its session is in flight. */
function RowSkeleton() {
  return (
    <li className="relative py-2">
      <span
        aria-hidden
        className="absolute -left-7 top-3 z-10 grid size-[30px] animate-pulse place-items-center rounded-full bg-foreground/10 ring-4 ring-background"
      />
      <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="h-3 w-1/2 animate-pulse rounded bg-foreground/10" />
          <div className="h-4 w-16 animate-pulse rounded bg-foreground/10" />
        </div>
        <div className="mt-2 h-2.5 w-3/4 animate-pulse rounded bg-foreground/[0.07]" />
      </div>
    </li>
  );
}

function RunbookField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground/85">{value}</p>
    </div>
  );
}

function TestRow({
  test,
  run,
  expanded,
  onToggle,
}: {
  test: CatalogueTest;
  run: ProbeRun | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const result: TestResult = run?.result ?? "DEGRADED";
  const tone = TONE[result];
  const neverRun = !run;

  return (
    <li className="relative py-2">
      <span
        aria-hidden
        className={cn(
          "absolute -left-7 top-3 z-10 grid size-[30px] place-items-center rounded-full ring-4 ring-background",
          neverRun ? "bg-foreground/10 text-muted-foreground" : tone.dot,
        )}
      >
        {neverRun ? <Activity className="size-3.5" /> : <tone.Icon className="size-3.5" />}
      </span>

      <div
        className={cn(
          "rounded-lg border bg-background/40 transition-colors",
          result === "FAILURE" && !neverRun
            ? "border-rose-500/30"
            : result === "DEGRADED" && !neverRun
              ? "border-amber-500/25"
              : "border-border/60",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium">{test.displayName}</span>
              {test.isBillingRisk ? (
                <span
                  title="Watches for a sudden jump in spend"
                  className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-400"
                >
                  <CircleDollarSign className="size-3" />
                  COST
                </span>
              ) : null}
              <span
                className={cn(
                  "font-mono text-[10px] tracking-[0.15em]",
                  SEVERITY_CHIP[test.severity],
                )}
              >
                {test.severity}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {neverRun ? test.description : run.details || test.description}
            </p>
            <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span>{test.name}</span>
              {run ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{run.durationMs} ms</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {neverRun ? (
              <span className="font-mono text-[10px] text-muted-foreground">NOT RUN</span>
            ) : (
              <StatusChip result={result} />
            )}
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
              aria-hidden
            />
          </div>
        </button>

        {expanded ? (
          <div className="space-y-4 border-t border-border/60 px-3 py-3">
            <RunbookField label="What it checks" value={test.description} />
            {run?.details ? <RunbookField label="Last result" value={run.details} /> : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <RunbookField label="Success means" value={test.whatSuccessMeans} />
              <RunbookField label="Failure means" value={test.whatFailureMeans} />
              <RunbookField label="Troubleshooting" value={test.troubleshootingSteps} />
              <RunbookField label="DevOps playbook" value={test.devOpsPlaybook} />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <FileCode2 className="size-3" />
                {test.healthTsFilepath}
              </span>
              {test.bindingTypesTested.map((b) => (
                <span
                  key={b}
                  className="rounded bg-foreground/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-foreground/70"
                >
                  {b}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function GroupSection({
  group,
  runsByName,
  running,
  expanded,
  onToggle,
}: {
  group: CatalogueGroup;
  runsByName: Map<string, ProbeRun>;
  running: boolean;
  expanded: Set<string>;
  onToggle: (name: string) => void;
}) {
  if (group.tests.length === 0) return null;

  const results = group.tests
    .map((t) => runsByName.get(t.name)?.result)
    .filter((r): r is TestResult => Boolean(r));
  const worst: TestResult | null = results.includes("FAILURE")
    ? "FAILURE"
    : results.includes("DEGRADED")
      ? "DEGRADED"
      : results.length > 0
        ? "SUCCESS"
        : null;

  return (
    <section className="mt-8">
      <div className="sticky top-0 z-10 mb-3 flex items-center gap-3 bg-background/90 py-2 backdrop-blur">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          {group.label}
        </span>
        {worst && !running ? (
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              worst === "FAILURE"
                ? "bg-rose-400"
                : worst === "DEGRADED"
                  ? "bg-amber-400"
                  : "bg-emerald-400",
            )}
          />
        ) : null}
        <span className="h-px flex-1 bg-border/40" />
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {group.tests.length}
        </span>
      </div>
      <p className="mb-2 pl-7 text-xs text-muted-foreground">{group.blurb}</p>

      <ol className="relative pl-7">
        <span aria-hidden className="absolute bottom-2 left-[15px] top-2 w-px bg-border/40" />
        {group.tests.map((test) =>
          running ? (
            <RowSkeleton key={test.name} />
          ) : (
            <TestRow
              key={test.name}
              test={test}
              run={runsByName.get(test.name)}
              expanded={expanded.has(test.name)}
              onToggle={() => onToggle(test.name)}
            />
          ),
        )}
      </ol>
    </section>
  );
}

export function HealthDashboardApp() {
  const [groups, setGroups] = useState<CatalogueGroup[] | null>(null);
  const [session, setSession] = useState<SessionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catRes, sessRes] = await Promise.all([
        fetch("/api/health/catalogue"),
        fetch("/api/health/session/latest"),
      ]);
      if (catRes.status === 401 || sessRes.status === 401) {
        throw new Error("Not signed in as admin — sign in to view the health dashboard.");
      }
      if (!catRes.ok) throw new Error(`Failed to load the test catalogue (HTTP ${catRes.status})`);
      const cat = (await catRes.json()) as { groups: CatalogueGroup[] };
      setGroups(cat.groups);
      if (sessRes.ok) {
        const s = (await sessRes.json()) as { session: SessionResult | null };
        setSession(s.session);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load health data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/health/session", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Health session failed (HTTP ${res.status})`);
      }
      setSession((await res.json()) as SessionResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Health session failed");
    } finally {
      setRunning(false);
    }
  }, []);

  const runsByName = useMemo(
    () => new Map((session?.runs ?? []).map((r) => [r.name, r])),
    [session],
  );

  const visibleGroups = useMemo(() => {
    if (!groups) return [];
    if (filter === "all") return groups;
    return groups
      .map((g) => ({
        ...g,
        tests: g.tests.filter((t) =>
          filter === "billing"
            ? t.isBillingRisk
            : runsByName.get(t.name)?.result === "FAILURE" ||
              runsByName.get(t.name)?.result === "DEGRADED",
        ),
      }))
      .filter((g) => g.tests.length > 0);
  }, [groups, filter, runsByName]);

  const toggle = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const totalTests = groups?.reduce((n, g) => n + g.tests.length, 0) ?? 0;
  const ranAt = session ? new Date(session.timestamp).toLocaleString() : null;

  return (
    <div>
      {/* Control bar — stacks on mobile, one row from sm up. */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Overall</span>
            {running ? (
              <Badge className="gap-1 border-0 bg-foreground/10 font-mono text-[10px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                RUNNING
              </Badge>
            ) : session ? (
              <StatusChip result={session.overall} />
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
            {session && !running ? (
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {session.counts.success}✓ · {session.counts.degraded}~ · {session.counts.failure}✕
              </span>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            {running
              ? `probing ${totalTests} tests…`
              : ranAt
                ? `${totalTests} tests · last run ${ranAt} · ${session?.totalDurationMs ?? 0} ms`
                : `${totalTests} tests registered · never run`}
          </div>
        </div>
        <Button onClick={run} disabled={running || loading} className="gap-1.5 sm:shrink-0">
          {running ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {running ? "Running health checks…" : "Run health checks"}
        </Button>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ["all", "All tests"],
            ["problems", "Problems only"],
            ["billing", "Cost watchers"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors",
              filter === id
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-3 text-sm text-rose-400">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-8 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-border/60 bg-background/40"
            />
          ))}
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border/60 bg-background/40 px-4 py-10 text-center text-sm text-muted-foreground">
          {filter === "problems" && session
            ? "No failures or degradations in the last run."
            : "No tests match this filter."}
        </div>
      ) : (
        visibleGroups.map((group) => (
          <GroupSection
            key={group.id}
            group={group}
            runsByName={runsByName}
            running={running}
            expanded={expanded}
            onToggle={toggle}
          />
        ))
      )}
    </div>
  );
}

export default HealthDashboardApp;
