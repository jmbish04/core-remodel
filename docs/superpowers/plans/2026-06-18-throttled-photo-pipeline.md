# Throttled Two-Phase Photo Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make photo uploads index instantly, then process Workers AI per upload at most 3 images at a time (in waves, 3 retries each), so large batches stop tripping `AiError: 3040` capacity failures.

**Architecture:** Keep Phase 1 (Cloudflare Images upload + D1 insert with `processing_status='queued'`) synchronous in the upload handler. Replace the per-image `IMAGE_PROCESSING_WORKFLOW.create` calls with a single per-upload coordinator workflow (`ImageBatchProcessingWorkflow`) that processes images in barrier waves of 3, reusing the existing per-image step pipeline via a shared `runImageProcessingSteps` function. Reprocess and the auto-heal cron route through the same coordinator.

**Tech Stack:** Cloudflare Workers, Cloudflare Workflows (`cloudflare:workers`), Drizzle ORM on D1, Hono, oxlint, Astro build.

**Verification model (read first):** This repo has no unit-test runner (no vitest/tsx) and Workflow/DO code can't be unit-tested without `@cloudflare/vitest-pool-workers` (out of scope). Each task therefore verifies with `pnpm run build` (expect `Complete!`), `npx oxlint <files>` (expect `0 warnings and 0 errors`), and—where noted—a manual D1/observability check. Do not add a test framework.

**Deploy note (applies to the whole plan):** No D1 migration is involved. Deploy with `npx wrangler@latest deploy` only — never `pnpm run deploy` (it runs `migrate:remote` against the known-broken Drizzle journal).

---

## File Structure

- **Modify** `src/backend/services/image-processor/workflow.ts` — extract the per-image step pipeline into an exported `runImageProcessingSteps(step, env, params)`; drop the start-jitter; set AI retries to 3; make `ImageProcessingWorkflow` a thin wrapper. (Owns: single-image AI processing steps.)
- **Create** `src/backend/services/image-processor/batch-workflow.ts` — `ImageBatchProcessingWorkflow` coordinator: wave loop (3 at a time, barrier), overflow chaining, `chunk` helper. (Owns: per-upload throttling.)
- **Modify** `src/_worker.ts` — export `ImageBatchProcessingWorkflow`. (Auto-heal cron wiring already present.)
- **Modify** `wrangler.jsonc` — add the `IMAGE_BATCH_WORKFLOW` workflow binding.
- **Regenerate** `worker-configuration.d.ts` — via `pnpm run cf-typegen` so `Env.IMAGE_BATCH_WORKFLOW` exists.
- **Modify** `src/backend/api/routes/images.ts` — upload handler creates one coordinator after the file loop; reprocess endpoint creates one coordinator.
- **Modify** `src/backend/services/image-processor/auto-heal.ts` — create one coordinator for the ≤5 healed rows.

---

## Task 1: Refactor `workflow.ts` — extract shared step pipeline, drop jitter, retries→3

**Files:**
- Modify: `src/backend/services/image-processor/workflow.ts`

- [ ] **Step 1: Replace the `AI_STEP_RETRY` config and delete the jitter helper**

Replace the entire current `AI_STEP_RETRY` comment+const block AND the `computeStartJitterMs` function (added earlier, lines ~143–185) with exactly this:

```ts
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
```

(There is no `computeStartJitterMs` in the final file. It is removed.)

- [ ] **Step 2: Introduce the shared `runImageProcessingSteps` function**

Convert the body of `ImageProcessingWorkflow.run()` into a new exported standalone function. Add this function definition immediately above the `ImageProcessingWorkflow` class:

```ts
export async function runImageProcessingSteps(
  step: WorkflowStep,
  env: Env,
  params: ImageProcessingWorkflowParams,
): Promise<{ imageId: string; status: "processed" | "failed" }> {
  // Body: the run() try/catch moved here verbatim, transformed per the edits below.
}
```

Move the **entire current `try { ... } catch { ... }` body** of `run()` into this function. The function's `params` argument replaces the old `const params = event.payload;` line (that line is NOT carried over). Apply these mechanical edits:

