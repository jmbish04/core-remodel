import { budgetTrackerItems, budgetExpenseEntries } from "@backend/db";
import { publishRealtimeEvent } from "@backend/realtime/publish";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

const csvRouter = new OpenAPIHono<{ Bindings: Env }>();

const RemodelumCSVRowSchema = z.object({
  Type: z.string().min(1, "Type is required"),
  Category: z.string().min(1, "Category is required"),
  Name: z.string().min(1, "Name is required"),
  Cost: z.union([z.string(), z.number()]).transform((val) => {
    if (typeof val === "number") return val;
    const cleaned = val.replace(/[$,\s]/g, "");
    const parsed = Number.parseFloat(cleaned);
    return Number.isNaN(parsed) ? 0 : parsed;
  }),
  Description: z.string().optional().default(""),
});

const CSVIngestionRequestSchema = z.object({
  rows: z.array(RemodelumCSVRowSchema).min(1, "At least one row is required"),
  sourceRef: z.string().optional().default("remodelum_csv_import"),
  changedBy: z.string().optional().default("csv_import_user"),
  dryRun: z.boolean().optional().default(false),
  validateWithAI: z.boolean().optional().default(false),
});

const DeltaResultSchema = z.object({
  rowIndex: z.number(),
  status: z.enum(["new", "updated", "unchanged", "conflict"]),
  csvData: RemodelumCSVRowSchema,
  existingData: z.any().optional(),
  aiValidation: z
    .object({
      validated: z.boolean(),
      categoryConfidence: z.number().optional(),
      costReasonable: z.boolean().optional(),
      suggestedCategory: z.string().optional(),
      rationale: z.string().optional(),
    })
    .optional(),
  changes: z
    .object({
      field: z.string(),
      oldValue: z.any(),
      newValue: z.any(),
    })
    .array()
    .optional(),
});

const CSVIngestionResponseSchema = z.object({
  success: z.boolean(),
  dryRun: z.boolean(),
  summary: z.object({
    totalRows: z.number(),
    newItems: z.number(),
    updatedItems: z.number(),
    unchangedItems: z.number(),
    conflicts: z.number(),
    aiValidated: z.number(),
  }),
  deltas: z.array(DeltaResultSchema),
  transactionId: z.string().optional(),
  errors: z
    .array(
      z.object({
        rowIndex: z.number(),
        error: z.string(),
      }),
    )
    .optional(),
});

function parseCents(input: number | string): number {
  if (typeof input === "number") {
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[$,\s]/g, "");
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

function normalizeString(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function validateWithWorkersAI(
  env: Env,
  row: z.infer<typeof RemodelumCSVRowSchema>,
): Promise<z.infer<typeof DeltaResultSchema>["aiValidation"]> {
  try {
    const prompt = `Analyze this budget line item and provide validation:
Type: ${row.Type}
Category: ${row.Category}
Name: ${row.Name}
Cost: $${row.Cost}
Description: ${row.Description}

Please respond with JSON containing:
- validated: boolean (is this a reasonable budget item?)
- categoryConfidence: number 0-1 (how confident are you in the category?)
- costReasonable: boolean (is the cost reasonable for this item?)
- suggestedCategory: string (if category seems wrong, suggest better one)
- rationale: string (brief explanation of your assessment)`;

    const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a construction budget validation assistant. Respond only with valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      stream: false,
    });

    if (typeof response === "object" && response !== null && "response" in response) {
      const text = (response as { response: string }).response;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          validated: parsed.validated ?? true,
          categoryConfidence: parsed.categoryConfidence ?? 0.8,
          costReasonable: parsed.costReasonable ?? true,
          suggestedCategory: parsed.suggestedCategory ?? row.Category,
          rationale: parsed.rationale ?? "AI validation completed",
        };
      }
    }

    return {
      validated: true,
      categoryConfidence: 0.5,
      costReasonable: true,
      suggestedCategory: row.Category,
      rationale: "AI validation unavailable, defaulting to acceptance",
    };
  } catch (error) {
    console.error("AI validation error:", error);
    return {
      validated: true,
      categoryConfidence: 0.5,
      costReasonable: true,
      suggestedCategory: row.Category,
      rationale: "AI validation failed, defaulting to acceptance",
    };
  }
}

