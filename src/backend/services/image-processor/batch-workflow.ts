/**
 * @fileoverview Per-upload coordinator that throttles Workers AI processing.
 *
 * A single upload (or reprocess/auto-heal batch) creates ONE instance of this
 * workflow with all its image params. It processes the images in barrier waves
 * of WAVE_SIZE: all images in a wave finish (each having had up to 3 AI retries)
 * before the next wave starts. This caps concurrent Workers AI calls per upload
 * and prevents the batch stampede that trips "AiError: 3040" capacity errors.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import { startRun } from "@backend/services/agent-runs";
import {
  runImageProcessingSteps,
  type ImageProcessingWorkflowParams,
} from "./workflow";

export interface ImageBatchProcessingWorkflowParams {
  items: ImageProcessingWorkflowParams[];
}

/** Images processed through Workers AI at once within one upload. */
const WAVE_SIZE = 3;
/**
 * Max images handled by one coordinator instance, kept well under the
 * Cloudflare Workflows per-instance step ceiling (~8 persisted steps/image →
 * ~800 steps at 100). Larger uploads chain into a follow-up coordinator so the
 * per-upload 3-at-a-time cap holds (continuations run sequentially).
 */
const MAX_COORDINATOR_ITEMS = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export class ImageBatchProcessingWorkflow extends WorkflowEntrypoint<
  Env,
  ImageBatchProcessingWorkflowParams
> {
  async run(
    event: WorkflowEvent<ImageBatchProcessingWorkflowParams>,
    step: WorkflowStep,
  ): Promise<{ success: true; processed: number; failed: number }> {
    // Run-level only. Each image already opens its own run inside
    // runImageProcessingSteps, so wrapping `step` here would record every
    // item's steps twice — once against the coordinator, once against the
    // image — and make both traces unreadable.
    const allItems = event.payload.items ?? [];
    const items = allItems.slice(0, MAX_COORDINATOR_ITEMS);
    const overflow = allItems.slice(MAX_COORDINATOR_ITEMS);

    const run = await startRun(this.env, {
      agent: "image-batch",
      operation: "process_batch",
      targetType: "image_batch",
      targetId: String(allItems.length),
      input: { items: allItems.length },
      triggeredBy: "agent",
    });

    let processed = 0;
    let failed = 0;

    for (const wave of chunk(items, WAVE_SIZE)) {
      const results = await Promise.all(
        wave.map((item) =>
          // runImageProcessingSteps is contracted never to reject (per-image
          // failures resolve to {status:"failed"}). This .catch is defense in
          // depth so one image can never abort the rest of the wave.
          runImageProcessingSteps(step, this.env, item).catch(() => ({
            imageId: item.imageId,
            status: "failed" as const,
          })),
        ),
      );
      for (const result of results) {
        if (result.status === "processed") {
          processed += 1;
        } else {
          failed += 1;
        }
      }
    }

    if (overflow.length > 0) {
      await step.do("chain-overflow", async () => {
        // crypto.randomUUID() is called inside the step body on purpose: step
        // results are memoized, so on a Workflow replay this id is NOT
        // regenerated — preventing a duplicate continuation instance. Do not
        // hoist it out of the step.
        await this.env.IMAGE_BATCH_WORKFLOW.create({
          id: `image-batch-cont-${crypto.randomUUID()}`,
          params: { items: overflow },
        });
        return { chained: overflow.length };
      });
    }

    await run.succeed({ processed, failed, overflow: overflow.length });
    return { success: true, processed, failed };
  }
}
