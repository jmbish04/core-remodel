/**
 * @fileoverview ClickUp Gantt Chart
 *
 * SVG-based Gantt chart using frappe-gantt. Task bars are color-coded:
 * - Critical path tasks: red
 * - Normal tasks: blue
 * - Completed tasks: emerald
 * - Overdue tasks: amber outline
 *
 * Supports drag-to-resize for date changes and click to open detail modal.
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { ClickUpTask, ClickUpTaskFlag } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GanttBarTask {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  dependencies: string;
  custom_class?: string;
}

interface ClickUpGanttProps {
  tasks: ClickUpTask[];
  flags: ClickUpTaskFlag[];
  onDateChange: (
    taskId: string,
    startDate: number,
    endDate: number,
  ) => Promise<void>;
  onTaskClick: (task: ClickUpTask) => void;
  viewMode?: "Day" | "Week" | "Month";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msToDateString(ms: string | null): string {
  if (!ms) return new Date().toISOString().slice(0, 10);
  return new Date(Number(ms)).toISOString().slice(0, 10);
}

function taskToGanttBar(
  task: ClickUpTask,
  criticalPathIds: Set<string>,
): GanttBarTask {
  const isComplete = task.status?.status === "complete";
  const isCriticalPath = criticalPathIds.has(task.id);
  const isOverdue =
    task.due_date &&
    new Date(Number(task.due_date)) < new Date() &&
    !isComplete;

  let customClass = "bar-normal";
  if (isComplete) customClass = "bar-complete";
  else if (isCriticalPath) customClass = "bar-critical";
  else if (isOverdue) customClass = "bar-overdue";

  const deps = task.dependencies
    ?.filter((d) => d.depends_on)
    .map((d) => d.depends_on)
    .join(", ");

  return {
    id: task.id,
    name: task.name,
    start: msToDateString(task.start_date),
    end: msToDateString(task.due_date),
    progress: isComplete ? 100 : 0,
    dependencies: deps || "",
    custom_class: customClass,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClickUpGantt({
  tasks,
  flags,
  onDateChange,
  onTaskClick,
  viewMode = "Week",
}: ClickUpGanttProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);

  // Collect critical path task IDs from flags
  const criticalPathIds = new Set(
    flags
      .filter((f) => f.flagType === "CRITICAL_PATH" && !f.resolved)
      .map((f) => f.clickupTaskId),
  );

  // Filter tasks with valid dates for the Gantt view
  const ganttTasks = tasks
    .filter((t) => t.start_date || t.due_date)
    .map((t) => taskToGanttBar(t, criticalPathIds));

  useEffect(() => {
    if (!containerRef.current || ganttTasks.length === 0) return;

    let cancelled = false;

    (async () => {
      // Dynamic import — frappe-gantt is a browser-only library
      const FrappeGantt = (await import("frappe-gantt")).default;

      if (cancelled || !containerRef.current) return;

      // Clear previous instance
      containerRef.current.innerHTML = "";

      const gantt = new FrappeGantt(
        containerRef.current,
        ganttTasks as any,
        {
          view_mode: viewMode,
          date_format: "YYYY-MM-DD",
          bar_height: 28,
          bar_corner_radius: 4,
          padding: 14,
          popup_trigger: "click",
          on_click: (frappeTask: any) => {
            const task = tasks.find((t) => t.id === frappeTask.id);
            if (task) onTaskClick(task);
          },
          on_date_change: async (frappeTask: any, start: Date, end: Date) => {
            await onDateChange(
              frappeTask.id,
              start.getTime(),
              end.getTime(),
            );
          },
        },
      );

      ganttRef.current = gantt;
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [tasks.length, viewMode]);

  if (ganttTasks.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-zinc-800 p-16 text-sm text-zinc-600">
        No tasks with dates to display. Add start and due dates to tasks to see
        them here.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950">
      {/* Custom CSS for bar colors */}
      <style>{`
        .bar-critical .bar-progress { fill: #ef4444 !important; }
        .bar-critical .bar { fill: #7f1d1d !important; stroke: #ef4444 !important; }
        .bar-normal .bar-progress { fill: #3b82f6 !important; }
        .bar-normal .bar { fill: #1e3a5f !important; stroke: #3b82f6 !important; }
        .bar-complete .bar-progress { fill: #10b981 !important; }
        .bar-complete .bar { fill: #064e3b !important; stroke: #10b981 !important; }
        .bar-overdue .bar-progress { fill: #f59e0b !important; }
        .bar-overdue .bar { fill: #78350f !important; stroke: #f59e0b !important; }
        .gantt .grid-row { fill: transparent !important; }
        .gantt .grid-row:nth-child(even) { fill: rgba(39, 39, 42, 0.3) !important; }
        .gantt .row-line { stroke: #27272a !important; }
        .gantt .tick { stroke: #27272a !important; }
        .gantt .today-highlight { fill: rgba(59, 130, 246, 0.1) !important; }
        .gantt .bar-label { fill: #e4e4e7 !important; font-size: 12px !important; }
        .gantt .lower-text, .gantt .upper-text { fill: #71717a !important; }
        .gantt .arrow { stroke: #52525b !important; }
      `}</style>
      <div ref={containerRef} className={cn("min-h-[300px]", !loaded && "animate-pulse")} />
    </div>
  );
}
