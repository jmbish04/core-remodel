import { CalendarDays, Loader2, Mic, MicOff, Plus, RefreshCw, Upload } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import type { Descendant } from "slate";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TaskStatus = "pending" | "in_progress" | "blocked" | "delayed" | "done";

interface PlanningTask {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  dueDate?: string | null;
  latestUpdate?: {
    note?: string | null;
    updateDate: string;
  } | null;
}

interface PlanningPayload {
  success: boolean;
  tasks: PlanningTask[];
}

interface PendingTaskUpdate {
  taskId: string;
  taskTitle: string;
  status: TaskStatus;
  note: string;
  transcript?: string | null;
  photoImageIds: string[];
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
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
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

function defaultEditorValue(title: string): Descendant[] {
  return [
    {
      type: "p",
      children: [
        {
          text: `${title} notes`,
        },
      ],
    } as unknown as Descendant,
    {
      type: "p",
      children: [{ text: "" }],
    } as unknown as Descendant,
  ];
}

export function ProjectLogApp(props: { logType: "daily" | "weekly" }) {
  const { logType } = props;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tasks, setTasks] = useState<PlanningTask[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<PendingTaskUpdate[]>([]);
  const [showFuture, setShowFuture] = useState(false);
  const [savingLog, setSavingLog] = useState(false);

  const [logVoiceBase64, setLogVoiceBase64] = useState<string | null>(null);
  const [logTranscript, setLogTranscript] = useState<string>("");

  const [editingTask, setEditingTask] = useState<PlanningTask | null>(null);
  const [taskUpdateStatus, setTaskUpdateStatus] = useState<TaskStatus>("pending");
  const [taskUpdateNote, setTaskUpdateNote] = useState("");
  const [taskVoiceBase64, setTaskVoiceBase64] = useState<string | null>(null);
  const [taskTranscript, setTaskTranscript] = useState<string>("");
  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const [savingTaskUpdate, setSavingTaskUpdate] = useState(false);

  const [recordingMode, setRecordingMode] = useState<"log" | "task" | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const initialValue = useMemo(
    () => defaultEditorValue(logType === "daily" ? "Daily log" : "Weekly log"),
    [logType],
  );
  const [editorValue, setEditorValue] = useState<Descendant[]>(initialValue);
  const editor = usePlateEditor(
    {
      value: editorValue as Descendant[],
    },
    [logType],
  );

  const canRecord = typeof window !== "undefined" && typeof MediaRecorder !== "undefined";

  const loadTasks = useCallback(async (withLoading: boolean) => {
    if (withLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const response = await fetch("/api/planning/overview", { credentials: "include" });
      const result = (await response.json()) as PlanningPayload & { error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to load planning tasks");
      }
      setTasks((result.tasks || []).filter((task) => task.status !== "done"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load tasks");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks(true);
  }, [loadTasks]);

  useEffect(
    () => () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const sortedTasks = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const scoreTask = (task: PlanningTask) => {
      if (!task.dueDate) return 1;
      const date = new Date(task.dueDate);
      if (Number.isNaN(date.getTime())) return 1;
      if (date < today) return 0;
      if (date > today) return 2;
      return 1;
    };

    return [...tasks].sort((left, right) => {
      const scoreDiff = scoreTask(left) - scoreTask(right);
      if (scoreDiff !== 0) return scoreDiff;
      if (left.dueDate && right.dueDate) {
        return left.dueDate.localeCompare(right.dueDate);
      }
      if (left.dueDate) return -1;
      if (right.dueDate) return 1;
      return left.title.localeCompare(right.title);
    });
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return sortedTasks.filter((task, index) => {
      if (showFuture) return true;
      if (!task.dueDate) return index < 10;
      return task.dueDate <= today;
    });
  }, [showFuture, sortedTasks]);

  const fetchTranscript = useCallback(async (audioBase64: string): Promise<string> => {
    try {
      const response = await fetch("/api/planning/transcribe", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64 }),
      });
      const result = (await response.json()) as { success?: boolean; transcript?: string; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed transcription");
      }
      return result.transcript?.trim() || "";
    } catch {
      return "";
    }
  }, []);

