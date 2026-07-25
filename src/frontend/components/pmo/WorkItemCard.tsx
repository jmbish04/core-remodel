"use client";

/**
 * @fileoverview The kanban card body — 0028 P1.
 *
 * Card anatomy from the roadmap_kanban prototype (DESIGN_SPEC §3.1), minus the
 * vote/ARR chrome: title + group badge, clamped description, a meta line, and a
 * footer with the progress bar and the assignee group. Pure presentation —
 * dragging is the board's job, so this takes no dnd props.
 */
import type { WorkItem } from "@/shared/pmo/types";
import { cn } from "@/lib/utils";
import { AssigneeGroup, HealthBadge, PriorityBadge, ProgressBar, StatusBadge } from "./atoms";

export function WorkItemCard({
  item,
  onClick,
  className,
}: {
  item: WorkItem;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[9rem] flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-border/40",
        "transition-shadow hover:ring-foreground/20 hover:shadow-sm",
        onClick && "cursor-pointer",
        className,
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</span>
        <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {item.groupLabel}
        </span>
      </div>

      {item.description ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground/70">{item.key}</span>
        {item.priority ? <PriorityBadge priority={item.priority} /> : null}
        {/* Health only when it says something — `on_track`/`unknown` are noise here. */}
        {item.health === "at_risk" || item.health === "blocked" ? (
          <HealthBadge health={item.health} />
        ) : null}
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <ProgressBar pct={item.progressPct} />
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={item.status} />
          <AssigneeGroup people={item.people} />
        </div>
      </div>
    </div>
  );
}
