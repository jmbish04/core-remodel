/**
 * @fileoverview Health probes for the Cloudflare Workflows layer: the nine
 * Workflow bindings exported from `src/_worker.ts`, plus the runtime-configurable
 * cron dispatcher in `src/backend/services/workflow-dispatcher.ts` that fires
 * them from the static `* * * * *` trigger.
 *
 * Cost discipline: these probes NEVER call `.create()`. Creating an instance
 * starts real work (scrapes, image processing, model calls) and would make the
 * health page itself the most expensive thing on the account. Everything here is
 * binding presence, one bounded `get(id).status()` on an instance that already
 * exists, and D1 backlog counts.
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

/** Every Workflow binding declared in `wrangler.jsonc` / `worker-configuration.d.ts`. */
const WORKFLOW_BINDINGS = [
  "IMAGE_PROCESSING_WORKFLOW",
  "CHECKLIST_RATIONALE_WORKFLOW",
  "IMAGE_BATCH_WORKFLOW",
  "SHOWROOM_SCRAPE_WORKFLOW",
  "SHOWROOM_ONBOARDING_WORKFLOW",
  "SHOWROOM_BULK_INTAKE_WORKFLOW",
  "BRAND_RESEARCH_WORKFLOW",
  "PRODUCT_RESEARCH_WORKFLOW",
  "DEEP_RESEARCH_JOB_WORKFLOW",
  "BLANK_CANVAS_WORKFLOW",
] as const;

/** `system_cron_schedules.job_key` → the Workflow binding `workflow-dispatcher.ts` fires. */
const JOB_KEY_BINDINGS: Record<string, string> = {
  checklist_rationale: "CHECKLIST_RATIONALE_WORKFLOW",
};

/** Anything older than this and still unfinished counts as stuck. */
const STUCK_AFTER_SECONDS = 3600;

type AnyWorkflow =
  | { get: (id: string) => Promise<{ status: () => Promise<{ status: string }> }> }
  | undefined;

