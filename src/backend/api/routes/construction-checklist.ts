/**
 * @fileoverview Hono router for the AI-augmented construction questionnaire.
 *
 * Mounted at `/api/construction-checklist`. Pairs with:
 *   - `src/backend/db/schema/home/questionnaire.ts` (D1 tables)
 *   - `src/frontend/components/ConstructionChecklistApp.tsx` (UI consumer)
 *   - `src/backend/services/checklist-rationale-workflow.ts` (downstream AI loop)
 *
 * Money is stored as integer cents (never JS floats) per project rules.
 */

import {
  budgetTrackerItems,
  checklistAnswers,
  checklistQuestions,
  checklistRoomMappings,
  checklistSections,
  checklistServiceLogs,
  roomMaterialQuotes,
} from "@backend/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

const constructionChecklistRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const answerCommitSchema = z.object({
  trackId: z.string().optional(),
  questionId: z.number().int().positive(),
  scenarioId: z.string().nullable().optional(),
  isChecked: z.boolean(),
  notes: z.string().nullable().optional(),
  selectionValue: z.string().nullable().optional(),
  isDraft: z.boolean().default(false),
});

const materialQuoteSchema = z.object({
  roomId: z.number().int().positive(),
  materialName: z.string().min(1),
  supplierName: z.string().optional(),
  homeownerQuoteCents: z.number().int().nonnegative(),
});

const contractorDiscountSchema = z.object({
  quoteId: z.number().int().positive(),
  contractorDiscountOfferCents: z.number().int().nonnegative(),
  contractorNotes: z.string().min(1),
});

const mappingDecisionSchema = z.object({
  questionId: z.number().int().positive(),
  roomId: z.number().int().positive(),
  associationStatus: z.enum(["user_confirmed", "user_disassociated"]),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BudgetImpact = {
  title: string;
  lowCents: number;
  highCents: number;
  executionClass?: "must_now" | "future_tbd" | "option";
};

function parseBudgetImpact(raw: string | null): BudgetImpact | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BudgetImpact>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.lowCents !== "number" ||
      typeof parsed.highCents !== "number"
    ) {
      return null;
    }
    return {
      title: parsed.title,
      lowCents: Math.round(parsed.lowCents),
      highCents: Math.round(parsed.highCents),
      executionClass: parsed.executionClass ?? "must_now",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /sections/:slug — hydrate a section's questions, answers, and mappings
// ---------------------------------------------------------------------------

constructionChecklistRouter.get("/sections/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");

  const section = await db
    .select()
    .from(checklistSections)
    .where(eq(checklistSections.slug, slug))
    .get();

  if (!section) {
    return c.json(
      { success: false, error: `Section not found for slug "${slug}"` },
      404,
    );
  }

  const questions = await db
    .select()
    .from(checklistQuestions)
    .where(eq(checklistQuestions.sectionId, section.id))
    .orderBy(asc(checklistQuestions.sortOrder))
    .all();

  const questionIds = questions.map((q) => q.id);

  const [answers, mappings] = await Promise.all([
    questionIds.length > 0
      ? db
          .select()
          .from(checklistAnswers)
          .where(
            and(
              eq(checklistAnswers.isActive, true),
              inArray(checklistAnswers.questionId, questionIds),
            ),
          )
          .all()
      : Promise.resolve([]),
    questionIds.length > 0
      ? db
          .select()
          .from(checklistRoomMappings)
          .where(inArray(checklistRoomMappings.questionId, questionIds))
          .all()
      : Promise.resolve([]),
  ]);

  return c.json({ success: true, section, questions, answers, mappings });
});

// ---------------------------------------------------------------------------
// GET /sections — list all sections (used by the section picker page)
// ---------------------------------------------------------------------------

constructionChecklistRouter.get("/sections", async (c) => {
  const db = drizzle(c.env.DB);
  const sections = await db
    .select()
    .from(checklistSections)
    .orderBy(asc(checklistSections.sortOrder))
    .all();
  return c.json({ success: true, sections });
});

// ---------------------------------------------------------------------------
// POST /answers — commit an answer (with revision chaining + budget side-effect)
// ---------------------------------------------------------------------------

