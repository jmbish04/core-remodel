import { desc, eq, inArray, max, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  budgetExpenseEntries,
  budgetFundingAccounts,
  budgetProjectInfo,
  budgetTrackerItemRooms,
  budgetTrackerItems,
  remodelScenarios,
  rooms,
} from "@backend/db";
import { publishRealtimeEvent } from "@backend/realtime/publish";

const budgetTrackerRouter = new Hono<{ Bindings: Env }>();

type BudgetTrackerPatch = {
  itemType?: string | null;
  executionClass?: string | null;
  optionGroup?: string | null;
  optionKey?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  riskLevel?: string | null;
  isBottleneck?: boolean | null;
  bottleneckReason?: string | null;
  estimatedLowCents?: number | string | null;
  estimatedHighCents?: number | string | null;
  scenarioId?: string | null;
  owner?: string | null;
  aiRationale?: string | null;
  isDraft?: boolean | null;
  roomIds?: number[] | null;
  changedBy?: string | null;
  changeSource?: string | null;
};

type BudgetExpensePatch = {
  item?: string | null;
  category?: string | null;
  amountCents?: number | string | null;
  vendorName?: string | null;
  scenarioId?: string | null;
  optionGroup?: string | null;
  optionKey?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  dateIncurred?: string | null;
  notes?: string | null;
  isDraft?: boolean | null;
  changedBy?: string | null;
  changeSource?: string | null;
};

function parseCents(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    if (!Number.isInteger(input)) {
      return Math.round(input * 100);
    }
    return Math.trunc(input);
  }
  if (typeof input !== "string") return null;
  const normalized = input.replace(/[$,\s]/g, "").trim();
  if (!normalized) return null;
  const asNumber = Number.parseFloat(normalized);
  if (!Number.isFinite(asNumber)) return null;
  const looksLikeDollars = /[$,.]/.test(input);
  return looksLikeDollars ? Math.round(asNumber * 100) : Math.round(asNumber);
}

function normalizeString(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value.length > 0 ? value : null;
}

function parseTimestamp(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function emitBudgetRealtime(
  env: Env,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await publishRealtimeEvent(env, "home", {
      ...payload,
      at: new Date().toISOString(),
    });
  } catch {
    // non-fatal
  }
}

async function getNextTrackRevisionNumber(
  db: ReturnType<typeof drizzle>,
  trackId: string,
): Promise<number> {
  const row = await db
    .select({
      revision: max(budgetTrackerItems.revisionNumber),
    })
    .from(budgetTrackerItems)
    .where(eq(budgetTrackerItems.trackId, trackId))
    .get();
  return (row?.revision || 0) + 1;
}

async function replaceBudgetTrackerItemRevision(
  db: ReturnType<typeof drizzle>,
  activeItemId: number,
  patch: BudgetTrackerPatch,
): Promise<{ previousId: number; nextId: number; trackId: string }> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const current = await tx
      .select()
      .from(budgetTrackerItems)
      .where(eq(budgetTrackerItems.id, activeItemId))
      .get();
    if (!current) {
      throw new Error("Budget tracker item not found");
    }
    if (!current.isActive) {
      throw new Error("Only active revisions can be updated");
    }

    const nextRevisionNumber = await getNextTrackRevisionNumber(
      tx as ReturnType<typeof drizzle>,
      current.trackId,
    );
    const inserted = await tx
      .insert(budgetTrackerItems)
      .values({
        trackId: current.trackId,
        revisionNumber: nextRevisionNumber,
        isActive: true,
        isDraft: patch.isDraft ?? current.isDraft,
        itemType: normalizeString(patch.itemType) || current.itemType,
        executionClass: normalizeString(patch.executionClass) || current.executionClass,
        optionGroup:
          patch.optionGroup === null
            ? null
            : normalizeString(patch.optionGroup) || current.optionGroup,
        optionKey:
          patch.optionKey === null
            ? null
            : normalizeString(patch.optionKey) || current.optionKey,
        title: normalizeString(patch.title) || current.title,
        description:
          patch.description === null
            ? null
            : normalizeString(patch.description) || current.description,
        status: normalizeString(patch.status) || current.status,
        riskLevel: normalizeString(patch.riskLevel) || current.riskLevel,
        isBottleneck:
          typeof patch.isBottleneck === "boolean"
            ? patch.isBottleneck
            : current.isBottleneck,
        bottleneckReason:
          patch.bottleneckReason === null
            ? null
            : normalizeString(patch.bottleneckReason) || current.bottleneckReason,
        estimatedLowCents:
          patch.estimatedLowCents === null
            ? null
            : parseCents(patch.estimatedLowCents) ?? current.estimatedLowCents,
        estimatedHighCents:
          patch.estimatedHighCents === null
            ? null
            : parseCents(patch.estimatedHighCents) ?? current.estimatedHighCents,
        scenarioId:
          patch.scenarioId === null
            ? null
            : normalizeString(patch.scenarioId) || current.scenarioId,
        owner: patch.owner === null ? null : normalizeString(patch.owner) || current.owner,
        aiRationale:
          patch.aiRationale === null
            ? null
            : normalizeString(patch.aiRationale) || current.aiRationale,
        changeSource:
          normalizeString(patch.changeSource) ||
          normalizeString(current.changeSource) ||
          "manual",
        changedBy:
          patch.changedBy === null
            ? null
            : normalizeString(patch.changedBy) || current.changedBy,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();
    const next = inserted[0];

    await tx
      .update(budgetTrackerItems)
      .set({
        isActive: false,
        replacedByItemId: next.id,
        replacedAt: now,
        datetimeUpdated: now,
      })
      .where(eq(budgetTrackerItems.id, current.id))
      .run();

    const existingRoomMappings = await tx
      .select()
      .from(budgetTrackerItemRooms)
      .where(eq(budgetTrackerItemRooms.budgetTrackerItemId, current.id))
      .all();

    let nextRoomIds = existingRoomMappings.map((row) => row.roomId);
    if (Array.isArray(patch.roomIds)) {
      nextRoomIds = patch.roomIds.filter((value) => Number.isFinite(value));
    }
    if (nextRoomIds.length > 0) {
      await tx.insert(budgetTrackerItemRooms).values(
        nextRoomIds.map((roomId) => ({
          budgetTrackerItemId: next.id,
          roomId,
          datetimeCreated: now,
        })),
      );
    }

    return {
      previousId: current.id,
      nextId: next.id,
      trackId: current.trackId,
    };
  });
}

