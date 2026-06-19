/**
 * @fileoverview Auto-heal sweep for stranded image-processing uploads.
 *
 * A large inspiration/listing photo upload spawns one ImageProcessingWorkflow
 * instance per image. When a whole batch hits Workers AI at once, some images
 * fail with transient errors ("AiError: 3040: Capacity temporarily exceeded"
 * or a step timeout). The workflow's own retry rides out most blips, but a
 * burst that outlasts the retry window can still strand a few as `failed`.
 *
 * The static `* * * * *` cron (see src/_worker.ts) calls this sweep every
 * minute. It re-queues a small batch of recently-failed (transient) or
 * stuck-queued images so they self-heal once Workers AI capacity recovers —
 * no manual reprocess needed.
 */

import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  imageUploadStaging,
  images,
  inspirationalImageRooms,
} from "@backend/db";
import { normalizePhotoCategory } from "./helpers";
import type { PhotoCategory } from "./types";
import type { ImageProcessingWorkflowParams } from "./workflow";

/**
 * Re-queue at most this many images per tick so the sweep never re-creates the
 * thundering herd it exists to recover from.
 */
const MAX_HEAL_PER_TICK = 5;
/** Ignore rows older than this so a permanently-bad image isn't retried forever. */
const HEAL_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24h
/** A row still `queued` after this long means its workflow never started. */
const STUCK_QUEUED_MS = 15 * 60 * 1000; // 15m
/** Failure signatures worth retrying automatically (transient capacity/timeout). */
const TRANSIENT_ERROR_PATTERNS = [
  "3040",
  "capacity",
  "timed out",
  "timeout",
  "temporarily",
];

function isTransientError(error: string | null): boolean {
  if (!error) {
    return false;
  }
  const lower = error.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

function toMappingCategory(
  photoCategory: string | null,
  isListingPhoto: boolean,
): PhotoCategory {
  const normalized = normalizePhotoCategory(photoCategory, isListingPhoto);
  return normalized === "listing" ? "listing" : "inspirational";
}

/**
 * Find recently-stranded image uploads and re-run their processing workflow.
 * Safe to call every minute: it is a no-op when nothing needs healing, caps
 * how many it re-queues, and deliberately leaves `processing` rows alone
 * (Cloudflare Workflows are durable and resume on their own — re-creating one
 * mid-retry would double the AI load).
 */
export async function autoHealImageUploads(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const now = Date.now();
  const lookbackCutoff = new Date(now - HEAL_LOOKBACK_MS);
  const stuckCutoff = new Date(now - STUCK_QUEUED_MS);

  const candidates = await db
    .select()
    .from(imageUploadStaging)
    .where(
      and(
        gte(imageUploadStaging.datetimeCreated, lookbackCutoff),
        or(
          eq(imageUploadStaging.processingStatus, "failed"),
          and(
            eq(imageUploadStaging.processingStatus, "queued"),
            lte(imageUploadStaging.datetimeCreated, stuckCutoff),
          ),
        ),
      ),
    )
    .all();

  // A `failed` row only heals if it failed for a transient reason; a stuck
  // `queued` row always heals (its workflow clearly never started).
  const healable = candidates
    .filter((row) =>
      row.processingStatus === "queued"
        ? true
        : isTransientError(row.processingError),
    )
    .slice(0, MAX_HEAL_PER_TICK);

  if (healable.length === 0) {
    return;
  }

  const imageIds = healable.map((row) => row.imageId);

  const imageRows = await db
    .select()
    .from(images)
    .where(inArray(images.id, imageIds))
    .all();
  const imageById = new Map(imageRows.map((row) => [row.id, row]));

  const roomMappings = await db
    .select()
    .from(inspirationalImageRooms)
    .where(inArray(inspirationalImageRooms.imageId, imageIds))
    .all();
  const roomIdsByImage = new Map<string, number[]>();
  for (const mapping of roomMappings) {
    const list = roomIdsByImage.get(mapping.imageId) ?? [];
    if (!list.includes(mapping.roomId)) {
      list.push(mapping.roomId);
    }
    roomIdsByImage.set(mapping.imageId, list);
  }

  const batchItems: ImageProcessingWorkflowParams[] = [];
  for (const row of healable) {
    const image = imageById.get(row.imageId);
    if (!image) {
      continue;
    }
    batchItems.push({
      imageId: row.imageId,
      photoCategory: toMappingCategory(
        image.photoCategory,
        image.isListingPhoto,
      ),
      isListingPhoto: image.isListingPhoto,
      filename: image.sourceFilename || "image.jpg",
      roomId: image.roomId,
      roomIds: roomIdsByImage.get(row.imageId) ?? [],
      roomHint: image.roomType,
    });
  }

  if (batchItems.length === 0) {
    return;
  }

  const batchInstanceId = `image-batch-heal-${now}`;
  const batchImageIds = batchItems.map((item) => item.imageId);

  try {
    await env.IMAGE_BATCH_WORKFLOW.create({
      id: batchInstanceId,
      params: { items: batchItems },
    });
    await db
      .update(imageUploadStaging)
      .set({
        processingStatus: "queued",
        processingError: null,
        workflowInstanceId: batchInstanceId,
        datetimeProcessingStarted: null,
        datetimeProcessed: null,
      })
      .where(inArray(imageUploadStaging.imageId, batchImageIds))
      .run();
    console.log(
      `autoHealImageUploads: re-queued ${batchImageIds.length} stranded image(s) via ${batchInstanceId}`,
    );
  } catch (error) {
    console.error(
      "autoHealImageUploads: failed to create batch workflow:",
      error instanceof Error ? error.message : error,
    );
  }
}
