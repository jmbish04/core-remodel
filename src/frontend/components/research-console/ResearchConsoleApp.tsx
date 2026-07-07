/**
 * @fileoverview ResearchConsoleApp — the LANDING island for the research console
 * (mounted by /admin/shopping/research.astro).
 *
 * Lists ongoing + prior research jobs. While any job is in-flight the list polls
 * `GET /api/research-jobs` every 3s so progress bars, narration lines, and
 * elapsed timers advance live; when everything is terminal the poll stands down
 * (and restarts the moment a new job is queued). A filter row scopes the list to
 * All | Running | Complete | Failed, and a prominent "New research" button opens
 * the template picker.
 *
 * Monolith dark conventions: bg-card + ring-1 ring-border/40 (no 1px borders),
 * sonner + console on catch, credentials:"include", every state handled
 * (loading / empty / error), lucide icons.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FlaskConical, Loader2, Plus, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { NewResearchDialog } from "./NewResearchDialog";
import { JobRow } from "./JobRow";
import { getJson, isActiveStatus, type JobListRow, type JobStatus } from "./types";

const POLL_MS = 3_000;

// ─── Filter tabs ────────────────────────────────────────────────────────────────

type FilterKey = "all" | "running" | "complete" | "failed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "complete", label: "Complete" },
  { key: "failed", label: "Failed" },
];

/** Client-side predicate per filter (running folds pending + running together). */
function matchesFilter(status: JobStatus, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return status === "pending" || status === "running";
    case "complete":
      return status === "complete";
    case "failed":
      return status === "failed";
    default:
      return true;
  }
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function ResearchConsoleApp() {
  const [jobs, setJobs] = useState<JobListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load + poll ──────────────────────────────────────────────────────────────

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setError(null);
    try {
      const data = await getJson<{ jobs: JobListRow[] }>("/api/research-jobs");
      setJobs(data.jobs ?? []);
      setError(null);
    } catch (e) {
      console.error("[research/list]", e);
      // A background poll failure shouldn't nuke the list; only surface on the
      // initial (non-silent) load.
      if (!opts?.silent) {
        setError(e instanceof Error ? e.message : "Failed to load research jobs");
        toast.error(e instanceof Error ? e.message : "Failed to load research jobs");
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  const clearPoll = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Keep the poll running iff at least one job is in-flight. Re-evaluated after
  // every list update so it stands up when a job is queued and stands down when
  // the last one reaches a terminal state.
  const anyActive = useMemo(() => jobs.some((j) => isActiveStatus(j.status)), [jobs]);

  useEffect(() => {
    void load();
    return () => clearPoll();
  }, [load, clearPoll]);

  useEffect(() => {
    clearPoll();
    if (anyActive) {
      pollRef.current = setInterval(() => {
        void load({ silent: true });
      }, POLL_MS);
    }
    return () => clearPoll();
  }, [anyActive, load, clearPoll]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const visible = useMemo(
    () => jobs.filter((j) => matchesFilter(j.status, filter)),
    [jobs, filter],
  );

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: jobs.length, running: 0, complete: 0, failed: 0 };
    for (const j of jobs) {
      if (j.status === "pending" || j.status === "running") c.running += 1;
      else if (j.status === "complete") c.complete += 1;
      else if (j.status === "failed") c.failed += 1;
    }
    return c;
  }, [jobs]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <a
        href="/admin/shopping"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Shopping
      </a>

      {/* Header + primary action. */}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FlaskConical className="size-6 text-primary" />
            Research console
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Launch and track deep-research jobs across showrooms, brands, and products.
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" /> New research
        </Button>
      </div>

      {/* Filter row. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const activeTab = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeTab
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground ring-1 ring-border/40 hover:text-foreground"
              }`}
            >
              {f.label}
              <span
                className={`tabular-nums ${activeTab ? "text-primary-foreground/70" : "text-muted-foreground/60"}`}
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border/40 transition-colors hover:text-foreground"
        >
          <RefreshCcw className="size-3" /> Refresh
        </button>
      </div>

      {/* List body. */}
      <div className="mt-6">
        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : error && jobs.length === 0 ? (
          <div className="rounded-xl bg-card p-8 text-center ring-1 ring-border/40">
            <p className="text-sm text-rose-300">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 gap-1.5"
              onClick={() => void load()}
            >
              <RefreshCcw className="size-3.5" /> Retry
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl bg-card p-10 text-center ring-1 ring-border/40">
            <FlaskConical className="mx-auto size-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">
              {jobs.length === 0
                ? "No research jobs yet"
                : `No ${filter} research jobs`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {jobs.length === 0
                ? "Launch your first deep-research job to see it stream here."
                : "Try a different filter, or start a new research job."}
            </p>
            {jobs.length === 0 ? (
              <Button className="mt-4 gap-1.5" onClick={() => setDialogOpen(true)}>
                <Plus className="size-4" /> New research
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visible.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>

      <NewResearchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onQueued={() => void load()}
      />
    </main>
  );
}
