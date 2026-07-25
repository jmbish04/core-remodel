/**
 * @fileoverview `planning_tasks` → `WorkItem` adapter (source: "planning") — 0028 P0.
 *
 * The remodel side. Maps a `planning_tasks` row onto the normalized shape:
 * the RACI participants become `WorkPerson[]` (owner → owner, responsible →
 * assignee, accountable → approver), the epic title is the group label, and the
 * room becomes a `WorkLink`. All display names resolved by JOIN — no
 * denormalized columns.
 */
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";

import { planningEpics } from "@backend/db/schema/home/planning_epics";
import { planningParticipants } from "@backend/db/schema/home/planning_participants";
import { planningTasks } from "@backend/db/schema/home/planning_tasks";
import { rooms } from "@backend/db/schema/home/rooms";
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

/** `planning_tasks.status` → `WorkStatus`. `delayed` is this side's "deferred". */
const STATUS_IN: Record<string, WorkStatus> = {
  pending: "todo",
  in_progress: "in_progress",
  blocked: "blocked",
  delayed: "deferred",
  done: "done",
};

/** `WorkStatus` → `planning_tasks.status`. `in_review` has no counterpart → in_progress. */
const STATUS_OUT: Record<WorkStatus, string> = {
  backlog: "pending",
  todo: "pending",
  in_progress: "in_progress",
  in_review: "in_progress",
  blocked: "blocked",
  deferred: "delayed",
  done: "done",
};

/** planning_tasks priority is an int (1 high, 2 medium, 3 low). No "urgent". */
const PRIORITY_IN: Record<number, WorkPriority> = { 1: "high", 2: "medium", 3: "low" };
const PRIORITY_OUT: Record<WorkPriority, number> = { urgent: 1, high: 1, medium: 2, low: 3 };

type PlanningTaskRow = typeof planningTasks.$inferSelect;

interface Resolved {
  epicTitle: string | null;
  roomName: string | null;
  names: Map<number, string>;
}

