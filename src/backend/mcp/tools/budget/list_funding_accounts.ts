import { budgetFundingAccounts } from "@backend/db";
import { z } from "zod";

import { formatCents } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listFundingAccounts = defineTool({
  name: "list_funding_accounts",
  category: "budget",
  title: "List funding accounts",
  description:
    "List every budget funding pool (e.g. cash, financed) with its available amount. Money is returned as both `amountCents` integers and `$` strings, plus a grand `total`.",
  inputShape: {},
  annotations: READ_ONLY,
  outputShape: {
    accounts: z.array(
      looseObject({
        id: z.number().int(),
        accountKey: z.string(),
        accountLabel: z.string().nullable(),
        amountCents: z.number().int().nullable(),
        amount: z.string(),
      }),
    ),
    totalCents: z.number().int(),
    total: z.string(),
  },
  examples: [{ title: "All funding accounts", args: {} }],
  handler: async ({ db }) => {
    const rows = await db.select().from(budgetFundingAccounts).all();
    const totalCents = rows.reduce((sum, a) => sum + (a.amountCents ?? 0), 0);
    return {
      accounts: rows.map((a) => ({
        id: a.id,
        accountKey: a.accountKey,
        accountLabel: a.accountLabel,
        amountCents: a.amountCents,
        amount: formatCents(a.amountCents),
      })),
      totalCents,
      total: formatCents(totalCents),
    };
  },
});
