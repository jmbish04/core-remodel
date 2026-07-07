/**
 * @fileoverview ClickUp Task Detail Modal
 *
 * Shared modal used by both Kanban and Gantt views.
 * Supports create/edit, attachment upload (R2), AI flag panel,
 * and revision history.
 */

import {
  AlertTriangle,
  CalendarDays,
  Clock,
  FileUp,
  History,
  Loader2,
  Paperclip,
  Route,
  Send,
  Tag,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { BasicBlocksPlugin, BasicMarksPlugin } from "@platejs/basic-nodes/react";
import type { Descendant } from "slate";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import type { ClickUpTask, ClickUpTaskFlag } from "./types";

// ---------------------------------------------------------------------------
// Plate helpers
// ---------------------------------------------------------------------------

/** Convert plain text (from ClickUp) → Plate Descendant[] */
function textToDescendants(text: string): Descendant[] {
  if (!text || !text.trim()) {
    return [{ type: "p", children: [{ text: "" }] } as unknown as Descendant];
  }
  return text.split("\n").map(
    (line) =>
      ({ type: "p", children: [{ text: line }] }) as unknown as Descendant,
  );
}

/** Serialize Plate Descendant[] → plain text for ClickUp API */
function descendantsToText(nodes: Descendant[]): string {
  return nodes
    .map((node: any) => {
      if (node.children) {
        return node.children.map((child: any) => child.text || "").join("");
      }
      return node.text || "";
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClickUpTaskModalProps {
  task: ClickUpTask | null;
  flags: ClickUpTaskFlag[];
  isOpen: boolean;
  mode: "create" | "edit";
  listId: string;
  onClose: () => void;
  onSave: (task: ClickUpTask) => void;
}

interface RevisionEntry {
  id: number;
  clickupTaskId: string;
  operation: string;
  requestPayload: string;
  responsePayload: string | null;
  actor: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClickUpTaskModal({
  task,
  flags,
  isOpen,
  mode,
  listId,
  onClose,
  onSave,
}: ClickUpTaskModalProps) {
  const [name, setName] = useState("");
  const [descriptionValue, setDescriptionValue] = useState<Descendant[]>(
    textToDescendants(""),
  );
  const [status, setStatus] = useState("to do");
  const [priority, setPriority] = useState("3"); // normal
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [revisions, setRevisions] = useState<RevisionEntry[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);

  // Plate editor — re-created per task (deps) so switching tasks never shows
  // the previous task's description; plugins enable basic block/mark editing.
  const descriptionEditor = usePlateEditor(
    {
      plugins: [BasicBlocksPlugin, BasicMarksPlugin],
      value: textToDescendants(
        mode === "edit" ? task?.description || task?.text_content || "" : "",
      ) as any,
    },
    [task?.id ?? "create", mode],
  );

  // Populate form when task changes
  useEffect(() => {
    if (task && mode === "edit") {
      setName(task.name);
      setDescriptionValue(
        textToDescendants(task.description || task.text_content || ""),
      );
      setStatus(task.status?.status || "to do");
      setPriority(task.priority?.id || "3");
      setStartDate(
        task.start_date
          ? new Date(Number(task.start_date)).toISOString().slice(0, 10)
          : "",
      );
      setDueDate(
        task.due_date
          ? new Date(Number(task.due_date)).toISOString().slice(0, 10)
          : "",
      );
      setTags(task.tags?.map((t) => t.name).join(", ") || "");
    } else {
      setName("");
      setDescriptionValue(textToDescendants(""));
      setStatus("to do");
      setPriority("3");
      setStartDate("");
      setDueDate("");
      setTags("");
    }
  }, [task, mode]);

  // Load revisions for edit mode
  useEffect(() => {
    if (!task || mode !== "edit" || !isOpen) return;
    setLoadingRevisions(true);
    fetch(`/api/clickup/revisions?task_id=${task.id}&limit=20`)
      .then((r) => r.json())
      .then((data: any) => setRevisions(data.revisions || []))
      .catch(() => setRevisions([]))
      .finally(() => setLoadingRevisions(false));
  }, [task, mode, isOpen]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      toast.error("Task name is required");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: descendantsToText(descriptionValue),
        status,
        priority: Number(priority),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };

      if (startDate) payload.start_date = new Date(startDate).getTime();
      if (dueDate) payload.due_date = new Date(dueDate).getTime();

      let res: Response;
      if (mode === "create") {
        res = await fetch(`/api/clickup/tasks?list_id=${listId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/clickup/tasks/${task!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => null) as any;
        const detail = errData?.detail || errData?.error || `HTTP ${res.status}`;
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }

      const data = await res.json();
      toast.success(mode === "create" ? "Task created in ClickUp" : "Task updated in ClickUp");
      onSave((data as any).task);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save task";
      toast.error(`ClickUp write failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }, [name, descriptionValue, status, priority, startDate, dueDate, tags, mode, task, listId, onSave, onClose]);

  const handleAttachmentUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!task || !e.target.files?.[0]) return;
      const file = e.target.files[0];
      setUploading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("label", file.name);

        const res = await fetch(
          `/api/clickup/tasks/${task.id}/attachments`,
          { method: "POST", body: formData },
        );

        if (!res.ok) throw new Error("Upload failed");
        toast.success(`Attached ${file.name}`);
      } catch (err) {
        toast.error("Failed to upload attachment");
      } finally {
        setUploading(false);
      }
    },
    [task],
  );

  const handleDismissFlag = useCallback(async (flagId: number) => {
    try {
      await fetch(`/api/clickup/flags/${flagId}/dismiss`, { method: "POST" });
      toast.success("Flag dismissed");
    } catch {
      toast.error("Failed to dismiss flag");
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-100">
            {mode === "create" ? "Create Task" : "Edit Task"}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Body */}
        <Tabs defaultValue="details" className="px-6 py-4">
          <TabsList className="mb-4 bg-zinc-900">
            <TabsTrigger value="details">Details</TabsTrigger>
            {mode === "edit" && (
              <>
                <TabsTrigger value="flags">
                  Flags
                  {flags.length > 0 && (
                    <Badge
                      variant="destructive"
                      className="ml-1.5 h-5 w-5 rounded-full p-0 text-[10px]"
                    >
                      {flags.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="history">
                  <History className="mr-1 h-3.5 w-3.5" />
                  History
                </TabsTrigger>
              </>
            )}
          </TabsList>

          {/* Details tab */}
          <TabsContent value="details" className="space-y-4">
            <div>
              <Label htmlFor="task-name">Name</Label>
              <Input
                id="task-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Install kitchen backsplash tile"
                className="mt-1 bg-zinc-900"
              />
            </div>

            <div>
              <Label>Description</Label>
              <div className="mt-1 rounded-lg border border-zinc-800 bg-zinc-900 p-2">
                <Plate
                  editor={descriptionEditor}
                  onValueChange={({ value }) =>
                    setDescriptionValue(value as Descendant[])
                  }
                >
                  <PlateContent
                    className="min-h-[120px] max-h-[260px] overflow-y-auto rounded bg-zinc-950/60 border border-zinc-800/40 px-3 py-2 text-sm text-zinc-200 focus-visible:outline-none placeholder:text-zinc-600"
                    placeholder="Include dimensions, materials, vendor links, budget..."
                  />
                </Plate>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={(v: string | null) => setStatus(v || "to do")}>
                  <SelectTrigger className="mt-1 bg-zinc-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="to do">To Do</SelectItem>
                    <SelectItem value="in progress">In Progress</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                    <SelectItem value="complete">Complete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v: string | null) => setPriority(v || "3")}>
                  <SelectTrigger className="mt-1 bg-zinc-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">🔴 Urgent</SelectItem>
                    <SelectItem value="2">🟠 High</SelectItem>
                    <SelectItem value="3">🔵 Normal</SelectItem>
                    <SelectItem value="4">⚪ Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="start-date">
                  <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
                  Start Date
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 bg-zinc-900"
                />
              </div>
              <div>
                <Label htmlFor="due-date">
                  <Clock className="mr-1 inline h-3.5 w-3.5" />
                  Due Date
                </Label>
                <Input
                  id="due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="mt-1 bg-zinc-900"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="task-tags">
                <Tag className="mr-1 inline h-3.5 w-3.5" />
                Tags (comma-separated)
              </Label>
              <Input
                id="task-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g., kitchen, tile, phase-2"
                className="mt-1 bg-zinc-900"
              />
            </div>

            {/* Attachment upload (edit mode only) */}
            {mode === "edit" && (
              <div>
                <Label>
                  <Paperclip className="mr-1 inline h-3.5 w-3.5" />
                  Attachments (stored in R2, linked in ClickUp)
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    type="file"
                    onChange={handleAttachmentUpload}
                    disabled={uploading}
                    className="bg-zinc-900"
                  />
                  {uploading && (
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Flags tab */}
          {mode === "edit" && (
            <TabsContent value="flags" className="space-y-3">
              {flags.length === 0 ? (
                <div className="py-8 text-center text-sm text-zinc-500">
                  No active flags for this task.
                </div>
              ) : (
                flags.map((flag) => {
                  const iconMap = {
                    AI_AUDIT: AlertTriangle,
                    CRITICAL_PATH: Route,
                    OVERDUE: Clock,
                    DEPENDENCY_BLOCKED: AlertTriangle,
                  };
                  const Icon =
                    iconMap[flag.flagType as keyof typeof iconMap] ||
                    AlertTriangle;
                  const severityColors = {
                    critical: "border-red-500/30 bg-red-950/20",
                    warning: "border-amber-500/30 bg-amber-950/20",
                    info: "border-blue-500/30 bg-blue-950/20",
                  };

                  return (
                    <Card
                      key={flag.id}
                      className={cn(
                        "border",
                        severityColors[flag.severity] || severityColors.warning,
                      )}
                    >
                      <CardContent className="flex items-start gap-3 p-4">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-zinc-200">
                            {flag.flagType.replace("_", " ")}
                          </p>
                          <p className="mt-1 text-sm text-zinc-400">
                            {flag.message}
                          </p>
                          <p className="mt-2 text-xs text-zinc-600">
                            Flagged{" "}
                            {new Date(flag.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDismissFlag(flag.id)}
                          className="text-xs text-zinc-500 hover:text-zinc-300"
                        >
                          Dismiss
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>
          )}

          {/* History tab */}
          {mode === "edit" && (
            <TabsContent value="history" className="space-y-2">
              {loadingRevisions ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                </div>
              ) : revisions.length === 0 ? (
                <div className="py-8 text-center text-sm text-zinc-500">
                  No revision history.
                </div>
              ) : (
                revisions.map((rev) => (
                  <div
                    key={rev.id}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
                  >
                    <History className="h-4 w-4 shrink-0 text-zinc-500" />
                    <div className="flex-1">
                      <p className="text-sm text-zinc-300">
                        <span className="font-medium capitalize">
                          {rev.operation}
                        </span>
                        {" by "}
                        <span className="text-zinc-400">{rev.actor}</span>
                      </p>
                      <p className="text-xs text-zinc-600">
                        {new Date(rev.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </TabsContent>
          )}
        </Tabs>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Send className="mr-2 h-4 w-4" />
            {mode === "create" ? "Create Task" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
