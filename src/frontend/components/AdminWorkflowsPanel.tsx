/**
 * @fileoverview Admin-only workflow control panel.
 *
 * For each row in `system_cron_schedules`, renders an editable cron expression,
 * an Enabled switch, a "Run Now" button, and a scrolling live-progress feed
 * that subscribes to the realtime DO at
 *   /api/realtime/estimates?room=admin-workflows:<jobKey>
 *
 * The recent-runs list reads from `GET /api/admin/workflows/:jobKey/runs`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  PauseCircle,
  PlayCircle,
  Rocket,
  Save,
  Radio,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

// ---------------------------------------------------------------------------
// Types — mirror the Hono response payload shapes
// ---------------------------------------------------------------------------

interface ScheduleRow {
  id: number;
  jobKey: string;
  cronExpression: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  description: string | null;
  updatedAt: string | null;
}

interface RunRow {
  id: number;
  jobKey: string;
  workflowInstanceId: string;
  triggerSource: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

interface LiveEvent {
  id: string;
  receivedAt: number;
  type: string;
  workflowInstanceId?: string;
  payload: Record<string, unknown>;
}

interface SchedulesPayload {
  success: boolean;
  schedules: ScheduleRow[];
  error?: string;
}

interface RunsPayload {
  success: boolean;
  runs: RunRow[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminWorkflowsPanel() {
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/workflows/schedules", {
        credentials: "include",
      });
      const payload = (await res.json()) as SchedulesPayload;
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Failed to load schedules");
      }
      setSchedules(payload.schedules);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load schedules",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading workflow schedules…
      </div>
    );
  }

  if (schedules.length === 0) {
    return (
      <p className="py-12 text-sm text-muted-foreground">
        No workflow schedules registered yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {schedules.map((schedule) => (
        <WorkflowScheduleCard
          key={schedule.jobKey}
          schedule={schedule}
          onRefresh={loadSchedules}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One workflow card — edit + run-now + live feed + run history
// ---------------------------------------------------------------------------

function WorkflowScheduleCard({
  schedule,
  onRefresh,
}: {
  schedule: ScheduleRow;
  onRefresh: () => void;
}) {
  const [cronExpression, setCronExpression] = useState(schedule.cronExpression);
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [savingExpression, setSavingExpression] = useState(false);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<"connecting" | "open" | "closed">("connecting");

  const wsRef = useRef<WebSocket | null>(null);

  const room = useMemo(
    () => `admin-workflows:${schedule.jobKey}`,
    [schedule.jobKey],
  );

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/workflows/${encodeURIComponent(schedule.jobKey)}/runs?limit=20`,
        { credentials: "include" },
      );
      const payload = (await res.json()) as RunsPayload;
      if (payload.success) {
        setRuns(payload.runs);
      }
    } catch {
      // non-fatal — run history is a nice-to-have
    }
  }, [schedule.jobKey]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // --- Live WebSocket subscription ---------------------------------------
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/realtime/estimates?room=${encodeURIComponent(room)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setConnectionStatus("connecting");

    ws.onopen = () => setConnectionStatus("open");
    ws.onclose = () => setConnectionStatus("closed");
    ws.onerror = () => setConnectionStatus("closed");
    ws.onmessage = (messageEvent) => {
      try {
        const parsed = JSON.parse(messageEvent.data as string) as {
          type?: string;
          payload?: Record<string, unknown>;
        };
        const payload = parsed.payload ?? {};
        const eventType =
          typeof payload.type === "string"
            ? payload.type
            : parsed.type ?? "event";
        const workflowInstanceId =
          typeof payload.workflowInstanceId === "string"
            ? payload.workflowInstanceId
            : undefined;

        setLiveEvents((prev) => {
          const next: LiveEvent = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            receivedAt: Date.now(),
            type: eventType,
            workflowInstanceId,
            payload,
          };
          return [next, ...prev].slice(0, 50);
        });

        if (eventType === "finished" || eventType === "failed") {
          loadRuns();
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [room, loadRuns]);

  // --- Mutations ----------------------------------------------------------
  const persistCronExpression = async () => {
    setSavingExpression(true);
    try {
      const res = await fetch(
        `/api/admin/workflows/schedules/${encodeURIComponent(schedule.jobKey)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cronExpression }),
        },
      );
      const payload = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Failed to update schedule");
      }
      toast.success("Cron expression saved");
      onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update schedule",
      );
    } finally {
      setSavingExpression(false);
    }
  };

  const persistEnabled = async (nextEnabled: boolean) => {
    setSavingEnabled(true);
    setEnabled(nextEnabled);
    try {
      const res = await fetch(
        `/api/admin/workflows/schedules/${encodeURIComponent(schedule.jobKey)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: nextEnabled }),
        },
      );
      const payload = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Failed to update schedule");
      }
      toast.success(nextEnabled ? "Schedule enabled" : "Schedule paused");
      onRefresh();
    } catch (error) {
      // Revert the optimistic toggle on failure
      setEnabled(!nextEnabled);
      toast.error(
        error instanceof Error ? error.message : "Failed to update schedule",
      );
    } finally {
      setSavingEnabled(false);
    }
  };

  const runNow = async () => {
    setRunningNow(true);
    try {
      const res = await fetch(
        `/api/admin/workflows/${encodeURIComponent(schedule.jobKey)}/run`,
        { method: "POST", credentials: "include" },
      );
      const payload = (await res.json()) as {
        success: boolean;
        workflowInstanceId?: string;
        error?: string;
      };
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Failed to fire workflow");
      }
      toast.success(`Workflow ${payload.workflowInstanceId} queued`);
      await loadRuns();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to fire workflow",
      );
    } finally {
      setRunningNow(false);
    }
  };

  // --- Render -------------------------------------------------------------
  return (
    <Card className="ring-1 ring-border/40">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="size-4 text-muted-foreground" />
              {schedule.jobKey}
            </CardTitle>
            {schedule.description && (
              <p className="pt-1 text-xs font-light text-muted-foreground">
                {schedule.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest">
            <span
              className={
                connectionStatus === "open"
                  ? "text-emerald-400"
                  : connectionStatus === "connecting"
                    ? "text-amber-400"
                    : "text-destructive"
              }
            >
              <Radio className="mr-1 inline size-3" />
              {connectionStatus}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <div className="space-y-1">
            <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Cron expression
            </label>
            <Input
              value={cronExpression}
              onChange={(event) => setCronExpression(event.target.value)}
              placeholder="*/15 * * * *"
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="flex items-end">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs"
              onClick={persistCronExpression}
              disabled={savingExpression || cronExpression === schedule.cronExpression}
            >
              {savingExpression ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <span className="flex items-center gap-1.5 text-xs">
              {enabled ? (
                <PlayCircle className="size-3.5 text-emerald-400" />
              ) : (
                <PauseCircle className="size-3.5 text-muted-foreground" />
              )}
              {enabled ? "Enabled" : "Paused"}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={persistEnabled}
              disabled={savingEnabled}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-[11px] text-muted-foreground sm:grid-cols-4">
          <div>
            <p className="font-mono uppercase tracking-widest text-[10px]">Last run</p>
            <p className="pt-0.5 text-foreground">{formatDate(schedule.lastRunAt)}</p>
          </div>
          <div>
            <p className="font-mono uppercase tracking-widest text-[10px]">Next run</p>
            <p className="pt-0.5 text-foreground">{formatDate(schedule.nextRunAt)}</p>
          </div>
          <div className="sm:col-span-2 sm:text-right">
            <Button
              size="sm"
              className="h-8 gap-1 text-xs font-semibold uppercase tracking-wider"
              onClick={runNow}
              disabled={runningNow}
            >
              {runningNow ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Rocket className="size-3.5" />
              )}
              Run now
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Live progress feed
            </h3>
            <div className="max-h-72 overflow-y-auto rounded-lg bg-background/40 p-3 ring-1 ring-border/20">
              {liveEvents.length === 0 ? (
                <p className="py-6 text-center text-[11px] italic text-muted-foreground">
                  Awaiting events on room <code>{room}</code>…
                </p>
              ) : (
                <ul className="space-y-2">
                  {liveEvents.map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-col gap-0.5 rounded-md bg-card/30 px-2 py-1.5 ring-1 ring-border/20"
                    >
                      <div className="flex items-center justify-between">
                        <Badge className="rounded border-0 bg-primary/10 font-mono text-[9px] uppercase tracking-wider text-primary">
                          {event.type}
                        </Badge>
                        <span className="font-mono text-[9px] text-muted-foreground">
                          {new Date(event.receivedAt).toLocaleTimeString()}
                        </span>
                      </div>
                      {event.workflowInstanceId && (
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {event.workflowInstanceId}
                        </p>
                      )}
                      {Object.keys(event.payload).length > 0 && (
                        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[9px] leading-snug text-muted-foreground/80">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Recent runs ({runs.length})
            </h3>
            <div className="max-h-72 overflow-y-auto rounded-lg bg-background/40 p-3 ring-1 ring-border/20">
              {runs.length === 0 ? (
                <p className="py-6 text-center text-[11px] italic text-muted-foreground">
                  No runs recorded yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {runs.map((run) => (
                    <li
                      key={run.id}
                      className="rounded-md bg-card/30 px-2 py-1.5 ring-1 ring-border/20"
                    >
                      <div className="flex items-center justify-between">
                        <Badge
                          className={
                            "rounded border-0 font-mono text-[9px] uppercase tracking-wider " +
                            statusBadgeClass(run.status)
                          }
                        >
                          {run.status}
                        </Badge>
                        <span className="font-mono text-[9px] text-muted-foreground">
                          {run.triggerSource}
                        </span>
                      </div>
                      <p className="truncate pt-0.5 font-mono text-[10px] text-muted-foreground">
                        {run.workflowInstanceId}
                      </p>
                      <p className="pt-0.5 text-[10px] text-muted-foreground">
                        {formatDate(run.startedAt)}
                        {run.finishedAt && ` → ${formatDate(run.finishedAt)}`}
                      </p>
                      {run.errorMessage && (
                        <p className="pt-0.5 text-[10px] text-destructive">
                          {run.errorMessage}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "success":
      return "bg-emerald-500/10 text-emerald-400";
    case "running":
    case "queued":
      return "bg-sky-500/10 text-sky-300";
    case "failed":
      return "bg-destructive/10 text-destructive";
    default:
      return "bg-muted/30 text-muted-foreground";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}
