/**
 * @fileoverview Company Todos tab (0013 roadmap P3-04).
 *
 * Status-filterable todo list with inline status PATCH, due-date/owner/tags
 * metadata, and a PlateJS rich-text dialog for create / edit. Overdue todos
 * (past due + not done) flag amber. Content round-trips as Slate-JSON.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ListTodo,
  Loader2,
  Pencil,
  Plus,
  Tag,
  Trash2,
  User,
} from "lucide-react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { BasicBlocksPlugin, BasicMarksPlugin } from "@platejs/basic-nodes/react";
import type { Descendant } from "slate";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  apiGet,
  apiSend,
  dateInputToEpoch,
  epochToDateInput,
  formatDate,
  isOverdue,
  jsonToSlate,
  slateToJson,
  TODO_STATUS_META,
  TODO_STATUSES,
  type Todo,
  type TodoResponse,
  type TodosListResponse,
  type TodoStatus,
  type TodoWritePayload,
} from "./shared";

// ---------------------------------------------------------------------------
// Status filter
// ---------------------------------------------------------------------------

type StatusFilter = "all" | TodoStatus;

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

const FILTER_ORDER: StatusFilter[] = ["all", "open", "in_progress", "blocked", "done"];

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

function StatusPill({ status }: { status: TodoStatus }) {
  const meta = TODO_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
        meta.className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Editor dialog
// ---------------------------------------------------------------------------

interface TodoEditorDialogProps {
  companyId: number;
  todo: Todo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (todo: Todo, mode: "create" | "edit") => void;
}

function TodoEditorDialog({ companyId, todo, open, onOpenChange, onSaved }: TodoEditorDialogProps) {
  const mode: "create" | "edit" = todo ? "edit" : "create";
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<TodoStatus>("open");
  const [dueDate, setDueDate] = useState("");
  const [owner, setOwner] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [value, setValue] = useState<Descendant[]>(jsonToSlate(null));
  const [saving, setSaving] = useState(false);

  // Re-create the editor per todo (+ open toggle) so stale content never leaks.
  const editorKey = todo?.id ?? "create";
  const editor = usePlateEditor(
    {
      plugins: [BasicBlocksPlugin, BasicMarksPlugin],
      value: jsonToSlate(todo?.content ?? null) as any,
    },
    [editorKey, open],
  );

  useEffect(() => {
    if (!open) return;
    setTitle(todo?.title ?? "");
    setStatus(todo?.status ?? "open");
    setDueDate(epochToDateInput(todo?.dueDate ?? null));
    setOwner(todo?.owner ?? "");
    setTagsInput((todo?.tags ?? []).join(", "));
    setValue(jsonToSlate(todo?.content ?? null));
  }, [open, todo]);

  const handleSave = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Todo title is required");
      return;
    }
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const payload: TodoWritePayload = {
        title: trimmed,
        status,
        dueDate: dateInputToEpoch(dueDate),
        owner: owner.trim() ? owner.trim() : null,
        tags,
        content: slateToJson(value),
      };
      let saved: Todo;
      if (mode === "create") {
        const res = await apiSend<TodoResponse>(
          `/api/companies/${companyId}/todos`,
          "POST",
          payload,
        );
        saved = res.todo;
      } else {
        const res = await apiSend<TodoResponse>(
          `/api/companies/${companyId}/todos/${todo!.id}`,
          "PATCH",
          payload,
        );
        saved = res.todo;
      }
      toast.success(mode === "create" ? "Todo created" : "Todo updated");
      onSaved(saved, mode);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save todo");
    } finally {
      setSaving(false);
    }
  }, [title, status, dueDate, owner, tagsInput, value, mode, companyId, todo, onSaved, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New todo" : "Edit todo"}</DialogTitle>
          <DialogDescription>Track an action item against this company.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="todo-title">Title</Label>
            <Input
              id="todo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Follow up on revised bid"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v: string | null) => setStatus((v as TodoStatus) ?? "open")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TODO_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {TODO_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="todo-due">Due date</Label>
              <Input
                id="todo-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="todo-owner">Owner</Label>
              <Input
                id="todo-owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g., Justin"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="todo-tags">Tags (comma-separated)</Label>
              <Input
                id="todo-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g., bid, urgent"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <div className="rounded-lg bg-card p-2 ring-1 ring-border/40">
              <Plate editor={editor} onValueChange={({ value: v }) => setValue(v as Descendant[])}>
                <PlateContent
                  className="min-h-[120px] max-h-[240px] overflow-y-auto rounded bg-background/40 px-3 py-2 text-sm text-foreground ring-1 ring-border/40 focus-visible:outline-none placeholder:text-muted-foreground"
                  placeholder="Optional detail, links, context…"
                />
              </Plate>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "create" ? "Create todo" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------

function DeleteTodoDialog({
  todo,
  open,
  onOpenChange,
  onConfirm,
  deleting,
}: {
  todo: Todo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete todo?</DialogTitle>
          <DialogDescription>
            {todo ? `"${todo.title}" will be removed. This can be undone by an admin.` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Todo row
// ---------------------------------------------------------------------------

function TodoRow({
  todo,
  onStatusChange,
  onEdit,
  onDelete,
  busy,
}: {
  todo: Todo;
  onStatusChange: (todo: Todo, status: TodoStatus) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  busy: boolean;
}) {
  const overdue = isOverdue(todo);

  return (
    <Card className="group transition-colors hover:bg-card/80">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="w-36 shrink-0">
          <Select
            value={todo.status}
            onValueChange={(v: string | null) => {
              const next = (v as TodoStatus) ?? todo.status;
              if (next !== todo.status) onStatusChange(todo, next);
            }}
            disabled={busy}
          >
            <SelectTrigger className="h-8" aria-label="Todo status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TODO_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {TODO_STATUS_META[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4
              className={cn(
                "truncate font-medium text-foreground",
                todo.status === "done" && "text-muted-foreground line-through",
              )}
            >
              {todo.title}
            </h4>
            <StatusPill status={todo.status} />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {todo.dueDate !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  overdue && "font-medium text-amber-400",
                )}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {formatDate(todo.dueDate)}
                {overdue && " · overdue"}
              </span>
            )}
            {todo.owner && (
              <span className="inline-flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {todo.owner}
              </span>
            )}
          </div>

          {todo.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {todo.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/30"
                >
                  <Tag className="h-2.5 w-2.5" />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon-sm" onClick={() => onEdit(todo)} aria-label="Edit todo">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onDelete(todo)}
            aria-label="Delete todo"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function CompanyTodosTab({ companyId }: { companyId: number }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const [editorOpen, setEditorOpen] = useState(false);
  const [activeTodo, setActiveTodo] = useState<Todo | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Todo | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (status: StatusFilter) => {
      setLoading(true);
      setError(null);
      try {
        const query = status === "all" ? "" : `?status=${status}`;
        const res = await apiGet<TodosListResponse>(
          `/api/companies/${companyId}/todos${query}`,
        );
        setTodos(res.todos ?? []);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load todos";
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [companyId],
  );

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  const setBusy = useCallback((id: number, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const openCreate = useCallback(() => {
    setActiveTodo(null);
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((todo: Todo) => {
    setActiveTodo(todo);
    setEditorOpen(true);
  }, []);

  const handleSaved = useCallback(
    (saved: Todo, mode: "create" | "edit") => {
      // Respect the active filter: a saved todo that no longer matches drops out.
      const matches = filter === "all" || saved.status === filter;
      setTodos((prev) => {
        if (mode === "create") {
          return matches ? [saved, ...prev] : prev;
        }
        const withoutOld = prev.filter((t) => t.id !== saved.id);
        return matches ? [saved, ...withoutOld] : withoutOld;
      });
    },
    [filter],
  );

  const handleStatusChange = useCallback(
    async (todo: Todo, status: TodoStatus) => {
      setBusy(todo.id, true);
      // Optimistic update.
      const prevTodos = todos;
      setTodos((prev) =>
        filter !== "all" && status !== filter
          ? prev.filter((t) => t.id !== todo.id)
          : prev.map((t) => (t.id === todo.id ? { ...t, status } : t)),
      );
      try {
        const res = await apiSend<TodoResponse>(
          `/api/companies/${companyId}/todos/${todo.id}`,
          "PATCH",
          { status },
        );
        setTodos((prev) => prev.map((t) => (t.id === res.todo.id ? res.todo : t)));
        toast.success(`Marked ${TODO_STATUS_META[status].label.toLowerCase()}`);
      } catch (err) {
        setTodos(prevTodos); // rollback
        toast.error(err instanceof Error ? err.message : "Failed to update status");
      } finally {
        setBusy(todo.id, false);
      }
    },
    [companyId, todos, filter, setBusy],
  );

  const openDelete = useCallback((todo: Todo) => {
    setDeleteTarget(todo);
    setDeleteOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiSend(`/api/companies/${companyId}/todos/${deleteTarget.id}`, "DELETE");
      setTodos((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      toast.success("Todo deleted");
      setDeleteOpen(false);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete todo");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, companyId]);

  const openCount = useMemo(
    () => todos.filter((t) => t.status !== "done").length,
    [todos],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Todos</h3>
          <p className="text-sm text-muted-foreground">
            {todos.length} shown · {openCount} open
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New todo
        </Button>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTER_ORDER.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors",
                active
                  ? "bg-primary/15 text-primary ring-primary/40"
                  : "bg-card text-muted-foreground ring-border/40 hover:text-foreground",
              )}
            >
              {FILTER_LABELS[f]}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-card ring-1 ring-border/40" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load(filter)}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : todos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-full bg-primary/10 p-3">
              {filter === "all" ? (
                <ListTodo className="h-6 w-6 text-primary" />
              ) : (
                <CheckCircle2 className="h-6 w-6 text-primary" />
              )}
            </div>
            <div>
              <p className="font-medium text-foreground">
                {filter === "all" ? "No todos yet" : `No ${FILTER_LABELS[filter].toLowerCase()} todos`}
              </p>
              <p className="text-sm text-muted-foreground">
                {filter === "all"
                  ? "Track follow-ups and action items for this company."
                  : "Try a different status filter."}
              </p>
            </div>
            {filter === "all" && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> New todo
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {todos.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onStatusChange={handleStatusChange}
              onEdit={openEdit}
              onDelete={openDelete}
              busy={busyIds.has(todo.id)}
            />
          ))}
        </div>
      )}

      <TodoEditorDialog
        companyId={companyId}
        todo={activeTodo}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={handleSaved}
      />

      <DeleteTodoDialog
        todo={deleteTarget}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={confirmDelete}
        deleting={deleting}
      />
    </div>
  );
}
