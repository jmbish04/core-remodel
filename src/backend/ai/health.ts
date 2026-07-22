/**
 * @fileoverview Health probes for the AI module (`src/backend/ai`).
 *
 * COST DISCIPLINE. Nothing here invokes a model. The most expensive call in this
 * file is `VectorizeIndex.describe()`, which returns index metadata (dimensions,
 * vector count) and is not billed as a query. Everything else is a binding
 * presence check, a Secrets Store read, or one aggregate `SELECT` against D1.
 * If you are tempted to add `env.AI.run(...)` here to "really prove it works" —
 * don't. A probe that costs money every time an operator refreshes
 * `/admin/system/health` is a worse outage than the one it detects.
 */

import { modelRegistry } from "./models";

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

const FILE = "src/backend/ai/health.ts";

/** The three Vectorize indexes this Worker binds, with what each one backs. */
const VECTORIZE_INDEXES: Array<{ binding: keyof Env; purpose: string }> = [
  { binding: "VECTOR_INDEX", purpose: "general semantic search over project content" },
  { binding: "RESEARCH_INDEX", purpose: "deep-research document corpus" },
  { binding: "PHOTO_INDEX", purpose: "listing/inspiration photo similarity" },
];

/** Obvious not-really-configured values people leave behind in a model constant. */
const PLACEHOLDER_MODEL_IDS = ["", "todo", "tbd", "changeme", "model", "placeholder", "xxx"];

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "ai_workers_ai_binding_present",
    displayName: "Workers AI binding present",
    description:
      "Asserts the `AI` binding is attached to the Worker and exposes a callable `run()` method. Presence only — no inference is performed.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["workers_ai"],
    whatSuccessMeans:
      "The `AI` binding exists on `env` and has a `run` function. Every Workers AI call site in the app (embeddings, extraction, vision, classification) has a binding to call. It does NOT prove the account has Workers AI quota remaining or that any specific model id is valid — only that the plumbing is attached.",
    whatFailureMeans:
      "`env.AI` is missing or malformed, which means the deployed Worker was built from a wrangler config without the `ai` binding. Every AI-backed feature is hard-down: embeddings return nothing, image staging fails, extraction pipelines throw. This is a configuration/deploy fault, never a transient one — it will not fix itself.",
    troubleshootingSteps:
      "1. Open `wrangler.jsonc` and confirm the top-level `ai` block exists with `\"binding\": \"AI\"`. 2. Confirm you are looking at the deployed worker, not a preview: `npx wrangler deployments list | tail -20` and match the newest entry to your commit. 3. If the binding is in config but missing at runtime, the running code is older than the config — redeploy with `pnpm run deploy` from `main`. 4. If this fires on a preview worker only, check `scripts/deploy-preview.mjs` — the preview config is derived from the top-level one and a binding it fails to carry across will look exactly like this.",
    devOpsPlaybook:
      "1. Treat as a P1 deploy fault; AI features are entirely offline. 2. Verify the config: `npx wrangler deployments list` then inspect the live worker's bindings in the Cloudflare dashboard under Workers & Pages > core-remodel > Settings > Bindings. 3. Re-run `pnpm run deploy` from a clean `main` checkout. 4. Re-run this probe from /admin/system/health and confirm SUCCESS. 5. If it still fails after a successful deploy, the account may have lost Workers AI entitlement — check the Cloudflare dashboard AI > Workers AI page for account-level status before escalating.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const ai = env.AI as unknown as { run?: unknown } | undefined;
      if (!ai) return failure("`env.AI` is undefined — the Workers AI binding is not attached.");
      if (typeof ai.run !== "function") {
        return failure("`env.AI` is present but has no callable `run()` — binding shape is wrong.");
      }
      return ok("`env.AI` bound with a callable run().");
    },
  }),

  defineProbe({
    name: "ai_vectorize_indexes_present",
    displayName: "Vectorize indexes bound",
    description:
      "Asserts all three Vectorize bindings (VECTOR_INDEX, RESEARCH_INDEX, PHOTO_INDEX) are attached, and calls the free `describe()` metadata endpoint on each to prove the index actually exists on the account. No vectors are queried or inserted.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["vectorize"],
    whatSuccessMeans:
      "All three indexes are bound and `describe()` returned metadata, so the index exists server-side, is reachable from this Worker, and reports its dimension count. Semantic search, deep research retrieval and photo similarity all have a live index behind them.",
    whatFailureMeans:
      "At least one index binding is missing, or `describe()` errored (index deleted, renamed, or wrong id in `wrangler.jsonc`). The features that depend on that index silently return zero results rather than erroring — which is the dangerous part: search looks 'empty', not 'broken', so nobody reports it.",
    troubleshootingSteps:
      "1. List the real indexes: `npx wrangler vectorize list`. 2. Compare each name against the `vectorize` entries in `wrangler.jsonc` — the binding name (VECTOR_INDEX) and the `index_name` are different things and it is the `index_name` that must match. 3. If an index is genuinely gone, recreate it with `npx wrangler vectorize create <name> --dimensions=1024 --metric=cosine` (1024 = @cf/baai/bge-large-en-v1.5) and re-embed; embeddings are NOT recoverable from the index itself. 4. If the name matches but describe() 401s, the deploy is using a stale account binding — `pnpm run deploy` again. 5. Remember Vectorize ids cap at 64 bytes; an ingest that quietly dropped rows shows up as a low vector count here, not as a failure.",
    devOpsPlaybook:
      "1. Identify which index failed from the probe details — they are named individually. 2. `npx wrangler vectorize list` and `npx wrangler vectorize info <index_name>` to confirm existence and vector count. 3. A missing index is a rebuild, not a restart: re-run the relevant backfill (photo embeddings via the images pipeline, research corpus via the deep-research ingest) after recreating it. 4. A zero/implausibly-low vector count on an index that exists is a DEGRADED signal — open an issue rather than paging, but do not ignore it, an empty index silently ruins every search result ranked against it.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const missing: string[] = [];
      const errored: string[] = [];
      const described: string[] = [];

      for (const { binding } of VECTORIZE_INDEXES) {
        const idx = (env as unknown as Record<string, VectorizeIndex | undefined>)[
          binding as string
        ];
        if (!idx) {
          missing.push(String(binding));
          continue;
        }
        // describe() is metadata only — free, bounded, no vector scan.
        if (typeof (idx as { describe?: unknown }).describe !== "function") {
          described.push(`${String(binding)}=bound(no describe())`);
          continue;
        }
        try {
          const info = (await idx.describe()) as {
            dimensions?: number;
            vectorsCount?: number;
            vectorCount?: number;
          };
          const count = info.vectorsCount ?? info.vectorCount ?? "?";
          described.push(`${String(binding)}=${count} vectors/${info.dimensions ?? "?"}d`);
        } catch (err) {
          errored.push(`${String(binding)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (missing.length > 0) {
        return failure(
          `Vectorize binding(s) not attached: ${missing.join(", ")}. Described OK: ${described.join(", ") || "none"}.`,
        );
      }
      if (errored.length > 0) {
        return failure(`describe() failed for: ${errored.join(" | ")}. OK: ${described.join(", ")}.`);
      }
      return ok(`All 3 Vectorize indexes bound and described — ${described.join(", ")}.`);
    },
  }),

  defineProbe({
    name: "ai_model_registry_ids_sane",
    displayName: "Model registry ids are real",
    description:
      "Reads the static model registry in `src/backend/ai/models` and asserts every role (chat, extract, draft, embed, stt, tts, vision) resolves to a non-empty, non-placeholder Workers AI model id of the form `@cf/<vendor>/<model>`.",
    healthTsFilepath: FILE,
    bindingTypesTested: [],
    whatSuccessMeans:
      "Every task role maps to a plausible Workers AI model id. A call site that asks the registry for `extract` or `embed` will get an id Workers AI can route. This is a static-config assertion — it proves nothing about whether that model is currently available on the account, only that we are not about to send an empty string to `env.AI.run`.",
    whatFailureMeans:
      "A model constant is empty, a placeholder ('TODO', 'changeme'), or not a `@cf/...` id. Workers AI rejects the call with an unhelpful error at runtime, and because most AI call sites are inside `ctx.waitUntil` background work, the failure surfaces as 'the pipeline produced nothing' rather than as an error the user sees.",
    troubleshootingSteps:
      "1. The failing role is named in the details. Open `src/backend/ai/models/index.ts` and follow the import for that role to its descriptor file. 2. Every descriptor is `defineModel({ id: \"@cf/...\", ... })` — the `id` is the field this probe checks. 3. Confirm the id is a real, currently-available Workers AI model in the Cloudflare dashboard under AI > Workers AI > Models (model ids get deprecated; a removed id will still pass this shape check but fail at runtime). 4. Reminder from prior incidents: `@cf/moonshotai/kimi-k2.6` is a reasoning model that returns empty `content` for structured output — if extraction is silently blank, the model id is valid but the CHOICE is wrong; use `@cf/openai/gpt-oss-120b`. 5. `npx tsc --noEmit` after editing — the esbuild build does not type-check.",
    devOpsPlaybook:
      "1. This never fails transiently — it is always a code change that landed. Check `git log -5 -- src/backend/ai/models/` for the commit. 2. Fix the constant, `npx tsc --noEmit`, open a PR. 3. Deploy with `pnpm run deploy` from `main` after merge; the constant is compiled in, so nothing changes in production until you deploy. 4. Re-run this probe to confirm.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async () => {
      const bad: string[] = [];
      const good: string[] = [];
      for (const [role, model] of Object.entries(modelRegistry)) {
        const id = String((model as { id?: unknown }).id ?? "").trim();
        if (id.length === 0 || PLACEHOLDER_MODEL_IDS.includes(id.toLowerCase())) {
          bad.push(`${role}="${id}" (empty/placeholder)`);
        } else if (!id.startsWith("@cf/")) {
          bad.push(`${role}="${id}" (not a @cf/ Workers AI id)`);
        } else {
          good.push(`${role}=${id}`);
        }
      }
      if (bad.length > 0) {
        return failure(`Bad model id(s): ${bad.join("; ")}. OK: ${good.length} role(s).`);
      }
      return ok(`${good.length} roles resolved — ${good.join(", ")}.`);
    },
  }),

  defineProbe({
    name: "ai_gemini_api_key_readable",
    displayName: "GEMINI_API_KEY readable",
    description:
      "Reads the GEMINI_API_KEY Secrets Store binding and asserts it returns a non-empty value. The key is never logged, compared, or sent anywhere — only its presence and length are reported.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store"],
    whatSuccessMeans:
      "The Secrets Store binding exists and `get()` returned a non-empty string, so every Gemini call site (email classification, deep research, image staging, Maps grounding, render stage provider) can authenticate. It does NOT prove the key is still valid at Google — only that we have one.",
    whatFailureMeans:
      "The binding is missing or unreadable. Every Gemini-backed feature throws on its first call: email classification stops labelling, deep research stalls, the Gemini render stage provider fails over (or fails outright). Because `WORKER_API_KEY`-style secrets are `remote: true` with no local fallback, this ALWAYS fails under `wrangler dev` — a local FAILURE here is expected and meaningless; only trust a run against the deployed Worker.",
    troubleshootingSteps:
      "1. Confirm the secret exists in the store: `npx wrangler secret list` and check the Secrets Store in the Cloudflare dashboard (Workers & Pages > Secrets Store). 2. Confirm `wrangler.jsonc` has a `secrets_store_secrets` entry binding GEMINI_API_KEY. 3. If the binding is declared but the secret was never created, the DEPLOY itself fails with error 10182 — so a live worker with this failing means the secret was deleted after deploy. 4. Rotate/re-create the key in Google AI Studio, write it back into the Secrets Store, then `pnpm run deploy`. 5. Verify by hitting any Gemini-backed admin endpoint and checking a fresh row lands in `gemini_usage_log`.",
    devOpsPlaybook:
      "1. Confirm you are testing production, not local — this probe cannot pass under `wrangler dev`. 2. `npx wrangler secret list` + Cloudflare dashboard Secrets Store to see whether the secret row exists. 3. Recreate the secret, then `pnpm run deploy` (a secret change does not take effect without a deploy binding refresh). 4. Watch `gemini_usage_log` for a new row with `status='ok'` to confirm end-to-end recovery. 5. If the key is present but Google is rejecting it, this probe stays green and the failures show as `status='error'` rows in `gemini_usage_log` — check there before assuming the secret is the problem.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const v = await readSecret(env.GEMINI_API_KEY);
      if (!v) return failure("GEMINI_API_KEY is missing, empty, or unreadable from Secrets Store.");
      return ok(`GEMINI_API_KEY readable (${v.length} chars).`);
    },
  }),

  defineProbe({
    name: "ai_anthropic_api_key_readable",
    displayName: "ANTHROPIC_API_KEY readable",
    description:
      "Reads the ANTHROPIC_API_KEY Secrets Store binding and asserts it returns a non-empty value. Presence only — no Anthropic API call is made.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store"],
    whatSuccessMeans:
      "The binding exists and returned a non-empty string, so Claude-backed paths can authenticate. Like the Gemini probe, it says nothing about whether the key still has credit or is revoked upstream.",
    whatFailureMeans:
      "Claude-backed features cannot authenticate. Anthropic is a secondary provider here (Gemini and Workers AI carry most traffic), so this is usually DEGRADED-in-practice rather than total outage — but any code path that hard-depends on it throws. As with all Secrets Store bindings, this always fails locally under `wrangler dev`; only a run against the deployed Worker is meaningful.",
    troubleshootingSteps:
      "1. Check the Secrets Store in the Cloudflare dashboard (Workers & Pages > Secrets Store) for the ANTHROPIC_API_KEY entry and `npx wrangler secret list`. 2. Confirm the `secrets_store_secrets` binding for it in `wrangler.jsonc`. 3. Mint a replacement key at console.anthropic.com, store it, then `pnpm run deploy` — bindings only refresh on deploy. 4. If the key exists but calls 401, this probe is green and the truth is in the calling service's error logs; use `npx wrangler tail` on the live worker while triggering the path.",
    devOpsPlaybook:
      "1. Confirm the target is production, not local. 2. Recreate the secret in the Secrets Store, then `pnpm run deploy`. 3. Since Anthropic is not on the critical path for the core pipelines, this can be handled in business hours unless a specific feature is reported down. 4. Re-run the probe from /admin/system/health to confirm.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const v = await readSecret(env.ANTHROPIC_API_KEY);
      if (!v) {
        return failure("ANTHROPIC_API_KEY is missing, empty, or unreadable from Secrets Store.");
      }
      return ok(`ANTHROPIC_API_KEY readable (${v.length} chars).`);
    },
  }),

  defineProbe({
    name: "ai_extraction_failure_watcher",
    displayName: "AI image-processing failure rate (24h)",
    description:
      "Counts rows in `image_upload_staging` from the last 24h where `processing_status='failed'` or `processing_error` is set, as a proportion of rows created in that window. This is the closest thing the schema has to an 'AI parse failed' ledger.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Images uploaded in the last 24h are being processed by the AI pipeline without an elevated failure rate (<20% failed). The vision/extraction models are returning parseable output and the workflow is completing. Zero uploads in the window also reads as SUCCESS — nothing to process is not a fault.",
    whatFailureMeans:
      "More than half the recent uploads failed processing. Historically this shape means one of three things: Workers AI returned error 3040 under a large batch (capacity), a structured-output call came back with empty `content` (the kimi-k2.6 reasoning-model trap), or a model id changed under us. The error text lives in `image_upload_staging.processing_error` — that column is the only place it is recorded, which is why this probe exists at all.",
    troubleshootingSteps:
      "1. Read the actual errors — they are not in any log: `npx wrangler d1 execute core-remodel --remote --command \"SELECT processing_status, processing_error, datetime_created FROM image_upload_staging WHERE processing_error IS NOT NULL ORDER BY datetime_created DESC LIMIT 20\"`. 2. Error 3040 = Workers AI capacity under a big batch; the wave-of-3 throttle and the auto-heal cron are the designed defence — confirm the cron is still scheduled in `wrangler.jsonc` and that it ran. 3. An empty-content failure means the model returned nothing parseable: check which model the pipeline used and remember reasoning models (kimi-k2.6) return empty `content` for structured output — `@cf/openai/gpt-oss-120b` is the known-good one. 4. Never let a failed parse degrade to `{}` — if the error column is NULL but rows are stuck, a silent-degrade bug has been reintroduced. 5. Re-drive stuck rows through the auto-heal path rather than hand-editing D1.",
    devOpsPlaybook:
      "1. Pull the error distribution with the D1 query above before touching anything — the fix is entirely determined by which error dominates. 2. Capacity (3040): no action beyond confirming the throttle and auto-heal cron; it self-heals, and re-triggering the batch makes it worse. 3. Model/parse failures: fix the model id or the schema in the calling service, PR it, `pnpm run deploy`, then re-drive the failed rows. 4. Track the count back down by re-running this probe; it should return to SUCCESS within one auto-heal cycle. 5. If `image_upload_staging` does not exist, this is a deploy-order fault — run `pnpm run migrate:remote` and verify the table before re-testing.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const db = env.DB;
      if (!(await tableExists(db, "image_upload_staging"))) {
        return failure(
          "Table `image_upload_staging` does not exist on this database — an unapplied migration. Run `pnpm run migrate:remote`.",
        );
      }
      const total = await scalar(
        db,
        "SELECT COUNT(*) FROM image_upload_staging WHERE datetime_created >= unixepoch() - 86400",
      );
      if (total === 0) {
        const stuckAll = await scalar(
          db,
          "SELECT COUNT(*) FROM image_upload_staging WHERE processing_status = 'failed'",
        );
        return ok(`No uploads in the last 24h (${stuckAll} historical failed rows in total).`);
      }
      const failed = await scalar(
        db,
        "SELECT COUNT(*) FROM image_upload_staging WHERE datetime_created >= unixepoch() - 86400 AND (processing_status = 'failed' OR processing_error IS NOT NULL)",
      );
      const pct = Math.round((failed / total) * 100);
      const detail = `${failed}/${total} uploads in the last 24h failed AI processing (${pct}%).`;
      if (pct > 50) return failure(detail);
      if (pct >= 20) return degraded(detail);
      return ok(detail);
    },
  }),
];
