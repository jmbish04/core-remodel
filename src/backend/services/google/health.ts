/**
 * @fileoverview Health probes for the Google Platform integrations
 * (`src/backend/services/google/**` — Maps/Places/Routes and Sheets — plus the
 * Custom Search JSON API used by showroom/brand enrichment).
 *
 * These are the METERED Google surfaces. Google Maps Platform bills against a
 * monthly free credit, which is why `GoogleMapsService.logUsage()` writes an
 * append-only row to `google_maps_usage_log` for EVERY outbound call. That log
 * is the only spend signal this project has, so two things can go wrong and
 * both matter: the log stops being written (we go blind), or the call volume
 * jumps (we go over).
 *
 * Cost discipline: no probe here calls Google. Credentials are read from the
 * Secrets Store, volume is counted in D1.
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

const FILE = "src/backend/services/google/health.ts";

const DAY = 86_400;

/**
 * Calls in a rolling 30 days above which the Maps spend probe shouts. Places
 * Details / Text Search sit in the ~$17–32 per 1,000 band, so 10k calls a month
 * is roughly the point at which the monthly free credit is genuinely at risk;
 * 5k is the "look at this now" line.
 */
const MAPS_MONTHLY_WARN = 5_000;
const MAPS_MONTHLY_ALERT = 10_000;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "google_maps_api_key_present",
    displayName: "Google · Maps Platform API key present",
    description:
      "Reads the GOOGLE_MAPS_API Secrets Store binding. This one key backs everything geographic in the app: Places Autocomplete and Details on the showroom intake wizard, Places Text Search for store discovery, and the Routes API behind drive-route planning. Presence only — the probe never calls Google, because every Maps call is billable.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store"],
    whatSuccessMeans:
      "The key is readable at request time. Showroom address autocomplete, place import, and drive route planning have a credential. It does NOT prove the key is unrestricted enough or that billing is enabled on the GCP project — only that we hold one.",
    whatFailureMeans:
      "No Maps key. Every Places/Routes call fails, which surfaces as address autocomplete returning nothing on the showroom intake form, `import_showroom_from_place` erroring, and drive route planning falling back or failing. Nothing is billed, so this failure is safe — just broken.",
    troubleshootingSteps:
      "1. Confirm the binding exists in wrangler.jsonc: `grep -n 'GOOGLE_MAPS_API' wrangler.jsonc` (it is a `secrets_store_secrets` entry, not a Worker secret). 2. Confirm the value in the Cloudflare dashboard under Secrets Store. 3. If the key is present but calls 403, the fault is on the Google side: check the key's API restrictions in GCP Console → APIs & Services → Credentials, and confirm Places API (New) and Routes API are enabled on the project. 4. Watch a live call: `npx wrangler tail --format pretty | grep -i maps` while using the address field on /admin/showrooms.",
    devOpsPlaybook:
      "1. Rotating the key: create the new key in GCP with the same API restrictions, update the Secrets Store value, re-run this probe — no redeploy needed. 2. Never move this key into a var or into client-side code; every Maps call must stay server-side so `logUsage` can record it. 3. Spend to date is on /admin/integrations/usage and in `google_maps_usage_log`. 4. Deploy from `main` with `pnpm run deploy` if a code change accompanied the key change.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const key = await readSecret(env.GOOGLE_MAPS_API);
      if (!key) return failure("GOOGLE_MAPS_API is absent or empty — all Places/Routes calls will fail.");
      return ok(`GOOGLE_MAPS_API readable (${key.length} chars).`);
    },
  }),

  defineProbe({
    name: "google_custom_search_configured",
    displayName: "Google · Custom Search key + CX configured",
    description:
      "Checks the Custom Search JSON API pair used by showroom/brand enrichment: the GOOGLE_SEARCH_API_KEY Secrets Store binding AND the GOOGLE_SEARCH_CX plain var (the search-engine id). Both are required — a key with no CX cannot issue a query. GOOGLE_SEARCH_CX is presently declared as an empty string in wrangler.jsonc, so an empty CX is a KNOWN, tolerated state: enrichment falls back to its non-search path rather than breaking. That is why an empty CX reports DEGRADED and never FAILURE.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store"],
    whatSuccessMeans:
      "Both halves are configured, so `services/showroom/brand-enrichment.ts` can run its Custom Search tier and brand/website discovery gets its best-quality input.",
    whatFailureMeans:
      "DEGRADED (missing key, missing CX, or both) means Custom Search is simply off: brand enrichment silently degrades to its fallback path and produces thinner results. This is the expected state today — GOOGLE_SEARCH_CX ships empty — so treat DEGRADED as informational unless someone has just configured the engine and expects it live. There is no FAILURE state for this probe because nothing in the app hard-depends on Custom Search.",
    troubleshootingSteps:
      "1. To turn it on, create a Programmable Search Engine at programmablesearchengine.google.com, set it to search the whole web, and copy its Search engine ID. 2. Put that id in the `GOOGLE_SEARCH_CX` var in wrangler.jsonc (it is a plain var, not a secret — it is not sensitive) and redeploy: `pnpm run deploy` from `main`. 3. Put the API key in the Secrets Store binding GOOGLE_SEARCH_API_KEY via the Cloudflare dashboard. 4. Re-run this probe from /admin/health; it should go green without any Google call.",
    devOpsPlaybook:
      "1. Because CX is a var and not a secret, changing it REQUIRES a redeploy — unlike the Secrets Store values, which are read per request. That asymmetry is the usual reason a fix 'did not take'. 2. Custom Search has a small free daily quota and then bills per 1,000 queries; enable it deliberately, not incidentally. 3. Enrichment call sites: src/backend/services/showroom/brand-enrichment.ts. 4. Verify with `npx wrangler tail --format pretty` while running a brand enrichment from the showroom admin.",
    isBillingRisk: false,
    severity: "LOW",
    run: async (env) => {
      const key = await readSecret(env.GOOGLE_SEARCH_API_KEY);
      const cx = typeof env.GOOGLE_SEARCH_CX === "string" ? env.GOOGLE_SEARCH_CX.trim() : "";
      if (!key && !cx) {
        return degraded("Custom Search is not configured: GOOGLE_SEARCH_API_KEY empty AND GOOGLE_SEARCH_CX empty. Enrichment uses its fallback path — this is the expected default state.");
      }
      if (!key) return degraded(`GOOGLE_SEARCH_CX is set (${cx.length} chars) but GOOGLE_SEARCH_API_KEY is absent — Custom Search cannot run.`);
      if (!cx) {
        return degraded(
          `GOOGLE_SEARCH_API_KEY is readable (${key.length} chars) but the GOOGLE_SEARCH_CX var is empty — no search-engine id, so no query can be issued. Set it in wrangler.jsonc and redeploy.`,
        );
      }
      return ok(`Custom Search configured: key ${key.length} chars, CX ${cx.length} chars.`);
    },
  }),

  defineProbe({
    name: "google_maps_usage_logging_alive",
    displayName: "Google · Maps usage logging alive",
    description:
      "Verifies the `google_maps_usage_log` table exists and, when Maps calls have happened recently, that they are being recorded with useful metadata. This log is the ONLY record of Maps spend this project has; if it stops being written while calls continue, the spend dashboard reads zero and an overrun is invisible until Google bills. Also counts recent non-200 `status_code` rows, which flag quota (429) or auth (403) problems.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "The table exists and the last 7 days of Maps traffic is logged with no meaningful error rate. Spend attribution on /admin/integrations/usage is trustworthy.",
    whatFailureMeans:
      "FAILURE: the table is missing — a migration was never applied to remote, `logUsage` is swallowing its own insert error (it catches and console.errors on purpose so a log failure never breaks a user request), and spend tracking is entirely blind. DEGRADED: more than 10% of recent logged calls returned a non-200 status, which is usually a 429 (quota exhausted) or 403 (key restricted / billing disabled) — the integration is failing upstream even though our code is fine.",
    troubleshootingSteps:
      "1. If FAILURE: `pnpm run migrate:remote`, then confirm with `npx wrangler d1 execute core-remodel --remote --command \"SELECT COUNT(*) FROM google_maps_usage_log\"`. 2. If DEGRADED, find the failing endpoint: `npx wrangler d1 execute core-remodel --remote --command \"SELECT endpoint, status_code, COUNT(*) c FROM google_maps_usage_log WHERE timestamp >= strftime('%s','now','-7 days') GROUP BY endpoint, status_code ORDER BY c DESC\"`. 3. A 429 means quota — check GCP Console → APIs & Services → Quotas for the specific API. 4. A 403 means the key restriction or project billing; check Credentials and the billing account. 5. Watch live: `npx wrangler tail --format pretty | grep 'Failed to log Google Maps usage'` — that string is the swallowed insert error.",
    devOpsPlaybook:
      "1. Never 'fix' logging by removing the try/catch in `logUsage` — the swallow is intentional so a D1 hiccup cannot break address autocomplete; fix the underlying insert instead. 2. This table is append-only by contract: never UPDATE or DELETE rows, and never add a retention job without a plan for preserving monthly totals. 3. Spend review: /admin/integrations/usage. 4. After any schema change here: `pnpm run migrate:remote` BEFORE `wrangler deploy` — new code reading a missing column 500s.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "google_maps_usage_log"))) {
        return failure("Table `google_maps_usage_log` does not exist on this D1 — Maps spend is completely untracked. Run `pnpm run migrate:remote`.");
      }
      const since = Math.floor(Date.now() / 1000) - 7 * DAY;
      const recent = await scalar(env.DB, "SELECT COUNT(*) FROM google_maps_usage_log WHERE timestamp >= ?", since);
      if (recent === 0) {
        const total = await scalar(env.DB, "SELECT COUNT(*) FROM google_maps_usage_log");
        return ok(`No Maps calls logged in the last 7 days (${total} row(s) all-time). Table healthy; nothing spent.`);
      }
      const errors = await scalar(
        env.DB,
        "SELECT COUNT(*) FROM google_maps_usage_log WHERE timestamp >= ? AND status_code IS NOT NULL AND status_code <> 200",
        since,
      );
      if (errors / recent > 0.1) {
        return degraded(`${errors} of ${recent} Maps calls in the last 7 days returned a non-200 status (>10%) — likely 429 quota or 403 key/billing.`);
      }
      return ok(`${recent} Maps call(s) logged in the last 7 days, ${errors} non-200.`);
    },
  }),

  defineProbe({
    name: "google_maps_spend_watch",
    displayName: "Google · Maps call volume vs free credit",
    description:
      "Counts rows in `google_maps_usage_log` over the last 30 days and compares against thresholds tied to the Maps Platform monthly free credit. Places Details and Text Search are the expensive endpoints here (~$17–32 per 1,000), so 5,000 calls a month is the point at which the credit is being materially consumed and 10,000 is where a bill is likely. Also compares the last 24 hours against the trailing 30-day daily average to catch a runaway loop before it runs for a month.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Maps call volume is well inside the monthly free credit and today's volume is in line with the recent average. No spend action needed.",
    whatFailureMeans:
      "DEGRADED: 30-day volume has crossed the warn line, or today is a large multiple of the normal daily rate — something is calling Maps in a loop (a backfill left running, a retry storm, an enrichment job re-processing the same rows). FAILURE: 30-day volume is past the alert line and a real bill is accruing right now. Either way the fix is to stop the caller, not to raise the threshold.",
    troubleshootingSteps:
      "1. Find the culprit endpoint immediately: `npx wrangler d1 execute core-remodel --remote --command \"SELECT endpoint, api_type, COUNT(*) c FROM google_maps_usage_log WHERE timestamp >= strftime('%s','now','-1 day') GROUP BY endpoint, api_type ORDER BY c DESC LIMIT 10\"`. 2. Cross-check the spend view on /admin/integrations/usage. 3. If a backfill is responsible, stop it — the showroom backfill and enrichment paths are the usual sources. 4. Watch live traffic with `npx wrangler tail --format pretty | grep -i places`. 5. As a hard stop, cap the key: GCP Console → APIs & Services → Quotas, set a per-day quota on the offending API.",
    devOpsPlaybook:
      "1. This probe is the early-warning system for a repeat of the Durable-Object billing runaway — treat a DEGRADED here as urgent, not informational. 2. Do NOT raise MAPS_MONTHLY_WARN/ALERT in this file to make it green; the numbers are tied to the actual free credit. 3. Autocomplete is billed per keystroke unless a session token closes the session with a Details call — an autocomplete-heavy day with no matching details rows means session tokens broke; check the `session_token` column. 4. If spend must be stopped instantly, remove the GOOGLE_MAPS_API value from the Secrets Store: every Maps call then fails closed, no redeploy required.",
    isBillingRisk: true,
    severity: "HIGH",
    run: async (env) => {
      if (!(await tableExists(env.DB, "google_maps_usage_log"))) {
        return failure("Table `google_maps_usage_log` does not exist — spend cannot be watched at all. Run `pnpm run migrate:remote`.");
      }
      const now = Math.floor(Date.now() / 1000);
      const month = await scalar(env.DB, "SELECT COUNT(*) FROM google_maps_usage_log WHERE timestamp >= ?", now - 30 * DAY);
      const today = await scalar(env.DB, "SELECT COUNT(*) FROM google_maps_usage_log WHERE timestamp >= ?", now - DAY);
      const dailyAvg = month / 30;

      if (month >= MAPS_MONTHLY_ALERT) {
        return failure(
          `${month} Maps calls in the last 30 days (alert line ${MAPS_MONTHLY_ALERT}) — the monthly free credit is likely exhausted and spend is accruing. Today: ${today}.`,
        );
      }
      if (month >= MAPS_MONTHLY_WARN) {
        return degraded(`${month} Maps calls in the last 30 days (warn line ${MAPS_MONTHLY_WARN}). Today: ${today}, 30d daily average ${dailyAvg.toFixed(1)}.`);
      }
      if (dailyAvg >= 5 && today > dailyAvg * 10) {
        return degraded(
          `Today's Maps volume (${today}) is more than 10x the 30-day daily average (${dailyAvg.toFixed(1)}) — something is calling Maps in a loop.`,
        );
      }
      return ok(`${month} Maps calls in 30 days (${dailyAvg.toFixed(1)}/day), ${today} today. Inside the free-credit envelope.`);
    },
  }),
];
