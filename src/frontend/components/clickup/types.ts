/**
 * Shared frontend types for the ClickUp integration.
 * These mirror the backend ClickUp client types and D1 schema types,
 * re-exported for use in React components without importing backend code.
 */

// ---------------------------------------------------------------------------
// ClickUp API types (subset used by frontend)
// ---------------------------------------------------------------------------

export interface ClickUpTask {
  id: string;
  custom_id: string | null;
  name: string;
  text_content: string | null;
  description: string | null;
  status: { status: string; type: string; orderindex: number; color: string } | null;
  date_created: string;
  date_updated: string;
  date_closed: string | null;
  due_date: string | null;
  start_date: string | null;
  creator: { id: number; username: string; email: string };
  assignees: { id: number; username: string; email: string }[];
  tags: { name: string; tag_fg: string; tag_bg: string }[];
  priority: { id: string; priority: string; color: string } | null;
  time_estimate: number | null;
  url: string;
  dependencies?: { task_id: string; depends_on: string; type: number }[];
}

// ---------------------------------------------------------------------------
// D1 flag/alert types
// ---------------------------------------------------------------------------

export interface ClickUpTaskFlag {
  id: number;
  clickupTaskId: string;
  flagType: "AI_AUDIT" | "CRITICAL_PATH" | "OVERDUE" | "DEPENDENCY_BLOCKED";
  severity: "info" | "warning" | "critical";
  message: string;
  auditRunId: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ClickUpSystemAlert {
  id: number;
  alertType: "project_delay" | "resource_conflict" | "budget_risk" | "general";
  severity: "critical" | "warning" | "info";
  message: string;
  metadata: string | null;
  auditRunId: string | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Orchestrator state
// ---------------------------------------------------------------------------

export interface OrchestratorStatus {
  lastAuditAt: string | null;
  lastAuditRunId: string | null;
  totalFlagsGenerated: number;
  totalAlertsGenerated: number;
  status: "idle" | "auditing" | "error";
  criticalPathEndDate: string | null;
  tasksAudited: number;
  lastError?: string;
  clickupListId?: string;
}
