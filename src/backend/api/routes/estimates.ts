import {
  estimateCompanies,
  estimateDocuments,
  estimateLineItems,
  estimatePropKeyTypes,
  estimatePropValues,
  estimateRevisionSnapshots,
  estimateRevisions,
  estimateRoomMappings,
  estimates,
  estimateSourceEvents,
  rooms,
} from "@backend/db";
import { publishRealtimeEvent } from "@backend/realtime/publish";
import {
  extractSourceContent,
  extractStructuredEstimate,
  flattenStructuredProperties,
} from "@backend/services/estimate-intake";
import { attachServiceNames } from "@backend/services/service-names";
import { generateStructured } from "@backend/services/structured-output";
import type { BatchItem } from "drizzle-orm/batch";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { ensureEstimateStatuses } from "./estimate-statuses";

const estimatesRouter = new Hono<{ Bindings: Env }>();

// Three independent updates (none needs another's generated id or result), so
// they're built as statements here and left for the caller to run — either as
// its own `db.batch()` (this function's own callers) or spliced into a larger
// batch (the intake/confirm handler below, which needs these alongside its
// own writes).
function buildMarkAsCurrentRevisionStatements(
  db: ReturnType<typeof drizzle>,
  estimateId: number,
  revisionId: number,
) {
  const now = new Date();
  return [
    db
      .update(estimateRevisions)
      .set({
        isLatest: false,
        datetimeUpdated: now,
      })
      .where(
        and(eq(estimateRevisions.estimateId, estimateId), eq(estimateRevisions.isLatest, true)),
      ),
    db
      .update(estimateRevisions)
      .set({
        isLatest: true,
        datetimeUpdated: now,
      })
      .where(eq(estimateRevisions.id, revisionId)),
    db
      .update(estimates)
      .set({
        currentRevisionId: revisionId,
        datetimeUpdated: now,
      })
      .where(eq(estimates.id, estimateId)),
  ];
}

async function markAsCurrentRevision(
  db: ReturnType<typeof drizzle>,
  estimateId: number,
  revisionId: number,
) {
  const stmts = buildMarkAsCurrentRevisionStatements(db, estimateId, revisionId);
  await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
}

async function getNextRevisionNumber(
  db: ReturnType<typeof drizzle>,
  estimateId: number,
): Promise<number> {
  const rows = await db
    .select({ revisionNumber: estimateRevisions.revisionNumber })
    .from(estimateRevisions)
    .where(eq(estimateRevisions.estimateId, estimateId))
    .all();
  return rows.reduce((maxValue, row) => Math.max(maxValue, row.revisionNumber), 0) + 1;
}

async function registerStructuredProps(
  db: ReturnType<typeof drizzle>,
  params: {
    estimateRevisionId: number;
    estimateDocumentId: number;
    extracted: Record<string, unknown>;
  },
) {
  const flat = flattenStructuredProperties(params.extracted);
  for (const entry of flat) {
    await db
      .insert(estimatePropKeyTypes)
      .values({
        property: entry.property,
        dataType: entry.dataType,
        schemaVersion: "v1",
        datetimeCreated: new Date(),
        datetimeUpdated: new Date(),
      })
      .onConflictDoNothing()
      .run();
  }
  if (flat.length === 0) return;

  const keys = flat.map((entry) => entry.property);
  const keyTypeRows = await db
    .select()
    .from(estimatePropKeyTypes)
    .where(inArray(estimatePropKeyTypes.property, keys))
    .all();
  const keyByProperty = new Map(keyTypeRows.map((row) => [row.property, row]));

  for (const entry of flat) {
    const keyType = keyByProperty.get(entry.property);
    if (!keyType) continue;
    await db.insert(estimatePropValues).values({
      estimateRevisionId: params.estimateRevisionId,
      estimateDocumentId: params.estimateDocumentId,
      property: entry.property,
      estimatePropKeyTypeId: keyType.id,
      workerAiExtractedValue: entry.extractedValue,
      intakeFormValue: null,
      isUserOverridden: false,
      datetimeCreated: new Date(),
      datetimeUpdated: new Date(),
    });
  }
}

async function parseSourceRequest(c: any) {
  const contentType = (c.req.header("content-type") || "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    return {
      sourceType: String(form.get("sourceType") || ""),
      draftRevisionId: form.get("draftRevisionId") ? Number(form.get("draftRevisionId")) : null,
      sourceUrl: form.get("sourceUrl") ? String(form.get("sourceUrl")) : null,
      freeText: form.get("freeText") ? String(form.get("freeText")) : null,
      audioBase64: form.get("audioBase64") ? String(form.get("audioBase64")) : null,
      file: form.get("file") instanceof File ? (form.get("file") as File) : null,
      scenarioId: form.get("scenarioId") ? String(form.get("scenarioId")) : null,
    };
  }
  const body = (await c.req.json()) as {
    sourceType?: string;
    draftRevisionId?: number | null;
    sourceUrl?: string | null;
    freeText?: string | null;
    audioBase64?: string | null;
    scenarioId?: string | null;
  };
  return {
    sourceType: body.sourceType || "",
    draftRevisionId:
      typeof body.draftRevisionId === "number" && Number.isFinite(body.draftRevisionId)
        ? body.draftRevisionId
        : null,
    sourceUrl: body.sourceUrl || null,
    freeText: body.freeText || null,
    audioBase64: body.audioBase64 || null,
    file: null as File | null,
    scenarioId: body.scenarioId || null,
  };
}

