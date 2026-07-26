/**
 * @fileoverview The artifact bundle behind a preview changelog entry.
 *
 * Renders on /admin/changelog/preview/[slug] under the normal entry view: the
 * PRD, the design brief, the PROMPT (with a copy button — that is the handoff
 * artifact a human pastes into a coding agent), the linked plan tasks with their
 * LIVE status, and a link to the raw conversation transcript.
 *
 * The plan tasks are grouped by phase into collapsible sections (a long flat list
 * is unreadable) and kept LIVE: the component polls every 10s AND holds a
 * websocket to the plan's realtime room, so as an agent ticks a task's status /
 * attaches a PR the board here updates without a manual refresh. The websocket is
 * a poke — any message triggers a refetch — with the 10s poll as the fallback.
 *
 * The transcript is NOT inlined. It is a ~450KB R2 object fetched on demand, and
 * its size is shown before you click so the choice is informed.
 *
 * The coverage note sits directly beside the transcript link, never below the
 * fold and never in a tooltip. Transcripts are frequently partial (a dump often
 * only reaches a compaction boundary), and a reader who assumes completeness
 * will read a gap as a decision nobody made.
 */
import { ChevronDown, GitPullRequest } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MarkdownProse } from "@/components/research/MarkdownProse";
import { ProgressBar } from "@/components/plans/shared";
import { cn } from "@/lib/utils";

export type ProposalTaskStatus =
  | "pending"
  | "in_progress"
  | "in_review"
  | "blocked"
  | "deferred"
  | "done";

export interface ProposalTaskView {
  taskKey: string;
  title: string;
  workstream: string;
  phase: number;
  changeType: string;
  status: ProposalTaskStatus;
  notes: string | null;
  sortOrder: number;
  prNumber: number | null;
  changelogSlug: string | null;
}

export interface ProposalBundleProps {
  slug: string;
  status: string;
  sourceKind: string;
  sourceModel: string | null;
  planSlug: string | null;
  prdMarkdown: string | null;
  designBriefMarkdown: string | null;
  promptMarkdown: string | null;
  tasks: ProposalTaskView[];
  context: {
    available: boolean;
    bytes: number | null;
    sha256: string | null;
    coverageNote: string | null;
    href: string;
  };
}

const TASK_STATUS_STYLE: Record<ProposalTaskStatus, string> = {
  done: "bg-emerald-500/12 text-emerald-300",
  in_review: "bg-violet-500/12 text-violet-300",
  in_progress: "bg-sky-500/12 text-sky-300",
  blocked: "bg-rose-500/12 text-rose-300",
  deferred: "bg-zinc-500/12 text-zinc-400",
  pending: "bg-amber-500/12 text-amber-300",
};

/** Statuses that count as "work is essentially done for this task". */
const DONE_ISH: ReadonlySet<ProposalTaskStatus> = new Set(["done", "in_review"]);

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Raw plan_task row as returned by GET /api/changelog/proposals/:slug. */
interface RawTask {
  taskKey: string;
  title: string;
  workstream: string;
  phase: number;
  changeType: string;
  status: string;
  notes: string | null;
  sortOrder?: number;
  prNumber?: number | null;
  changelogSlug?: string | null;
}

function mapTask(t: RawTask): ProposalTaskView {
  return {
    taskKey: t.taskKey,
    title: t.title,
    workstream: t.workstream,
    phase: t.phase,
    changeType: t.changeType,
    status: (t.status as ProposalTaskStatus) ?? "pending",
    notes: t.notes ?? null,
    sortOrder: t.sortOrder ?? 0,
    prNumber: t.prNumber ?? null,
    changelogSlug: t.changelogSlug ?? null,
  };
}

const POLL_MS = 10_000;
const PING_MS = 25_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * Keep the task list live: seed from the SSR snapshot, then poll every 10s and
 * hold a websocket to `plan:<planSlug>`. Any socket message pokes an immediate
 * refetch; the poll is the fallback if the socket is down. Returns the current
 * tasks plus a `connected` flag for the little live indicator.
 */