constructionChecklistRouter.post(
  "/answers",
  zValidator("json", answerCommitSchema),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");
    const now = new Date();
    const trackId = body.trackId || crypto.randomUUID();

    // Mark previous active revision (if any) as inactive.
    const previous = await db
      .select()
      .from(checklistAnswers)
      .where(
        and(
          eq(checklistAnswers.trackId, trackId),
          eq(checklistAnswers.isActive, true),
        ),
      )
      .get();

    const nextVersion = previous ? previous.version + 1 : 1;

    if (previous) {
      await db
        .update(checklistAnswers)
        .set({ isActive: false, datetimeUpdated: now })
        .where(eq(checklistAnswers.id, previous.id))
        .run();
    }

    const inserted = await db
      .insert(checklistAnswers)
      .values({
        trackId,
        questionId: body.questionId,
        scenarioId: body.scenarioId ?? null,
        isChecked: body.isChecked,
        notes: body.notes ?? null,
        selectionValue: body.selectionValue ?? null,
        version: nextVersion,
        isActive: true,
        isDraft: body.isDraft,
        changeSource: "portal_submission",
        changedBy: "homeowner",
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    const answer = inserted[0];

    // ----- Cents-enforced budget side-effect -----
    // Fires only on the first committed (non-draft, checked) transition.
    const shouldEmitBudget =
      body.isChecked && !body.isDraft && (!previous || previous.isDraft || !previous.isChecked);

    if (shouldEmitBudget) {
      const question = await db
        .select()
        .from(checklistQuestions)
        .where(eq(checklistQuestions.id, body.questionId))
        .get();

      const impact = parseBudgetImpact(question?.defaultBudgetImpactJson ?? null);
      if (impact) {
        try {
          await db
            .insert(budgetTrackerItems)
            .values({
              trackId: `questionnaire:${answer.id}`,
              revisionNumber: 1,
              isActive: true,
              isDraft: false,
              itemType: "project",
              executionClass: impact.executionClass ?? "must_now",
              title: `[Questionnaire] ${impact.title}`,
              status: "open",
              riskLevel: "medium",
              isBottleneck: false,
              estimatedLowCents: impact.lowCents,
              estimatedHighCents: impact.highCents,
              scenarioId: body.scenarioId ?? null,
              changeSource: "questionnaire",
              changedBy: "system_edge_worker",
              datetimeCreated: now,
              datetimeUpdated: now,
            })
            .run();
        } catch (error) {
          // Budget auto-insert failure must not block the answer commit; log only.
          console.error("budget_tracker_items auto-insert failed", error);
        }
      }
    }

    return c.json({ success: true, answer });
  },
);

// ---------------------------------------------------------------------------
// POST /quotes/submit — homeowner posts an initial material quote
// ---------------------------------------------------------------------------

constructionChecklistRouter.post(
  "/quotes/submit",
  zValidator("json", materialQuoteSchema),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");
    const now = new Date();

    const inserted = await db
      .insert(roomMaterialQuotes)
      .values({
        roomId: body.roomId,
        materialName: body.materialName,
        supplierName: body.supplierName ?? null,
        homeownerQuoteCents: body.homeownerQuoteCents,
        status: "pending_review",
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    return c.json({ success: true, quote: inserted[0] });
  },
);

// ---------------------------------------------------------------------------
// POST /quotes/discount-offer — contractor counter-offers on a quote
// ---------------------------------------------------------------------------

constructionChecklistRouter.post(
  "/quotes/discount-offer",
  zValidator("json", contractorDiscountSchema),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");

    await db
      .update(roomMaterialQuotes)
      .set({
        contractorDiscountOfferCents: body.contractorDiscountOfferCents,
        contractorNotes: body.contractorNotes,
        status: "counter_offered",
        datetimeUpdated: new Date(),
      })
      .where(eq(roomMaterialQuotes.id, body.quoteId))
      .run();

    return c.json({ success: true });
  },
);

// ---------------------------------------------------------------------------
// POST /mappings/decision — homeowner accepts or rejects an AI-suggested mapping
//
// Writes the HITL retention flag so the rationale workflow never re-injects it.
// ---------------------------------------------------------------------------

constructionChecklistRouter.post(
  "/mappings/decision",
  zValidator("json", mappingDecisionSchema),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");
    const now = new Date();

    const existing = await db
      .select()
      .from(checklistRoomMappings)
      .where(
        and(
          eq(checklistRoomMappings.questionId, body.questionId),
          eq(checklistRoomMappings.roomId, body.roomId),
        ),
      )
      .get();

    if (existing) {
      await db
        .update(checklistRoomMappings)
        .set({
          associationStatus: body.associationStatus,
          datetimeUpdated: now,
        })
        .where(eq(checklistRoomMappings.id, existing.id))
        .run();
    } else {
      // user_confirmed without a prior ai_suggested row is fine — homeowner
      // can also seed a mapping manually.
      await db
        .insert(checklistRoomMappings)
        .values({
          questionId: body.questionId,
          roomId: body.roomId,
          associationStatus: body.associationStatus,
          datetimeUpdated: now,
        })
        .run();
    }

    return c.json({ success: true });
  },
);

// ---------------------------------------------------------------------------
// GET /service-logs — recent rationale-loop runs (admin diagnostics)
// ---------------------------------------------------------------------------

constructionChecklistRouter.get("/service-logs", async (c) => {
  const db = drizzle(c.env.DB);
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);
  const logs = await db
    .select()
    .from(checklistServiceLogs)
    .orderBy(desc(checklistServiceLogs.datetimeExecuted))
    .limit(limit)
    .all();
  return c.json({ success: true, logs });
});

export { constructionChecklistRouter };
