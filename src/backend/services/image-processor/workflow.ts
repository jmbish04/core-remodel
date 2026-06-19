import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import {
  imageUploadStaging,
  images,
  inspirationalImageRooms,
} from "@backend/db";
import { publishRealtimeEvent } from "@backend/realtime/publish";
import {
  ImageProcessorService,
  type PhotoCategory,
  type ImageAnalysisResult,
} from ".";

export interface ImageProcessingWorkflowParams {
  imageId: string;
  photoCategory: PhotoCategory;
  isListingPhoto: boolean;
  filename: string;
  roomId: number | null;
  roomIds: number[];
  roomHint: string | null;
}

interface LoadedImageContext {
  deliveryUrl: string;
  deliveryToken: string | null;
  existingDisplayNames: string[];
}

interface PersistedAnalysis {
  embeddingText: string;
}

function getImageDeliveryUrl(
  image:
    | Pick<
        typeof images.$inferSelect,
        "cfImageIdOptimized" | "cfImageIdOriginal" | "metadata"
      >
    | null
    | undefined,
): string | null {
  if (!image) {
    return null;
  }

  const metadata = ImageProcessorService.parseMetadata(image.metadata);
  if (
    typeof metadata.deliveryUrl === "string" &&
    metadata.deliveryUrl.trim().length > 0
  ) {
    return metadata.deliveryUrl;
  }

  const candidate = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!candidate) {
    return null;
  }
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  if (candidate.includes("/")) {
    return `https://imagedelivery.net/${candidate}/public`;
  }
  return null;
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .map((segment) => {
      const trimmed = segment.trim();
      return trimmed.length > 0
        ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
        : "";
    })
    .join(" ")
    .trim();
}

function buildFallbackDisplayName(
  analysis: ImageAnalysisResult,
  roomHint: string | null,
  filename: string,
): string {
  const filenameDisplayName =
    ImageProcessorService.deriveDisplayNameFromFilename(filename);
  const roomLabel = toTitleCase(
    (roomHint || analysis.roomType || "unknown")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const visibleSubject = analysis.visibleElements[0]?.trim() || "";

  if (visibleSubject && roomLabel) {
    return `${roomLabel} ${visibleSubject}`;
  }
  if (roomLabel) {
    return `${roomLabel} photo`;
  }
  return filenameDisplayName;
}

function buildAiRationaleMap(
  metadata: Record<string, unknown>,
): Map<string, string> {
  const map = new Map<string, string>();
  const aiPrefill =
    metadata.aiPrefill && typeof metadata.aiPrefill === "object"
      ? (metadata.aiPrefill as Record<string, unknown>)
      : null;
  const tags = Array.isArray(aiPrefill?.tags)
    ? (aiPrefill?.tags as Array<Record<string, unknown>>)
    : [];

  for (const tag of tags) {
    const value = typeof tag.value === "string" ? tag.value.trim() : "";
    const rationale =
      typeof tag.rationale === "string" ? tag.rationale.trim() : "";
    if (!value || !rationale) {
      continue;
    }
    map.set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-"),
      rationale,
    );
  }

  return map;
}

/**
 * Workers AI vision/LLM/embedding calls intermittently return transient
 * "AiError: 3040: Capacity temporarily exceeded" errors. With the per-upload
 * coordinator now limiting concurrency to a few images at a time
 * (see batch-workflow.ts), 3 retries with exponential backoff is enough to ride
 * out the occasional blip without stranding an image as `failed`.
 */
const AI_STEP_RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "20 seconds", backoff: "exponential" },
  timeout: "2 minutes",
};

