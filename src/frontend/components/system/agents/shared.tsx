/**
 * @fileoverview Shared presentation kit for the Agent Ops pages.
 *
 * Every status word, colour and badge shape used by the queue, the run detail,
 * the failure sheet and the cost dashboard lives here. Four pages rendering the
 * same six lifecycle values from four copies of a switch statement is how
 * "failed" ends up red on one page and grey on another, and how a new status
 * silently renders as blank on three of them.
 */
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types mirrored from the API ──────────────────────────────────────────────

export type RunStatus =
  | "queued"
  | "running"
  | "needs_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SurfaceKind = "workflow" | "durable-object" | "cron" | "mcp" | "user";

export interface RunSummary {
  id: number;
  agent: string;
  agentLabel: string;
  operation: string;
  surface: SurfaceKind;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  status: RunStatus;
  attempt: number;
  parentRunId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  triggeredBy: string | null;
  durationMs: number | null;
  createdAt: string | null;
  stepsTotal: number;
  stepsDone: number;
  percent: number | null;
}

// ── Status vocabulary ────────────────────────────────────────────────────────

/**
 * Display order for the queue's groups.
 *
 * Deliberately NOT alphabetical and NOT lifecycle order: this is triage order.
 * Things needing a human come first, then things that are stuck, then things
 * that are fine. `succeeded` is last because a healthy run is the least
 * interesting row on the page.
 */
export const STATUS_GROUP_ORDER: RunStatus[] = [
  "failed",
  "needs_approval",
  "running",
  "queued",
  "cancelled",
  "succeeded",
];

export const STATUS_META: Record<
  RunStatus,
  { label: string; dot: string; group: string; blurb: string }
> = {
  running: {
    label: "Running",
    dot: "bg-sky-500",
    group: "Running",
    blurb: "Live executions streaming steps right now",
  },
  queued: {
    label: "Queued",
    dot: "bg-muted-foreground/70",
    group: "Waiting",
    blurb: "Queued behind approvals, rate limits, or schedules",
  },
  needs_approval: {
    label: "Needs approval",
    dot: "bg-warning",
    group: "Needs approval",
    blurb: "Paused for a human decision before continuing",
  },
  failed: {
    label: "Failed",
    dot: "bg-destructive",
    group: "Failed",
    blurb: "Stopped runs awaiting retry or escalation",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-muted-foreground/50",
    group: "Cancelled",
    blurb: "Stopped by a human before finishing",
  },
  succeeded: {
    label: "Succeeded",
    dot: "bg-success",
    group: "Completed",
    blurb: "Finished without error",
  },
};

export const SURFACE_META: Record<SurfaceKind, { label: string; dot: string }> = {
  workflow: { label: "Workflow", dot: "bg-primary" },
  "durable-object": { label: "Durable Object", dot: "bg-violet-500" },
  cron: { label: "Cron", dot: "bg-amber-500" },
  mcp: { label: "MCP", dot: "bg-info" },
  user: { label: "User", dot: "bg-muted-foreground" },
};

// ── Badges ───────────────────────────────────────────────────────────────────

const STATUS_BADGE_CLASS: Record<RunStatus, string> = {
  running: "border-info/25 bg-info/10 text-info",
  queued: "border-border bg-transparent",
  needs_approval: "border-warning/25 bg-warning/10 text-warning",
  failed: "border-destructive/25 bg-destructive/10 text-destructive",
  cancelled: "border-border bg-transparent text-muted-foreground",
  succeeded: "border-success/25 bg-success/10 text-success",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const meta = STATUS_META[status];
  // An unknown status must render its raw value rather than vanish — a blank
  // badge would hide exactly the kind of drift this file exists to prevent.
  if (!meta) return <Badge variant="outline">{status}</Badge>;
  return (
    <Badge variant="outline" className={cn("gap-1.5", STATUS_BADGE_CLASS[status])}>
      <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </Badge>
  );
}

