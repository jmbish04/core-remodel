import { loadBudgetInbox } from "@backend/services/budget/inbox";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

const alertShape = looseObject({
  id: z
    .string()
    .describe(
      "Stable id — a bare type for singleton alerts, 'type:entityId' for per-entity alerts",
    ),
  type: z.enum(["unmapped_estimate", "over_range", "no_funding", "unphased_items"]),
  severity: z.enum(["critical", "warning", "info"]),
  title: z.string(),
  detail: z.string(),
  entity: looseObject({}).describe(
    "What this alert is about — shape varies by type (room, line items, etc.)",
  ),
  action: looseObject({
    label: z.string(),
    target: z.string().describe("Admin page path this alert should deep-link to"),
  }),
});

export const getBudgetInbox = defineTool({
  name: "get_budget_inbox",
  category: "budget",
  title: "Budget decision inbox",
  description:
    "Read the same decision-inbox alerts the /admin/budget workbench renders: estimate lines still needing room mapping (unmapped_estimate), rooms whose actual spend has passed their committed midpoint (over_range, one per room), zero funding accounts configured while spend exists (no_funding), and active budget items with no build phase assigned (unphased_items). Every alert is derived from a live query — an alert type is entirely absent when its source set is empty, never a fabricated '0 issues' entry. Sorted highest severity first (critical > warning > info).",
  inputShape: {},
  annotations: READ_ONLY,
  outputShape: {
    summary: z.string().describe("Human-readable one-line summary of the inbox"),
    alerts: z.array(alertShape),
  },
  examples: [{ title: "Current decision inbox", args: {} }],
  handler: async ({ db }) => {
    const inbox = await loadBudgetInbox(db);

    const bySeverity = { critical: 0, warning: 0, info: 0 };
    for (const alert of inbox.alerts) bySeverity[alert.severity] += 1;

    const summary =
      inbox.alerts.length === 0
        ? "Budget inbox is clear — no open alerts."
        : `${inbox.alerts.length} alert${inbox.alerts.length === 1 ? "" : "s"}: ` +
          `${bySeverity.critical} critical, ${bySeverity.warning} warning, ${bySeverity.info} info.`;

    return { summary, alerts: inbox.alerts };
  },
});