1. Replace every `this.env` with `env`.
2. **Delete** the `stagger-ai-start` `step.sleep(...)` call (added earlier, right after the `mark-processing-started` step). It no longer exists.
3. Suffix every `step.do` / `step.sleep` name with `:${params.imageId}`. The complete set of renames:
   - `"mark-processing-started"` → `` `mark-processing-started:${params.imageId}` ``
   - `"load-image-context"` → `` `load-image-context:${params.imageId}` ``
   - `"vision-description"` → `` `vision-description:${params.imageId}` ``
   - `"structured-analysis"` → `` `structured-analysis:${params.imageId}` ``
   - `"persist-analysis"` → `` `persist-analysis:${params.imageId}` ``
   - `"generate-embedding"` → `` `generate-embedding:${params.imageId}` ``
   - `"upsert-vector"` → `` `upsert-vector:${params.imageId}` ``
   - `"mark-processed"` → `` `mark-processed:${params.imageId}` ``
   - `"mark-failed"` → `` `mark-failed:${params.imageId}` ``
4. The success path (where `run()` previously did `return { success: true, imageId: params.imageId };`) becomes:
   ```ts
   return { imageId: params.imageId, status: "processed" };
   ```
5. In the `catch (error)` block, **remove the trailing `throw error;`** and end with:
   ```ts
   return { imageId: params.imageId, status: "failed" };
   ```
   (Keep the existing `mark-failed:${params.imageId}` step that updates the row and publishes the realtime "failed" event — only the rethrow is removed.)

- [ ] **Step 3: Reduce `ImageProcessingWorkflow.run()` to a thin wrapper**

Replace the `ImageProcessingWorkflow` class body with:

```ts
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
```

- [ ] **Step 4: Verify build + lint**

Run: `pnpm run build`
Expected: ends with `[build] Complete!`, no error output.

Run: `npx oxlint src/backend/services/image-processor/workflow.ts`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/image-processor/workflow.ts
git commit -m "refactor(image-processor): extract runImageProcessingSteps; retries=3; drop jitter"
```

---

## Task 2: Create the `ImageBatchProcessingWorkflow` coordinator + binding

**Files:**
- Create: `src/backend/services/image-processor/batch-workflow.ts`
- Modify: `src/_worker.ts`
- Modify: `wrangler.jsonc`
- Regenerate: `worker-configuration.d.ts`

- [ ] **Step 1: Write the coordinator**

Create `src/backend/services/image-processor/batch-workflow.ts` with exactly:

```ts
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
    const allItems = event.payload.items ?? [];
    const items = allItems.slice(0, MAX_COORDINATOR_ITEMS);
    const overflow = allItems.slice(MAX_COORDINATOR_ITEMS);

    let processed = 0;
    let failed = 0;

    for (const wave of chunk(items, WAVE_SIZE)) {
      const results = await Promise.all(
        wave.map((item) => runImageProcessingSteps(step, this.env, item)),
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
        await this.env.IMAGE_BATCH_WORKFLOW.create({
          id: `image-batch-cont-${crypto.randomUUID()}`,
          params: { items: overflow },
        });
        return { chained: overflow.length };
      });
    }

    return { success: true, processed, failed };
  }
}
```

- [ ] **Step 2: Export the coordinator from the worker entry**

In `src/_worker.ts`, add this export next to the existing `ImageProcessingWorkflow` export (near line 21):

```ts
export { ImageBatchProcessingWorkflow } from "./backend/services/image-processor/batch-workflow";
```

- [ ] **Step 3: Add the workflow binding in `wrangler.jsonc`**

In the `"workflows"` array, after the existing `image-processing-workflow` entry, add:

```jsonc
    {
      "name": "image-batch-processing-workflow",
      "binding": "IMAGE_BATCH_WORKFLOW",
      "class_name": "ImageBatchProcessingWorkflow",
    },
```

- [ ] **Step 4: Regenerate the Env types**

Run: `pnpm run cf-typegen`
Then verify the binding exists:
Run: `grep -n "IMAGE_BATCH_WORKFLOW" worker-configuration.d.ts`
Expected: one line like `IMAGE_BATCH_WORKFLOW: Workflow<...ImageBatchProcessingWorkflow['run']...>;`

- [ ] **Step 5: Verify build + lint**

Run: `pnpm run build`
Expected: ends with `[build] Complete!`.

Run: `npx oxlint src/_worker.ts src/backend/services/image-processor/batch-workflow.ts`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 6: Commit**

```bash
git add src/backend/services/image-processor/batch-workflow.ts src/_worker.ts wrangler.jsonc worker-configuration.d.ts
git commit -m "feat(image-processor): add ImageBatchProcessingWorkflow coordinator + binding"
```

---

## Task 3: Upload handler creates one coordinator (not N per-image workflows)

**Files:**
- Modify: `src/backend/api/routes/images.ts` (upload handler `POST /api/images/upload`, the `for (const file of files)` loop ~779–976 and the lines just after it)

- [ ] **Step 1: Declare the batch accumulator before the loop**

Just before `const results: UploadResult[] = [];` (currently line ~776), add:

```ts
    const batchItems: ImageProcessingWorkflowParams[] = [];
