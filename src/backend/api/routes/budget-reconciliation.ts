/**
 * @fileoverview Budget Command Center — estimate-line-to-room reconciliation queue.
 *
 * Mounted at `/api/budget` in `src/backend/api/index.ts` (owned by a separate
 * integration pass — this file only exports the router). Routes:
 *
 *   GET  /reconciliation-queue                    — keyset-paginated queue
 *   POST /reconciliation/:lineItemId/confirm       — human confirms a room
 *   POST /reconciliation/:lineItemId/reject        — human rejects the mapping
 *
 * Shapes match `docs/plans/budget-command-center/API-CONTRACT.md` §5.
 *
 * This is a NEW, budget-command-center-specific surface layered on the ranked
 * candidates table `estimate_line_room_candidates` (rank/verdict/reasoning),
 * distinct from the older single-guess `GET /api/estimates/reconcile/queue`
 * (`src/backend/api/routes/estimates.ts`), which predates that table and
 * surfaces only `aiSuggestedRoomId`. Both read/write the same
 * `estimate_line_items.mapping_status` vocabulary — `unmapped | ai_suggested |
 * confirmed | rejected` (see `MAPPING_STATUSES` in `estimates.ts`) — so this
 * router reuses those exact values rather than inventing new ones.
 *
 * Doctrine: nothing is written to `room_id` without an explicit human
 * confirm. No code path here may auto-confirm a candidate, however high its
 * confidence.
 */
import {
  estimateCompanies,
  estimateLineItems,
  estimateLineRoomCandidates,
  estimateRevisions,
  estimates,
  rooms,
} from "@backend/db";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ErrorSchema = z.object({ error: z.string(), details: z.string().optional() });

const ReasoningSchema = z.object({
  markdown: z.string().nullable(),
  html: z.string().nullable(),
});

const CandidateSchema = z.object({
  roomId: z.number().int(),
  roomName: z.string(),
  rank: z.number().int(),
  verdict: z.enum(["likely", "possible", "eliminated"]),
  reasoning: ReasoningSchema,
  confidence: z.number().nullable(),
});

const QueueItemSchema = z.object({
  lineItemId: z.number().int(),
  description: z.string(),
  estimateCompanyId: z.number().int().nullable(),
  estimateCompanyLabel: z.string().nullable(),
  estimateLineNumber: z.string().nullable(),
  lineTotalCents: z.number().int().nullable(),
  mappingStatus: z.string(),
  candidates: z.array(CandidateSchema),
});

const QueueResponseSchema = z.object({
  items: z.array(QueueItemSchema),
  nextCursor: z.string().nullable(),
});

// Page size capped at 50 so the follow-up `inArray(candidates.estimateLineItemId, ids)`
// stays far under D1's 100-bound-parameter cap (see D1-DRIZZLE-RULES.md §4).
const QueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().regex(/^\d+$/, "cursor must be a numeric line item id").optional(),
});

const LineItemParamSchema = z.object({ lineItemId: z.coerce.number().int().positive() });

const ConfirmBodySchema = z.object({ roomId: z.number().int().positive() });
const ConfirmResponseSchema = z.object({
  lineItemId: z.number().int(),
  roomId: z.number().int(),
  mappingStatus: z.string(),
});

const RejectBodySchema = z.object({ reason: z.string().max(2000).optional() });
const RejectResponseSchema = z.object({
  lineItemId: z.number().int(),
  mappingStatus: z.string(),
  reason: z.string().nullable(),
});

const REJECT_NOTE_PREFIX = "Rejected: ";
// estimate_line_items has no dedicated rejection-reason column (see the
// handler below), so rejections append to the free-text `notes` field —
// bound the growth and skip a repeat of the exact same reason so re-clicking
// "reject" with an unchanged reason doesn't grow the field forever.
const REJECT_NOTE_MAX_LINES = 20;

