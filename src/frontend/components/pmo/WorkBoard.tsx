"use client";

/**
 * @fileoverview WorkBoard — a source-blind kanban over WorkItem[] (0028 P1).
 *
 * Column kanban with card drag between columns, built on @dnd-kit/core (the same
 * engine ClickUpKanban uses — this is the generalized, WorkItem-typed version, a
 * clean rewrite rather than a surgical lift of the ClickUp-coupled original).
 *
 * The column SET is configurable, because the two projects differ (DESIGN_SPEC
 * §3.1): software columns aren't remodel columns. A card's column is its
 * `WorkStatus`, so dropping a card into a column is a status change — surfaced
 * to the host via `onStatusChange`, which does the optimistic write.
 *
 * Keyboard drag is first-class: dnd-kit's KeyboardSensor plus the announcements
 * below give a screen-reader user the same reordering the mouse gets.
 */
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { useMemo, useState } from "react";

import type { WorkItem, WorkStatus } from "@/shared/pmo/types";
import { cn } from "@/lib/utils";
import { STATUS_DOT } from "./tone";
import { WorkItemCard } from "./WorkItemCard";

export interface BoardColumn {
  status: WorkStatus;
  label: string;
  /** One-line column subtitle. */
  description?: string;
}

/** Software delivery columns. */
export const SOFTWARE_COLUMNS: BoardColumn[] = [
  { status: "backlog", label: "Backlog", description: "Not yet scoped" },
  { status: "todo", label: "Planned", description: "Queued for work" },
  { status: "in_progress", label: "In Progress", description: "Being built" },
  { status: "in_review", label: "In Review", description: "Awaiting review" },
  { status: "blocked", label: "Blocked", description: "Waiting on something" },
  { status: "done", label: "Done", description: "Shipped" },
];

/** Remodel delivery columns — same statuses, renovation vocabulary. */
export const REMODEL_COLUMNS: BoardColumn[] = [
  { status: "todo", label: "Not Started", description: "Scheduled work" },
  { status: "in_progress", label: "In Progress", description: "On site now" },
  { status: "in_review", label: "Awaiting Sign-off", description: "Pending approval" },
  { status: "blocked", label: "Blocked", description: "Waiting on materials or a trade" },
  { status: "deferred", label: "Deferred", description: "Pushed out" },
  { status: "done", label: "Complete", description: "Done and accepted" },
];

function DraggableCard({ item, onClick }: { item: WorkItem; onClick?: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("touch-none outline-none", isDragging && "opacity-40")}
    >
      <WorkItemCard item={item} onClick={onClick} />
    </div>
  );
}

function Column({
  column,
  items,
  onCardClick,
}: {
  column: BoardColumn;
  items: WorkItem[];
  onCardClick?: (item: WorkItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  return (
    <div className="flex w-[18.5rem] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={cn("size-2.5 rounded-full", STATUS_DOT[column.status])} aria-hidden />
        <h3 className="text-sm font-semibold">{column.label}</h3>
        <span className="rounded-md border border-border/50 px-1.5 text-[10px] text-muted-foreground tabular-nums">
          {items.length}
        </span>
        {column.description ? (
          <span className="ml-auto truncate text-[11px] text-muted-foreground">{column.description}</span>
        ) : null}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-xl bg-muted/40 p-2 ring-1 ring-transparent transition-colors",
          isOver && "ring-sky-500/40",
        )}
      >
        {items.map((item) => (
          <DraggableCard key={item.id} item={item} onClick={onCardClick ? () => onCardClick(item) : undefined} />
        ))}
        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/40 p-6 text-xs text-muted-foreground/60">
            Nothing here
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function WorkBoard({
  items,
  columns = SOFTWARE_COLUMNS,
  onStatusChange,
  onCardClick,
  className,
}: {
  items: WorkItem[];
  columns?: BoardColumn[];
  /** Called when a card is dropped into a different column. Host does the write. */
  onStatusChange?: (item: WorkItem, status: WorkStatus) => void;
  onCardClick?: (item: WorkItem) => void;
  className?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const byStatus = useMemo(() => {
    const map = new Map<WorkStatus, WorkItem[]>();
    for (const col of columns) map.set(col.status, []);
    for (const item of items) {
      // An item whose status has no column (e.g. a `deferred` item on the
      // software board, which omits it) falls into the first column rather than
      // vanishing — silently dropping it would hide work.
      const bucket = map.get(item.status) ?? map.get(columns[0].status);
      bucket?.push(item);
    }
    return map;
  }, [items, columns]);

  const active = activeId ? items.find((i) => i.id === activeId) ?? null : null;

  function handleStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function handleEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active: a, over } = e;
    if (!over) return;
    const item = items.find((i) => i.id === a.id);
    const target = over.id as WorkStatus;
    if (item && item.status !== target) onStatusChange?.(item, target);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active: a }) => `Picked up ${a.id}`,
          onDragOver: ({ over }) => (over ? `Over ${over.id}` : "No column"),
          onDragEnd: ({ over }) => (over ? `Moved to ${over.id}` : "Cancelled"),
          onDragCancel: () => "Cancelled",
        },
      }}
    >
      <div className={cn("flex gap-3 overflow-x-auto pb-2", className)}>
        {columns.map((col) => (
          <Column
            key={col.status}
            column={col}
            items={byStatus.get(col.status) ?? []}
            onCardClick={onCardClick}
          />
        ))}
      </div>
      <DragOverlay>{active ? <WorkItemCard item={active} className="w-[17rem] rotate-2" /> : null}</DragOverlay>
    </DndContext>
  );
}
