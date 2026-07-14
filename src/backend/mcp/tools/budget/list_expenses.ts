import { budgetExpenseEntries } from "@backend/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { matchesQuery, paginate } from "../../format";
import { looseObject, pageOutput } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { expenseDto } from "./_shared";

export const listExpenses = defineTool({
  name: "list_expenses",
  category: "budget",
  title: "List actual expenses",
  description:
    "List ACTIVE actual expenses (current revision only). Optional filters: `category`, `vendorName`, and free-text `q` over item/vendor/category. Paginated. Money is returned as both `amountCents` integers and `$` strings.",
  inputShape: {
    category: z.string().optional().describe("Exact category match"),
    vendorName: z.string().optional().describe("Exact vendor name match"),
    q: z.string().optional().describe("Free-text filter over item / vendor / category"),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: READ_ONLY,
  outputShape: {
    ...pageOutput(
      looseObject({
        id: z.number().int(),
        trackId: z.string(),
        item: z.string().nullable(),
        category: z.string().nullable(),
        amountCents: z.number().int().nullable(),
        amount: z.string(),
        vendorName: z.string().nullable(),
      }),
    ),
  },
  examples: [
    { title: "All expenses", args: {} },
    { title: "By vendor", args: { vendorName: "Ferguson" } },
  ],
  handler: async ({ db }, input) => {
    const conds = [eq(budgetExpenseEntries.isActive, true)];
    if (input.category) conds.push(eq(budgetExpenseEntries.category, input.category));
    if (input.vendorName) conds.push(eq(budgetExpenseEntries.vendorName, input.vendorName));

    const all = await db
      .select()
      .from(budgetExpenseEntries)
      .where(and(...conds))
      .orderBy(desc(budgetExpenseEntries.dateIncurred))
      .all();

    const filtered = input.q
      ? all.filter((e) => matchesQuery([e.item, e.vendorName, e.category], input.q as string))
      : all;

    return paginate(filtered.map(expenseDto), input.limit ?? 50, input.offset ?? 0);
  },
});
