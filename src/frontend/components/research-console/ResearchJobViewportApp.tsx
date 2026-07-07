/**
 * @fileoverview ResearchJobViewportApp — the per-job VIEWPORT island (mounted by
 * /admin/shopping/research/[id].astro).
 *
 * Streams a single research job live: it polls GET /api/research-jobs/:id every
 * 3s while the job is pending|running, then stands the poll down on a terminal
 * status. The page stacks:
 *   - HEADER   — kind badge, title, status chip, animated progress + %,
 *     currentStep, entity deep-link, created/elapsed/completed, error callout;
 *   - PLAN     — job.plan as a collapsible markdown block;
 *   - TIMELINE — ordered steps with expandable artifacts (new steps animate in);
 *   - REPORT   — job.report via the shared MarkdownProse helper;
 *   - SOURCES  — job.sources reference list;
 *   - CANDIDATES (discovery kinds only) — the intake table.
 *
 * Monolith dark conventions: bg-card + ring-1 ring-border/40 (no 1px borders),
 * sonner + console on catch, credentials:"include", every state handled.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Clock,
  FileText,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { MarkdownProse } from "@/components/research/MarkdownProse";

import { KindBadge, ProgressBar, StatusChip } from "./JobBadges";
import { StepTimeline } from "./StepTimeline";
import { SourcesCard } from "./SourcesCard";
import { CandidatesSection } from "./CandidatesSection";
import {
  entityHref,
  formatDateTime,
  formatElapsed,
  getJson,
  isActiveStatus,
  isDiscoveryKind,
  type JobDetail,
  type JobDetailResponse,
  type JobStep,
} from "./types";

const POLL_MS = 3_000;

// ─── Collapsible card shell ─────────────────────────────────────────────────────

function CollapsibleCard({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl bg-card ring-1 ring-border/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-base font-semibold">
          {icon}
          {title}
        </span>
        <ChevronDown
          className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? <div className="px-5 pb-5">{children}</div> : null}
    </section>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────────

function JobHeader({ job }: { job: JobDetail }) {
  const active = isActiveStatus(job.status);
  const entity = entityHref(job);

  return (
    <section className="rounded-xl bg-card p-5 ring-1 ring-border/40">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={job.kind} />
        <StatusChip status={job.status} />
        {entity ? (
          <a
            href={entity}
            className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border/40 transition-colors hover:text-foreground"
          >
            {job.entityName || "View entity"}
            <ArrowUpRight className="size-3" />
          </a>
        ) : null}
      </div>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        {job.title || "Untitled research"}
      </h1>

      {job.criteria && !job.title.includes(job.criteria) ? (
        <p className="mt-1 text-sm text-muted-foreground">{job.criteria}</p>
      ) : null}

      {/* Live progress — only while in-flight. */}
      {active ? (
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="line-clamp-1 flex-1">{job.currentStep || "Working…"}</span>
            <span className="shrink-0 tabular-nums">{Math.round(job.progress)}%</span>
          </div>
          <ProgressBar value={job.progress} status={job.status} />
        </div>
      ) : null}

      {/* Timeline metadata. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" /> Created {formatDateTime(job.createdAt)}
        </span>
        <span>
          {active ? "Elapsed" : "Ran"} {formatElapsed(job.createdAt, job.completedAt)}
        </span>
        {job.completedAt ? <span>Completed {formatDateTime(job.completedAt)}</span> : null}
      </div>

      {/* Failure callout. */}
      {job.status === "failed" && job.error ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-rose-500/10 p-3 ring-1 ring-rose-500/30">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-400" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-rose-300">Research failed</p>
            <p className="mt-0.5 text-xs text-rose-300/80">{job.error}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────────

export function ResearchJobViewportApp({ id }: { id: number }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [steps, setSteps] = useState<JobStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      try {
        const data = await getJson<JobDetailResponse>(`/api/research-jobs/${id}`);
        setJob(data.job);
        setSteps(data.steps ?? []);
        if (data.job?.title) document.title = data.job.title;
        // Stand the poll down once the job reaches a terminal state.
        if (data.job && !isActiveStatus(data.job.status)) clearPoll();
      } catch (e) {
        console.error("[research/job]", e);
        if (!opts?.silent) {
          setNotFound(true);
          toast.error(e instanceof Error ? e.message : "Failed to load research job");
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [id, clearPoll],
  );

  // Initial load.
  useEffect(() => {
    setLoading(true);
    void load();
    return () => clearPoll();
  }, [load, clearPoll]);

  // Poll while the job is in-flight; restart if a fresh load shows it active
  // again (e.g. re-run). Torn down on terminal status inside `load`.
  const active = job ? isActiveStatus(job.status) : false;
  useEffect(() => {
    clearPoll();
    if (active) {
      pollRef.current = setInterval(() => {
        void load({ silent: true });
      }, POLL_MS);
    }
    return () => clearPoll();
  }, [active, load, clearPoll]);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (notFound || !job) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <a
          href="/admin/shopping/research"
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Research
        </a>
        <div className="mt-6 rounded-xl bg-card p-10 text-center ring-1 ring-border/40">
          <AlertTriangle className="mx-auto size-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium">Research job not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            It may have been removed, or the link is stale.
          </p>
        </div>
      </main>
    );
  }

  const discovery = isDiscoveryKind(job.kind);
  const candidates = job.result?.candidates ?? [];

  return (
    <main className="container mx-auto max-w-4xl space-y-6 px-4 py-10">
      <a
        href="/admin/shopping/research"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Research
      </a>

      <JobHeader job={job} />

      {/* Plan — collapsible, defaults closed once the report exists. */}
      {job.plan ? (
        <CollapsibleCard title="Plan" icon={<FileText className="size-4" />} defaultOpen={!job.report}>
          <div className="rounded-lg bg-muted/40 p-4 ring-1 ring-border/40">
            <MarkdownProse>{job.plan}</MarkdownProse>
          </div>
        </CollapsibleCard>
      ) : null}

      {/* Step timeline. */}
      <section className="rounded-xl bg-card p-5 ring-1 ring-border/40">
        <h2 className="mb-4 text-base font-semibold">Steps</h2>
        <StepTimeline steps={steps} />
      </section>

      {/* Report (when present). */}
      {job.report ? (
        <section className="rounded-xl bg-card p-5 ring-1 ring-border/40">
          <h2 className="mb-3 text-base font-semibold">Report</h2>
          <MarkdownProse>{job.report}</MarkdownProse>
        </section>
      ) : null}

      {/* Discovery candidates + intake. */}
      {discovery ? (
        <CandidatesSection
          jobId={id}
          kind={job.kind}
          candidates={candidates}
          onIntake={() => void load({ silent: true })}
        />
      ) : null}

      {/* Sources. */}
      <SourcesCard sources={job.sources} />
    </main>
  );
}