function useLiveTasks(slug: string, planSlug: string | null, initial: ProposalTaskView[]) {
  const [tasks, setTasks] = useState<ProposalTaskView[]>(initial);
  const [connected, setConnected] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/changelog/proposals/${encodeURIComponent(slug)}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { tasks?: RawTask[] };
      if (Array.isArray(data.tasks)) setTasks(data.tasks.map(mapTask));
    } catch {
      // Keep the last good snapshot; the next tick retries.
    }
  }, [slug]);

  // 10s poll — the always-on fallback.
  useEffect(() => {
    const id = window.setInterval(() => void refetch(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refetch]);

  // Websocket poke → refetch immediately on any message.
  useEffect(() => {
    if (!planSlug) return;
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const room = encodeURIComponent(`plan:${planSlug}`);
      ws = new WebSocket(`${proto}://${window.location.host}/api/realtime/plans?room=${room}`);

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        ping = setInterval(() => {
          try {
            ws?.send("ping");
          } catch {
            // socket closing — onclose reconnects
          }
        }, PING_MS);
      };
      ws.onmessage = (event) => {
        if (typeof event.data === "string" && event.data !== "pong") void refetch();
      };
      ws.onclose = () => {
        setConnected(false);
        if (ping) clearInterval(ping);
        if (disposed) return;
        attempt += 1;
        reconnect = setTimeout(connect, Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS));
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          // noop — onclose handles reconnect
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnect) clearTimeout(reconnect);
      if (ping) clearInterval(ping);
      try {
        ws?.close();
      } catch {
        // noop
      }
    };
  }, [planSlug, refetch]);

  return { tasks, connected };
}

/** Copy-to-clipboard button for the PROMPT — the whole point of rendering it. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard is blocked outside a secure context / without permission.
          // Say so rather than silently appearing to have copied nothing.
          setCopied(false);
          window.prompt("Copy the prompt manually:", text);
        }
      }}
      className={cn(
        "rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors",
        copied
          ? "bg-emerald-500/12 text-emerald-300 ring-emerald-500/30"
          : "bg-card text-muted-foreground ring-border/40 hover:text-foreground",
      )}
    >
      {copied ? "Copied" : "Copy prompt"}
    </button>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4 rounded-xl bg-card p-5 ring-1 ring-border/40">{children}</div>
    </section>
  );
}

/** Green pulse when the websocket is live; muted when we're on the poll fallback. */
function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-medium ring-1",
        connected
          ? "bg-emerald-500/12 text-emerald-300 ring-emerald-500/25"
          : "bg-card text-muted-foreground ring-border/40",
      )}
      title={connected ? "Live — updates over websocket" : "Polling every 10s"}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          connected ? "animate-pulse bg-emerald-400" : "bg-muted-foreground/60",
        )}
      />
      {connected ? "Live" : "Polling"}
    </span>
  );
}

/** PR chip — links to the entry that documents the task when we know its slug. */
function PrChip({ prNumber, changelogSlug }: { prNumber: number; changelogSlug: string | null }) {
  const inner = (
    <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/12 px-1.5 py-0.5 text-[10px] font-medium text-violet-300 ring-1 ring-violet-500/25">
      <GitPullRequest className="size-3" />#{prNumber}
    </span>
  );
  if (!changelogSlug) return inner;
  return (
    <a href={`/admin/changelog/${changelogSlug}`} className="hover:opacity-80">
      {inner}
    </a>
  );
}

function TaskItem({ task }: { task: ProposalTaskView }) {
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium",
          TASK_STATUS_STYLE[task.status],
        )}
      >
        {task.status.replace("_", " ")}
      </span>
      <span className="shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground">{task.taskKey}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground/85">{task.title}</p>
        {task.notes ? <p className="mt-0.5 text-[11px] text-muted-foreground/80">{task.notes}</p> : null}
      </div>
      {task.prNumber != null ? (
        <span className="shrink-0 pt-0.5">
          <PrChip prNumber={task.prNumber} changelogSlug={task.changelogSlug} />
        </span>
      ) : null}
      <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">{task.workstream}</span>
    </li>
  );
}

function PhaseGroup({ phase, tasks }: { phase: number; tasks: ProposalTaskView[] }) {
  const [open, setOpen] = useState(true);
  const done = tasks.filter((t) => t.status === "done").length;
  const doneIsh = tasks.filter((t) => DONE_ISH.has(t.status)).length;
  const percent = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
  const prs = tasks.filter((t) => t.prNumber != null).length;
  // "Complete pending PR" — all work landed but nothing merged yet.
  const pendingMerge = done < tasks.length && doneIsh === tasks.length;

  return (
    <section className="overflow-hidden rounded-xl bg-card/40 ring-1 ring-border/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
      >
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open ? "" : "-rotate-90",
          )}
        />
        <span className="font-semibold">{phase === 0 ? "Phase 0 · Now" : `Phase ${phase}`}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {tasks.length} task{tasks.length === 1 ? "" : "s"}
        </span>
        {pendingMerge ? (
          <span className="rounded-md bg-violet-500/12 px-1.5 py-0.5 text-[10px] font-medium text-violet-300 ring-1 ring-violet-500/25">
            pending PR
          </span>
        ) : null}
        {prs > 0 ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <GitPullRequest className="size-3" />
            {prs}
          </span>
        ) : null}
        <span className="ml-auto flex min-w-0 items-center gap-3">
          <span className="hidden w-40 sm:block">
            <ProgressBar percent={percent} />
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {done}/{tasks.length} · {percent}%
          </span>
        </span>
      </button>
      {open ? <ul className="divide-y divide-border/30 border-t border-border/30">{tasks.map((t) => <TaskItem key={t.taskKey} task={t} />)}</ul> : null}
    </section>
  );
}

