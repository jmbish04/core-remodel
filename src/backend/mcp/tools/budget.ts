/**
 * @fileoverview MCP tools — Budget domain.
 *
 * Read + write access to the home's budget: planned line items
 * (`budgetTrackerItems`), the rooms they touch (`budgetTrackerItemRooms`),
 * recorded actual expenses (`budgetExpenseEntries`), and the funding pools that
 * bankroll the remodel (`budgetFundingAccounts`).
 *
 * REVISIONING — both `budgetTrackerItems` and `budgetExpenseEntries` are
 * append-only revision chains, NOT mutable rows. A stable `trackId` (text)
 * identifies the logical record across revisions; each edit INSERTs a fresh row
 * with `revisionNumber + 1` and `isActive = true`, and the prior active row is
 * flipped to `isActive = false` with its `replacedBy*Id` pointed at the new row.
 * Every list/read tool here therefore filters on `isActive = true` so callers
 * only ever see the current revision.
 *
 * MONEY — all amounts are integer cents end-to-end (the `*Cents` columns).
 * Output objects echo both the raw `*Cents` integer and a human `$` string via
 * `formatCents` so agents never have to divide by 100 themselves.
 */
import {
  budgetExpenseEntries,
  budgetFundingAccounts,
  budgetTrackerItemRooms,
  budgetTrackerItems,
  rooms,
} from "@backend/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { cents, formatCents, matchesQuery, paginate, toolError } from "../format";
import { looseObject, pageOutput, urlField } from "../schemas";
import { defineTool, DESTRUCTIVE, READ_ONLY, WRITE, WRITE_IDEMPOTENT, type RemodelTool, type RemodelDb } from "../types";
import { budgetUrl } from "../urls";

/** Shape a budget tracker item revision for tool output (money as cents + `$`). */
function budgetItemDto(b: typeof budgetTrackerItems.$inferSelect) {
  return {
    id: b.id,
    trackId: b.trackId,
    revisionNumber: b.revisionNumber,
    isActive: b.isActive,
    title: b.title,
    description: b.description,
    status: b.status,
    itemType: b.itemType,
    executionClass: b.executionClass,
    scenarioId: b.scenarioId,
    estimatedLowCents: b.estimatedLowCents,
    estimatedHighCents: b.estimatedHighCents,
    estimatedLow: formatCents(b.estimatedLowCents),
    estimatedHigh: formatCents(b.estimatedHighCents),
  };
}

/** Shape an expense entry revision for tool output (money as cents + `$`). */
function expenseDto(e: typeof budgetExpenseEntries.$inferSelect) {
  return {
    id: e.id,
    trackId: e.trackId,
    revisionNumber: e.revisionNumber,
    isActive: e.isActive,
    item: e.item,
    category: e.category,
    amountCents: e.amountCents,
    amount: formatCents(e.amountCents),
    vendorName: e.vendorName,
    dateIncurred: e.dateIncurred ? e.dateIncurred.toISOString() : null,
    sourceType: e.sourceType,
    sourceRef: e.sourceRef,
    scenarioId: e.scenarioId,
  };
}

/** Load the current (active) budget item revision by numeric id or stable trackId. */
async function activeBudgetItem(
  db: RemodelDb,
  by: { id?: number; trackId?: string },
): Promise<typeof budgetTrackerItems.$inferSelect | undefined> {
  if (by.id != null) {
    const [row] = await db.select().from(budgetTrackerItems).where(eq(budgetTrackerItems.id, by.id)).limit(1);
    return row;
  }
  if (by.trackId) {
    const [row] = await db
      .select()
      .from(budgetTrackerItems)
      .where(and(eq(budgetTrackerItems.trackId, by.trackId), eq(budgetTrackerItems.isActive, true)))
      .limit(1);
    return row;
  }
  return undefined;
}