export function appendRejectionNote(priorNotes: string | null, reason: string | undefined): string | null {
  if (!reason) return priorNotes;
  const entry = `${REJECT_NOTE_PREFIX}${reason}`;
  const lines = (priorNotes ?? "").split("\n").filter((line) => line.length > 0);
  if (lines[lines.length - 1] === entry) return priorNotes; // identical repeat, no-op
  lines.push(entry);
  return lines.slice(-REJECT_NOTE_MAX_LINES).join("\n");
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const budgetReconciliationRouter = new OpenAPIHono<{ Bindings: Env }>();

// --- GET /reconciliation-queue ----------------------------------------------

budgetReconciliationRouter.openapi(
  createRoute({
    method: "get",
    path: "/reconciliation-queue",
    request: { query: QueueQuerySchema },
    responses: {
      200: {
        content: { "application/json": { schema: QueueResponseSchema } },
        description: "Unassigned estimate lines with ranked room candidates",
      },
      500: { content: { "application/json": { schema: ErrorSchema } }, description: "Query failed" },
    },
    tags: ["budget-reconciliation"],
  }),
  async (c) => {
    try {
      const { limit: rawLimit, cursor } = c.req.valid("query");
      const limit = rawLimit ?? 50;
      const cursorId = cursor ? Number(cursor) : undefined;
      const db = drizzle(c.env.DB);

      // Round trip 1: the page of lines, keyset-paginated on `id` (unique,
      // monotonic — autoincrement PK), joined out to company via
      // revision -> estimate -> company. Scoped to the latest revision only,
      // same scoping as the legacy queue in estimates.ts and the inbox count
      // in services/budget/inbox.ts, so all three stay in sync.
      const linesPlusOne = await db
        .select({
          lineItemId: estimateLineItems.id,
          description: estimateLineItems.description,
          itemCode: estimateLineItems.itemCode,
          lineTotalCents: estimateLineItems.lineTotalCents,
          mappingStatus: estimateLineItems.mappingStatus,
          estimateCompanyId: estimateCompanies.id,
          estimateCompanyLabel: estimateCompanies.name,
        })
        .from(estimateLineItems)
        .innerJoin(
          estimateRevisions,
          eq(estimateLineItems.estimateRevisionId, estimateRevisions.id),
        )
        .leftJoin(estimates, eq(estimateRevisions.estimateId, estimates.id))
        .leftJoin(estimateCompanies, eq(estimates.estimateCompanyId, estimateCompanies.id))
        .where(
          and(
            inArray(estimateLineItems.mappingStatus, ["unmapped", "ai_suggested"]),
            eq(estimateRevisions.isLatest, true),
            cursorId !== undefined ? gt(estimateLineItems.id, cursorId) : undefined,
          ),
        )
        .orderBy(asc(estimateLineItems.id))
        .limit(limit + 1)
        .all();

      const hasMore = linesPlusOne.length > limit;
      const lines = linesPlusOne.slice(0, limit);
      const lineIds = lines.map((l) => l.lineItemId);

      // Round trip 2 (skipped when the page is empty): candidates for exactly
      // this page's line ids. Covered by
      // idx_estimate_line_room_candidates_line_rank(estimate_line_item_id, rank).
      const candidateRows = lineIds.length
        ? await db
            .select({
              estimateLineItemId: estimateLineRoomCandidates.estimateLineItemId,
              roomId: estimateLineRoomCandidates.roomId,
              roomName: rooms.roomName,
              rank: estimateLineRoomCandidates.rank,
              verdict: estimateLineRoomCandidates.verdict,
              reasoningMarkdown: estimateLineRoomCandidates.reasoningMarkdown,
              reasoningHtml: estimateLineRoomCandidates.reasoningHtml,
              confidence: estimateLineRoomCandidates.confidence,
            })
            .from(estimateLineRoomCandidates)
            .innerJoin(rooms, eq(estimateLineRoomCandidates.roomId, rooms.id))
            .where(inArray(estimateLineRoomCandidates.estimateLineItemId, lineIds))
            .orderBy(
              asc(estimateLineRoomCandidates.estimateLineItemId),
              asc(estimateLineRoomCandidates.rank),
            )
            .all()
        : [];

      const candidatesByLine = new Map<number, typeof candidateRows>();
      for (const row of candidateRows) {
        const list = candidatesByLine.get(row.estimateLineItemId);
        if (list) list.push(row);
        else candidatesByLine.set(row.estimateLineItemId, [row]);
      }

      const items = lines.map((line) => ({
        lineItemId: line.lineItemId,
        description: line.description,
        estimateCompanyId: line.estimateCompanyId,
        estimateCompanyLabel: line.estimateCompanyLabel,
        // No dedicated "line number" column exists on estimate_line_items —
        // itemCode (free-text SKU/code captured at intake) is the closest
        // available field; null when the source estimate didn't carry one.
        estimateLineNumber: line.itemCode,
        lineTotalCents: line.lineTotalCents,
        mappingStatus: line.mappingStatus,
        candidates: (candidatesByLine.get(line.lineItemId) ?? []).map((cand) => ({
          roomId: cand.roomId,
          roomName: cand.roomName,
          rank: cand.rank,
          verdict: cand.verdict as "likely" | "possible" | "eliminated",
          reasoning: { markdown: cand.reasoningMarkdown, html: cand.reasoningHtml },
          confidence: cand.confidence,
        })),
      }));

      const nextCursor = hasMore ? String(lines[lines.length - 1]!.lineItemId) : null;

      return c.json({ items, nextCursor }, 200);
    } catch (error) {
      return c.json(
        {
          error: "Failed to load reconciliation queue",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  },
);

// --- POST /reconciliation/:lineItemId/confirm -------------------------------

budgetReconciliationRouter.openapi(
  createRoute({
    method: "post",
    path: "/reconciliation/{lineItemId}/confirm",
    request: {
      params: LineItemParamSchema,
      body: { content: { "application/json": { schema: ConfirmBodySchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: ConfirmResponseSchema } }, description: "Confirmed" },
      400: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown room" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Line item not found" },
      500: { content: { "application/json": { schema: ErrorSchema } }, description: "Write failed" },
    },
    tags: ["budget-reconciliation"],
  }),
  async (c) => {
    try {
      const { lineItemId } = c.req.valid("param");
      const { roomId } = c.req.valid("json");
      const db = drizzle(c.env.DB);

      // Validate BEFORE writing — a bad id must 400, never silently insert.
      // Two independent SELECTs for one screen -> one db.batch round trip.
      const [lineItemRows, roomRows] = await db.batch([
        db.select({ id: estimateLineItems.id }).from(estimateLineItems).where(
          eq(estimateLineItems.id, lineItemId),
        ),
        db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId)),
      ]);
      if (!lineItemRows[0]) {
        return c.json({ error: `Line item ${lineItemId} not found` }, 404);
      }
      if (!roomRows[0]) {
        return c.json({ error: `roomId ${roomId} does not exist` }, 400);
      }

      // Never db.transaction() (dead on D1) — a single write still goes
      // through db.batch per the epic's D1 rules.
      const [updatedRows] = await db.batch([
        db
          .update(estimateLineItems)
          .set({ roomId, mappingStatus: "confirmed", datetimeUpdated: new Date() })
          .where(eq(estimateLineItems.id, lineItemId))
          .returning({
            id: estimateLineItems.id,
            roomId: estimateLineItems.roomId,
            mappingStatus: estimateLineItems.mappingStatus,
          }),
      ]);
      // The row passed the validation batch above but can still be deleted
      // between that read and this write — a read-then-write race that D1's
      // per-statement atomicity doesn't cover (db.batch is atomic across the
      // statements it's given, not across separate batches). Surface it as a
      // 404, not a 500 from an unchecked `[0]!`.
      const updated = updatedRows[0];
      if (!updated) {
        return c.json({ error: `Line item ${lineItemId} no longer exists` }, 404);
      }

      return c.json(
        { lineItemId: updated.id, roomId: updated.roomId!, mappingStatus: updated.mappingStatus },
        200,
      );
    } catch (error) {
      return c.json(
        {
          error: "Failed to confirm room mapping",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  },
);

// --- POST /reconciliation/:lineItemId/reject ---------------------------------

budgetReconciliationRouter.openapi(
  createRoute({
    method: "post",
    path: "/reconciliation/{lineItemId}/reject",
    request: {
      params: LineItemParamSchema,
      body: { content: { "application/json": { schema: RejectBodySchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: RejectResponseSchema } }, description: "Rejected" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Line item not found" },
      409: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "notes changed concurrently — reload and retry",
      },
      500: { content: { "application/json": { schema: ErrorSchema } }, description: "Write failed" },
    },
    tags: ["budget-reconciliation"],
  }),
  async (c) => {
    try {
      const { lineItemId } = c.req.valid("param");
      const { reason } = c.req.valid("json");
      const db = drizzle(c.env.DB);

      const [priorRows] = await db.batch([
        db
          .select({ id: estimateLineItems.id, notes: estimateLineItems.notes })
          .from(estimateLineItems)
          .where(eq(estimateLineItems.id, lineItemId)),
      ]);
      const prior = priorRows[0];
      if (!prior) {
        return c.json({ error: `Line item ${lineItemId} not found` }, 404);
      }

      // ponytail: estimate_line_items has no dedicated rejection-reason
      // column, and adding one is a migration this route file isn't
      // authorized to make (schema/migrations belong to the S1 agent). Append
      // the reason to the existing `notes` field instead of dropping it —
      // add the column later if a structured reason ever needs to be queried.
      // Bounded + deduped by appendRejectionNote so repeated rejects don't
      // grow the field forever (see report finding #5).
      const notes = appendRejectionNote(prior.notes, reason);

      // The read (above) and this write are two separate D1 calls, so a read-
      // between-writes race is possible — outside any atomic unit on D1
      // (db.batch only makes the statements it's GIVEN atomic, not two
      // separate batches). Guard it with optimistic concurrency: the UPDATE
      // only applies if `notes` still matches what was just read; if another
      // request changed it in between, zero rows update and this returns 409
      // instead of silently discarding one of the two writers' notes.
      const notesMatch = prior.notes === null ? isNull(estimateLineItems.notes) : eq(estimateLineItems.notes, prior.notes);
      const [updatedRows] = await db.batch([
        db
          .update(estimateLineItems)
          .set({ mappingStatus: "rejected", notes, datetimeUpdated: new Date() })
          .where(and(eq(estimateLineItems.id, lineItemId), notesMatch))
          .returning({ id: estimateLineItems.id }),
      ]);
      if (!updatedRows[0]) {
        return c.json(
          { error: `Line item ${lineItemId} was modified concurrently — reload and retry` },
          409,
        );
      }

      return c.json({ lineItemId, mappingStatus: "rejected", reason: reason ?? null }, 200);
    } catch (error) {
      return c.json(
        {
          error: "Failed to reject room mapping",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  },
);
