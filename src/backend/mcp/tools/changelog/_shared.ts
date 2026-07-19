/**
 * @fileoverview Shared bits for the `changelog` tool domain (feature proposals).
 */
import { z } from "zod";

/** Lifecycle of a proposal, mirroring `changelog_proposals.status`. */
export const PROPOSAL_STATUSES = [
  "proposed",
  "accepted",
  "in_progress",
  "shipped",
  "rejected",
] as const;

/**
 * One TASKS.json row. These land in the EXISTING `plan_tasks` table and render at
 * /admin/plans — there is deliberately no second task table.
 */
export const taskShape = z.object({
  taskKey: z.string().min(1).describe("Stable key, unique within the plan, e.g. 'P1-API-01'"),
  title: z.string().min(1).describe("Short imperative task title"),
  description: z.string().optional().describe("What done looks like"),
  workstream: z.string().optional().describe("Grouping label, e.g. 'api', 'frontend' (default 'general')"),
  phase: z.number().int().min(0).optional().describe("Phase ordinal (0 = first)"),
  targetRoute: z.string().optional().describe("Route this task establishes or changes"),
  changeType: z
    .enum(["new", "move", "update", "delete", "keep", "investigate", "recover"])
    .optional()
    .describe("Kind of change (default 'new')"),
  dependsOn: z.array(z.string()).optional().describe("taskKeys this task depends on"),
  sortOrder: z.number().int().optional().describe("Order within the phase"),
  notes: z.string().optional(),
});

/** Human-readable size, so a 450KB transcript reads as such in a tool response. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