  const startRecording = useCallback(
    async (mode: "log" | "task") => {
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
        setRecordingMode(mode);

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
            if (mode === "task") {
              setTaskVoiceBase64(base64);
              const transcript = await fetchTranscript(base64);
              setTaskTranscript(transcript);
              if (transcript) {
                setTaskUpdateNote((current) => (current ? `${current}\n\n${transcript}` : transcript));
              }
            } else {
              setLogVoiceBase64(base64);
              const transcript = await fetchTranscript(base64);
              setLogTranscript(transcript);
              if (transcript) {
                setEditorValue((current) => [
                  ...current,
                  {
                    type: "p",
                    children: [{ text: transcript }],
                  } as unknown as Descendant,
                ]);
              }
            }
            toast.success("Voice note transcribed");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to process voice note");
          } finally {
            stream.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
            recorderRef.current = null;
            chunksRef.current = [];
            setRecordingMode(null);
            setIsRecording(false);
          }
        };

        recorder.start();
        setIsRecording(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to start recording");
      }
    },
    [canRecord, fetchTranscript],
  );

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const uploadTaskFiles = useCallback(async (files: File[]): Promise<string[]> => {
    if (files.length === 0) return [];
    const formData = new FormData();
    formData.append("photoCategory", "inspirational");
    for (const file of files) {
      formData.append("files", file);
    }

    const response = await fetch("/api/images/upload", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const result = (await response.json()) as {
      success?: boolean;
      error?: string;
      results?: Array<{ success?: boolean; imageId?: string }>;
    };

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Photo upload failed");
    }

    return (result.results || [])
      .filter((item) => item.success && item.imageId)
      .map((item) => String(item.imageId));
  }, []);

  const queueTaskUpdate = useCallback(async () => {
    if (!editingTask) return;
    setSavingTaskUpdate(true);
    try {
      const imageIds = await uploadTaskFiles(taskFiles);
      const note = taskUpdateNote.trim();
      const entry: PendingTaskUpdate = {
        taskId: editingTask.id,
        taskTitle: editingTask.title,
        status: taskUpdateStatus,
        note,
        transcript: taskTranscript || null,
        photoImageIds: imageIds,
      };
      setPendingUpdates((current) => {
        const withoutExisting = current.filter((item) => item.taskId !== editingTask.id);
        return [...withoutExisting, entry];
      });
      setEditingTask(null);
      toast.success("Task update queued for this log");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to queue task update");
    } finally {
      setSavingTaskUpdate(false);
    }
  }, [
    editingTask,
    taskFiles,
    taskTranscript,
    taskUpdateNote,
    taskUpdateStatus,
    uploadTaskFiles,
  ]);

  const saveLog = useCallback(async () => {
    setSavingLog(true);
    try {
      const response = await fetch("/api/planning/logs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logType,
          content: editorValue,
          transcript: logTranscript || null,
          audioBase64: logVoiceBase64,
          taskUpdates: pendingUpdates.map((update) => ({
            taskId: update.taskId,
            status: update.status,
            note: update.note,
            transcript: update.transcript,
            photoImageIds: update.photoImageIds,
          })),
        }),
      });
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to save log");
      }

      toast.success(`${logType === "daily" ? "Daily" : "Weekly"} log saved`);
      setPendingUpdates([]);
      setLogVoiceBase64(null);
      setLogTranscript("");
      setEditorValue(defaultEditorValue(logType === "daily" ? "Daily log" : "Weekly log"));
      await loadTasks(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save log");
    } finally {
      setSavingLog(false);
    }
  }, [editorValue, loadTasks, logTranscript, logType, logVoiceBase64, pendingUpdates]);

  if (loading) {
    return (
      <div className="flex min-h-[50svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading log workspace...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-xl">{logType === "daily" ? "Daily Log" : "Weekly Log"}</CardTitle>
              <CardDescription>
                Voice-first field updates with task status journaling and PlateJS narrative notes.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadTasks(false)} disabled={refreshing}>
              {refreshing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-card/30 p-3">
            <Plate
              editor={editor}
              onValueChange={({ value }) => setEditorValue(value as Descendant[])}
            >
              <PlateContent
                className="min-h-[220px] rounded-lg border border-border/50 bg-background/80 px-3 py-3 text-sm"
                placeholder={`Write ${logType} notes or use voice memo...`}
              />
            </Plate>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isRecording && recordingMode === "log" ? (
              <Button variant="outline" onClick={stopRecording}>
                <MicOff className="mr-2 size-4" />
                Stop Log Recording
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => void startRecording("log")}
                disabled={!canRecord || (isRecording && recordingMode !== "log")}
              >
                <Mic className="mr-2 size-4" />
                Voice Memo
              </Button>
            )}
            {logVoiceBase64 ? <Badge variant="secondary">Voice memo attached</Badge> : null}
            <Button onClick={() => void saveLog()} disabled={savingLog}>
              {savingLog ? <Loader2 className="mr-2 size-4 animate-spin" /> : <CalendarDays className="mr-2 size-4" />}
              Save {logType === "daily" ? "Daily" : "Weekly"} Log
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Expected Tasks ({visibleTasks.length})</CardTitle>
          <CardDescription>
            Overdue tasks are shown first. Future tasks stay collapsed until requested.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {visibleTasks.map((task) => {
            const queued = pendingUpdates.find((entry) => entry.taskId === task.id) || null;
            return (
              <div key={task.id} className="rounded-lg border border-border/60 bg-card/40 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Due: {formatDate(task.dueDate)} · Current: {statusLabel(task.status)}
                    </p>
                    {queued ? (
                      <p className="text-xs text-emerald-400">
                        Queued update: {statusLabel(queued.status)} ({queued.photoImageIds.length} photos)
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingTask(task);
                      setTaskUpdateStatus(task.status);
                      setTaskUpdateNote("");
                      setTaskVoiceBase64(null);
                      setTaskTranscript("");
                      setTaskFiles([]);
                    }}
                  >
                    <Plus className="mr-1 size-3.5" />
                    Update
                  </Button>
                </div>
              </div>
            );
          })}
          {!showFuture ? (
            <Button variant="ghost" size="sm" onClick={() => setShowFuture(true)}>
              View future tasks
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {pendingUpdates.length > 0 ? (
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Queued Updates</CardTitle>
            <CardDescription>These task updates will be applied when you save this log.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingUpdates.map((entry) => (
              <div key={entry.taskId} className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{entry.taskTitle}</span>
                  <Badge variant={statusBadgeVariant(entry.status)}>{statusLabel(entry.status)}</Badge>
                </div>
                {entry.note ? <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={Boolean(editingTask)} onOpenChange={(open) => !open && setEditingTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Task Update</DialogTitle>
          </DialogHeader>
          {editingTask ? (
            <div className="space-y-4">
              <p className="text-sm font-medium">{editingTask.title}</p>
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={taskUpdateStatus}
                onChange={(event) => setTaskUpdateStatus(event.target.value as TaskStatus)}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
              <Textarea
                rows={5}
                value={taskUpdateNote}
                onChange={(event) => setTaskUpdateNote(event.target.value)}
                placeholder="What happened for this task today?"
              />
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Optional photo evidence
                </label>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={(event) => setTaskFiles(Array.from(event.target.files || []))}
                />
                {taskFiles.length > 0 ? (
                  <p className="text-xs text-muted-foreground">{taskFiles.length} files selected</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isRecording && recordingMode === "task" ? (
                  <Button variant="outline" onClick={stopRecording}>
                    <MicOff className="mr-2 size-4" />
                    Stop Recording
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => void startRecording("task")}
                    disabled={!canRecord || (isRecording && recordingMode !== "task")}
                  >
                    <Mic className="mr-2 size-4" />
                    Voice Note
                  </Button>
                )}
                {taskVoiceBase64 ? <Badge variant="secondary">Voice note attached</Badge> : null}
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Uploads use the same Cloudflare Images pipeline. If access is not authenticated, upload may be denied.
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditingTask(null)} disabled={savingTaskUpdate}>
                  Cancel
                </Button>
                <Button onClick={() => void queueTaskUpdate()} disabled={savingTaskUpdate}>
                  {savingTaskUpdate ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
                  Queue Update
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
