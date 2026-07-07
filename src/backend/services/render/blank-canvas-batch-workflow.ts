/**
 * @fileoverview Durable batch processor for blank-canvas generation.
 *
 * Replaces the old `c.executionCtx.waitUntil(...)` sequential loop that lived
 * inline in the `/generate-blank-canvases` route handler. `waitUntil` has
 * runtime limits — a long batch could die silently mid-run, leaving items
 * stuck "processing" forever with no way to resume. A Cloudflare Workflow
 * persists each step's result, survives isolate churn/redeploys, and retries
 * are scoped per-step instead of restarting the whole batch.
 *
 * Modeled on `../image-processor/batch-workflow.ts`: process items in small
 * "waves" (Gemini image generation is quota-sensitive — see the wave
 * rationale comment there) instead of firing every item concurrently.
 */

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import {
  blankCanvasGenerationJobItems,
  blankCanvasGenerationJobs,
  listingPhotoBlankCanvases,
  listingPhotos,
} from "@backend/db";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";

import { ImageProcessorService } from "../image-processor";
import { generateBlankCanvas } from "./blank-canvas-generator";

export interface BlankCanvasBatchWorkflowItem {
  listingPhotoId: number;
  sourceUrl: string;
}

export interface BlankCanvasBatchWorkflowParams {
  jobId: string;
  leaveOutline: boolean;
  items: BlankCanvasBatchWorkflowItem[];
}

/**
 * Photos processed through Gemini at once within one job. Kept small — same
 * rationale as the image-processor batch workflow's WAVE_SIZE: Gemini image
 * generation is quota-sensitive and a stampede of concurrent generations
 * trips capacity errors.
 */
const WAVE_SIZE = 2;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

type ItemOutcome = { listingPhotoId: number; status: "done" | "failed" };

/**
 * Processes a single listing photo: mark it "processing" in D1, generate the
 * blank canvas via Gemini, upload the result to Cloudflare Images, and record
 * the final status. Mirrors the upload + db.batch update logic that used to
 * live inline in the route's waitUntil loop, verbatim, including
 * `resolveCloudflareImagesCredentials`.
 *
 * A failed item is caught and recorded — it must NOT throw, so one bad photo
 * can never abort the rest of the wave/workflow.
 */