/**
 * Which kind of thing produced this run.
 *
 * This replaces the reference template's Production / Staging / Development
 * badge, which is meaningless here: there is exactly one environment. What
 * actually varies — and changes how a failure should be read — is whether the
 * work came from a Workflow, a Durable Object, a cron tick or MCP.
 */
export function SurfaceBadge({ surface }: { surface: SurfaceKind }) {
  const meta = SURFACE_META[surface] ?? SURFACE_META.user;
  return (
    <Badge variant="outline" className="gap-1.5 bg-background">
      <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </Badge>
  );
}

/**
 * Who this run is, in place of the template's owner avatar.
 *
 * There are no per-run human owners in this system; pretending otherwise would
 * be decoration. The identity that matters is the agent and the operation.
 */
export function AgentIdentity({ run }: { run: Pick<RunSummary, "agentLabel" | "operation"> }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-foreground truncate text-sm font-medium">{run.agentLabel}</span>
      <span className="text-muted-foreground truncate font-mono text-xs">{run.operation}</span>
    </div>
  );
}

export function ErrorCodeChip({ code }: { code: string | null }) {
  if (!code) return <span className="text-muted-foreground text-sm">—</span>;
  return (
    <Badge
      variant="outline"
      className="border-destructive/25 bg-destructive/10 text-destructive max-w-full truncate font-mono"
      title={code}
    >
      {code}
    </Badge>
  );
}

/**
 * Attempt indicator. Renders nothing for a first attempt — a badge reading
 * "attempt 1" on every row is noise that trains the eye to ignore the column,
 * which defeats the point of showing attempt 3.
 */
export function AttemptBadge({ attempt }: { attempt: number }) {
  if (attempt <= 1) return null;
  return (
    <Badge variant="outline" className="border-info/25 bg-info/10 text-info gap-1">
      attempt {attempt}
    </Badge>
  );
}

// ── Progress ring ────────────────────────────────────────────────────────────

const RING_R = 9;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Steps-done / steps-total as a ring.
 *
 * `percent === null` means the run declared no steps, which is NOT 0% — it is
 * "unknown". Rendering unknown as an empty ring would make every
 * not-yet-step-instrumented agent look permanently stalled.
 */
export function StepProgressRing({
  percent,
  done,
  total,
}: {
  percent: number | null;
  done: number;
  total: number;
}) {
  if (percent === null) {
    return (
      <span className="text-muted-foreground text-sm tabular-nums" title="No steps declared">
        —
      </span>
    );
  }
  const color =
    percent >= 100 ? "text-emerald-500" : percent >= 50 ? "text-amber-500" : "text-rose-500";
  return (
    <div
      className="flex items-center justify-end gap-2"
      aria-label={`${done} of ${total} steps complete`}
    >
      <svg viewBox="0 0 24 24" className={cn("size-5 shrink-0", color)} aria-hidden>
        <circle cx="12" cy="12" r={RING_R} fill="none" className="stroke-border" strokeWidth="2.5" />
        <circle
          cx="12"
          cy="12"
          r={RING_R}
          fill="none"
          className="stroke-current"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C - (RING_C * percent) / 100}
          transform="rotate(-90 12 12)"
        />
      </svg>
      <span className="text-foreground text-sm tabular-nums">{percent}%</span>
    </div>
  );
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

/** USD with enough precision that sub-cent agent spend is not rendered as $0.00. */
export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1000) return `$${n.toFixed(2)}`;
  return `$${(n / 1000).toFixed(1)}K`;
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// ── Fetch helper ─────────────────────────────────────────────────────────────

/**
 * Admin GET. Throws on a non-2xx so a caller renders a visible error rather
 * than an empty, reassuring page — same reasoning as the query layer's
 * throw-don't-swallow policy on the server.
 */
export async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string })?.error ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function adminPost<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "POST", credentials: "same-origin" });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error || `${res.status} ${res.statusText}`);
  return body as T;
}