async function getNextExpenseRevisionNumber(
  db: ReturnType<typeof drizzle>,
  trackId: string,
): Promise<number> {
  const row = await db
    .select({
      revision: max(budgetExpenseEntries.revisionNumber),
    })
    .from(budgetExpenseEntries)
    .where(eq(budgetExpenseEntries.trackId, trackId))
    .get();
  return (row?.revision || 0) + 1;
}

async function replaceBudgetExpenseRevision(
  db: ReturnType<typeof drizzle>,
  activeExpenseId: number,
  patch: BudgetExpensePatch,
): Promise<{ previousId: number; nextId: number; trackId: string }> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const current = await tx
      .select()
      .from(budgetExpenseEntries)
      .where(eq(budgetExpenseEntries.id, activeExpenseId))
      .get();
    if (!current) {
      throw new Error("Budget expense item not found");
    }
    if (!current.isActive) {
      throw new Error("Only active expense revisions can be updated");
    }

    const item = normalizeString(patch.item) || current.item;
    const category = normalizeString(patch.category) || current.category;
    const amountCents =
      patch.amountCents === null
        ? current.amountCents
        : parseCents(patch.amountCents) ?? current.amountCents;

    const nextRevisionNumber = await getNextExpenseRevisionNumber(
      tx as ReturnType<typeof drizzle>,
      current.trackId,
    );
    const inserted = await tx
      .insert(budgetExpenseEntries)
      .values({
        trackId: current.trackId,
        revisionNumber: nextRevisionNumber,
        isActive: true,
        isDraft: patch.isDraft ?? current.isDraft,
        item,
        category,
        amountCents,
        vendorName:
          patch.vendorName === null
            ? null
            : normalizeString(patch.vendorName) || current.vendorName,
        scenarioId:
          patch.scenarioId === null
            ? null
            : normalizeString(patch.scenarioId) || current.scenarioId,
        optionGroup:
          patch.optionGroup === null
            ? null
            : normalizeString(patch.optionGroup) || current.optionGroup,
        optionKey:
          patch.optionKey === null
            ? null
            : normalizeString(patch.optionKey) || current.optionKey,
        sourceType:
          patch.sourceType === null
            ? current.sourceType
            : normalizeString(patch.sourceType) || current.sourceType,
        sourceRef:
          patch.sourceRef === null
            ? null
            : normalizeString(patch.sourceRef) || current.sourceRef,
        dateIncurred:
          patch.dateIncurred === null
            ? null
            : parseTimestamp(patch.dateIncurred) || current.dateIncurred,
        notes:
          patch.notes === null
            ? null
            : normalizeString(patch.notes) || current.notes,
        changeSource:
          normalizeString(patch.changeSource) ||
          normalizeString(current.changeSource) ||
          "manual",
        changedBy:
          patch.changedBy === null
            ? null
            : normalizeString(patch.changedBy) || current.changedBy,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();
    const next = inserted[0];

    await tx
      .update(budgetExpenseEntries)
      .set({
        isActive: false,
        replacedByExpenseId: next.id,
        replacedAt: now,
        datetimeUpdated: now,
      })
      .where(eq(budgetExpenseEntries.id, current.id))
      .run();

    return {
      previousId: current.id,
      nextId: next.id,
      trackId: current.trackId,
    };
  });
}

