import {
  Bot,
  CheckCircle2,
  Columns3,
  LayoutList,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  Timer,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TaskStatus = "pending" | "in_progress" | "blocked" | "delayed" | "done";
type PlanningView = "table" | "kanban" | "gantt" | "itinerary";

interface PlanningParticipant {
  id: number;
  displayName: string;
  participantType: string;
}

interface PlanningEpic {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  phaseOrder: number;
}

interface PlanningTask {
  id: string;
  epicId: string;
  slug: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: number;
  taskOrder: number;
  startDate?: string | null;
  dueDate?: string | null;
  ownerParticipantId?: number | null;
  latestUpdate?: {
    id: string;
    status: TaskStatus;
    note?: string | null;
    isDraft: boolean;
    source: string;
    updateDate: string;
  } | null;
  rasci: {
    responsible?: string | null;
    accountable?: string | null;
    support: string[];
    consulted: string[];
    informed: string[];
  };
}

interface PlanningPayload {
  success: boolean;
  participants: PlanningParticipant[];
  epics: PlanningEpic[];
  tasks: PlanningTask[];
  meta: {
    taskCount: number;
    openTaskCount: number;
    draftUpdateCount: number;
  };
}

const STATUS_OPTIONS: TaskStatus[] = ["pending", "in_progress", "blocked", "delayed", "done"];

function statusLabel(status: TaskStatus): string {
  if (status === "in_progress") return "In Progress";
  if (status === "blocked") return "Blocked";
  if (status === "delayed") return "Delayed";
  if (status === "done") return "Done";
  return "Pending";
}

function statusBadgeVariant(status: TaskStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") return "default";
  if (status === "blocked") return "destructive";
  if (status === "delayed") return "outline";
  if (status === "in_progress") return "secondary";
  return "outline";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unscheduled";
  return date.toLocaleDateString();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to encode audio"));
        return;
      }
      const [, base64 = ""] = result.split(",", 2);
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read audio"));
    reader.readAsDataURL(blob);
  });
}

