/**
 * @fileoverview Budget Command Center workbench — shell summary, decision
 * inbox, and per-room finance rollup, read API.
 *
 * Mounted at `/api/budget` in `src/backend/api/index.ts`, alongside
 * `budget-grid.ts`'s `/grid`, `/plan-schedule`, `/grid/seed` (no path
 * collision — this router owns `/workbench-summary`, `/rooms-finance`, and
 * `/inbox`). Behind the same `requireAccessAuth` gate already applied to
 * `/api/budget/*`.
 *
 * Every query here follows `docs/plans/budget-command-center/D1-DRIZZLE-RULES.md`:
 * aggregation (SUM/COUNT) happens in SQL, never in JS; ranking happens via
 * `ORDER BY ... LIMIT` in SQL, never `.sort()` on a fetched array; a screen's
 * independent SELECTs share one `db.batch([...])` round trip; `db.transaction()`
 * is never used (dead on D1 — see the rules doc §5).
 *
 * This file deliberately does NOT call the old `services/budget/inbox.ts` /
 * `services/budget/rooms-finance.ts` helpers — those pull whole tables into JS
 * and reduce there, which is exactly the anti-pattern this rework replaces.
 * (Those services still back the `get_budget_inbox` MCP tool; out of scope
 * here — this file owns only the three routes below.)
 */
import {
  budgetExpenseEntries,
  budgetFundingAccounts,
  budgetProjectInfo,
  budgetReallocationLedger,
  budgetTrackerItemRooms,
  budgetTrackerItems,
  contractComplianceGates,
  contracts,
  estimateCompanies,
  estimateLineItems,
  estimateRevisions,
  materialScheduleItems,
  rooms,
} from "@backend/db";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { unionAll } from "drizzle-orm/sqlite-core";

const budgetWorkbenchRouter = new OpenAPIHono<{ Bindings: Env }>();

type Db = DrizzleD1Database;

// ─── Shared SQL fragments / subqueries ─────────────────────────────────────
// Reused across /workbench-summary, /inbox, and /rooms-finance so the same
// "what does committed/spent mean for a room" definition isn't hand-copied
// three times with three chances to drift.

/** Midpoint of an estimate range, computed IN SQL. 0 when both bounds are null. */
const MIDPOINT_EXPR = sql<number>`(coalesce(${budgetTrackerItems.estimatedLowCents}, ${budgetTrackerItems.estimatedHighCents}, 0) + coalesce(${budgetTrackerItems.estimatedHighCents}, ${budgetTrackerItems.estimatedLowCents}, 0)) / 2`;

/** One row per room: SUM(midpoint) over active budget-tracker items mapped to it. */
function committedByRoomSubquery(db: Db) {
  return db
    .select({
      roomId: budgetTrackerItemRooms.roomId,
      committedCents: sql<number>`coalesce(sum(${MIDPOINT_EXPR}), 0)`.as("committed_cents"),
    })
    .from(budgetTrackerItemRooms)
    .innerJoin(
      budgetTrackerItems,
      and(
        eq(budgetTrackerItems.id, budgetTrackerItemRooms.budgetTrackerItemId),
        eq(budgetTrackerItems.isActive, true),
      ),
    )
    .groupBy(budgetTrackerItemRooms.roomId)
    .as("committed_sub");
}

/** One row per room: SUM(amountCents) over active expense entries attributed to it. */
function spentByRoomSubquery(db: Db) {
  return db
    .select({
      roomId: budgetExpenseEntries.roomId,
      spentCents: sql<number>`coalesce(sum(${budgetExpenseEntries.amountCents}), 0)`.as(
        "spent_cents",
      ),
    })
    .from(budgetExpenseEntries)
    .where(eq(budgetExpenseEntries.isActive, true))
    .groupBy(budgetExpenseEntries.roomId)
    .as("spent_sub");
}