estimatesRouter.get("/", async (c) => {
  try {
    await ensureEstimateStatuses(c.env);
    const db = drizzle(c.env.DB);
    const estimateRows = await db
      .select()
      .from(estimates)
      .orderBy(desc(estimates.datetimeUpdated))
      .all();
    const latestRevisionRows = await db
      .select()
      .from(estimateRevisions)
      .where(eq(estimateRevisions.isLatest, true))
      .all();
    const companyRows = await db.select().from(estimateCompanies).all();
    const companyById = new Map(companyRows.map((row) => [row.id, row]));
    const latestByEstimate = new Map(latestRevisionRows.map((row) => [row.estimateId, row]));

    return c.json({
      estimates: estimateRows.map((estimate) => ({
        ...estimate,
        currentRevision: latestByEstimate.get(estimate.id) || null,
        company: estimate.estimateCompanyId
          ? companyById.get(estimate.estimateCompanyId) || null
          : null,
      })),
      drafts: latestRevisionRows.filter((row) => row.isDraft),
      recentlyUpdated: latestRevisionRows
        .slice()
        .sort(
          (a, b) =>
            new Date(b.datetimeUpdated || 0).getTime() - new Date(a.datetimeUpdated || 0).getTime(),
        )
        .slice(0, 30),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list estimates",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimatesRouter.post("/drafts", async (c) => {
  try {
    await ensureEstimateStatuses(c.env);
    const body = (await c.req.json()) as {
      scenarioId?: string | null;
      estimateCompanyId?: number | null;
      createdBy?: string | null;
      sourceSummary?: string | null;
    };

    const db = drizzle(c.env.DB);
    const now = new Date();
    const estimateInsert = await db
      .insert(estimates)
      .values({
        scenarioId: body.scenarioId?.trim() || null,
        estimateCompanyId:
          typeof body.estimateCompanyId === "number" ? body.estimateCompanyId : null,
        isActive: true,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();
    const estimate = estimateInsert[0];
    const revisionInsert = await db
      .insert(estimateRevisions)
      .values({
        estimateId: estimate.id,
        revisionNumber: 1,
        isDraft: true,
        isLatest: true,
        createdBy: body.createdBy?.trim() || "system",
        sourceSummary: body.sourceSummary?.trim() || null,
        changeSource: "manual",
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();
    const revision = revisionInsert[0];

    await db
      .update(estimates)
      .set({
        currentRevisionId: revision.id,
        datetimeUpdated: now,
      })
      .where(eq(estimates.id, estimate.id))
      .run();

    await db.insert(estimateRevisionSnapshots).values({
      estimateRevisionId: revision.id,
      snapshotType: "draft_init",
      snapshotJson: JSON.stringify({
        estimateId: estimate.id,
        revisionId: revision.id,
      }),
      createdBy: body.createdBy?.trim() || "system",
      datetimeCreated: now,
    });

    return c.json({ estimate, revision }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create estimate draft",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimatesRouter.patch("/drafts/:id/autosave", async (c) => {
  try {
    const revisionId = Number(c.req.param("id"));
    if (!Number.isFinite(revisionId)) {
      return c.json({ error: "Invalid revision ID" }, 400);
    }
    const body = (await c.req.json()) as {
      wizardState?: Record<string, unknown>;
      statusNotes?: string;
      estimateStatusId?: number | null;
      estimateCompanyId?: number | null;
      aiRationale?: string | null;
      changeSource?: string | null;
      createdBy?: string | null;
    };

    const db = drizzle(c.env.DB);
    const revision = await db
      .select()
      .from(estimateRevisions)
      .where(eq(estimateRevisions.id, revisionId))
      .get();
    if (!revision) {
      return c.json({ error: "Draft revision not found" }, 404);
    }

    const estimate = await db
      .select()
      .from(estimates)
      .where(eq(estimates.id, revision.estimateId))
      .get();
    if (!estimate) {
      return c.json({ error: "Estimate not found" }, 404);
    }

    await db
      .update(estimateRevisions)
      .set({
        isDraft: true,
        statusNotes:
          typeof body.statusNotes === "string" ? body.statusNotes.trim() : revision.statusNotes,
        estimateStatusId:
          typeof body.estimateStatusId === "number"
            ? body.estimateStatusId
            : revision.estimateStatusId,
        aiRationale:
          typeof body.aiRationale === "string" || body.aiRationale === null
            ? body.aiRationale
            : revision.aiRationale,
        changeSource: body.changeSource?.trim() || revision.changeSource,
        datetimeUpdated: new Date(),
      })
      .where(eq(estimateRevisions.id, revision.id))
      .run();

    if ("estimateCompanyId" in body) {
      await db
        .update(estimates)
        .set({
          estimateCompanyId:
            typeof body.estimateCompanyId === "number" ? body.estimateCompanyId : null,
          datetimeUpdated: new Date(),
        })
        .where(eq(estimates.id, estimate.id))
        .run();
    }

    await db.insert(estimateRevisionSnapshots).values({
      estimateRevisionId: revision.id,
      snapshotType: "autosave",
      snapshotJson: JSON.stringify(body.wizardState || {}),
      createdBy: body.createdBy?.trim() || "system",
      datetimeCreated: new Date(),
    });

    try {
      await publishRealtimeEvent(
        c.env,
        estimate.scenarioId ? `scenario:${estimate.scenarioId}` : "home",
        {
          event: "estimate.draft.autosaved",
          estimateId: estimate.id,
          revisionId: revision.id,
          at: new Date().toISOString(),
        },
      );
    } catch {
      // non-fatal
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json(
      {
        error: "Failed to autosave draft",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimatesRouter.post("/intake/source", async (c) => {
  try {
    await ensureEstimateStatuses(c.env);
    const source = await parseSourceRequest(c);
    const sourceType = source.sourceType as
      | "pdf"
      | "photo"
      | "url"
      | "free_text"
      | "audio_transcript";
    if (!["pdf", "photo", "url", "free_text", "audio_transcript"].includes(sourceType)) {
      return c.json({ error: "Invalid sourceType" }, 400);
    }

    const db = drizzle(c.env.DB);

    let revisionId = source.draftRevisionId;
    let estimateId: number;
    let scenarioId: string | null = source.scenarioId;

    if (!revisionId) {
      const now = new Date();
      const createdEstimate = await db
        .insert(estimates)
        .values({
          scenarioId: scenarioId || null,
          estimateCompanyId: null,
          currentRevisionId: null,
          isActive: true,
          datetimeCreated: now,
          datetimeUpdated: now,
        })
        .returning();
      estimateId = createdEstimate[0].id;
      const createdRevision = await db
        .insert(estimateRevisions)
        .values({
          estimateId,
          revisionNumber: 1,
          isDraft: true,
          isLatest: true,
          changeSource: "intake_source",
          datetimeCreated: now,
          datetimeUpdated: now,
        })
        .returning();
      revisionId = createdRevision[0].id;
      await db
        .update(estimates)
        .set({
          currentRevisionId: revisionId,
          datetimeUpdated: now,
        })
        .where(eq(estimates.id, estimateId))
        .run();
    } else {
      const revision = await db
        .select()
        .from(estimateRevisions)
        .where(eq(estimateRevisions.id, revisionId))
        .get();
      if (!revision) {
        return c.json({ error: "draftRevisionId not found" }, 404);
      }
      estimateId = revision.estimateId;
      const estimate = await db.select().from(estimates).where(eq(estimates.id, estimateId)).get();
      scenarioId = estimate?.scenarioId || null;
    }

    const sourceContent = await extractSourceContent(c.env, {
      sourceType,
      file: source.file,
      sourceUrl: source.sourceUrl,
      freeText: source.freeText,
      audioBase64: source.audioBase64,
    });

    const knownCompanies = await db.select().from(estimateCompanies).all();
    const extracted = await extractStructuredEstimate(c.env, {
      rawText: sourceContent.rawText,
      sourceType,
      knownCompanies,
    });

    const docInsert = await db
      .insert(estimateDocuments)
      .values({
        estimateRevisionId: revisionId,
        sourceType,
        r2ObjectKey: sourceContent.uploadedArtifact?.key || null,
        r2Url: sourceContent.uploadedArtifact?.url || null,
        sourceUrl: sourceContent.sourceUrl,
        rawText: sourceContent.rawText,
        rawMarkdown: sourceContent.rawMarkdown,
        aiStructuredExtractionJson: JSON.stringify(extracted),
        datetimeCreated: new Date(),
        datetimeUpdated: new Date(),
      })
      .returning();
    const estimateDocument = docInsert[0];

    await registerStructuredProps(db, {
      estimateRevisionId: revisionId,
      estimateDocumentId: estimateDocument.id,
      extracted: extracted as Record<string, unknown>,
    });

    await db.insert(estimateSourceEvents).values({
      estimateRevisionId: revisionId,
      estimateDocumentId: estimateDocument.id,
      sourceType,
      eventType: "ingest_extract",
      payloadJson: JSON.stringify({
        sourceUrl: sourceContent.sourceUrl,
        r2Url: sourceContent.uploadedArtifact?.url || null,
      }),
      datetimeCreated: new Date(),
    });

    await db
      .update(estimateRevisions)
      .set({
        isDraft: true,
        dateEstimate: extracted.estimateDate ? new Date(extracted.estimateDate) : null,
        totalAmountCents: extracted.totalAmountCents ?? null,
        totalTaxCents: extracted.totalTaxCents ?? null,
        depositAmountCents: extracted.depositAmountCents ?? null,
        warrantyDetails: extracted.warrantyDetails || null,
        cancellationDetails: extracted.cancellationDetails || null,
        sourceSummary: extracted.notes || null,
        changeSource: "intake_source",
        datetimeUpdated: new Date(),
      })
      .where(eq(estimateRevisions.id, revisionId))
      .run();

    await db.insert(estimateRevisionSnapshots).values({
      estimateRevisionId: revisionId,
      snapshotType: "source_processed",
      snapshotJson: JSON.stringify({
        sourceType,
        estimateDocumentId: estimateDocument.id,
        extracted,
      }),
      createdBy: "system",
      datetimeCreated: new Date(),
    });

    try {
      await publishRealtimeEvent(c.env, scenarioId ? `scenario:${scenarioId}` : "home", {
        event: "estimate.ai.extraction.completed",
        estimateId,
        revisionId,
        estimateDocumentId: estimateDocument.id,
      });
    } catch {
      // non-fatal
    }

    return c.json({
      success: true,
      estimateId,
      draftRevisionId: revisionId,
      estimateDocument,
      extracted,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to process intake source",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimatesRouter.post("/intake/extract", async (c) => {
  try {
    const body = (await c.req.json()) as { estimateDocumentId?: number };
    const estimateDocumentId = Number(body.estimateDocumentId);
    if (!Number.isFinite(estimateDocumentId)) {
      return c.json({ error: "estimateDocumentId is required" }, 400);
    }
    const db = drizzle(c.env.DB);
    const document = await db
      .select()
      .from(estimateDocuments)
      .where(eq(estimateDocuments.id, estimateDocumentId))
      .get();
    if (!document) {
      return c.json({ error: "Estimate document not found" }, 404);
    }
    const companies = await db.select().from(estimateCompanies).all();
    const extracted = await extractStructuredEstimate(c.env, {
      rawText: document.rawText || "",
      sourceType: document.sourceType,
      knownCompanies: companies,
    });

    await db
      .update(estimateDocuments)
      .set({
        aiStructuredExtractionJson: JSON.stringify(extracted),
        datetimeUpdated: new Date(),
      })
      .where(eq(estimateDocuments.id, estimateDocumentId))
      .run();

    await db
      .delete(estimatePropValues)
      .where(
        and(
          eq(estimatePropValues.estimateRevisionId, document.estimateRevisionId),
          eq(estimatePropValues.estimateDocumentId, estimateDocumentId),
        ),
      )
      .run();

    await registerStructuredProps(db, {
      estimateRevisionId: document.estimateRevisionId,
      estimateDocumentId,
      extracted: extracted as Record<string, unknown>,
    });

    return c.json({
      success: true,
      extracted,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to re-run structured extraction",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimatesRouter.post("/intake/confirm", async (c) => {
  try {
    const body = (await c.req.json()) as {
      draftRevisionId?: number;
      estimateCompanyId?: number | null;
      estimateStatusId?: number | null;
      statusNotes?: string | null;
      aiRationale?: string | null;
      dateEstimate?: string | null;
      totalAmountCents?: number | null;
      totalTaxCents?: number | null;
      depositAmountCents?: number | null;
      warrantyDetails?: string | null;
      cancellationDetails?: string | null;
      lineItems?: Array<{
        itemCode?: string | null;
        description: string;
        qty?: number | null;
        uom?: string | null;
        unitCostCents?: number | null;
        lineTotalCents?: number | null;
        taxCents?: number | null;
        notes?: string | null;
      }>;
      roomIds?: number[];
      propValues?: Array<{
        property: string;
        intakeFormValue?: string | null;
        workerAiExtractedValue?: string | null;
      }>;
      submit?: boolean;
      createdBy?: string | null;
    };
    const draftRevisionId = Number(body.draftRevisionId);
    if (!Number.isFinite(draftRevisionId)) {
      return c.json({ error: "draftRevisionId is required" }, 400);
    }

    const db = drizzle(c.env.DB);
    const revision = await db
      .select()
      .from(estimateRevisions)
      .where(eq(estimateRevisions.id, draftRevisionId))
      .get();
    if (!revision) {
      return c.json({ error: "Draft revision not found" }, 404);
    }
    const estimate = await db
      .select()
      .from(estimates)
      .where(eq(estimates.id, revision.estimateId))
      .get();
    if (!estimate) {
      return c.json({ error: "Estimate not found" }, 404);
    }

    const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
    const roomIds = Array.isArray(body.roomIds) ? body.roomIds : [];

    const now = new Date();

    // None of these writes depend on an id generated by another write in this
    // handler — every insert/update/delete here targets `draftRevisionId` or
    // `estimate.id`, both already known. So this is "independent writes, no
    // read between": `db.transaction()` doesn't work on D1 (see AGENTS.md), but
    // `db.batch()` gives real all-or-nothing atomicity for the whole set. The
    // one read that used to happen mid-transaction (looking up each prop's
    // `estimatePropKeyTypeId`) is a lookup against a separate definitions
    // table, not a dependency on anything this handler writes, so it's
    // resolved up front, outside the atomic unit, before the batch is built.
    const lineItemValues = lineItems
      .filter((lineItem) => lineItem.description && lineItem.description.trim())
      .map((lineItem) => ({
        estimateRevisionId: draftRevisionId,
        itemCode: lineItem.itemCode?.trim() || null,
        description: (lineItem.description || "").trim(),
        qty:
          typeof lineItem.qty === "number" && Number.isFinite(lineItem.qty) ? lineItem.qty : null,
        uom: lineItem.uom?.trim() || null,
        unitCostCents: typeof lineItem.unitCostCents === "number" ? lineItem.unitCostCents : null,
        lineTotalCents:
          typeof lineItem.lineTotalCents === "number" ? lineItem.lineTotalCents : null,
        taxCents: typeof lineItem.taxCents === "number" ? lineItem.taxCents : null,
        notes: lineItem.notes?.trim() || null,
        datetimeCreated: now,
        datetimeUpdated: now,
      }));

    const roomMappingValues = roomIds
      .filter((roomId) => Number.isFinite(roomId))
      .map((roomId) => ({
        estimateRevisionId: draftRevisionId,
        roomId,
        datetimeCreated: now,
      }));

    const propValueInserts: BatchItem<"sqlite">[] = [];
    if (Array.isArray(body.propValues)) {
      // Resolve every prop key type in ONE pass rather than a SELECT per prop.
      // On D1 each query is a network round trip, so an intake with 40 props
      // used to cost 40 sequential round trips before a single row was written.
      const properties = [
        ...new Set(
          body.propValues.map((prop) => (prop.property || "").trim()).filter(Boolean),
        ),
      ];

      // D1 caps a statement at 100 bound parameters, so an `inArray` over an
      // unbounded list fails once the intake is large enough — chunk under the
      // cap rather than discovering the ceiling in production.
      const CHUNK = 90;
      const typeRows: (typeof estimatePropKeyTypes.$inferSelect)[] = [];
      for (let i = 0; i < properties.length; i += CHUNK) {
        const rows = await db
          .select()
          .from(estimatePropKeyTypes)
          .where(inArray(estimatePropKeyTypes.property, properties.slice(i, i + CHUNK)))
          .all();
        typeRows.push(...rows);
      }
      const typeByProperty = new Map(typeRows.map((row) => [row.property, row]));

      for (const prop of body.propValues) {
        const property = (prop.property || "").trim();
        if (!property) continue;
        const typeRow = typeByProperty.get(property);
        // Unknown property — no key type row to reference, so skip it (same
        // behaviour as before; the per-prop SELECT simply returned nothing).
        if (!typeRow) continue;
        propValueInserts.push(
          db.insert(estimatePropValues).values({
            estimateRevisionId: draftRevisionId,
            estimateDocumentId: null,
            property,
            estimatePropKeyTypeId: typeRow.id,
            workerAiExtractedValue: prop.workerAiExtractedValue || null,
            intakeFormValue: prop.intakeFormValue || null,
            isUserOverridden: true,
            datetimeCreated: now,
            datetimeUpdated: now,
          }),
        );
      }
    }

    const stmts: BatchItem<"sqlite">[] = [
      db
        .update(estimateRevisions)
        .set({
          estimateStatusId:
            typeof body.estimateStatusId === "number"
              ? body.estimateStatusId
              : revision.estimateStatusId,
          statusNotes:
            typeof body.statusNotes === "string" || body.statusNotes === null
              ? body.statusNotes
              : revision.statusNotes,
          aiRationale:
            typeof body.aiRationale === "string" || body.aiRationale === null
              ? body.aiRationale
              : revision.aiRationale,
          dateEstimate:
            typeof body.dateEstimate === "string" && body.dateEstimate.trim()
              ? new Date(body.dateEstimate)
              : revision.dateEstimate,
          totalAmountCents:
            typeof body.totalAmountCents === "number"
              ? body.totalAmountCents
              : revision.totalAmountCents,
          totalTaxCents:
            typeof body.totalTaxCents === "number" ? body.totalTaxCents : revision.totalTaxCents,
          depositAmountCents:
            typeof body.depositAmountCents === "number"
              ? body.depositAmountCents
              : revision.depositAmountCents,
          warrantyDetails:
            typeof body.warrantyDetails === "string" || body.warrantyDetails === null
              ? body.warrantyDetails
              : revision.warrantyDetails,
          cancellationDetails:
            typeof body.cancellationDetails === "string" || body.cancellationDetails === null
              ? body.cancellationDetails
              : revision.cancellationDetails,
          isDraft: body.submit ? false : true,
          changeSource: body.submit ? "submit" : "confirm",
          datetimeUpdated: now,
        })
        .where(eq(estimateRevisions.id, draftRevisionId)),
    ];

    if ("estimateCompanyId" in body) {
      stmts.push(
        db
          .update(estimates)
          .set({
            estimateCompanyId:
              typeof body.estimateCompanyId === "number" ? body.estimateCompanyId : null,
            datetimeUpdated: now,
          })
          .where(eq(estimates.id, estimate.id)),
      );
    }

    stmts.push(
      db.delete(estimateLineItems).where(eq(estimateLineItems.estimateRevisionId, draftRevisionId)),
    );
    if (lineItemValues.length > 0) {
      stmts.push(db.insert(estimateLineItems).values(lineItemValues));
    }

    stmts.push(
      db
        .delete(estimateRoomMappings)
        .where(eq(estimateRoomMappings.estimateRevisionId, draftRevisionId)),
    );
    if (roomMappingValues.length > 0) {
      stmts.push(db.insert(estimateRoomMappings).values(roomMappingValues));
    }

    stmts.push(...propValueInserts);

    stmts.push(
      db.insert(estimateRevisionSnapshots).values({
        estimateRevisionId: draftRevisionId,
        snapshotType: body.submit ? "submitted" : "confirmed",
        snapshotJson: JSON.stringify(body),
        createdBy: body.createdBy?.trim() || "system",
        datetimeCreated: now,
      }),
    );

    stmts.push(
      db.insert(estimateSourceEvents).values({
        estimateRevisionId: draftRevisionId,
        estimateDocumentId: null,
        sourceType: "wizard",
        eventType: body.submit ? "submit" : "confirm",
        payloadJson: JSON.stringify({
          roomCount: roomMappingValues.length,
          lineItemCount: lineItemValues.length,
        }),
        datetimeCreated: now,
      }),
    );

    if (body.submit) {
      stmts.push(...buildMarkAsCurrentRevisionStatements(db, estimate.id, draftRevisionId));
    }

    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);

    try {
      await publishRealtimeEvent(
        c.env,
        estimate.scenarioId ? `scenario:${estimate.scenarioId}` : "home",
        {
          event: body.submit ? "estimate.revision.submitted" : "estimate.revision.confirmed",
          estimateId: estimate.id,
          revisionId: draftRevisionId,
        },
      );
    } catch {
      // non-fatal
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json(
      {
        error: "Failed to confirm estimate intake",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimatesRouter.post("/:id/revisions", async (c) => {
  try {
    const estimateId = Number(c.req.param("id"));
    if (!Number.isFinite(estimateId)) {
      return c.json({ error: "Invalid estimate ID" }, 400);
    }
    const body = (await c.req.json()) as {
      estimateStatusId?: number | null;
      statusNotes?: string | null;
      aiRationale?: string | null;
      changeSource?: string | null;
      createdBy?: string | null;
      isDraft?: boolean;
    };
    const db = drizzle(c.env.DB);
    const estimate = await db.select().from(estimates).where(eq(estimates.id, estimateId)).get();
    if (!estimate) {
      return c.json({ error: "Estimate not found" }, 404);
    }
    const revisionNumber = await getNextRevisionNumber(db, estimateId);
    const now = new Date();
    const inserted = await db
      .insert(estimateRevisions)
      .values({
        estimateId,
        revisionNumber,
        isDraft: body.isDraft ?? true,
        isLatest: true,
        estimateStatusId: typeof body.estimateStatusId === "number" ? body.estimateStatusId : null,
        statusNotes: body.statusNotes || null,
        aiRationale: body.aiRationale || null,
        changeSource: body.changeSource || "manual_revision",
        createdBy: body.createdBy || "system",
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();
    const revision = inserted[0];
    await markAsCurrentRevision(db, estimateId, revision.id);

    try {
      await publishRealtimeEvent(
        c.env,
        estimate.scenarioId ? `scenario:${estimate.scenarioId}` : "home",
        {
          event: "estimate.revision.created",
          estimateId,
          revisionId: revision.id,
        },
      );
    } catch {
      // non-fatal
    }

    return c.json({ revision }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create estimate revision",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimatesRouter.get("/:id/revisions", async (c) => {
  try {
    const estimateId = Number(c.req.param("id"));
    if (!Number.isFinite(estimateId)) {
      return c.json({ error: "Invalid estimate ID" }, 400);
    }
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(estimateRevisions)
      .where(eq(estimateRevisions.estimateId, estimateId))
      .orderBy(desc(estimateRevisions.revisionNumber))
      .all();
    return c.json({ revisions: rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list estimate revisions",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimatesRouter.get("/:id/revisions/:revisionId", async (c) => {
  try {
    const estimateId = Number(c.req.param("id"));
    const revisionId = Number(c.req.param("revisionId"));
    if (!Number.isFinite(estimateId) || !Number.isFinite(revisionId)) {
      return c.json({ error: "Invalid IDs" }, 400);
    }
    const db = drizzle(c.env.DB);
    const revision = await db
      .select()
      .from(estimateRevisions)
      .where(
        and(eq(estimateRevisions.id, revisionId), eq(estimateRevisions.estimateId, estimateId)),
      )
      .get();
    if (!revision) {
      return c.json({ error: "Revision not found" }, 404);
    }
    const [documents, lineItems, roomMappings, propValues, snapshots, sourceEvents] =
      await Promise.all([
        db
          .select()
          .from(estimateDocuments)
          .where(eq(estimateDocuments.estimateRevisionId, revisionId))
          .orderBy(desc(estimateDocuments.datetimeCreated))
          .all(),
        db
          .select()
          .from(estimateLineItems)
          .where(eq(estimateLineItems.estimateRevisionId, revisionId))
          .orderBy(asc(estimateLineItems.id))
          .all(),
        db
          .select()
          .from(estimateRoomMappings)
          .where(eq(estimateRoomMappings.estimateRevisionId, revisionId))
          .orderBy(asc(estimateRoomMappings.id))
          .all(),
        db
          .select()
          .from(estimatePropValues)
          .where(eq(estimatePropValues.estimateRevisionId, revisionId))
          .orderBy(asc(estimatePropValues.id))
          .all(),
        db
          .select()
          .from(estimateRevisionSnapshots)
          .where(eq(estimateRevisionSnapshots.estimateRevisionId, revisionId))
          .orderBy(desc(estimateRevisionSnapshots.datetimeCreated))
          .all(),
        db
          .select()
          .from(estimateSourceEvents)
          .where(eq(estimateSourceEvents.estimateRevisionId, revisionId))
          .orderBy(desc(estimateSourceEvents.datetimeCreated))
          .all(),
      ]);

    return c.json({
      revision,
      documents,
      lineItems: await attachServiceNames(db, lineItems),
      roomMappings,
      propValues,
      snapshots,
      sourceEvents,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load estimate revision detail",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * Set (or clear) the services-catalog tie on a single estimate line item.
 *
 * Body: `{ serviceId: number | null }`. A positive integer attaches the line
 * item to that `services` catalog row (for business/architect/consulting
 * estimates that bill services rather than materials); `null` clears the
 * tie. This is a narrow, single-field PATCH — full line-item edits still go
 * through the bulk `/drafts/:id/autosave` replace-all-line-items flow.
 */
estimatesRouter.patch("/line-items/:lineItemId", async (c) => {
  const db = drizzle(c.env.DB);
  const lineItemId = parseInt(c.req.param("lineItemId"), 10);
  if (Number.isNaN(lineItemId)) {
    return c.json({ error: "Invalid lineItemId" }, 400);
  }
  const body = await c.req.json().catch(() => ({}));

  let serviceId: number | null;
  if (body.serviceId === null) {
    serviceId = null;
  } else {
    if (typeof body.serviceId !== "number" || !Number.isInteger(body.serviceId) || body.serviceId <= 0) {
      return c.json({ error: "serviceId must be a positive integer or null" }, 400);
    }
    serviceId = body.serviceId;
  }

  const [updated] = await db
    .update(estimateLineItems)
    .set({ serviceId, datetimeUpdated: new Date() })
    .where(eq(estimateLineItems.id, lineItemId))
    .returning();
  if (!updated) return c.json({ error: "Line item not found" }, 404);

  return c.json({ lineItem: updated });
});

const MAPPING_STATUSES = ["unmapped", "ai_suggested", "confirmed", "rejected"] as const;

/**
 * Human-confirm write for room/budget-track mapping on a line item.
 *
 * Body: `{ roomId?: number|null, budgetItemTrackId?: string|null, mappingStatus?:
 * 'unmapped'|'ai_suggested'|'confirmed'|'rejected' }`. This is the ONLY route that
 * ever writes `roomId` — `POST /line-items/:lineItemId/ai-suggest` only stages a
 * guess in the `aiSuggested*` columns. If `roomId` is provided as a number and
 * `mappingStatus` was not, the mapping auto-advances to 'confirmed'.
 */
estimatesRouter.patch("/line-items/:lineItemId/reconcile", async (c) => {
  const db = drizzle(c.env.DB);
  const lineItemId = parseInt(c.req.param("lineItemId"), 10);
  if (Number.isNaN(lineItemId)) {
    return c.json({ error: "Invalid lineItemId" }, 400);
  }
  const body = await c.req.json().catch(() => ({}));

  const patch: Partial<typeof estimateLineItems.$inferInsert> = {};

  if ("roomId" in body) {
    if (body.roomId === null) {
      patch.roomId = null;
    } else {
      if (typeof body.roomId !== "number" || !Number.isInteger(body.roomId) || body.roomId <= 0) {
        return c.json({ error: "roomId must be a positive integer or null" }, 400);
      }
      const room = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, body.roomId)).get();
      if (!room) {
        return c.json({ error: `roomId ${body.roomId} does not exist` }, 400);
      }
      patch.roomId = body.roomId;
    }
  }

  if ("budgetItemTrackId" in body) {
    if (body.budgetItemTrackId !== null && typeof body.budgetItemTrackId !== "string") {
      return c.json({ error: "budgetItemTrackId must be a string or null" }, 400);
    }
    patch.budgetItemTrackId = body.budgetItemTrackId;
  }

  if ("mappingStatus" in body) {
    if (!MAPPING_STATUSES.includes(body.mappingStatus)) {
      return c.json(
        { error: `mappingStatus must be one of ${MAPPING_STATUSES.join(", ")}` },
        400,
      );
    }
    patch.mappingStatus = body.mappingStatus;
  }

  if (!("mappingStatus" in body)) {
    if (typeof patch.roomId === "number") {
      patch.mappingStatus = "confirmed";
    } else if (patch.roomId === null) {
      patch.mappingStatus = "unmapped";
    }
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  patch.datetimeUpdated = new Date();

  const [updated] = await db
    .update(estimateLineItems)
    .set(patch)
    .where(eq(estimateLineItems.id, lineItemId))
    .returning();
  if (!updated) return c.json({ error: "Line item not found" }, 404);

  return c.json({ lineItem: updated });
});

const AI_SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          roomId: { type: "number" },
          confidence: { type: "number" },
          reasoning: { type: "string" },
        },
        required: ["roomId", "confidence", "reasoning"],
      },
    },
    suggestedCategory: { type: ["string", "null"] },
  },
  required: ["candidates", "suggestedCategory"],
};

interface AiSuggestModelCandidate {
  roomId?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
}

/**
 * Stage an AI room/category guess for a line item — never a hard write of
 * `roomId`. The model only ever sees the real room ids for this house and must
 * return ids from that set; any id it hallucinates is dropped before anything
 * touches the row. A human confirms via `PATCH .../reconcile`.
 */
estimatesRouter.post("/line-items/:lineItemId/ai-suggest", async (c) => {
  try {
    const lineItemId = parseInt(c.req.param("lineItemId"), 10);
    if (Number.isNaN(lineItemId)) {
      return c.json({ error: "Invalid lineItemId" }, 400);
    }
    const db = drizzle(c.env.DB);
    const lineItem = await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.id, lineItemId))
      .get();
    if (!lineItem) {
      return c.json({ error: "Line item not found" }, 404);
    }
    if (lineItem.mappingStatus === "confirmed") {
      return c.json(
        { error: "Line item already confirmed; unmap before re-suggesting" },
        409,
      );
    }

    const activeRooms = await db
      .select({ id: rooms.id, roomName: rooms.roomName })
      .from(rooms)
      .where(eq(rooms.isActive, true))
      .all();
    const roomById = new Map(activeRooms.map((room) => [room.id, room]));

    const roomList = activeRooms.map((room) => `${room.id}: ${room.roomName}`).join("\n") || "(none)";
    const prompt =
      `Line item description: "${lineItem.description}"\n` +
      `Line total (cents): ${lineItem.lineTotalCents ?? "unknown"}\n\n` +
      `Which room(s) does this line item belong to? Choose ONLY from these room ids:\n${roomList}\n\n` +
      `Return up to 3 candidates ranked by confidence (0-1), each with a short reason. ` +
      `Also suggest a short budget category label for this line item, or null if unclear.`;

    // Never degrade a failed parse to {} — let generateStructured's error
    // (StructuredOutputError, carrying both provider errors) propagate to the
    // catch block below, which surfaces it in the response instead of hiding it.
    const { data } = await generateStructured<{
      candidates?: AiSuggestModelCandidate[];
      suggestedCategory?: unknown;
    }>(c.env, {
      feature: "estimate_line_item_ai_suggest",
      system:
        "You map remodel estimate line items to rooms in a house. Respond only with JSON.",
      prompt,
      schema: AI_SUGGEST_SCHEMA,
    });

    // Validate every returned roomId against the live rooms set — a
    // hallucinated id must never reach aiSuggestedRoomId (an FK column).
    const validated = (Array.isArray(data.candidates) ? data.candidates : [])
      .filter(
        (cand): cand is { roomId: number; confidence: number; reasoning: string } =>
          typeof cand.roomId === "number" &&
          roomById.has(cand.roomId) &&
          typeof cand.confidence === "number" &&
          typeof cand.reasoning === "string",
      )
      .sort((a, b) => b.confidence - a.confidence);

    const suggestedCategory =
      typeof data.suggestedCategory === "string" ? data.suggestedCategory : null;
    const top = validated[0] ?? null;

    await db
      .update(estimateLineItems)
      .set({
        aiSuggestedRoomId: top?.roomId ?? null,
        aiSuggestedCategory: suggestedCategory,
        mappingConfidence: top?.confidence ?? null,
        mappingStatus: "ai_suggested",
        datetimeUpdated: new Date(),
      })
      .where(eq(estimateLineItems.id, lineItemId))
      .run();

    return c.json({
      lineItemId,
      candidates: validated.map((cand) => ({
        roomId: cand.roomId,
        roomName: roomById.get(cand.roomId)?.roomName ?? null,
        confidence: cand.confidence,
        reasoning: cand.reasoning,
      })),
      suggestedCategory,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to generate AI room suggestion",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * HITL reconciliation queue: line items still `unmapped` or `ai_suggested`,
 * joined out to their estimate/company/revision context and (when staged) the
 * AI-suggested room's display name.
 */
estimatesRouter.get("/reconcile/queue", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

    const rowsPlusOne = await db
      .select({
        lineItem: estimateLineItems,
        estimateId: estimates.id,
        estimateScenarioId: estimates.scenarioId,
        companyId: estimateCompanies.id,
        companyName: estimateCompanies.name,
        revisionId: estimateRevisions.id,
        revisionNumber: estimateRevisions.revisionNumber,
        suggestedRoomName: rooms.roomName,
      })
      .from(estimateLineItems)
      // innerJoin + isLatest scopes this to the LATEST revision only — otherwise
      // lines from old/draft revisions of the same estimate show up in the
      // queue too. Kept in sync with the unmapped_estimate count in
      // services/budget/inbox.ts.
      .innerJoin(estimateRevisions, eq(estimateLineItems.estimateRevisionId, estimateRevisions.id))
      .leftJoin(estimates, eq(estimateRevisions.estimateId, estimates.id))
      .leftJoin(estimateCompanies, eq(estimates.estimateCompanyId, estimateCompanies.id))
      .leftJoin(rooms, eq(estimateLineItems.aiSuggestedRoomId, rooms.id))
      .where(
        and(
          inArray(estimateLineItems.mappingStatus, ["unmapped", "ai_suggested"]),
          eq(estimateRevisions.isLatest, true),
        ),
      )
      .orderBy(asc(estimateLineItems.datetimeCreated))
      .limit(limit + 1)
      .offset(offset)
      .all();

    const hasMore = rowsPlusOne.length > limit;
    const rows = rowsPlusOne.slice(0, limit);

    return c.json({
      items: rows.map((row) => ({
        lineItemId: row.lineItem.id,
        description: row.lineItem.description,
        lineTotalCents: row.lineItem.lineTotalCents,
        mappingStatus: row.lineItem.mappingStatus,
        roomId: row.lineItem.roomId,
        budgetItemTrackId: row.lineItem.budgetItemTrackId,
        aiSuggestedRoomId: row.lineItem.aiSuggestedRoomId,
        aiSuggestedRoomName: row.suggestedRoomName,
        aiSuggestedCategory: row.lineItem.aiSuggestedCategory,
        mappingConfidence: row.lineItem.mappingConfidence,
        estimateId: row.estimateId,
        estimateScenarioId: row.estimateScenarioId,
        company: row.companyId ? { id: row.companyId, name: row.companyName } : null,
        revision: row.revisionId
          ? { id: row.revisionId, revisionNumber: row.revisionNumber }
          : null,
      })),
      limit,
      offset,
      hasMore,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load reconciliation queue",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { estimatesRouter };