function parseIds(json: string | null): number[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function parseStrings(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function toWorkItem(row: PlanningTaskRow, r: Resolved, today: string): WorkItem {
  const status = STATUS_IN[row.status] ?? "todo";
  const dueAt = row.dueDate ?? null;
  const health: WorkHealth = deriveHealth({ status, dueAt }, today);

  const people: WorkPerson[] = [];
  const addPerson = (id: number | null, role: WorkPerson["role"]) => {
    if (id == null) return;
    const name = r.names.get(id);
    if (name) people.push({ participantId: id, displayName: name, role, canEdit: true });
  };
  addPerson(row.ownerParticipantId, "owner");
  addPerson(row.responsibleParticipantId, "assignee");
  addPerson(row.accountableParticipantId, "approver");
  for (const id of [...parseIds(row.consultedParticipantIds), ...parseIds(row.informedParticipantIds)]) {
    addPerson(id, "cc");
  }

  const links: WorkLink[] = [];
  if (row.roomId != null && r.roomName) {
    links.push({ kind: "room", label: r.roomName, refId: row.roomId });
  }

  return {
    source: "planning",
    id: workItemId("planning", row.id),
    nativeId: row.id,
    key: row.slug,
    containerKey: row.epicId,
    parentId: null,
    title: row.title,
    description: row.description ?? null,
    groupLabel: r.epicTitle ?? "General",
    phase: null,
    status,
    health,
    priority: PRIORITY_IN[row.priority] ?? null,
    progressPct: null,
    effortPoints: null,
    startAt: row.startDate ?? null,
    dueAt,
    completedAt: row.status === "done" ? row.datetimeUpdated.toISOString().slice(0, 10) : null,
    // These are task ids, not slugs — the Gantt dependency pass (P1) resolves them.
    dependsOn: parseStrings(row.dependsOnTaskIds),
    people,
    links,
    sortOrder: row.taskOrder,
    updatedAt: row.datetimeUpdated.toISOString(),
  };
}

/** Batch-resolve epic titles, room names and participant names for a set of rows. */
async function resolveFor(db: RemodelDb, rows: PlanningTaskRow[]): Promise<Map<string, Resolved>> {
  const epicIds = [...new Set(rows.map((r) => r.epicId))];
  const roomIds = [...new Set(rows.map((r) => r.roomId).filter((x): x is number => x != null))];
  const participantIds = [
    ...new Set(
      rows.flatMap((r) => [
        r.ownerParticipantId,
        r.responsibleParticipantId,
        r.accountableParticipantId,
        ...parseIds(r.consultedParticipantIds),
        ...parseIds(r.informedParticipantIds),
      ]),
    ),
  ].filter((x): x is number => x != null);

  const [epics, roomRows, people] = await Promise.all([
    epicIds.length
      ? db.select({ id: planningEpics.id, title: planningEpics.title }).from(planningEpics).where(inArray(planningEpics.id, epicIds))
      : Promise.resolve([]),
    roomIds.length
      ? db.select({ id: rooms.id, name: rooms.roomName }).from(rooms).where(inArray(rooms.id, roomIds))
      : Promise.resolve([]),
    participantIds.length
      ? db.select({ id: planningParticipants.id, name: planningParticipants.displayName }).from(planningParticipants).where(inArray(planningParticipants.id, participantIds))
      : Promise.resolve([]),
  ]);

  const epicTitle = new Map(epics.map((e) => [e.id, e.title]));
  const roomName = new Map(roomRows.map((r) => [r.id, r.name]));
  const names = new Map(people.map((p) => [p.id, p.name]));

  return new Map(
    rows.map((row) => [
      row.id,
      {
        epicTitle: epicTitle.get(row.epicId) ?? null,
        roomName: row.roomId != null ? roomName.get(row.roomId) ?? null : null,
        names,
      },
    ]),
  );
}

export const planningAdapter: WorkItemAdapter = {
  source: "planning",

  async list(db, query, today) {
    const conditions: SQL[] = [];
    if (query.container) conditions.push(eq(planningTasks.epicId, query.container));
    if (query.assigneeParticipantId != null)
      conditions.push(eq(planningTasks.responsibleParticipantId, query.assigneeParticipantId));

    const rows = await db
      .select()
      .from(planningTasks)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(planningTasks.taskOrder));

    const resolved = await resolveFor(db, rows);
    let items = rows.map((r) => toWorkItem(r, resolved.get(r.id)!, today));
    if (query.status) items = items.filter((i) => i.status === query.status);
    if (query.health) items = items.filter((i) => i.health === query.health);
    return items;
  },

  async get(db, nativeId, today) {
    const [row] = await db.select().from(planningTasks).where(eq(planningTasks.id, nativeId)).limit(1);
    if (!row) return null;
    const resolved = await resolveFor(db, [row]);
    return toWorkItem(row, resolved.get(row.id)!, today);
  },

  async patch(db, nativeId, patch, today) {
    const update: Partial<PlanningTaskRow> = {};
    if (patch.status !== undefined) update.status = STATUS_OUT[patch.status];
    if (patch.priority !== undefined) update.priority = patch.priority ? PRIORITY_OUT[patch.priority] : 2;
    if (patch.startAt !== undefined) update.startDate = patch.startAt;
    if (patch.dueAt !== undefined) update.dueDate = patch.dueAt;
    if (patch.sortOrder !== undefined) update.taskOrder = patch.sortOrder;
    // progressPct/notes have no column on planning_tasks — silently ignored, per
    // the adapter contract (a caller cannot know which source it is patching).

    if (Object.keys(update).length > 0) {
      update.datetimeUpdated = new Date();
      await db.update(planningTasks).set(update).where(eq(planningTasks.id, nativeId));
    }
    return this.get(db, nativeId, today);
  },
};
