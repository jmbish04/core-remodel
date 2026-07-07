/**
 * @fileoverview StepTimeline — the ordered research-step timeline in the job
 * viewport.
 *
 * Each row shows a status icon (pending ◦ / running spinner / complete check /
 * failed x / skipped), the step label, a detail line, and elapsed time
 * (completedAt − startedAt). Rows with an artifact expand to reveal the
 * ArtifactViewer; candidate-list steps aren't expanded here — the viewport hosts
 * the dedicated candidates table below the timeline.
 *
 * Steps that appear mid-poll animate in (a subtle fade/slide) — we track the set
 * of step ids we've already seen and only animate the newcomers.
 */

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react";

import type { JobStep, StepStatus } from "./types";
import { formatElapsed } from "./types";
import { ArtifactViewer } from "./ArtifactViewer";

// ─── Status icon ────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-4 animate-spin text-amber-300" />;
    case "complete":
      return <CheckCircle2 className="size-4 text-emerald-400" />;
    case "failed":
      return <XCircle className="size-4 text-rose-400" />;
    case "skipped":
      return <MinusCircle className="size-4 text-muted-foreground/50" />;
    case "pending":
    default:
      return <Circle className="size-4 text-muted-foreground/40" />;
  }
}

// ─── One row ────────────────────────────────────────────────────────────────────

function StepRow({ step, isNew }: { step: JobStep; isNew: boolean }) {
  const hasArtifact =
    step.artifact !== null && step.artifact !== undefined && step.artifact !== "";
  const [open, setOpen] = useState(false);
  const elapsed =
    step.startedAt && step.completedAt
      ? formatElapsed(step.startedAt, step.completedAt)
      : null;

  return (
    <li
      className={`relative pl-8 ${
        isNew ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-500" : ""
      }`}
    >
      {/* Timeline rail + node. */}
      <span className="absolute left-[7px] top-6 bottom-0 w-px bg-border/40 last:hidden" aria-hidden />
      <span className="absolute left-0 top-1">
        <StepIcon status={step.status} />
      </span>

      <div className="rounded-lg bg-card ring-1 ring-border/40">
        <button
          type="button"
          onClick={() => hasArtifact && setOpen((o) => !o)}
          disabled={!hasArtifact}
          className={`flex w-full items-start gap-2 px-3 py-2.5 text-left ${
            hasArtifact ? "cursor-pointer hover:bg-muted/30" : "cursor-default"
          } rounded-lg transition-colors`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-card-foreground">
                {step.label}
              </span>
              {elapsed ? (
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {elapsed}
                </span>
              ) : null}
            </div>
            {step.detail ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {step.detail}
              </p>
            ) : null}
          </div>
          {hasArtifact ? (
            <ChevronDown
              className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          ) : null}
        </button>

        {open && hasArtifact ? (
          <div className="px-3 pb-3">
            <ArtifactViewer artifact={step.artifact} stepKey={step.stepKey} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

// ─── Timeline ───────────────────────────────────────────────────────────────────

export function StepTimeline({ steps }: { steps: JobStep[] }) {
  // Track which step ids we've already rendered so only genuinely-new steps
  // (appearing mid-poll) get the entrance animation — never the whole list on
  // first paint.
  const seenRef = useRef<Set<number>>(new Set());
  const [firstPaintDone, setFirstPaintDone] = useState(false);

  useEffect(() => {
    // After the first render, seed the seen-set so the initial batch is treated
    // as "already there".
    if (!firstPaintDone) {
      seenRef.current = new Set(steps.map((s) => s.id));
      setFirstPaintDone(true);
    }
  }, [firstPaintDone, steps]);

  const ordered = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);

  if (ordered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No steps yet — the plan is still being drawn up.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {ordered.map((step) => {
        const isNew = firstPaintDone && !seenRef.current.has(step.id);
        if (isNew) seenRef.current.add(step.id);
        return <StepRow key={step.id} step={step} isNew={isNew} />;
      })}
    </ol>
  );
}
