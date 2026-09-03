/**
 * @fileoverview Budget Command Center — time-phased budget grid read API and
 * inline plan-schedule edit, plus the pre-existing idempotent seed.
 *
 * `GET /grid` and `PATCH /plan-schedule` implement
 * `docs/plans/budget-command-center/API-CONTRACT.md` §2 exactly — a frontend
 * agent (`src/frontend/lib/budget-api.ts`, `src/frontend/components/budget/`)
 * is already coding against that shape: `months[].key`, `phases[].rows[]`
 * each carrying a `cells` map keyed by month, a row total + variance, a
 * per-phase subtotal, and a `footer` of whole-project figures. All D1 access
 * happens in this file per the task's file-ownership split; the pure
 * pivot/aggregation math lives in the sibling `budget-grid-math.ts` so it's
 * unit-testable without a Worker (see `pivotBudgetGrid` there, and its
 * self-check `scripts/tests/test_budget_grid_pivot.mjs`).
 *
 * KNOWN GAP — vendor: the contract wants `vendorId`/`vendorLabel` from a JOIN
 * (never a stored column), but `budget_tracker_items` (the planned line
 * items this grid rows over) has no vendor FK at all — only
 * `budget_expense_entries.vendorName`, a denormalized text column on the
 * ACTUALS table, unrelated to a specific line item. Every row therefore
 * ships `vendorId: null, vendorLabel: null` today. Fixing this needs a real
 * `vendors` table + FK column on `budget_tracker_items`, which is schema
 * work outside this task's two-file ownership — flagged, not silently
 * fabricated.
 *
 * KNOWN INCOMPATIBILITY — GET shape vs. the already-shipped
 * `src/frontend/components/BudgetGridApp.tsx` island: that component reads
 * the OLD `{ grid: { months[].period, phases[].lines[].plan[]/.actual[] } }`
 * shape (via `services/budget/grid.ts` loadBudgetGrid, still used unchanged
 * by the `get_budget_grid` MCP tool — untouched here, out of file scope).
 * This route now returns the NEW unwrapped `{ months, phases, footer }`
 * shape per the contract, which `BudgetGridApp.tsx` cannot parse. The two
 * shapes cannot coexist on one GET route; per the task brief this contract
 * is authoritative, so `BudgetGridApp.tsx` needs to be retired/replaced by
 * whoever owns the frontend swap to the new `components/budget/` island —
 * not done here, frontend is out of scope for this task.
 *
 * PATCH, by contrast, DOES stay backward compatible (the task asked for
 * this explicitly): it accepts both the new single-cell body
 * `{ lineItemId, month, plannedCents }` and the old
 * `{ trackId, period, plannedCents, plannedText }` body `BudgetGridApp.tsx`
 * already sends — see the dual-shape parse below.
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
// Read-only dependency on the sibling grid SERVICE (out of this task's file
// ownership — never edited): just its exported regex, so the route and the
// still-independent `get_budget_grid` MCP tool validate 'YYYY-MM' identically.
import { PERIOD_RE } from "@backend/services/budget/grid";
import { and, eq, gte, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

import {
  addMonths,
  monthsBetween,
  monthStartEpochSeconds,
  pivotBudgetGrid,
  secondsToMonth,
  type FlatActualRow,
  type FlatPlanRow,
  type PivotLineItem,
  type PivotPhaseDef,
} from "./budget-grid-math";
import { emitBudgetRealtime } from "./budget-tracker";

const budgetGridRouter = new Hono<{ Bindings: Env }>();

// --- Deliverable A: GET /api/budget/grid --------------------------------

const getGridQuerySchema = z.object({
  from: z.string().regex(PERIOD_RE, "'from' must be YYYY-MM"),
  to: z.string().regex(PERIOD_RE, "'to' must be YYYY-MM"),
  view: z.enum(["estimate", "actuals", "variance"]),
});

budgetGridRouter.get("/grid", async (c) => {
  try {
    const parsedQuery = getGridQuerySchema.safeParse({
      from: c.req.query("from"),
      to: c.req.query("to"),
      view: c.req.query("view"),
    });
    if (!parsedQuery.success) {
      return c.json({ error: "Invalid query", details: parsedQuery.error.flatten() }, 400);
    }
    // `view` is validated but doesn't change what's queried: every cell
    // always carries both plannedCents and actualCents, and the three views
    // (Estimate/Actuals/Variance) are a client-side display choice over that
    // same data — see `BudgetGridCell` in `src/frontend/lib/budget-api.ts`.
    const [lo, hi] =
      parsedQuery.data.from <= parsedQuery.data.to
        ? [parsedQuery.data.from, parsedQuery.data.to]
        : [parsedQuery.data.to, parsedQuery.data.from];

    const months = monthsBetween(lo, hi);
    const fromEpochSeconds = monthStartEpochSeconds(lo);
    // Half-open [start, end) on the indexed epoch-seconds column — cheaper
    // than filtering on a computed strftime() expression, which SQLite can't
    // use an index for.
    const toEpochSecondsExclusive = monthStartEpochSeconds(addMonths(hi, 1));

    const db = drizzle(c.env.DB);
    const monthExpr = sql<string>`strftime('%Y-%m', ${budgetExpenseEntries.dateIncurred}, 'unixepoch')`;

    // Independent SELECTs for this one screen -> one db.batch() -> one D1
    // round trip (D1-DRIZZLE-RULES.md §2). Per §6, the monthly rollup is a
    // flat grouped query (plan needs no GROUP BY — the unique index on
    // (budgetItemTrackId, period) already guarantees at most one row per
    // line+month; actual is GROUP BY trackId + strftime month, since several
    // expense entries can land in the same line+month), pivoted to month
    // columns by `pivotBudgetGrid` in budget-grid-math.ts.
    const [phaseRows, itemRows, planRows, actualRows, fundingRows, spentAllTimeRows] =
      await db.batch([
        db
          .select({ id: budgetPhases.id, name: budgetPhases.name, sortOrder: budgetPhases.sortOrder })
          .from(budgetPhases)
          .where(eq(budgetPhases.isActive, true))
          .orderBy(budgetPhases.sortOrder),
        db
          .select({
            id: budgetTrackerItems.id,
            trackId: budgetTrackerItems.trackId,
            title: budgetTrackerItems.title,
            phaseId: budgetTrackerItems.phaseId,
            note: budgetTrackerItems.varianceNoteMarkdown,
          })
          .from(budgetTrackerItems)
          .where(eq(budgetTrackerItems.isActive, true)),
        db
          .select({
            trackId: budgetPlanSchedule.budgetItemTrackId,
            period: budgetPlanSchedule.period,
            plannedCents: budgetPlanSchedule.plannedCents,
          })
          .from(budgetPlanSchedule)
          .where(and(gte(budgetPlanSchedule.period, lo), lte(budgetPlanSchedule.period, hi))),
        db
          .select({
            trackId: budgetExpenseEntries.budgetItemTrackId,
            period: monthExpr,
            actualCents: sql<number>`sum(${budgetExpenseEntries.amountCents})`,
          })
          .from(budgetExpenseEntries)
          .where(
            and(
              eq(budgetExpenseEntries.isActive, true),
              isNotNull(budgetExpenseEntries.budgetItemTrackId),
              isNotNull(budgetExpenseEntries.dateIncurred),
              gte(budgetExpenseEntries.dateIncurred, new Date(fromEpochSeconds * 1000)),
              lt(budgetExpenseEntries.dateIncurred, new Date(toEpochSecondsExclusive * 1000)),
            ),
          )
          .groupBy(budgetExpenseEntries.budgetItemTrackId, monthExpr),
        db
          .select({
            totalCents: sql<number>`coalesce(sum(${budgetFundingAccounts.amountCents}), 0)`,
          })
          .from(budgetFundingAccounts),
        db
          .select({ spentCents: sql<number>`coalesce(sum(${budgetExpenseEntries.amountCents}), 0)` })
          .from(budgetExpenseEntries)
          .where(eq(budgetExpenseEntries.isActive, true)),
      ]);

    const pivotItems: PivotLineItem[] = itemRows.map((row) => ({
      id: row.id,
      trackId: row.trackId,
      title: row.title,
      phaseId: row.phaseId,
      note: row.note,
      // See the file header "KNOWN GAP — vendor": no FK exists yet.
      vendorId: null,
      vendorLabel: null,
    }));
    const pivotPhaseDefs: PivotPhaseDef[] = phaseRows.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
    }));
    const flatPlanRows: FlatPlanRow[] = planRows.map((row) => ({
      trackId: row.trackId,
      period: row.period,
      plannedCents: row.plannedCents,
    }));
    const flatActualRows: FlatActualRow[] = actualRows
      .filter((row): row is typeof row & { trackId: string } => row.trackId !== null)
      .map((row) => ({ trackId: row.trackId, period: row.period, actualCents: row.actualCents }));

    const { months: monthsOut, phases } = pivotBudgetGrid(
      months,
      pivotItems,
      pivotPhaseDefs,
      flatPlanRows,
      flatActualRows,
    );

    // Footer: whole-project figures, independent of the visible window (same
    // convention the old service's `scorecards` used) — except netBurnCents,
    // which is a rate over the visible window by definition.
    const totalFundingCents = fundingRows[0]?.totalCents ?? 0;
    const spentAllTimeCents = spentAllTimeRows[0]?.spentCents ?? 0;
    const availableBudgetCents = totalFundingCents - spentAllTimeCents;
    const spentInWindowCents = flatActualRows.reduce((sum, row) => sum + row.actualCents, 0);
    const netBurnCents = months.length > 0 ? Math.round(spentInWindowCents / months.length) : 0;

    return c.json({
      months: monthsOut,
      phases,
      footer: { availableBudgetCents, netBurnCents },
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

// --- Deliverable B: PATCH /api/budget/plan-schedule ----------------------
//
// Accepts two body shapes (see the file header "PATCH ... stays backward
// compatible"):
//   NEW  { lineItemId: number, month: string, plannedCents: number | null }
//   OLD  { trackId: string, period: string, plannedCents: number, plannedText?: string }
// `plannedCents: null` (new shape only) clears the cell — the column is
// NOT NULL, so that's a delete of the row, not a write of a null.

const newPlanSchedulePatchSchema = z.object({
  lineItemId: z.number().int(),
  month: z.string().regex(PERIOD_RE, "month must be YYYY-MM"),
  plannedCents: z.number().int().nullable(),
});

const oldPlanSchedulePatchSchema = z.object({
  trackId: z.string().min(1),
  period: z.string().regex(PERIOD_RE, "period must be YYYY-MM"),
  plannedCents: z.number().int().min(0),
  plannedText: z.string().optional(),
});

budgetGridRouter.patch("/plan-schedule", async (c) => {
  try {
    const raw: unknown = await c.req.json().catch(() => ({}));
    const isNewShape =
      typeof raw === "object" && raw !== null && !Array.isArray(raw) && "lineItemId" in raw;

    const db = drizzle(c.env.DB);

    let trackId: string;
    let period: string;
    let plannedCents: number | null;
    let plannedText: string | null = null;

    if (isNewShape) {
      const body = newPlanSchedulePatchSchema.safeParse(raw);
      if (!body.success) {
        return c.json({ error: "Invalid body", details: body.error.flatten() }, 400);
      }
      const activeItem = await db
        .select({ trackId: budgetTrackerItems.trackId })
        .from(budgetTrackerItems)
        .where(
          and(
            eq(budgetTrackerItems.id, body.data.lineItemId),
            eq(budgetTrackerItems.isActive, true),
          ),
        )
        .get();
      if (!activeItem) {
        return c.json({ error: "No active budget item for that lineItemId" }, 404);
      }
      trackId = activeItem.trackId;
      period = body.data.month;
      plannedCents = body.data.plannedCents;
    } else {
      const body = oldPlanSchedulePatchSchema.safeParse(raw);
      if (!body.success) {
        return c.json({ error: "Invalid body", details: body.error.flatten() }, 400);
      }
      const activeItem = await db
        .select({ trackId: budgetTrackerItems.trackId })
        .from(budgetTrackerItems)
        .where(
          and(
            eq(budgetTrackerItems.trackId, body.data.trackId),
            eq(budgetTrackerItems.isActive, true),
          ),
        )
        .get();
      if (!activeItem) {
        return c.json({ error: "No active budget item for that trackId" }, 404);
      }
      trackId = body.data.trackId;
      period = body.data.period;
      plannedCents = body.data.plannedCents;
      plannedText = body.data.plannedText ?? null;
    }

    if (plannedCents === null) {
      await db
        .delete(budgetPlanSchedule)
        .where(
          and(eq(budgetPlanSchedule.budgetItemTrackId, trackId), eq(budgetPlanSchedule.period, period)),
        )
        .run();
      await emitBudgetRealtime(c.env, {
        event: "budget.plan_schedule.updated",
        trackId,
        period,
        plannedCents: null,
      });
      return c.json({ success: true, row: null });
    }

    const now = new Date();
    await db
      .insert(budgetPlanSchedule)
      .values({
        budgetItemTrackId: trackId,
        period,
        plannedCents,
        plannedText,
        source: "manual",
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .onConflictDoUpdate({
        target: [budgetPlanSchedule.budgetItemTrackId, budgetPlanSchedule.period],
        set: {
          plannedCents,
          plannedText,
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
        and(eq(budgetExpenseEntries.isActive, true), isNull(budgetExpenseEntries.budgetItemTrackId)),
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
