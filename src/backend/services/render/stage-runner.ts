/**
 * StageRunner — the orchestration heart. Resolves the provider+model, runs the
 * generation with failover, uploads the result to Cloudflare Images, persists the
 * render_canvases node (+ inspiration junction rows atomically via db.batch), and
 * emits realtime progress on the existing Durable-Object channel.
 */
import { drizzle } from "drizzle-orm/d1";

import { canvasInspirationReferences, renderCanvases } from "@backend/db";

import { publishRealtimeEvent } from "../../realtime/publish";
import { uploadBytesToCfImages, uploadFromUrlToCfImages } from "./cf-images";
import { runWithFailover } from "./failover";
import { generateMoodBoard } from "./mood-board";
import {
  ALTERNATE_MODELS,
  DEFAULT_MODEL_REGISTRY,
  stageKeyForType,
  type ModelChoice,
} from "./model-registry";
import { DEFAULT_IMAGE_SIZE } from "./prompt-kit";
import type { LightingProfile, ReferenceImage, StageInput, StageType } from "./types";

export interface InspirationRefInput {
  inspirationImageId: string;
  referenceIndex: number;
  extractionNotes?: string;
  referencedRegionBoundingBox?: string;
  extractedCfImageId?: string;
}

export interface RunStageArgs {
  env: Env;
  sessionId: string;
  type: StageType;
  /** Working/base image to edit — a Cloudflare Images delivery URL. */
  inputImageUrl: string;
  prompt: string;
  parentCanvasId?: string | null;
  listingPhotoId?: number | null;
  roomId?: number | null;
  branchLabel?: string;
  lightingProfile?: LightingProfile;
  references?: ReferenceImage[];
  maskUrl?: string;
  /** Ordered image URLs for multi-image synthesis (Stage 5). */
  imageUrls?: string[];
  aspectRatio?: string;
  modelOverride?: ModelChoice;
  inspirationRefs?: InspirationRefInput[];
}

export interface RunStageResult {
  id: string;
  sessionId: string;
  type: StageType;
  status: "done" | "failed";
  provider: string;
  model: string;
  outputCfImageId: string | null;
  outputDeliveryUrl: string | null;
  parentCanvasId: string | null;
  branchLabel: string;
  lightingProfile: LightingProfile;
  moodBoardId: string | null;
}

export async function runStage(args: RunStageArgs): Promise<RunStageResult> {
  const { env } = args;
  const db = drizzle(env.DB);
  const canvasId = crypto.randomUUID();
  const room = args.roomId ?? null;
  const branchLabel = args.branchLabel ?? "A";
  const lightingProfile: LightingProfile = args.lightingProfile ?? "default";
  const aspectRatio = args.aspectRatio || "3:2";
  const room$ = `render:${args.sessionId}`;

  await publishRealtimeEvent(env, room$, {
    status: "PROCESSING",
    stage: args.type,
    progress: 10,
    message: `Starting ${args.type}`,
  });

  const stageInput: StageInput = {
    inputImageUrl: args.inputImageUrl,
    prompt: args.prompt,
    aspectRatio,
    imageSize: DEFAULT_IMAGE_SIZE,
    references: args.references,
    maskUrl: args.maskUrl,
    imageUrls: args.imageUrls,
  };

  const key = stageKeyForType(args.type);
  const primary = args.modelOverride ?? DEFAULT_MODEL_REGISTRY[key];
  const alternates = args.modelOverride ? [] : (ALTERNATE_MODELS[key] ?? []);

  let resolved;
  try {
    resolved = await runWithFailover(stageInput, primary, alternates, env);
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    await db
      .insert(renderCanvases)
      .values({
        id: canvasId,
        sessionId: args.sessionId,
        roomId: room,
        listingPhotoId: args.listingPhotoId ?? null,
        type: args.type,
        parentCanvasId: args.parentCanvasId ?? null,
        branchLabel,
        lightingProfile,
        prompt: args.prompt,
        provider: primary.provider,
        model: primary.model,
        status: "failed",
        metadata: JSON.stringify({ error: message }),
      })
      .run();
    await publishRealtimeEvent(env, room$, {
      status: "FAILED",
      stage: args.type,
      progress: 100,
      message,
    });
    throw err;
  }

  await publishRealtimeEvent(env, room$, {
    status: "PROCESSING",
    stage: args.type,
    progress: 70,
    message: "Uploading result",
  });

  const out = resolved.output;
  const uploaded = out.imageBytes
    ? await uploadBytesToCfImages(env, out.imageBytes, out.mimeType)
    : await uploadFromUrlToCfImages(env, out.imageUrl as string);

  // On a finished full-scale render, auto-generate a mood board from it and link it
  // (so the editing viewport can show the render + its mood board). Non-fatal.
  let moodBoardId: string | null = null;
  if (args.type === "stage_3_LP_finish") {
    try {
      await publishRealtimeEvent(env, room$, {
        status: "PROCESSING",
        stage: args.type,
        progress: 85,
        message: "Generating mood board",
      });
      const mb = await generateMoodBoard({
        env,
        imageUrls: [uploaded.deliveryUrl],
        roomId: room,
        source: "image_edit",
      });
      moodBoardId = mb.id;
    } catch {
      moodBoardId = null; // the render still succeeds even if the mood board fails
    }
  }

  const row = {
    id: canvasId,
    sessionId: args.sessionId,
    roomId: room,
    listingPhotoId: args.listingPhotoId ?? null,
    type: args.type,
    parentCanvasId: args.parentCanvasId ?? null,
    branchLabel,
    lightingProfile,
    prompt: args.prompt,
    provider: resolved.provider,
    model: resolved.resolvedModel,
    outputCfImageId: uploaded.imageId,
    moodBoardId,
    status: "done" as const,
    metadata: JSON.stringify({
      aspectRatio,
      imageSize: DEFAULT_IMAGE_SIZE,
      fallbackTriggered: resolved.fallbackTriggered,
      deliveryUrl: uploaded.deliveryUrl,
    }),
  };

  // Heterogeneous insert statements — drizzle's batch tuple typing is impractical
  // across two tables, so we collect as any[] (matches existing `as any` batch usage).
  const statements: any[] = [db.insert(renderCanvases).values(row)];
  for (const ref of args.inspirationRefs ?? []) {
    statements.push(
      db.insert(canvasInspirationReferences).values({
        canvasId,
        inspirationImageId: ref.inspirationImageId,
        referenceIndex: ref.referenceIndex,
        extractionNotes: ref.extractionNotes ?? null,
        referencedRegionBoundingBox: ref.referencedRegionBoundingBox ?? null,
        extractedCfImageId: ref.extractedCfImageId ?? null,
      }),
    );
  }

  if (statements.length > 1) {
    // Atomic multi-row write (D1 has no interactive transactions).
    await db.batch(statements as [any, ...any[]]);
  } else {
    await statements[0].run();
  }

  await publishRealtimeEvent(env, room$, {
    status: "SUCCESS",
    stage: args.type,
    progress: 100,
    message: "Done",
  });

  return {
    id: canvasId,
    sessionId: args.sessionId,
    type: args.type,
    status: "done",
    provider: resolved.provider,
    model: resolved.resolvedModel,
    outputCfImageId: uploaded.imageId,
    outputDeliveryUrl: uploaded.deliveryUrl,
    parentCanvasId: args.parentCanvasId ?? null,
    branchLabel,
    lightingProfile,
    moodBoardId,
  };
}
