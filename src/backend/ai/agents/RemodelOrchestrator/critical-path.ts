/**
 * @fileoverview Critical Path Method (CPM) calculator
 *
 * Builds a DAG from ClickUp tasks using their dependency fields,
 * runs topological sort via Kahn's algorithm, then forward-pass CPM
 * to find:
 *
 * 1. The critical path (longest chain of dependent tasks)
 * 2. The projected end date
 * 3. Tasks that are delayed and causing downstream slip
 *
 * Algorithm:
 * - Parse each task's start_date, due_date, and dependencies
 * - Build adjacency list (task → dependent tasks)
 * - Topological sort via Kahn's algorithm
 * - Forward pass: earliest_finish[t] = earliest_start[t] + duration[t]
 * - Backward pass: latest_start[t] = min(latest_start[dep] - duration[t])
 * - Float = latest_start - earliest_start; critical path = tasks with float === 0
 */

import type { ClickUpTask } from "@backend/services/clickup-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CriticalPathResult {
  /** Tasks on the critical path (float = 0), in execution order. */
  criticalPath: ClickUpTask[];
  /** Projected end date (ISO-8601) based on the longest path. */
  endDate: string;
  /** Tasks that are past due or whose delay pushes downstream work. */
  delayedTasks: ClickUpTask[];
  /** Float (slack) per task ID in days. */
  floatMap: Map<string, number>;
}

