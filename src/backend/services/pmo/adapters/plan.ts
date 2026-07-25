/**
 * @fileoverview `plan_tasks` → `WorkItem` adapter (source: "plan") — 0028 P0.
 *
 * The software roadmap. Maps a `plan_tasks` row onto the normalized shape, with
 * the assignee's display name resolved by JOIN to `planning_participants` (never
 * a denormalized name column) and PR / changelog links derived from the row's
 * own columns.
 */
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";

import { planningParticipants } from "@backend/db/schema/home/planning_participants";
import { planTasks } from "@backend/db/schema/plans/index";
import { workItemWatchers } from "@backend/db/schema/plans/index";
import type { RemodelDb } from "@backend/mcp/types";
import {
  deriveHealth,
  workItemId,
  type WorkHealth,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemQuery,
  type WorkLink,
  type WorkPerson,
  type WorkPriority,
  type WorkStatus,
} from "@/shared/pmo/types";
import type { WorkItemAdapter } from "../adapter";

/** `plan_tasks.status` → `WorkStatus`. `pending` is the roadmap's "todo". */
const STATUS_IN: Record<string, WorkStatus> = {
  pending: "todo",
  in_progress: "in_progress",
  in_review: "in_review",
  blocked: "blocked",
  deferred: "deferred",
  done: "done",
};

/** `WorkStatus` → `plan_tasks.status`. Inverse of {@link STATUS_IN}. */
const STATUS_OUT: Record<WorkStatus, string> = {
  backlog: "pending",
  todo: "pending",
  in_progress: "in_progress",
  in_review: "in_review",
  blocked: "blocked",
  deferred: "deferred",
  done: "done",
};

type PlanTaskRow = typeof planTasks.$inferSelect;

function toWorkItem(
  row: PlanTaskRow,
  assigneeName: string | null,
  today: string,
): WorkItem {
  const status = STATUS_IN[row.status] ?? "todo";
  const dueAt = row.dueDate ?? null;
  const health: WorkHealth = deriveHealth({ status, dueAt }, today);

  const people: WorkPerson[] = [];
  if (row.assigneeParticipantId != null && assigneeName) {
    people.push({
      participantId: row.assigneeParticipantId,
      displayName: assigneeName,
      role: "assignee",
      canEdit: true,
    });
  }

  const links: WorkLink[] = [];
  if (row.prNumber != null) {
    links.push({
      kind: "pr",
      label: `PR #${row.prNumber}`,
      href: `https://github.com/jmbish04/core-remodel/pull/${row.prNumber}`,
      refId: row.prNumber,
    });
  }
  if (row.changelogSlug) {
    links.push({
      kind: "changelog",
      label: "Changelog",
      href: `/admin/changelog/${row.changelogSlug}`,
      refId: row.changelogSlug,
    });
  }
  if (row.targetRoute) {
    links.push({ kind: "url", label: row.targetRoute, href: row.targetRoute });
  }

  return {
    source: "plan",
    id: workItemId("plan", row.id),
    nativeId: String(row.id),
    key: row.taskKey,
    containerKey: row.planSlug,
    parentId: null,
    title: row.title,
    description: row.description ?? null,
    groupLabel: row.workstream,
    phase: row.phase,
    status,
    health,
    priority: (row.priority as WorkPriority | null) ?? null,
    progressPct: row.progressPct ?? null,
    effortPoints: row.effortPoints ?? null,
    startAt: row.startDate ?? null,
    dueAt,
    completedAt: row.status === "done" ? row.updatedAt.toISOString().slice(0, 10) : null,
    dependsOn: Array.isArray(row.dependsOn) ? row.dependsOn : [],
    people,
    links,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Resolve assignee names for a batch of rows in ONE query (no N+1). */
async function assigneeNames(
  db: RemodelDb,
  rows: PlanTaskRow[],
): Promise<Map<number, string>> {
  const ids = [...new Set(rows.map((r) => r.assigneeParticipantId).filter((x): x is number => x != null))];
  if (ids.length === 0) return new Map();
  const people = await db
    .select({ id: planningParticipants.id, name: planningParticipants.displayName })
    .from(planningParticipants)
    .where(inArray(planningParticipants.id, ids));
  return new Map(people.map((p) => [p.id, p.name]));
}

export const planAdapter: WorkItemAdapter = {
  source: "plan",

  async list(db, query, today) {
    const conditions: SQL[] = [];
    if (query.container) conditions.push(eq(planTasks.planSlug, query.container));
    if (query.phase != null) conditions.push(eq(planTasks.phase, query.phase));
    if (query.assigneeParticipantId != null)
      conditions.push(eq(planTasks.assigneeParticipantId, query.assigneeParticipantId));
    // `status`/`health` are WorkItem-space (health is derived), so they cannot be
    // pushed into SQL cleanly; filter them in memory after mapping.

    const rows = await db
      .select()
      .from(planTasks)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(planTasks.phase), asc(planTasks.sortOrder));

    const names = await assigneeNames(db, rows);
    let items = rows.map((r) => toWorkItem(r, r.assigneeParticipantId != null ? names.get(r.assigneeParticipantId) ?? null : null, today));

    if (query.status) items = items.filter((i) => i.status === query.status);
    if (query.health) items = items.filter((i) => i.health === query.health);
    return items;
  },

  async get(db, nativeId, today) {
    const id = Number(nativeId);
    if (!Number.isInteger(id)) return null;
    const [row] = await db.select().from(planTasks).where(eq(planTasks.id, id)).limit(1);
    if (!row) return null;
    const names = await assigneeNames(db, [row]);
    return toWorkItem(row, row.assigneeParticipantId != null ? names.get(row.assigneeParticipantId) ?? null : null, today);
  },

  async patch(db, nativeId, patch, today) {
    const id = Number(nativeId);
    if (!Number.isInteger(id)) return null;

    const update: Partial<PlanTaskRow> = {};
    if (patch.status !== undefined) update.status = STATUS_OUT[patch.status] as PlanTaskRow["status"];
    if (patch.priority !== undefined) update.priority = patch.priority;
    if (patch.progressPct !== undefined) update.progressPct = patch.progressPct;
    if (patch.startAt !== undefined) update.startDate = patch.startAt;
    if (patch.dueAt !== undefined) update.dueDate = patch.dueAt;
    if (patch.sortOrder !== undefined) update.sortOrder = patch.sortOrder;
    if (patch.notes !== undefined) update.notes = patch.notes;

    // Nothing to change → return the current item rather than writing a no-op.
    if (Object.keys(update).length > 0) {
      update.updatedAt = new Date();
      await db.update(planTasks).set(update).where(eq(planTasks.id, id));
    }
    return this.get(db, nativeId, today);
  },
};

/** Exported for the watcher-attach tool + visibility filter (P0 seam). */
export { workItemWatchers };
