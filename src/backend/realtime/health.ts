/**
 * @fileoverview Health probes for the realtime / Durable Object layer.
 *
 * Covers the two hand-written realtime hubs in this folder — `EstimateCollabHub`
 * (`ESTIMATE_COLLAB`, the fan-out room used by `publish.ts`) and
 * `FloorplanSessionDO` (`FLOORPLAN_SESSION`, the phone ↔ Claude wall-touch room) —
 * plus binding presence for every Durable Object namespace the worker exports.
 *
 * Cost note: Durable Objects bill for wall-clock while awake, so these probes do
 * the minimum that proves reachability — binding presence, stub addressing (which
 * does not instantiate anything), and a single `GET .../health` against a dedicated
 * probe room whose handler only counts sockets. Nothing here writes DO storage,
 * opens a socket, sets an alarm, or invokes an agent.
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

/** The two realtime fan-out hubs owned by `src/backend/realtime/`. */
const REALTIME_HUBS = ["ESTIMATE_COLLAB", "FLOORPLAN_SESSION"] as const;

/** Every agent-hosting Durable Object namespace exported from `src/_worker.ts`. */
const AGENT_NAMESPACES = [
  "RENOVATION_AGENT",
  "BUDGET_AGENT",
  "A2A_V2",
  "BID_PORTFOLIO_AGENT",
  "RESEARCH_AGENT",
  "PERMIT_INTELLIGENCE_AGENT",
  "SHOWROOM_RESEARCH_AGENT",
  "DEEP_RESEARCH_AGENT",
  "SHOWROOM_SCOUT",
  "REMODEL_ORCHESTRATOR",
  "ADMIN_CHAT_AGENT",
  "REMODEL_MCP",
] as const;

/** Room name used by the probes. Distinct from any real room so it never collides. */
const PROBE_ROOM = "__health-probe";

type AnyNamespace = DurableObjectNamespace<never> | undefined;