export const budgetTools: RemodelTool[] = [
  defineTool({
    name: "list_budget_items",
    category: "budget",
    title: "List budget items",
    description:
      "List ACTIVE budget line items (current revision only). Optional filters: `roomId` (items linked to that room via the join table), `status`, `executionClass`, and free-text `q` over title/description. Paginated. Money is returned as both `*Cents` integers and `$` strings.",
    inputShape: {
      roomId: z.number().int().positive().optional().describe("Only items linked to this room id (see list_rooms)"),
      status: z.string().optional().describe("Exact status: open | researching | blocked | approved | done"),
      executionClass: z
        .string()
        .optional()
        .describe("Exact execution class: must_now | future_tbd | option"),
      q: z.string().optional().describe("Free-text filter over title / description"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      ...pageOutput(
        looseObject({
          id: z.number().int(),
          trackId: z.string(),
          title: z.string().nullable(),
          status: z.string().nullable(),
          estimatedLowCents: z.number().int().nullable(),
          estimatedHighCents: z.number().int().nullable(),
          estimatedLow: z.string(),
          estimatedHigh: z.string(),
        }),
      ),
    },
    examples: [
      { title: "All active items", args: {} },
      { title: "Open items for a room", args: { roomId: 3, status: "open" } },
    ],
    handler: async ({ db }, input) => {
      const conds = [eq(budgetTrackerItems.isActive, true)];
      if (input.status) conds.push(eq(budgetTrackerItems.status, input.status));
      if (input.executionClass) conds.push(eq(budgetTrackerItems.executionClass, input.executionClass));

      // Room filter runs through the join table: resolve linked item ids first.
      if (input.roomId != null) {
        const links = await db
          .select({ budgetTrackerItemId: budgetTrackerItemRooms.budgetTrackerItemId })
          .from(budgetTrackerItemRooms)
          .where(eq(budgetTrackerItemRooms.roomId, input.roomId))
          .all();
        const ids = links.map((l) => l.budgetTrackerItemId);
        if (ids.length === 0) return paginate([], input.limit ?? 50, input.offset ?? 0);
        conds.push(inArray(budgetTrackerItems.id, ids));
      }

      const all = await db
        .select()
        .from(budgetTrackerItems)
        .where(and(...conds))
        .all();

      const filtered = input.q
        ? all.filter((b) => matchesQuery([b.title, b.description], input.q as string))
        : all;

      return paginate(filtered.map(budgetItemDto), input.limit ?? 50, input.offset ?? 0);
    },
  }),

  defineTool({
    name: "get_budget_item",
    category: "budget",
    title: "Get budget item detail",
    description:
      "Full detail for one ACTIVE budget item revision by numeric `id` OR stable `trackId`. Includes the room ids it is linked to. NOTE: expense entries have no direct FK to budget items, so no actuals total is joined here — use `list_expenses` (filter by category/item) to find related actuals.",
    inputShape: {
      id: z.number().int().positive().optional().describe("Numeric row id of a specific revision"),
      trackId: z.string().min(1).optional().describe("Stable track id (resolves to the active revision)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      id: z.number().int(),
      trackId: z.string(),
      revisionNumber: z.number().int(),
      isActive: z.boolean(),
      title: z.string().nullable(),
      description: z.string().nullable(),
      status: z.string().nullable(),
      itemType: z.string().nullable(),
      executionClass: z.string().nullable(),
      scenarioId: z.string().nullable(),
      estimatedLowCents: z.number().int().nullable(),
      estimatedHighCents: z.number().int().nullable(),
      estimatedLow: z.string(),
      estimatedHigh: z.string(),
      roomIds: z.array(z.number().int()),
    },
    examples: [
      { title: "By id", args: { id: 12 } },
      { title: "By trackId", args: { trackId: "b1e2..." } },
    ],
    handler: async ({ db }, input) => {
      if (input.id == null && !input.trackId) toolError("Provide either `id` or `trackId`.");
      const item = await activeBudgetItem(db, { id: input.id, trackId: input.trackId });
      if (!item) {
        toolError(`Budget item not found (${input.id ?? input.trackId}). Call list_budget_items for valid ids.`);
      }

      const links = await db
        .select({ roomId: budgetTrackerItemRooms.roomId })
        .from(budgetTrackerItemRooms)
        .where(eq(budgetTrackerItemRooms.budgetTrackerItemId, item.id))
        .all();

      return {
        ...budgetItemDto(item),
        roomIds: links.map((l) => l.roomId),
      };
    },
  }),

  defineTool({
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
  }),

  defineTool({
    name: "update_budget_item",
    category: "budget",
    title: "Update budget item (new revision)",
    description:
      "Revision-aware edit. Loads the ACTIVE revision (by `id` or `trackId`), inserts a NEW revision row with your changed fields merged over the current values (`revisionNumber + 1`, same `trackId`, `isActive = true`), then flips the old row to `isActive = false` and points its `replacedByItemId` at the new row. Only the fields you pass change. Returns the new active revision.",
    inputShape: {
      id: z.number().int().positive().optional().describe("Numeric id of the current active revision"),
      trackId: z.string().min(1).optional().describe("Stable track id (resolves to the active revision)"),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      executionClass: z.string().optional(),
      itemType: z.string().optional(),
      estimatedLowCents: z.number().int().optional().describe("Low estimate in integer cents"),
      estimatedHighCents: z.number().int().optional().describe("High estimate in integer cents"),
      scenarioId: z.string().optional(),
    },
    annotations: WRITE,
    outputShape: {
      updated: z.boolean(),
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
      { title: "Approve an item", args: { id: 12, status: "approved" } },
      { title: "Revise estimate", args: { trackId: "b1e2...", estimatedHighCents: 1500000 } },
    ],
    handler: async ({ env, db }, input) => {
      if (input.id == null && !input.trackId) toolError("Provide either `id` or `trackId`.");
      const current = await activeBudgetItem(db, { id: input.id, trackId: input.trackId });
      if (!current) {
        toolError(`Budget item not found (${input.id ?? input.trackId}). Call list_budget_items for valid ids.`);
      }

      // Merge only supplied fields over the current revision's values.
      const merged = {
        trackId: current.trackId,
        revisionNumber: current.revisionNumber + 1,
        isActive: true,
        isDraft: current.isDraft,
        itemType: input.itemType ?? current.itemType,
        executionClass: input.executionClass ?? current.executionClass,
        optionGroup: current.optionGroup,
        optionKey: current.optionKey,
        title: input.title ?? current.title,
        description: input.description !== undefined ? input.description : current.description,
        status: input.status ?? current.status,
        riskLevel: current.riskLevel,
        isBottleneck: current.isBottleneck,
        bottleneckReason: current.bottleneckReason,
        estimatedLowCents:
          input.estimatedLowCents !== undefined ? cents(input.estimatedLowCents) ?? null : current.estimatedLowCents,
        estimatedHighCents:
          input.estimatedHighCents !== undefined
            ? cents(input.estimatedHighCents) ?? null
            : current.estimatedHighCents,
        scenarioId: input.scenarioId !== undefined ? input.scenarioId : current.scenarioId,
        owner: current.owner,
        aiRationale: current.aiRationale,
      };

      const [next] = await db.insert(budgetTrackerItems).values(merged).returning();

      // Carry the room links forward. budgetTrackerItemRooms points at the row
      // `id`, so a new revision would otherwise orphan every room association
      // (they'd vanish from get_budget_item / list_budget_items / the report).
      const roomLinks = await db
        .select()
        .from(budgetTrackerItemRooms)
        .where(eq(budgetTrackerItemRooms.budgetTrackerItemId, current.id))
        .all();
      if (roomLinks.length > 0) {
        await db
          .insert(budgetTrackerItemRooms)
          .values(roomLinks.map((link) => ({ budgetTrackerItemId: next.id, roomId: link.roomId })))
          .run();
      }

      // Retire the prior revision and chain it to the new one.
      await db
        .update(budgetTrackerItems)
        .set({ isActive: false, replacedByItemId: next.id, replacedAt: new Date() })
        .where(eq(budgetTrackerItems.id, current.id))
        .run();

      return { updated: true, item: budgetItemDto(next), url: budgetUrl(env) };
    },
  }),

  defineTool({
    name: "link_budget_item_to_room",
    category: "budget",
    title: "Link budget item to room",
    description:
      "Attach a budget item (by row id) to a room (by row id) via the join table. Idempotent — if the (budgetTrackerItemId, roomId) pair already exists it is a no-op. Both records must exist.",
    inputShape: {
      budgetTrackerItemId: z.number().int().positive().describe("Budget item row id (see list_budget_items)"),
      roomId: z.number().int().positive().describe("Room row id (see list_rooms)"),
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      linked: z.boolean(),
      created: z.boolean(),
      id: z.number().int(),
      url: urlField,
    },
    examples: [{ title: "Link item to a room", args: { budgetTrackerItemId: 12, roomId: 3 } }],
    handler: async ({ env, db }, input) => {
      const [item] = await db
        .select()
        .from(budgetTrackerItems)
        .where(eq(budgetTrackerItems.id, input.budgetTrackerItemId))
        .limit(1);
      if (!item) toolError(`Budget item ${input.budgetTrackerItemId} not found. Call list_budget_items for valid ids.`);

      const [room] = await db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1);
      if (!room) toolError(`Room ${input.roomId} not found. Call list_rooms for valid ids.`);

      const [existing] = await db
        .select()
        .from(budgetTrackerItemRooms)
        .where(
          and(
            eq(budgetTrackerItemRooms.budgetTrackerItemId, input.budgetTrackerItemId),
            eq(budgetTrackerItemRooms.roomId, input.roomId),
          ),
        )
        .limit(1);
      if (existing) return { linked: true, created: false, id: existing.id, url: budgetUrl(env) };

      const [created] = await db
        .insert(budgetTrackerItemRooms)
        .values({ budgetTrackerItemId: input.budgetTrackerItemId, roomId: input.roomId })
        .returning();
      return { linked: true, created: true, id: created.id, url: budgetUrl(env) };
    },
  }),

  defineTool({
    name: "unlink_budget_item_from_room",
    category: "budget",
    title: "Unlink budget item from room",
    description:
      "Remove the join row connecting a budget item to a room. Deletes the link only — neither the budget item nor the room is affected.",
    inputShape: {
      budgetTrackerItemId: z.number().int().positive().describe("Budget item row id"),
      roomId: z.number().int().positive().describe("Room row id"),
    },
    annotations: DESTRUCTIVE,
    outputShape: {
      unlinked: z.boolean(),
      id: z.number().int(),
    },
    examples: [{ title: "Unlink item from a room", args: { budgetTrackerItemId: 12, roomId: 3 } }],
    handler: async ({ db }, input) => {
      const [existing] = await db
        .select()
        .from(budgetTrackerItemRooms)
        .where(
          and(
            eq(budgetTrackerItemRooms.budgetTrackerItemId, input.budgetTrackerItemId),
            eq(budgetTrackerItemRooms.roomId, input.roomId),
          ),
        )
        .limit(1);
      if (!existing) {
        toolError(
          `No link between budget item ${input.budgetTrackerItemId} and room ${input.roomId} — nothing to unlink.`,
        );
      }
      await db
        .delete(budgetTrackerItemRooms)
        .where(eq(budgetTrackerItemRooms.id, existing.id))
        .run();
      return { unlinked: true, id: existing.id };
    },
  }),

  defineTool({
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
  }),

  defineTool({
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
  }),

  defineTool({
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
  }),

  defineTool({
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
  }),
];
