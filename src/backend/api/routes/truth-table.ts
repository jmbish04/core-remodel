/**
 * @fileoverview Truth Table API — granular construction activity catalog.
 *
 * Endpoints:
 *   GET    /api/truth-table                 list (with filters, search, pagination)
 *   GET    /api/truth-table/kpis            summary metrics for the KPI strip
 *   GET    /api/truth-table/:id             single activity
 *   POST   /api/truth-table                 create activity (auto-assigns trackId)
 *   PATCH  /api/truth-table/:id             update activity (writes new revision)
 *   DELETE /api/truth-table/:id             soft-delete (sets isActive=false)
 *   POST   /api/truth-table/reembed         queue all active activities for re-embedding
 */

import { truthTableActivities } from "@backend/db";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

const TRADES = [
  "demo",
  "framing",
  "plumbing",
  "electrical",
  "hvac",
  "flooring",
  "finish_carpentry",
  "tile",
  "paint",
  "drywall",
  "cabinetry",
  "counters",
  "appliances",
  "exterior",
  "sitework",
  "permits",
] as const;

const PHASES = ["pre_construction", "rough", "finish", "punch"] as const;
const UNITS = ["sf", "lf", "ea", "hr", "ls", "day"] as const;
const SOURCE_TYPES = [
  "manual",
  "insurance",
  "rsmeans",
  "ai_inferred",
  "bid_observed",
] as const;

const ActivitySchema = z.object({
  id: z.string(),
  trackId: z.string(),
  revisionNumber: z.number(),
  isActive: z.boolean(),
  trade: z.enum(TRADES),
  phase: z.enum(PHASES),
  scopeKey: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  scopeKeywords: z.array(z.string()).nullable(),
  unit: z.enum(UNITS),
  baselineLaborCentsPerUnit: z.number().int(),
  baselineMaterialCentsPerUnit: z.number().int(),
  baselineEquipmentCentsPerUnit: z.number().int(),
  marketAdjustmentPct: z.number(),
  insuranceBaselineCentsPerUnit: z.number().int().nullable(),
  notes: z.string().nullable(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceRef: z.string().nullable(),
  confidenceScore: z.number().nullable(),
  embeddingId: z.string().nullable(),
  isFinal: z.boolean(),
  vendorName: z.string().nullable(),
  datetimeCreated: z.number(),
  datetimeUpdated: z.number(),
});

const ActivityCreateSchema = z.object({
  trade: z.enum(TRADES),
  phase: z.enum(PHASES),
  scopeKey: z
    .string()
    .min(2)
    .regex(/^[a-z0-9_.]+$/, "scope_key must be lowercase a-z, 0-9, dot, underscore"),
  displayName: z.string().min(2),
  description: z.string().nullable().optional(),
  scopeKeywords: z.array(z.string()).optional(),
  unit: z.enum(UNITS),
  baselineLaborCentsPerUnit: z.number().int().min(0).default(0),
  baselineMaterialCentsPerUnit: z.number().int().min(0).default(0),
  baselineEquipmentCentsPerUnit: z.number().int().min(0).default(0),
  marketAdjustmentPct: z.number().min(-1).max(2).default(0),
  insuranceBaselineCentsPerUnit: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
  sourceType: z.enum(SOURCE_TYPES).default("manual"),
  sourceRef: z.string().nullable().optional(),
  confidenceScore: z.number().min(0).max(1).default(0.7),
  changedBy: z.string().optional(),
  isFinal: z.boolean().default(false),
  vendorName: z.string().nullable().optional(),
});

const ActivityUpdateSchema = ActivityCreateSchema.partial();

const ListQuerySchema = z.object({
  search: z.string().optional(),
  trade: z.string().optional(),
  phase: z.string().optional(),
  source: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z
    .enum(["scope_key", "trade", "display_name", "datetime_updated"])
    .default("scope_key"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

function rowToDto(
  row: typeof truthTableActivities.$inferSelect,
): z.infer<typeof ActivitySchema> {
  return {
    id: row.id,
    trackId: row.trackId,
    revisionNumber: row.revisionNumber,
    isActive: row.isActive,
    trade: row.trade as (typeof TRADES)[number],
    phase: row.phase as (typeof PHASES)[number],
    scopeKey: row.scopeKey,
    displayName: row.displayName,
    description: row.description ?? null,
    scopeKeywords: row.scopeKeywords ? safeParseJson(row.scopeKeywords) : null,
    unit: row.unit as (typeof UNITS)[number],
    baselineLaborCentsPerUnit: row.baselineLaborCentsPerUnit,
    baselineMaterialCentsPerUnit: row.baselineMaterialCentsPerUnit,
    baselineEquipmentCentsPerUnit: row.baselineEquipmentCentsPerUnit,
    marketAdjustmentPct: row.marketAdjustmentPct,
    insuranceBaselineCentsPerUnit: row.insuranceBaselineCentsPerUnit ?? null,
    notes: row.notes ?? null,
    sourceType: row.sourceType as (typeof SOURCE_TYPES)[number],
    sourceRef: row.sourceRef ?? null,
    confidenceScore: row.confidenceScore ?? null,
    embeddingId: row.embeddingId ?? null,
    isFinal: row.isFinal,
    vendorName: row.vendorName ?? null,
    datetimeCreated:
      row.datetimeCreated instanceof Date
        ? Math.floor(row.datetimeCreated.getTime() / 1000)
        : Number(row.datetimeCreated ?? 0),
    datetimeUpdated:
      row.datetimeUpdated instanceof Date
        ? Math.floor(row.datetimeUpdated.getTime() / 1000)
        : Number(row.datetimeUpdated ?? 0),
  };
}

function safeParseJson(s: string): string[] | null {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
}

function newId(prefix = "tta") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

export const truthTableRouter = new OpenAPIHono<{ Bindings: Env }>();

// ---------- LIST ----------
truthTableRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    request: { query: ListQuerySchema },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              activities: z.array(ActivitySchema),
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
            }),
          },
        },
        description: "Activity list",
      },
    },
    tags: ["truth-table"],
  }),
  async (c) => {
    const q = c.req.valid("query");
    const db = drizzle(c.env.DB);

    const trades = q.trade ? q.trade.split(",").filter(Boolean) : [];
    const phases = q.phase ? q.phase.split(",").filter(Boolean) : [];
    const sources = q.source ? q.source.split(",").filter(Boolean) : [];

    const conditions = [eq(truthTableActivities.isActive, true)];
    if (trades.length) conditions.push(inArray(truthTableActivities.trade, trades));
    if (phases.length) conditions.push(inArray(truthTableActivities.phase, phases));
    if (sources.length)
      conditions.push(inArray(truthTableActivities.sourceType, sources));
    if (q.search) {
      const pat = `%${q.search.toLowerCase()}%`;
      conditions.push(
        or(
          like(sql`lower(${truthTableActivities.scopeKey})`, pat),
          like(sql`lower(${truthTableActivities.displayName})`, pat),
          like(sql`lower(${truthTableActivities.description})`, pat),
        )!,
      );
    }

    const sortCol = {
      scope_key: truthTableActivities.scopeKey,
      trade: truthTableActivities.trade,
      display_name: truthTableActivities.displayName,
      datetime_updated: truthTableActivities.datetimeUpdated,
    }[q.sort];

    const rows = await db
      .select()
      .from(truthTableActivities)
      .where(and(...conditions))
      .orderBy(q.order === "asc" ? asc(sortCol) : desc(sortCol))
      .limit(q.limit)
      .offset(q.offset);

    const totalRows = await db
      .select({ c: sql<number>`count(*)` })
      .from(truthTableActivities)
      .where(and(...conditions));

    return c.json({
      activities: rows.map(rowToDto),
      total: Number(totalRows[0]?.c ?? 0),
      limit: q.limit,
      offset: q.offset,
    });
  },
);