```

- [ ] **Step 2: Replace the per-image workflow create with accumulation**

Replace the current block that builds `workflowParams` and creates the workflow (the `const workflowParams ... try { await c.env.IMAGE_PROCESSING_WORKFLOW.create(...) } catch (...) { ... continue; }` and the trailing success `results.push`, currently lines ~922–965) with exactly:

```ts
        const workflowParams: ImageProcessingWorkflowParams = {
          imageId,
          photoCategory,
          isListingPhoto,
          filename,
          roomId: selectedRoom?.id ?? null,
          roomIds: selectedInspirationalRoomIds,
          roomHint,
        };
        batchItems.push(workflowParams);

        results.push({
          success: true,
          imageId,
          workflowInstanceId,
          processingStatus: "queued",
          image: insertedImage ?? null,
        });
```

- [ ] **Step 3: Create the coordinator after the loop**

Immediately after the `for (const file of files) { ... }` loop closes (currently the `}` on line ~976) and before `const successCount = ...`, insert:

```ts
    if (batchItems.length > 0) {
      try {
        await c.env.IMAGE_BATCH_WORKFLOW.create({
          id: `image-batch-${crypto.randomUUID()}`,
          params: { items: batchItems },
        });
      } catch (batchError) {
        const message =
          batchError instanceof Error
            ? batchError.message
            : "Failed to queue batch workflow";
        const failedIds = new Set(batchItems.map((item) => item.imageId));
        await db
          .update(imageUploadStaging)
          .set({ processingStatus: "failed", processingError: message })
          .where(inArray(imageUploadStaging.imageId, Array.from(failedIds)))
          .run();
        for (let i = 0; i < results.length; i += 1) {
          const r = results[i];
          if (r.success && failedIds.has(r.imageId)) {
            results[i] = { success: false, imageId: r.imageId, error: message };
          }
        }
      }
    }
