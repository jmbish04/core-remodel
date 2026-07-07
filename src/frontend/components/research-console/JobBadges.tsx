/**
 * @fileoverview Reusable status/kind chips + a dependency-free progress bar for
 * the research console. All three are pure presentational atoms shared by the
 * landing list and the job viewport.
 *
 * Monolith dark conventions: bg-card / ring-1 ring-border/40 surfaces, no 1px
 * borders, status tints via the emerald/amber/rose/sky family with /15 fills +
 * /30 rings.
 */

import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";

import type { JobStatus, ResearchKind } from "./types";
import { KIND_LABEL } from "./types";

// ─── Kind badge ─────────────────────────────────────────────────────────────────

/** A small mono pill naming the job kind (Showroom / Discover brands / …). */
export function KindBadge({ kind }: { kind: ResearchKind }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground ring-1 ring-border/40">
      {KIND_LABEL[kind]}
    </span>
  );
}

// ─── Status chip ────────────────────────────────────────────────────────────────

/**
 * Status chip mirroring the ScrapeBadge visual language:
 *   pending  → sky, dashed circle
 *   running  → amber, spinner
 *   complete → emerald, check
 *   failed   → rose, x
 */
export function StatusChip({ status }: { status: JobStatus }) {
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-medium text-sky-300 ring-1 ring-sky-500/30">
        <CircleDashed className="size-3" />
        Queued
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/30">
        <Loader2 className="size-3 animate-spin" />
        Running
      </span>
    );
  }
  if (status === "complete") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
        <CheckCircle2 className="size-3" />
        Complete
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-medium text-rose-300 ring-1 ring-rose-500/30">
      <XCircle className="size-3" />
      Failed
    </span>
  );
}

// ─── Progress bar ───────────────────────────────────────────────────────────────

/**
 * Dependency-free progress bar — a muted track with an animated primary fill
 * whose width transitions as the polled `value` (0–100) advances. `failed` jobs
 * render the fill in rose so a stalled bar reads as an error, not "almost done".
 */
export function ProgressBar({
  value,
  status,
  className = "",
}: {
  value: number;
  status?: JobStatus;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const fill = status === "failed" ? "bg-rose-500/70" : "bg-primary";
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-muted ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${fill}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
