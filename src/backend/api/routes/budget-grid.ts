/**
 * @fileoverview 0035 time-phased budget grid — read API, plan-schedule inline
 * edit, and idempotent seed.
 *
 * Feeds the phase -> line-item grid the frontend rebuilds from
 * `RemodelBudgetGrid.dc.html` (monthly columns, Estimate/Actuals/Variance
 * views, scorecards, per-phase progress rings, per-line variance flags,
 * footer rollups). The heavy month-bucketing/variance math lives in the pure,
 * unit-tested `budget-grid-math.ts` sibling — this file is I/O only: read
 * D1, shape the query into that helper's input, shape its output into the
 * response envelope.
 *
 * Mounted at `/api/budget` in `src/backend/api/index.ts`, behind the same
 * `requireAccessAuth` gate as `/api/budget-tracker`.
 */

import type { BatchItem } from "drizzle-orm/batch";

import {
  budgetExpenseEntries,
  budgetFundingAccounts,
  budgetPhases,
  budgetPlanSchedule,
  budgetTrackerItems,
} from "@backend/db";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

import { computeGridMath, deriveMonthWindow, secondsToMonth } from "./budget-grid-math";
import { emitBudgetRealtime } from "./budget-tracker";

const budgetGridRouter = new Hono<{ Bindings: Env }>();

const PERIOD_RE = /^\d{4}-\d{2}$/;

function normalizeString(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value.length > 0 ? value : null;
}

// --- Deliverable A: GET /api/budget/grid --------------------------------

