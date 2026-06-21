# Throttled two-phase photo-processing pipeline

- **Date:** 2026-06-18
- **Status:** Approved design, pending spec review
- **Area:** `src/backend/api/routes/images.ts`, `src/backend/services/image-processor/`, `src/_worker.ts`, `wrangler.jsonc`

## Problem

Inspiration/listing photo uploads each spawn their own `ImageProcessingWorkflow`
instance ( `env.IMAGE_PROCESSING_WORKFLOW.create` per file in the upload
handler). A large batch therefore fires ~N instances at once, and they all hit
Workers AI (`env.AI.run`: vision + structured analysis + embedding)
simultaneously. The account's Workers AI capacity is exceeded and returns
`AiError: 3040: Capacity temporarily exceeded` (or a step hangs to the 2-minute
timeout). Production data: a single ~40-image batch stranded 7 images as
`failed`; overall inspirational was 231 processed / 9 failed, with the failures
clustered in batch bursts.

A jitter + longer-retry mitigation was drafted but not deployed. The user wants
a more fundamental fix: **process only 2–3 images through Workers AI at a time
per upload, and make the photo available immediately while AI runs later.**

## Goals

- Phase 1 (immediate): upload to Cloudflare Images + index in D1 so the photo is
  viewable the moment the upload request returns.
- Phase 2 (deferred, throttled): run Workers AI per image, **at most 3 at a time
  per upload**, advancing in waves — finish the current wave (each image with up
  to 3 AI retries) before starting the next.
- A failed image does not block the rest of the batch.
- Reprocess and the auto-heal cron use the same throttle (no new stampede path).

## Non-goals

- A global concurrency cap across all uploads. Scope is **per upload batch**
  (confirmed). Two simultaneous uploads may briefly run up to ~6 AI jobs; that is
  acceptable for this single-admin tool.
- Frontend changes. The existing status polling already covers
  `queued | processing | processed | failed`.
- Any D1 schema change / migration.

## Design

### Phase 1 — upload + index (synchronous, in `POST /api/images/upload`)

Unchanged from today except for the final step:

1. For each uploaded file: upload to Cloudflare Images, derive the delivery URL,
   insert the `images` row, `inspirational_image_rooms` mappings, and the
   `image_upload_staging` row with `processing_status = 'queued'`.
2. **Change:** do **not** call `IMAGE_PROCESSING_WORKFLOW.create` per image.
3. After all rows are inserted, create **one** coordinator workflow for the whole
   upload, passing the per-image params for every successfully-staged image.

The photo is viewable (delivery URL set) and indexed immediately; only the
AI-derived fields (tags, room analysis, embedding/search) fill in during Phase 2.

### Phase 2 — coordinator workflow (the throttle)

New workflow class `ImageBatchProcessingWorkflow`, bound as `IMAGE_BATCH_WORKFLOW`
in `wrangler.jsonc` (additive binding, no migration).

Params:

```ts
interface ImageBatchProcessingWorkflowParams {
  items: ImageProcessingWorkflowParams[]; // existing per-image params, one per image
}
```

Run logic:

- `WAVE_SIZE = 3`.
- Split `items` into waves of `WAVE_SIZE`.
- Process waves **sequentially with a barrier**:
  ```
  for (const wave of chunk(items, WAVE_SIZE)) {
    await Promise.all(wave.map((item) => runImageProcessingSteps(step, env, item)));
  }
  ```
  Each wave fully settles before the next begins — this is the "once the batch
  finishes, proceed with the next images" behavior.
- `runImageProcessingSteps` runs the existing per-image steps (mark-processing-
  started → load-context → vision → structured-analysis → persist → embedding →
  upsert-vector → mark-processed), with **step names suffixed by image id** so a
  wave's three concurrent images don't collide, and AI steps configured
  `retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }`,
  `timeout: "2 minutes"`.
- Per-image failure is caught **inside** `runImageProcessingSteps`: it marks that
  image `failed` (writes `processing_error`) and **resolves** (does not reject),
  so `Promise.all` never rejects and one bad image cannot abort the wave or the
  rest of the batch.

### Shared per-image step logic (refactor)

Extract the per-image step body currently inside `ImageProcessingWorkflow.run()`
into:

```ts
async function runImageProcessingSteps(
  step: WorkflowStep,
  env: Env,
  params: ImageProcessingWorkflowParams,
): Promise<{ imageId: string; status: "processed" | "failed" }>
```

