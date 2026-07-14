import { budgetFundingAccounts } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { cents, formatCents, toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";
import { budgetUrl } from "../../urls";

export const setFundingAccount = defineTool({
  name: "set_funding_account",
  category: "budget",
  title: "Set (upsert) a funding account",
  description:
    "Upsert a funding pool by its unique `accountKey`. If the key exists its `amountCents` (and `accountLabel`, when provided) are updated; otherwise a new account is inserted. Idempotent — sending the same values twice is a no-op. Amount is integer cents.",
  inputShape: {
    accountKey: z.string().min(1).describe("Unique key, e.g. 'cash_amount' or 'financed_amount'"),
    amountCents: z.number().int().describe("Available funds in this pool, in integer cents"),
    accountLabel: z.string().optional().describe("Human label (required when creating a new account)"),
  },
  annotations: WRITE_IDEMPOTENT,
  outputShape: {
    created: z.boolean(),
    account: looseObject({
      id: z.number().int(),
      accountKey: z.string(),
      accountLabel: z.string().nullable(),
      amountCents: z.number().int().nullable(),
      amount: z.string(),
    }),
    url: urlField,
  },
  examples: [
    { title: "Set cash pool", args: { accountKey: "cash_amount", accountLabel: "Cash", amountCents: 5000000 } },
  ],
  handler: async ({ env, db }, input) => {
    const amount = cents(input.amountCents);
    if (amount == null) toolError("`amountCents` must be a number of cents.");

    const [existing] = await db
      .select()
      .from(budgetFundingAccounts)
      .where(eq(budgetFundingAccounts.accountKey, input.accountKey))
      .limit(1);

    if (existing) {
      const patch: Record<string, unknown> = { amountCents: amount, datetimeUpdated: new Date() };
      if (input.accountLabel !== undefined) patch.accountLabel = input.accountLabel;
      await db
        .update(budgetFundingAccounts)
        .set(patch)
        .where(eq(budgetFundingAccounts.id, existing.id))
        .run();
      const [updated] = await db
        .select()
        .from(budgetFundingAccounts)
        .where(eq(budgetFundingAccounts.id, existing.id))
        .limit(1);
      return {
        created: false,
        account: {
          id: updated.id,
          accountKey: updated.accountKey,
          accountLabel: updated.accountLabel,
          amountCents: updated.amountCents,
          amount: formatCents(updated.amountCents),
        },
        url: budgetUrl(env),
      };
    }

    // New account — accountLabel is NOT NULL, so require it on create.
    if (!input.accountLabel) {
      toolError(`accountLabel is required to create a new funding account '${input.accountKey}'.`);
    }
    const [created] = await db
      .insert(budgetFundingAccounts)
      .values({ accountKey: input.accountKey, accountLabel: input.accountLabel, amountCents: amount })
      .returning();
    return {
      created: true,
      account: {
        id: created.id,
        accountKey: created.accountKey,
        accountLabel: created.accountLabel,
        amountCents: created.amountCents,
        amount: formatCents(created.amountCents),
      },
      url: budgetUrl(env),
    };
  },
});