export function PlanningApp() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payload, setPayload] = useState<PlanningPayload | null>(null);
  const [view, setView] = useState<PlanningView>("table");

  const [editingTask, setEditingTask] = useState<PlanningTask | null>(null);
  const [assistantTask, setAssistantTask] = useState<PlanningTask | null>(null);

  const [updateStatus, setUpdateStatus] = useState<TaskStatus>("pending");
  const [updateNote, setUpdateNote] = useState("");
  const [updateAudioBase64, setUpdateAudioBase64] = useState<string | null>(null);
  const [savingUpdate, setSavingUpdate] = useState(false);

  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantAudioBase64, setAssistantAudioBase64] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTarget, setRecordingTarget] = useState<"update" | "assistant" | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const canRecord = typeof window !== "undefined" && typeof MediaRecorder !== "undefined";

  const loadOverview = useCallback(async (withLoading: boolean) => {
    if (withLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const response = await fetch("/api/planning/overview", { credentials: "include" });
      const result = (await response.json()) as PlanningPayload & { error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to load planning");
      }
      setPayload(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load planning");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview(true);
  }, [loadOverview]);

  useEffect(
    () => () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const groupedTasks = useMemo(() => {
    const map = new Map<string, PlanningTask[]>();
    for (const task of payload?.tasks || []) {
      const items = map.get(task.epicId) || [];
      items.push(task);
      map.set(task.epicId, items);
    }
    for (const entry of map.values()) {
      entry.sort((left, right) => left.taskOrder - right.taskOrder);
    }
    return map;
  }, [payload?.tasks]);

  const statusColumns = useMemo(() => {
    const map = new Map<TaskStatus, PlanningTask[]>();
    for (const status of STATUS_OPTIONS) {
      map.set(status, []);
    }
    for (const task of payload?.tasks || []) {
      const items = map.get(task.status) || [];
      items.push(task);
      map.set(task.status, items);
    }
    return map;
  }, [payload?.tasks]);

  const itineraryGroups = useMemo(() => {
    const groups = new Map<string, PlanningTask[]>();
    for (const task of payload?.tasks || []) {
      const key = task.dueDate?.trim() ? task.dueDate.slice(0, 7) : "Unscheduled";
      const items = groups.get(key) || [];
      items.push(task);
      groups.set(key, items);
    }
    return Array.from(groups.entries()).sort((left, right) => left[0].localeCompare(right[0]));
  }, [payload?.tasks]);

  const startRecording = useCallback(
    async (target: "update" | "assistant") => {
      if (!canRecord || !navigator.mediaDevices?.getUserMedia) {
        toast.error("Voice recording is not available in this browser");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        recorderRef.current = recorder;
        streamRef.current = stream;
        chunksRef.current = [];
        setRecordingTarget(target);

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        recorder.onstop = async () => {
          try {
            const blob = new Blob(chunksRef.current, {
              type: recorder.mimeType || "audio/webm",
            });
            const base64 = await blobToBase64(blob);
            if (target === "assistant") {
              setAssistantAudioBase64(base64);
            } else {
              setUpdateAudioBase64(base64);
            }
            toast.success("Voice note captured");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to process voice note");
          } finally {
            stream.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
            recorderRef.current = null;
            chunksRef.current = [];
            setRecordingTarget(null);
            setIsRecording(false);
          }
        };

        recorder.start();
        setIsRecording(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to start recording");
      }
    },
    [canRecord],
  );

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const openUpdateModal = useCallback((task: PlanningTask) => {
    setEditingTask(task);
    setUpdateStatus(task.status);
    setUpdateNote("");
    setUpdateAudioBase64(null);
  }, []);

  const submitTaskUpdate = useCallback(async () => {
    if (!editingTask) return;
    setSavingUpdate(true);
    try {
      const response = await fetch("/api/planning/task-updates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: editingTask.id,
          status: updateStatus,
          note: updateNote,
          audioBase64: updateAudioBase64,
          source: "planning",
          isDraft: false,
        }),
      });
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to update task");
      }
      toast.success("Task status updated");
      setEditingTask(null);
      await loadOverview(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setSavingUpdate(false);
    }
  }, [editingTask, loadOverview, updateAudioBase64, updateNote, updateStatus]);

  const draftAssistantUpdate = useCallback(async () => {
    if (!assistantTask) return;
    setDrafting(true);
    try {
      const response = await fetch("/api/planning/assistant/draft-update", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: assistantTask.id,
          prompt: assistantPrompt,
          audioBase64: assistantAudioBase64,
        }),
      });
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to draft update");
      }
      toast.success("Draft update created. Approve it to apply status.");
      setAssistantTask(null);
      setAssistantPrompt("");
      setAssistantAudioBase64(null);
      await loadOverview(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to draft update");
    } finally {
      setDrafting(false);
    }
  }, [assistantAudioBase64, assistantPrompt, assistantTask, loadOverview]);

  const approveDraft = useCallback(
    async (task: PlanningTask) => {
      const draftId = task.latestUpdate?.isDraft ? task.latestUpdate.id : null;
      if (!draftId) return;
      try {
        const response = await fetch(`/api/planning/task-updates/${draftId}/approve`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applyTaskStatus: true,
          }),
        });
        const result = (await response.json()) as { success?: boolean; error?: string };
        if (!response.ok || !result.success) {
          throw new Error(result.error || "Failed to approve draft");
        }
        toast.success("Draft approved and applied");
        await loadOverview(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to approve draft");
      }
    },
    [loadOverview],
  );

  if (loading) {
    return (
      <div className="flex min-h-[50svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading planning workspace...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-xl">Planning Viewport</CardTitle>
              <CardDescription>
                Remodel waterfall tracker with task table, Kanban, Gantt, itinerary, and draftable assistant updates.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadOverview(false)} disabled={refreshing}>
              {refreshing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Tasks</p>
            <p className="mt-1 text-lg font-semibold">{payload?.meta.taskCount || 0}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Open</p>
            <p className="mt-1 text-lg font-semibold">{payload?.meta.openTaskCount || 0}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Draft Updates</p>
            <p className="mt-1 text-lg font-semibold">{payload?.meta.draftUpdateCount || 0}</p>
          </div>
        </CardContent>
      </Card>

      <div className="inline-flex rounded-lg border border-border/60 bg-muted/20 p-1">
        {([
          { key: "table", label: "Task Table", icon: LayoutList },
          { key: "kanban", label: "Kanban", icon: Columns3 },
          { key: "gantt", label: "Gantt", icon: Timer },
          { key: "itinerary", label: "Itinerary", icon: CheckCircle2 },
        ] as Array<{ key: PlanningView; label: string; icon: React.ComponentType<{ className?: string }> }>).map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition",
              view === item.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setView(item.key)}
          >
            <item.icon className="size-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      {view === "table" ? (
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Task Table by Epic</CardTitle>
            <CardDescription>Grouped waterfall phases with RASCI assignments and draft-aware status control.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {(payload?.epics || []).map((epic) => {
              const tasks = groupedTasks.get(epic.id) || [];
              return (
                <section key={epic.id} className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Phase {epic.phaseOrder}</p>
                    <h3 className="text-sm font-semibold">{epic.title}</h3>
                    {epic.description ? <p className="text-xs text-muted-foreground">{epic.description}</p> : null}
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-border/60">
                    <table className="min-w-full text-sm">
                      <thead className="bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Task</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Responsible</th>
                          <th className="px-3 py-2">Accountable</th>
                          <th className="px-3 py-2">Due</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((task) => (
                          <tr key={task.id} className="border-t border-border/40">
                            <td className="px-3 py-2 align-top">
                              <p className="font-medium">{task.title}</p>
                              {task.description ? (
                                <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <div className="space-y-1">
                                <Badge variant={statusBadgeVariant(task.status)}>{statusLabel(task.status)}</Badge>
                                {task.latestUpdate?.isDraft ? (
                                  <Badge variant="outline">Draft pending approval</Badge>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-2 align-top text-xs">{task.rasci.responsible || "Unassigned"}</td>
                            <td className="px-3 py-2 align-top text-xs">{task.rasci.accountable || "Unassigned"}</td>
                            <td className="px-3 py-2 align-top text-xs">{formatDate(task.dueDate)}</td>
                            <td className="px-3 py-2 align-top">
                              <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => openUpdateModal(task)}>
                                  Update
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setAssistantTask(task);
                                    setAssistantPrompt("");
                                    setAssistantAudioBase64(null);
                                  }}
                                >
                                  <Bot className="mr-1 size-3.5" />
                                  Draft
                                </Button>
                                {task.latestUpdate?.isDraft ? (
                                  <Button size="sm" onClick={() => void approveDraft(task)}>
                                    Approve
                                  </Button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {view === "kanban" ? (
        <div className="grid gap-4 lg:grid-cols-5">
          {STATUS_OPTIONS.map((status) => (
            <Card key={status} className="ring-1 ring-border/40">
              <CardHeader>
                <CardTitle className="text-sm">{statusLabel(status)}</CardTitle>
                <CardDescription>{(statusColumns.get(status) || []).length} tasks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(statusColumns.get(status) || []).map((task) => (
                  <div key={task.id} className="rounded-lg border border-border/60 bg-card/40 p-3">
                    <p className="text-sm font-medium">{task.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{task.rasci.responsible || "Unassigned"}</p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openUpdateModal(task)}>
                        Update
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAssistantTask(task);
                          setAssistantPrompt("");
                          setAssistantAudioBase64(null);
                        }}
                      >
                        Draft
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {view === "gantt" ? (
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Gantt Snapshot</CardTitle>
            <CardDescription>Sequence-first timeline for waterfall execution with date placeholders where unscheduled.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(payload?.epics || []).map((epic) => {
              const tasks = groupedTasks.get(epic.id) || [];
              return (
                <section key={epic.id} className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">{epic.title}</p>
                  <div className="space-y-2">
                    {tasks.map((task) => {
                      const completionWidth =
                        task.status === "done"
                          ? 100
                          : task.status === "in_progress"
                            ? 65
                            : task.status === "delayed"
                              ? 40
                              : task.status === "blocked"
                                ? 25
                                : 15;
                      return (
                        <div key={task.id} className="space-y-1">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-medium">{task.title}</span>
                            <span className="text-muted-foreground">{formatDate(task.dueDate)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted/30">
                            <div
                              className={cn(
                                "h-2 rounded-full",
                                task.status === "done"
                                  ? "bg-emerald-500"
                                  : task.status === "blocked"
                                    ? "bg-red-500"
                                    : task.status === "delayed"
                                      ? "bg-amber-500"
                                      : "bg-primary",
                              )}
                              style={{ width: `${completionWidth}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {view === "itinerary" ? (
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Itinerary (Month-by-Month)</CardTitle>
            <CardDescription>Upcoming, overdue, and unscheduled tasks with role visibility.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {itineraryGroups.map(([key, tasks]) => (
              <section key={key} className="space-y-2 rounded-xl border border-border/60 bg-card/30 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {key === "Unscheduled" ? "Unscheduled" : key}
                </p>
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div key={task.id} className="rounded-lg border border-border/50 bg-background/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{task.title}</p>
                        <Badge variant={statusBadgeVariant(task.status)}>{statusLabel(task.status)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        R: {task.rasci.responsible || "Unassigned"} · A: {task.rasci.accountable || "Unassigned"}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={Boolean(editingTask)} onOpenChange={(open) => !open && setEditingTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Task Status</DialogTitle>
          </DialogHeader>
          {editingTask ? (
            <div className="space-y-4">
              <p className="text-sm font-medium">{editingTask.title}</p>
              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="task-status">
                  Status
                </label>
                <select
                  id="task-status"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={updateStatus}
                  onChange={(event) => setUpdateStatus(event.target.value as TaskStatus)}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="task-note">
                  Notes
                </label>
                <Textarea
                  id="task-note"
                  rows={5}
                  value={updateNote}
                  onChange={(event) => setUpdateNote(event.target.value)}
                  placeholder="What changed today?"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isRecording && recordingTarget === "update" ? (
                  <Button variant="outline" onClick={stopRecording}>
                    <MicOff className="mr-2 size-4" />
                    Stop Recording
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => void startRecording("update")}
                    disabled={!canRecord || (isRecording && recordingTarget !== "update")}
                  >
                    <Mic className="mr-2 size-4" />
                    Voice Note
                  </Button>
                )}
                {updateAudioBase64 ? <Badge variant="secondary">Voice note attached</Badge> : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditingTask(null)} disabled={savingUpdate}>
                  Cancel
                </Button>
                <Button onClick={() => void submitTaskUpdate()} disabled={savingUpdate}>
                  {savingUpdate ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Save Update
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(assistantTask)} onOpenChange={(open) => !open && setAssistantTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Planning Assistant Draft</DialogTitle>
          </DialogHeader>
          {assistantTask ? (
            <div className="space-y-4">
              <p className="text-sm font-medium">{assistantTask.title}</p>
              <Input
                value={assistantPrompt}
                onChange={(event) => setAssistantPrompt(event.target.value)}
                placeholder="Tell the assistant what changed or what was missed."
              />
              <div className="flex flex-wrap items-center gap-2">
                {isRecording && recordingTarget === "assistant" ? (
                  <Button variant="outline" onClick={stopRecording}>
                    <MicOff className="mr-2 size-4" />
                    Stop Recording
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => void startRecording("assistant")}
                    disabled={!canRecord || (isRecording && recordingTarget !== "assistant")}
                  >
                    <Mic className="mr-2 size-4" />
                    Voice Memo
                  </Button>
                )}
                {assistantAudioBase64 ? <Badge variant="secondary">Voice memo attached</Badge> : null}
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                The assistant generates a draft update only. A human must approve before task status is applied.
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAssistantTask(null)} disabled={drafting}>
                  Cancel
                </Button>
                <Button onClick={() => void draftAssistantUpdate()} disabled={drafting}>
                  {drafting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Bot className="mr-2 size-4" />}
                  Create Draft
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
