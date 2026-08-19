import { z } from "zod";

import { updatePlanTask, PLAN_TASK_STATUSES } from "@backend/services/plan-tasks";
import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { siteUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";

export const updatePlanTaskTool = defineTool({
  name: "update_plan_task",
  category: "changelog",
  title: "Update one plan task's progress (status, PR, notes)",
  description:
    "Tick progress on a SINGLE plan task as you work it, so the preview changelog at " +
    "/admin/changelog/preview/<slug> updates LIVE for whoever is watching (it holds a websocket and also " +
    "polls). Locate the task by its `planSlug` (usually the proposal slug) and its `taskKey`. Move the status " +
    "as you go — 'in_progress' when you pick it up, 'in_review' with `prNumber` the moment you open the PR, " +
    "'done' with `prNumber` when it merges. This is how a session keeps the board honest: a task left 'pending' " +
    "after its work shipped is a lie the next session will trust. To seed or re-shape the whole task list use " +
    "`submit_feature_proposal`; this tool is for the per-task status/PR ticks in between.",
  inputShape: {
    planSlug: z.string().min(1).describe("Plan the task belongs to (usually the proposal slug)"),
    taskKey: z.string().min(1).describe("Stable task key, e.g. 'P1-API-01'"),
    status: z.enum(PLAN_TASK_STATUSES).optional().describe("New status"),
    prNumber: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe("PR that carries this task (pass null to clear it)"),
    changelogSlug: z
      .string()
      .nullable()
      .optional()
      .describe("changelog_entries slug documenting this task (null to clear)"),
    progressPct: z
      .number()
      .int()
      .min(0)
      .max(100)
      .nullable()
      .optional()
      .describe("0–100 completion, for partial progress"),
    notes: z.string().nullable().optional().describe("Freeform notes — blockers, decisions, PR link"),
  },
  annotations: WRITE_IDEMPOTENT,
  outputShape: {
    taskKey: z.string(),
    planSlug: z.string(),
    status: z.string(),
    prNumber: z.number().int().nullable(),
    phase: z.number().int(),
    url: urlField,
  },
  examples: [
    {
      title: "Open a PR for a task",
      args: { planSlug: "feature-proposals-api", taskKey: "P1-API-01", status: "in_review", prNumber: 231 },
    },
    {
      title: "Close a task on merge",
      args: { planSlug: "feature-proposals-api", taskKey: "P1-API-01", status: "done", prNumber: 231 },
    },
  ],
  handler: async ({ env, db }, input) => {
    const planSlug = input.planSlug?.trim();
    const taskKey = input.taskKey?.trim();
    if (!planSlug || !taskKey) toolError("`planSlug` and `taskKey` are both required.");

    const updated = await updatePlanTask(
      env,
      db,
      { planSlug, taskKey },
      {
        status: input.status,
        prNumber: input.prNumber,
        changelogSlug: input.changelogSlug,
        progressPct: input.progressPct,
        notes: input.notes,
      },
    );
    if (!updated) toolError(`No task "${taskKey}" in plan "${planSlug}".`);

    return {
      taskKey: updated.taskKey,
      planSlug: updated.planSlug,
      status: updated.status,
      prNumber: updated.prNumber,
      phase: updated.phase,
      url: siteUrl(env, `/admin/changelog/preview/${updated.planSlug}`),
    };
  },
});
