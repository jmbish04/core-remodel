import { showroomBulkIntakeItems } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

/** A processing item older than this (ms) with no update is treated as stuck. */
const STUCK_AFTER_MS = 4 * 60_000;

export const checkBulkIntakeStatus = defineTool({
  name: "check_bulk_intake_status",
  category: "showrooms",
  title: "Check a bulk showroom-intake batch",
  description:
    "Poll a batch queued by `bulk_import_showrooms_from_places`. Pass the `batchId` it returned. Reports per-status " +
    "counts (queued / processing / done / skipped / failed), whether the batch is complete, the durable workflow's " +
    "own status, a `stuck` flag (an item left processing too long or the workflow errored while work remains), and " +
    "the per-item list (placeId, status, showroomId, outcome, error). Use this to look in on a set-and-forget batch " +
    "without re-submitting it.",
  inputShape: {
    batchId: z.string().min(1).describe("The batchId returned by bulk_import_showrooms_from_places"),
  },
  annotations: READ_ONLY,
  outputShape: {
    batchId: z.string(),
    total: z.number().int(),
    complete: z.boolean(),
    stuck: z.boolean(),
    workflowStatus: z.string(),
    counts: looseObject({
      queued: z.number().int(),
      processing: z.number().int(),
      done: z.number().int(),
      skipped: z.number().int(),
      failed: z.number().int(),
    }),
    items: z.array(
      looseObject({
        placeId: z.string(),
        status: z.string(),
        showroomId: z.number().int().nullable(),
      }),
    ),
  },
  examples: [{ title: "Poll a batch", args: { batchId: "5da98dea-985d-4bc7-b0d6-996f0ad5e0c1" } }],
  handler: async ({ env, db }, input) => {
    const batchId = input.batchId.trim();
    const rows = await db
      .select()
      .from(showroomBulkIntakeItems)
      .where(eq(showroomBulkIntakeItems.batchId, batchId))
      .all();
    if (rows.length === 0) {
      toolError(`No bulk-intake batch found for batchId "${batchId}".`);
    }

    const counts = { queued: 0, processing: 0, done: 0, skipped: 0, failed: 0 };
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

    const pending = counts.queued + counts.processing;
    const complete = pending === 0;

    // The durable workflow's own view (best-effort — instance may have aged out).
    let workflowStatus = "unknown";
    try {
      const inst = await env.SHOWROOM_BULK_INTAKE_WORKFLOW.get(batchId);
      const s = await inst.status();
      workflowStatus = typeof s?.status === "string" ? s.status : "unknown";
    } catch {
      workflowStatus = "unknown";
    }

    // Stuck: work remains but the workflow is no longer running, OR an item has
    // sat in `processing` past the threshold with no update.
    const now = Date.now();
    const staleProcessing = rows.some(
      (r) => r.status === "processing" && now - r.updatedAt.getTime() > STUCK_AFTER_MS,
    );
    const workflowDead = ["errored", "terminated", "unknown"].includes(workflowStatus);
    const stuck = !complete && (staleProcessing || workflowDead);

    return {
      batchId,
      total: rows.length,
      complete,
      stuck,
      workflowStatus,
      counts,
      items: rows.map((r) => ({
        placeId: r.placeId,
        status: r.status,
        showroomId: r.storeId ?? null,
        resultStatus: r.resultStatus ?? null,
        error: r.error ?? null,
      })),
    };
  },
});