async function processOneItem(
  step: WorkflowStep,
  env: Env,
  jobId: string,
  leaveOutline: boolean,
  item: BlankCanvasBatchWorkflowItem,
): Promise<ItemOutcome> {
  try {
    await step.do(`mark-processing:${item.listingPhotoId}`, async () => {
      const db = drizzle(env.DB);
      await db
        .update(blankCanvasGenerationJobItems)
        .set({ status: "processing", updatedAt: new Date() })
        .where(
          and(
            eq(blankCanvasGenerationJobItems.jobId, jobId),
            eq(blankCanvasGenerationJobItems.listingPhotoId, item.listingPhotoId),
          ),
        )
        .run();
      return { listingPhotoId: item.listingPhotoId };
    });

    const outcome = await step.do(
      `generate-and-upload:${item.listingPhotoId}`,
      async (): Promise<
        | { ok: true; deliveryToken: string }
        | { ok: false; error: string }
      > => {
        try {
          const credentials = await resolveCloudflareImagesCredentials(env);
          if (!credentials.accountId || credentials.apiTokens.length === 0) {
            return { ok: false, error: "Cloudflare credentials not configured" };
          }

          const processor = new ImageProcessorService(
            env,
            credentials.accountId,
            credentials.apiTokens[0],
            { fallbackApiTokens: credentials.apiTokens.slice(1) },
          );

          // Generate blank canvas via Gemini
          const result = await generateBlankCanvas(item.sourceUrl, env, { leaveOutline });

          // Upload the result to Cloudflare Images
          const imageBlob = new Blob([result.imageBytes], { type: result.mimeType });
          const imageId = crypto.randomUUID();
          const uploadResponse = await processor.uploadToCloudflareImages(
            imageBlob,
            imageId,
            `blank-canvas-${item.listingPhotoId}.${result.mimeType.includes("png") ? "png" : "jpg"}`,
          );

          if (!uploadResponse.success) {
            return { ok: false, error: "Failed to upload generated image to Cloudflare" };
          }

          const deliveryUrl = processor.getDeliveryUrl(uploadResponse, uploadResponse.result.id);
          const deliveryToken =
            ImageProcessorService.extractDeliveryTokenFromUrl(deliveryUrl) ||
            `${credentials.accountId}/${uploadResponse.result.id}`;

          // Update the listing photo with the blank canvas
          const db = drizzle(env.DB);
          await db.batch([
            db
              .update(listingPhotos)
              .set({ blankCanvasCfImageId: deliveryToken })
              .where(eq(listingPhotos.id, item.listingPhotoId)),
            db.insert(listingPhotoBlankCanvases).values({
              listingPhotoId: item.listingPhotoId,
              cfImageId: deliveryToken,
              prompt: "AI Generate (Batch)",
            }),
          ]);

          return { ok: true, deliveryToken };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error(
            `[BlankCanvasBatchWorkflow] Failed to generate for listing photo ${item.listingPhotoId}:`,
            err,
          );
          return { ok: false, error: message };
        }
      },
    );

    await step.do(`mark-result:${item.listingPhotoId}`, async () => {
      const db = drizzle(env.DB);
      if (outcome.ok) {
        await db
          .update(blankCanvasGenerationJobItems)
          .set({
            status: "done",
            blankCanvasCfImageId: outcome.deliveryToken,
            error: null,
            updatedAt: new Date(),
          })
          .where(
          and(
            eq(blankCanvasGenerationJobItems.jobId, jobId),
            eq(blankCanvasGenerationJobItems.listingPhotoId, item.listingPhotoId),
          ),
        )
          .run();
      } else {
        await db
          .update(blankCanvasGenerationJobItems)
          .set({
            status: "failed",
            error: outcome.error,
            updatedAt: new Date(),
          })
          .where(
          and(
            eq(blankCanvasGenerationJobItems.jobId, jobId),
            eq(blankCanvasGenerationJobItems.listingPhotoId, item.listingPhotoId),
          ),
        )
          .run();
      }
      return { listingPhotoId: item.listingPhotoId };
    });

    return {
      listingPhotoId: item.listingPhotoId,
      status: outcome.ok ? "done" : "failed",
    };
  } catch (err) {
    // Defense in depth: even if a step itself threw (e.g. transient D1 error
    // exhausted its retries), never let that abort the wave — record the
    // failure best-effort and move on.
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[BlankCanvasBatchWorkflow] Unhandled error processing listing photo ${item.listingPhotoId}:`,
      err,
    );
    try {
      await step.do(`mark-failed-fallback:${item.listingPhotoId}`, async () => {
        const db = drizzle(env.DB);
        await db
          .update(blankCanvasGenerationJobItems)
          .set({ status: "failed", error: message, updatedAt: new Date() })
          .where(
          and(
            eq(blankCanvasGenerationJobItems.jobId, jobId),
            eq(blankCanvasGenerationJobItems.listingPhotoId, item.listingPhotoId),
          ),
        )
          .run();
        return { listingPhotoId: item.listingPhotoId };
      });
    } catch (markErr) {
      console.error(
        `[BlankCanvasBatchWorkflow] Failed to record fallback failure for listing photo ${item.listingPhotoId}:`,
        markErr,
      );
    }
    return { listingPhotoId: item.listingPhotoId, status: "failed" };
  }
}

export class BlankCanvasBatchWorkflow extends WorkflowEntrypoint<
  Env,
  BlankCanvasBatchWorkflowParams
> {
  async run(
    event: WorkflowEvent<BlankCanvasBatchWorkflowParams>,
    step: WorkflowStep,
  ): Promise<{ success: true; jobId: string; done: number; failed: number }> {
    const { jobId, leaveOutline, items } = event.payload;

    let done = 0;
    let failed = 0;

    for (const wave of chunk(items, WAVE_SIZE)) {
      const results = await Promise.all(
        wave.map((item) => processOneItem(step, this.env, jobId, leaveOutline, item)),
      );
      for (const result of results) {
        if (result.status === "done") {
          done += 1;
        } else {
          failed += 1;
        }
      }
    }

    await step.do("finalize-job", async () => {
      const db = drizzle(this.env.DB);
      const finalStatus = done === 0 && failed > 0 ? "failed" : "complete";
      await db
        .update(blankCanvasGenerationJobs)
        .set({ status: finalStatus, updatedAt: new Date() })
        .where(eq(blankCanvasGenerationJobs.id, jobId))
        .run();
      return { jobId, finalStatus };
    });

    return { success: true, jobId, done, failed };
  }
}
