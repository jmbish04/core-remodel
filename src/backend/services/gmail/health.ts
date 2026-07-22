/**
 * @fileoverview Health probes for the Gmail Comms Hub
 * (`src/backend/services/gmail/**`).
 *
 * How this subsystem authenticates: a Google Workspace service account with
 * domain-wide delegation. `auth.ts` builds an RS256 JWT assertion and exchanges
 * it for a Gmail bearer token. The PKCS8 private key EXCEEDS the Secrets Store
 * single-value size limit, so it is stored split across
 * `GOOGLE_CREDS_SA_PRIVATE_KEY_PT_1` + `_PT_2` and concatenated at use time —
 * which means "both halves present" is not enough; they must also rejoin into a
 * parseable PEM. That re-join is the single most fragile thing in this module
 * and the reason the first probe exists.
 *
 * Ingestion (`ingestion.ts` → `ingestCompanyEmails`) runs on the four-hourly
 * cron trigger and writes `gmail_threads` / `gmail_messages` in the app D1.
 *
 * Cost discipline: NOTHING here calls Google. The credential probes only read
 * the Secrets Store and inspect the string locally; the freshness probes are
 * indexed D1 counts.
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

const FILE = "src/backend/services/gmail/health.ts";

const DAY = 86_400;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "gmail_sa_private_key_recombines",
    displayName: "Gmail · service-account key halves recombine to a PEM",
    description:
      "Reads GOOGLE_CREDS_SA_PRIVATE_KEY_PT_1 and _PT_2 from the Secrets Store and checks that concatenating them (PT_1 + PT_2, in that order — the same order auth.ts uses) yields something shaped like a PKCS8 PEM: it starts with '-----BEGIN' and ends with a matching '-----END PRIVATE KEY-----'. Catches the split-secret failure that a plain presence check cannot see. Purely local string work — no call to Google, no token minted.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store"],
    whatSuccessMeans:
      "Both halves are readable and rejoin into a well-formed PKCS8 PEM with intact BEGIN/END armor. `auth.ts` will be able to base64-decode the body and import it via crypto.subtle.importKey, so Gmail token minting has a usable signing key.",
    whatFailureMeans:
      "Either a half is missing/unreadable, or the rejoined string is not a PEM — the halves were split mid-armor, pasted in the wrong order, or one half was truncated on entry. Every Gmail call fails with 'failed to import service account private key' or 'failed to base64-decode service account private key'. Gmail ingestion silently produces zero new messages on each 4-hourly cron.",
    troubleshootingSteps:
      "1. Confirm both bindings exist on the deployed worker: `npx wrangler secret list` and check the Secrets Store entries in the Cloudflare dashboard (Secrets Store, not Worker secrets — these are `secrets_store_secrets` bindings in wrangler.jsonc). 2. Re-split the key from the original service-account JSON: take the full `private_key` value INCLUDING the '-----BEGIN PRIVATE KEY-----' and '-----END PRIVATE KEY-----' lines, cut it at a point that leaves the BEGIN header wholly in PT_1 and the END footer wholly in PT_2, and re-enter both. 3. Re-run this probe from /admin/system/health — it verifies the join without spending a Google call. 4. Only then test end to end by triggering ingestion and watching `npx wrangler tail --format pretty | grep gmail`.",
    devOpsPlaybook:
      "1. Rotating this key means generating a new JSON key in Google Cloud Console for the service account, re-splitting it, and updating BOTH halves — updating one is the classic half-broken state this probe catches. 2. Secrets Store values are read at request time, so no redeploy is needed after an update; re-run the probe to confirm. 3. If the key is valid but Gmail still 401s, the fault is domain-wide delegation, not the key: every scope in GMAIL_SCOPES (gmail.modify, gmail.compose, gmail.labels, gmail.settings.basic) must be delegated in Workspace Admin → Security → API controls → Domain-wide delegation, or Google rejects the whole exchange with `unauthorized_client`. 4. Never log the recombined value — this probe deliberately reports only lengths and the armor check.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const [pt1, pt2] = await Promise.all([
        readSecret(env.GOOGLE_CREDS_SA_PRIVATE_KEY_PT_1),
        readSecret(env.GOOGLE_CREDS_SA_PRIVATE_KEY_PT_2),
      ]);
      const missing: string[] = [];
      if (!pt1) missing.push("GOOGLE_CREDS_SA_PRIVATE_KEY_PT_1");
      if (!pt2) missing.push("GOOGLE_CREDS_SA_PRIVATE_KEY_PT_2");
      if (missing.length > 0) {
        return failure(`Unreadable or empty Secrets Store value(s): ${missing.join(", ")}.`);
      }
      const pem = `${pt1}${pt2}`;
      const trimmed = pem.trim();
      if (!trimmed.startsWith("-----BEGIN")) {
        return failure(
          `PT_1+PT_2 (${trimmed.length} chars) does not start with "-----BEGIN" — the halves are out of order or PT_1 is missing the PEM header.`,
        );
      }
      if (!trimmed.includes("-----END")) {
        return failure(
          `PT_1+PT_2 (${trimmed.length} chars) has a BEGIN header but no "-----END" footer — PT_2 is truncated or missing.`,
        );
      }
      return ok(
        `PT_1 (${pt1!.length} chars) + PT_2 (${pt2!.length} chars) recombine into a ${trimmed.length}-char PEM with intact BEGIN/END armor.`,
      );
    },
  }),

  defineProbe({
    name: "gmail_sa_client_email_present",
    displayName: "Gmail · service-account client email present",
    description:
      "Reads GOOGLE_CREDS_SA_CLIENT_EMAIL and checks it is a plausible service-account address (contains '@' and the '.iam.gserviceaccount.com' suffix Google issues). This value is the JWT `iss` in auth.ts; a wrong or truncated value produces `invalid_grant` from Google's token endpoint, which reads like a key problem but is not.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["secrets_store"],
    whatSuccessMeans:
      "The service-account identity is readable and shaped like a real GCP service-account email, so the JWT assertion will carry a valid issuer.",
    whatFailureMeans:
      "FAILURE: the binding is absent or empty — no Gmail token can be minted at all. DEGRADED: a value is present but does not look like `<name>@<project>.iam.gserviceaccount.com`; it may still work (Workspace setups vary) but is far more likely a paste of the wrong field from the service-account JSON, e.g. `client_id` instead of `client_email`.",
    troubleshootingSteps:
      "1. Open the service-account JSON key file and copy the `client_email` field verbatim — not `client_id`, not the OAuth client email. 2. Update the Secrets Store entry GOOGLE_CREDS_SA_CLIENT_EMAIL in the Cloudflare dashboard. 3. Re-run this probe from /admin/system/health. 4. If it looks right and Google still returns `invalid_grant`, check the impersonated user (`sub`) exists in the Workspace domain — auth.ts impersonates justin@126colby.com.",
    devOpsPlaybook:
      "1. Client email + private key must come from the SAME service-account key; mixing a new key with an old identity fails in a way that looks random. 2. `npx wrangler secret list` shows Worker secrets; Secrets Store bindings are managed in the dashboard under Secrets Store. 3. No redeploy needed after an update — Secrets Store reads happen per request. 4. Confirm end to end by watching the next 4-hourly ingestion cron: `npx wrangler tail --format pretty | grep 'gmail ingestion'`.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const email = await readSecret(env.GOOGLE_CREDS_SA_CLIENT_EMAIL);
      if (!email) return failure("GOOGLE_CREDS_SA_CLIENT_EMAIL is absent or empty — no JWT issuer, no Gmail token.");
      if (!email.includes("@")) {
        return failure(`GOOGLE_CREDS_SA_CLIENT_EMAIL (${email.length} chars) is not an email address.`);
      }
      if (!email.endsWith(".iam.gserviceaccount.com")) {
        return degraded(
          `GOOGLE_CREDS_SA_CLIENT_EMAIL is an address but does not end in .iam.gserviceaccount.com — likely the wrong field from the service-account JSON.`,
        );
      }
      return ok(`Service-account client email present (${email.length} chars, .iam.gserviceaccount.com).`);
    },
  }),

  defineProbe({
    name: "gmail_sync_tables_present",
    displayName: "Gmail · sync tables present and populated",
    description:
      "Checks that `gmail_threads` and `gmail_messages` exist in the app D1 and hold rows. These are written only by `ingestCompanyEmails`; an empty pair after the integration has been live means ingestion has never successfully completed a run.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Both tables exist and contain threads and messages — the domain-matched company inbox at /admin/inbox/gmail has data to render and the ingestion cron has succeeded at least once.",
    whatFailureMeans:
      "A missing table is a deploy-order fault: code shipped ahead of `pnpm run migrate:remote`, and every Gmail read endpoint will 500. Tables present but empty is DEGRADED — most often auth is failing (see the two credential probes) or no company in the directory has a matchable email domain to ingest against.",
    troubleshootingSteps:
      "1. If a table is missing: `pnpm run migrate:remote`, then verify with `npx wrangler d1 execute core-remodel --remote --command \"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'gmail_%'\"`. 2. If empty: check the two Gmail credential probes on /admin/system/health first — a broken key produces exactly this. 3. Watch a live run: `npx wrangler tail --format pretty | grep 'gmail ingestion'` (cron `15 */4 * * *`). 4. Confirm the directory has companies with email domains to match against — ingestion is domain-driven, so zero matchable companies yields zero threads.",
    devOpsPlaybook:
      "1. Migrations do not ride the build — after any schema PR, `pnpm run migrate:remote` and verify on remote before believing a 500 is a code bug. 2. Full deploy from `main`: `pnpm run deploy`. 3. The UI is /admin/inbox/gmail; a blank page there with green credentials points at ingestion, not the frontend. 4. Ingestion is bounded per run by design — a slowly filling table is normal on first setup, not a fault.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const missing: string[] = [];
      for (const t of ["gmail_threads", "gmail_messages"]) {
        if (!(await tableExists(env.DB, t))) missing.push(t);
      }
      if (missing.length > 0) {
        return failure(`Missing table(s): ${missing.join(", ")} — run \`pnpm run migrate:remote\`.`);
      }
      const threads = await scalar(env.DB, "SELECT COUNT(*) FROM gmail_threads");
      const messages = await scalar(env.DB, "SELECT COUNT(*) FROM gmail_messages");
      if (threads === 0 || messages === 0) {
        return degraded(`Tables exist but are empty (threads=${threads}, messages=${messages}) — ingestion has never landed rows.`);
      }
      return ok(`gmail_threads=${threads}, gmail_messages=${messages}.`);
    },
  }),

  defineProbe({
    name: "gmail_sync_recency",
    displayName: "Gmail · ingestion recency",
    description:
      "Reads the newest `gmail_messages.created_at` (when WE ingested it, not when the mail was sent) and compares it to now. Ingestion runs every 4 hours (cron `15 */4 * * *`), but this timestamp only advances when there is new mail to ingest, so a quiet inbox is not a fault. Thresholds are therefore deliberately loose: DEGRADED at 14 days, and never FAILURE on recency alone — FAILURE is reserved for a missing table.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Something was ingested within the last 14 days, so the credential chain, the cron, and the write path all worked recently. This is the cheapest end-to-end evidence available without calling Google.",
    whatFailureMeans:
      "DEGRADED at >14 days is ambiguous by design and must be read alongside the credential probes: if the key/client-email probes are green, a quiet mailbox is the likely explanation and no action is needed; if either is red, the silence is the ingestion failing and you have a start date for the outage. FAILURE means `gmail_messages` is gone — a migration was not applied.",
    troubleshootingSteps:
      "1. Check gmail_sa_private_key_recombines and gmail_sa_client_email_present on /admin/system/health FIRST — silence plus a broken credential is an outage, silence alone is not. 2. Confirm the cron is still registered: `grep -n 'crons' wrangler.jsonc` (expect `15 */4 * * *`) and `npx wrangler deployments list | tail -20` to confirm the current deploy carries it. 3. Watch the next run: `npx wrangler tail --format pretty | grep 'gmail ingestion'` — it logs companies/threads/messages counts on every run, including zeros. 4. Cross-check /admin/inbox/gmail against the real mailbox to see whether mail genuinely arrived in the window.",
    devOpsPlaybook:
      "1. Crons are stripped from preview workers on purpose, so this probe is meaningless against a preview — judge it on production only. 2. If ingestion is erroring, the scheduled handler catches and logs it (`[scheduled] gmail ingestion failed:`) rather than throwing, so the tail is the only place the error surfaces. 3. After a credential fix, do not wait 4 hours to confirm — re-run the credential probes, then check this one on the next cron tick. 4. Deploy from `main` with `pnpm run deploy` after any fix.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "gmail_messages"))) {
        return failure("Table `gmail_messages` does not exist on this D1 — run `pnpm run migrate:remote`.");
      }
      const newest = await scalar(env.DB, "SELECT COALESCE(MAX(created_at), 0) FROM gmail_messages");
      if (newest === 0) {
        return degraded("No gmail_messages rows at all — ingestion has never landed a message.");
      }
      const ageDays = (Math.floor(Date.now() / 1000) - newest) / DAY;
      if (ageDays > 14) {
        return degraded(
          `Newest ingested Gmail message is ${ageDays.toFixed(1)} days old (>14d). Check the credential probes before treating this as an outage — a quiet mailbox looks identical.`,
        );
      }
      return ok(`Newest ingested Gmail message is ${ageDays.toFixed(1)} days old.`);
    },
  }),
];