/** One row per room: COUNT of active, not-yet-purchased materials. */
function openMaterialsByRoomSubquery(db: Db) {
  return db
    .select({
      roomId: materialScheduleItems.roomId,
      openCount:
        sql<number>`coalesce(sum(case when ${materialScheduleItems.isPurchased} = 1 then 0 else 1 end), 0)`.as(
          "open_count",
        ),
    })
    .from(materialScheduleItems)
    .where(eq(materialScheduleItems.isActive, true))
    .groupBy(materialScheduleItems.roomId)
    .as("materials_sub");
}

/**
 * COUNT of active rooms whose active-expense spend exceeds their committed
 * (midpoint) budget. Shared by /workbench-summary's tabCounts.inbox and
 * /inbox's `total` — built ONCE per call so the join subqueries are the same
 * object instance the ON/WHERE clauses reference (never re-invoked mid-query).
 */
function overBudgetRoomsCountQuery(db: Db) {
  const committedSub = committedByRoomSubquery(db);
  const spentSub = spentByRoomSubquery(db);
  return db
    .select({ n: count() })
    .from(rooms)
    .leftJoin(committedSub, eq(committedSub.roomId, rooms.id))
    .leftJoin(spentSub, eq(spentSub.roomId, rooms.id))
    .where(
      and(
        eq(rooms.isActive, true),
        sql`coalesce(${spentSub.spentCents}, 0) > coalesce(${committedSub.committedCents}, 0)`,
      ),
    );
}

/** COUNT of estimate lines still actionable (unmapped/ai_suggested) on their latest revision. */
function inboxUnmappedEstimateCountQuery(db: Db) {
  return db
    .select({ n: count() })
    .from(estimateLineItems)
    .innerJoin(estimateRevisions, eq(estimateLineItems.estimateRevisionId, estimateRevisions.id))
    .where(
      and(
        inArray(estimateLineItems.mappingStatus, [...ESTIMATE_ACTIONABLE_STATUSES]),
        eq(estimateRevisions.isLatest, true),
      ),
    );
}

/** COUNT of contract compliance gates in a fail or warn state. */
function contractGateFailWarnCountQuery(db: Db) {
  return db
    .select({ n: count() })
    .from(contractComplianceGates)
    .where(inArray(contractComplianceGates.state, ["fail", "warn"]));
}

function riskLevel(spentCents: number, committedCents: number): "ok" | "watch" | "at_risk" {
  if (committedCents === 0 && spentCents > 0) return "at_risk"; // spend against zero commitment
  if (spentCents > committedCents && committedCents > 0) return "at_risk";
  if (committedCents > 0 && spentCents > 0.8 * committedCents) return "watch";
  return "ok";
}

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

// Estimate-line mapping-status vocabulary (mirrors the private MAPPING_STATUSES
// in api/routes/estimates.ts — not exported there, so restated here rather than
// reaching into another route file's internals).
const ESTIMATE_ACTIONABLE_STATUSES = ["unmapped", "ai_suggested"] as const;

// ─── Zod v4 response schemas (hand-written — never drizzle-zod) ───────────

const kpisSchema = z.object({
  totalBudgetCents: z.number().int(),
  fundingAccountCount: z.number().int(),
  spentToDateCents: z.number().int(),
  spentPctOfBudget: z.number(),
  remainingCents: z.number().int(),
  runwayMonths: z.number().nullable(),
  varianceVsEstimateCents: z.number().int(),
  varianceDirection: z.enum(["over", "under", "even"]),
});

const tabCountsSchema = z.object({
  inbox: z.number().int(),
  estimates: z.number().int(),
  rooms: z.number().int(),
  savings: z.number().int(),
  compliance: z.number().int(),
});

const workbenchSummarySchema = z.object({
  project: z.object({ name: z.string(), addressLine: z.string() }),
  kpis: kpisSchema,
  tabCounts: tabCountsSchema,
  decisionsWaiting: z.number().int(),
});

