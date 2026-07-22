import { runHealthSession } from "@backend/services/health/run";
import { z } from "zod";

import { looseObject, urlField } from "../../schemas";
import { siteUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

/**
 * The third trigger for a health session, alongside the `/admin/system/health` button
 * and `POST /api/health/session`. Same runner, same `session_uuid` grouping —
 * only `triggered_by` differs, so a chat-initiated run is indistinguishable in
 * the ledger except for its provenance.
 *
 * Annotated WRITE rather than READ_ONLY: it persists a `health_results` row per
 * probe and upserts the catalogue. The probes themselves are read-only and free.
 */
export const runHealthSessionTool = defineTool({
  name: "run_health_session",
  category: "ops",
  title: "Run the system health screen",
  description:
    "Run every registered health probe against the live Worker — D1, KV, R2, Vectorize, Durable Objects, " +
    "Workflows, Workers AI, Cloudflare Images, every external integration credential, the MCP tool registry, " +
    "the cost/spend watchers and the domain data-integrity invariants — and return the results. Each probe is " +
    "bounded and free (no model calls, no paid APIs). Writes one health_results row per probe under a shared " +
    "session_uuid. Use `failuresOnly` to get just what is broken.",
  inputShape: {
    failuresOnly: z
      .boolean()
      .optional()
      .describe("Return only FAILURE and DEGRADED probes (default false)"),
    billingOnly: z
      .boolean()
      .optional()
      .describe("Return only the cost/spend watchers (default false)"),
  },
  annotations: WRITE,
  outputShape: {
    sessionUuid: z.string(),
    timestamp: z.string(),
    overall: z.string().describe("SUCCESS | DEGRADED | FAILURE — the worst outcome in the session"),
    counts: looseObject({
      success: z.number().int(),
      degraded: z.number().int(),
      failure: z.number().int(),
    }),
    totalDurationMs: z.number().int(),
    url: urlField.describe("The health dashboard, where each test's runbook lives"),
    results: z.array(
      looseObject({
        name: z.string(),
        displayName: z.string(),
        groupId: z.string(),
        severity: z.string(),
        isBillingRisk: z.boolean(),
        result: z.string(),
        details: z.string(),
        durationMs: z.number().int(),
      }),
    ),
  },
  examples: [
    { title: "Full system health screen", args: {} },
    { title: "Only what is broken", args: { failuresOnly: true } },
    { title: "Only the spend watchers", args: { billingOnly: true } },
  ],
  handler: async ({ env }, input) => {
    const session = await runHealthSession(env, "mcp");
    let results = session.runs;
    if (input.billingOnly) results = results.filter((r) => r.isBillingRisk);
    if (input.failuresOnly) results = results.filter((r) => r.result !== "SUCCESS");

    return {
      sessionUuid: session.sessionUuid,
      timestamp: session.timestamp,
      overall: session.overall,
      counts: session.counts,
      totalDurationMs: session.totalDurationMs,
      url: siteUrl(env, "/admin/system/health"),
      results,
    };
  },
});
