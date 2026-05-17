import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  contractClauseFindings,
  contractDocuments,
  contractMonitoringEvents,
  contractPaymentMilestones,
  contractRevisions,
  contracts,
  contractStatuses,
  contractTimelineMilestones,
  contractWarrantyTerms,
  estimateCompanies,
} from "@backend/db";
import { publishRealtimeEvent } from "@backend/realtime/publish";
import { generateStructuredOutput } from "@backend/ai/providers";
import { z } from "zod";
import { extractSourceContent } from "@backend/services/estimate-intake";

const contractsRouter = new Hono<{ Bindings: Env }>();

const DEFAULT_CONTRACT_STATUSES = [
  {
    name: "draft",
    description: "Draft contract not yet reviewed",
    sortOrder: 10,
    isTerminal: false,
  },
  {
    name: "under_review",
    description: "Under review",
    sortOrder: 20,
    isTerminal: false,
  },
  {
    name: "negotiating",
    description: "Negotiating terms",
    sortOrder: 30,
    isTerminal: false,
  },
  {
    name: "accepted",
    description: "Accepted and active",
    sortOrder: 40,
    isTerminal: false,
  },
  {
    name: "completed",
    description: "Work completed",
    sortOrder: 50,
    isTerminal: true,
  },
  {
    name: "terminated",
    description: "Terminated",
    sortOrder: 60,
    isTerminal: true,
  },
];

async function ensureContractStatuses(env: Env) {
  const db = drizzle(env.DB);
  for (const status of DEFAULT_CONTRACT_STATUSES) {
    await db
      .insert(contractStatuses)
      .values({
        ...status,
        datetimeCreated: new Date(),
        datetimeUpdated: new Date(),
      })
      .onConflictDoNothing()
      .run();
  }
}

async function getNextRevisionNumber(db: ReturnType<typeof drizzle>, contractId: number) {
  const rows = await db
    .select({ revisionNumber: contractRevisions.revisionNumber })
    .from(contractRevisions)
    .where(eq(contractRevisions.contractId, contractId))
    .all();
  return rows.reduce((maxValue, row) => Math.max(maxValue, row.revisionNumber), 0) + 1;
}

async function markAsCurrentRevision(db: ReturnType<typeof drizzle>, contractId: number, revisionId: number) {
  await db
    .update(contractRevisions)
    .set({
      isLatest: false,
      datetimeUpdated: new Date(),
    })
    .where(and(eq(contractRevisions.contractId, contractId), eq(contractRevisions.isLatest, true)))
    .run();
  await db
    .update(contractRevisions)
    .set({
      isLatest: true,
      datetimeUpdated: new Date(),
    })
    .where(eq(contractRevisions.id, revisionId))
    .run();
  await db
    .update(contracts)
    .set({
      currentRevisionId: revisionId,
      datetimeUpdated: new Date(),
    })
    .where(eq(contracts.id, contractId))
    .run();
}