function workflowOf(env: Env, name: string): AnyWorkflow {
  return (env as unknown as Record<string, AnyWorkflow>)[name];
}

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "workflow_bindings_present",
    displayName: "All 9 Workflow bindings present",
    description:
      `Checks every Workflow binding is attached to the deployed worker: ${WORKFLOW_BINDINGS.join(", ")}. Presence and shape only — no instance is created or fetched.`,
    healthTsFilepath: "src/backend/services/workflows/health.ts",
    bindingTypesTested: ["workflow"],
    whatSuccessMeans:
      "Every long-running job in the platform can be dispatched: image processing and batch processing, showroom scrape and onboarding, brand and product research, the deep-research job runner, blank-canvas generation, and the checklist-rationale cron job.",
    whatFailureMeans:
      "The named workflow cannot be started. The caller throws at dispatch time, so the work never begins — and because most callers write a queued row BEFORE firing the workflow, the backlog tables fill with rows that will never advance. The UI shows 'queued' forever with no error attached.",
    troubleshootingSteps:
      "1. The details string names the absent binding. Check the `workflows` array in `wrangler.jsonc`: each entry needs `binding`, `name` and `class_name`, and the class must be re-exported from `src/_worker.ts`. 2. Workflow NAMES are account-scoped. If a preview deploy claimed an unsuffixed name it will hijack production's binding — confirm `scripts/deploy-preview.mjs` suffixed the names for your branch. 3. Redeploy from `main` with `pnpm run deploy`, then `npx wrangler deployments list | tail -20` and confirm the newest entry is yours. 4. List what actually exists on the account: `npx wrangler workflows list`.",
    devOpsPlaybook:
      "1. Check the backlog probes on this page immediately after — a missing binding usually leaves a queue of orphaned queued rows that must be re-dispatched once it is restored. 2. Do not re-fire the whole backlog at once; these workflows call paid models and external APIs. Re-dispatch in small waves. 3. If the cause was a preview worker claiming a workflow name, delete it (`pnpm run preview:delete` from that branch's worktree, or `pnpm run preview:cleanup -- --apply`) before redeploying production.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const missing = WORKFLOW_BINDINGS.filter((n) => !workflowOf(env, n));
      if (missing.length > 0) {
        return failure(
          `${missing.length}/${WORKFLOW_BINDINGS.length} Workflow bindings missing: ${missing.join(", ")}`,
        );
      }
      return ok(`All ${WORKFLOW_BINDINGS.length} Workflow bindings present`);
    },
  }),

  defineProbe({
    name: "workflow_instance_status_lookup",
    displayName: "Workflow instance status lookup is bounded and working",
    description:
      "Takes the most recent `workflow_run_history` row, maps its `job_key` to a Workflow binding, and calls `get(instanceId).status()`. One lookup, no creation. Proves the runtime can resolve an instance id the app previously handed out.",
    healthTsFilepath: "src/backend/services/workflows/health.ts",
    bindingTypesTested: ["workflow", "d1"],
    whatSuccessMeans:
      "Workflow instance ids recorded in D1 still resolve against the Workflows runtime, so the admin UI's per-run status reads are trustworthy and a stuck job can actually be inspected rather than guessed at.",
    whatFailureMeans:
      "The app has instance ids it cannot resolve. Either the instance aged out of the Workflows retention window (benign, and worth distinguishing) or the binding now points at a differently-named workflow — in which case every status read for historical runs is wrong, not just missing.",
    troubleshootingSteps:
      "1. Read the details for the exact instance id and error text. A 'instance not found' on an OLD id is expected — Workflows do not retain instances forever. 2. Confirm the binding maps to the workflow you think: compare `wrangler.jsonc`'s `workflows[].name` with `npx wrangler workflows list`. 3. Inspect the instance directly: `npx wrangler workflows instances describe <workflow-name> <instance-id>`. 4. If a recent id fails to resolve, a preview deploy probably claimed the account-scoped workflow name — check `pnpm run preview:list` for a stale preview and delete it.",
    devOpsPlaybook:
      "1. Do not re-create the instance to 'restore' status — creating starts the work again, with its full cost. 2. If the binding→name mapping is wrong, fix `wrangler.jsonc`, `pnpm run deploy`, and re-run this probe; historical ids will resolve again without any data migration. 3. If instances merely aged out, record the retention window in the changelog entry so the next 3am reader does not chase it twice.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "workflow_run_history"))) {
        return failure("`workflow_run_history` table is missing — run `pnpm run migrate:remote`");
      }
      const row = await env.DB.prepare(
        "SELECT job_key, workflow_instance_id FROM workflow_run_history ORDER BY id DESC LIMIT 1",
      ).first<{ job_key: string; workflow_instance_id: string }>();
      if (!row) {
        return ok(
          "No workflow_run_history rows yet — nothing to look up. Probe is a no-op until the first dispatch.",
        );
      }
      const bindingName = JOB_KEY_BINDINGS[row.job_key];
      if (!bindingName) {
        return degraded(
          `workflow_run_history has job_key "${row.job_key}" with no binding mapping in this probe or in workflow-dispatcher.ts — the dispatcher will refuse to fire it.`,
        );
      }
      const wf = workflowOf(env, bindingName);
      if (!wf) return failure(`Workflow binding ${bindingName} is absent from this deployment`);
      try {
        const instance = await wf.get(row.workflow_instance_id);
        const status = await instance.status();
        return ok(
          `${bindingName} instance ${row.workflow_instance_id} (job_key=${row.job_key}) resolved with status=${status.status}`,
        );
      } catch (e) {
        return degraded(
          `Could not resolve ${bindingName} instance ${row.workflow_instance_id}: ${e instanceof Error ? e.message : String(e)}. Expected for aged-out instances; investigate if this id is recent.`,
        );
      }
    },
  }),

  defineProbe({
    name: "workflow_cron_dispatcher_healthy",
    displayName: "Cron dispatcher is firing enabled schedules",
    description:
      "Reads `system_cron_schedules` for enabled rows and checks none is more than an hour past its `next_run_at`. `src/_worker.ts` calls `dispatchDueWorkflows()` on the static `* * * * *` trigger, which rolls `last_run_at`/`next_run_at` forward — a stale `next_run_at` means the tick is not reaching the dispatcher.",
    healthTsFilepath: "src/backend/services/workflows/health.ts",
    bindingTypesTested: ["workflow", "d1"],
    whatSuccessMeans:
      "The minute cron is arriving, the dispatcher is reading its schedule table, and every enabled job has been rolled forward to a future run time. Scheduled workflow jobs are actually running on schedule.",
    whatFailureMeans:
      "Scheduled jobs have silently stopped. Nothing errors and nothing appears in a queue — the work simply never happens, which is the hardest failure mode on this page to notice from the outside. Common causes: the cron trigger was stripped from the deployed config, the `scheduled` handler was lost when the OAuthProvider wrapper in `src/_worker.ts` was edited (the provider only implements `fetch`, so the wrapper must forward `scheduled`), or `dispatchDueWorkflows` is throwing before it rolls the schedule forward.",
    troubleshootingSteps:
      "1. Confirm the trigger exists on the live worker: check `triggers.crons` in `wrangler.jsonc` and `npx wrangler deployments list | tail -20` to confirm the newest deploy is from `main`. 2. Confirm the wrapper still forwards scheduled events: `grep -n 'scheduled' src/_worker.ts` — the OAuthProvider wrapper only implements `fetch`, and removing the forward silently kills every cron. 3. Watch a tick land: `npx wrangler tail --format pretty` and wait up to 60 seconds. 4. Inspect the schedule rows: `npx wrangler d1 execute core-remodel --remote --command \"SELECT job_key, enabled, cron_expression, last_run_at, next_run_at FROM system_cron_schedules\"`. 5. Remember previews have their crons stripped on purpose — a preview worker never dispatches, and that is correct, not a bug.",
    devOpsPlaybook:
      "1. Establish how long the gap has been (compare `last_run_at` against now) and state it — the missed work is usually recoverable by one manual dispatch, not by replaying every missed tick. 2. Fix the cause, `pnpm run deploy`, then confirm a tick lands with `npx wrangler tail` before declaring recovery. 3. Do NOT catch up by firing one workflow instance per missed interval; these jobs call paid models. One manual run brings the state current. 4. If a job must stay off, set `enabled = false` on its row rather than deleting it, so this probe stops alerting and the intent is recorded.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      if (!(await tableExists(env.DB, "system_cron_schedules"))) {
        return failure("`system_cron_schedules` table is missing — run `pnpm run migrate:remote`");
      }
      const enabled = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM system_cron_schedules WHERE enabled = 1",
      );
      if (enabled === 0) {
        return ok("No enabled cron schedules — dispatcher has nothing to fire (not a fault).");
      }
      const overdue = await env.DB.prepare(
        "SELECT job_key, next_run_at FROM system_cron_schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at < unixepoch() - ? ORDER BY next_run_at LIMIT 5",
      )
        .bind(STUCK_AFTER_SECONDS)
        .all<{ job_key: string; next_run_at: number }>();
      const rows = overdue.results ?? [];
      if (rows.length > 0) {
        const detail = rows
          .map((r) => `${r.job_key} (${Math.round((Date.now() / 1000 - r.next_run_at) / 60)}m late)`)
          .join(", ");
        return failure(
          `${rows.length} of ${enabled} enabled schedules are over an hour past next_run_at: ${detail}. The minute cron is not reaching dispatchDueWorkflows().`,
        );
      }
      return ok(`${enabled} enabled schedules, none more than an hour past next_run_at`);
    },
  }),

  defineProbe({
    name: "workflow_run_history_backlog",
    displayName: "workflow_run_history queued/running backlog",
    description:
      "Counts `workflow_run_history` rows still in `queued` or `running` more than an hour after they started. The dispatcher inserts a queued row and then fires the workflow, so a pile-up here separates 'never dispatched' from 'dispatched and hung'.",
    healthTsFilepath: "src/backend/services/workflows/health.ts",
    bindingTypesTested: ["d1", "workflow"],
    whatSuccessMeans:
      "Dispatched workflow runs are reaching a terminal state. Nothing is wedged between the D1 bookkeeping row and the Workflows runtime.",
    whatFailureMeans:
      "Rows were written but their workflows never finished — either they were never actually created (a binding fault, see `workflow_bindings_present`), or they are stuck mid-step, or the step that writes the terminal status is failing so successful work looks permanently queued. The third case is the nastiest: the work happened, possibly repeatedly, and only the bookkeeping is wrong.",
    troubleshootingSteps:
      "1. List the stuck rows: `npx wrangler d1 execute core-remodel --remote --command \"SELECT id, job_key, workflow_instance_id, status, started_at, error_message FROM workflow_run_history WHERE status IN ('queued','running') AND started_at < unixepoch()-3600 ORDER BY started_at LIMIT 20\"`. 2. Ask the runtime what really happened to one of them: `npx wrangler workflows instances describe <workflow-name> <instance-id>` — if it says complete while D1 says running, the terminal write is the bug. 3. If the runtime has no such instance, the create never happened; check the binding and the dispatcher logs with `npx wrangler tail`. 4. Grep the workflow class for the step that writes the final status and confirm it is not inside a branch that can be skipped.",
    devOpsPlaybook:
      "1. Reconcile D1 to the runtime, not the other way round: update stale rows to the status `wrangler workflows instances describe` reports. Never re-create an instance just to make a row terminal — that pays for the work twice. 2. If dozens are stuck, fix the terminal-write bug first, then reconcile in one batch. 3. Record the reconciliation (count and window) in the changelog entry's verification block.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "workflow_run_history"))) {
        return failure("`workflow_run_history` table is missing — run `pnpm run migrate:remote`");
      }
      const stuck = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM workflow_run_history WHERE status IN ('queued','running') AND started_at < unixepoch() - ?",
        STUCK_AFTER_SECONDS,
      );
      const failed24h = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM workflow_run_history WHERE status = 'failed' AND started_at > unixepoch() - 86400",
      );
      if (stuck >= 10) {
        return failure(
          `${stuck} workflow_run_history rows stuck in queued/running for over an hour (${failed24h} failed in the last 24h)`,
        );
      }
      if (stuck > 0) {
        return degraded(
          `${stuck} workflow_run_history rows have been queued/running for over an hour (${failed24h} failed in the last 24h)`,
        );
      }
      return ok(
        `No workflow_run_history rows stuck beyond an hour; ${failed24h} failed in the last 24h`,
      );
    },
  }),

  defineProbe({
    name: "workflow_job_table_backlog",
    displayName: "Workflow-backed job tables backlog",
    description:
      "Counts stale unfinished rows across the three job tables that workflows drain: `research_jobs` (pending/running, DEEP_RESEARCH_JOB / BRAND / PRODUCT research), `image_upload_staging` (processing_status queued/processing, IMAGE_PROCESSING / IMAGE_BATCH) and `blank_canvas_generation_jobs` (running, BLANK_CANVAS). Stale = older than an hour.",
    healthTsFilepath: "src/backend/services/workflows/health.ts",
    bindingTypesTested: ["d1", "workflow"],
    whatSuccessMeans:
      "Research jobs, uploaded images and blank-canvas generations are all draining. What users submit is finishing rather than accumulating out of sight.",
    whatFailureMeans:
      "Submitted work is piling up with no user-visible error. Uploaded photos never gain their AI tags/categories, research reports never appear, canvases never render. Historically the real error is hidden — `image_upload_staging.processing_error` holds the message while the UI shows only a spinner — so this probe is often the first place the fault is visible at all.",
    troubleshootingSteps:
      "1. Read the actual errors, they are stored per row: `npx wrangler d1 execute core-remodel --remote --command \"SELECT processing_status, processing_error, COUNT(*) c FROM image_upload_staging WHERE processing_status IN ('queued','processing') GROUP BY processing_status, processing_error ORDER BY c DESC LIMIT 10\"`. 2. Same for research: `... \"SELECT status, error, COUNT(*) c FROM research_jobs WHERE status IN ('pending','running') GROUP BY status, error LIMIT 10\"`. 3. A Workers AI `3040` (capacity) error under a large batch is the known cause for image backlogs — the wave-of-3 throttle and the auto-heal cron exist for exactly this; confirm the cron is enabled via the `workflow_cron_dispatcher_healthy` probe. 4. If every row is `queued` with a NULL error, the workflow was never created — check `workflow_bindings_present` and `npx wrangler tail` at submit time.",
    devOpsPlaybook:
      "1. Distinguish capacity from breakage before acting: capacity errors drain on their own once the auto-heal cron runs, breakage does not. 2. When re-driving a backlog, do it in small waves — these workflows call paid models and a full-backlog re-fire is a spend event. 3. Never mark rows processed to clear the number; the row is the only record that the work is outstanding. 4. After the fix, re-run this probe and confirm the count falls over successive runs rather than in one jump.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const parts: string[] = [];
      let worst = 0;

      if (await tableExists(env.DB, "research_jobs")) {
        const n = await scalar(
          env.DB,
          "SELECT COUNT(*) AS c FROM research_jobs WHERE status IN ('pending','running') AND created_at < unixepoch() - ?",
          STUCK_AFTER_SECONDS,
        );
        parts.push(`research_jobs=${n}`);
        worst = Math.max(worst, n);
      } else {
        parts.push("research_jobs=missing");
      }

      if (await tableExists(env.DB, "image_upload_staging")) {
        const n = await scalar(
          env.DB,
          "SELECT COUNT(*) AS c FROM image_upload_staging WHERE processing_status IN ('queued','processing') AND datetime_created < unixepoch() - ?",
          STUCK_AFTER_SECONDS,
        );
        parts.push(`image_upload_staging=${n}`);
        worst = Math.max(worst, n);
      } else {
        parts.push("image_upload_staging=missing");
      }

      if (await tableExists(env.DB, "blank_canvas_generation_jobs")) {
        const n = await scalar(
          env.DB,
          "SELECT COUNT(*) AS c FROM blank_canvas_generation_jobs WHERE status = 'running' AND updated_at < unixepoch() - ?",
          STUCK_AFTER_SECONDS,
        );
        parts.push(`blank_canvas_generation_jobs=${n}`);
        worst = Math.max(worst, n);
      } else {
        parts.push("blank_canvas_generation_jobs=missing");
      }

      const summary = `stale >1h: ${parts.join(", ")}`;
      if (parts.some((p) => p.endsWith("=missing"))) {
        return failure(`A workflow job table is missing — run \`pnpm run migrate:remote\`. ${summary}`);
      }
      if (worst >= 50) return failure(`Large workflow backlog — ${summary}`);
      if (worst >= 10) return degraded(`Workflow backlog building — ${summary}`);
      return ok(`Workflow job tables draining normally — ${summary}`);
    },
  }),
];