const inboxItemSchema = z.object({
  id: z.string(),
  severity: z.enum(["block", "warn", "info"]),
  title: z.string(),
  detail: z.string().nullable(),
  contextKind: z.enum(["vendor", "room", "contract", "estimate"]),
  contextId: z.number().int().nullable(),
  contextLabel: z.string().nullable(),
  exposureCents: z.number().int(),
  actionKind: z.enum(["review_contract", "request_change_order", "reconcile", "mark_resolved"]),
  actionHref: z.string(),
});

const inboxResponseSchema = z.object({
  items: z.array(inboxItemSchema),
  total: z.number().int(),
});

const roomFinanceSchema = z.object({
  roomId: z.number().int(),
  name: z.string(),
  committedCents: z.number().int(),
  spentCents: z.number().int(),
  remainingCents: z.number().int(),
  openMaterialsCount: z.number().int(),
  risk: z.enum(["ok", "watch", "at_risk"]),
});

const roomsFinanceResponseSchema = z.object({
  rooms: z.array(roomFinanceSchema),
  totals: z.object({
    committedCents: z.number().int(),
    spentCents: z.number().int(),
    remainingCents: z.number().int(),
    openMaterialsCount: z.number().int(),
  }),
});

const errorSchema = z.object({ error: z.string(), details: z.string().optional() });

// ─── GET /api/budget/workbench-summary ─────────────────────────────────────
// Fills the entire shell header in ONE D1 round trip (db.batch of 12
// independent, already-aggregated SELECTs).

