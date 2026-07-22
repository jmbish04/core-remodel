/**
 * @fileoverview Health probes for the Google Photos Picker integration
 * (`src/backend/services/google-photos/**`).
 *
 * Shape of this integration: 3-legged OAuth, not a service account. The user
 * consents once at `GET /api/google-photos/auth/start`; the callback stores the
 * long-lived refresh token as ONE row in the app-D1 table `google_oauth_tokens`
 * (`provider = "photos"`). Short-lived access tokens are NOT stored in D1 —
 * they are cached in the CACHE KV namespace under `google-photos:access-token`
 * with a TTL, and re-minted from the refresh token on miss. CSRF state nonces
 * live in the same KV under `google-photos:oauth-state:*`.
 *
 * So there are three independent things to check, and they fail differently:
 * the client credentials (config), the refresh token (consent), and the access
 * token cache (runtime). Probes below cover all three without a Google call —
 * minting a token is free but is still an outbound network dependency, so this
 * module deliberately never does it.
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

const FILE = "src/backend/services/google-photos/health.ts";

/** Mirrors `PROVIDER_KEY` / `ACCESS_TOKEN_CACHE_KEY` in ./types.ts. */
const PROVIDER = "photos";
const ACCESS_TOKEN_CACHE_KEY = "google-photos:access-token";

