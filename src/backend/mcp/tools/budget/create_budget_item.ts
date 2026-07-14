import { budgetTrackerItems } from "@backend/db";
import { z } from "zod";

import { cents } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { budgetUrl } from "../../urls";
import { budgetItemDto } from "./_shared";

export const createBudgetItem = defineTool({
  name: "create_budget_item",
  category: "budget",
  title: "Create budget item",
  description:
    "Create a new budget line item as revision 1 (fresh `trackId`, `isActive = true`). `title` is required; everything else is optional and falls back to the column defaults. Money is passed as integer cents. Returns the created row.",
  inputShape: {
    title: z.string().min(1).describe("Short line-item name, e.g. 'Kitchen cabinets'"),
    description: z.string().optional(),
    status: z.string().optional().describe("open | researching | blocked | approved | done (default open)"),
    executionClass: z.string().optional().describe("must_now | future_tbd | option (default must_now)"),
    itemType: z
      .string()
      .optional()
      .describe("project | professional_service | estimate | contract (default project)"),
    estimatedLowCents: z.number().int().optional().describe("Low estimate in integer cents"),
    estimatedHighCents: z.number().int().optional().describe("High estimate in integer cents"),
    scenarioId: z.string().optional().describe("Remodel scenario id this item belongs to"),
  },
  annotations: WRITE,
  outputShape: {
    created: z.boolean(),
    item: looseObject({
      id: z.number().int(),
      trackId: z.string(),
      title: z.string().nullable(),
      status: z.string().nullable(),
      estimatedLowCents: z.number().int().nullable(),
      estimatedHighCents: z.number().int().nullable(),
      estimatedLow: z.string(),
      estimatedHigh: z.string(),
    }),
    url: urlField,
  },
  examples: [
    {
      title: "New kitchen line item",
      args: { title: "Kitchen cabinets", estimatedLowCents: 800000, estimatedHighCents: 1200000 },
    },
  ],
  handler: async ({ env, db }, input) => {
    const trackId = crypto.randomUUID();
    const values = {
      trackId,
      revisionNumber: 1,
      isActive: true,
      title: input.title,
      description: input.description,
      ...(input.status ? { status: input.status } : {}),
      ...(input.executionClass ? { executionClass: input.executionClass } : {}),
      ...(input.itemType ? { itemType: input.itemType } : {}),
      estimatedLowCents: cents(input.estimatedLowCents) ?? null,
      estimatedHighCents: cents(input.estimatedHighCents) ?? null,
      scenarioId: input.scenarioId ?? null,
    };
    const [created] = await db.insert(budgetTrackerItems).values(values).returning();
    return { created: true, item: budgetItemDto(created), url: budgetUrl(env) };
  },
});
