"use client";

/**
 * @fileoverview Shared PMO atoms — 0028 P1.
 *
 * The small, reused pieces every PMO surface is built from. They encode the
 * design decisions once (DESIGN_SPEC §1): status is quiet (outline + dot),
 * priority and health are loud (filled tonal), numbers are `tabular-nums`,
 * eyebrows are mono/uppercase/wide-tracked.
 */
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { WorkHealth, WorkPerson, WorkPriority, WorkStatus } from "@/shared/pmo/types";
import { cn } from "@/lib/utils";
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  progressColor,
  STATUS_DOT,
  STATUS_LABEL,
} from "./tone";

const BADGE = "inline-flex h-5 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium";

/** Status — the QUIET encoding: neutral outline + a colored dot. */
export function StatusBadge({ status, className }: { status: WorkStatus; className?: string }) {
  return (
    <span
      className={cn(
        BADGE,
        "border border-border/50 bg-transparent text-foreground/80",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Health — LOUD, and always separate from status. */
export function HealthBadge({ health, className }: { health: WorkHealth; className?: string }) {
  // `unknown` health is noise on a card — the caller decides whether to render it.
  return (
    <span className={cn(BADGE, "border", HEALTH_TONE[health], className)}>
      {HEALTH_LABEL[health]}
    </span>
  );
}

/** Priority — LOUD, filled tonal. */
export function PriorityBadge({ priority, className }: { priority: WorkPriority; className?: string }) {
  return (
    <span className={cn(BADGE, "border", PRIORITY_TONE[priority], className)}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

/**
 * A radial progress ring. Color is threshold-derived (rose < 40 < amber < 75 ≤
 * emerald), NOT status-derived. `null` renders a muted dash, which is distinct
 * from 0%.
 */
export function ProgressRing({
  pct,
  size = 20,
  className,
}: {
  pct: number | null;
  size?: number;
  className?: string;
}) {
  if (pct == null) {
    return <span className={cn("text-xs text-muted-foreground/60", className)}>–</span>;
  }
  const clamped = Math.max(0, Math.min(100, pct));
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  return (
    <span className={cn("inline-flex items-center gap-1.5", progressColor(clamped), className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="opacity-15" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="text-xs tabular-nums text-foreground/70">{clamped}%</span>
    </span>
  );
}

/** A linear progress bar. Same threshold coloring as the ring. */
export function ProgressBar({ pct, className }: { pct: number | null; className?: string }) {
  const clamped = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const bar =
    pct == null
      ? "bg-muted-foreground/20"
      : clamped < 40
        ? "bg-rose-500/70"
        : clamped < 75
          ? "bg-amber-500/70"
          : "bg-emerald-500/70";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-[width]", bar)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const ROLE_LABEL: Record<WorkPerson["role"], string> = {
  owner: "Owner",
  assignee: "Assignee",
  cc: "CC",
  approver: "Approver",
};

/**
 * An overlapping avatar stack with a `+N` overflow and a tooltip listing full
 * names + roles. `–` with an sr-only "Unassigned" when there is nobody, so the
 * empty state is a real, announced state and not a blank gap.
 */
export function AssigneeGroup({
  people,
  max = 3,
  className,
}: {
  people: WorkPerson[];
  max?: number;
  className?: string;
}) {
  if (people.length === 0) {
    return (
      <span className={cn("text-xs text-muted-foreground/60", className)} aria-label="Unassigned">
        <span aria-hidden>–</span>
      </span>
    );
  }
  const shown = people.slice(0, max);
  const hidden = people.length - shown.length;
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={<span className={cn("inline-flex items-center -space-x-1.5", className)} />}
        >
          {shown.map((p) => (
            <Avatar key={`${p.participantId}-${p.role}`} className="size-5 ring-2 ring-background">
              <AvatarFallback className="bg-muted text-[9px] font-medium">
                {initials(p.displayName)}
              </AvatarFallback>
            </Avatar>
          ))}
          {hidden > 0 ? (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground ring-2 ring-background">
              +{hidden}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          <ul className="space-y-0.5">
            {people.map((p) => (
              <li key={`${p.participantId}-${p.role}`}>
                {p.displayName} · <span className="text-muted-foreground">{ROLE_LABEL[p.role]}</span>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** The dependency chips — an item's `dependsOn` keys, rendered compactly. */
export function DependencyChips({ dependsOn, className }: { dependsOn: string[]; className?: string }) {
  if (dependsOn.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {dependsOn.map((key) => (
        <span
          key={key}
          className="inline-flex h-4 items-center rounded bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground"
        >
          {key}
        </span>
      ))}
    </span>
  );
}

/** The mono/uppercase/wide-tracked panel eyebrow — the velocity page's signature. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground", className)}>
      {children}
    </p>
  );
}

/** A KPI tile: eyebrow label, big tabular value, optional trailing slot. */
export function KpiTile({
  label,
  value,
  trailing,
  className,
}: {
  label: string;
  value: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-card p-4 ring-1 ring-border/40", className)}>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</span>
        {trailing}
      </div>
    </div>
  );
}