interface TaskNode {
  task: ClickUpTask;
  /** Duration in days (derived from start_date → due_date, default 1). */
  duration: number;
  /** Task IDs this task depends ON (predecessors). */
  predecessors: string[];
  /** Task IDs that depend on THIS task (successors). */
  successors: string[];
  /** Earliest start (days from project start). */
  earliestStart: number;
  /** Earliest finish = earliestStart + duration. */
  earliestFinish: number;
  /** Latest start (computed in backward pass). */
  latestStart: number;
  /** Latest finish (computed in backward pass). */
  latestFinish: number;
  /** Float = latestStart - earliestStart. */
  float: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function calculateCriticalPath(tasks: ClickUpTask[]): CriticalPathResult {
  if (tasks.length === 0) {
    return {
      criticalPath: [],
      endDate: new Date().toISOString().slice(0, 10),
      delayedTasks: [],
      floatMap: new Map(),
    };
  }

  const nodes = buildNodes(tasks);
  const sorted = topologicalSort(nodes);

  // Forward pass
  for (const nodeId of sorted) {
    const node = nodes.get(nodeId)!;
    let maxPredFinish = 0;
    for (const predId of node.predecessors) {
      const pred = nodes.get(predId);
      if (pred) {
        maxPredFinish = Math.max(maxPredFinish, pred.earliestFinish);
      }
    }
    node.earliestStart = maxPredFinish;
    node.earliestFinish = node.earliestStart + node.duration;
  }

  // Find project end (max earliest finish)
  let projectEnd = 0;
  for (const node of nodes.values()) {
    projectEnd = Math.max(projectEnd, node.earliestFinish);
  }

  // Backward pass
  for (const node of nodes.values()) {
    node.latestFinish = projectEnd;
    node.latestStart = projectEnd - node.duration;
  }

  for (let i = sorted.length - 1; i >= 0; i--) {
    const node = nodes.get(sorted[i])!;
    for (const predId of node.predecessors) {
      const pred = nodes.get(predId);
      if (pred) {
        pred.latestFinish = Math.min(pred.latestFinish, node.latestStart);
        pred.latestStart = pred.latestFinish - pred.duration;
      }
    }
  }

  // Calculate float and identify critical path
  const criticalPath: ClickUpTask[] = [];
  const floatMap = new Map<string, number>();
  const delayedTasks: ClickUpTask[] = [];
  const now = new Date();

  for (const node of nodes.values()) {
    node.float = node.latestStart - node.earliestStart;
    floatMap.set(node.task.id, node.float);

    if (Math.abs(node.float) < 0.001) {
      criticalPath.push(node.task);
    }

    // Check if task is delayed (past due date and not complete)
    if (
      node.task.due_date &&
      new Date(Number(node.task.due_date)) < now &&
      node.task.status?.status !== "complete" &&
      node.task.status?.status !== "closed"
    ) {
      delayedTasks.push(node.task);
    }
  }

  // Sort critical path by earliest start
  criticalPath.sort((a, b) => {
    const nodeA = nodes.get(a.id)!;
    const nodeB = nodes.get(b.id)!;
    return nodeA.earliestStart - nodeB.earliestStart;
  });

  // Calculate projected end date
  const projectStartDate = findProjectStartDate(tasks);
  const endDate = new Date(projectStartDate);
  endDate.setDate(endDate.getDate() + projectEnd);

  return {
    criticalPath,
    endDate: endDate.toISOString().slice(0, 10),
    delayedTasks,
    floatMap,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildNodes(tasks: ClickUpTask[]): Map<string, TaskNode> {
  const nodes = new Map<string, TaskNode>();
  const taskIds = new Set(tasks.map((t) => t.id));

  // First pass: create nodes
  for (const task of tasks) {
    const duration = calculateDurationDays(task);
    const predecessors = extractPredecessors(task, taskIds);

    nodes.set(task.id, {
      task,
      duration,
      predecessors,
      successors: [],
      earliestStart: 0,
      earliestFinish: 0,
      latestStart: 0,
      latestFinish: 0,
      float: 0,
    });
  }

  // Second pass: build successor links
  for (const [id, node] of nodes) {
    for (const predId of node.predecessors) {
      const pred = nodes.get(predId);
      if (pred) {
        pred.successors.push(id);
      }
    }
  }

  return nodes;
}

function calculateDurationDays(task: ClickUpTask): number {
  if (task.start_date && task.due_date) {
    const startNum = Number(task.start_date);
    const endNum = Number(task.due_date);
    // Guard against non-numeric timestamps — a NaN would propagate through the
    // CPM math and later crash endDate.toISOString() with a RangeError.
    if (!Number.isNaN(startNum) && !Number.isNaN(endNum)) {
      const diffMs = endNum - startNum;
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }
  }
  // Default: 1 day for tasks without (valid) date ranges
  return 1;
}

function extractPredecessors(task: ClickUpTask, validIds: Set<string>): string[] {
  if (!task.dependencies || !Array.isArray(task.dependencies)) return [];

  return task.dependencies
    .filter((dep) => dep.depends_on && validIds.has(dep.depends_on))
    .map((dep) => dep.depends_on);
}

function findProjectStartDate(tasks: ClickUpTask[]): Date {
  let earliest = new Date();

  for (const task of tasks) {
    if (task.start_date) {
      const startNum = Number(task.start_date);
      if (!Number.isNaN(startNum)) {
        const start = new Date(startNum);
        if (start < earliest) earliest = start;
      }
    }
  }

  return earliest;
}

/**
 * Kahn's algorithm for topological sort.
 * Returns task IDs in dependency-safe execution order.
 */
function topologicalSort(nodes: Map<string, TaskNode>): string[] {
  const inDegree = new Map<string, number>();
  for (const [id, node] of nodes) {
    inDegree.set(id, node.predecessors.filter((p) => nodes.has(p)).length);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const node = nodes.get(current)!;
    for (const succId of node.successors) {
      const newDegree = (inDegree.get(succId) || 0) - 1;
      inDegree.set(succId, newDegree);
      if (newDegree === 0) queue.push(succId);
    }
  }

  // If sorted.length < nodes.size, there's a cycle — include remaining nodes
  if (sorted.length < nodes.size) {
    for (const id of nodes.keys()) {
      if (!sorted.includes(id)) sorted.push(id);
    }
  }

  return sorted;
}
