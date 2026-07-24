/**
 * @fileoverview The 0028 PMO tone system — the one place status / health /
 * priority map to color and label.
 *
 * Two encodings, deliberately different loudness (DESIGN_SPEC §1):
 *   - STATUS reads as a neutral outline badge with a colored DOT — quiet.
 *   - PRIORITY reads as a filled tonal badge — loud.
 *   - HEALTH is its own axis, a tonal badge, never merged with status.
 *
 * Class strings are written out in full, never interpolated, because Tailwind's
 * JIT only sees literal class names — `bg-${tone}-500` would compile to nothing.
 */
import type { WorkHealth, WorkPriority, WorkStatus } from "@/shared/pmo/types";

/** A colored dot, for the quiet status badge. */
export const STATUS_DOT: Record<WorkStatus, string> = {
  backlog: "bg-muted-foreground/50",
  todo: "bg-sky-400",
  in_progress: "bg-sky-400",
  in_review: "bg-amber-400",
  blocked: "bg-rose-400",
  deferred: "bg-muted-foreground/50",
  done: "bg-emerald-400",
};

export const STATUS_LABEL: Record<WorkStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  blocked: "Blocked",
  deferred: "Deferred",
  done: "Done",
};

/** Filled tonal badge classes for priority — the loud encoding. */
export const PRIORITY_TONE: Record<WorkPriority, string> = {
  urgent: "border-rose-500/25 bg-rose-500/15 text-rose-300",
  high: "border-amber-500/25 bg-amber-500/15 text-amber-300",
  medium: "border-sky-500/25 bg-sky-500/15 text-sky-300",
  low: "border-muted-foreground/20 bg-muted/40 text-muted-foreground",
};

export const PRIORITY_LABEL: Record<WorkPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Filled tonal badge classes for health. */
export const HEALTH_TONE: Record<WorkHealth, string> = {
  on_track: "border-emerald-500/25 bg-emerald-500/12 text-emerald-300",
  at_risk: "border-amber-500/25 bg-amber-500/12 text-amber-300",
  blocked: "border-rose-500/25 bg-rose-500/12 text-rose-300",
  unknown: "border-muted-foreground/20 bg-muted/40 text-muted-foreground",
};

export const HEALTH_LABEL: Record<WorkHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  blocked: "Blocked",
  unknown: "Unknown",
};

/**
 * A stable Tailwind-500 hue per item, for the Gantt (DESIGN_SPEC §2). Status
 * colors turn a dense timeline into a wall of one color; a per-item hue keeps
 * bars distinguishable. Hashed off the id so the same item is always the same
 * color across renders.
 */
const GANTT_HUES = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#10b981", // emerald
  "#f43f5e", // rose
  "#ec4899", // pink
  "#f97316", // orange
  "#6366f1", // indigo
] as const;

export function ganttHue(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GANTT_HUES[h % GANTT_HUES.length];
}

/** Progress-ring color is THRESHOLD-derived, not status-derived (DESIGN_SPEC §2). */
export function progressColor(pct: number): string {
  if (pct < 40) return "text-rose-400";
  if (pct < 75) return "text-amber-400";
  return "text-emerald-400";
}
