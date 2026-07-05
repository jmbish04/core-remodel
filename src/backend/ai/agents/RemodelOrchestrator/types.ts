/**
 * Agent state for the RemodelOrchestrator Durable Object.
 */
export interface RemodelOrchestratorState {
  /** ISO-8601 timestamp of the last completed audit. */
  lastAuditAt: string | null;

  /** UUID of the last audit run. */
  lastAuditRunId: string | null;

  /** Number of AI/algo flags generated in the last audit. */
  totalFlagsGenerated: number;

  /** Number of system alerts generated in the last audit. */
  totalAlertsGenerated: number;

  /** Current agent status. */
  status: "idle" | "auditing" | "error";

  /** Projected end date from the last critical path calculation. */
  criticalPathEndDate: string | null;

  /** The ClickUp List ID to audit. Set via configureList(). */
  clickupListId?: string;

  /** Number of tasks audited in the last run. */
  tasksAudited: number;

  /** Error message if the last audit failed. */
  lastError?: string;
}

export const DEFAULT_ORCHESTRATOR_STATE: RemodelOrchestratorState = {
  lastAuditAt: null,
  lastAuditRunId: null,
  totalFlagsGenerated: 0,
  totalAlertsGenerated: 0,
  status: "idle",
  criticalPathEndDate: null,
  tasksAudited: 0,
};