export async function runImageProcessingSteps(
  step: WorkflowStep,
  env: Env,
  params: ImageProcessingWorkflowParams,
): Promise<{ imageId: string; status: "processed" | "failed" }> {
  try {
    await step.do(`mark-processing-started:${params.imageId}`, async () => {
      const db = drizzle(env.DB);
      await db
        .update(imageUploadStaging)
        .set({
          processingStatus: "processing",
          processingError: null,
          datetimeProcessingStarted: new Date(),
        })
        .where(eq(imageUploadStaging.imageId, params.imageId))
        .run();

      await publishRealtimeEvent(env, "uploads", {
        imageId: params.imageId,
        progress: 10,
        status: "processing",
        stepName: "Initializing processing...",
        timestamp: new Date().toISOString(),
      });

      return { imageId: params.imageId };
    });

    const context = await step.do(
      `load-image-context:${params.imageId}`,
      async (): Promise<LoadedImageContext> => {
        const db = drizzle(env.DB);
        const imageRecord = await db
          .select()
          .from(images)
          .where(eq(images.id, params.imageId))
          .get();

        if (!imageRecord) {
          throw new Error(
            `Image ${params.imageId} was not found for workflow processing.`,
          );
        }

        const deliveryUrl = getImageDeliveryUrl(imageRecord);
        if (!deliveryUrl) {
          throw new Error(
            `Image ${params.imageId} does not have a resolvable delivery URL.`,
          );
        }

        let existingDisplayNames: string[] = [];

        if (params.photoCategory === "listing" && params.roomId) {
          const siblings = await db
            .select({
              id: images.id,
              displayName: images.displayName,
            })
            .from(images)
            .where(
              and(
                eq(images.photoCategory, "listing"),
                eq(images.roomId, params.roomId),
              ),
            )
            .all();
          existingDisplayNames = siblings
            .filter((row) => row.id !== params.imageId)
            .map((row) => row.displayName?.trim() || "")
            .filter(Boolean);
        } else if (
          params.photoCategory === "inspirational" &&
          params.roomIds.length > 0
        ) {
          const mappings = await db
            .select({
              imageId: inspirationalImageRooms.imageId,
            })
            .from(inspirationalImageRooms)
            .where(inArray(inspirationalImageRooms.roomId, params.roomIds))
            .all();
          const siblingImageIds = Array.from(
            new Set(
              mappings
                .map((row) => row.imageId)
                .filter((imageId) => imageId && imageId !== params.imageId),
            ),
          );

          if (siblingImageIds.length > 0) {
            const siblingImages = await db
              .select({
                photoCategory: images.photoCategory,
                displayName: images.displayName,
              })
              .from(images)
              .where(inArray(images.id, siblingImageIds))
              .all();
            existingDisplayNames = siblingImages
              .filter((row) => row.photoCategory === "inspirational")
              .map((row) => row.displayName?.trim() || "")
              .filter(Boolean);
          }
        }

        await publishRealtimeEvent(env, "uploads", {
          imageId: params.imageId,
          progress: 25,
          status: "processing",
          stepName: "Loading image context...",
          timestamp: new Date().toISOString(),
        });

        return {
          deliveryUrl,
          deliveryToken: imageRecord.cfImageIdOriginal,
          existingDisplayNames,
        };
      },
    );

    const visionDescription = await step.do(
      `vision-description:${params.imageId}`,
      AI_STEP_RETRY,
      async () => {
        const processor = new ImageProcessorService(env, "", "");
        const result = await processor.describeImageFromDeliveryUrl(
          context.deliveryUrl,
        );
        await publishRealtimeEvent(env, "uploads", {
          imageId: params.imageId,
          progress: 50,
          status: "processing",
          stepName: "Describing image using Vision AI...",
          timestamp: new Date().toISOString(),
        });
        return result;
      },
    );

    const analysis = await step.do(`structured-analysis:${params.imageId}`, AI_STEP_RETRY, async () => {
      const processor = new ImageProcessorService(env, "", "");
      const result = await processor.analyzeVisionSummary(visionDescription, {
        photoCategory: params.photoCategory,
        roomHint: params.roomHint,
        roomLabels: params.roomHint ? [params.roomHint] : [],
        existingDisplayNames: context.existingDisplayNames,
      });
      await publishRealtimeEvent(env, "uploads", {
        imageId: params.imageId,
        progress: 70,
        status: "processing",
        stepName: "Running AI analysis...",
        timestamp: new Date().toISOString(),
      });
      return result;
    });

    const persisted = await step.do(
      `persist-analysis:${params.imageId}`,
      async (): Promise<PersistedAnalysis> => {
        const db = drizzle(env.DB);
        const processor = new ImageProcessorService(env, "", "");
        const imageRecord = await db
          .select()
          .from(images)
          .where(eq(images.id, params.imageId))
          .get();

        if (!imageRecord) {
          throw new Error(
            `Image ${params.imageId} disappeared before persistence.`,
          );
        }

        const filenameDisplayName =
          ImageProcessorService.deriveDisplayNameFromFilename(
            params.filename,
          );
        const currentDisplayName = imageRecord.displayName?.trim() || "";
        const preserveCurrentDisplayName =
          currentDisplayName.length > 0 &&
          currentDisplayName !== filenameDisplayName;
        const generatedDisplayName = processor.deriveUniqueDisplayName(
          analysis.suggestedDisplayName,
          context.existingDisplayNames,
          buildFallbackDisplayName(
            analysis,
            params.roomHint,
            params.filename,
          ),
        );
        const nextDisplayName = preserveCurrentDisplayName
          ? currentDisplayName
          : generatedDisplayName;

        const currentRoomType = imageRecord.roomType?.trim() || "";
        const nextRoomType =
          currentRoomType ||
          params.roomHint ||
          analysis.roomType ||
          "unknown";
        const nextMetadata = processor.buildImageMetadata(analysis, {
          displayName: nextDisplayName,
          assignedRoomType: nextRoomType,
          assignedRoomId: params.roomId,
          deliveryUrl: context.deliveryUrl,
          deliveryToken: context.deliveryToken,
        });
        const metadataJson = processor.mergeImageMetadata(
          imageRecord.metadata,
          nextMetadata,
        );
        const metadataTags = Array.isArray(nextMetadata.tags)
          ? nextMetadata.tags.map((tag) => String(tag).trim()).filter(Boolean)
          : [];
        const rationaleBySlug = buildAiRationaleMap(nextMetadata);

        await db
          .update(images)
          .set({
            displayName: nextDisplayName,
            roomType: nextRoomType,
            isInstagram: imageRecord.isInstagram || analysis.isInstagram,
            instagramAccount:
              imageRecord.instagramAccount?.trim() ||
              analysis.instagramAccount ||
              null,
            instagramCaption:
              imageRecord.instagramCaption?.trim() ||
              analysis.instagramCaption ||
              null,
            cfImageIdOptimized:
              analysis.needsCrop && analysis.isInstagram
                ? imageRecord.cfImageIdOptimized ||
                  imageRecord.cfImageIdOriginal
                : imageRecord.cfImageIdOptimized,
            metadata: metadataJson,
          })
          .where(eq(images.id, params.imageId))
          .run();

        await processor.replaceAiPrefillTagMappings(
          params.imageId,
          metadataTags,
          rationaleBySlug,
        );

        await publishRealtimeEvent(env, "uploads", {
          imageId: params.imageId,
          progress: 85,
          status: "processing",
          stepName: "Saving AI analysis and tags...",
          timestamp: new Date().toISOString(),
        });

        return {
          embeddingText: [
            nextRoomType,
            analysis.keywords.join(" "),
            analysis.instagramCaption || "",
          ]
            .filter((value) => value.trim().length > 0)
            .join(" "),
        };
      },
    );

    const embeddingValues = await step.do(`generate-embedding:${params.imageId}`, AI_STEP_RETRY, async () => {
      const processor = new ImageProcessorService(env, "", "");
      const result = await processor.generateEmbeddings(
        persisted.embeddingText,
      );
      await publishRealtimeEvent(env, "uploads", {
        imageId: params.imageId,
        progress: 90,
        status: "processing",
        stepName: "Indexing database vectors...",
        timestamp: new Date().toISOString(),
      });
      return result;
    });

    await step.do(`upsert-vector:${params.imageId}`, async () => {
      const processor = new ImageProcessorService(env, "", "");
      await processor.upsertEmbeddingVector(
        params.imageId,
        persisted.embeddingText,
        embeddingValues,
      );

      await publishRealtimeEvent(env, "uploads", {
        imageId: params.imageId,
        progress: 95,
        status: "processing",
        stepName: "Indexing database vectors...",
        timestamp: new Date().toISOString(),
      });

      return { imageId: params.imageId };
    });

    await step.do(`mark-processed:${params.imageId}`, async () => {
      const db = drizzle(env.DB);
      await db
        .update(imageUploadStaging)
        .set({
          processingStatus: "processed",
          processingError: null,
          datetimeProcessed: new Date(),
        })
        .where(eq(imageUploadStaging.imageId, params.imageId))
        .run();

      await publishRealtimeEvent(env, "uploads", {
        imageId: params.imageId,
        progress: 100,
        status: "processed",
        stepName: "Completed!",
        timestamp: new Date().toISOString(),
      });

      return { imageId: params.imageId };
    });

    return { imageId: params.imageId, status: "processed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await step.do(`mark-failed:${params.imageId}`, async () => {
        const db = drizzle(env.DB);
        await db
          .update(imageUploadStaging)
          .set({
            processingStatus: "failed",
            processingError: message,
          })
          .where(eq(imageUploadStaging.imageId, params.imageId))
          .run();

        await publishRealtimeEvent(env, "uploads", {
          imageId: params.imageId,
          progress: 100,
          status: "failed",
          stepName: "Failed processing",
          error: message,
          timestamp: new Date().toISOString(),
        });

        return { imageId: params.imageId, processingStatus: "failed" };
      });
    } catch (markFailedError) {
      // Never reject: the batch coordinator's Promise.all must not abort a wave
      // because one image couldn't record its own failure (e.g., transient D1).
      console.error(
        `runImageProcessingSteps: mark-failed step failed for ${params.imageId}:`,
        markFailedError instanceof Error ? markFailedError.message : markFailedError,
      );
    }
    return { imageId: params.imageId, status: "failed" };
  }
}

export class ImageProcessingWorkflow extends WorkflowEntrypoint<
  Env,
  ImageProcessingWorkflowParams
> {
  async run(
    event: WorkflowEvent<ImageProcessingWorkflowParams>,
    step: WorkflowStep,
  ): Promise<{ success: true; imageId: string }> {
    await runImageProcessingSteps(step, this.env, event.payload);
    return { success: true, imageId: event.payload.imageId };
  }
}