- All `step.do` names are suffixed with `params.imageId` (e.g.
  `vision-description:${imageId}`).
- Internally try/catch → on failure, run the `mark-failed` step and return
  `{ status: "failed" }` (no rethrow).
- `ImageProcessingWorkflow` (the existing per-image class/binding) becomes a thin
  wrapper that calls `runImageProcessingSteps` for its single image, so existing
  bindings and any in-flight instances keep working. `ImageBatchProcessingWorkflow`
  calls it per item inside the wave `Promise.all`.

This keeps one implementation of the AI pipeline and removes duplication.

### Reprocess + auto-heal route through the coordinator

- `POST /api/images/mapping/reprocess` (`images.ts`) builds the per-image params
  for the requested ids and creates **one** `IMAGE_BATCH_WORKFLOW` instance
  instead of N per-image workflows — so "reprocess 40 failed" can't restampede.
- `autoHealImageUploads` (`src/backend/services/image-processor/auto-heal.ts`)
  likewise creates one coordinator for the ≤5 rows it re-queues per tick.

### Status contract (unchanged)

The frontend polls `GET /api/images?photoCategory=…&ids=…` and reads
`image_upload_staging.processing_status`. Images appear immediately (Phase 1);
each row transitions `queued → processing → processed | failed` as the coordinator
reaches it. No frontend change.

## Reconciliation with the not-yet-deployed mitigation

The earlier (undeployed) working-tree changes are revised:

- **Drop** `computeStartJitterMs` + the `stagger-ai-start` `step.sleep` — pointless
  once processing is 3-at-a-time.
- Set AI retries to **3** (was bumped to 6).
- **Keep** `autoHealImageUploads` + its every-minute cron wiring as a backstop for
  transiently-failed / stuck rows, now creating a coordinator instead of per-image
  workflows.

## Edge cases & constraints

- **Workflow step ceiling.** ~6–7 persisted steps per image; Cloudflare caps steps
  per instance (~1k). A single coordinator safely handles roughly ≤150 images. For
  an upload larger than `MAX_COORDINATOR_ITEMS` (set to 100 for margin), the
  coordinator processes the first chunk and then creates a follow-up coordinator
  for the remainder (sequential, never concurrent) so the per-upload 3-at-a-time
  cap is preserved. Realistic uploads are far smaller; this is a safety valve.
- **Idempotency.** Workflow steps are memoized by name across replays; suffixing by
  image id keeps wave steps independent. Re-running an already-processed image is
  harmless (it overwrites the same row).
- **Empty/partial batches.** If Phase 1 staged zero images, no coordinator is
  created. Images that fail to upload to Cloudflare Images in Phase 1 are not added
  to the coordinator items.

## Error handling

- Phase 1 per-file upload error → that file is reported failed in the HTTP
  response and excluded from the coordinator (existing behavior preserved).
- Coordinator create() failure → mark the staged rows `failed` with the error (as
  the current upload handler already does on workflow-create failure).
- Per-image AI failure after 3 retries → row marked `failed` with
  `processing_error`; batch continues; auto-heal may retry later.

## Testing / verification

- Unit-ish: a `chunk(items, size)` helper test (wave splitting, remainder).
- Build: `pnpm run build` succeeds; `oxlint` clean on changed files.
- Manual (post-deploy): upload a batch of ~10 inspirational photos; observe via
  `image_upload_staging` (D1 `core-remodel`) that at most 3 are `processing` at
  once and they advance in waves; all reach `processed`. Confirm a single upload
  returns immediately with rows `queued`.
- Negative: temporarily small `WAVE_SIZE`/forced error to confirm one failed image
  doesn't abort the batch.

## Deployment

No D1 migration. Adds the `IMAGE_BATCH_WORKFLOW` workflow binding to
`wrangler.jsonc`. Deploy with `wrangler deploy` only — **not** `pnpm run deploy`
(which runs `migrate:remote` against the known-broken journal). See the
deploy-process memory note.

## Decisions (locked)

- Concurrency scope: **per upload batch**.
- Wave size: **3**; barrier waves (wait for all in a wave).
- Retries: **3** per image, 2-minute timeout.
- New `IMAGE_BATCH_WORKFLOW` binding (don't repurpose the existing one).
- Keep auto-heal cron as a backstop.