budgetGridRouter.get("/grid", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const fromParam = normalizeString(c.req.query("from"));
    const toParam = normalizeString(c.req.query("to"));
    const phaseParam = normalizeString(c.req.query("phase"));
    const qParam = normalizeString(c.req.query("q"));

    if (fromParam && !PERIOD_RE.test(fromParam)) {
      return c.json({ error: "Invalid 'from' — expected YYYY-MM" }, 400);
    }
    if (toParam && !PERIOD_RE.test(toParam)) {
      return c.json({ error: "Invalid 'to' — expected YYYY-MM" }, 400);
    }

    const [items, phaseDefs, planRows, expenseRows, fundingAccounts] = await Promise.all([
      db.select().from(budgetTrackerItems).where(eq(budgetTrackerItems.isActive, true)).all(),
      db
        .select()
        .from(budgetPhases)
        .where(eq(budgetPhases.isActive, true))
        .orderBy(budgetPhases.sortOrder)
        .all(),
      db.select().from(budgetPlanSchedule).all(),
      db.select().from(budgetExpenseEntries).where(eq(budgetExpenseEntries.isActive, true)).all(),
      db.select().from(budgetFundingAccounts).all(),
    ]);

    // --- Month window ---
    // Collected once, up front: every period present in the plan schedule
    // plus every expense's dateIncurred month, across the WHOLE dataset (not
    // phase/q-filtered — the window brief describes is data-wide).
    const periodsPresent: string[] = planRows.map((row) => row.period);
    for (const expense of expenseRows) {
      if (expense.dateIncurred) {
        periodsPresent.push(secondsToMonth(Math.floor(expense.dateIncurred.getTime() / 1000)));
      }
    }

    let months: string[];
    if (fromParam && toParam) {
      // Explicit bounds are never truncated to the 12-month cap — that cap
      // only applies to the derived-from-data windows below.
      months = fillMonthRange(fromParam, toParam);
    } else if (fromParam) {
      // Only a lower bound given: extend the upper bound OUT to the data's
      // latest period (never just a single degenerate month), capped to 12.
      const forward = periodsPresent.filter((p) => p >= fromParam).sort();
      const to = forward.length > 0 ? forward[forward.length - 1] : fromParam;
      months = fillMonthRange(fromParam, to).slice(0, 12);
    } else if (toParam) {
      // Only an upper bound given: extend the lower bound BACK to the data's
      // earliest period, capped to the most recent 12 months ending at `to`.
      const backward = periodsPresent.filter((p) => p <= toParam).sort();
      const from = backward.length > 0 ? backward[0] : toParam;
      const filled = fillMonthRange(from, toParam);
      months = filled.length > 12 ? filled.slice(filled.length - 12) : filled;
    } else {
      months = deriveMonthWindow(periodsPresent, 12);
      // ponytail: brief allows an empty `months` array as the "no data at all"
      // fallback instead of a Date.now()-derived 5-month default, to keep this
      // handler deterministic. See task-1-brief.md "Month window".
    }

    const gridInput = {
      months,
      items: items.map((row) => ({
        id: row.id,
        trackId: row.trackId,
        label: row.title,
        phaseId: row.phaseId,
        varianceNoteMarkdown: row.varianceNoteMarkdown,
      })),
      phaseDefs: phaseDefs.map((row) => ({
        id: row.id,
        name: row.name,
        tone: row.tone,
        sortOrder: row.sortOrder,
      })),
      planRows: planRows.map((row) => ({
        budgetItemTrackId: row.budgetItemTrackId,
        period: row.period,
        plannedCents: row.plannedCents,
      })),
      expenseRows: expenseRows.map((row) => ({
        budgetItemTrackId: row.budgetItemTrackId,
        amountCents: row.amountCents,
        dateIncurred: row.dateIncurred ? Math.floor(row.dateIncurred.getTime() / 1000) : null,
      })),
      phaseFilter: phaseParam,
      q: qParam,
    };

    const { months: monthOut, phases } = computeGridMath(gridInput);

    const monthPlanTotals = Array.from({ length: monthOut.length }, () => 0);
    const monthActualTotals = Array.from({ length: monthOut.length }, () => 0);
    for (const phase of phases) {
      for (let i = 0; i < monthOut.length; i += 1) {
        monthPlanTotals[i] += phase.plan[i];
        monthActualTotals[i] += phase.actual[i];
      }
    }

    // --- Scorecards: whole project, independent of from/to/phase/q ---
    const totalBudgetCents = fundingAccounts.reduce((sum, row) => sum + row.amountCents, 0);
    const spentCents = expenseRows.reduce((sum, row) => sum + row.amountCents, 0);
    const remainingCents = totalBudgetCents - spentCents;
    const estimateCents = planRows.reduce((sum, row) => sum + row.plannedCents, 0);
    const varianceCents = estimateCents - spentCents;
    const pctUsed = totalBudgetCents > 0 ? Math.round((100 * spentCents) / totalBudgetCents) : 0;

    return c.json({
      grid: {
        months: monthOut,
        phases,
        footer: {
          fundingCents: totalBudgetCents,
          monthPlanTotals,
          monthActualTotals,
        },
        scorecards: {
          totalBudgetCents,
          spentCents,
          remainingCents,
          estimateCents,
          varianceCents,
          pctUsed,
          lineItemCount: items.length,
          phaseCount: phaseDefs.length,
        },
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load budget grid",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/** Fill every 'YYYY-MM' between from and to inclusive (from <= to), no cap. */
function fillMonthRange(from: string, to: string): string[] {
  if (!PERIOD_RE.test(from) || !PERIOD_RE.test(to)) return [];
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const months: string[] = [];
  let cursor = lo;
  // Bail out past a sane ceiling so a malformed pair can't loop forever.
  let guard = 0;
  while (cursor <= hi && guard < 1000) {
    months.push(cursor);
    const [y, m] = cursor.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    cursor = next;
    guard += 1;
  }
  return months;
}

// --- Deliverable B: PATCH /api/budget/plan-schedule ----------------------

const planSchedulePatchSchema = z.object({
  trackId: z.string().min(1),
  period: z.string().regex(PERIOD_RE, "period must be YYYY-MM"),
  plannedCents: z.number().int().min(0),
  plannedText: z.string().optional(),
});

budgetGridRouter.patch("/plan-schedule", async (c) => {
  try {
    const body = planSchedulePatchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: "Invalid body", details: body.error.flatten() }, 400);
    }
    const { trackId, period, plannedCents, plannedText } = body.data;
    const db = drizzle(c.env.DB);

    const activeItem = await db
      .select({ trackId: budgetTrackerItems.trackId })
      .from(budgetTrackerItems)
      .where(and(eq(budgetTrackerItems.trackId, trackId), eq(budgetTrackerItems.isActive, true)))
      .get();
    if (!activeItem) {
      return c.json({ error: "No active budget item for that trackId" }, 404);
    }

    const now = new Date();
    await db
      .insert(budgetPlanSchedule)
      .values({
        budgetItemTrackId: trackId,
        period,
        plannedCents,
        plannedText: plannedText ?? null,
        source: "manual",
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .onConflictDoUpdate({
        target: [budgetPlanSchedule.budgetItemTrackId, budgetPlanSchedule.period],
        set: {
          plannedCents,
          plannedText: plannedText ?? null,
          source: "manual",
          datetimeUpdated: now,
        },
      })
      .run();

    // Drizzle's D1 driver doesn't reliably support .returning() chained after
    // onConflictDoUpdate, so read the row back by its unique key instead of
    // trusting the insert result.
    const row = await db
      .select()
      .from(budgetPlanSchedule)
      .where(
        and(
          eq(budgetPlanSchedule.budgetItemTrackId, trackId),
          eq(budgetPlanSchedule.period, period),
        ),
      )
      .get();

    await emitBudgetRealtime(c.env, {
      event: "budget.plan_schedule.updated",
      trackId,
      period,
      plannedCents,
    });

    return c.json({ success: true, row });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update plan schedule",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// --- Deliverable C: POST /api/budget/grid/seed (idempotent) --------------

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

budgetGridRouter.post("/grid/seed", async (c) => {
  try {
    const db = drizzle(c.env.DB);

    // --- 1. Plan seed: one row per active estimated item, at its
    // datetimeCreated month, midpoint of low/high, never overwriting an
    // existing row (onConflictDoNothing on the unique line+period key). ---
    const activeItems = await db
      .select({
        trackId: budgetTrackerItems.trackId,
        title: budgetTrackerItems.title,
        estimatedLowCents: budgetTrackerItems.estimatedLowCents,
        estimatedHighCents: budgetTrackerItems.estimatedHighCents,
        datetimeCreated: budgetTrackerItems.datetimeCreated,
      })
      .from(budgetTrackerItems)
      .where(eq(budgetTrackerItems.isActive, true))
      .all();

    const now = new Date();
    const planCandidates = activeItems.flatMap((item) => {
      const low = item.estimatedLowCents;
      const high = item.estimatedHighCents;
      if (low === null && high === null) return [];
      const midpoint = Math.round(((low ?? high!) + (high ?? low!)) / 2);
      const period = secondsToMonth(Math.floor(item.datetimeCreated.getTime() / 1000));
      return [
        {
          budgetItemTrackId: item.trackId,
          period,
          plannedCents: midpoint,
          plannedText: null,
          source: "seed_estimate",
          datetimeCreated: now,
          datetimeUpdated: now,
        },
      ];
    });

    // Check pre-existence up front so plansSeeded/plansSkipped are exact —
    // onConflictDoNothing alone can't tell us which rows it skipped.
    const existingKeys = new Set(
      (
        await db
          .select({
            budgetItemTrackId: budgetPlanSchedule.budgetItemTrackId,
            period: budgetPlanSchedule.period,
          })
          .from(budgetPlanSchedule)
          .all()
      ).map((row) => `${row.budgetItemTrackId}::${row.period}`),
    );
    const toInsert = planCandidates.filter(
      (candidate) => !existingKeys.has(`${candidate.budgetItemTrackId}::${candidate.period}`),
    );
    const plansSkipped = planCandidates.length - toInsert.length;

    // D1 caps a single statement at 100 bound params. A multi-row
    // `.values(batch)` insert binds rows*columns in ONE statement — 7
    // columns here, so a 20-row chunk would bind 140 and D1 would reject it
    // with "too many SQL variables" the moment there are >~14 active
    // estimated items. Fix: one INSERT statement per row (7 params each,
    // nowhere near the cap), grouped into `db.batch()` calls of up to 20
    // statements so nothing runs unbatched. onConflictDoNothing is still the
    // safety net against a race with another writer between the existence
    // check above and this insert (D1 has no transactions to close that
    // window) — never overwrite.
    for (const rowsChunk of chunk(toInsert, 20)) {
      if (rowsChunk.length === 0) continue;
      const stmts: BatchItem<"sqlite">[] = rowsChunk.map((row) =>
        db.insert(budgetPlanSchedule).values(row).onConflictDoNothing(),
      );
      await db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    }
    const plansSeeded = toInsert.length;

    // --- 2. Expense attribution: confident exact-title match only. ---
    const unattributedExpenses = await db
      .select({
        id: budgetExpenseEntries.id,
        item: budgetExpenseEntries.item,
      })
      .from(budgetExpenseEntries)
      .where(
        and(
          eq(budgetExpenseEntries.isActive, true),
          isNull(budgetExpenseEntries.budgetItemTrackId),
        ),
      )
      .all();

    const titleIndex = new Map<string, string[]>();
    for (const row of activeItems) {
      const key = row.title.trim().toLowerCase();
      const list = titleIndex.get(key) ?? [];
      list.push(row.trackId);
      titleIndex.set(key, list);
    }

    let expensesAttributed = 0;
    let expensesSkipped = 0;
    // Sequential single-row UPDATEs, not a batched multi-value statement, so
    // there's no D1 100-bound-param exposure here (each statement binds
    // budgetItemTrackId + datetimeUpdated + the id in WHERE — 3 params).
    // Read-then-write, not atomic (D1 has no transactions): between the read
    // above and each update below another writer could change the picture.
    // Acceptable here — this is an idempotent, re-runnable best-effort seed,
    // not a financial ledger post.
    for (const expense of unattributedExpenses) {
      const candidates = titleIndex.get(expense.item.trim().toLowerCase()) ?? [];
      if (candidates.length !== 1) {
        expensesSkipped += 1;
        continue;
      }
      await db
        .update(budgetExpenseEntries)
        .set({ budgetItemTrackId: candidates[0], datetimeUpdated: new Date() })
        .where(eq(budgetExpenseEntries.id, expense.id))
        .run();
      expensesAttributed += 1;
    }

    await emitBudgetRealtime(c.env, {
      event: "budget.grid.seeded",
      plansSeeded,
      plansSkipped,
      expensesAttributed,
      expensesSkipped,
    });

    return c.json({ plansSeeded, plansSkipped, expensesAttributed, expensesSkipped });
  } catch (error) {
    return c.json(
      {
        error: "Failed to seed budget grid",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { budgetGridRouter };
