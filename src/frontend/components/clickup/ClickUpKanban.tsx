/**
 * @fileoverview ClickUp Kanban Board
 *
 * Drag-and-drop Kanban board using @dnd-kit/core (already installed).
 * Columns map to ClickUp statuses: to do → in progress → blocked → complete.
 * Task cards display AI/algorithmic flag badges from the Orchestrator.
 */

import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  AlertTriangle,
  Clock,
  Flag,
  GripVertical,
  Route,
} from "lucide-react";
import React, { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { ClickUpTask, ClickUpTaskFlag } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMNS = [
  { id: "to do", label: "To Do", color: "bg-zinc-800" },
  { id: "in progress", label: "In Progress", color: "bg-blue-950/50" },
  { id: "blocked", label: "Blocked", color: "bg-red-950/50" },
  { id: "complete", label: "Complete", color: "bg-emerald-950/50" },
] as const;

// ---------------------------------------------------------------------------
// Flag badge component
// ---------------------------------------------------------------------------

function FlagBadge({ flag }: { flag: ClickUpTaskFlag }) {
  const config = {
    AI_AUDIT: {
      icon: AlertTriangle,
      variant: "outline" as const,
      className: "border-amber-500/50 text-amber-400 text-[10px]",
    },
    CRITICAL_PATH: {
      icon: Route,
      variant: "outline" as const,
      className: "border-red-500/50 text-red-400 text-[10px]",
    },
    OVERDUE: {
      icon: Clock,
      variant: "outline" as const,
      className: "border-rose-500/50 text-rose-400 text-[10px]",
    },
    DEPENDENCY_BLOCKED: {
      icon: Flag,
      variant: "outline" as const,
      className: "border-orange-500/50 text-orange-400 text-[10px]",
    },
  };

  const cfg = config[flag.flagType as keyof typeof config] || config.AI_AUDIT;
  const Icon = cfg.icon;

  return (
    <Badge variant={cfg.variant} className={cfg.className}>
      <Icon className="mr-1 h-3 w-3" />
      {flag.flagType === "AI_AUDIT" ? "Missing Detail" : flag.flagType.replace("_", " ")}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Task card
// ---------------------------------------------------------------------------

interface TaskCardProps {
  task: ClickUpTask;
  flags: ClickUpTaskFlag[];
  isDragging?: boolean;
  onClick?: () => void;
}

function TaskCard({ task, flags, isDragging, onClick }: TaskCardProps) {
  const priorityColors: Record<string, string> = {
    urgent: "bg-red-500",
    high: "bg-orange-500",
    normal: "bg-blue-500",
    low: "bg-zinc-500",
  };

  const dueDate = task.due_date
    ? new Date(Number(task.due_date)).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;

  const isOverdue =
    task.due_date &&
    new Date(Number(task.due_date)) < new Date() &&
    task.status?.status !== "complete";

  return (
    <div
      className={cn(
        "group cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 transition-all hover:border-zinc-700 hover:bg-zinc-900",
        isDragging && "rotate-2 scale-105 shadow-xl shadow-black/50",
        flags.some((f) => f.severity === "critical") &&
          "border-l-2 border-l-red-500",
      )}
      onClick={onClick}
    >
      {/* Priority dot + Title */}
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight text-zinc-100">
            {task.name}
          </p>
        </div>
        {task.priority && (
          <div
            className={cn(
              "mt-1 h-2 w-2 shrink-0 rounded-full",
              priorityColors[task.priority.priority] || "bg-zinc-500",
            )}
          />
        )}
      </div>

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.map((tag) => (
            <Badge
              key={tag.name}
              variant="secondary"
              className="bg-zinc-800 text-[10px] text-zinc-400"
            >
              {tag.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Flags */}
      {flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {flags.map((flag) => (
            <FlagBadge key={flag.id} flag={flag} />
          ))}
        </div>
      )}

      {/* Footer: due date + assignee */}
      <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
        {dueDate && (
          <span className={cn(isOverdue && "font-medium text-red-400")}>
            {isOverdue ? "⚠ " : ""}
            {dueDate}
          </span>
        )}
        {task.assignees?.[0] && (
          <span className="truncate text-zinc-400">
            {task.assignees[0].username}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kanban column
// ---------------------------------------------------------------------------

interface KanbanColumnProps {
  status: (typeof COLUMNS)[number];
  tasks: ClickUpTask[];
  flagsByTask: Map<string, ClickUpTaskFlag[]>;
  onTaskClick: (task: ClickUpTask) => void;
}

function KanbanColumn({
  status,
  tasks,
  flagsByTask,
  onTaskClick,
}: KanbanColumnProps) {
  return (
    <div className="flex min-w-[280px] flex-1 flex-col">
      <div
        className={cn(
          "mb-3 flex items-center justify-between rounded-lg px-3 py-2",
          status.color,
        )}
      >
        <h3 className="text-sm font-semibold capitalize text-zinc-200">
          {status.label}
        </h3>
        <Badge variant="secondary" className="bg-zinc-800 text-xs">
          {tasks.length}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto pb-4">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            flags={flagsByTask.get(task.id) || []}
            onClick={() => onTaskClick(task)}
          />
        ))}

        {tasks.length === 0 && (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-zinc-800 p-8 text-sm text-zinc-600">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Kanban Board
// ---------------------------------------------------------------------------

interface ClickUpKanbanProps {
  tasks: ClickUpTask[];
  flags: ClickUpTaskFlag[];
  onStatusChange: (taskId: string, newStatus: string) => Promise<void>;
  onTaskClick: (task: ClickUpTask) => void;
}

export function ClickUpKanban({
  tasks,
  flags,
  onStatusChange,
  onTaskClick,
}: ClickUpKanbanProps) {
  const [activeTask, setActiveTask] = useState<ClickUpTask | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Group flags by task ID
  const flagsByTask = new Map<string, ClickUpTaskFlag[]>();
  for (const flag of flags) {
    const existing = flagsByTask.get(flag.clickupTaskId) || [];
    existing.push(flag);
    flagsByTask.set(flag.clickupTaskId, existing);
  }

  // Group tasks by status
  const tasksByStatus = new Map<string, ClickUpTask[]>();
  for (const col of COLUMNS) {
    tasksByStatus.set(col.id, []);
  }
  for (const task of tasks) {
    const status = task.status?.status?.toLowerCase() || "to do";
    const bucket = tasksByStatus.get(status) || tasksByStatus.get("to do")!;
    bucket.push(task);
  }

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const targetStatus = String(over.id);
    const task = tasks.find((t) => t.id === active.id);
    if (!task || task.status?.status === targetStatus) return;

    await onStatusChange(task.id, targetStatus);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto p-1">
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            status={col}
            tasks={tasksByStatus.get(col.id) || []}
            flagsByTask={flagsByTask}
            onTaskClick={onTaskClick}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask && (
          <TaskCard
            task={activeTask}
            flags={flagsByTask.get(activeTask.id) || []}
            isDragging
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