async function analyzeDelta(
  db: ReturnType<typeof drizzle>,
  row: z.infer<typeof RemodelumCSVRowSchema>,
  rowIndex: number,
  validateAI: boolean,
  env: Env,
): Promise<z.infer<typeof DeltaResultSchema>> {
  const itemType = normalizeString(row.Type) || "expense";
  const category = normalizeString(row.Category) || "Uncategorized";
  const itemName = normalizeString(row.Name) || "Unnamed Item";
  const description = normalizeString(row.Description) || "";
  const costCents = parseCents(row.Cost);

  let aiValidation: z.infer<typeof DeltaResultSchema>["aiValidation"];
  if (validateAI) {
    aiValidation = await validateWithWorkersAI(env, row);
  }

  if (itemType.toLowerCase() === "expense") {
    const existingExpenses = await db
      .select()
      .from(budgetExpenseEntries)
      .where(and(eq(budgetExpenseEntries.item, itemName), eq(budgetExpenseEntries.isActive, true)))
      .all();

    if (existingExpenses.length === 0) {
      return {
        rowIndex,
        status: "new",
        csvData: row,
        aiValidation,
        changes: [],
      };
    }

    const existing = existingExpenses[0];
    const changes: z.infer<typeof DeltaResultSchema>["changes"] = [];

    if (existing.category !== category) {
      changes.push({ field: "category", oldValue: existing.category, newValue: category });
    }
    if (existing.amountCents !== costCents) {
      changes.push({
        field: "amountCents",
        oldValue: existing.amountCents,
        newValue: costCents,
      });
    }
    if (existing.notes !== description) {
      changes.push({ field: "notes", oldValue: existing.notes, newValue: description });
    }

    return {
      rowIndex,
      status: changes.length > 0 ? "updated" : "unchanged",
      csvData: row,
      existingData: existing,
      aiValidation,
      changes,
    };
  } else {
    const existingItems = await db
      .select()
      .from(budgetTrackerItems)
      .where(and(eq(budgetTrackerItems.title, itemName), eq(budgetTrackerItems.isActive, true)))
      .all();

    if (existingItems.length === 0) {
      return {
        rowIndex,
        status: "new",
        csvData: row,
        aiValidation,
        changes: [],
      };
    }

    const existing = existingItems[0];
    const changes: z.infer<typeof DeltaResultSchema>["changes"] = [];

    if (existing.itemType !== itemType) {
      changes.push({ field: "itemType", oldValue: existing.itemType, newValue: itemType });
    }
    if (existing.description !== description) {
      changes.push({
        field: "description",
        oldValue: existing.description,
        newValue: description,
      });
    }

    const estimatedCents = existing.estimatedLowCents || 0;
    if (estimatedCents !== costCents) {
      changes.push({
        field: "estimatedLowCents",
        oldValue: estimatedCents,
        newValue: costCents,
      });
    }

    return {
      rowIndex,
      status: changes.length > 0 ? "updated" : "unchanged",
      csvData: row,
      existingData: existing,
      aiValidation,
      changes,
    };
  }
}

