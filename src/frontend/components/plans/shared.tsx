import React from "react";

import { cn } from "@/lib/utils";

/**
 * Shape returned by every task on a plan board. Mirrors the live
 * `GET /api/admin/plans/:slug` contract (see the admin plans route).
 */
export type TaskStatus = "pending" | "in_progress" | "blocked" | "deferred" | "done";
export type ChangeType =
  | "new"
  | "move"
  | "update"
  | "delete"
  | "keep"
  | "investigate"
  | "recover";
export type PlanStatus = "planning" | "active" | "done" | "archived";

export interface ProgressCounts {
  pending: number;
  in_progress: number;
  blocked: number;
  deferred: number;
  done: number;
}

export interface Progress {
  total: number;
  percent: number;
  counts: ProgressCounts;
}

export interface PlanSummary {
  slug: string;
  title: string;
  description: string;
  docPath: string;
  status: PlanStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  progress: Progress;
}

export interface Task {
  id: number;
  planSlug: string;
  taskKey: string;
  workstream: string;
  phase: number;
  title: string;
  description: string | null;
  targetRoute: string | null;
  changeType: ChangeType;
  status: TaskStatus;
  dependsOn: string[] | null;
  sortOrder: number;
  notes: string | null;
}

export interface PlanDetail {
  success: boolean;
  plan: PlanSummary;
  progress: Progress;
  tasks: Task[];
  phases: Array<{ phase: number; progress: Progress }>;
  workstreams: Array<{ workstream: string; progress: Progress }>;
}

/**
 * Thin GET helper: forwards the auth cookie, throws a readable error on a
 * non-2xx / `success:false` response so callers can route it through a toast.
 */
export async function api<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json().catch(() => ({}))) as T & {
    success?: boolean;
    error?: string;
  };
  if (!response.ok || payload.success === false) {
    const message = payload.error || `Request failed (${response.status})`;
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return payload as T;
}

/**
 * Thin PATCH helper for task mutations. Same error discipline as {@link api}.
 */
export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    success?: boolean;
    error?: string;
  };
  if (!response.ok || payload.success === false) {
    const message = payload.error || `Request failed (${response.status})`;
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return payload as T;
}

/** A ring-based progress bar (no 1px borders; Monolith rules). */
export function ProgressBar({
  percent,
  className,
  tone = "default",
}: {
  percent: number;
  className?: string;
  tone?: "default" | "success";
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-muted/40 ring-1 ring-border/40",
        className,
      )}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all duration-500",
          tone === "success" || clamped >= 100 ? "bg-emerald-500" : "bg-primary",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

const STATUS_META: Record<TaskStatus, { label: string; className: string; dot: string }> = {
  pending: {
    label: "Pending",
    className: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",
    dot: "bg-zinc-400",
  },
  in_progress: {
    label: "In Progress",
    className: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
    dot: "bg-sky-400",
  },
  blocked: {
    label: "Blocked",
    className: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
    dot: "bg-rose-400",
  },
  deferred: {
    label: "Deferred",
    className: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
    dot: "bg-amber-400",
  },
  done: {
    label: "Done",
    className: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
    dot: "bg-emerald-400",
  },
};

export const TASK_STATUSES: TaskStatus[] = [
  "pending",
  "in_progress",
  "blocked",
  "deferred",
  "done",
];

export function statusLabel(status: TaskStatus): string {
  return STATUS_META[status]?.label ?? status;
}

export function statusDotClass(status: TaskStatus): string {
  return STATUS_META[status]?.dot ?? "bg-zinc-400";
}

/** Small pill for a task status. */
export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
        meta.className,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

const CHANGE_TYPE_META: Record<ChangeType, { label: string; className: string }> = {
  new: { label: "new", className: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" },
  move: { label: "move", className: "bg-sky-500/10 text-sky-300 ring-sky-500/30" },
  update: { label: "update", className: "bg-amber-500/10 text-amber-300 ring-amber-500/30" },
  delete: { label: "delete", className: "bg-rose-500/10 text-rose-300 ring-rose-500/30" },
  keep: { label: "keep", className: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30" },
  investigate: {
    label: "investigate",
    className: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
  },
  recover: { label: "recover", className: "bg-orange-500/10 text-orange-300 ring-orange-500/30" },
};

/** Color-coded pill for a task's change type. */
export function ChangeTypeBadge({
  changeType,
  className,
}: {
  changeType: ChangeType;
  className?: string;
}) {
  const meta = CHANGE_TYPE_META[changeType] ?? CHANGE_TYPE_META.keep;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1",
        meta.className,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

const PLAN_STATUS_META: Record<PlanStatus, { label: string; className: string }> = {
  planning: { label: "Planning", className: "bg-violet-500/10 text-violet-300 ring-violet-500/30" },
  active: { label: "Active", className: "bg-sky-500/10 text-sky-300 ring-sky-500/30" },
  done: { label: "Done", className: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" },
  archived: { label: "Archived", className: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/30" },
};

/** Pill for a whole plan's lifecycle status. */
export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  const meta = PLAN_STATUS_META[status] ?? PLAN_STATUS_META.planning;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1",
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

/** Tiny count chip used in the overview cards + board header. */
export function CountChip({
  label,
  count,
  dotClass,
}: {
  label: string;
  count: number;
  dotClass: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/30">
      <span className={cn("size-1.5 rounded-full", dotClass)} />
      <span className="tabular-nums text-foreground">{count}</span>
      {label}
    </span>
  );
}
