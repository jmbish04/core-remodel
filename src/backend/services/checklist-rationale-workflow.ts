/**
 * @fileoverview AI-driven checklist-to-room rationale workflow.
 *
 * For each committed (non-draft, checked) checklist answer, this workflow asks
 * Workers AI which rooms the answer logically applies to and writes a `(question
 * × room)` mapping into `checklist_room_mappings` with an `ai_rationale` string.
 *
 * CRITICAL HITL retention contract:
 *
 *   `associationStatus` is one of:
 *     - "ai_suggested"      — written by us; safe to overwrite/refresh.
 *     - "user_confirmed"    — homeowner explicitly accepted; NEVER overwrite.
 *     - "user_disassociated"— homeowner removed; NEVER re-add.
 *
 * The upsert step filters out the two "user_*" states. The homeowner is the
 * ultimate decision-maker.
 *
 * Live progress is streamed via `publishRealtimeEvent` to the room
 *   admin-workflows:checklist_rationale
 * so the admin panel WebSocket feed shows step-by-step progress in real time.
 */

import {
  checklistAnswers,
  checklistQuestions,
  checklistRoomMappings,
  checklistServiceLogs,
  rooms,
  workflowRunHistory,
} from "@backend/db";
import { publishRealtimeEvent } from "@backend/realtime/publish";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

export interface ChecklistRationaleParams {
  triggerSource: "cron" | "manual_admin";
  workflowInstanceId: string;
}

const ROOM = "admin-workflows:checklist_rationale";

interface RoomSummary {
  id: number;
  name: string;
  use: string | null;
}

interface AnswerWithQuestion {
  answerId: number;
  questionId: number;
  questionCode: string;
  questionText: string;
  considerations: string | null;
  notes: string | null;
}

interface InferredMapping {
  questionId: number;
  roomId: number;
  rationale: string;
}

export class ChecklistRationaleWorkflow extends WorkflowEntrypoint<
  Env,
  ChecklistRationaleParams
