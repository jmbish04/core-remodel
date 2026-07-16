import { budgetExpenseEntries } from "@backend/db";
import { z } from "zod";

import { cents, toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { budgetUrl } from "../../urls";
import { expenseDto } from "./_shared";

export const recordExpense = defineTool({
  name: "record_expense",
  category: "budget",
  title: "Record an actual expense",
  description:
    "Record a NEW actual expense as revision 1 (fresh `trackId`, `isActive = true`). `item` and `amountCents` are required. `dateIncurred` accepts an ISO-8601 string and is stored as a timestamp. Returns the created entry with money as cents + `$`.",
  inputShape: {
    item: z.string().min(1).describe("What was purchased, e.g. 'Faucet — Brizo Litze'"),
    amountCents: z.number().int().describe("Amount paid, in integer cents"),
    category: z.string().optional().describe("Expense category (default 'general')"),
    vendorName: z.string().optional().describe("Who it was paid to"),
    dateIncurred: z
      .string()
      .optional()
      .describe("ISO-8601 date/time the expense was incurred, e.g. '2026-07-01' or '2026-07-01T15:00:00Z'"),
    sourceType: z.string().optional().describe("How the entry originated (default 'manual')"),
    sourceRef: z.string().optional().describe("External reference id/URL for the source"),
    scenarioId: z.string().optional().describe("Remodel scenario id this expense belongs to"),
  },
  annotations: WRITE,
  outputShape: {
    created: z.boolean(),
    expense: looseObject({
      id: z.number().int(),
      trackId: z.string(),
      item: z.string().nullable(),
      category: z.string().nullable(),
      amountCents: z.number().int().nullable(),
      amount: z.string(),
      vendorName: z.string().nullable(),
    }),
    url: urlField,
  },
  examples: [
    { title: "Log a purchase", args: { item: "Kitchen faucet", amountCents: 84500, vendorName: "Ferguson" } },
  ],
  handler: async ({ env, db }, input) => {
    const amount = cents(input.amountCents);
    if (amount == null) toolError("`amountCents` must be a number of cents.");

    // Convert the ISO string to a JS Date for the { mode: "timestamp" } column.
    let incurred: Date | null = null;
    if (input.dateIncurred) {
      const parsed = new Date(input.dateIncurred);
      if (Number.isNaN(parsed.getTime())) {
        toolError(`Could not parse dateIncurred "${input.dateIncurred}" — pass an ISO-8601 date string.`);
      }
      incurred = parsed;
    }

    const values = {
      trackId: crypto.randomUUID(),
      revisionNumber: 1,
      isActive: true,
      item: input.item,
      amountCents: amount,
      ...(input.category ? { category: input.category } : {}),
      vendorName: input.vendorName ?? null,
      dateIncurred: incurred,
      ...(input.sourceType ? { sourceType: input.sourceType } : {}),
      sourceRef: input.sourceRef ?? null,
      scenarioId: input.scenarioId ?? null,
    };
    const [created] = await db.insert(budgetExpenseEntries).values(values).returning();
    return { created: true, expense: expenseDto(created), url: budgetUrl(env) };
  },
});
