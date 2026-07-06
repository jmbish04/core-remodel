/**
 * @fileoverview ClickUp Tasks Page
 *
 * Top-level page component for the ClickUp task management view.
 * Features:
 * - System alert banner (critical path warnings)
 * - Orchestrator status badge with manual trigger
 * - View toggle: Kanban ↔ Gantt
 * - Filters: status, priority, tags, flag type
 * - Create task FAB
 */

import {
  AlertCircle,
  Bot,
  CalendarRange,
  CheckCircle2,
  Filter,
  Kanban,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { ClickUpGantt } from "./ClickUpGantt";
import { ClickUpKanban } from "./ClickUpKanban";
import { ClickUpTaskModal } from "./ClickUpTaskModal";
import type {
  ClickUpSystemAlert,
  ClickUpTask,
  ClickUpTaskFlag,
  OrchestratorStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Config — stored in localStorage
// ---------------------------------------------------------------------------

const STORAGE_KEY = "clickup-tasks-config";

function getStoredConfig(): { view: "kanban" | "gantt"; listId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { view: "kanban", listId: "" };
}

function setStoredConfig(config: { view: string; listId: string }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ---------------------------------------------------------------------------
// Alert Banner
// ---------------------------------------------------------------------------

function SystemAlertBanner({
  alerts,
  onAcknowledge,
}: {
  alerts: ClickUpSystemAlert[];
  onAcknowledge: (id: number) => void;
}) {
  const active = alerts.filter((a) => !a.acknowledged);
  if (active.length === 0) return null;

  return (
    <div className="space-y-2">
      {active.map((alert) => (
        <div
          key={alert.id}
          className={cn(
            "flex items-start gap-3 rounded-lg border px-4 py-3",
            alert.severity === "critical"
              ? "border-red-500/30 bg-red-950/20"
              : "border-amber-500/30 bg-amber-950/20",
          )}
        >
          <AlertCircle
            className={cn(
              "mt-0.5 h-5 w-5 shrink-0",
              alert.severity === "critical"
                ? "text-red-400"
                : "text-amber-400",
            )}
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-zinc-200">
              {alert.message}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {new Date(alert.createdAt).toLocaleString()}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAcknowledge(alert.id)}
            className="text-xs text-zinc-500"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orchestrator Status Badge
// ---------------------------------------------------------------------------

function OrchestratorBadge({
  status,
  onTrigger,
}: {
  status: OrchestratorStatus | null;
  onTrigger: () => void;
}) {
  if (!status) return null;

  const isAuditing = status.status === "auditing";

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5">
      <Bot className="h-4 w-4 text-zinc-500" />
      <div className="text-xs">
        <span className="text-zinc-400">Orchestrator: </span>
        {isAuditing ? (
          <span className="text-blue-400">Auditing...</span>
        ) : status.lastAuditAt ? (
          <span className="text-zinc-500">
            Last audit{" "}
            {new Date(status.lastAuditAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" · "}
            {status.totalFlagsGenerated} flags
          </span>
        ) : (
          <span className="text-zinc-600">Never run</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onTrigger}
        disabled={isAuditing}
        className="ml-1 h-6 px-2 text-xs"
      >
        {isAuditing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          "Run Audit"
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export function ClickUpTasksPage() {
  const [config, setConfig] = useState(getStoredConfig);
  const [tasks, setTasks] = useState<ClickUpTask[]>([]);
  const [flags, setFlags] = useState<ClickUpTaskFlag[]>([]);
  const [alerts, setAlerts] = useState<ClickUpSystemAlert[]>([]);
  const [orchestratorStatus, setOrchestratorStatus] =
    useState<OrchestratorStatus | null>(null);

  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedTask, setSelectedTask] = useState<ClickUpTask | null>(null);

  // List ID prompt state
  const [listIdInput, setListIdInput] = useState(config.listId);

  // Connection status
  const [connectionStatus, setConnectionStatus] = useState<
    "checking" | "connected" | "error"
  >("checking");
  const [connectionError, setConnectionError] = useState("");
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // ── Data fetching ─────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!config.listId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [tasksRes, flagsRes, alertsRes, statusRes] = await Promise.all([
        fetch(`/api/clickup/tasks?list_id=${config.listId}&include_closed=true`),
        fetch("/api/clickup/flags"),
        fetch("/api/clickup/alerts"),
        fetch("/api/clickup/orchestrator/status").catch(() => null),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks((data as any).tasks || []);
        setConnectionStatus("connected");
        setLastSyncTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      }

      if (flagsRes.ok) {
        const data = await flagsRes.json();
        setFlags((data as any).flags || []);
      }

      if (alertsRes.ok) {
        const data = await alertsRes.json();
        setAlerts((data as any).alerts || []);
      }

      if (statusRes?.ok) {
        const data = await statusRes.json();
        setOrchestratorStatus((data as any).status || null);
      }
    } catch (err) {
      toast.error("Failed to fetch tasks from ClickUp");
      setConnectionStatus("error");
      setConnectionError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }, [config.listId]);

  useEffect(() => {
    // If we already have a stored list ID, fetch tasks immediately
    if (config.listId) {
      fetchData();
      return;
    }

    // Otherwise, fetch the default list ID from the backend env var
    fetch("/api/clickup/config")
      .then((r) => r.json())
      .then((data: any) => {
        const defaultId = data?.defaultListId;
        if (defaultId) {
          const newConfig = { ...config, listId: defaultId };
          setConfig(newConfig);
          setStoredConfig(newConfig);
          setListIdInput(defaultId);
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch tasks when listId changes
  useEffect(() => {
    if (config.listId) fetchData();
  }, [config.listId, fetchData]);

  // Verify ClickUp connection on mount
  useEffect(() => {
    if (!config.listId) return;
    setConnectionStatus("checking");

    fetch(`/api/clickup/tasks?list_id=${config.listId}&page=0`)
      .then((r) => {
        if (r.ok) {
          setConnectionStatus("connected");
          setLastSyncTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        } else {
          r.json().then((d: any) => {
            setConnectionStatus("error");
            setConnectionError(d?.detail || d?.error || `HTTP ${r.status}`);
          }).catch(() => {
            setConnectionStatus("error");
            setConnectionError(`HTTP ${r.status}`);
          });
        }
      })
      .catch(() => {
        setConnectionStatus("error");
        setConnectionError("Network error — cannot reach Worker");
      });
  }, [config.listId]);

  // ── Handlers ──────────────────────────────────────────────────

  const handleViewChange = (view: "kanban" | "gantt") => {
    const newConfig = { ...config, view };
    setConfig(newConfig);
    setStoredConfig(newConfig);
  };

  const handleSetListId = () => {
    if (!listIdInput.trim()) return;
    const newConfig = { ...config, listId: listIdInput.trim() };
    setConfig(newConfig);
    setStoredConfig(newConfig);
    toast.success("ClickUp List ID saved");
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/clickup/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: { ...t.status!, status: newStatus } }
            : t,
        ),
      );
      toast.success(`Status → ${newStatus}`);
    } catch {
      toast.error("Failed to update task status");
    }
  };

  const handleDateChange = async (
    taskId: string,
    startDate: number,
    endDate: number,
  ) => {
    try {
      await fetch(`/api/clickup/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: startDate,
          due_date: endDate,
        }),
      });
      toast.success("Dates updated");
      fetchData();
    } catch {
      toast.error("Failed to update dates");
    }
  };

  const handleTaskClick = (task: ClickUpTask) => {
    setSelectedTask(task);
    setModalMode("edit");
    setModalOpen(true);
  };

  const handleCreateClick = () => {
    setSelectedTask(null);
    setModalMode("create");
    setModalOpen(true);
  };

  const handleTriggerAudit = async () => {
    try {
      toast.info("Triggering audit...");
      await fetch("/api/clickup/orchestrator/trigger", { method: "POST" });
      toast.success("Audit cycle triggered");
      // Refresh after a short delay to let the audit run
      setTimeout(fetchData, 3000);
    } catch {
      toast.error("Failed to trigger audit");
    }
  };

  const handleAcknowledgeAlert = async (alertId: number) => {
    try {
      await fetch(`/api/clickup/alerts/${alertId}/acknowledge`, {
        method: "POST",
      });
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alertId ? { ...a, acknowledged: true } : a,
        ),
      );
    } catch {
      toast.error("Failed to acknowledge alert");
    }
  };

  const handleSaveTask = () => {
    fetchData();
  };

  // ── Filtered tasks ────────────────────────────────────────────

  const filteredTasks = searchQuery
    ? tasks.filter((t) =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : tasks;

  // ── List ID setup screen ──────────────────────────────────────

  if (!config.listId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md border-zinc-800 bg-zinc-950">
          <CardContent className="space-y-4 p-6">
            <div className="text-center">
              <Kanban className="mx-auto mb-3 h-10 w-10 text-zinc-500" />
              <h2 className="text-lg font-semibold text-zinc-100">
                Connect ClickUp List
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Enter your ClickUp List ID to start managing tasks. You can find
                this in your ClickUp list URL.
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                value={listIdInput}
                onChange={(e) => setListIdInput(e.target.value)}
                placeholder="e.g., 900000000000"
                className="bg-zinc-900"
              />
              <Button onClick={handleSetListId}>Connect</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────

  return (
    <div className="space-y-4 p-4">
      {/* System alerts */}
      <SystemAlertBanner
        alerts={alerts}
        onAcknowledge={handleAcknowledgeAlert}
      />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-zinc-100">Tasks</h1>
          <Badge variant="secondary" className="bg-zinc-800 text-xs">
            {filteredTasks.length} tasks
          </Badge>
          {/* Connection indicator */}
          {connectionStatus === "checking" ? (
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Syncing with ClickUp...
            </div>
          ) : connectionStatus === "connected" ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-500">
              <CheckCircle2 className="h-3 w-3" />
              Connected{lastSyncTime ? ` · ${lastSyncTime}` : ""}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <WifiOff className="h-3 w-3" />
              <span className="max-w-[200px] truncate" title={connectionError}>
                {connectionError || "Disconnected"}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <OrchestratorBadge
            status={orchestratorStatus}
            onTrigger={handleTriggerAudit}
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 md:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks..."
            className="bg-zinc-900 pl-9"
          />
        </div>

        {/* View toggle */}
        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewChange("kanban")}
            className={cn(
              "rounded-r-none",
              config.view === "kanban" && "bg-zinc-800 text-zinc-100",
            )}
          >
            <Kanban className="mr-1.5 h-4 w-4" />
            Kanban
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewChange("gantt")}
            className={cn(
              "rounded-l-none",
              config.view === "gantt" && "bg-zinc-800 text-zinc-100",
            )}
          >
            <CalendarRange className="mr-1.5 h-4 w-4" />
            Gantt
          </Button>
        </div>

        {/* Actions */}
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          disabled={loading}
        >
          <RefreshCcw
            className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")}
          />
          Refresh
        </Button>

        <Button size="sm" onClick={handleCreateClick}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Task
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      ) : config.view === "kanban" ? (
        <ClickUpKanban
          tasks={filteredTasks}
          flags={flags}
          onStatusChange={handleStatusChange}
          onTaskClick={handleTaskClick}
        />
      ) : (
        <ClickUpGantt
          tasks={filteredTasks}
          flags={flags}
          onDateChange={handleDateChange}
          onTaskClick={handleTaskClick}
        />
      )}

      {/* Task modal */}
      <ClickUpTaskModal
        task={selectedTask}
        flags={
          selectedTask
            ? flags.filter((f) => f.clickupTaskId === selectedTask.id)
            : []
        }
        isOpen={modalOpen}
        mode={modalMode}
        listId={config.listId}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveTask}
      />
    </div>
  );
}