budgetWorkbenchRouter.openapi(
  createRoute({
    method: "get",
    path: "/workbench-summary",
    summary: "Budget Command Center shell header — KPIs, tab counts, decision pill",
    description:
      "One D1 round trip via db.batch. Every number is a SQL SUM/COUNT; nothing is aggregated in JS.",
    responses: {
      200: {
        description: "Workbench summary",
        content: { "application/json": { schema: workbenchSummarySchema } },
      },
      500: { description: "Failed", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    try {
      const db = drizzle(c.env.DB);

      const fundingQuery = db
        .select({
          totalBudgetCents: sql<number>`coalesce(sum(${budgetFundingAccounts.amountCents}), 0)`,
          fundingAccountCount: count(),
        })
        .from(budgetFundingAccounts);

      const spentQuery = db
        .select({
          spentToDateCents: sql<number>`coalesce(sum(${budgetExpenseEntries.amountCents}), 0)`,
        })
        .from(budgetExpenseEntries)
        .where(eq(budgetExpenseEntries.isActive, true));

      // Trailing 90-day burn, in SQL — used to derive a monthly rate for runway.
      const burnQuery = db
        .select({
          trailingCents: sql<number>`coalesce(sum(${budgetExpenseEntries.amountCents}), 0)`,
        })
        .from(budgetExpenseEntries)
        .where(
          and(
            eq(budgetExpenseEntries.isActive, true),
            sql`${budgetExpenseEntries.dateIncurred} >= (unixepoch() - 7776000)`, // 90 days
          ),
        );

      const committedQuery = db
        .select({ committedCents: sql<number>`coalesce(sum(${MIDPOINT_EXPR}), 0)` })
        .from(budgetTrackerItems)
        .where(eq(budgetTrackerItems.isActive, true));

      const projectInfoQuery = db
        .select({ infoKey: budgetProjectInfo.infoKey, infoValue: budgetProjectInfo.infoValue })
        .from(budgetProjectInfo)
        .where(inArray(budgetProjectInfo.infoKey, ["project_name", "address"]));

      // tabCounts.inbox / decisionsWaiting = the same three sources unioned by
      // GET /inbox below, counted rather than fetched — kept in lockstep by
      // calling the identical shared query builders (defined above).
      const overBudgetRoomsCount = overBudgetRoomsCountQuery(db);
      const inboxUnmappedEstimateCount = inboxUnmappedEstimateCountQuery(db);
      const contractGateCount = contractGateFailWarnCountQuery(db);

      // tabCounts.estimates — a DIFFERENT filter than the inbox source above:
      // "not confirmed" (includes 'rejected'), per the API contract wording,
      // vs the inbox's narrower "still actionable" (unmapped/ai_suggested).
      const estimatesTabCountQuery = db
        .select({ n: count() })
        .from(estimateLineItems)
        .innerJoin(
          estimateRevisions,
          eq(estimateLineItems.estimateRevisionId, estimateRevisions.id),
        )
        .where(
          and(
            sql`${estimateLineItems.mappingStatus} != 'confirmed'`,
            eq(estimateRevisions.isLatest, true),
          ),
        );

      const roomsTabCountQuery = db
        .select({ n: count() })
        .from(rooms)
        .where(eq(rooms.isActive, true));

      const savingsTabCountQuery = db.select({ n: count() }).from(budgetReallocationLedger);

      const complianceTabCountQuery = db
        .select({ n: count() })
        .from(contractComplianceGates)
        .where(eq(contractComplianceGates.state, "fail"));

      const [
        fundingRows,
        spentRows,
        burnRows,
        committedRows,
        projectInfoRows,
        overBudgetRoomsRows,
        inboxUnmappedRows,
        contractGateRows,
        estimatesTabRows,
        roomsTabRows,
        savingsTabRows,
        complianceTabRows,
      ] = await db.batch([
        fundingQuery,
        spentQuery,
        burnQuery,
        committedQuery,
        projectInfoQuery,
        overBudgetRoomsCount,
        inboxUnmappedEstimateCount,
        contractGateCount,
        estimatesTabCountQuery,
        roomsTabCountQuery,
        savingsTabCountQuery,
        complianceTabCountQuery,
      ]);

      const totalBudgetCents = fundingRows[0]?.totalBudgetCents ?? 0;
      const fundingAccountCount = fundingRows[0]?.fundingAccountCount ?? 0;
      const spentToDateCents = spentRows[0]?.spentToDateCents ?? 0;
      const trailingCents = burnRows[0]?.trailingCents ?? 0;
      const committedCents = committedRows[0]?.committedCents ?? 0;

      const remainingCents = totalBudgetCents - spentToDateCents;
      const monthlyBurnCents = trailingCents / 3;
      const runwayMonths = monthlyBurnCents > 0 ? remainingCents / monthlyBurnCents : null;

      const varianceVsEstimateCents = spentToDateCents - committedCents;
      const varianceDirection: "over" | "under" | "even" =
        varianceVsEstimateCents > 0 ? "over" : varianceVsEstimateCents < 0 ? "under" : "even";

      const infoByKey = new Map(projectInfoRows.map((r) => [r.infoKey, r.infoValue ?? ""]));

      const inboxCount =
        (overBudgetRoomsRows[0]?.n ?? 0) +
        (inboxUnmappedRows[0]?.n ?? 0) +
        (contractGateRows[0]?.n ?? 0);

      return c.json(
        {
          project: {
            name: infoByKey.get("project_name") || "Remodel Project",
            addressLine: infoByKey.get("address") || "",
          },
          kpis: {
            totalBudgetCents,
            fundingAccountCount,
            spentToDateCents,
            spentPctOfBudget: totalBudgetCents > 0 ? spentToDateCents / totalBudgetCents : 0,
            remainingCents,
            runwayMonths,
            varianceVsEstimateCents,
            varianceDirection,
          },
          tabCounts: {
            inbox: inboxCount,
            estimates: estimatesTabRows[0]?.n ?? 0,
            rooms: roomsTabRows[0]?.n ?? 0,
            savings: savingsTabRows[0]?.n ?? 0,
            compliance: complianceTabRows[0]?.n ?? 0,
          },
          decisionsWaiting: inboxCount,
        },
        200,
      );
    } catch (error) {
      return c.json(
        {
          error: "Failed to load workbench summary",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  },
);

// ─── GET /api/budget/inbox ──────────────────────────────────────────────────
// Ranked by financial exposure IN SQL (UNION ALL of three sources, ORDER BY
// the exposure column, LIMIT). Never fetched-then-sorted in JS.

const INBOX_LIMIT = 30;

budgetWorkbenchRouter.openapi(
  createRoute({
    method: "get",
    path: "/inbox",
    summary: "Decision inbox — ranked by financial exposure",
    description:
      "Unions three sources (over-budget rooms, unmapped estimate lines, failing/warning contract compliance gates) in SQL and orders by exposure server-side.",
    responses: {
      200: {
        description: "Inbox items",
        content: { "application/json": { schema: inboxResponseSchema } },
      },
      500: { description: "Failed", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    try {
      const db = drizzle(c.env.DB);
      const committedSub = committedByRoomSubquery(db);
      const spentSub = spentByRoomSubquery(db);

      // Shared column shape across all three unioned sources:
      //   kind, entityId, entityLabel, amountA, amountB, statusText, exposureCents
      const roomSource = db
        .select({
          kind: sql<string>`'room'`.as("kind"),
          entityId: rooms.id,
          entityLabel: sql<string>`${rooms.roomName}`.as("entity_label"),
          amountA: sql<number>`coalesce(${spentSub.spentCents}, 0)`.as("amount_a"),
          amountB: sql<number>`coalesce(${committedSub.committedCents}, 0)`.as("amount_b"),
          statusText: sql<string>`''`.as("status_text"),
          exposureCents:
            sql<number>`coalesce(${spentSub.spentCents}, 0) - coalesce(${committedSub.committedCents}, 0)`.as(
              "exposure_cents",
            ),
        })
        .from(rooms)
        .leftJoin(committedSub, eq(committedSub.roomId, rooms.id))
        .leftJoin(spentSub, eq(spentSub.roomId, rooms.id))
        .where(
          and(
            eq(rooms.isActive, true),
            sql`coalesce(${spentSub.spentCents}, 0) > coalesce(${committedSub.committedCents}, 0)`,
          ),
        );

      const estimateSource = db
        .select({
          kind: sql<string>`'estimate'`.as("kind"),
          entityId: estimateLineItems.id,
          entityLabel:
            sql<string>`coalesce(${estimateLineItems.description}, 'Untitled line item')`.as(
              "entity_label",
            ),
          amountA: sql<number>`coalesce(${estimateLineItems.lineTotalCents}, 0)`.as("amount_a"),
          amountB: sql<number>`0`.as("amount_b"),
          statusText: sql<string>`${estimateLineItems.mappingStatus}`.as("status_text"),
          exposureCents: sql<number>`coalesce(${estimateLineItems.lineTotalCents}, 0)`.as(
            "exposure_cents",
          ),
        })
        .from(estimateLineItems)
        .innerJoin(
          estimateRevisions,
          eq(estimateLineItems.estimateRevisionId, estimateRevisions.id),
        )
        .where(
          and(
            inArray(estimateLineItems.mappingStatus, [...ESTIMATE_ACTIONABLE_STATUSES]),
            eq(estimateRevisions.isLatest, true),
          ),
        );

      // ponytail: no contract-value join here (contracts carries no denormalized
      // value; the real figure lives 2 hops away via linkedEstimateId ->
      // estimates.currentRevisionId -> estimateRevisions.totalAmountCents, which
      // GET /api/budget/compliance — a different agent's route — is the right
      // place to resolve properly). exposureCents is 0 for this source, so gate
      // rows rank after every dollar-bearing item rather than mid-pack on a guess.
      const contractSource = db
        .select({
          kind: sql<string>`'contract'`.as("kind"),
          entityId: contracts.id,
          entityLabel: sql<string>`coalesce(${estimateCompanies.name}, 'Unknown vendor')`.as(
            "entity_label",
          ),
          amountA: sql<number>`0`.as("amount_a"),
          amountB: sql<number>`0`.as("amount_b"),
          statusText:
            sql<string>`${contractComplianceGates.gateType} || ':' || ${contractComplianceGates.state}`.as(
              "status_text",
            ),
          exposureCents: sql<number>`0`.as("exposure_cents"),
        })
        .from(contractComplianceGates)
        .innerJoin(contracts, eq(contracts.id, contractComplianceGates.contractId))
        .leftJoin(estimateCompanies, eq(estimateCompanies.id, contracts.estimateCompanyId))
        .where(inArray(contractComplianceGates.state, ["fail", "warn"]));

      // Shared shape's 7th column is exposureCents — order by ordinal position
      // rather than a re-quoted alias, so this is robust to how each driver
      // happens to case-fold the "exposure_cents" identifier post-union.
      const unionedQuery = unionAll(roomSource, estimateSource, contractSource)
        .orderBy(sql`7 desc`)
        .limit(INBOX_LIMIT);

      const [unionedRows, overBudgetRoomsRows, unmappedEstimateRows, contractGateRows] =
        await db.batch([
          unionedQuery,
          overBudgetRoomsCountQuery(db),
          inboxUnmappedEstimateCountQuery(db),
          contractGateFailWarnCountQuery(db),
        ]);

      const items = unionedRows.map((row) => {
        const amountA = Number(row.amountA ?? 0);
        const amountB = Number(row.amountB ?? 0);
        const exposureCents = Number(row.exposureCents ?? 0);

        if (row.kind === "room") {
          const severity = amountA > amountB * 1.2 ? "block" : "warn";
          return {
            id: `room_variance:${row.entityId}`,
            severity: severity as "block" | "warn",
            title: `${row.entityLabel} is over budget`,
            detail: `Spent ${formatCents(amountA)} against ${formatCents(amountB)} committed.`,
            contextKind: "room" as const,
            contextId: row.entityId,
            contextLabel: row.entityLabel,
            exposureCents,
            actionKind: "reconcile" as const,
            actionHref: `/admin/budget/grid?roomId=${row.entityId}`,
          };
        }

        if (row.kind === "estimate") {
          return {
            id: `unmapped_estimate:${row.entityId}`,
            severity: "warn" as const,
            title: "Estimate line needs room mapping",
            detail: row.entityLabel,
            contextKind: "estimate" as const,
            contextId: row.entityId,
            contextLabel: row.entityLabel,
            exposureCents,
            actionKind: "reconcile" as const,
            actionHref: `/admin/budget/reconcile?lineItemId=${row.entityId}`,
          };
        }

        // contract compliance gate
        const [gateType, state] = (row.statusText ?? "unknown:unknown").split(":");
        return {
          id: `compliance_gate:${row.entityId}:${gateType}`,
          severity: (state === "fail" ? "block" : "warn") as "block" | "warn",
          title: `${(gateType ?? "compliance gate").replace(/_/g, " ")} needs attention`,
          detail: `Contract with ${row.entityLabel} — ${state ?? "unknown"} on ${(gateType ?? "").replace(/_/g, " ")}.`,
          contextKind: "contract" as const,
          contextId: row.entityId,
          contextLabel: row.entityLabel,
          exposureCents,
          actionKind: "review_contract" as const,
          actionHref: `/admin/contracts?contractId=${row.entityId}`,
        };
      });

      const total =
        (overBudgetRoomsRows[0]?.n ?? 0) +
        (unmappedEstimateRows[0]?.n ?? 0) +
        (contractGateRows[0]?.n ?? 0);

      return c.json({ items, total }, 200);
    } catch (error) {
      return c.json(
        {
          error: "Failed to load budget inbox",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  },
);

// ─── GET /api/budget/rooms-finance ─────────────────────────────────────────
// One grouped query with LEFT JOINs. No per-room follow-up query, no JS
// reduction — SUM/COUNT happen in SQL, batched with a single totals query.

budgetWorkbenchRouter.openapi(
  createRoute({
    method: "get",
    path: "/rooms-finance",
    summary: "Per-room committed/spent/remaining finance rollup",
    description:
      "One grouped LEFT JOIN query for the per-room rows, batched with a totals query — two SQL statements, one D1 round trip.",
    responses: {
      200: {
        description: "Rooms finance",
        content: { "application/json": { schema: roomsFinanceResponseSchema } },
      },
      500: { description: "Failed", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    try {
      const db = drizzle(c.env.DB);
      const committedSub = committedByRoomSubquery(db);
      const spentSub = spentByRoomSubquery(db);
      const materialsSub = openMaterialsByRoomSubquery(db);

      const roomsQuery = db
        .select({
          roomId: rooms.id,
          name: rooms.roomName,
          committedCents: sql<number>`coalesce(${committedSub.committedCents}, 0)`,
          spentCents: sql<number>`coalesce(${spentSub.spentCents}, 0)`,
          openMaterialsCount: sql<number>`coalesce(${materialsSub.openCount}, 0)`,
        })
        .from(rooms)
        .leftJoin(committedSub, eq(committedSub.roomId, rooms.id))
        .leftJoin(spentSub, eq(spentSub.roomId, rooms.id))
        .leftJoin(materialsSub, eq(materialsSub.roomId, rooms.id))
        .where(eq(rooms.isActive, true));

      // Totals computed independently from the per-room rows above (not summed
      // in JS from them) — an item mapped to N rooms would otherwise double
      // count, and a portfolio-level (roomId=null) expense/material would drop.
      const totalsCommittedQuery = db
        .select({ committedCents: sql<number>`coalesce(sum(${MIDPOINT_EXPR}), 0)` })
        .from(budgetTrackerItems)
        .where(eq(budgetTrackerItems.isActive, true));

      const totalsSpentQuery = db
        .select({ spentCents: sql<number>`coalesce(sum(${budgetExpenseEntries.amountCents}), 0)` })
        .from(budgetExpenseEntries)
        .where(eq(budgetExpenseEntries.isActive, true));

      const totalsMaterialsQuery = db
        .select({
          openCount: sql<number>`coalesce(sum(case when ${materialScheduleItems.isPurchased} = 1 then 0 else 1 end), 0)`,
        })
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.isActive, true));

      const [roomRows, totalsCommittedRows, totalsSpentRows, totalsMaterialsRows] = await db.batch([
        roomsQuery,
        totalsCommittedQuery,
        totalsSpentQuery,
        totalsMaterialsQuery,
      ]);

      const roomsOut = roomRows.map((r) => {
        const committedCents = Number(r.committedCents ?? 0);
        const spentCents = Number(r.spentCents ?? 0);
        return {
          roomId: r.roomId,
          name: r.name,
          committedCents,
          spentCents,
          remainingCents: committedCents - spentCents,
          openMaterialsCount: Number(r.openMaterialsCount ?? 0),
          risk: riskLevel(spentCents, committedCents),
        };
      });

      const committedCents = totalsCommittedRows[0]?.committedCents ?? 0;
      const spentCents = totalsSpentRows[0]?.spentCents ?? 0;
      const openMaterialsCount = totalsMaterialsRows[0]?.openCount ?? 0;

      return c.json(
        {
          rooms: roomsOut,
          totals: {
            committedCents,
            spentCents,
            remainingCents: committedCents - spentCents,
            openMaterialsCount,
          },
        },
        200,
      );
    } catch (error) {
      return c.json(
        {
          error: "Failed to load rooms finance",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  },
);

export { budgetWorkbenchRouter };
