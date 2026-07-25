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
/**
 * Currency, rendered as `$ 100.00` — with a space after the symbol, per the
 * house convention.
 *
 * Small values keep 4 decimals rather than collapsing to `$ 0.00`: per-call AI
 * spend is genuinely sub-cent, and rounding it to zero on a cost page is how a
 * real number becomes an invisible one.
 */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n === 0) return "$ 0.00";
  if (Math.abs(n) < 0.01) {
    return `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  }
  return `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A rate, e.g. `$ 2.50 /1M`. Four decimals — many rates are fractions of a cent. */
export function formatRate(n: number | null | undefined, per = "1M"): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} /${per}`;
}

/**
 * Integers with thousands separators — `1,398`, never `1398`.
 *
 * Exact, not abbreviated: on an operational table "1,398 calls" is a fact and
 * "1.4K calls" is a rounding that hides the last 398.
 */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

/** Abbreviated magnitude, for headline tiles where exactness is not the point. */
export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1000) return formatCount(n);
  return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

/**
 * Uptime as a compact duration: seconds under a minute, then minutes, hours,
 * days. `null` renders as "—" rather than "0s", because "no data" and "just
 * broke" are opposite meanings.
 */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = seconds / 60;
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = mins / 60;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  const days = hours / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)}d`;
}

/** Latency in ms, or "—" when nothing was timed. */
export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// ── Provider health ─────────────────────────────────────────────────────────

export type ProviderHealth = "SUCCESS" | "PARTIAL" | "FAILURE" | "OFFLINE";

const HEALTH_META: Record<ProviderHealth, { label: string; cls: string; hint: string }> = {
  SUCCESS: {
    label: "SUCCESS",
    cls: "border-success/25 bg-success/10 text-success",
    hint: "Every call in the window succeeded",
  },
  PARTIAL: {
    label: "PARTIAL RUN",
    cls: "border-warning/25 bg-warning/10 text-warning",
    hint: "Some calls succeeded and some failed",
  },
  FAILURE: {
    label: "FAILURE",
    cls: "border-destructive/25 bg-destructive/10 text-destructive",
    hint: "Every call in the window failed",
  },
  // Neutral, deliberately. OFFLINE means no traffic, which is not the same as
  // down — an idle provider rendered in red trains people to ignore the colour.
  OFFLINE: {
    label: "OFFLINE",
    cls: "border-border bg-transparent text-muted-foreground",
    hint: "No calls in this window — idle, not necessarily down",
  },
};

export function ProviderHealthBadge({ health }: { health: ProviderHealth }) {
  const meta = HEALTH_META[health] ?? HEALTH_META.OFFLINE;
  return (
    <Badge variant="outline" className={cn("font-mono text-[11px]", meta.cls)} title={meta.hint}>
      {meta.label}
    </Badge>
  );
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
