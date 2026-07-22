/**
 * @fileoverview Health probes for the render module
 * (`src/backend/services/render`) — virtual staging, blank-canvas generation and
 * the Fal / Replicate / Gemini stage providers.
 *
 * COST DISCIPLINE. Image generation is the single most expensive thing this
 * Worker does, so nothing here generates an image, uploads to Cloudflare Images,
 * or pings a provider API. The probes read Secrets Store bindings and count rows
 * in `render_canvases` / `blank_canvas_generation_jobs`. A stuck render is
 * detected from the ledger, never by re-running the render.
 */

import {
  defineProbe,
  degraded,
  failure,
  ok,
  readSecret,
  scalar,
  tableExists,
  type HealthProbe,
} from "@backend/services/health/types";

const FILE = "src/backend/services/render/health.ts";

/** A stage canvas still `pending` after this long is stuck, not slow. */
const STUCK_CANVAS_MINUTES = 30;
/** A blank-canvas batch job still `running` after this long is stuck. */
const STUCK_JOB_MINUTES = 60;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "render_provider_keys_present",
    displayName: "Render provider keys readable",
    description:
      "Reads the FAL_API_KEY and REPLICATE_API_TOKEN Secrets Store bindings and asserts each returns a non-empty value. Presence only — no Fal or Replicate request is made, because both bill per generation.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store"],
    whatSuccessMeans:
      "Both third-party render providers can authenticate. `FalStageProvider` and `ReplicateStageProvider` route through the AI Gateway at `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/{fal,replicate}/...` and attach these credentials; with both present, the failover chain in `failover.ts` has somewhere to go when the primary provider errors.",
    whatFailureMeans:
      "Both keys are missing, so every non-Gemini render stage throws on its first call and the failover chain has no fallback left. Renders either fail outright or silently collapse onto the Gemini provider, which changes the visual output — a render that 'looks different' rather than 'is broken' is the failure mode to watch for. One key missing is DEGRADED: the pipeline still runs, but with no redundancy. As with every Secrets Store binding, this ALWAYS fails under `wrangler dev`; only a run against the deployed Worker means anything.",
    troubleshootingSteps:
      "1. The details name which key is missing. Check it in the Cloudflare dashboard under Workers & Pages > Secrets Store and with `npx wrangler secret list`. 2. Confirm the matching `secrets_store_secrets` entry in `wrangler.jsonc` — a declared binding for a secret that does not exist fails the DEPLOY (error 10182), so a live worker failing here means the secret was removed after deploy. 3. Mint a replacement at fal.ai/dashboard/keys or replicate.com/account/api-tokens, store it, then `pnpm run deploy` — secret bindings do not refresh without a deploy. 4. If the key is present but calls 401, this probe stays green: the truth is in `render_canvases.metadata` (which records resolvedProvider/model and whether failover triggered) and in `npx wrangler tail`. 5. Note both providers also need CLOUDFLARE_ACCOUNT_ID to build the gateway URL — that is covered by the CF Images probe on this page.",
    devOpsPlaybook:
      "1. Confirm the run targeted production, not local. 2. Recreate the missing secret in the Secrets Store, then `pnpm run deploy`. 3. Verify recovery by running one render stage and checking the new `render_canvases` row lands with `status='done'` and the expected `provider`. 4. A single missing key is not a page — the remaining provider carries the load — but fix it before the next batch run, because a batch with no failover turns one provider hiccup into a wholly failed job.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const [fal, replicate] = await Promise.all([
        readSecret(env.FAL_API_KEY),
        readSecret(env.REPLICATE_API_TOKEN),
      ]);
      if (!fal && !replicate) {
        return failure(
          "Both FAL_API_KEY and REPLICATE_API_TOKEN are missing/unreadable — no third-party render provider can authenticate and failover has nowhere to go.",
        );
      }
      if (!fal) {
        return degraded(
          "FAL_API_KEY missing/unreadable; REPLICATE_API_TOKEN present. Renders run without Fal failover.",
        );
      }
      if (!replicate) {
        return degraded(
          "REPLICATE_API_TOKEN missing/unreadable; FAL_API_KEY present. Renders run without Replicate failover.",
        );
      }
      return ok(
        `FAL_API_KEY (${fal.length} chars) and REPLICATE_API_TOKEN (${replicate.length} chars) both readable.`,
      );
    },
  }),

  defineProbe({
    name: "render_cf_images_credentials",
    displayName: "Cloudflare Images credentials + binding",
    description:
      "Asserts the `IMAGES` transform binding is attached and that Cloudflare Images credentials read back: CLOUDFLARE_ACCOUNT_ID (also required to build every AI Gateway URL) plus at least one of CLOUDFLARE_IMAGES_STREAM_TOKEN / CF_IMAGES_TOKEN. No upload or transform is performed.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["images", "secrets_store"],
    whatSuccessMeans:
      "The `IMAGES` binding is present for local transforms (`info()`, `input().transform().output()`) and the Images REST credentials exist for upload/delivery. Every render stage can read its input image, write its output, and return a Cloudflare Images id for `render_canvases.output_cf_image_id`. The account id being readable additionally means the Fal and Replicate gateway URLs will resolve.",
    whatFailureMeans:
      "Renders cannot store or read their images. Missing CLOUDFLARE_ACCOUNT_ID is the worst case: it breaks Images AND makes every AI Gateway URL resolve to `.../v1/undefined/...`, so Fal and Replicate 404 too — one missing secret takes out the whole render path. A missing `IMAGES` binding breaks the native transform helpers (dimension reads, trims) that the blank-canvas pipeline depends on.",
    troubleshootingSteps:
      "1. Read the details to see which piece is missing. 2. `IMAGES` binding: confirm the `images` block in `wrangler.jsonc` binds `IMAGES`, then `npx wrangler deployments list | tail -20` to be sure the live version matches the config. 3. Credentials: check Workers & Pages > Secrets Store in the Cloudflare dashboard. `src/backend/utils/secrets.ts` tries CLOUDFLARE_IMAGES_STREAM_TOKEN, then CLOUDFLARE_API_TOKEN, then CLOUDFLARE_WORKER_ADMIN_TOKEN, then CLOUDFLARE_WRANGLER_API_TOKEN — so a green probe may be running on a fallback token, which is worth tidying even though it works. 4. The Images token needs Cloudflare Images read+write scope; a scope-limited token reads fine here and 403s on upload. 5. After replacing any secret, `pnpm run deploy` — bindings do not refresh otherwise.",
    devOpsPlaybook:
      "1. Missing CLOUDFLARE_ACCOUNT_ID is a P1: it takes out renders, Images and the AI Gateway providers simultaneously. Restore it first, `pnpm run deploy`, re-run this probe AND the ai-gateway probes. 2. Missing Images token: restore the secret, deploy, then verify by running one render stage end to end and confirming `output_cf_image_id` is populated on the new `render_canvases` row. 3. Missing `IMAGES` binding: config fix, PR, merge, `pnpm run deploy`. 4. If credentials are present but uploads 403, the token scope is wrong — reissue with Cloudflare Images permissions rather than re-creating the same token.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const [accountId, streamToken, cfImagesToken] = await Promise.all([
        readSecret(env.CLOUDFLARE_ACCOUNT_ID),
        readSecret(env.CLOUDFLARE_IMAGES_STREAM_TOKEN),
        readSecret(env.CF_IMAGES_TOKEN),
      ]);
      const hasBinding = Boolean(env.IMAGES);

      const missing: string[] = [];
      if (!hasBinding) missing.push("`IMAGES` transform binding");
      if (!accountId) missing.push("CLOUDFLARE_ACCOUNT_ID (also breaks every AI Gateway URL)");
      if (!streamToken && !cfImagesToken) {
        missing.push("an Images API token (CLOUDFLARE_IMAGES_STREAM_TOKEN or CF_IMAGES_TOKEN)");
      }

      if (missing.length > 0) {
        return failure(`Render image path is broken — missing: ${missing.join("; ")}.`);
      }
      const which = [
        streamToken ? "CLOUDFLARE_IMAGES_STREAM_TOKEN" : null,
        cfImagesToken ? "CF_IMAGES_TOKEN" : null,
      ]
        .filter(Boolean)
        .join(" + ");
      return ok(`IMAGES binding present; CLOUDFLARE_ACCOUNT_ID readable; token(s): ${which}.`);
    },
  }),

  defineProbe({
    name: "render_canvas_backlog",
    displayName: "Render stage backlog",
    description:
      "Counts `render_canvases` rows still `status='pending'` more than 30 minutes after creation, and the 24h failure rate across all stages. A single aggregate query per figure — no renders are re-run.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "No stage canvas has been sitting in `pending` for over half an hour and recent stages are mostly completing. The stage runner is picking work up and writing terminal statuses back, so the render tree for each session is actually advancing rather than accumulating orphans.",
    whatFailureMeans:
      "Stages are entering `pending` and never reaching `done` or `failed`. That is worse than an outright failure: the row looks like work in progress forever, the session's hero canvas never resolves, and the UI shows a spinner rather than an error. The usual causes are a provider call that hung past the Worker's limits (so nothing ever wrote the terminal status), a stage runner that threw between the insert and the update, or a provider key/gateway problem — check the provider-key and Images probes on this page first, since a stuck backlog is often their downstream symptom.",
    troubleshootingSteps:
      "1. See what is stuck and on which provider: `npx wrangler d1 execute core-remodel --remote --command \"SELECT id, session_id, type, provider, model, status, datetime_created FROM render_canvases WHERE status='pending' AND datetime_created < unixepoch() - 1800 ORDER BY datetime_created LIMIT 20\"`. 2. If one `provider` dominates, the problem is that provider, not the pipeline — check its key probe and whether failover triggered (`metadata` records resolvedProvider/model/fallbackTriggered). 3. Look at the failed rows for the real error text: same query with `status='failed'`. 4. Re-drive through the normal path (`run_render_stage` / the render UI) rather than hand-editing statuses in D1 — a hand-set `done` with no output image produces a broken canvas node that the tree will happily build on. 5. If the whole table is missing, that is a deploy-order fault: `pnpm run migrate:remote`, verify, then re-check.",
    devOpsPlaybook:
      "1. Check the provider-key and CF Images probes before touching the backlog — most render stalls are a credential problem wearing a queue's clothes. 2. Identify the dominant provider/stage type from the query above. 3. Fix the underlying cause, `pnpm run deploy`, then re-drive the stuck canvases through the normal stage runner. 4. Do NOT bulk-update statuses in D1 to clear the alert; that hides the orphans instead of resolving them and the render tree keeps referencing nodes with no output image. 5. Re-run this probe once the re-drive completes and confirm the pending count returns to zero.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const db = env.DB;
      if (!(await tableExists(db, "render_canvases"))) {
        return failure(
          "Table `render_canvases` does not exist — unapplied migration. Run `pnpm run migrate:remote`.",
        );
      }
      const stuck = await scalar(
        db,
        `SELECT COUNT(*) FROM render_canvases WHERE status = 'pending' AND datetime_created < unixepoch() - ${STUCK_CANVAS_MINUTES * 60}`,
      );
      const recent = await scalar(
        db,
        "SELECT COUNT(*) FROM render_canvases WHERE datetime_created >= unixepoch() - 86400",
      );
      const recentFailed = await scalar(
        db,
        "SELECT COUNT(*) FROM render_canvases WHERE status = 'failed' AND datetime_created >= unixepoch() - 86400",
      );
      const failPct = recent > 0 ? Math.round((recentFailed / recent) * 100) : 0;
      const detail = `${stuck} canvas(es) pending for over ${STUCK_CANVAS_MINUTES} min; last 24h: ${recentFailed}/${recent} stages failed (${failPct}%).`;

      if (stuck > 20 || failPct > 50) return failure(detail);
      if (stuck > 0 || failPct >= 20) return degraded(detail);
      return ok(detail);
    },
  }),

  defineProbe({
    name: "render_blank_canvas_job_backlog",
    displayName: "Blank-canvas batch job backlog",
    description:
      "Counts `blank_canvas_generation_jobs` still `running` more than 60 minutes after creation, plus their unfinished items in `blank_canvas_generation_job_items`. These jobs run inside a Cloudflare Workflow, so a stuck job means the Workflow instance stopped advancing.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1", "workflow"],
    whatSuccessMeans:
      "No blank-canvas batch has been running for over an hour. The Workflow that drives the batch is stepping through its items and writing status back to D1 — which is the whole reason this state lives in D1 rather than an in-memory map: isolates do not share memory and a redeploy used to wipe every in-flight job.",
    whatFailureMeans:
      "A batch job is stalled. The Workflow instance either failed in a way that never wrote a terminal status, or is retrying a step indefinitely. Users see a progress bar that never completes and, because the admin action is idempotent-looking, the natural response is to click 'Generate' again — which starts a SECOND batch over the same photos and doubles the image-generation spend. That is the expensive part of this failure.",
    troubleshootingSteps:
      "1. Find the stalled jobs and their item breakdown: `npx wrangler d1 execute core-remodel --remote --command \"SELECT j.id, j.status, j.created_at, j.updated_at, i.status item_status, COUNT(*) c FROM blank_canvas_generation_jobs j JOIN blank_canvas_generation_job_items i ON i.job_id = j.id WHERE j.status='running' GROUP BY 1,2,3,4,5\"`. 2. Inspect the Workflow itself: `npx wrangler workflows instances list <workflow-name>` and `npx wrangler workflows instances describe <workflow-name> <id>` — workflow names are ACCOUNT-scoped and suffixed per preview branch, so make sure you are looking at production's. 3. Item rows carry an `error` column — read it before assuming infrastructure. 4. Do not re-trigger the batch to 'unstick' it: that starts a parallel run over the same photos and pays for every generation twice. 5. If `updated_at` is advancing the job is slow, not stuck — raise the threshold expectation rather than intervening.",
    devOpsPlaybook:
      "1. Confirm stuck vs slow using `updated_at` before doing anything. 2. Inspect and, if genuinely dead, terminate the Workflow instance with wrangler rather than leaving it to retry. 3. Mark the job `failed` through the application path so the UI stops showing an in-flight batch, then re-run only the items that never completed — never the whole batch. 4. If the underlying cause was a provider or Images credential problem, fix that first (see the other probes on this page) or the re-run stalls identically. 5. Watch the AI spend probes on /admin/health afterwards: a duplicated batch shows up there as a same-day spike.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const db = env.DB;
      if (!(await tableExists(db, "blank_canvas_generation_jobs"))) {
        return failure(
          "Table `blank_canvas_generation_jobs` does not exist — unapplied migration. Run `pnpm run migrate:remote`.",
        );
      }
      const stuckJobs = await scalar(
        db,
        `SELECT COUNT(*) FROM blank_canvas_generation_jobs WHERE status = 'running' AND created_at < unixepoch() - ${STUCK_JOB_MINUTES * 60}`,
      );
      if (stuckJobs === 0) {
        const running = await scalar(
          db,
          "SELECT COUNT(*) FROM blank_canvas_generation_jobs WHERE status = 'running'",
        );
        return ok(
          `No blank-canvas job running longer than ${STUCK_JOB_MINUTES} min (${running} currently running).`,
        );
      }
      const stuckItems = (await tableExists(db, "blank_canvas_generation_job_items"))
        ? await scalar(
            db,
            `SELECT COUNT(*) FROM blank_canvas_generation_job_items i JOIN blank_canvas_generation_jobs j ON j.id = i.job_id WHERE j.status = 'running' AND j.created_at < unixepoch() - ${STUCK_JOB_MINUTES * 60} AND i.status IN ('pending','processing')`,
          )
        : -1;
      const detail = `${stuckJobs} blank-canvas job(s) running for over ${STUCK_JOB_MINUTES} min, with ${stuckItems < 0 ? "an unknown number of" : stuckItems} unfinished item(s). Do NOT re-trigger the batch — that duplicates every generation.`;
      return stuckJobs > 2 ? failure(detail) : degraded(detail);
    },
  }),
];
