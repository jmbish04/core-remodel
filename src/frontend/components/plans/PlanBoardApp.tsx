import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  FileText,
  Link2,
  Loader2,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  api,
  apiPatch,
  ChangeTypeBadge,
  ProgressBar,
  statusDotClass,
  statusLabel,
  StatusBadge,
  TASK_STATUSES,
  type PlanDetail,
  type Task,
  type TaskStatus,
} from "./shared";

const POLL_MS = 10_000;
// After a local edit we pause polling briefly so an in-flight background fetch
// can't clobber the optimistic value with a stale row before the write lands.
const EDIT_QUIET_MS = 4_000;

const ALL = "all";

interface Filters {
  workstream: string;
  status: string;
}

/** Read the current filters out of the URL query (shareable board state). */
function readFilters(): Filters {
  if (typeof window === "undefined") return { workstream: ALL, status: ALL };
  const params = new URLSearchParams(window.location.search);
  return {
    workstream: params.get("workstream") || ALL,
    status: params.get("status") || ALL,
  };
}

/** Mirror the active filters into the URL query without adding history entries. */
function writeFilters(filters: Filters) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  for (const key of ["workstream", "status"] as const) {
    const value = filters[key];
    if (value && value !== ALL) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

export function PlanBoardApp({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => readFilters());
  const [openPhases, setOpenPhases] = useState<Record<number, boolean>>({});

  const loadedOnce = useRef(false);
  // Timestamp of the last local edit; polling defers until this quiet window ends.
  const editingUntil = useRef(0);

  const load = useCallback(async () => {
    try {
      const payload = await api<PlanDetail>(`/api/admin/plans/${encodeURIComponent(slug)}`);
      setDetail(payload);
      setNotFound(false);
    } catch (error) {
      const status = (error as { status?: number } | null | undefined)?.status;
      if (status === 404) {
        setNotFound(true);
      } else if (!loadedOnce.current) {
        toast.error(error instanceof Error ? error.message : "Failed to load plan board");
      }
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      // Skip a background refresh while a local edit is settling.
      if (Date.now() < editingUntil.current) return;
      if (!mounted) return;
      await load();
    };
    void load();
    const interval = window.setInterval(tick, POLL_MS);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [load]);

  // Persist filters to the URL whenever they change.
  useEffect(() => {
    writeFilters(filters);
  }, [filters]);

  const setFilter = (key: keyof Filters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const workstreams = detail?.workstreams ?? [];

  const filteredTasks = useMemo(() => {
    const tasks = detail?.tasks ?? [];
    return tasks.filter((task) => {
      if (filters.workstream !== ALL && task.workstream !== filters.workstream) return false;
      if (filters.status !== ALL && task.status !== filters.status) return false;
      return true;
    });
  }, [detail?.tasks, filters]);

  // Group the filtered tasks by phase, sorted ascending; each phase's tasks by sortOrder.
  const grouped = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const task of filteredTasks) {
      const bucket = map.get(task.phase);
      if (bucket) bucket.push(task);
      else map.set(task.phase, [task]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([phase, tasks]) => ({
        phase,
        tasks: [...tasks].sort((a, b) => a.sortOrder - b.sortOrder),
      }));
  }, [filteredTasks]);

  const phaseProgress = useMemo(() => {
    const map = new Map<number, PlanDetail["phases"][number]["progress"]>();
    for (const entry of detail?.phases ?? []) map.set(entry.phase, entry.progress);
    return map;
  }, [detail?.phases]);

  const togglePhase = (phase: number) =>
    setOpenPhases((current) => ({
      ...current,
      // Default-open (undefined -> treated as open); first toggle closes it.
      [phase]: current[phase] === undefined ? false : !current[phase],
    }));

  /** Optimistically apply a status change, then PATCH; roll back on failure. */
  const updateStatus = useCallback(
    async (task: Task, nextStatus: TaskStatus) => {
      if (nextStatus === task.status) return;
      editingUntil.current = Date.now() + EDIT_QUIET_MS;
      const previous = task.status;

      setDetail((current) => {
        if (!current) return current;
        return {
          ...current,
          tasks: current.tasks.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)),
        };
      });

      try {
        await apiPatch<{ success: boolean; task: Task }>(
          `/api/admin/plans/tasks/${task.id}`,
          { status: nextStatus },
        );
        // Refresh soon so header/phase progress bars reflect the new counts.
        editingUntil.current = Date.now() + 800;
      } catch (error) {
        // Roll the optimistic change back.
        setDetail((current) => {
          if (!current) return current;
          return {
            ...current,
            tasks: current.tasks.map((t) =>
              t.id === task.id ? { ...t, status: previous } : t,
            ),
          };
        });
        toast.error(error instanceof Error ? error.message : "Failed to update task status");
      }
    },
    [],
  );

  if (loading && !detail && !notFound) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading board…
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Card className="ring-1 ring-border/40">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertTriangle className="size-6 text-amber-400" />
            <p className="text-sm text-muted-foreground">
              No plan found for <span className="font-mono text-foreground">{slug}</span>.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!detail) return null;

  const { plan, progress } = detail;
  const filtersActive = filters.workstream !== ALL || filters.status !== ALL;

  return (
    <div className="space-y-6">
      <BackLink />

      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">{plan.title}</h1>
            {plan.description ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{plan.description}</p>
            ) : null}
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="size-3.5" />
              <span className="font-mono">{plan.docPath}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold tabular-nums">{progress.percent}%</p>
            <p className="text-xs text-muted-foreground">
              {progress.counts.done} / {progress.total} tasks done
            </p>
          </div>
        </div>
        <ProgressBar percent={progress.percent} tone="success" />
      </header>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-card/40 px-3 py-3 ring-1 ring-border/40">
        <div className="flex flex-col gap-1">
          <label className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Workstream
          </label>
          <Select
            value={filters.workstream}
            onValueChange={(v) => setFilter("workstream", (v as string) ?? ALL)}
          >
            <SelectTrigger size="sm" className="w-52">
              <SelectValue<string>
                placeholder="All workstreams"
                getLabel={(v) => (v === ALL ? "All workstreams" : v)}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All workstreams</SelectItem>
              {workstreams.map((w) => (
                <SelectItem key={w.workstream} value={w.workstream}>
                  {w.workstream} · {w.progress.percent}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Status
          </label>
          <Select
            value={filters.status}
            onValueChange={(v) => setFilter("status", (v as string) ?? ALL)}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue<string>
                placeholder="All statuses"
                getLabel={(v) => (v === ALL ? "All statuses" : statusLabel(v as TaskStatus))}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtersActive ? (
          <button
            type="button"
            onClick={() => setFilters({ workstream: ALL, status: ALL })}
            className="mt-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Clear filters
          </button>
        ) : null}

        <div className="mt-auto ml-auto text-xs text-muted-foreground tabular-nums">
          {filteredTasks.length} task{filteredTasks.length === 1 ? "" : "s"}
        </div>

        <StatusLegend />
      </div>

      {/* Phase groups */}
      {grouped.length === 0 ? (
        <Card className="ring-1 ring-border/40">
          <CardContent className="py-14 text-center">
            <p className="text-sm text-muted-foreground">
              No tasks match the current filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ phase, tasks }) => {
            const open = openPhases[phase] ?? true;
            const pp = phaseProgress.get(phase);
            return (
              <section
                key={phase}
                className="overflow-hidden rounded-xl bg-card/40 ring-1 ring-border/40"
              >
                <button
                  type="button"
                  onClick={() => togglePhase(phase)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/20"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      open ? "" : "-rotate-90",
                    )}
                  />
                  <span className="font-semibold">Phase {phase}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {tasks.length} task{tasks.length === 1 ? "" : "s"}
                  </span>
                  {pp ? (
                    <span className="ml-auto flex min-w-0 items-center gap-3">
                      <span className="hidden w-40 sm:block">
                        <ProgressBar percent={pp.percent} />
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {pp.counts.done}/{pp.total} · {pp.percent}%
                      </span>
                    </span>
                  ) : null}
                </button>

                {open ? (
                  <div className="divide-y divide-border/40">
                    {tasks.map((task) => (
                      <TaskRow key={task.id} task={task} onStatusChange={updateStatus} />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <a
      href="/admin/plans"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      All plans
    </a>
  );
}

function StatusLegend() {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/20 pt-2 text-[11px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-wider">Legend</span>
      {TASK_STATUSES.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", statusDotClass(s))} />
          {statusLabel(s)}
        </span>
      ))}
    </div>
  );
}

function TaskRow({
  task,
  onStatusChange,
}: {
  task: Task;
  onStatusChange: (task: Task, next: TaskStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailText = task.notes?.trim() || task.description?.trim() || "";
  const isLong = detailText.length > 140;
  const shownText = expanded || !isLong ? detailText : `${detailText.slice(0, 140).trimEnd()}…`;

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {task.taskKey}
          </span>
          <ChangeTypeBadge changeType={task.changeType} />
          <span className="text-[11px] text-muted-foreground">{task.workstream}</span>
        </div>

        <p className="text-sm font-medium leading-snug">{task.title}</p>

        {task.targetRoute ? (
          <p className="font-mono text-xs text-muted-foreground/80">{task.targetRoute}</p>
        ) : null}

        {task.dependsOn && task.dependsOn.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {task.dependsOn.map((dep) => (
              <span
                key={dep}
                className="inline-flex items-center gap-1 rounded-full bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border/30"
              >
                <Link2 className="size-3" />
                {dep}
              </span>
            ))}
          </div>
        ) : null}

        {detailText ? (
          <div className="pt-0.5 text-xs text-muted-foreground">
            <span>{shownText}</span>
            {isLong ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="ml-1.5 text-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
              >
                {expanded ? "less" : "more"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Status control */}
      <div className="flex items-center gap-2 sm:pt-0.5">
        <StatusBadge status={task.status} className="hidden sm:inline-flex" />
        <Select
          value={task.status}
          onValueChange={(v) => onStatusChange(task, v as TaskStatus)}
        >
          <SelectTrigger size="sm" className="w-36" aria-label={`Set status for ${task.taskKey}`}>
            <SelectValue<string> getLabel={(v) => statusLabel(v as TaskStatus)} />
          </SelectTrigger>
          <SelectContent>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                <span className="inline-flex items-center gap-2">
                  <span className={cn("size-1.5 rounded-full", statusDotClass(s))} />
                  {statusLabel(s)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