function namespaceOf(env: Env, name: string): AnyNamespace {
  return (env as unknown as Record<string, AnyNamespace>)[name];
}

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "do_realtime_hub_bindings_present",
    displayName: "Realtime hub DO bindings present",
    description:
      "Checks that the two realtime fan-out namespaces owned by this module — `ESTIMATE_COLLAB` (EstimateCollabHub) and `FLOORPLAN_SESSION` (FloorplanSessionDO) — are attached to the deployed worker. Binding presence only; nothing is instantiated.",
    healthTsFilepath: "src/backend/realtime/health.ts",
    bindingTypesTested: ["durable_object"],
    whatSuccessMeans:
      "Both realtime hubs are wired into this deployment. `publishRealtimeEvent()` has a target, and the floor-plan phone/Claude bridge can address its room.",
    whatFailureMeans:
      "Realtime is dead in a way that is easy to miss: `publishRealtimeEvent()` throws inside whatever request called it, so upload-progress, estimate-collaboration and workflow-status events stop reaching connected browsers while the underlying work still succeeds. The UI looks frozen rather than broken.",
    troubleshootingSteps:
      "1. Check `durable_objects.bindings` in `wrangler.jsonc` for the named binding and that its `class_name` matches an export from `src/_worker.ts` — a DO class that is not re-exported from the worker entrypoint produces exactly this symptom. 2. Confirm the class survived the build: `grep -n 'EstimateCollabHub\\|FloorplanSessionDO' src/_worker.ts`. 3. Redeploy from `main` with `pnpm run deploy`, then `npx wrangler deployments list` and confirm the newest entry is yours. 4. If the deploy fails with error 10074 (migration tag already depended on), do NOT bump the DO migration tag to force it through — that is the guard that stops a branch overwriting production.",
    devOpsPlaybook:
      "1. Grep the blast radius: `grep -rn 'publishRealtimeEvent\\|ESTIMATE_COLLAB\\|FLOORPLAN_SESSION' src/backend`. 2. Realtime loss does not corrupt data — reassure on that point and scope the incident to live updates. 3. Restore the binding, redeploy, re-run this probe, then confirm end to end by opening an admin page that streams progress and watching one event land.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const missing = REALTIME_HUBS.filter((n) => !namespaceOf(env, n));
      if (missing.length > 0) {
        return failure(`Realtime DO bindings missing: ${missing.join(", ")}`);
      }
      return ok(`Both realtime hub bindings present: ${REALTIME_HUBS.join(", ")}`);
    },
  }),

  defineProbe({
    name: "do_agent_namespace_bindings_present",
    displayName: "Agent Durable Object namespaces present",
    description:
      `Checks all ${AGENT_NAMESPACES.length} agent-hosting Durable Object namespaces are bound: ${AGENT_NAMESPACES.join(", ")}. Binding presence only — no stub is fetched and no agent is woken.`,
    healthTsFilepath: "src/backend/realtime/health.ts",
    bindingTypesTested: ["durable_object"],
    whatSuccessMeans:
      "Every agent namespace the worker exports is attached to this deployment. The MCP connector (`REMODEL_MCP`), the admin chat agent, the research agents and the orchestrator can all be addressed.",
    whatFailureMeans:
      "The named agent cannot be reached at all. `REMODEL_MCP` missing takes the whole `/mcp` connector offline — Claude cannot list or call a single tool. The research/scout namespaces missing means enrichment jobs fail at dispatch, before any of their work is attempted.",
    troubleshootingSteps:
      "1. The details string names which namespace is absent. 2. Two things must both be true for a DO namespace to exist: a `durable_objects.bindings` entry in `wrangler.jsonc` AND the class re-exported from `src/_worker.ts`. Check both — missing the re-export is the common one. 3. A NEW DO class also needs a bumped `migrations` tag in `wrangler.jsonc`; without it the deploy succeeds but the namespace is not created. 4. Redeploy with `pnpm run deploy` and verify with `npx wrangler deployments list`.",
    devOpsPlaybook:
      "1. If `REMODEL_MCP` is the missing one, treat it as a connector outage: `/connect` still renders and the docs still list tools, so the only symptom users see is Claude failing to connect. Say that explicitly. 2. Never delete a DO namespace to resolve a migration-tag conflict — deleting a namespace destroys its stored state permanently. 3. After restoring, re-authorize the connector from claude.ai and call one read-only tool to confirm the round trip.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      const missing = AGENT_NAMESPACES.filter((n) => !namespaceOf(env, n));
      if (missing.length > 0) {
        return failure(
          `${missing.length}/${AGENT_NAMESPACES.length} agent DO namespaces missing: ${missing.join(", ")}`,
        );
      }
      return ok(`All ${AGENT_NAMESPACES.length} agent DO namespaces bound`);
    },
  }),

  defineProbe({
    name: "do_stub_addressable",
    displayName: "DO stub addressing (idFromName + get)",
    description:
      "Derives a Durable Object id from a fixed probe room name and obtains a stub for `ESTIMATE_COLLAB` and `FLOORPLAN_SESSION`. `idFromName()` + `get()` are local operations that do NOT instantiate or bill the object — this checks the namespace object is a real namespace rather than a mis-shaped binding.",
    healthTsFilepath: "src/backend/realtime/health.ts",
    bindingTypesTested: ["durable_object"],
    whatSuccessMeans:
      "The bindings are genuine Durable Object namespaces and name-based routing works, so the same room name will always resolve to the same instance. That determinism is what makes the phone and Claude land in one room.",
    whatFailureMeans:
      "The binding exists under the right key but is not a usable namespace — typically a config/type mismatch (the binding points at a class that is not a DurableObject, or the namespace was never created because the `migrations` tag was not bumped when the class was added).",
    troubleshootingSteps:
      "1. Compare the `class_name` in `wrangler.jsonc`'s `durable_objects.bindings` against the actual exported class name in `src/_worker.ts` — a rename on one side only produces this. 2. Check the `migrations` array in `wrangler.jsonc` includes the class in a `new_sqlite_classes`/`new_classes` entry. 3. Redeploy with `pnpm run deploy`. If it fails with 10074, an unmerged branch has advanced the production DO migration tag — merge that branch up and rebase rather than bumping tags. 4. Re-run this probe; it needs no data to pass.",
    devOpsPlaybook:
      "1. This failing while `do_realtime_hub_bindings_present` passes is the signature of a class-name/migration-tag mismatch, not an outage — treat it as a config bug and fix it in a PR, not a hotfix. 2. Do not delete and recreate the namespace to 'reset' it; stored state is unrecoverable. 3. Confirm with `npx wrangler deployments list` that the deploy carrying the fix is the live one before closing the incident.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const problems: string[] = [];
      for (const name of REALTIME_HUBS) {
        const ns = namespaceOf(env, name);
        if (!ns) {
          problems.push(`${name}: binding absent`);
          continue;
        }
        try {
          const id = ns.idFromName(PROBE_ROOM);
          const stub = ns.get(id);
          if (!stub) problems.push(`${name}: get(id) returned no stub`);
        } catch (e) {
          problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (problems.length > 0) {
        return failure(`DO stub addressing failed — ${problems.join("; ")}`);
      }
      return ok(
        `idFromName("${PROBE_ROOM}") + get() succeeded for ${REALTIME_HUBS.join(" and ")} (no instance woken)`,
      );
    },
  }),

  defineProbe({
    name: "do_realtime_hub_health_endpoint",
    displayName: "Realtime hubs answer GET /health",
    description:
      "Issues one `GET https://realtime.internal/health` to a dedicated probe room on both `EstimateCollabHub` and `FloorplanSessionDO`. Their handlers return `{ status, sockets }` from `ctx.getWebSockets().length` — no storage read, no broadcast, no socket opened.",
    healthTsFilepath: "src/backend/realtime/health.ts",
    bindingTypesTested: ["durable_object"],
    whatSuccessMeans:
      "Both hub classes actually run: the deployed code contains the current `fetch()` handler and the runtime can instantiate the object and get a response back. This is the strongest cheap evidence that realtime fan-out will work for a real room.",
    whatFailureMeans:
      "The namespace exists but the object cannot serve a request — a constructor throw (the FloorplanSessionDO constructor calls `setWebSocketAutoResponse`, so a runtime-version mismatch surfaces here), a deploy that shipped a broken class, or a 404 meaning the deployed handler is older than this probe expects.",
    troubleshootingSteps:
      "1. Read the details for the status code. A 404 means the deployed class predates the `/health` route — redeploy with `pnpm run deploy`. A 500 means the class threw; get the stack with `npx wrangler tail` while re-running the probe. 2. Confirm the live version is the one you think: `npx wrangler deployments list | tail -20`. 3. If only `FLOORPLAN_SESSION` fails, suspect the constructor's `setWebSocketAutoResponse` / `WebSocketRequestResponsePair` call against an old compatibility date in `wrangler.jsonc`. 4. Reproduce on a preview first — `pnpm run deploy:preview` gives your branch its OWN DO namespaces, so you can break and re-break it without touching production rooms.",
    devOpsPlaybook:
      "1. Rolling back is safe here — DO storage is not touched by these hubs (all connection state lives on the sockets via `serializeAttachment`), so `npx wrangler rollback <version-id>` restores service without data loss. 2. Live clients will reconnect on their own; do not ask users to clear anything. 3. After recovery, verify a real room rather than the probe room by watching one event flow through an admin page.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      const results: string[] = [];
      const problems: string[] = [];
      for (const name of REALTIME_HUBS) {
        const ns = namespaceOf(env, name);
        if (!ns) {
          problems.push(`${name}: binding absent`);
          continue;
        }
        try {
          const stub = ns.get(ns.idFromName(PROBE_ROOM)) as unknown as {
            fetch: (input: string) => Promise<Response>;
          };
          const res = await stub.fetch("https://realtime.internal/health");
          if (!res.ok) {
            problems.push(`${name}: HTTP ${res.status}`);
            continue;
          }
          const body = (await res.json()) as { status?: string; sockets?: number };
          results.push(`${name}: status=${body.status} sockets=${body.sockets ?? 0}`);
        } catch (e) {
          problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (problems.length > 0) {
        return failure(`Realtime hub /health failed — ${problems.join("; ")}`);
      }
      return ok(results.join("; "));
    },
  }),

  defineProbe({
    name: "do_agent_run_volume_watcher",
    displayName: "Durable Object runaway watcher (agent run ledger)",
    description:
      "Reads the shared agent run ledger (`agent_runs`) for the last hour: total runs started, and runs still in `running`/`queued` for more than an hour. Durable Objects bill for wall-clock while awake, so a run count far above baseline or a pile of never-ending runs is the cheapest D1-side signal of a DO billing runaway.",
    healthTsFilepath: "src/backend/realtime/health.ts",
    bindingTypesTested: ["d1", "durable_object"],
    whatSuccessMeans:
      "Agent executions in the last hour are within the recent baseline and nothing is stuck awake. Durable Object wall-clock charges should track normal usage.",
    whatFailureMeans:
      "Either agents are being invoked in a loop, or runs are entering `running` and never terminating — which usually means the Durable Object behind them is awake and billing continuously. This is the exact shape of the RemodelOrchestrator incident that burned roughly $50/day through repeated schedule-table scans before anyone noticed; the invoice lagged the fix by a full period.",
    troubleshootingSteps:
      "1. Identify the agent: `npx wrangler d1 execute core-remodel --remote --command \"SELECT agent, operation, status, COUNT(*) c FROM agent_runs WHERE created_at > unixepoch()-3600 GROUP BY agent, operation, status ORDER BY c DESC LIMIT 15\"`. 2. List the stuck ones with their age: `... \"SELECT id, agent, operation, status, started_at FROM agent_runs WHERE status IN ('running','queued') AND created_at < unixepoch()-3600 ORDER BY created_at LIMIT 20\"`. 3. Watch live invocations with `npx wrangler tail` filtered to the agent name and see whether a caller is retrying without a ceiling. 4. Check `system_cron_schedules` for an `enabled` row whose `cron_expression` was widened — a cron loop presents identically. 5. Cross-check actual spend on the Cloudflare dashboard's Durable Objects usage graph before concluding.",
    devOpsPlaybook:
      "1. Stop the spend first: disable the offending cron row in `system_cron_schedules`, or ship a guard that makes the agent exit rather than re-scheduling itself. Do not wait for a root cause. 2. Mark the stuck ledger rows `failed` with an explicit `error_code` so retries are informed rather than blind — do not delete them; the failure history is the point of the ledger. 3. Deploy the fix with `pnpm run deploy` and confirm with `npx wrangler deployments list`. 4. Expect one more billing period showing the spike after the fix lands; note that in the incident write-up so nobody re-opens it. 5. Re-run this probe hourly until the run rate returns to baseline.",
    isBillingRisk: true,
    severity: "HIGH",
    run: async (env) => {
      if (!(await tableExists(env.DB, "agent_runs"))) {
        return failure("`agent_runs` table is missing — run `pnpm run migrate:remote`");
      }
      const lastHour = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM agent_runs WHERE created_at > unixepoch() - 3600",
      );
      const prior7d = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM agent_runs WHERE created_at <= unixepoch() - 3600 AND created_at > unixepoch() - 608400",
      );
      const stuck = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM agent_runs WHERE status IN ('running','queued') AND created_at < unixepoch() - 3600",
      );
      const hourlyBaseline = prior7d / 168;

      if (stuck >= 25) {
        return failure(
          `${stuck} agent runs stuck in running/queued for over an hour — a Durable Object is likely awake and billing. Last hour started=${lastHour}.`,
        );
      }
      if (hourlyBaseline >= 1 && lastHour / hourlyBaseline > 10) {
        return failure(
          `Agent run rate spiked ${(lastHour / hourlyBaseline).toFixed(1)}x: ${lastHour} runs in the last hour vs baseline ${hourlyBaseline.toFixed(1)}/hour. Suspect a retry or cron loop.`,
        );
      }
      if (stuck > 0) {
        return degraded(
          `${stuck} agent runs have been running/queued for over an hour (last hour started=${lastHour}, baseline ${hourlyBaseline.toFixed(1)}/hour).`,
        );
      }
      return ok(
        `No stuck runs; ${lastHour} agent runs started in the last hour (baseline ${hourlyBaseline.toFixed(1)}/hour)`,
      );
    },
  }),
];