contractsRouter.get("/", async (c) => {
  try {
    await ensureContractStatuses(c.env);
    const db = drizzle(c.env.DB);
    const contractRows = await db.select().from(contracts).orderBy(desc(contracts.datetimeUpdated)).all();
    const latestRevisions = await db
      .select()
      .from(contractRevisions)
      .where(eq(contractRevisions.isLatest, true))
      .all();
    const companies = await db.select().from(estimateCompanies).all();
    const latestByContract = new Map(latestRevisions.map((row) => [row.contractId, row]));
    const companyById = new Map(companies.map((row) => [row.id, row]));
    return c.json({
      contracts: contractRows.map((contract) => ({
        ...contract,
        currentRevision: latestByContract.get(contract.id) || null,
        company: contract.estimateCompanyId ? companyById.get(contract.estimateCompanyId) || null : null,
      })),
      drafts: latestRevisions.filter((row) => row.isDraft),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list contracts",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

contractsRouter.get("/statuses", async (c) => {
  try {
    await ensureContractStatuses(c.env);
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(contractStatuses).orderBy(asc(contractStatuses.sortOrder)).all();
    return c.json({ statuses: rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list contract statuses",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

contractsRouter.post("/drafts", async (c) => {
  try {
    const body = (await c.req.json()) as {
      scenarioId?: string | null;
      estimateCompanyId?: number | null;
      linkedEstimateId?: number | null;
      contractRequired?: boolean;
      createdBy?: string | null;
    };
    const db = drizzle(c.env.DB);
    const now = new Date();
    const createdContract = await db
      .insert(contracts)
      .values({
        scenarioId: body.scenarioId?.trim() || null,
        estimateCompanyId:
          typeof body.estimateCompanyId === "number" ? body.estimateCompanyId : null,
        linkedEstimateId: typeof body.linkedEstimateId === "number" ? body.linkedEstimateId : null,
        contractRequired: body.contractRequired ?? true,
        isActive: true,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    const createdRevision = await db
      .insert(contractRevisions)
      .values({
        contractId: createdContract[0].id,
        revisionNumber: 1,
        isDraft: true,
        isLatest: true,
        changeSource: "manual",
        createdBy: body.createdBy?.trim() || "system",
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    await db
      .update(contracts)
      .set({
        currentRevisionId: createdRevision[0].id,
        datetimeUpdated: now,
      })
      .where(eq(contracts.id, createdContract[0].id))
      .run();

    return c.json({ contract: createdContract[0], revision: createdRevision[0] }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create contract draft",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

contractsRouter.patch("/drafts/:id/autosave", async (c) => {
  try {
    const revisionId = Number(c.req.param("id"));
    if (!Number.isFinite(revisionId)) {
      return c.json({ error: "Invalid revision ID" }, 400);
    }
    const body = (await c.req.json()) as {
      contractStatusId?: number | null;
      statusNotes?: string | null;
      aiRationale?: string | null;
      changeSource?: string | null;
      createdBy?: string | null;
      contractRequired?: boolean;
    };
    const db = drizzle(c.env.DB);
    const revision = await db
      .select()
      .from(contractRevisions)
      .where(eq(contractRevisions.id, revisionId))
      .get();
    if (!revision) {
      return c.json({ error: "Draft revision not found" }, 404);
    }
    const contract = await db.select().from(contracts).where(eq(contracts.id, revision.contractId)).get();
    if (!contract) {
      return c.json({ error: "Contract not found" }, 404);
    }
    await db
      .update(contractRevisions)
      .set({
        contractStatusId:
          typeof body.contractStatusId === "number" ? body.contractStatusId : revision.contractStatusId,
        statusNotes:
          typeof body.statusNotes === "string" || body.statusNotes === null
            ? body.statusNotes
            : revision.statusNotes,
        aiRationale:
          typeof body.aiRationale === "string" || body.aiRationale === null
            ? body.aiRationale
            : revision.aiRationale,
        changeSource: body.changeSource?.trim() || revision.changeSource,
        isDraft: true,
        datetimeUpdated: new Date(),
      })
      .where(eq(contractRevisions.id, revisionId))
      .run();

    if (typeof body.contractRequired === "boolean") {
      await db
        .update(contracts)
        .set({
          contractRequired: body.contractRequired,
          datetimeUpdated: new Date(),
        })
        .where(eq(contracts.id, contract.id))
        .run();
    }

    await db.insert(contractMonitoringEvents).values({
      contractId: contract.id,
      contractRevisionId: revision.id,
      relatedEstimateId: contract.linkedEstimateId,
      eventType: "draft_autosave",
      source: body.createdBy?.trim() || "system",
      summary: "Contract draft autosaved",
      payloadJson: JSON.stringify(body),
      datetimeCreated: new Date(),
    });

    try {
      await publishRealtimeEvent(c.env, contract.scenarioId ? `scenario:${contract.scenarioId}` : "home", {
        event: "contract.draft.autosaved",
        contractId: contract.id,
        revisionId: revision.id,
      });
    } catch {
      // non-fatal
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json(
      {
        error: "Failed to autosave contract draft",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

contractsRouter.post("/:id/revisions", async (c) => {
  try {
    const contractId = Number(c.req.param("id"));
    if (!Number.isFinite(contractId)) {
      return c.json({ error: "Invalid contract ID" }, 400);
    }
    const body = (await c.req.json()) as {
      contractStatusId?: number | null;
      statusNotes?: string | null;
      aiRationale?: string | null;
      changeSource?: string | null;
      createdBy?: string | null;
      isDraft?: boolean;
    };
    const db = drizzle(c.env.DB);
    const contract = await db.select().from(contracts).where(eq(contracts.id, contractId)).get();
    if (!contract) {
      return c.json({ error: "Contract not found" }, 404);
    }
    const revisionNumber = await getNextRevisionNumber(db, contractId);
    const now = new Date();
    const createdRevision = await db
      .insert(contractRevisions)
      .values({
        contractId,
        revisionNumber,
        isDraft: body.isDraft ?? true,
        isLatest: true,
        contractStatusId: typeof body.contractStatusId === "number" ? body.contractStatusId : null,
        statusNotes: body.statusNotes || null,
        aiRationale: body.aiRationale || null,
        changeSource: body.changeSource || "manual_revision",
        createdBy: body.createdBy || "system",
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    await markAsCurrentRevision(db, contractId, createdRevision[0].id);

    return c.json({ revision: createdRevision[0] }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create contract revision",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

contractsRouter.get("/:id/revisions", async (c) => {
  try {
    const contractId = Number(c.req.param("id"));
    if (!Number.isFinite(contractId)) {
      return c.json({ error: "Invalid contract ID" }, 400);
    }
    const db = drizzle(c.env.DB);
    const revisions = await db
      .select()
      .from(contractRevisions)
      .where(eq(contractRevisions.contractId, contractId))
      .orderBy(desc(contractRevisions.revisionNumber))
      .all();
    const revisionIds = revisions.map((revision) => revision.id);
    const documents =
      revisionIds.length > 0
        ? await db
            .select()
            .from(contractDocuments)
            .where(inArray(contractDocuments.contractRevisionId, revisionIds))
            .all()
        : [];
    return c.json({ revisions, documents });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list contract revisions",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

contractsRouter.get("/:id/risks", async (c) => {
  try {
    const contractId = Number(c.req.param("id"));
    if (!Number.isFinite(contractId)) {
      return c.json({ error: "Invalid contract ID" }, 400);
    }
    const db = drizzle(c.env.DB);
    const latest = await db
      .select()
      .from(contractRevisions)
      .where(and(eq(contractRevisions.contractId, contractId), eq(contractRevisions.isLatest, true)))
      .get();
    if (!latest) {
      return c.json({ findings: [] });
    }
    const findings = await db
      .select()
      .from(contractClauseFindings)
      .where(eq(contractClauseFindings.contractRevisionId, latest.id))
      .orderBy(desc(contractClauseFindings.datetimeCreated))
      .all();
    return c.json({ findings, revision: latest });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list contract risk findings",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

contractsRouter.get("/:id/payment-milestones", async (c) => {
  try {
    const contractId = Number(c.req.param("id"));
    if (!Number.isFinite(contractId)) {
      return c.json({ error: "Invalid contract ID" }, 400);
    }
    const db = drizzle(c.env.DB);
    const latest = await db
      .select()
      .from(contractRevisions)
      .where(and(eq(contractRevisions.contractId, contractId), eq(contractRevisions.isLatest, true)))
      .get();
    if (!latest) {
      return c.json({ milestones: [] });
    }
    const milestones = await db
      .select()
      .from(contractPaymentMilestones)
      .where(eq(contractPaymentMilestones.contractRevisionId, latest.id))
      .orderBy(asc(contractPaymentMilestones.id))
      .all();
    return c.json({ milestones, revision: latest });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list contract payment milestones",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

contractsRouter.post("/:id/revisions/:revisionId/documents", async (c) => {
  try {
    const contractId = Number(c.req.param("id"));
    const revisionId = Number(c.req.param("revisionId"));
    if (!Number.isFinite(contractId) || !Number.isFinite(revisionId)) {
      return c.json({ error: "Invalid IDs" }, 400);
    }

    const contentType = (c.req.header("content-type") || "").toLowerCase();
    let sourceType = "pdf";
    let sourceUrl: string | null = null;
    let freeText: string | null = null;
    let audioBase64: string | null = null;
    let file: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      sourceType = String(form.get("sourceType") || "pdf");
      sourceUrl = form.get("sourceUrl") ? String(form.get("sourceUrl")) : null;
      freeText = form.get("freeText") ? String(form.get("freeText")) : null;
      audioBase64 = form.get("audioBase64") ? String(form.get("audioBase64")) : null;
      file = form.get("file") instanceof File ? (form.get("file") as File) : null;
    } else {
      const body = (await c.req.json()) as {
        sourceType?: string;
        sourceUrl?: string | null;
        freeText?: string | null;
        audioBase64?: string | null;
      };
      sourceType = body.sourceType || "pdf";
      sourceUrl = body.sourceUrl || null;
      freeText = body.freeText || null;
      audioBase64 = body.audioBase64 || null;
    }

    if (!["pdf", "photo", "url", "free_text", "audio_transcript"].includes(sourceType)) {
      return c.json({ error: "Invalid sourceType" }, 400);
    }

    const db = drizzle(c.env.DB);
    const revision = await db
      .select()
      .from(contractRevisions)
      .where(and(eq(contractRevisions.id, revisionId), eq(contractRevisions.contractId, contractId)))
      .get();
    if (!revision) {
      return c.json({ error: "Contract revision not found" }, 404);
    }
    const contract = await db.select().from(contracts).where(eq(contracts.id, contractId)).get();
    if (!contract) {
      return c.json({ error: "Contract not found" }, 404);
    }

    const sourceContent = await extractSourceContent(c.env, {
      sourceType: sourceType as "pdf" | "photo" | "url" | "free_text" | "audio_transcript",
      file,
      sourceUrl,
      freeText,
      audioBase64,
    });

    const extraction = await generateStructuredOutput(c.env, {
      messages: [
        {
          role: "system",
          content:
            "Extract contract structure with focus on warranty, payment milestones, and timeline milestones. Use null for unknown values.",
        },
        {
          role: "user",
          content: sourceContent.rawText || sourceContent.rawMarkdown || "",
        },
      ],
      schema: CONTRACT_EXTRACTION_SCHEMA,
      schemaName: "ContractExtraction",
      temperature: 0,
    });

    const now = new Date();
    const documentInsert = await db
      .insert(contractDocuments)
      .values({
        contractRevisionId: revisionId,
        documentType: sourceType === "url" ? "url" : "contract",
        r2ObjectKey: sourceContent.uploadedArtifact?.key || null,
        r2Url: sourceContent.uploadedArtifact?.url || null,
        rawText: sourceContent.rawText || null,
        aiExtractionJson: JSON.stringify(extraction),
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    for (const warrantyTerm of extraction.warrantyTerms) {
      await db.insert(contractWarrantyTerms).values({
        contractRevisionId: revisionId,
        durationText: warrantyTerm.durationText || null,
        scopeText: warrantyTerm.scopeText || null,
        exclusionsText: warrantyTerm.exclusionsText || null,
        startTrigger: warrantyTerm.startTrigger || null,
        datetimeCreated: now,
        datetimeUpdated: now,
      });
    }

    for (const milestone of extraction.timelineMilestones) {
      await db.insert(contractTimelineMilestones).values({
        contractRevisionId: revisionId,
        milestoneName: milestone.milestoneName,
        plannedAt: milestone.plannedAt ? new Date(milestone.plannedAt) : null,
        actualAt: null,
        delayReason: null,
        noticeWindow: milestone.noticeWindow || null,
        datetimeCreated: now,
        datetimeUpdated: now,
      });
    }

    for (const milestone of extraction.paymentMilestones) {
      await db.insert(contractPaymentMilestones).values({
        contractRevisionId: revisionId,
        milestoneName: milestone.milestoneName,
        dueCriteria: milestone.dueCriteria || null,
        amountCents:
          typeof milestone.amountCents === "number" ? milestone.amountCents : null,
        dueStartAt: milestone.dueStartAt ? new Date(milestone.dueStartAt) : null,
        dueEndAt: milestone.dueEndAt ? new Date(milestone.dueEndAt) : null,
        completionEvidenceRequired: milestone.completionEvidenceRequired || null,
        approvalStatus: "pending",
        datetimeCreated: now,
        datetimeUpdated: now,
      });
    }

    await db.insert(contractMonitoringEvents).values({
      contractId,
      contractRevisionId: revisionId,
      relatedEstimateId: contract.linkedEstimateId,
      eventType: "document_ingested",
      source: "system",
      summary: extraction.summary || "Contract document ingested and extracted",
      payloadJson: JSON.stringify({
        sourceType,
        contractDocumentId: documentInsert[0].id,
      }),
      datetimeCreated: now,
    });

    try {
      await publishRealtimeEvent(c.env, contract.scenarioId ? `scenario:${contract.scenarioId}` : "home", {
        event: "contract.extraction.completed",
        contractId,
        revisionId,
        documentId: documentInsert[0].id,
      });
    } catch {
      // non-fatal
    }

    return c.json({
      success: true,
      document: documentInsert[0],
      extraction,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to ingest contract document",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

const CONTRACT_ANALYSIS_SCHEMA = z.object({
  summary: z.string(),
  missingTerms: z.array(z.string()).default([]),
  riskyTerms: z.array(z.string()).default([]),
  negotiationSuggestions: z.array(z.string()).default([]),
  timelineWarnings: z.array(z.string()).default([]),
  paymentWarnings: z.array(z.string()).default([]),
});

const CONTRACT_EXTRACTION_SCHEMA = z.object({
  summary: z.string().optional(),
  warrantyTerms: z
    .array(
      z.object({
        durationText: z.string().optional(),
        scopeText: z.string().optional(),
        exclusionsText: z.string().optional(),
        startTrigger: z.string().optional(),
      }),
    )
    .default([]),
  timelineMilestones: z
    .array(
      z.object({
        milestoneName: z.string(),
        plannedAt: z.string().optional(),
        noticeWindow: z.string().optional(),
      }),
    )
    .default([]),
  paymentMilestones: z
    .array(
      z.object({
        milestoneName: z.string(),
        dueCriteria: z.string().optional(),
        amountCents: z.number().int().nullable().optional(),
        dueStartAt: z.string().optional(),
        dueEndAt: z.string().optional(),
        completionEvidenceRequired: z.string().optional(),
      }),
    )
    .default([]),
});

contractsRouter.post("/:id/revisions/:revisionId/analyze", async (c) => {
  try {
    const contractId = Number(c.req.param("id"));
    const revisionId = Number(c.req.param("revisionId"));
    if (!Number.isFinite(contractId) || !Number.isFinite(revisionId)) {
      return c.json({ error: "Invalid IDs" }, 400);
    }
    const db = drizzle(c.env.DB);
    const revision = await db
      .select()
      .from(contractRevisions)
      .where(and(eq(contractRevisions.id, revisionId), eq(contractRevisions.contractId, contractId)))
      .get();
    if (!revision) {
      return c.json({ error: "Contract revision not found" }, 404);
    }
    const documents = await db
      .select()
      .from(contractDocuments)
      .where(eq(contractDocuments.contractRevisionId, revisionId))
      .all();
    const mergedText = documents
      .map((doc) => doc.rawText || "")
      .filter(Boolean)
      .join("\n\n");
    if (!mergedText.trim()) {
      return c.json({ error: "No contract text found for analysis" }, 400);
    }

    const analysis = await generateStructuredOutput(c.env, {
      messages: [
        {
          role: "system",
          content:
            "You are a homeowner-protection contract analyst. Flag missing terms, risky terms, negotiation opportunities, timeline risks, and payment red flags. Be specific and practical.",
        },
        {
          role: "user",
          content: mergedText,
        },
      ],
      schema: CONTRACT_ANALYSIS_SCHEMA,
      schemaName: "ContractAnalysis",
      temperature: 0,
    });

    const now = new Date();
    const findings = [
      ...analysis.missingTerms.map((value) => ({ clauseType: "missing_term", riskLevel: "high", findingText: value })),
      ...analysis.riskyTerms.map((value) => ({ clauseType: "risky_term", riskLevel: "high", findingText: value })),
      ...analysis.negotiationSuggestions.map((value) => ({
        clauseType: "negotiation",
        riskLevel: "medium",
        findingText: value,
      })),
      ...analysis.timelineWarnings.map((value) => ({
        clauseType: "delay",
        riskLevel: "medium",
        findingText: value,
      })),
      ...analysis.paymentWarnings.map((value) => ({
        clauseType: "payment",
        riskLevel: "high",
        findingText: value,
      })),
    ];

    for (const finding of findings) {
      await db.insert(contractClauseFindings).values({
        contractRevisionId: revisionId,
        clauseType: finding.clauseType,
        riskLevel: finding.riskLevel,
        findingText: finding.findingText,
        recommendation: null,
        sourceSnippet: null,
        datetimeCreated: now,
      });
    }

    await db.insert(contractMonitoringEvents).values({
      contractId,
      contractRevisionId: revisionId,
      relatedEstimateId: null,
      eventType: "risk_update",
      source: "ai",
      summary: analysis.summary,
      payloadJson: JSON.stringify(analysis),
      datetimeCreated: now,
    });

    try {
      const contract = await db.select().from(contracts).where(eq(contracts.id, contractId)).get();
      await publishRealtimeEvent(
        c.env,
        contract?.scenarioId ? `scenario:${contract.scenarioId}` : "home",
        {
          event: "contract.risk.findings.updated",
          contractId,
          revisionId,
        },
      );
    } catch {
      // non-fatal
    }

    return c.json({ analysis, findingsCount: findings.length });
  } catch (error) {
    return c.json(
      {
        error: "Failed to analyze contract revision",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { contractsRouter, ensureContractStatuses };