> {
  async run(event: WorkflowEvent<ChecklistRationaleParams>, step: WorkflowStep) {
    const { workflowInstanceId, triggerSource } = event.payload;
    const env = this.env;
    const db = drizzle(env.DB);

    await publishRealtimeEvent(env, ROOM, {
      type: "started",
      workflowInstanceId,
      triggerSource,
      timestamp: Date.now(),
    });

    await markRunStatus(db, workflowInstanceId, "running");

    // -----------------------------------------------------------------------
    // Step 1 — load candidate answers + room registry
    // -----------------------------------------------------------------------
    const { candidates, roomSummaries } = await step.do(
      "load-candidates",
      async () => {
        const activeAnswers = await db
          .select()
          .from(checklistAnswers)
          .where(
            and(
              eq(checklistAnswers.isActive, true),
              eq(checklistAnswers.isChecked, true),
              eq(checklistAnswers.isDraft, false),
            ),
          )
          .all();

        if (activeAnswers.length === 0) {
          return { candidates: [], roomSummaries: [] };
        }

        const questionIds = Array.from(
          new Set(activeAnswers.map((answer) => answer.questionId)),
        );
        const questionRows = await db
          .select()
          .from(checklistQuestions)
          .where(inArray(checklistQuestions.id, questionIds))
          .all();
        const questionsById = new Map(questionRows.map((q) => [q.id, q]));

        const allRooms = await db.select().from(rooms).all();
        const roomSummaries: RoomSummary[] = allRooms.map((room) => ({
          id: room.id,
          name: room.roomName,
          use: room.asIsUse,
        }));

        const candidatesList: AnswerWithQuestion[] = activeAnswers
          .map((answer): AnswerWithQuestion | null => {
            const question = questionsById.get(answer.questionId);
            if (!question) return null;
            return {
              answerId: answer.id,
              questionId: answer.questionId,
              questionCode: question.code,
              questionText: question.questionText,
              considerations: question.considerations,
              notes: answer.notes,
            };
          })
          .filter((item): item is AnswerWithQuestion => item !== null);

        return { candidates: candidatesList, roomSummaries };
      },
    );

    await publishRealtimeEvent(env, ROOM, {
      type: "step",
      stepName: "load-candidates",
      workflowInstanceId,
      candidates: candidates.length,
      rooms: roomSummaries.length,
      timestamp: Date.now(),
    });

    if (candidates.length === 0 || roomSummaries.length === 0) {
      await step.do("log-bypass", async () => {
        await db
          .insert(checklistServiceLogs)
          .values({
            status: "bypassed",
            processedRecordsCount: 0,
            chainOfThoughtDump:
              candidates.length === 0
                ? "No committed answers to evaluate."
                : "No rooms registered to map against.",
          })
          .run();
      });

      await finalize(db, env, workflowInstanceId, "success", {
        candidates: 0,
        inferred: 0,
        upserted: 0,
        bypassed: true,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Step 2 — AI-infer room mappings, one candidate at a time (idempotent
    // through step.do so retries don't reload Workers AI repeatedly).
    // -----------------------------------------------------------------------
    const inferences: InferredMapping[] = [];

    for (const candidate of candidates) {
      const result = await step.do(
        `ai-infer-${candidate.questionId}-${candidate.answerId}`,
        async () => inferMappingsForCandidate(env, candidate, roomSummaries),
      );
      for (const item of result) {
        inferences.push(item);
      }
    }

    await publishRealtimeEvent(env, ROOM, {
      type: "step",
      stepName: "ai-infer",
      workflowInstanceId,
      inferences: inferences.length,
      timestamp: Date.now(),
    });

    // -----------------------------------------------------------------------
    // Step 3 — upsert into checklist_room_mappings, RESPECTING HITL retention.
    // -----------------------------------------------------------------------
    const upsertResult = await step.do(
      "upsert-mappings-respecting-hitl",
      async () => upsertMappings(db, inferences),
    );

    await publishRealtimeEvent(env, ROOM, {
      type: "step",
      stepName: "upsert-mappings",
      workflowInstanceId,
      ...upsertResult,
      timestamp: Date.now(),
    });

    // -----------------------------------------------------------------------
    // Step 4 — write service log + run history
    // -----------------------------------------------------------------------
    await step.do("log-service-result", async () => {
      await db
        .insert(checklistServiceLogs)
        .values({
          status: "success",
          processedRecordsCount: upsertResult.upserted,
          chainOfThoughtDump: JSON.stringify({
            workflowInstanceId,
            triggerSource,
            ...upsertResult,
          }),
        })
        .run();
    });

    await finalize(db, env, workflowInstanceId, "success", {
      candidates: candidates.length,
      inferred: inferences.length,
      ...upsertResult,
    });
  }
}

// ---------------------------------------------------------------------------
// AI inference — Workers AI structured output
// ---------------------------------------------------------------------------

async function inferMappingsForCandidate(
  env: Env,
  candidate: AnswerWithQuestion,
  roomSummaries: RoomSummary[],
): Promise<InferredMapping[]> {
  const roomCatalog = roomSummaries
    .map(
      (room) =>
        `- id=${room.id} name="${room.name}"${room.use ? ` use="${room.use}"` : ""}`,
    )
    .join("\n");

  const systemPrompt = [
    "You are a senior remodel-project assistant. Given one homeowner questionnaire answer",
    "and the registry of rooms in the home, return the rooms (by integer id) the answer",
    "logically applies to. Be conservative — only include a room if there is a clear",
    "construction-level connection. Always provide a single-sentence rationale per room.",
    "",
    "Respond ONLY with valid JSON conforming to the supplied schema.",
  ].join("\n");

  const userPrompt = [
    `QUESTION CODE: ${candidate.questionCode}`,
    `QUESTION: ${candidate.questionText}`,
    candidate.considerations
      ? `CONSIDERATIONS: ${candidate.considerations}`
      : null,
    candidate.notes ? `HOMEOWNER NOTES: ${candidate.notes}` : null,
    "",
    "ROOM REGISTRY:",
    roomCatalog,
  ]
    .filter(Boolean)
    .join("\n");

  type AiResponse = {
    mappings?: Array<{ roomId?: number; rationale?: string }>;
    response?: unknown;
  };

  try {
    const raw = (await env.AI.run(
      "@cf/moonshotai/kimi-k2.6" as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            type: "object",
            properties: {
              mappings: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    roomId: { type: "integer" },
                    rationale: { type: "string" },
                  },
                  required: ["roomId", "rationale"],
                },
              },
            },
            required: ["mappings"],
          },
        },
        gateway: { id: env.AI_GATEWAY_ID },
      } as Parameters<typeof env.AI.run>[1],
    )) as AiResponse;

    const wrapped = raw?.response;
    const source: AiResponse =
      wrapped && typeof wrapped === "object" ? (wrapped as AiResponse) : raw;
    const mappings = Array.isArray(source.mappings) ? source.mappings : [];
    const validRoomIds = new Set(roomSummaries.map((room) => room.id));

    return mappings
      .map((mapping): InferredMapping | null => {
        const roomId = Number(mapping.roomId);
        const rationale =
          typeof mapping.rationale === "string" ? mapping.rationale.trim() : "";
        if (!Number.isFinite(roomId) || !validRoomIds.has(roomId) || rationale.length === 0) {
          return null;
        }
        return { questionId: candidate.questionId, roomId, rationale };
      })
      .filter((item): item is InferredMapping => item !== null);
  } catch (error) {
    console.error("checklist-rationale: AI inference failed", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// HITL-respecting upsert
// ---------------------------------------------------------------------------

async function upsertMappings(
  db: ReturnType<typeof drizzle>,
  inferences: InferredMapping[],
): Promise<{ upserted: number; skippedHitl: number; skippedDuplicate: number }> {
  let upserted = 0;
  let skippedHitl = 0;
  let skippedDuplicate = 0;

  for (const inference of inferences) {
    const existing = await db
      .select()
      .from(checklistRoomMappings)
      .where(
        and(
          eq(checklistRoomMappings.questionId, inference.questionId),
          eq(checklistRoomMappings.roomId, inference.roomId),
        ),
      )
      .get();

    if (existing) {
      // CRITICAL: never overwrite a homeowner decision.
      if (
        existing.associationStatus === "user_confirmed" ||
        existing.associationStatus === "user_disassociated"
      ) {
        skippedHitl += 1;
        continue;
      }
      // ai_suggested already exists — refresh rationale only.
      if (existing.aiRationale === inference.rationale) {
        skippedDuplicate += 1;
        continue;
      }
      await db
        .update(checklistRoomMappings)
        .set({
          aiRationale: inference.rationale,
          datetimeUpdated: new Date(),
        })
        .where(eq(checklistRoomMappings.id, existing.id))
        .run();
      upserted += 1;
      continue;
    }

    await db
      .insert(checklistRoomMappings)
      .values({
        questionId: inference.questionId,
        roomId: inference.roomId,
        aiRationale: inference.rationale,
        associationStatus: "ai_suggested",
        datetimeUpdated: new Date(),
      })
      .run();
    upserted += 1;
  }

  return { upserted, skippedHitl, skippedDuplicate };
}

// ---------------------------------------------------------------------------
// Run-history bookkeeping helpers
// ---------------------------------------------------------------------------

async function markRunStatus(
  db: ReturnType<typeof drizzle>,
  workflowInstanceId: string,
  status: string,
): Promise<void> {
  await db
    .update(workflowRunHistory)
    .set({ status })
    .where(eq(workflowRunHistory.workflowInstanceId, workflowInstanceId))
    .run();
}

async function finalize(
  db: ReturnType<typeof drizzle>,
  env: Env,
  workflowInstanceId: string,
  status: "success" | "failed",
  summary: Record<string, unknown>,
): Promise<void> {
  await db
    .update(workflowRunHistory)
    .set({
      status,
      finishedAt: new Date(),
      summaryJson: JSON.stringify(summary),
    })
    .where(eq(workflowRunHistory.workflowInstanceId, workflowInstanceId))
    .run();

  await publishRealtimeEvent(env, ROOM, {
    type: status === "success" ? "finished" : "failed",
    workflowInstanceId,
    summary,
    timestamp: Date.now(),
  });
}
