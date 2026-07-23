/**
 * @fileoverview The `WorkItem` contract — 0028 Phase 0.
 *
 * The normalized shape every PMO surface (board, grid, backlog, Gantt, velocity)
 * renders. It exists so the components stay source-blind: a `WorkItem` from the
 * software roadmap (`plan_tasks`) and one from the remodel (`planning_tasks`)
 * are indistinguishable to the view, and adding ClickUp later is a third adapter
 * rather than a rewrite. See `docs/0028_project_management/IMPLEMENTATION_PLAN.md`.
 *
 * Lives under `src/shared` — resolved by `@/*` → `src/*` — so backend adapters
 * and frontend islands import ONE definition. Do not fork it per side.
 */

/** Which underlying table an item came from. Never parsed for meaning by a view. */
export type WorkSource = "plan" | "planning" | "clickup";

/**
 * Delivery state. This is the axis a board columns on and a status badge shows.
 * Deliberately a superset of both source enums so the mapping is total — see
 * `WORK_STATUSES` and the adapters for how each source maps in.
 */
export type WorkStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "blocked"
  | "deferred"
  | "done";

export const WORK_STATUSES: readonly WorkStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "deferred",
  "done",
] as const;

/**
 * Health — an INDEPENDENT axis from status. A task can be `in_progress` and
 * `at_risk` at once. Always DERIVED at read time (blocked status, a past due
 * date, a late dependency), never stored: a stored health column goes stale the
 * moment a date passes.
 */
export type WorkHealth = "on_track" | "at_risk" | "blocked" | "unknown";

export type WorkPriority = "urgent" | "high" | "medium" | "low";

/** A person attached to a work item, resolved by JOIN — never a denormalized name. */
export interface WorkPerson {
  participantId: number;
  displayName: string;
  /** owner drives it, assignee does it, cc is kept informed, approver signs off. */
  role: "owner" | "assignee" | "cc" | "approver";
  /** Whether this person may edit the item. Enforcement is stubbed in P0 (see viewer.ts). */
  canEdit: boolean;
}

/** A typed outbound link from a work item to another entity in the system. */
export interface WorkLink {
  kind: "pr" | "changelog" | "room" | "material" | "budget" | "shipment" | "url";
  /** Human label, resolved by JOIN where the target is a row. */
  label: string;
  /** Href when the link is navigable in-app or out. */
  href?: string;
  /** The target row's id, when the link points at one. */
  refId?: string | number;
}

export interface WorkItem {
  source: WorkSource;
  /** Stable composite id: `${source}:${nativeId}`. Opaque — never split for meaning. */
  id: string;
  /** The row's own primary key within its source table, as a string. */
  nativeId: string;
  /** Human key shown to users: "P1-NAV-01" (plan) or a slug (planning). */
  key: string;
  /** The grouping container: plan slug, epic id, or clickup list id. */
  containerKey: string;
  /** One level of nesting only, per the prototypes. Null at the top level. */
  parentId: string | null;
  title: string;
  description: string | null;
  /** Workstream (software) or epic/room label (remodel). The board/grid group-by. */
  groupLabel: string;
  /** Phase ordinal, or null for sources without phases. */
  phase: number | null;
  status: WorkStatus;
  /** Derived, never stored. */
  health: WorkHealth;
  priority: WorkPriority | null;
  /** 0–100. Null renders as "-", which is distinct from 0. */
  progressPct: number | null;
  effortPoints: number | null;
  /** ISO date (YYYY-MM-DD) or null. */
  startAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  /** Other items' `key` values this depends on. */
  dependsOn: string[];
  people: WorkPerson[];
  links: WorkLink[];
  sortOrder: number;
  /** ISO datetime of the last update, for polling/ordering. */
  updatedAt: string;
}

/**
 * The fields a caller may PATCH through the source-agnostic write endpoint. Every
 * field is optional; only the ones supplied are changed. The adapter for the
 * owning source decides which it can honor.
 */
export interface WorkItemPatch {
  status?: WorkStatus;
  priority?: WorkPriority | null;
  progressPct?: number | null;
  startAt?: string | null;
  dueAt?: string | null;
  sortOrder?: number;
  notes?: string | null;
}

/** Query filters accepted by the read endpoint. All optional; all narrowing. */
export interface WorkItemQuery {
  source?: WorkSource;
  container?: string;
  status?: WorkStatus;
  health?: WorkHealth;
  phase?: number;
  assigneeParticipantId?: number;
}

/**
 * Derive health from an item's own facts. Kept here, not in an adapter, so both
 * sources compute it identically.
 *
 * @param today ISO date used as "now", injected so the result is testable and
 *              so a Worker request that spans midnight is internally consistent.
 * @param lateDependency whether any item this one depends on is itself late.
 */
export function deriveHealth(
  item: Pick<WorkItem, "status" | "dueAt">,
  today: string,
  lateDependency = false,
): WorkHealth {
  if (item.status === "blocked") return "blocked";
  if (item.status === "done") return "on_track";
  if (lateDependency) return "at_risk";
  if (item.dueAt && item.dueAt < today) return "at_risk";
  return "on_track";
}

/** `${source}:${nativeId}` — the one place the composite id is formed. */
export function workItemId(source: WorkSource, nativeId: string | number): string {
  return `${source}:${nativeId}`;
}

/** Inverse of {@link workItemId}. Splits on the FIRST colon only — ids may contain colons. */
export function parseWorkItemId(id: string): { source: WorkSource; nativeId: string } {
  const idx = id.indexOf(":");
  if (idx === -1) throw new Error(`Malformed WorkItem id: ${id}`);
  return { source: id.slice(0, idx) as WorkSource, nativeId: id.slice(idx + 1) };
}
