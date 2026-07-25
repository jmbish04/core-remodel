import { getLatestHealthSession, listHealthSessions } from "@backend/services/health/run";
import { z } from "zod";

import { looseObject, urlField } from "../../schemas";
import { siteUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";

/**
 * The read side of the health platform, paired with `run_health_session`.
 *
 * Running a session costs ~50 probe round-trips; re-reading one costs two
 * grouped SELECTs. So an agent that just wants "what did the last run say?" —
 * or that ran a session earlier in the conversation and wants the detail back
 * without re-probing — comes here instead of re-running the screen.
 */
export const getHealthResultsTool = defineTool({
  name: "get_health_results",
  category: "ops",
  title: "Get health-session results",
  description:
    "Read a stored system-health session — the newest one by default, or a specific `sessionUuid` " +
    "(e.g. the one returned by run_health_session). Returns every probe's outcome and details, plus a " +
    "short history of recent sessions so you can see whether a failure is new or long-standing. " +
    "Reads only: it never probes anything and never writes. Use `failuresOnly` to get just what is broken.",
  inputShape: {
    sessionUuid: z
      .string()
      .optional()
      .describe("A specific session to read. Omit for the most recent session."),
    failuresOnly: z
      .boolean()
      .optional()
      .describe("Return only FAILURE and DEGRADED probes (default false)"),
    billingOnly: z
      .boolean()
      .optional()
      .describe("Return only the cost/spend watchers (default false)"),
    historyLimit: z
      .number()
      .int()
      .optional()
      .describe("How many recent sessions to summarize alongside (default 5, max 100)"),
  },
  annotations: READ_ONLY,
  outputShape: {
    found: z.boolean().describe("False when no health session has ever been recorded"),
    sessionUuid: z.string().nullable(),
    timestamp: z.string().nullable(),
    triggeredBy: z.string().nullable().describe("ui | api | mcp | cron"),
    overall: z
      .string()
      .nullable()
      .describe("SUCCESS | DEGRADED | FAILURE — the worst outcome in the session"),
    counts: looseObject({
      success: z.number().int(),
      degraded: z.number().int(),
      failure: z.number().int(),
    }).nullable(),
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
    history: z.array(
      looseObject({
        sessionUuid: z.string(),
        timestamp: z.string(),
        triggeredBy: z.string(),
        total: z.number().int(),
        failures: z.number().int(),
        degraded: z.number().int(),
        overall: z.string(),
      }),
    ),
  },
  examples: [
    { title: "What did the last health run say?", args: {} },
    { title: "Only what is currently broken", args: { failuresOnly: true } },
    {
      title: "Re-read a specific session",
      args: { sessionUuid: "8631b19c-a928-4026-a425-4aa4976afae4" },
    },
  ],
  handler: async ({ env }, input) => {
    const session = await getLatestHealthSession(env, input.sessionUuid);
    const history = await listHealthSessions(
      env,
      Math.min(Math.max(input.historyLimit ?? 5, 1), 100),
    );
    const url = siteUrl(env, "/admin/system/health");

    if (!session) {
      return {
        found: false,
        sessionUuid: null,
        timestamp: null,
        triggeredBy: null,
        overall: null,
        counts: null,
        url,
        results: [],
        history,
      };
    }

    let results = session.runs;
    if (input.billingOnly) results = results.filter((r) => r.isBillingRisk);
    if (input.failuresOnly) results = results.filter((r) => r.result !== "SUCCESS");

    return {
      found: true,
      sessionUuid: session.sessionUuid,
      timestamp: session.timestamp,
      triggeredBy: session.triggeredBy,
      overall: session.overall,
      counts: session.counts,
      url,
      results,
      history,
    };
  },
});