export function ProposalBundle(props: ProposalBundleProps) {
  const { prdMarkdown, designBriefMarkdown, promptMarkdown, context } = props;
  const { tasks, connected } = useLiveTasks(props.slug, props.planSlug, props.tasks);

  // Group live tasks by phase (ascending), each phase's tasks by sortOrder.
  const grouped = useMemo(() => {
    const map = new Map<number, ProposalTaskView[]>();
    for (const t of tasks) {
      const bucket = map.get(t.phase);
      if (bucket) bucket.push(t);
      else map.set(t.phase, [t]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([phase, ts]) => ({
        phase,
        tasks: [...ts].sort((a, b) => a.sortOrder - b.sortOrder || a.taskKey.localeCompare(b.taskKey)),
      }));
  }, [tasks]);

  const overall = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "done").length;
    return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [tasks]);

  return (
    <div className="mt-10 border-t border-border/40 pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-violet-500/12 px-2 py-0.5 text-[11px] font-medium text-violet-300">
          Proposal bundle
        </span>
        <span className="rounded-md bg-card px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/40">
          {props.status}
        </span>
        <span className="text-[11px] text-muted-foreground">
          filed by {props.sourceKind.replace("_", " ")}
          {props.sourceModel ? ` · ${props.sourceModel}` : ""}
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        The thinking behind this entry, carried forward so it can be picked up later without
        rebuilding it from a summary.
      </p>

      {promptMarkdown ? (
        <Panel
          title="Prompt"
          subtitle="The handoff artifact — paste this to start a coding agent."
          action={<CopyButton text={promptMarkdown} />}
        >
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90">
            {promptMarkdown}
          </pre>
        </Panel>
      ) : null}

      {prdMarkdown ? (
        <Panel title="PRD">
          <MarkdownProse>{prdMarkdown}</MarkdownProse>
        </Panel>
      ) : null}

      {designBriefMarkdown ? (
        <Panel title="Design brief">
          <MarkdownProse>{designBriefMarkdown}</MarkdownProse>
        </Panel>
      ) : null}

      <Panel
        title="Original conversation"
        subtitle="Raw and unsummarized — the rejected alternatives and the constraints found mid-discussion live here, not in the PRD."
      >
        {context.available ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={context.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-sky-500/12 px-2.5 py-1 text-[11px] font-medium text-sky-300 ring-1 ring-sky-500/25 hover:bg-sky-500/20"
              >
                Open transcript ↗
              </a>
              <span className="text-[11px] text-muted-foreground">{formatBytes(context.bytes)}</span>
              {context.sha256 ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  sha256 {context.sha256.slice(0, 12)}…
                </span>
              ) : null}
            </div>
            {/*
             * Rendered as a warning, not a footnote. An unrecorded coverage note
             * is itself the risk — silence reads as "complete" to every reader
             * who does not know better.
             */}
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-xs leading-relaxed ring-1",
                context.coverageNote
                  ? "bg-amber-500/8 text-amber-200/90 ring-amber-500/25"
                  : "bg-rose-500/8 text-rose-200/90 ring-rose-500/25",
              )}
            >
              <span className="font-semibold uppercase tracking-wide">Coverage — </span>
              {context.coverageNote ??
                "Not recorded. Treat this transcript's completeness as UNKNOWN: it may stop at a compaction boundary or omit earlier discussion."}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No transcript was attached to this proposal, so the reasoning behind it is only what the
            PRD captures.
          </p>
        )}
      </Panel>

      {tasks.length > 0 ? (
        <Panel
          title="Plan tasks"
          subtitle={
            props.planSlug
              ? `Live status from plan_tasks — tracked at /admin/plans/${props.planSlug}`
              : "Live status from plan_tasks"
          }
          action={<LiveIndicator connected={connected} />}
        >
          <div className="mb-4 flex items-center gap-3">
            <ProgressBar percent={overall.percent} tone="success" className="max-w-md" />
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {overall.done}/{overall.total} tasks done · {overall.percent}%
            </span>
          </div>
          <div className="space-y-3">
            {grouped.map(({ phase, tasks: phaseTasks }) => (
              <PhaseGroup key={phase} phase={phase} tasks={phaseTasks} />
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
