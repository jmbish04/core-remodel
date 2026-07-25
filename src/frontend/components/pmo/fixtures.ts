/**
 * @fileoverview Fixture WorkItems for the PMO component gallery — 0028 P1.
 *
 * Hand-built so every atom and state has something to render against, without
 * needing D1: a card with everyone, a card with nobody, a blocked one, an
 * overdue one, a done one, and a spread of priorities and progress values.
 */
import { deriveHealth, workItemId, type WorkItem, type WorkPerson } from "@/shared/pmo/types";

const TODAY = "2026-07-23";

const PEOPLE: WorkPerson[] = [
  { participantId: 1, displayName: "Maya Okafor", role: "owner", canEdit: true },
  { participantId: 2, displayName: "James Lin", role: "assignee", canEdit: true },
  { participantId: 3, displayName: "Riya Patel", role: "cc", canEdit: false },
  { participantId: 4, displayName: "Dani Kim", role: "approver", canEdit: true },
];

let seq = 100;
function make(partial: Partial<WorkItem> & Pick<WorkItem, "title" | "status">): WorkItem {
  const nativeId = String(seq++);
  const base: WorkItem = {
    source: "plan",
    id: workItemId("plan", nativeId),
    nativeId,
    key: `DEMO-${nativeId}`,
    containerKey: "demo",
    parentId: null,
    description: null,
    groupLabel: "demo",
    phase: 1,
    health: "on_track",
    priority: null,
    progressPct: null,
    effortPoints: null,
    startAt: null,
    dueAt: null,
    completedAt: null,
    dependsOn: [],
    people: [],
    links: [],
    sortOrder: 0,
    updatedAt: `${TODAY}T12:00:00Z`,
    ...partial,
  };
  return { ...base, health: deriveHealth(base, TODAY) };
}

export const FIXTURE_ITEMS: WorkItem[] = [
  make({
    title: "Smart intake routing for inbound leads",
    description: "Classify and route new customer signals to the right workstream automatically.",
    status: "in_progress",
    priority: "high",
    progressPct: 34,
    groupLabel: "intake",
    people: [PEOPLE[0], PEOPLE[1]],
    dependsOn: ["DEMO-98"],
  }),
  make({
    title: "Custom report builder",
    description: "Let admins compose their own reports from the metric catalogue.",
    status: "in_review",
    priority: "medium",
    progressPct: 78,
    groupLabel: "reports",
    people: [PEOPLE[1], PEOPLE[2], PEOPLE[3]],
  }),
  make({
    title: "Entitlement rules engine",
    status: "blocked",
    priority: "urgent",
    progressPct: 38,
    groupLabel: "billing",
    people: [PEOPLE[3]],
  }),
  make({
    title: "Renewal timeline view — overdue",
    status: "in_progress",
    priority: "high",
    progressPct: 22,
    dueAt: "2026-07-01",
    groupLabel: "lifecycle",
    people: [],
  }),
  make({
    title: "Dark mode",
    status: "done",
    priority: "low",
    progressPct: 100,
    groupLabel: "platform",
    people: [PEOPLE[0]],
  }),
  make({
    title: "Outbound webhooks",
    status: "todo",
    priority: "medium",
    progressPct: null,
    groupLabel: "platform",
    people: [PEOPLE[2]],
  }),
  make({
    title: "Policy-based permissions",
    status: "backlog",
    groupLabel: "security",
    people: [PEOPLE[0], PEOPLE[1], PEOPLE[2], PEOPLE[3]],
  }),
];