```

(`inArray` and `ImageProcessingWorkflowParams` are already imported in this file.)

- [ ] **Step 4: Verify build + lint**

Run: `pnpm run build`
Expected: `[build] Complete!`.

Run: `npx oxlint src/backend/api/routes/images.ts`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 5: Commit**

```bash
git add src/backend/api/routes/images.ts
git commit -m "feat(images): upload enrolls a single throttled batch workflow"
```

---

## Task 4: Reprocess endpoint routes through the coordinator

**Files:**
- Modify: `src/backend/api/routes/images.ts` (`POST /api/images/mapping/reprocess`, currently ~1586–1654)

- [ ] **Step 1: Replace the per-image create loop with one coordinator**

Replace the block starting at `let successCount = 0;` through the end of the `for (const image of targetImages) { ... }` loop and its return (currently ~1586–1654) with exactly:

```ts
    const batchItems: ImageProcessingWorkflowParams[] = [];
    for (const image of targetImages) {
      const imageId = image.id;
      const categoryRaw = toMappingCategory(
        image.photoCategory,
        image.isListingPhoto,
      );
      batchItems.push({
        imageId,
        photoCategory: categoryRaw,
        isListingPhoto: image.isListingPhoto,
        filename: image.sourceFilename || "image.jpg",
        roomId: image.roomId,
        roomIds: roomIdsByImage.get(imageId) || [],
        roomHint: image.roomType,
      });
    }

    const batchInstanceId = `image-batch-re-${Date.now()}`;
    const batchImageIds = batchItems.map((item) => item.imageId);

    try {
      await c.env.IMAGE_BATCH_WORKFLOW.create({
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

      return c.json({
        success: true,
        message: `Successfully queued ${batchImageIds.length} image(s) for reprocessing.`,
        successCount: batchImageIds.length,
        failures: [],
      });
    } catch (workflowError) {
      const message =
        workflowError instanceof Error
          ? workflowError.message
          : "Failed to queue workflow";
      await db
        .update(imageUploadStaging)
        .set({ processingStatus: "failed", processingError: message })
        .where(inArray(imageUploadStaging.imageId, batchImageIds))
        .run();
      return c.json(
        { error: "Failed to reprocess workflow(s)", details: message },
        500,
      );
    }
```

(This removes the old `failures` array and per-image `buildWorkflowInstanceId(...)-re-${Date.now()}` create. `buildWorkflowInstanceId` may now be unused — if oxlint flags it as unused in Step 2, delete its definition near line 363.)

- [ ] **Step 2: Verify build + lint**

Run: `pnpm run build`
Expected: `[build] Complete!`.

Run: `npx oxlint src/backend/api/routes/images.ts`
Expected: `Found 0 warnings and 0 errors.` (If it reports `buildWorkflowInstanceId` unused, delete that function and re-run until clean.)

- [ ] **Step 3: Commit**

```bash
git add src/backend/api/routes/images.ts
git commit -m "feat(images): reprocess routes through throttled batch workflow"
```

---

## Task 5: Auto-heal cron routes through the coordinator

**Files:**
- Modify: `src/backend/services/image-processor/auto-heal.ts` (the per-row create loop and trailing log)

- [ ] **Step 1: Replace the per-image create loop with one coordinator**

Replace everything from `let healed = 0;` through the final `if (healed > 0) { ... }` block with exactly:

```ts
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
```

(`inArray` and `ImageProcessingWorkflowParams` are already imported in `auto-heal.ts`. The per-image `IMAGE_PROCESSING_WORKFLOW.create` and the `image-processing-${row.imageId}-re-${now}` id are removed.)

- [ ] **Step 2: Verify build + lint**

Run: `pnpm run build`
Expected: `[build] Complete!`.

Run: `npx oxlint src/backend/services/image-processor/auto-heal.ts`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 3: Commit**

```bash
git add src/backend/services/image-processor/auto-heal.ts
git commit -m "feat(image-processor): auto-heal re-queues via throttled batch workflow"
```

---

## Task 6: Full verification + deploy + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full build + lint of all changed files**

Run: `pnpm run build`
Expected: `[build] Complete!`.

Run: `npx oxlint src/_worker.ts src/backend/api/routes/images.ts src/backend/services/image-processor/workflow.ts src/backend/services/image-processor/batch-workflow.ts src/backend/services/image-processor/auto-heal.ts`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 2: Deploy (no migration)**

Run: `cp .assetsignore dist/.assetsignore && npx wrangler@latest deploy`
Expected: wrangler reports the new version deployed and lists both `IMAGE_PROCESSING_WORKFLOW` and `IMAGE_BATCH_WORKFLOW` workflow bindings.

- [ ] **Step 3: Manual smoke test — throttling holds**

Upload a batch of ~10 inspirational photos through the app. While it runs, poll the staging table (D1 `core-remodel`, id `4811af1e-202d-4b96-99e2-d98dc45c597e`) a few times:

```sql
SELECT processing_status, COUNT(*) AS n
FROM image_upload_staging
WHERE datetime_created >= unixepoch() - 600
GROUP BY processing_status;
```

Expected: at any single poll, **`processing` count is ≤ 3**; rows move `queued → processing → processed` in waves; final state has all of that batch `processed` and **no `failed`** rows from this upload.

- [ ] **Step 4: Manual smoke test — immediate Phase 1**

Confirm the upload HTTP response returns promptly (before AI finishes) and the just-uploaded photos are visible in the gallery with a processing badge, then flip to done as Phase 2 completes.

- [ ] **Step 5: Verify the cron auto-heal still creates a batch (optional)**

After deploy, within a couple of minutes check logs for any `autoHealImageUploads:` line, or confirm no `failed` transient rows linger:

```sql
SELECT image_id, processing_status, substr(processing_error,1,60) AS err
FROM image_upload_staging
WHERE processing_status = 'failed' AND datetime_created >= unixepoch() - 86400;
```

Expected: transient (`3040` / `timed out`) failures get re-queued and clear on their own; only non-transient failures (if any) remain.

---

## Notes for the executor

- Keep `ImageProcessingWorkflow` (single-image) — it stays as the thin wrapper so its binding and any in-flight instances survive deploy. Only the *callers* (upload, reprocess, auto-heal) switch to `IMAGE_BATCH_WORKFLOW`.
- The coordinator depends on `runImageProcessingSteps` never rejecting (it catches per-image failures and returns `status: "failed"`). If you ever make it rethrow, `Promise.all` in a wave would abort the rest of the batch — don't.
- Do not add a test framework or change the Drizzle journal/migrations.
