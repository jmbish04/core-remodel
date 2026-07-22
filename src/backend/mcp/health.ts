/**
 * @fileoverview Health probes for the MCP module (the claude.ai connector).
 *
 * Five things can silently break the connector without any endpoint 500ing:
 * a malformed tool literal, a missing OAUTH_KV, a missing Durable Object
 * namespace, tool-call logging that stopped writing, and an unworked agent-issue
 * backlog. Each gets a probe here.
 *
 * Cost discipline: the registry check is pure in-process code, the KV check is a
 * single `get` of one key, the DO check is a binding-presence + id derivation
 * (no `fetch` — that would spin the object up and bill it), and the D1 checks are
 * bounded `COUNT(*)` aggregates over indexed columns.
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

const FILE = "src/backend/mcp/health.ts";

/** Seconds in 7 days — the window the logging-liveness probe looks back over. */
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

/** Open-issue count above which the backlog is reported DEGRADED. */
const OPEN_ISSUE_DEGRADED_AT = 10;

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "mcp_tool_registry_integrity",
    displayName: "MCP tool registry integrity",
    description:
      "Loads src/backend/mcp/registry.ts and asserts the registry is non-empty, every tool name " +
      "is unique, and every tool carries a non-empty description plus at least one worked example.",
    healthTsFilepath: FILE,
    bindingTypesTested: [],
    whatSuccessMeans:
      "Every tool file under src/backend/mcp/tools/<domain>/ loaded cleanly, names are unique, and " +
      "each tool is documented well enough for the /connect/tools catalog and for Claude to pick it " +
      "correctly. The connector will advertise the full tool list on the next MCP handshake.",
    whatFailureMeans:
      "Either the registry module threw at import (registry.ts throws on a duplicate tool name, so " +
      "two files exporting the same `name` takes the WHOLE connector down, not just one tool), or a " +
      "tool literal is missing its description/example. A tool with no description is effectively " +
      "invisible to Claude — it will never be chosen — and the /api/mcp-docs catalog card renders blank.",
    troubleshootingSteps:
      "1. Read the details string — it names the offending tool(s) or quotes the import error. " +
      "2. Count the tool files on disk: `find src/backend/mcp/tools -mindepth 2 -name '*.ts' ! -name index.ts ! -name _shared.ts | wc -l`; " +
      "if that count is higher than the registry count, a tool file exists but was never added to its " +
      "`tools/<domain>/index.ts`, or the domain array was never added to `tools/index.ts` (ALL_TOOL_GROUPS). " +
      "3. For a duplicate name, grep for it: `grep -rn 'name: \"<tool_name>\"' src/backend/mcp/tools/`. " +
      "4. For a missing description/example, open the named tool file and fill `description` and `examples[]` " +
      "(at least one). 5. Typecheck what you touched with `npx tsc --noEmit` — the esbuild build does NOT type-check. " +
      "6. Confirm the fix on the live catalog: https://core-remodel.hacolby.workers.dev/connect/tools",
    devOpsPlaybook:
      "This is a code defect, not an infrastructure fault — no migration or binding change will fix it. " +
      "Fix the tool file, open a PR, and after merge run `pnpm run deploy` from `main` (nothing deploys itself; " +
      "Workers Builds auto-deploy is off). Verify with `curl -s https://core-remodel.hacolby.workers.dev/api/mcp-docs | jq 'length'` " +
      "and re-run this probe from /admin/system/health. If the connector is hard-down while you work, " +
      "`npx wrangler tail` will show the module-load throw on every request to /mcp.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async () => {
      let getAllTools: typeof import("./registry").getAllTools;
      try {
        ({ getAllTools } = await import("./registry"));
      } catch (e) {
        return failure(
          `MCP registry failed to load: ${e instanceof Error ? e.message : String(e)}. ` +
            "registry.ts throws on a duplicate tool name — the whole connector is down until this is fixed.",
        );
      }

      const tools = getAllTools();
      if (tools.length === 0) {
        return failure(
          "MCP registry loaded but is EMPTY (0 tools). ALL_TOOL_GROUPS in src/backend/mcp/tools/index.ts " +
            "is probably barreling nothing — the connector will advertise no tools at all.",
        );
      }

      const seen = new Set<string>();
      const duplicates: string[] = [];
      const missingDescription: string[] = [];
      const missingExample: string[] = [];
      for (const tool of tools) {
        if (seen.has(tool.name)) duplicates.push(tool.name);
        seen.add(tool.name);
        if (!tool.description || tool.description.trim().length === 0) {
          missingDescription.push(tool.name);
        }
        if (!tool.examples || tool.examples.length === 0) missingExample.push(tool.name);
      }

      const problems: string[] = [];
      if (duplicates.length > 0) problems.push(`duplicate names: ${duplicates.join(", ")}`);
      if (missingDescription.length > 0) {
        problems.push(`missing description: ${missingDescription.join(", ")}`);
      }
      if (missingExample.length > 0) {
        problems.push(`no examples[]: ${missingExample.join(", ")}`);
      }

      if (problems.length > 0) {
        return failure(`${tools.length} tools registered, but — ${problems.join("; ")}.`);
      }
      return ok(
        `${tools.length} MCP tools registered; all names unique, all have a description and >=1 example.`,
      );
    },
  }),

  defineProbe({
    name: "mcp_oauth_kv_readable",
    displayName: "MCP OAuth KV readable",
    description:
      "Asserts the OAUTH_KV namespace is bound and answers a read. @cloudflare/workers-oauth-provider " +
      "stores every client registration, grant and refresh token here.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["kv"],
    whatSuccessMeans:
      "OAUTH_KV is bound and reachable, so /oauth/register, /oauth/authorize and /oauth/token can " +
      "persist and look up client registrations. Existing claude.ai connector sessions keep working " +
      "and a new connector can complete the consent flow.",
    whatFailureMeans:
      "The OAuth provider has nowhere to store grants. Every claude.ai connector authorization fails, " +
      "already-issued tokens cannot be validated, and /mcp returns 401 for every request. The user sees " +
      "the connector as permanently disconnected with no useful error.",
    troubleshootingSteps:
      "1. Confirm the binding exists in wrangler.jsonc under `kv_namespaces` with binding `OAUTH_KV`. " +
      "2. Confirm the namespace still exists on the account: `npx wrangler kv namespace list`. " +
      "3. If the id in wrangler.jsonc does not appear in that list, the namespace was deleted — recreate it " +
      "and update the id (all existing grants are gone; the user must re-authorize the connector in claude.ai). " +
      "4. Redeploy: `pnpm run deploy` from `main`. 5. Watch a live authorize attempt with `npx wrangler tail`.",
    devOpsPlaybook:
      "A missing KV binding is a config/deploy fault. Never hand-edit the live worker — fix wrangler.jsonc, " +
      "merge, then `pnpm run deploy` and check `npx wrangler deployments list | tail -20` shows your deploy " +
      "as newest. Re-run this probe from /admin/system/health, then have the user re-add the connector in claude.ai " +
      "settings and confirm the tool list loads at /connect.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      if (!env.OAUTH_KV) {
        return failure(
          "OAUTH_KV binding is absent from the environment. The MCP OAuth provider cannot store grants — " +
            "every connector authorization will fail. Check `kv_namespaces` in wrangler.jsonc.",
        );
      }
      // A read of a key that is not expected to exist: proves reachability, writes nothing.
      await env.OAUTH_KV.get("health:probe");
      return ok("OAUTH_KV is bound and answered a read.");
    },
  }),

  defineProbe({
    name: "mcp_durable_object_namespace",
    displayName: "REMODEL_MCP Durable Object namespace",
    description:
      "Asserts the REMODEL_MCP Durable Object namespace is bound and can derive an object id. " +
      "RemodelMcpAgent (the McpAgent DO) is the Streamable-HTTP and SSE transport behind /mcp.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["durable_object"],
    whatSuccessMeans:
      "The DO namespace is bound and `idFromName` resolves, so /mcp and /mcp/sse can route a session to " +
      "RemodelMcpAgent. Deliberately does NOT `fetch` the object — instantiating a DO costs money and would " +
      "make an on-demand health probe a billing surface.",
    whatFailureMeans:
      "The connector transport is gone. /mcp and /mcp/sse cannot construct the agent, so claude.ai gets a " +
      "500 on the MCP handshake. Usually means the DO class was not exported from src/_worker.ts, or the " +
      "`durable_objects` binding / migration tag in wrangler.jsonc was changed or dropped.",
    troubleshootingSteps:
      "1. Confirm `RemodelMcpAgent` is exported from src/_worker.ts — the class must be re-exported from the " +
      "worker entry or the binding cannot resolve. 2. Confirm the `durable_objects.bindings` entry named " +
      "REMODEL_MCP exists in wrangler.jsonc and the migration tag (v14 for this DO) is still present in " +
      "`migrations`. 3. Never bump a DO migration tag to make a failing build pass — that ships a branch to " +
      "production (see the deploy topology in CLAUDE.md). 4. Redeploy with `pnpm run deploy` from `main`. " +
      "5. Tail a real handshake: `npx wrangler tail` while re-connecting the connector in claude.ai.",
    devOpsPlaybook:
      "Deploy-config fault. Fix wrangler.jsonc / _worker.ts on a branch, deploy a preview with " +
      "`pnpm run deploy:preview` (previews get their OWN DO namespaces, which is why they sidestep the 10074 " +
      "'class already depended on' error), verify /mcp handshakes there, then merge and `pnpm run deploy`. " +
      "If deploy fails with 10074, the branch's DO migration tag collides with production's — reconcile the " +
      "tags, do not delete namespaces.",
    isBillingRisk: false,
    severity: "HIGH",
    run: async (env) => {
      if (!env.REMODEL_MCP) {
        return failure(
          "REMODEL_MCP Durable Object namespace is not bound. /mcp and /mcp/sse cannot construct " +
            "RemodelMcpAgent — the claude.ai connector handshake will 500.",
        );
      }
      // Deriving an id is free and does NOT instantiate (or bill) the object.
      const id = env.REMODEL_MCP.idFromName("health:probe");
      return ok(`REMODEL_MCP namespace bound; derived object id ${id.toString().slice(0, 16)}…`);
    },
  }),

  defineProbe({
    name: "mcp_invocation_logging_liveness",
    displayName: "MCP invocation logging liveness",
    description:
      "Counts mcp_tool_invocations rows written in the last 7 days (and the sessions behind them). " +
      "Tool-call logging is middleware written via ctx.waitUntil from both transports.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "The connector is being used AND the logging middleware is still writing. /admin/mcp-ops has fresh " +
      "data, and the self-improving loop (which reasons over what tools actually get called and which fail) " +
      "has something to reason about.",
    whatFailureMeans:
      "The table is missing entirely (a migration was generated but never applied to remote), which also " +
      "means every tool call is throwing inside the logger. DEGRADED instead means zero rows in 7 days: " +
      "either nobody used the connector for a week (benign), or the connector is silently unreachable and " +
      "nobody noticed — the failure mode this probe exists to catch.",
    troubleshootingSteps:
      "1. If the table is missing, run `pnpm run migrate:remote` and then re-check " +
      "`npx wrangler d1 execute DB --remote --command \"SELECT name FROM sqlite_master WHERE name='mcp_tool_invocations'\"`. " +
      "2. If rows are zero, first make a real call: connect at /connect and run any read-only tool, then re-run " +
      "this probe. 3. Still zero → the logging middleware is failing. `npx wrangler tail` and watch for errors " +
      "from src/backend/mcp/logging.ts during a tool call. 4. Confirm the connector itself is up: the " +
      "mcp_oauth_kv_readable and mcp_durable_object_namespace probes above must both be green first. " +
      "5. Review the data at https://core-remodel.hacolby.workers.dev/admin/mcp-ops",
    devOpsPlaybook:
      "Zero rows on its own is not an incident — confirm with the user whether they used the connector this " +
      "week before chasing it. If they did and nothing logged, treat the connector as down: check " +
      "`npx wrangler deployments list | tail -20` for a deploy that landed right before the last logged row, " +
      "and tail the worker during a live handshake. Never log the auth token / WORKER_API_KEY when adding " +
      "debug output to the logger.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env) => {
      if (!(await tableExists(env.DB, "mcp_tool_invocations"))) {
        return failure(
          "Table mcp_tool_invocations does not exist on this D1. A migration was generated but never applied " +
            "to remote — run `pnpm run migrate:remote`.",
        );
      }

      const cutoff = Math.floor(Date.now() / 1000) - SEVEN_DAYS_SECONDS;
      const recent = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM mcp_tool_invocations WHERE created_at >= ?",
        cutoff,
      );
      const recentFailures = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM mcp_tool_invocations WHERE created_at >= ? AND ok = 0",
        cutoff,
      );
      const total = await scalar(env.DB, "SELECT COUNT(*) AS c FROM mcp_tool_invocations");
      const sessions = (await tableExists(env.DB, "mcp_sessions"))
        ? await scalar(
            env.DB,
            "SELECT COUNT(*) AS c FROM mcp_sessions WHERE last_seen_at >= ?",
            cutoff,
          )
        : -1;

      const sessionsText = sessions < 0 ? "mcp_sessions table missing" : `${sessions} session(s)`;
      if (recent === 0) {
        return degraded(
          `No MCP tool calls logged in the last 7 days (${total} row(s) all-time, ${sessionsText} seen). ` +
            "Either the connector went unused, or it is unreachable and nobody noticed.",
        );
      }
      const details =
        `${recent} tool call(s) in the last 7 days across ${sessionsText}; ` +
        `${recentFailures} returned an error (${total} row(s) all-time).`;
      // A high error ratio is worth surfacing even while logging is clearly alive.
      return recentFailures > recent / 2 ? degraded(`${details} Over half of recent calls FAILED.`) : ok(details);
    },
  }),

  defineProbe({
    name: "mcp_agent_issue_backlog",
    displayName: "MCP agent-issue backlog",
    description:
      "Counts open rows in mcp_agent_issues — bugs Claude filed via the `report_bug` ops tool during " +
      "chat sessions. These are authoritative TODOs for whoever next works Worker code.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      `Fewer than ${OPEN_ISSUE_DEGRADED_AT} open agent-filed issues. The backlog is being worked: ` +
      "fixes are landing and `resolve_agent_issue` is being called with the PR number that fixed them.",
    whatFailureMeans:
      "FAILURE means the mcp_agent_issues table is missing (unapplied migration) so the ops tools cannot " +
      `file anything at all. DEGRADED means ${OPEN_ISSUE_DEGRADED_AT}+ open issues have piled up — Claude is ` +
      "hitting real bugs during chats and nobody is closing the loop. This backlog is invisible unless " +
      "something surfaces it, which is exactly why it is a health probe.",
    troubleshootingSteps:
      "1. Read the list: `pnpm run mcp:issues`, or the `list_agent_issues` MCP tool, or " +
      "`GET /api/mcp-ops/issues?status=open` (admin-gated). 2. Triage by the `severity` column first; " +
      "`repro_steps` and `details` are filled in by the reporting session. 3. Fix what you can in the current " +
      "PR, then call `resolve_agent_issue` with the PR number (or update the row's `status` + `fixed_by_pr`). " +
      "4. Duplicates share a `dedupe_key` unique index, so a re-report will not create a second row — if the " +
      "count is not dropping after fixes, the rows were never resolved. " +
      "5. Review at https://core-remodel.hacolby.workers.dev/admin/mcp-ops",
    devOpsPlaybook:
      "Not a paging incident — it is a work queue. Standing instruction: check this backlog BEFORE starting " +
      "Worker code work, and resolve what your change fixes in the same PR. If the table is missing, run " +
      "`pnpm run migrate:remote` and verify the table exists on remote before merging anything that writes to it.",
    isBillingRisk: false,
    severity: "LOW",
    run: async (env) => {
      if (!(await tableExists(env.DB, "mcp_agent_issues"))) {
        return failure(
          "Table mcp_agent_issues does not exist on this D1 — the ops tools (`report_bug`, " +
            "`list_agent_issues`) cannot write. Run `pnpm run migrate:remote`.",
        );
      }
      const open = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM mcp_agent_issues WHERE status = 'open'",
      );
      const highOpen = await scalar(
        env.DB,
        "SELECT COUNT(*) AS c FROM mcp_agent_issues WHERE status = 'open' AND severity = 'high'",
      );
      const total = await scalar(env.DB, "SELECT COUNT(*) AS c FROM mcp_agent_issues");
      const details = `${open} open agent issue(s) (${highOpen} high severity) out of ${total} filed all-time.`;
      return open >= OPEN_ISSUE_DEGRADED_AT ? degraded(details) : ok(details);
    },
  }),
];
