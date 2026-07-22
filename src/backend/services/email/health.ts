/**
 * @fileoverview Health probes for the inbound/outbound email module
 * (`src/backend/services/email/**` + the Worker's `email()` handler).
 *
 * What this module actually is: Cloudflare Email Routing delivers mail for
 * `remodel@hacolby.app` to the Worker's `email()` handler, which calls
 * `handleInboundEmail` (`router.ts`). That applies the RFC 3834 auto-reply
 * guard, resolves a route from the recipient address (`routes.ts` — a CODE
 * registry, not a D1 table), and hands off to `pipeline.ts`, which inserts one
 * `worker_emails` row per message and drives it through
 * pending → classified → processed/reviewed/rejected.
 *
 * Cost discipline: every probe here is binding presence + indexed D1 counts.
 * Nothing sends mail, nothing calls the AI classifier.
 */
import {
  defineProbe,
  degraded,
  failure,
  ok,
  scalar,
  tableExists,
  type HealthProbe,
} from "@backend/services/health/types";

const FILE = "src/backend/services/email/health.ts";

/** Route ids declared in `routes.ts`. A row's `route` column should be one of these. */
const KNOWN_ROUTES = ["invoices", "contracts", "general"] as const;

const DAY = 86_400;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "email_send_binding_present",
    displayName: "Email · SendEmail binding present",
    description:
      "Checks that the `EMAIL` SendEmail binding is attached to the running Worker. This is the outbound half of Cloudflare Email Service (wrangler.jsonc `send_email: [{ name: EMAIL, remote: true }]`); it is also the binding whose presence proves the email section of the config survived the last deploy.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["email"],
    whatSuccessMeans:
      "`env.EMAIL` exists and exposes a callable `send()`. Outbound mail (notifications, future auto-replies) has a transport. Note this does NOT prove the destination address is verified in Cloudflare Email Routing — only that the binding is wired.",
    whatFailureMeans:
      "The binding is missing or is not a SendEmail object. Any code path that calls `env.EMAIL.send()` will throw a TypeError at runtime. The usual cause is a deploy from a config that lost the `send_email` block, or a preview worker whose derived config dropped it.",
    troubleshootingSteps:
      "1. Confirm the block is still in wrangler.jsonc: `grep -n 'send_email' wrangler.jsonc` — expect `\"send_email\": [{ \"name\": \"EMAIL\", \"remote\": true }]`. 2. Confirm the deployed version has it: `npx wrangler deployments list | tail -20` and check the newest entry is yours. 3. Re-run this probe from /admin/health after a redeploy. 4. If wrangler.jsonc is correct but the binding is absent in production, the running code predates the config change — see step 2 of the playbook.",
    devOpsPlaybook:
      "1. From `main`, after pulling: `pnpm run deploy` (build → migrate:remote → migrate:tesla:remote → wrangler deploy). 2. Verify: `npx wrangler deployments list | tail -20`. 3. Tail for the actual send error if the binding is present but sends fail: `npx wrangler tail --format pretty | grep -i email`. 4. Destination addresses must be verified in the Cloudflare dashboard under Email → Email Routing; a binding cannot send to an unverified destination.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const binding = (env as unknown as { EMAIL?: { send?: unknown } }).EMAIL;
      if (!binding) return failure("env.EMAIL is undefined — the send_email binding is not attached to this deployment.");
      if (typeof binding.send !== "function") {
        return failure("env.EMAIL exists but has no send() method — the binding is not a SendEmail object.");
      }
      return ok("env.EMAIL is bound and exposes send().");
    },
  }),

  defineProbe({
    name: "email_inbound_routing_coverage",
    displayName: "Email · inbound routing coverage",
    description:
      "Reads `worker_emails` and checks that inbound mail is being assigned a route. Routing rules live in code (`services/email/routes.ts` — invoices / contracts / general), so this probe does not look for a config table; it looks for the OUTPUT of routing: the `route` column populated with a known route id. Rows predating routing are legitimately null, so the probe only judges the last 30 days.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Every inbound email in the last 30 days carries a `route` value, and every value is one of the ids declared in routes.ts. The address-tier resolver is running and its output is being persisted.",
    whatFailureMeans:
      "FAILURE means the `worker_emails` table does not exist — a migration has not been applied to the remote D1, and the entire inbound path is dead (the pipeline's first insert throws). DEGRADED means recent rows have a null or unrecognised `route`: either `resolveRoute` returned nothing and the pipeline stored it anyway, or a route id was added to routes.ts without being added to this probe's KNOWN_ROUTES list.",
    troubleshootingSteps:
      "1. If FAILURE: `pnpm run migrate:remote`, then re-check the table exists. 2. If DEGRADED with nulls: open /admin/inbox/all and inspect the offending rows' `route_reason` column — it records why a route was chosen. 3. Compare the observed route values against `ROUTE_RULES` in src/backend/services/email/routes.ts; if a new route id was legitimately added, add it to KNOWN_ROUTES in this file. 4. Reproduce by sending a test message to remodel+invoices@hacolby.app and watching `npx wrangler tail --format pretty | grep email-router`.",
    devOpsPlaybook:
      "1. Schema drift is the first suspect after any deploy: `pnpm run migrate:remote` and verify the column exists on remote before assuming a code bug. 2. Routing decisions are logged by the router — `npx wrangler tail --format pretty` and send yourself a message. 3. Unknown recipients are rejected at SMTP time on purpose (`onNoRoute` → `message.setReject`); a bounce is not a defect. 4. Review queue: /admin/inbox/all.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      if (!(await tableExists(env.DB, "worker_emails"))) {
        return failure("Table `worker_emails` does not exist on this D1 — run `pnpm run migrate:remote`.");
      }
      const since = Math.floor(Date.now() / 1000) - 30 * DAY;
      const recent = await scalar(env.DB, "SELECT COUNT(*) FROM worker_emails WHERE created_at >= ?", since);
      if (recent === 0) {
        const total = await scalar(env.DB, "SELECT COUNT(*) FROM worker_emails");
        return ok(`No inbound email in the last 30 days (${total} row(s) all-time) — nothing to route, table healthy.`);
      }
      const unrouted = await scalar(
        env.DB,
        "SELECT COUNT(*) FROM worker_emails WHERE created_at >= ? AND (route IS NULL OR route = '')",
        since,
      );
      const placeholders = KNOWN_ROUTES.map(() => "?").join(",");
      const unknown = await scalar(
        env.DB,
        `SELECT COUNT(*) FROM worker_emails WHERE created_at >= ? AND route IS NOT NULL AND route <> '' AND route NOT IN (${placeholders})`,
        since,
        ...KNOWN_ROUTES,
      );
      if (unrouted > 0 || unknown > 0) {
        return degraded(
          `${recent} email(s) in 30d: ${unrouted} with no route, ${unknown} with a route id not in routes.ts (${KNOWN_ROUTES.join("/")}).`,
        );
      }
      return ok(`${recent} email(s) in 30d, all routed to a known route id (${KNOWN_ROUTES.join("/")}).`);
    },
  }),

  defineProbe({
    name: "email_pipeline_processing_liveness",
    displayName: "Email · pipeline processing backlog",
    description:
      "Watches for inbound email that got stuck. `pipeline.ts` moves a row pending → classified → processed/reviewed. A row still `pending` hours after arrival means the background `ctx.waitUntil` work never completed (AI failure, thrown insert, evicted isolate). Counts rows older than 6 hours still in `pending`, and the share of the last 7 days still `pending`.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "No inbound email older than 6 hours is still in `pending`. The classifier ran and the pipeline advanced every message past intake. (Rows sitting in `classified` are normal — that is the human-review state.)",
    whatFailureMeans:
      "DEGRADED: a handful of stale `pending` rows — usually one bad message that threw during classification, or a Workers AI hiccup. FAILURE: more than a quarter of the last week's mail is stuck, which means the pipeline is broken rather than flaky — most often a schema/migration mismatch or the AI classifier erroring on every call.",
    troubleshootingSteps:
      "1. List the stuck rows at /admin/inbox/all filtered to status=pending, and note their `created_at` spread — a single burst points at one incident, an even spread points at a persistent break. 2. Look for the pipeline's own errors: `npx wrangler tail --format pretty | grep email-pipeline`. 3. Confirm no unapplied migration: `pnpm run migrate:remote` (new code + missing column = 500 on every insert). 4. Re-send one of the stuck messages to remodel@hacolby.app to reproduce live, then read the tail.",
    devOpsPlaybook:
      "1. This is a background-work failure, not an SMTP failure — the mail was accepted, so nothing is lost; re-processing is a re-classify, not a re-send. 2. If the classifier is the cause, check Workers AI errors in the tail and on /admin/integrations/usage. 3. After any fix: `pnpm run deploy` from `main`, then re-run this probe from /admin/health. 4. Escalate to a manual review pass in /admin/inbox/all if the backlog is older than a week — stale invoices/contracts are the actual business risk here.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      if (!(await tableExists(env.DB, "worker_emails"))) {
        return failure("Table `worker_emails` does not exist on this D1 — run `pnpm run migrate:remote`.");
      }
      const now = Math.floor(Date.now() / 1000);
      const stuck = await scalar(
        env.DB,
        "SELECT COUNT(*) FROM worker_emails WHERE status = 'pending' AND created_at < ?",
        now - 6 * 3600,
      );
      const week = await scalar(env.DB, "SELECT COUNT(*) FROM worker_emails WHERE created_at >= ?", now - 7 * DAY);
      const weekStuck = await scalar(
        env.DB,
        "SELECT COUNT(*) FROM worker_emails WHERE created_at >= ? AND status = 'pending'",
        now - 7 * DAY,
      );
      if (week > 0 && weekStuck / week > 0.25) {
        return failure(
          `${weekStuck} of ${week} email(s) received in the last 7 days are still status='pending' (>25%) — the processing pipeline is not completing.`,
        );
      }
      if (stuck > 0) {
        return degraded(`${stuck} email(s) older than 6h are still status='pending' (7d volume: ${week}).`);
      }
      return ok(`No email older than 6h stuck in 'pending'. 7d volume: ${week}.`);
    },
  }),

  defineProbe({
    name: "email_dedupe_guardrail_intact",
    displayName: "Email · dedupe + loop guardrails intact",
    description:
      "The mail-loop guardrails are (a) the RFC 3834 auto-reply drop in router.ts, which happens before any write, and (b) the UNIQUE index `worker_emails_message_id_idx` on `message_id`, which is what makes the pipeline's duplicate check correct rather than best-effort. This probe verifies the unique index still exists and that no duplicate Message-ID has slipped through.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "The unique index on `worker_emails.message_id` is present and there are zero duplicate non-null Message-IDs. A redelivered or looped message cannot be processed twice, so invoices and contracts cannot be double-extracted.",
    whatFailureMeans:
      "FAILURE: the unique index is gone — a migration rebuilt the table without it (D1 column drops rebuild tables, which is exactly how an index gets silently lost). Duplicate processing is now possible and the pipeline's read-then-insert check is a race, not a guarantee. DEGRADED: duplicates already exist in the data, so something wrote around the check.",
    troubleshootingSteps:
      "1. Confirm the index: `npx wrangler d1 execute core-remodel --remote --command \"SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='worker_emails'\"`. 2. If it is missing, find the migration that rebuilt the table under drizzle/ and re-generate: `pnpm run db:generate`, then `pnpm run migrate:remote` — never hand-write the SQL. 3. Find the duplicates: same d1 execute with `SELECT message_id, COUNT(*) c FROM worker_emails WHERE message_id IS NOT NULL GROUP BY message_id HAVING c > 1`. 4. Check downstream damage in /admin/inbox/all — duplicate invoice/contract extractions are the consequence that matters.",
    devOpsPlaybook:
      "1. Never repair this with raw SQL against remote — regenerate the drizzle migration and apply with `pnpm run migrate:remote`, or the schema and migrations diverge permanently. 2. Deduplicate the rows BEFORE re-adding the unique index; the index creation will fail while duplicates exist. 3. The auto-reply guard has no persistent state to check — verify it live by sending a message with an `Auto-Submitted: auto-replied` header and watching `npx wrangler tail --format pretty | grep 'dropping auto-reply'`. 4. Review at /admin/inbox/all.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "worker_emails"))) {
        return failure("Table `worker_emails` does not exist on this D1 — run `pnpm run migrate:remote`.");
      }
      const idx = await scalar(
        env.DB,
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='worker_emails' AND name='worker_emails_message_id_idx'",
      );
      if (idx === 0) {
        return failure(
          "UNIQUE index `worker_emails_message_id_idx` is missing — duplicate Message-IDs can now be processed twice.",
        );
      }
      const dupes = await scalar(
        env.DB,
        "SELECT COUNT(*) FROM (SELECT message_id FROM worker_emails WHERE message_id IS NOT NULL AND message_id <> '' GROUP BY message_id HAVING COUNT(*) > 1)",
      );
      if (dupes > 0) {
        return degraded(`Unique index present, but ${dupes} Message-ID(s) appear on more than one row.`);
      }
      return ok("Unique index on worker_emails.message_id present; no duplicate Message-IDs.");
    },
  }),
];