// ---------- KPIS ----------
truthTableRouter.openapi(
  createRoute({
    method: "get",
    path: "/kpis",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              totalActivities: z.number(),
              activitiesEmbedded: z.number(),
              avgConfidence: z.number(),
              flaggedAiInferred: z.number(),
              byTrade: z.array(z.object({ trade: z.string(), count: z.number() })),
            }),
          },
        },
        description: "KPI summary",
      },
    },
    tags: ["truth-table"],
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(truthTableActivities)
      .where(eq(truthTableActivities.isActive, true));
    const totalActivities = rows.length;
    const activitiesEmbedded = rows.filter((r) => r.embeddingId).length;
    const avgConfidence =
      rows.length === 0
        ? 0
        : rows.reduce((s, r) => s + (r.confidenceScore ?? 0), 0) / rows.length;
    const flaggedAiInferred = rows.filter((r) => r.sourceType === "ai_inferred")
      .length;
    const byTradeMap = new Map<string, number>();
    for (const r of rows)
      byTradeMap.set(r.trade, (byTradeMap.get(r.trade) ?? 0) + 1);
    const byTrade = Array.from(byTradeMap.entries())
      .map(([trade, count]) => ({ trade, count }))
      .sort((a, b) => b.count - a.count);

    return c.json({
      totalActivities,
      activitiesEmbedded,
      avgConfidence,
      flaggedAiInferred,
      byTrade,
    });
  },
);