const DAY = 86_400;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "google_photos_oauth_client_configured",
    displayName: "Google Photos · OAuth client id + secret present",
    description:
      "Reads the GOOGLE_PHOTOS_CLIENT_ID and GOOGLE_PHOTOS_CLIENT_SECRET Secrets Store bindings and checks the client id has the `.apps.googleusercontent.com` shape Google issues. Without both, neither the consent redirect nor the refresh-token exchange can be built — the Picker button is dead before any network call happens.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store"],
    whatSuccessMeans:
      "Both halves of the OAuth client are readable and the id is shaped like a real Google OAuth web-client id. `GET /api/google-photos/auth/start` can build a valid consent URL and the callback can exchange the code for a refresh token.",
    whatFailureMeans:
      "A missing id or secret means the Google Photos import path is entirely non-functional: the 'Import from Google Photos' entry in the upload window and on showroom visit photos will error out at the redirect. Nothing is billed and nothing is lost — it is broken, not dangerous.",
    troubleshootingSteps:
      "1. In GCP Console → APIs & Services → Credentials, open the OAuth 2.0 Web application client for this project and copy the Client ID and Client secret. 2. Set them in the Cloudflare dashboard under Secrets Store as GOOGLE_PHOTOS_CLIENT_ID / GOOGLE_PHOTOS_CLIENT_SECRET (these are `secrets_store_secrets` bindings — `npx wrangler secret list` will NOT show them). 3. Confirm the redirect URI registered on that client exactly matches the worker's callback (`/api/google-photos/auth/callback` on the production origin) — a mismatch produces `redirect_uri_mismatch` at consent time, which this probe cannot see. 4. Re-run this probe from /admin/system/health; no redeploy is needed for a Secrets Store change.",
    devOpsPlaybook:
      "1. Rotating the client secret invalidates nothing already stored — the refresh token in `google_oauth_tokens` keeps working as long as the client id is unchanged; rotating the CLIENT ID does require re-consent. 2. The Photos Picker API must be enabled on the GCP project, and the OAuth consent screen must list the picker scopes. 3. Verify end to end by hitting `GET /api/google-photos/status` (admin-gated) and then the auth start URL in a browser. 4. Tail during a consent attempt: `npx wrangler tail --format pretty | grep -i photos`.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const [id, secret] = await Promise.all([
        readSecret(env.GOOGLE_PHOTOS_CLIENT_ID),
        readSecret(env.GOOGLE_PHOTOS_CLIENT_SECRET),
      ]);
      const missing: string[] = [];
      if (!id) missing.push("GOOGLE_PHOTOS_CLIENT_ID");
      if (!secret) missing.push("GOOGLE_PHOTOS_CLIENT_SECRET");
      if (missing.length > 0) {
        return failure(`Absent or empty Secrets Store value(s): ${missing.join(", ")} — the Google Photos import path cannot start.`);
      }
      if (!id!.endsWith(".apps.googleusercontent.com")) {
        return degraded(
          `Client id is present (${id!.length} chars) but does not end in .apps.googleusercontent.com — likely the wrong value pasted into the binding.`,
        );
      }
      return ok(`OAuth client configured (id ${id!.length} chars, secret ${secret!.length} chars).`);
    },
  }),

  defineProbe({
    name: "google_photos_refresh_token_stored",
    displayName: "Google Photos · refresh token stored",
    description:
      "Checks the app-D1 table `google_oauth_tokens` for the single row with `provider = 'photos'` and a non-empty `refresh_token`. This row IS the consent: without it every access-token mint fails and the Picker cannot open a session, no matter how good the client credentials are.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "The homeowner has completed the Google consent flow and the offline refresh token is persisted. Access tokens can be minted on demand indefinitely, so Google Photos import works without any further interaction.",
    whatFailureMeans:
      "FAILURE with a missing table is a deploy-order fault — run the migration. FAILURE with the table present but no `photos` row means consent has never been granted, or the row was cleared; a human must re-authorise in a browser, which no amount of redeploying will do. Google also expires refresh tokens for apps still in 'Testing' on the OAuth consent screen (7 days), which is the most common way a working integration goes dead on its own.",
    troubleshootingSteps:
      "1. Confirm the row: `npx wrangler d1 execute core-remodel --remote --command \"SELECT provider, length(refresh_token) len, scope, updated_at FROM google_oauth_tokens\"` — never select the token value itself. 2. If absent, re-consent: open `/api/google-photos/auth/start` in a signed-in browser and complete the Google flow; the callback upserts the row. 3. If it keeps disappearing after ~7 days, the OAuth consent screen is still in Testing — publish it in GCP Console → APIs & Services → OAuth consent screen. 4. Check `scope` on the row covers the Picker scopes; a re-consent with narrower scopes silently breaks downloads.",
    devOpsPlaybook:
      "1. This is user consent, not configuration — it cannot be restored by a deploy, a secret, or a migration. Escalate to the homeowner to click through the flow. 2. The row is a single upsert keyed on `provider`; re-consenting is safe and idempotent. 3. Never log or return the refresh token — the probe reports presence and length only. 4. If the schema is missing: `pnpm run migrate:remote`, verify on remote, then re-run.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "google_oauth_tokens"))) {
        return failure("Table `google_oauth_tokens` does not exist on this D1 — run `pnpm run migrate:remote`.");
      }
      const rows = await scalar(
        env.DB,
        "SELECT COUNT(*) FROM google_oauth_tokens WHERE provider = ? AND refresh_token IS NOT NULL AND refresh_token <> ''",
        PROVIDER,
      );
      if (rows === 0) {
        return failure(
          `No google_oauth_tokens row for provider='${PROVIDER}' with a refresh token — Google Photos consent has never been granted, or it was revoked. A human must re-authorise via /api/google-photos/auth/start.`,
        );
      }
      const updatedAt = await scalar(
        env.DB,
        "SELECT COALESCE(MAX(updated_at), 0) FROM google_oauth_tokens WHERE provider = ?",
        PROVIDER,
      );
      const ageDays = updatedAt > 0 ? (Math.floor(Date.now() / 1000) - updatedAt) / DAY : -1;
      return ok(
        `Refresh token stored for provider='${PROVIDER}'${ageDays >= 0 ? ` (last updated ${ageDays.toFixed(1)} days ago)` : ""}.`,
      );
    },
  }),

  defineProbe({
    name: "google_photos_access_token_cache",
    displayName: "Google Photos · access-token cache reachable",
    description:
      "Reads the CACHE KV key `google-photos:access-token`. Two things are being checked at once: that the CACHE KV binding itself responds (a bound-but-broken KV would break far more than Photos), and whether a short-lived access token is currently warm. A cache MISS is completely normal — these tokens carry a TTL and expire constantly — so a miss is reported as SUCCESS with a note, never as a fault. Only a KV binding that is absent or throws is a failure.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["kv"],
    whatSuccessMeans:
      "The CACHE KV namespace is bound and readable. If a token is warm, a Picker session can start with zero Google round-trips; if not, the next call re-mints from the refresh token, which is the designed behaviour.",
    whatFailureMeans:
      "The CACHE binding is missing from the deployment or the read threw. That is not a Google Photos problem — it is a Worker configuration problem, and it also takes out the OAuth CSRF state nonces (`google-photos:oauth-state:*`), which means the consent flow will reject its own callback as an invalid state.",
    troubleshootingSteps:
      "1. Confirm the binding: `grep -n 'CACHE' wrangler.jsonc` under `kv_namespaces`. 2. Confirm the deployed version carries it: `npx wrangler deployments list | tail -20`. 3. Inspect the key directly: `npx wrangler kv key get --binding CACHE --remote google-photos:access-token` (expect a value or a miss — never print it into a shared channel). 4. If KV reads throw, check `npx wrangler tail --format pretty` for the underlying error; a namespace id pointing at a deleted namespace fails exactly this way.",
    devOpsPlaybook:
      "1. Clearing a stuck token is safe and is the standard first move after a scope change: `npx wrangler kv key delete --binding CACHE --remote google-photos:access-token` — the next request re-mints. 2. Do not lengthen the cached TTL past Google's own token lifetime; the cache stores whatever expiry Google returned. 3. A KV outage here is worker-wide, not Photos-specific — check the other modules' KV probes on /admin/system/health before chasing this one. 4. After a wrangler.jsonc binding fix, `pnpm run deploy` from `main`.",
    isBillingRisk: false,
    severity: "LOW",
    run: async (env) => {
      const kv = (env as unknown as { CACHE?: KVNamespace }).CACHE;
      if (!kv) return failure("env.CACHE KV binding is undefined — the access-token cache and the OAuth state nonces have nowhere to live.");
      let cached: string | null;
      try {
        cached = await kv.get(ACCESS_TOKEN_CACHE_KEY);
      } catch (err) {
        return failure(`CACHE KV read threw: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!cached) {
        return ok(`CACHE KV readable; no warm access token under "${ACCESS_TOKEN_CACHE_KEY}" (expected — tokens expire and are re-minted on demand).`);
      }
      return ok(`CACHE KV readable; a warm access token is cached (${cached.length} chars).`);
    },
  }),
];