budgetTrackerRouter.get("/items", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const executionClassFilter = normalizeString(c.req.query("executionClass"));
    const statusFilter = normalizeString(c.req.query("status"));
    const itemTypeFilter = normalizeString(c.req.query("itemType"));

    const baseRows = await db
      .select()
      .from(budgetTrackerItems)
      .where(eq(budgetTrackerItems.isActive, true))
      .orderBy(desc(budgetTrackerItems.isBottleneck), desc(budgetTrackerItems.datetimeUpdated))
      .all();

    const filteredRows = baseRows.filter((row) => {
      if (executionClassFilter && row.executionClass !== executionClassFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      if (itemTypeFilter && row.itemType !== itemTypeFilter) return false;
      return true;
    });

    const itemIds = filteredRows.map((row) => row.id);
    const roomMappings =
      itemIds.length > 0
        ? await db
            .select({
              budgetTrackerItemId: budgetTrackerItemRooms.budgetTrackerItemId,
              roomId: budgetTrackerItemRooms.roomId,
              roomName: rooms.roomName,
            })
            .from(budgetTrackerItemRooms)
            .innerJoin(rooms, eq(rooms.id, budgetTrackerItemRooms.roomId))
            .where(inArray(budgetTrackerItemRooms.budgetTrackerItemId, itemIds))
            .all()
        : [];

    const roomsByItemId = new Map<number, Array<{ roomId: number; roomName: string }>>();
    for (const mapping of roomMappings) {
      const current = roomsByItemId.get(mapping.budgetTrackerItemId) || [];
      current.push({ roomId: mapping.roomId, roomName: mapping.roomName });
      roomsByItemId.set(mapping.budgetTrackerItemId, current);
    }

    return c.json({
      items: filteredRows.map((row) => ({
        ...row,
        rooms: roomsByItemId.get(row.id) || [],
      })),
      summary: {
        totalActive: filteredRows.length,
        bottlenecks: filteredRows.filter((row) => row.isBottleneck).length,
        mustNow: filteredRows.filter((row) => row.executionClass === "must_now").length,
        futureTbd: filteredRows.filter((row) => row.executionClass === "future_tbd").length,
        options: filteredRows.filter((row) => row.executionClass === "option").length,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list budget tracker items",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.get("/items/:trackId/revisions", async (c) => {
  try {
    const trackId = normalizeString(c.req.param("trackId"));
    if (!trackId) {
      return c.json({ error: "Invalid track ID" }, 400);
    }
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(budgetTrackerItems)
      .where(eq(budgetTrackerItems.trackId, trackId))
      .orderBy(desc(budgetTrackerItems.revisionNumber))
      .all();
    return c.json({ revisions: rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list budget tracker revisions",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.post("/items", async (c) => {
  try {
    const body = (await c.req.json()) as BudgetTrackerPatch;
    const title = normalizeString(body.title);
    if (!title) {
      return c.json({ error: "Title is required" }, 400);
    }
    const db = drizzle(c.env.DB);
    const now = new Date();
    const trackId = crypto.randomUUID();
    const inserted = await db
      .insert(budgetTrackerItems)
      .values({
        trackId,
        revisionNumber: 1,
        isActive: true,
        isDraft: body.isDraft ?? true,
        itemType: normalizeString(body.itemType) || "project",
        executionClass: normalizeString(body.executionClass) || "must_now",
        optionGroup: normalizeString(body.optionGroup),
        optionKey: normalizeString(body.optionKey),
        title,
        description: normalizeString(body.description),
        status: normalizeString(body.status) || "open",
        riskLevel: normalizeString(body.riskLevel) || "medium",
        isBottleneck: body.isBottleneck ?? false,
        bottleneckReason: normalizeString(body.bottleneckReason),
        estimatedLowCents: parseCents(body.estimatedLowCents),
        estimatedHighCents: parseCents(body.estimatedHighCents),
        scenarioId: normalizeString(body.scenarioId),
        owner: normalizeString(body.owner),
        aiRationale: normalizeString(body.aiRationale),
        changeSource: normalizeString(body.changeSource) || "manual",
        changedBy: normalizeString(body.changedBy),
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    const row = inserted[0];
    const roomIds = Array.isArray(body.roomIds)
      ? body.roomIds.filter((value) => Number.isFinite(value))
      : [];
    if (roomIds.length > 0) {
      await db.insert(budgetTrackerItemRooms).values(
        roomIds.map((roomId) => ({
          budgetTrackerItemId: row.id,
          roomId,
          datetimeCreated: now,
        })),
      );
    }

    await emitBudgetRealtime(c.env, {
      event: "budget.item.created",
      trackId: row.trackId,
      itemId: row.id,
      executionClass: row.executionClass,
      optionGroup: row.optionGroup,
      optionKey: row.optionKey,
    });

    return c.json({ item: row }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create budget tracker item",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.patch("/items/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) {
      return c.json({ error: "Invalid item ID" }, 400);
    }
    const body = (await c.req.json()) as BudgetTrackerPatch;
    const db = drizzle(c.env.DB);
    const replaced = await replaceBudgetTrackerItemRevision(db, id, body);
    await emitBudgetRealtime(c.env, {
      event: "budget.item.revised",
      trackId: replaced.trackId,
      previousId: replaced.previousId,
      nextId: replaced.nextId,
    });

    return c.json({ success: true, ...replaced });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update budget tracker item",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.get("/overview", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const [items, expenses, accounts] = await Promise.all([
      db
        .select()
        .from(budgetTrackerItems)
        .where(eq(budgetTrackerItems.isActive, true))
        .all(),
      db
        .select()
        .from(budgetExpenseEntries)
        .where(eq(budgetExpenseEntries.isActive, true))
        .all(),
      db.select().from(budgetFundingAccounts).all(),
    ]);

    const totalAllottedCents = accounts.reduce((sumValue, row) => sumValue + row.amountCents, 0);
    const totalUsedCents = expenses.reduce((sumValue, row) => sumValue + row.amountCents, 0);
    const remainingCents = totalAllottedCents - totalUsedCents;

    const mustNow = items.filter((row) => row.executionClass === "must_now");
    const futureTbd = items.filter((row) => row.executionClass === "future_tbd");
    const options = items.filter((row) => row.executionClass === "option");

    const sumRange = (rows: typeof items) =>
      rows.reduce(
        (acc, row) => {
          acc.low += row.estimatedLowCents || 0;
          acc.high += row.estimatedHighCents || 0;
          return acc;
        },
        { low: 0, high: 0 },
      );

    return c.json({
      items: {
        total: items.length,
        mustNow: { count: mustNow.length, ...sumRange(mustNow) },
        futureTbd: { count: futureTbd.length, ...sumRange(futureTbd) },
        options: { count: options.length, ...sumRange(options) },
        bottlenecks: items.filter((row) => row.isBottleneck).length,
      },
      expenses: {
        count: expenses.length,
        totalUsedCents,
      },
      funds: {
        totalAllottedCents,
        remainingCents,
        accountCount: accounts.length,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load budget overview",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.get("/project-info", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(budgetProjectInfo).orderBy(budgetProjectInfo.id).all();
    return c.json({ rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load project info",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.put("/project-info", async (c) => {
  try {
    const body = (await c.req.json()) as {
      rows?: Array<{
        infoKey?: string;
        infoLabel?: string;
        infoValue?: string | null;
        notes?: string | null;
      }>;
    };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const db = drizzle(c.env.DB);
    const now = new Date();
    const upsertRows = rows.flatMap((row) => {
      const infoKey = normalizeString(row.infoKey);
      if (!infoKey) return [];
      return [
        {
          infoKey,
          infoLabel: normalizeString(row.infoLabel) || infoKey,
          infoValue:
            row.infoValue === null
              ? null
              : normalizeString(row.infoValue),
          notes: row.notes === null ? null : normalizeString(row.notes),
          datetimeCreated: now,
          datetimeUpdated: now,
        },
      ];
    });

    if (upsertRows.length > 0) {
      await db
        .insert(budgetProjectInfo)
        .values(upsertRows)
        .onConflictDoUpdate({
          target: budgetProjectInfo.infoKey,
          set: {
            infoLabel: sql`excluded.info_label`,
            infoValue: sql`excluded.info_value`,
            notes: sql`excluded.notes`,
            datetimeUpdated: sql`excluded.datetime_updated`,
          },
        })
        .run();
    }
    const updated = upsertRows.length;
    await emitBudgetRealtime(c.env, {
      event: "budget.project_info.updated",
      updated,
    });

    return c.json({ success: true, updated });
  } catch (error) {
    return c.json(
      {
        error: "Failed to upsert project info",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.get("/financial-status", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const [accounts, expenses] = await Promise.all([
      db.select().from(budgetFundingAccounts).orderBy(budgetFundingAccounts.id).all(),
      db
        .select()
        .from(budgetExpenseEntries)
        .where(eq(budgetExpenseEntries.isActive, true))
        .all(),
    ]);
    const totalAllottedCents = accounts.reduce((sumValue, row) => sumValue + row.amountCents, 0);
    const totalUsedCents = expenses.reduce((sumValue, row) => sumValue + row.amountCents, 0);
    const fundsRemainingCents = totalAllottedCents - totalUsedCents;
    return c.json({
      accounts,
      summary: {
        totalAllottedCents,
        totalUsedCents,
        fundsRemainingCents,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load financial status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.put("/financial-accounts", async (c) => {
  try {
    const body = (await c.req.json()) as {
      accounts?: Array<{
        accountKey?: string;
        accountLabel?: string;
        amountCents?: number | string | null;
        notes?: string | null;
      }>;
    };
    const accounts = Array.isArray(body.accounts) ? body.accounts : [];
    const db = drizzle(c.env.DB);
    let updated = 0;
    for (const account of accounts) {
      const accountKey = normalizeString(account.accountKey);
      if (!accountKey) continue;
      const amountCents = parseCents(account.amountCents);
      if (amountCents === null) continue;
      await db
        .insert(budgetFundingAccounts)
        .values({
          accountKey,
          accountLabel: normalizeString(account.accountLabel) || accountKey,
          amountCents,
          notes: account.notes === null ? null : normalizeString(account.notes),
          datetimeCreated: new Date(),
          datetimeUpdated: new Date(),
        })
        .onConflictDoUpdate({
          target: budgetFundingAccounts.accountKey,
          set: {
            accountLabel: normalizeString(account.accountLabel) || accountKey,
            amountCents,
            notes: account.notes === null ? null : normalizeString(account.notes),
            datetimeUpdated: new Date(),
          },
        });
      updated += 1;
    }
    await emitBudgetRealtime(c.env, {
      event: "budget.financial_accounts.updated",
      updated,
    });

    return c.json({ success: true, updated });
  } catch (error) {
    return c.json(
      {
        error: "Failed to upsert financial accounts",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.get("/expenses", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const categoryFilter = normalizeString(c.req.query("category"));
    const scenarioIdFilter = normalizeString(c.req.query("scenarioId"));
    const optionGroupFilter = normalizeString(c.req.query("optionGroup"));
    const rows = await db
      .select()
      .from(budgetExpenseEntries)
      .where(eq(budgetExpenseEntries.isActive, true))
      .orderBy(desc(budgetExpenseEntries.datetimeUpdated))
      .all();
    const filteredRows = rows.filter((row) => {
      if (categoryFilter && row.category !== categoryFilter) return false;
      if (scenarioIdFilter && row.scenarioId !== scenarioIdFilter) return false;
      if (optionGroupFilter && row.optionGroup !== optionGroupFilter) return false;
      return true;
    });
    const totalAmountCents = filteredRows.reduce((sumValue, row) => sumValue + row.amountCents, 0);
    return c.json({
      expenses: filteredRows,
      summary: {
        count: filteredRows.length,
        totalAmountCents,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list itemized expenses",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.post("/expenses", async (c) => {
  try {
    const body = (await c.req.json()) as BudgetExpensePatch;
    const item = normalizeString(body.item);
    const category = normalizeString(body.category);
    const amountCents = parseCents(body.amountCents);
    if (!item) {
      return c.json({ error: "Item is required" }, 400);
    }
    if (!category) {
      return c.json({ error: "Category is required" }, 400);
    }
    if (amountCents === null) {
      return c.json({ error: "Amount is required" }, 400);
    }
    const db = drizzle(c.env.DB);
    const now = new Date();
    const trackId = crypto.randomUUID();
    const inserted = await db
      .insert(budgetExpenseEntries)
      .values({
        trackId,
        revisionNumber: 1,
        isActive: true,
        isDraft: body.isDraft ?? false,
        item,
        category,
        amountCents,
        vendorName: normalizeString(body.vendorName),
        scenarioId: normalizeString(body.scenarioId),
        optionGroup: normalizeString(body.optionGroup),
        optionKey: normalizeString(body.optionKey),
        sourceType: normalizeString(body.sourceType) || "manual",
        sourceRef: normalizeString(body.sourceRef),
        dateIncurred: parseTimestamp(body.dateIncurred),
        notes: normalizeString(body.notes),
        changeSource: normalizeString(body.changeSource) || "manual",
        changedBy: normalizeString(body.changedBy),
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();
    await emitBudgetRealtime(c.env, {
      event: "budget.expense.created",
      trackId: inserted[0].trackId,
      expenseId: inserted[0].id,
      category: inserted[0].category,
      optionGroup: inserted[0].optionGroup,
      optionKey: inserted[0].optionKey,
    });

    return c.json({ expense: inserted[0] }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create expense",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.patch("/expenses/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) {
      return c.json({ error: "Invalid expense ID" }, 400);
    }
    const body = (await c.req.json()) as BudgetExpensePatch;
    const db = drizzle(c.env.DB);
    const replaced = await replaceBudgetExpenseRevision(db, id, body);
    await emitBudgetRealtime(c.env, {
      event: "budget.expense.revised",
      trackId: replaced.trackId,
      previousId: replaced.previousId,
      nextId: replaced.nextId,
    });

    return c.json({ success: true, ...replaced });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update expense",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.get("/variance-options", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const [items, scenarios] = await Promise.all([
      db
        .select()
        .from(budgetTrackerItems)
        .where(eq(budgetTrackerItems.isActive, true))
        .all(),
      db.select().from(remodelScenarios).all(),
    ]);
    const baseItems = items.filter((row) => row.executionClass === "must_now");
    const baseLowCents = baseItems.reduce((sumValue, row) => sumValue + (row.estimatedLowCents || 0), 0);
    const baseHighCents = baseItems.reduce((sumValue, row) => sumValue + (row.estimatedHighCents || 0), 0);

    const optionMap = new Map<
      string,
      {
        optionGroup: string;
        optionKey: string;
        itemCount: number;
        lowSumCents: number;
        highSumCents: number;
        statuses: Record<string, number>;
      }
    >();

    for (const row of items) {
      if (!row.optionGroup || !row.optionKey) continue;
      const key = `${row.optionGroup}::${row.optionKey}`;
      const current = optionMap.get(key) || {
        optionGroup: row.optionGroup,
        optionKey: row.optionKey,
        itemCount: 0,
        lowSumCents: 0,
        highSumCents: 0,
        statuses: {},
      };
      current.itemCount += 1;
      current.lowSumCents += row.estimatedLowCents || 0;
      current.highSumCents += row.estimatedHighCents || 0;
      current.statuses[row.status] = (current.statuses[row.status] || 0) + 1;
      optionMap.set(key, current);
    }

    const optionRows = Array.from(optionMap.values()).map((row) => ({
      optionGroup: row.optionGroup,
      optionKey: row.optionKey,
      itemCount: row.itemCount,
      lowSumCents: row.lowSumCents,
      highSumCents: row.highSumCents,
      projectedTotalLowCents: baseLowCents + row.lowSumCents,
      projectedTotalHighCents: baseHighCents + row.highSumCents,
      statusMix: row.statuses,
    }));

    return c.json({
      basePlan: {
        count: baseItems.length,
        lowCents: baseLowCents,
        highCents: baseHighCents,
      },
      options: optionRows,
      scenarios,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to build variance summary",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

type BootstrapItem = {
  title: string;
  description: string;
  executionClass: "must_now" | "future_tbd" | "option";
  status: "open" | "researching" | "blocked";
  riskLevel: "medium" | "high";
  isBottleneck?: boolean;
  bottleneckReason?: string;
  itemType?: "project" | "professional_service";
  optionGroup?: string;
  optionKey?: string;
  estimatedLowCents?: number;
  estimatedHighCents?: number;
};

const HOMEOWNER_BOOTSTRAP_ITEMS: BootstrapItem[] = [
  {
    title: "French drains across backyard + bioswale + sump integration",
    description:
      "Install full-width backyard French drains from south to north property line and route drainage to sump + bioswale overflow system.",
    executionClass: "must_now",
    status: "researching",
    riskLevel: "high",
    isBottleneck: true,
    bottleneckReason: "Controls slab moisture and downstream viability of interior finishes.",
    estimatedLowCents: 4500000,
    estimatedHighCents: 9000000,
  },
  {
    title: "Side-yard foundation drain routing through fence line",
    description:
      "Coordinate neighbor-side fence penetration and drain routing where the foundation edge is exposed.",
    executionClass: "must_now",
    status: "researching",
    riskLevel: "high",
    estimatedLowCents: 400000,
    estimatedHighCents: 1500000,
  },
  {
    title: "Sump pump relocation + concealment strategy",
    description:
      "Determine whether sump remains in place or is relocated under patio; hide new piping and ensure serviceability.",
    executionClass: "must_now",
    status: "researching",
    riskLevel: "high",
    estimatedLowCents: 600000,
    estimatedHighCents: 2000000,
  },
  {
    title: "Sewer lateral extension to bioswale overflow + sump discharge",
    description:
      "Extend existing patio sewer connection to bioswale overflow and coordinate with final sump discharge routing.",
    executionClass: "must_now",
    status: "researching",
    riskLevel: "high",
    estimatedLowCents: 800000,
    estimatedHighCents: 3000000,
  },
  {
    title: "Patio cinder-block wall removal",
    description:
      "Remove 4-ft cinder-block wall across patio edge to open the patio into backyard space.",
    executionClass: "must_now",
    status: "researching",
    riskLevel: "high",
    estimatedLowCents: 1500000,
    estimatedHighCents: 3500000,
  },
  {
    title: "Patio roof support post repositioning / mini roof decision",
    description:
      "Re-engineer patio posts after wall removal and decide to retain or remove existing narrow roof run.",
    executionClass: "must_now",
    status: "researching",
    riskLevel: "high",
    estimatedLowCents: 1200000,
    estimatedHighCents: 4500000,
  },
  {
    title: "Optional backyard utility rough-ins (irrigation + landscape lighting)",
    description:
      "If budget allows, run irrigation plumbing and low-voltage electrical underground for future backyard landscaping.",
    executionClass: "future_tbd",
    status: "researching",
    riskLevel: "medium",
    estimatedLowCents: 500000,
    estimatedHighCents: 2500000,
  },
  {
    title: "Structural engineer study for center-wall opening feasibility",
    description:
      "Structural engineering package for 3x2x12 wall feasibility, design options, and budget implications.",
    executionClass: "must_now",
    status: "blocked",
    riskLevel: "high",
    isBottleneck: true,
    bottleneckReason: "Critical path decision for downstairs kitchen viability.",
    itemType: "professional_service",
    estimatedLowCents: 700000,
    estimatedHighCents: 2000000,
  },
  {
    title: "Architectural planning + permit strategy",
    description:
      "Architectural scope for layout alternatives, permit path, and coordination with structural constraints.",
    executionClass: "must_now",
    status: "researching",
    riskLevel: "high",
    itemType: "professional_service",
    estimatedLowCents: 1200000,
    estimatedHighCents: 4500000,
  },
  {
    title: "Structural feasibility for center wall opening (downstairs)",
    description:
      "Confirm technical and cost feasibility for opening/removing 3x2x12 structural wall supporting cantilever.",
    executionClass: "must_now",
    status: "blocked",
    riskLevel: "high",
    isBottleneck: true,
    bottleneckReason: "Determines whether kitchen can relocate downstairs.",
    itemType: "professional_service",
    estimatedLowCents: 1000000,
    estimatedHighCents: 3000000,
  },
  {
    title: "Downstairs kitchen decision gate",
    description:
      "Track final feasibility decision for moving kitchen downstairs with financial + technical gating.",
    executionClass: "must_now",
    status: "blocked",
    riskLevel: "high",
    isBottleneck: true,
    bottleneckReason: "Blocks all lower-level kitchen layout commitments.",
    optionGroup: "kitchen_path",
    optionKey: "decision_gate_downstairs_viability",
    estimatedLowCents: 0,
    estimatedHighCents: 0,
  },
  {
    title: "Kitchen option A: downstairs south-side island over lateral",
    description:
      "Potential slab opening, new plumbing and venting on rear wall; high ambition layout.",
    executionClass: "option",
    status: "researching",
    riskLevel: "high",
    optionGroup: "kitchen_path",
    optionKey: "downstairs_south_island",
    estimatedLowCents: 2500000,
    estimatedHighCents: 4000000,
  },
  {
    title: "Kitchen option B: downstairs north-side (guest-bedroom side)",
    description:
      "U-shape kitchen near main plumbing stack; may reduce plumbing reroute complexity.",
    executionClass: "option",
    status: "researching",
    riskLevel: "medium",
    optionGroup: "kitchen_path",
    optionKey: "downstairs_north_stack_side",
    estimatedLowCents: 2000000,
    estimatedHighCents: 3500000,
  },
  {
    title: "Kitchen option C: upstairs U-shape + raised sink window",
    description:
      "Remove kitchen/living separator wall, raise front kitchen window, move to U-shape.",
    executionClass: "option",
    status: "researching",
    riskLevel: "medium",
    optionGroup: "kitchen_path",
    optionKey: "upstairs_u_shape_raised_window",
    estimatedLowCents: 1500000,
    estimatedHighCents: 3000000,
  },
  {
    title: "Kitchen option D: upstairs in-kind refresh",
    description:
      "Cost-control path: keep kitchen upstairs with limited layout changes.",
    executionClass: "option",
    status: "researching",
    riskLevel: "medium",
    optionGroup: "kitchen_path",
    optionKey: "upstairs_in_kind",
    estimatedLowCents: 900000,
    estimatedHighCents: 1800000,
  },
  {
    title: "Kitchen option E: defer kitchen transformation for now",
    description:
      "Do minimal kitchen work now and defer full kitchen redesign to future phase.",
    executionClass: "option",
    status: "researching",
    riskLevel: "medium",
    optionGroup: "kitchen_path",
    optionKey: "defer_major_kitchen",
    estimatedLowCents: 200000,
    estimatedHighCents: 900000,
  },
  {
    title: "Upstairs hardwood + stair hardwood replacement",
    description:
      "Mandatory flooring replacement upstairs and on stairs regardless of kitchen path.",
    executionClass: "must_now",
    status: "open",
    riskLevel: "high",
    estimatedLowCents: 1500000,
    estimatedHighCents: 3500000,
  },
  {
    title: "Demo existing upstairs kitchen",
    description: "Mandatory demolition scope regardless of final kitchen destination.",
    executionClass: "must_now",
    status: "open",
    riskLevel: "medium",
    estimatedLowCents: 400000,
    estimatedHighCents: 1200000,
  },
  {
    title: "Primary suite bathroom remodel",
    description: "Full primary bath remodel target with laundry-upstairs compatibility.",
    executionClass: "must_now",
    status: "open",
    riskLevel: "medium",
    estimatedLowCents: 4500000,
    estimatedHighCents: 6000000,
  },
  {
    title: "Hall bathroom remodel / relocation decision",
    description:
      "Evaluate keep-in-place vs relocate for Jack-and-Jill and plumbing alignment.",
    executionClass: "option",
    status: "researching",
    riskLevel: "high",
    optionGroup: "hall_bath_path",
    optionKey: "keep_or_relocate",
    estimatedLowCents: 2500000,
    estimatedHighCents: 5000000,
  },
  {
    title: "Guest bathroom downstairs remodel",
    description: "Complete downstairs guest bath remodel baseline scope.",
    executionClass: "must_now",
    status: "open",
    riskLevel: "medium",
    estimatedLowCents: 2500000,
    estimatedHighCents: 3500000,
  },
  {
    title: "Laundry relocation upstairs + 220V refeed",
    description:
      "Move laundry upstairs with electrical refeed and plumbing connection at chosen location.",
    executionClass: "must_now",
    status: "researching",
    riskLevel: "high",
    estimatedLowCents: 300000,
    estimatedHighCents: 1200000,
  },
  {
    title: "Downstairs openings option: slider expansion + serving window strategy",
    description:
      "Track selection between expanded slider, plain window, or pass-through/serving window configurations.",
    executionClass: "option",
    status: "researching",
    riskLevel: "high",
    optionGroup: "downstairs_openings",
    optionKey: "slider_window_mix",
    estimatedLowCents: 1000000,
    estimatedHighCents: 5000000,
  },
  {
    title: "Window and sliding-door modernization program",
    description:
      "Track phased replacement strategy for front bay, kitchen, downstairs sliders, and office slider.",
    executionClass: "future_tbd",
    status: "researching",
    riskLevel: "high",
    estimatedLowCents: 2500000,
    estimatedHighCents: 9000000,
  },
  {
    title: "Skylight code compliance and light-well enclosure study",
    description:
      "Assess property-line code constraints, enclosure feasibility, and phased implementation.",
    executionClass: "future_tbd",
    status: "researching",
    riskLevel: "high",
    estimatedLowCents: 500000,
    estimatedHighCents: 3000000,
  },
  {
    title: "Front-door push-out expansion",
    description:
      "Potential future project: move front door outward and redesign enclosed porch entry.",
    executionClass: "future_tbd",
    status: "researching",
    riskLevel: "medium",
    estimatedLowCents: 1500000,
    estimatedHighCents: 2500000,
  },
  {
    title: "Landscape reserve (planting, irrigation, lighting)",
    description:
      "Budget reserve for post-construction landscaping, planters, irrigation, and low-voltage lighting.",
    executionClass: "future_tbd",
    status: "researching",
    riskLevel: "medium",
    estimatedLowCents: 500000,
    estimatedHighCents: 2000000,
  },
  {
    title: "Backyard hardscape + planter facade reserve",
    description:
      "Reserve for rusted-metal planter/facade accents and selective retaining-wall aesthetic improvements.",
    executionClass: "future_tbd",
    status: "researching",
    riskLevel: "medium",
    estimatedLowCents: 300000,
    estimatedHighCents: 1500000,
  },
];

budgetTrackerRouter.post("/bootstrap-homeowner-plan", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      changedBy?: string;
      overwriteActiveItems?: boolean;
    };
    const db = drizzle(c.env.DB);
    const now = new Date();

    if (body.overwriteActiveItems === true) {
      await db
        .update(budgetTrackerItems)
        .set({
          isActive: false,
          replacedAt: now,
          datetimeUpdated: now,
          changeSource: "bootstrap_overwrite",
          changedBy: normalizeString(body.changedBy) || "system",
        })
        .where(eq(budgetTrackerItems.isActive, true))
        .run();
    }

    const activeRows = await db
      .select({
        title: budgetTrackerItems.title,
      })
      .from(budgetTrackerItems)
      .where(eq(budgetTrackerItems.isActive, true))
      .all();

    const activeTitles = new Set(activeRows.map((row) => row.title.trim().toLowerCase()));
    const toInsert = HOMEOWNER_BOOTSTRAP_ITEMS.filter(
      (row) => !activeTitles.has(row.title.trim().toLowerCase()),
    );

    for (const item of toInsert) {
      await db.insert(budgetTrackerItems).values({
        trackId: crypto.randomUUID(),
        revisionNumber: 1,
        isActive: true,
        isDraft: true,
        itemType: item.itemType || "project",
        executionClass: item.executionClass,
        optionGroup: item.optionGroup || null,
        optionKey: item.optionKey || null,
        title: item.title,
        description: item.description,
        status: item.status,
        riskLevel: item.riskLevel,
        isBottleneck: item.isBottleneck ?? false,
        bottleneckReason: item.bottleneckReason || null,
        estimatedLowCents: item.estimatedLowCents || null,
        estimatedHighCents: item.estimatedHighCents || null,
        changeSource: "homeowner_bootstrap",
        changedBy: normalizeString(body.changedBy) || "system",
        datetimeCreated: now,
        datetimeUpdated: now,
      });
    }

    const defaultProjectInfo = [
      { infoKey: "project_name", infoLabel: "Project name", infoValue: "126 Colby Remodel", notes: null as string | null },
      { infoKey: "project_description", infoLabel: "Project description", infoValue: null as string | null, notes: null as string | null },
      { infoKey: "contractor_name", infoLabel: "Contractor", infoValue: null as string | null, notes: null as string | null },
      { infoKey: "license_number", infoLabel: "Licensed/Bonded number", infoValue: null as string | null, notes: null as string | null },
      { infoKey: "contact_name", infoLabel: "Contact name", infoValue: null as string | null, notes: null as string | null },
      { infoKey: "website", infoLabel: "Website", infoValue: null as string | null, notes: null as string | null },
      { infoKey: "phone", infoLabel: "Phone", infoValue: null as string | null, notes: null as string | null },
      { infoKey: "address", infoLabel: "Address", infoValue: null as string | null, notes: null as string | null },
    ];
    for (const row of defaultProjectInfo) {
      await db
        .insert(budgetProjectInfo)
        .values({
          ...row,
          datetimeCreated: now,
          datetimeUpdated: now,
        })
        .onConflictDoNothing();
    }

    const defaultFundingAccounts = [
      { accountKey: "cash_amount", accountLabel: "Cash amount", amountCents: 0 },
      { accountKey: "financed_amount", accountLabel: "Financed amount", amountCents: 0 },
    ];
    for (const row of defaultFundingAccounts) {
      await db
        .insert(budgetFundingAccounts)
        .values({
          ...row,
          notes: null,
          datetimeCreated: now,
          datetimeUpdated: now,
        })
        .onConflictDoNothing();
    }

    await emitBudgetRealtime(c.env, {
      event: "budget.bootstrap.completed",
      inserted: toInsert.length,
      skippedExisting: HOMEOWNER_BOOTSTRAP_ITEMS.length - toInsert.length,
    });

    return c.json({
      success: true,
      inserted: toInsert.length,
      skippedExisting: HOMEOWNER_BOOTSTRAP_ITEMS.length - toInsert.length,
      totalTemplateItems: HOMEOWNER_BOOTSTRAP_ITEMS.length,
      seededProjectInfo: defaultProjectInfo.length,
      seededFundingAccounts: defaultFundingAccounts.length,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to bootstrap homeowner budget plan",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

budgetTrackerRouter.get("/realtime", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 400);
  }

  const id = c.env.ESTIMATE_COLLAB.idFromName("budget");
  const stub = c.env.ESTIMATE_COLLAB.get(id);

  return stub.fetch(c.req.raw);
});

export { budgetTrackerRouter };

// --- AppsScript Integration Routes ---
import { budgetRows, budgetRowRevisions, syncSessions } from '../../db/schema/home/budget_tracking';

budgetTrackerRouter.get('/appsscript/pull', async (c) => {
  const db_instance = drizzle(c.env.DB);
  const activeRows = await db_instance.select().from(budgetRows).where(eq(budgetRows.isActive, true));

  // Fetch latest revision for each active row
  const rowsWithRevisions = await Promise.all(activeRows.map(async (row) => {
    const latestRevision = await db_instance.select()
      .from(budgetRowRevisions)
      .where(eq(budgetRowRevisions.budgetRowId, row.id))
      .orderBy(desc(budgetRowRevisions.createdAt))
      .limit(1)
      .get();

    return {
      ...row,
      costExpression: latestRevision?.costExpression || '0',
    };
  }));

  // Create a sync session
  const sessionId = crypto.randomUUID();
  await db_instance.insert(syncSessions).values({
    id: sessionId,
    type: 'PULL_SYNC',
    timestamp: new Date(),
    payload: JSON.stringify(rowsWithRevisions),
  });

  return c.json({ data: rowsWithRevisions, sessionId });
});

budgetTrackerRouter.post('/appsscript/push', async (c) => {
  const body = await c.req.json();
  const incomingRecords: any[] = body.data;
  const db_instance = drizzle(c.env.DB);

  if (!Array.isArray(incomingRecords)) {
    return c.json({ error: 'Invalid payload, expected array in data field' }, 400);
  }

  const sessionId = crypto.randomUUID();

  // We don't have transaction support for D1 via tx wrapper cleanly mapped in this env setup directly
  // Emulating batch / individual statements as transactions aren't always fully available in this drizzle-orm/d1 version

  // 1. Create a sync session
  await db_instance.insert(syncSessions).values({
    id: sessionId,
    type: 'PUSH_UPDATE',
    timestamp: new Date(),
    payload: JSON.stringify(incomingRecords),
  });

  const incomingRowIds = incomingRecords.map(r => r.id).filter(id => id);

  // 2. Identify missing items: set is_active = false for IDs in DB not in incoming payload
  const existingActiveRows = await db_instance.select().from(budgetRows).where(eq(budgetRows.isActive, true));
  const activeRowIds = existingActiveRows.map(r => r.id);

  const missingIds = activeRowIds.filter(id => !incomingRowIds.includes(id));
  if (missingIds.length > 0) {
    await db_instance.update(budgetRows)
      .set({ isActive: false })
      .where(inArray(budgetRows.id, missingIds));
  }

  // 3. Process incoming records
  for (const record of incomingRecords) {
    // Upsert budget_row
    const existingRow = existingActiveRows.find(r => r.id === record.id);

    if (!existingRow) {
      // Insert new row
      await db_instance.insert(budgetRows).values({
        id: record.id,
        category: record.category || 'Uncategorized',
        itemName: record.itemName || 'New Item',
        description: record.description || '',
        isActive: true,
      }).onConflictDoUpdate({
         target: budgetRows.id,
         set: {
           category: record.category || 'Uncategorized',
           itemName: record.itemName || 'New Item',
           description: record.description || '',
           isActive: true,
         }
      });
    } else {
      // Update existing row if metadata changed
      if (existingRow.category !== record.category || existingRow.itemName !== record.itemName || existingRow.description !== record.description) {
          await db_instance.update(budgetRows).set({
              category: record.category || existingRow.category,
              itemName: record.itemName || existingRow.itemName,
              description: record.description || existingRow.description,
          }).where(eq(budgetRows.id, record.id));
      }
    }

    // Check if revision needs to be added (value changed)
    const latestRevision = await db_instance.select()
      .from(budgetRowRevisions)
      .where(eq(budgetRowRevisions.budgetRowId, record.id))
      .orderBy(desc(budgetRowRevisions.createdAt))
      .limit(1)
      .get();

    if (!latestRevision || latestRevision.costExpression !== record.costExpression) {
      await db_instance.insert(budgetRowRevisions).values({
        budgetRowId: record.id,
        costExpression: record.costExpression || '0',
        sessionId: sessionId,
        createdAt: new Date(),
      });
    }
  }

  return c.json({ success: true, sessionId });
});
