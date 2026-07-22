/**
 * @fileoverview Health probes for the AI Gateway module
 * (`src/backend/services/ai-gateway`).
 *
 * COST DISCIPLINE. These probes never call the Cloudflare GraphQL Analytics API
 * and never route a request through the gateway. They assert that the three
 * things `analytics.ts` depends on are in place (the gateway id var, an account
 * tag, an API token) and that gateway-routed traffic is still landing in the
 * local usage ledger. Proving the GraphQL pull works costs an authenticated
 * round-trip on every dashboard refresh; the credential checks below catch every
 * failure mode we have actually seen without it.
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

const FILE = "src/backend/services/ai-gateway/health.ts";

/**
 * Providers whose calls are routed THROUGH the AI Gateway and recorded in
 * `gemini_usage_log`. Gemini is deliberately excluded: the Gemini interactions
 * API is not gateway-compatible (the gateway 401s it), so Gemini rows in that
 * table are direct calls and would mask a dead gateway.
 */
const GATEWAY_ROUTED_PROVIDERS = ["WORKERS_AI", "CF_IMAGES", "BROWSER_RENDERING", "VECTORIZE"];

/** Days without a single gateway-routed usage row before this reads as stale. */
const STALE_DAYS = 7;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "ai_gateway_id_configured",
    displayName: "AI_GATEWAY_ID var configured",
    description:
      "Asserts the `AI_GATEWAY_ID` plain var is present and non-empty. It is the gateway slug ('core-remodel') that every gateway URL and every `{ gateway: { id } }` option is built from.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["ai_gateway"],
    whatSuccessMeans:
      "`env.AI_GATEWAY_ID` is set, so `getAiGatewayUsage()` can filter analytics to the right gateway and the Fal/Replicate stage providers can build their `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/...` base URL. It does not prove a gateway with that slug exists on the account — only that the app has a name to use.",
    whatFailureMeans:
      "The var is missing from the deployed config. Every URL built from it becomes `.../v1/<account>/undefined/...`, so the Fal and Replicate render providers 404 on their first call, and the AI Gateway usage panel reports 'unavailable'. Workers AI calls that pass `{ gateway: { id } }` lose caching, rate limiting and gateway-side logging — they may still succeed, which is why this can sit broken quietly.",
    troubleshootingSteps:
      "1. Check the `vars` block in `wrangler.jsonc` for `\"AI_GATEWAY_ID\": \"core-remodel\"`. 2. Confirm the gateway itself exists: Cloudflare dashboard > AI > AI Gateway — the slug in the URL is the value this var must equal. 3. `vars` are baked in at deploy time, so editing the file changes nothing until you run `pnpm run deploy` from `main`. 4. On a preview worker, verify `scripts/deploy-preview.mjs` carried the var across — the preview config is DERIVED from the top-level one, so a var it drops looks identical to a var that was never set.",
    devOpsPlaybook:
      "1. Add/repair the var in `wrangler.jsonc`, PR it, merge. 2. `pnpm run deploy`, then `npx wrangler deployments list | tail -20` to confirm your version is live. 3. Re-run this probe. 4. Confirm the downstream recovered: the AI Gateway usage panel under /admin should stop saying 'unavailable', and a render stage using the Fal or Replicate provider should stop 404ing.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const id = String(env.AI_GATEWAY_ID ?? "").trim();
      if (id.length === 0) {
        return failure("`AI_GATEWAY_ID` is unset or empty — gateway URLs will resolve to /undefined/.");
      }
      return ok(`AI_GATEWAY_ID = "${id}".`);
    },
  }),

  defineProbe({
    name: "ai_gateway_analytics_credentials",
    displayName: "Gateway analytics credentials readable",
    description:
      "Reads the Secrets Store bindings the AI Gateway analytics pull depends on — CLOUDFLARE_ACCOUNT_ID (the GraphQL `accountTag`), CLOUDFLARE_WRANGLER_API_TOKEN (the token `analytics.ts` actually uses) and AI_GATEWAY_TOKEN (gateway-side auth) — and asserts each returns a non-empty value. No GraphQL request is made.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store", "ai_gateway"],
    whatSuccessMeans:
      "All three secrets read back non-empty, so `getAiGatewayUsage()` has an account tag to filter on and a bearer token to authenticate with, and any gateway-authenticated route has its token. It does NOT prove the token carries the `Account Analytics: Read` permission the GraphQL query requires — a token with the wrong scopes reads fine here and 401s at the API.",
    whatFailureMeans:
      "The analytics pull degrades to `{ available: false, reason }` and the AI Gateway usage panel shows an informative-but-empty state, so gateway request volume and per-model breakdowns are invisible. That matters beyond cosmetics: gateway analytics is one of the two independent views of AI spend (the other being `gemini_usage_log`), and losing it means a runaway is only visible in one place. As with every Secrets Store binding here, this ALWAYS fails under `wrangler dev` — only trust a run against the deployed Worker.",
    troubleshootingSteps:
      "1. The details name which secret is missing. Check it in the Cloudflare dashboard under Workers & Pages > Secrets Store, and with `npx wrangler secret list`. 2. Confirm the matching `secrets_store_secrets` entry exists in `wrangler.jsonc`. 3. If CLOUDFLARE_WRANGLER_API_TOKEN is present but analytics still reports unavailable, the token's SCOPES are wrong: mint a new API token with `Account Analytics: Read` (plus whatever else it is used for) at dash.cloudflare.com > My Profile > API Tokens, store it, then `pnpm run deploy`. 4. Note the naming trap: `AI_GATEWAY_TOKEN` is the gateway's own auth token, NOT the analytics token — `services/ai-gateway/analytics.ts` reads `CLOUDFLARE_WRANGLER_API_TOKEN`. Replacing the wrong one is the most common wasted hour here.",
    devOpsPlaybook:
      "1. Confirm the run targeted production, not local. 2. Recreate the named secret in the Secrets Store, then `pnpm run deploy` — secret bindings do not refresh without a deploy. 3. Verify by loading the AI Gateway usage panel and confirming `available: true`. 4. If it still reports unavailable with a 'not authorized' style reason, the token scope is the problem, not its presence — reissue with `Account Analytics: Read`. 5. This is not a customer-facing outage; handle in business hours unless spend monitoring is actively needed.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const [accountId, analyticsToken, gatewayToken] = await Promise.all([
        readSecret(env.CLOUDFLARE_ACCOUNT_ID),
        readSecret(env.CLOUDFLARE_WRANGLER_API_TOKEN),
        readSecret(env.AI_GATEWAY_TOKEN),
      ]);

      if (!accountId || !analyticsToken) {
        const missing = [
          accountId ? null : "CLOUDFLARE_ACCOUNT_ID",
          analyticsToken ? null : "CLOUDFLARE_WRANGLER_API_TOKEN (analytics bearer)",
        ].filter(Boolean);
        return failure(
          `Gateway analytics cannot run — missing: ${missing.join(", ")}. AI_GATEWAY_TOKEN ${gatewayToken ? "readable" : "also missing"}.`,
        );
      }
      if (!gatewayToken) {
        return degraded(
          "Analytics credentials present, but AI_GATEWAY_TOKEN is missing — gateway-authenticated routes cannot send `cf-aig-authorization`.",
        );
      }
      return ok(
        `CLOUDFLARE_ACCOUNT_ID (${accountId.length} chars), CLOUDFLARE_WRANGLER_API_TOKEN (${analyticsToken.length} chars) and AI_GATEWAY_TOKEN (${gatewayToken.length} chars) all readable.`,
      );
    },
  }),

  defineProbe({
    name: "ai_gateway_traffic_recency",
    displayName: "Gateway-routed traffic recency",
    description:
      "Finds the most recent `gemini_usage_log` row for a provider that is routed through the AI Gateway (WORKERS_AI, CF_IMAGES, BROWSER_RENDERING, VECTORIZE) and reports its age. Gemini rows are excluded on purpose — the Gemini interactions API bypasses the gateway, so counting them would mask a dead gateway. DEGRADED when the newest row is older than 7 days.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1", "ai_gateway"],
    whatSuccessMeans:
      "At least one gateway-routed provider call was recorded in the last 7 days, so the metering wrappers are running, the gateway path is being exercised, and the local ledger that cross-checks gateway analytics is alive. This is a LOCAL proxy for gateway health — `analytics.ts` reads Cloudflare's GraphQL API and writes nothing to D1, so the usage log is the only first-party record we have.",
    whatFailureMeans:
      "Either nothing has used a gateway-routed provider in a week (plausible in a quiet period, hence DEGRADED not FAILURE), or — the dangerous reading — calls ARE happening but `recordUsage()` is no longer writing rows. The second case means the spend ledger is blind while spend continues, and the circuit breaker in `services/usage/metering.ts` fails CLOSED on an unreadable ledger, so a genuinely broken writer eventually blocks all metered providers.",
    troubleshootingSteps:
      "1. Confirm whether traffic exists at all: Cloudflare dashboard > AI > AI Gateway > core-remodel shows request counts independently of D1. Gateway shows traffic but D1 has no rows = the writer is broken; both empty = genuinely idle. 2. Check the ledger directly: `npx wrangler d1 execute core-remodel --remote --command \"SELECT provider, MAX(timestamp), COUNT(*) FROM gemini_usage_log GROUP BY provider\"`. 3. `recordUsage()` swallows its own errors by design (metering must not take down the call it measures) and logs with the `[metering]` prefix — `npx wrangler tail` and grep for it while triggering an AI call. 4. Remember adoption is incremental: only paths using `meteredAiRun()` write rows. A quiet ledger can simply mean the busy code paths still call `env.AI.run` directly. 5. Cross-check with `/admin/health`'s usage probes — a spend spike alongside a stale ledger is contradictory and means the ledger is lying.",
    devOpsPlaybook:
      "1. Decide which case you are in using the dashboard-vs-D1 comparison above before acting. 2. Broken writer: tail the worker for `[metering] FAILED to record`, fix the insert, PR, `pnpm run deploy`. 3. Missing table (probe says the table does not exist): run `pnpm run migrate:remote` and verify — new code shipped before its migration is the classic cause of a 500 right after a schema change. 4. Genuinely idle: no action, but note it, because every spend-spike probe compares against a 7-day baseline and an idle week makes the next real spike look like a 100x jump. 5. Re-run after any AI-backed action and confirm a fresh row appears.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const db = env.DB;
      if (!(await tableExists(db, "gemini_usage_log"))) {
        return failure(
          "Table `gemini_usage_log` does not exist on this database — unapplied migration. Run `pnpm run migrate:remote`.",
        );
      }
      const placeholders = GATEWAY_ROUTED_PROVIDERS.map(() => "?").join(",");
      const newest = await scalar(
        db,
        `SELECT COALESCE(MAX(timestamp), 0) FROM gemini_usage_log WHERE provider IN (${placeholders})`,
        ...GATEWAY_ROUTED_PROVIDERS,
      );
      if (newest === 0) {
        return degraded(
          `No gateway-routed usage rows have EVER been recorded (providers: ${GATEWAY_ROUTED_PROVIDERS.join(", ")}). Either metering has not been adopted on those paths or the writer is broken.`,
        );
      }
      const ageDays = (Date.now() / 1000 - newest) / 86400;
      const detail = `Most recent gateway-routed usage row is ${ageDays.toFixed(1)} day(s) old (providers: ${GATEWAY_ROUTED_PROVIDERS.join(", ")}).`;
      if (ageDays > STALE_DAYS) return degraded(`${detail} Stale threshold is ${STALE_DAYS} days.`);
      return ok(detail);
    },
  }),
];
