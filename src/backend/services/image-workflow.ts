import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { imageUploadStaging, images, inspirationalImageRooms } from "@backend/db";
import {
  ImageProcessorService,
  type PhotoCategory,
  type ImageAnalysisResult,
} from "./image-processor";

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
  if (typeof metadata.deliveryUrl === "string" && metadata.deliveryUrl.trim().length > 0) {
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
  const filenameDisplayName = ImageProcessorService.deriveDisplayNameFromFilename(filename);
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

function buildAiRationaleMap(metadata: Record<string, unknown>): Map<string, string> {
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
    const rationale = typeof tag.rationale === "string" ? tag.rationale.trim() : "";
    if (!value || !rationale) {
      continue;
    }
    map.set(value.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-"), rationale);
  }

  return map;
}

export class ImageProcessingWorkflow extends WorkflowEntrypoint<
  Env,
  ImageProcessingWorkflowParams
> {
  async run(
    event: WorkflowEvent<ImageProcessingWorkflowParams>,
    step: WorkflowStep,
  ): Promise<{ success: true; imageId: string }> {
    const params = event.payload;

    try {
      await step.do("mark-processing-started", async () => {
        const db = drizzle(this.env.DB);
        await db
          .update(imageUploadStaging)
          .set({
            processingStatus: "processing",
            processingError: null,
            datetimeProcessingStarted: new Date(),
          })
          .where(eq(imageUploadStaging.imageId, params.imageId))
          .run();

        return { imageId: params.imageId };
      });

      const context = await step.do("load-image-context", async (): Promise<LoadedImageContext> => {
        const db = drizzle(this.env.DB);
        const imageRecord = await db
          .select()
          .from(images)
          .where(eq(images.id, params.imageId))
          .get();

        if (!imageRecord) {
          throw new Error(`Image ${params.imageId} was not found for workflow processing.`);
        }

        const deliveryUrl = getImageDeliveryUrl(imageRecord);
        if (!deliveryUrl) {
          throw new Error(`Image ${params.imageId} does not have a resolvable delivery URL.`);
        }

        let existingDisplayNames: string[] = [];

        if (params.photoCategory === "listing" && params.roomId) {
          const siblings = await db
            .select({
              id: images.id,
              displayName: images.displayName,
            })
            .from(images)
            .where(and(eq(images.photoCategory, "listing"), eq(images.roomId, params.roomId)))
            .all();
          existingDisplayNames = siblings
            .filter((row) => row.id !== params.imageId)
            .map((row) => row.displayName?.trim() || "")
            .filter(Boolean);
        } else if (params.photoCategory === "inspirational" && params.roomIds.length > 0) {
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

        return {
          deliveryUrl,
          deliveryToken: imageRecord.cfImageIdOriginal,
          existingDisplayNames,
        };
      });

      const visionDescription = await step.do("vision-description", async () => {
        const processor = new ImageProcessorService(this.env, "", "");
        return processor.describeImageFromDeliveryUrl(context.deliveryUrl);
      });

      const analysis = await step.do("structured-analysis", async () => {
        const processor = new ImageProcessorService(this.env, "", "");
        return processor.analyzeVisionSummary(visionDescription, {
          photoCategory: params.photoCategory,
          roomHint: params.roomHint,
          roomLabels: params.roomHint ? [params.roomHint] : [],
          existingDisplayNames: context.existingDisplayNames,
        });
      });

      const persisted = await step.do("persist-analysis", async (): Promise<PersistedAnalysis> => {
        const db = drizzle(this.env.DB);
        const processor = new ImageProcessorService(this.env, "", "");
        const imageRecord = await db
          .select()
          .from(images)
          .where(eq(images.id, params.imageId))
          .get();

        if (!imageRecord) {
          throw new Error(`Image ${params.imageId} disappeared before persistence.`);
        }

        const filenameDisplayName =
          ImageProcessorService.deriveDisplayNameFromFilename(params.filename);
        const currentDisplayName = imageRecord.displayName?.trim() || "";
        const preserveCurrentDisplayName =
          currentDisplayName.length > 0 && currentDisplayName !== filenameDisplayName;
        const generatedDisplayName = processor.deriveUniqueDisplayName(
          analysis.suggestedDisplayName,
          context.existingDisplayNames,
          buildFallbackDisplayName(analysis, params.roomHint, params.filename),
        );
        const nextDisplayName = preserveCurrentDisplayName
          ? currentDisplayName
          : generatedDisplayName;

        const currentRoomType = imageRecord.roomType?.trim() || "";
        const nextRoomType = currentRoomType || params.roomHint || analysis.roomType || "unknown";
        const nextMetadata = processor.buildImageMetadata(analysis, {
          displayName: nextDisplayName,
          assignedRoomType: nextRoomType,
          assignedRoomId: params.roomId,
          deliveryUrl: context.deliveryUrl,
          deliveryToken: context.deliveryToken,
        });
        const metadataJson = processor.mergeImageMetadata(imageRecord.metadata, nextMetadata);
        const metadataTags = Array.isArray(nextMetadata.tags)
          ? nextMetadata.tags
              .map((tag) => String(tag).trim())
              .filter(Boolean)
          : [];
        const rationaleBySlug = buildAiRationaleMap(nextMetadata);

        await db
          .update(images)
          .set({
            displayName: nextDisplayName,
            roomType: nextRoomType,
            isInstagram: imageRecord.isInstagram || analysis.isInstagram,
            instagramAccount:
              imageRecord.instagramAccount?.trim() || analysis.instagramAccount || null,
            instagramCaption:
              imageRecord.instagramCaption?.trim() || analysis.instagramCaption || null,
            cfImageIdOptimized:
              analysis.needsCrop && analysis.isInstagram
                ? imageRecord.cfImageIdOptimized || imageRecord.cfImageIdOriginal
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

        return {
          embeddingText: [
            nextRoomType,
            analysis.keywords.join(" "),
            analysis.instagramCaption || "",
          ]
            .filter((value) => value.trim().length > 0)
            .join(" "),
        };
      });

      const embeddingValues = await step.do("generate-embedding", async () => {
        const processor = new ImageProcessorService(this.env, "", "");
        return processor.generateEmbeddings(persisted.embeddingText);
      });

      await step.do("upsert-vector", async () => {
        const processor = new ImageProcessorService(this.env, "", "");
        await processor.upsertEmbeddingVector(
          params.imageId,
          persisted.embeddingText,
          embeddingValues,
        );

        return { imageId: params.imageId };
      });

      await step.do("mark-processed", async () => {
        const db = drizzle(this.env.DB);
        await db
          .update(imageUploadStaging)
          .set({
            processingStatus: "processed",
            processingError: null,
            datetimeProcessed: new Date(),
          })
          .where(eq(imageUploadStaging.imageId, params.imageId))
          .run();

        return { imageId: params.imageId };
      });

      return {
        success: true,
        imageId: params.imageId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do("mark-failed", async () => {
        const db = drizzle(this.env.DB);
        await db
          .update(imageUploadStaging)
          .set({
            processingStatus: "failed",
            processingError: message,
          })
          .where(eq(imageUploadStaging.imageId, params.imageId))
          .run();

        return { imageId: params.imageId, processingStatus: "failed" };
      });
      throw error;
    }
  }
}