async function applyDelta(
  db: ReturnType<typeof drizzle>,
  delta: z.infer<typeof DeltaResultSchema>,
  sourceRef: string,
  changedBy: string,
): Promise<void> {
  const now = new Date();
  const itemType = normalizeString(delta.csvData.Type) || "expense";
  const category = normalizeString(delta.csvData.Category) || "Uncategorized";
  const itemName = normalizeString(delta.csvData.Name) || "Unnamed Item";
  const description = normalizeString(delta.csvData.Description) || "";
  const costCents = parseCents(delta.csvData.Cost);

  if (itemType.toLowerCase() === "expense") {
    if (delta.status === "new") {
      await db.insert(budgetExpenseEntries).values({
        trackId: crypto.randomUUID(),
        revisionNumber: 1,
        isActive: true,
        isDraft: false,
        item: itemName,
        category: category,
        amountCents: costCents,
        notes: description,
        sourceType: "csv_import",
        sourceRef: sourceRef,
        changeSource: sourceRef,
        changedBy: changedBy,
        datetimeCreated: now,
        datetimeUpdated: now,
      });
    } else if (delta.status === "updated" && delta.existingData) {
      const currentId = delta.existingData.id;
      const trackId = delta.existingData.trackId;

      const revisions = await db
        .select()
        .from(budgetExpenseEntries)
        .where(eq(budgetExpenseEntries.trackId, trackId))
        .orderBy(desc(budgetExpenseEntries.revisionNumber))
        .all();

      const nextRevision = (revisions[0]?.revisionNumber || 0) + 1;

      await db.insert(budgetExpenseEntries).values({
        trackId: trackId,
        revisionNumber: nextRevision,
        isActive: true,
        isDraft: false,
        item: itemName,
        category: category,
        amountCents: costCents,
        notes: description,
        sourceType: "csv_import",
        sourceRef: sourceRef,
        changeSource: sourceRef,
        changedBy: changedBy,
        datetimeCreated: now,
        datetimeUpdated: now,
      });

      await db
        .update(budgetExpenseEntries)
        .set({
          isActive: false,
          replacedAt: now,
          datetimeUpdated: now,
        })
        .where(eq(budgetExpenseEntries.id, currentId));
    }
  } else {
    if (delta.status === "new") {
      await db.insert(budgetTrackerItems).values({
        trackId: crypto.randomUUID(),
        revisionNumber: 1,
        isActive: true,
        isDraft: false,
        itemType: itemType,
        executionClass: "must_now",
        title: itemName,
        description: description,
        status: "open",
        riskLevel: "medium",
        isBottleneck: false,
        estimatedLowCents: costCents,
        estimatedHighCents: Math.round(costCents * 1.2),
        changeSource: sourceRef,
        changedBy: changedBy,
        aiRationale: delta.aiValidation?.rationale || null,
        datetimeCreated: now,
        datetimeUpdated: now,
      });
    } else if (delta.status === "updated" && delta.existingData) {
      const currentId = delta.existingData.id;
      const trackId = delta.existingData.trackId;

      const revisions = await db
        .select()
        .from(budgetTrackerItems)
        .where(eq(budgetTrackerItems.trackId, trackId))
        .orderBy(desc(budgetTrackerItems.revisionNumber))
        .all();

      const nextRevision = (revisions[0]?.revisionNumber || 0) + 1;

      await db.insert(budgetTrackerItems).values({
        trackId: trackId,
        revisionNumber: nextRevision,
        isActive: true,
        isDraft: false,
        itemType: itemType,
        executionClass: delta.existingData.executionClass || "must_now",
        optionGroup: delta.existingData.optionGroup,
        optionKey: delta.existingData.optionKey,
        title: itemName,
        description: description,
        status: delta.existingData.status || "open",
        riskLevel: delta.existingData.riskLevel || "medium",
        isBottleneck: delta.existingData.isBottleneck || false,
        bottleneckReason: delta.existingData.bottleneckReason,
        estimatedLowCents: costCents,
        estimatedHighCents: Math.round(costCents * 1.2),
        scenarioId: delta.existingData.scenarioId,
        owner: delta.existingData.owner,
        aiRationale: delta.aiValidation?.rationale || delta.existingData.aiRationale,
        changeSource: sourceRef,
        changedBy: changedBy,
        datetimeCreated: now,
        datetimeUpdated: now,
      });

      await db
        .update(budgetTrackerItems)
        .set({
          isActive: false,
          replacedByItemId: null,
          replacedAt: now,
          datetimeUpdated: now,
        })
        .where(eq(budgetTrackerItems.id, currentId));
    }
  }
}

const csvIngestionRoute = createRoute({
  method: "post",
  path: "/csv-ingestion",
  tags: ["CSV Ingestion"],
  summary: "Ingest CSV data from remodelum.com export",
  description:
    "Accepts CSV data in remodelum.com format (Type, Category, Name, Cost, Description), performs delta analysis against existing D1 records, optionally validates with Workers AI, and applies changes with transaction isolation.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CSVIngestionRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "CSV ingestion completed successfully",
      content: {
        "application/json": {
          schema: CSVIngestionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request payload",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            error: z.string(),
            validationErrors: z.array(z.any()).optional(),
          }),
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            error: z.string(),
            details: z.string().optional(),
          }),
        },
      },
    },
  },
});

csvRouter.openapi(csvIngestionRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const transactionId = crypto.randomUUID();

    const deltas: z.infer<typeof DeltaResultSchema>[] = [];
    const errors: { rowIndex: number; error: string }[] = [];

    for (let i = 0; i < body.rows.length; i++) {
      try {
        const delta = await analyzeDelta(db, body.rows[i], i, body.validateWithAI || false, c.env);
        deltas.push(delta);
      } catch (error) {
        errors.push({
          rowIndex: i,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const summary = {
      totalRows: body.rows.length,
      newItems: deltas.filter((d) => d.status === "new").length,
      updatedItems: deltas.filter((d) => d.status === "updated").length,
      unchangedItems: deltas.filter((d) => d.status === "unchanged").length,
      conflicts: deltas.filter((d) => d.status === "conflict").length,
      aiValidated: deltas.filter((d) => d.aiValidation !== undefined).length,
    };

    if (!body.dryRun) {
      await db.batch(
        deltas
          .filter((d) => d.status === "new" || d.status === "updated")
          .map((delta) => applyDelta(db, delta, body.sourceRef, body.changedBy)),
      );

      await publishRealtimeEvent(c.env, "budget", {
        event: "csv.ingestion.completed",
        transactionId,
        summary,
        timestamp: new Date().toISOString(),
      });
    }

    return c.json({
      success: true,
      dryRun: body.dryRun,
      summary,
      deltas,
      transactionId: body.dryRun ? undefined : transactionId,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("CSV ingestion error:", error);
    return c.json(
      {
        success: false,
        error: "CSV ingestion failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { csvRouter };