// ---------- GET ONE ----------
truthTableRouter.openapi(
  createRoute({
    method: "get",
    path: "/:id",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        content: { "application/json": { schema: ActivitySchema } },
        description: "Single activity",
      },
      404: {
        content: { "application/json": { schema: z.object({ error: z.string() }) } },
        description: "Not found",
      },
    },
    tags: ["truth-table"],
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const row = await db
      .select()
      .from(truthTableActivities)
      .where(
        and(
          eq(truthTableActivities.id, id),
          eq(truthTableActivities.isActive, true),
        ),
      )
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(rowToDto(row));
  },
);

// ---------- CREATE ----------
truthTableRouter.openapi(
  createRoute({
    method: "post",
    path: "/",
    request: {
      body: {
        content: { "application/json": { schema: ActivityCreateSchema } },
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ActivitySchema } },
        description: "Activity created",
      },
    },
    tags: ["truth-table"],
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const id = newId();
    const trackId = `track_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await db.insert(truthTableActivities).values({
      id,
      trackId,
      revisionNumber: 1,
      isActive: true,
      trade: body.trade,
      phase: body.phase,
      scopeKey: body.scopeKey,
      displayName: body.displayName,
      description: body.description ?? null,
      scopeKeywords: body.scopeKeywords ? JSON.stringify(body.scopeKeywords) : null,
      unit: body.unit,
      baselineLaborCentsPerUnit: body.baselineLaborCentsPerUnit ?? 0,
      baselineMaterialCentsPerUnit: body.baselineMaterialCentsPerUnit ?? 0,
      baselineEquipmentCentsPerUnit: body.baselineEquipmentCentsPerUnit ?? 0,
      marketAdjustmentPct: body.marketAdjustmentPct ?? 0,
      insuranceBaselineCentsPerUnit: body.insuranceBaselineCentsPerUnit ?? null,
      notes: body.notes ?? null,
      sourceType: body.sourceType ?? "manual",
      sourceRef: body.sourceRef ?? null,
      confidenceScore: body.confidenceScore ?? 0.7,
      changeSource: "ui",
      changedBy: body.changedBy ?? null,
      isFinal: body.isFinal ?? false,
      vendorName: body.vendorName ?? null,
    });

    // Notify Budget Agent DO asynchronously
    try {
      const budgetAgent = await getAgentByName<Env, BudgetAgent>(
        c.env.BUDGET_AGENT as any,
        "global-budget-agent"
      );
      if (typeof (budgetAgent as any).onBudgetChange === "function") {
        c.executionCtx.waitUntil(
          (budgetAgent as any).onBudgetChange({
            type: "quote_change",
            action: "create",
            activityId: id,
            displayName: body.displayName,
            isFinal: body.isFinal ?? false,
            timestamp: Date.now(),
          })
        );
      }
    } catch (err) {
      console.error("Failed to notify BudgetAgent DO on quote creation:", err);
    }

    const row = await db
      .select()
      .from(truthTableActivities)
      .where(eq(truthTableActivities.id, id))
      .get();
    return c.json(rowToDto(row!), 201);
  },
);

// ---------- UPDATE (writes a new revision) ----------
truthTableRouter.openapi(
  createRoute({
    method: "patch",
    path: "/:id",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: { "application/json": { schema: ActivityUpdateSchema } },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ActivitySchema } },
        description: "New revision created",
      },
      404: {
        content: { "application/json": { schema: z.object({ error: z.string() }) } },
        description: "Not found",
      },
    },
    tags: ["truth-table"],
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const prev = await db
      .select()
      .from(truthTableActivities)
      .where(
        and(
          eq(truthTableActivities.id, id),
          eq(truthTableActivities.isActive, true),
        ),
      )
      .get();
    if (!prev) return c.json({ error: "not_found" }, 404);

    const newRowId = newId();
    const now = Math.floor(Date.now() / 1000);

    await db.insert(truthTableActivities).values({
      id: newRowId,
      trackId: prev.trackId,
      revisionNumber: prev.revisionNumber + 1,
      isActive: true,
      trade: body.trade ?? prev.trade,
      phase: body.phase ?? prev.phase,
      scopeKey: body.scopeKey ?? prev.scopeKey,
      displayName: body.displayName ?? prev.displayName,
      description: body.description ?? prev.description ?? null,
      scopeKeywords: body.scopeKeywords
        ? JSON.stringify(body.scopeKeywords)
        : prev.scopeKeywords,
      unit: body.unit ?? prev.unit,
      baselineLaborCentsPerUnit:
        body.baselineLaborCentsPerUnit ?? prev.baselineLaborCentsPerUnit,
      baselineMaterialCentsPerUnit:
        body.baselineMaterialCentsPerUnit ?? prev.baselineMaterialCentsPerUnit,
      baselineEquipmentCentsPerUnit:
        body.baselineEquipmentCentsPerUnit ?? prev.baselineEquipmentCentsPerUnit,
      marketAdjustmentPct: body.marketAdjustmentPct ?? prev.marketAdjustmentPct,
      insuranceBaselineCentsPerUnit:
        body.insuranceBaselineCentsPerUnit ??
        prev.insuranceBaselineCentsPerUnit ??
        null,
      notes: body.notes ?? prev.notes ?? null,
      sourceType: body.sourceType ?? prev.sourceType,
      sourceRef: body.sourceRef ?? prev.sourceRef ?? null,
      confidenceScore: body.confidenceScore ?? prev.confidenceScore ?? 0.7,
      embeddingId: null,
      changeSource: "ui",
      changedBy: body.changedBy ?? null,
      isFinal: body.isFinal !== undefined ? body.isFinal : prev.isFinal,
      vendorName: body.vendorName !== undefined ? body.vendorName : prev.vendorName,
    });

    await db
      .update(truthTableActivities)
      .set({
        isActive: false,
        replacedByActivityId: newRowId,
        replacedAt: new Date(now * 1000),
      })
      .where(eq(truthTableActivities.id, prev.id));

    // Notify Budget Agent DO asynchronously
    try {
      const budgetAgent = await getAgentByName<Env, BudgetAgent>(
        c.env.BUDGET_AGENT as any,
        "global-budget-agent"
      );
      if (typeof (budgetAgent as any).onBudgetChange === "function") {
        c.executionCtx.waitUntil(
          (budgetAgent as any).onBudgetChange({
            type: "quote_change",
            action: "update",
            activityId: newRowId,
            displayName: body.displayName ?? prev.displayName,
            isFinal: body.isFinal !== undefined ? body.isFinal : prev.isFinal,
            timestamp: Date.now(),
          })
        );
      }
    } catch (err) {
      console.error("Failed to notify BudgetAgent DO on quote update:", err);
    }

    const row = await db
      .select()
      .from(truthTableActivities)
      .where(eq(truthTableActivities.id, newRowId))
      .get();
    return c.json(rowToDto(row!), 200);
  },
);

// ---------- DELETE (soft) ----------
truthTableRouter.openapi(
  createRoute({
    method: "delete",
    path: "/:id",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        content: {
          "application/json": { schema: z.object({ ok: z.boolean() }) },
        },
        description: "Soft-deleted",
      },
    },
    tags: ["truth-table"],
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    await db
      .update(truthTableActivities)
      .set({
        isActive: false,
        replacedAt: new Date(),
      })
      .where(eq(truthTableActivities.id, id));

    // Notify Budget Agent DO asynchronously
    try {
      const budgetAgent = await getAgentByName<Env, BudgetAgent>(
        c.env.BUDGET_AGENT as any,
        "global-budget-agent"
      );
      if (typeof (budgetAgent as any).onBudgetChange === "function") {
        c.executionCtx.waitUntil(
          (budgetAgent as any).onBudgetChange({
            type: "quote_change",
            action: "delete",
            activityId: id,
            timestamp: Date.now(),
          })
        );
      }
    } catch (err) {
      console.error("Failed to notify BudgetAgent DO on quote deletion:", err);
    }

    return c.json({ ok: true });
  },
);

// ---------- RE-EMBED ----------
// Generates embeddings for all active activities and upserts into VECTOR_INDEX.
// Runs synchronously; for >500 activities, refactor to a workflow.
truthTableRouter.openapi(
  createRoute({
    method: "post",
    path: "/reembed",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              embedded: z.number(),
              skipped: z.number(),
              errors: z.array(z.string()),
            }),
          },
        },
        description: "Re-embed complete",
      },
    },
    tags: ["truth-table"],
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(truthTableActivities)
      .where(eq(truthTableActivities.isActive, true));

    const errors: string[] = [];
    let embedded = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const text = [
          row.trade,
          row.scopeKey,
          row.displayName,
          row.description ?? "",
          row.scopeKeywords
            ? (safeParseJson(row.scopeKeywords) ?? []).join(" ")
            : "",
        ]
          .filter(Boolean)
          .join(" | ");

        const result = (await c.env.AI.run("@cf/baai/bge-large-en-v1.5", {
          text: [text],
        })) as { data: number[][] };
        const vector = result.data?.[0];
        if (!vector) {
          skipped++;
          continue;
        }
        await c.env.VECTOR_INDEX.upsert([
          {
            id: row.id,
            values: vector,
            metadata: {
              trade: row.trade,
              phase: row.phase,
              scopeKey: row.scopeKey,
              unit: row.unit,
              trackId: row.trackId,
            },
          },
        ]);
        await db
          .update(truthTableActivities)
          .set({ embeddingId: row.id })
          .where(eq(truthTableActivities.id, row.id));
        embedded++;
      } catch (e: unknown) {
        errors.push(
          `${row.scopeKey}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return c.json({ embedded, skipped, errors });
  },
);
