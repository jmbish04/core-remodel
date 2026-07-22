/**
 * @fileoverview Health probes for the image-processor module (upload → staging →
 * AI extraction → mapped photo).
 *
 * This is where silent failure lives. An image upload that fails AI extraction
 * writes its reason to `image_upload_staging.processing_error` and NOWHERE ELSE —
 * no endpoint 500s, no log the user will ever see, and the photo simply never
 * shows up mapped. Under large batches Workers AI returns 3040 (capacity) and a
 * whole wave dies this way. Surfacing that error count is the entire point of
 * these probes.
 *
 * Cost discipline: bindings are checked for presence only (running a model would
 * bill), secrets are read via readSecret, R2 gets a `head` + `list({limit:1})`,
 * and D1 gets bounded aggregates.
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

const FILE = "src/backend/services/image-processor/health.ts";

/** Seconds in 24h — the window the staging-backlog probe treats as "recent". */
const ONE_DAY_SECONDS = 24 * 60 * 60;

/** Queued/processing rows older than this are stuck, not merely in flight. */
const STUCK_AFTER_SECONDS = 60 * 60;

/** Failed staging rows above this count means the pipeline needs attention. */
const PROCESSING_FAILED_DEGRADED_AT = 10;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "image_processor_images_binding",
    displayName: "Cloudflare Images binding",
    description:
      "Asserts the IMAGES binding is present on the environment. Presence only — no transform is " +
      "executed, because every transform is billable.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["images"],
    whatSuccessMeans:
      "env.IMAGES is bound, so the image processor can build variants and the service constructor " +
      "(src/backend/services/image-processor/service.ts, which assigns `this.images = env.IMAGES`) will " +
      "not throw on instantiation.",
    whatFailureMeans:
      "Every image upload path dies at construction. Nothing is resized, no variants exist, and the photo " +
      "grids render broken thumbnails across the whole app — inspiration boards, listing photos, product " +
      "photos and showroom hero images all at once.",
    troubleshootingSteps:
      "1. Confirm the `images` binding block exists in wrangler.jsonc (binding name `IMAGES`). " +
      "2. Confirm it survived the last deploy: `npx wrangler deployments list | tail -20` and compare against " +
      "when the breakage started. 3. Redeploy after fixing config: `pnpm run deploy` from `main`. " +
      "4. Watch an upload live with `npx wrangler tail` from https://core-remodel.hacolby.workers.dev/admin/photos",
    devOpsPlaybook:
      "Config/deploy fault, not a data fault. Fix wrangler.jsonc on a branch, verify on a preview with " +
      "`pnpm run deploy:preview` (previews inherit the same bindings by id), then merge and `pnpm run deploy`. " +
      "Do not work around a missing binding by calling the Images REST API directly — that changes the billing " +
      "and auth story for the whole module.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      if (!env.IMAGES) {
        return failure(
          "IMAGES binding is absent from the environment. Every image upload and variant build will fail. " +
            "Check the `images` binding in wrangler.jsonc.",
        );
      }
      return ok("IMAGES binding is present (presence-only check — no billable transform was run).");
    },
  }),

  defineProbe({
    name: "image_processor_cf_images_credentials",
    displayName: "Cloudflare Images credentials readable",
    description:
      "Reads CF_IMAGES_TOKEN and CLOUDFLARE_ACCOUNT_ID out of the Secrets Store. Reads only — the values " +
      "are never logged or included in the details string.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store"],
    whatSuccessMeans:
      "Both secrets resolve to non-empty values, so direct-upload URL minting and any Images API call the " +
      "processor makes will authenticate. Delivery URLs built from the account hash will resolve.",
    whatFailureMeans:
      "Uploads fail at the credential step with a 401 from Cloudflare that surfaces to the user as a generic " +
      "upload error. Because these are `remote: true` secrets-store bindings with no local fallback, this also " +
      "means a local `wrangler dev` can never exercise the path — which is why QC must target the deployed worker.",
    troubleshootingSteps:
      "1. Check the secret exists in the store: `npx wrangler secrets-store secret list` and confirm the names " +
      "referenced by the `secrets_store_secrets` bindings in wrangler.jsonc. " +
      "2. A binding declared for a secret that was never created fails the DEPLOY with error 10182 — if the last " +
      "deploy failed, that is the cause. 3. Re-create the secret, then redeploy: `pnpm run deploy` from `main`. " +
      "4. Confirm with a real upload at https://core-remodel.hacolby.workers.dev/admin/photos and `npx wrangler tail`. " +
      "5. Never paste the secret value into a PR, changelog entry, log line or this probe's details string.",
    devOpsPlaybook:
      "Credential rotation is the usual cause. After rotating, redeploy — the binding resolves at request time " +
      "but a stale deploy can still reference a deleted secret name. Verify with `npx wrangler deployments list | tail -20` " +
      "and re-run this probe from /admin/health. If a secret must be replaced urgently, prefer a plain Worker " +
      "secret over adding a new secrets_store binding, because the binding form fails the deploy when the secret " +
      "does not yet exist.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const token = await readSecret(env.CF_IMAGES_TOKEN);
      const accountId = await readSecret(env.CLOUDFLARE_ACCOUNT_ID);
      const missing: string[] = [];
      if (!token) missing.push("CF_IMAGES_TOKEN");
      if (!accountId) missing.push("CLOUDFLARE_ACCOUNT_ID");
      if (missing.length > 0) {
        return failure(
          `Unreadable or empty Images credential(s): ${missing.join(", ")}. Image uploads will fail with a 401 ` +
            "from Cloudflare. Check the secrets_store_secrets bindings in wrangler.jsonc and the secret store itself.",
        );
      }
      return ok("CF_IMAGES_TOKEN and CLOUDFLARE_ACCOUNT_ID both resolved to non-empty values.");
    },
  }),

  defineProbe({
    name: "image_processor_staging_errors",
    displayName: "Image staging processing errors",
    description:
      "Counts image_upload_staging rows with processing_status='failed' and reports the most recent " +
      "processing_error text. This column is the ONLY place an AI-extraction failure is recorded.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      `Fewer than ${PROCESSING_FAILED_DEGRADED_AT} failed staging rows. Uploads are getting through AI ` +
      "extraction and becoming mapped photos rather than dying quietly in the queue.",
    whatFailureMeans:
      "Uploads are silently failing. Nothing 500s and nothing appears in a normal log — the photo simply never " +
      "shows up. The classic cause is Workers AI returning 3040 (capacity) under a large batch, which kills a " +
      "whole wave at once; the wave-of-3 throttle and the auto-heal cron exist to defend against exactly this, so " +
      "a large failure count also implies auto-heal is not keeping up or is not running.",
    troubleshootingSteps:
      "1. Read the errors — the details string quotes the most recent one, and the full list is: " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT id, image_id, processing_error, datetime_created FROM image_upload_staging WHERE processing_status = 'failed' ORDER BY datetime_created DESC LIMIT 25\"`. " +
      "2. If the errors say 3040 / capacity, this is Workers AI throttling — wait, then let auto-heal " +
      "(src/backend/services/image-processor/auto-heal.ts) retry rather than re-running the batch by hand. " +
      "3. If the errors are parse/schema errors, the structured-output call changed shape — check that the AI call " +
      "still passes a json_schema response_format and does not degrade a failed parse to an empty object. " +
      "4. Watch a live retry with `npx wrangler tail`. " +
      "5. Inspect the queue at https://core-remodel.hacolby.workers.dev/admin/photos",
    devOpsPlaybook:
      "Retries run Workers AI and cost money, so never bulk-retry blind. Confirm the error class first, fix one " +
      "image end to end, then let auto-heal drain the rest. If the failure count is climbing during an active " +
      "upload session, pause uploading — continuing just enlarges the backlog you will have to pay to reprocess.",
    isBillingRisk: true,
    severity: "HIGH",
    run: async (env) => {
      if (!(await tableExists(env.DB, "image_upload_staging"))) {
        return failure(
          "Table image_upload_staging does not exist on this D1 — the upload pipeline has nowhere to stage. " +
            "Run `pnpm run migrate:remote`.",
        );
      }
      const failed = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM image_upload_staging WHERE processing_status = 'failed'",
      );
      const withError = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM image_upload_staging WHERE processing_error IS NOT NULL AND processing_error <> ''",
      );
      if (failed === 0 && withError === 0) {
        return ok("No failed image_upload_staging rows and no processing_error text recorded.");
      }
      const row = await env.DB.prepare(
        "SELECT processing_error FROM image_upload_staging WHERE processing_error IS NOT NULL " +
          "AND processing_error <> '' ORDER BY datetime_created DESC LIMIT 1",
      ).first<{ processing_error: string }>();
      const sample = row?.processing_error ? ` Most recent error: ${row.processing_error.slice(0, 240)}` : "";
      const over =
        failed >= PROCESSING_FAILED_DEGRADED_AT
          ? ` At or above the ${PROCESSING_FAILED_DEGRADED_AT}-failure threshold — treat as a pipeline outage, not stragglers.`
          : "";
      return degraded(
        `${failed} staging row(s) with processing_status='failed'; ${withError} carry processing_error text.${over}${sample}`,
      );
    },
  }),

  defineProbe({
    name: "image_processor_staging_backlog",
    displayName: "Image staging backlog",
    description:
      "Counts image_upload_staging rows still queued/processing, and how many of those have been sitting " +
      `longer than ${STUCK_AFTER_SECONDS / 60} minutes. Also reports the unmapped (mapping_status='pending') count.`,
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Nothing is stuck: queued rows are recent and moving, and the pending-mapping queue is a normal human " +
      "to-do list rather than a stalled pipeline.",
    whatFailureMeans:
      "Rows stranded in 'queued' or 'processing' for more than an hour mean the workflow that should pick them " +
      "up either never started or died mid-run without writing processing_error. A workflow that crashed hard " +
      "leaves the row exactly as it was, so these do not show up in the errors probe — this probe is what catches " +
      "them. The photos will never appear and nothing will retry.",
    troubleshootingSteps:
      "1. List the stuck rows: " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT id, image_id, processing_status, workflow_instance_id, datetime_created FROM image_upload_staging WHERE processing_status IN ('queued','processing') ORDER BY datetime_created ASC LIMIT 25\"`. " +
      "2. For rows with a workflow_instance_id, check the instance: `npx wrangler workflows instances describe <workflow> <id>`. " +
      "3. Rows with no workflow_instance_id were never dispatched — the enqueue path failed; check " +
      "src/backend/services/image-processor/batch-workflow.ts and workflow.ts. " +
      "4. Reset genuinely dead rows to 'queued' so auto-heal picks them up, rather than re-uploading the images. " +
      "5. Workflow names are account-scoped and suffixed per preview branch — if a preview run wrote these rows, " +
      "the instance lives under the suffixed workflow, not production's.",
    devOpsPlaybook:
      "Re-dispatching runs Workers AI per image, so size the backlog before acting — the count is in the details " +
      "string. Prefer letting the auto-heal cron drain it (it is throttled) over a manual mass re-dispatch. If the " +
      "backlog appeared right after a deploy, check `npx wrangler deployments list | tail -20`; a workflow rename " +
      "or binding change strands in-flight instances.",
    isBillingRisk: true,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "image_upload_staging"))) {
        return failure(
          "Table image_upload_staging does not exist on this D1 — run `pnpm run migrate:remote`.",
        );
      }
      const now = Math.floor(Date.now() / 1000);
      const inFlight = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM image_upload_staging WHERE processing_status IN ('queued','processing')",
      );
      const stuck = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM image_upload_staging WHERE processing_status IN ('queued','processing') " +
          "AND datetime_created < ?",
        now - STUCK_AFTER_SECONDS,
      );
      const pendingMapping = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM image_upload_staging WHERE mapping_status = 'pending'",
      );
      const last24h = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM image_upload_staging WHERE datetime_created >= ?",
        now - ONE_DAY_SECONDS,
      );
      const details =
        `${inFlight} staging row(s) queued/processing (${stuck} older than ${STUCK_AFTER_SECONDS / 60} min), ` +
        `${pendingMapping} awaiting room mapping, ${last24h} staged in the last 24h.`;
      return stuck > 0 ? degraded(`${details} Stranded rows will never retry on their own.`) : ok(details);
    },
  }),

  defineProbe({
    name: "image_processor_derived_asset_storage",
    displayName: "Derived-asset R2 storage reachable",
    description:
      "Proves ARTIFACTS_BUCKET — where the processor writes derived assets (renders, mood-board exports, " +
      "intermediate canvases) — is bound and answers a `head` plus a `list({ limit: 1 })`.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["r2"],
    whatSuccessMeans:
      "The processor has somewhere to persist derived output. Render sessions and mood-board generations can " +
      "store their results and the UI can read them back.",
    whatFailureMeans:
      "Generated output has nowhere to land. The expensive part (the model run) still happens and is still " +
      "billed, and then the result is dropped — the worst possible failure shape for a paid pipeline. Renders " +
      "appear to succeed and then show nothing.",
    troubleshootingSteps:
      "1. Confirm the `r2_buckets` entry with binding `ARTIFACTS_BUCKET` exists in wrangler.jsonc. " +
      "2. Confirm the bucket exists on the account: `npx wrangler r2 bucket list`. " +
      "3. If it is missing, STOP any render/generation work first — every run will burn model spend and discard " +
      "the output. 4. Fix the binding, `pnpm run deploy` from `main`, then re-run this probe. " +
      "5. Verify a real render end to end at https://core-remodel.hacolby.workers.dev/admin/studio",
    devOpsPlaybook:
      "Treat a failure here as a spend-protection incident, not just a storage outage: pause generation until " +
      "storage is back. Previews share production's R2 bucket by id, so a preview failing here means bad config " +
      "rather than isolation. After the fix, confirm with `npx wrangler deployments list | tail -20`.",
    isBillingRisk: true,
    severity: "MEDIUM",
    run: async (env) => {
      if (!env.ARTIFACTS_BUCKET) {
        return failure(
          "ARTIFACTS_BUCKET binding is absent. Derived image assets have nowhere to persist — model runs will " +
            "still be billed and their output discarded. Pause generation and fix `r2_buckets` in wrangler.jsonc.",
        );
      }
      await env.ARTIFACTS_BUCKET.head("health/probe");
      const listing = await env.ARTIFACTS_BUCKET.list({ limit: 1 });
      return ok(
        `ARTIFACTS_BUCKET answered head + list(limit:1) for derived assets; ${listing.objects.length} object sampled.`,
      );
    },
  }),
];
