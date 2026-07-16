import { mcpAgentIssues } from "@backend/db";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { opsUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";

export const reportBug = defineTool({
    name: "report_bug",
    category: "ops",
    title: "Report an MCP bug",
    description:
      "Log a defect you hit while using these MCP tools so a coding agent can fix it. Give a one-line `summary`, " +
      "`details` (what went wrong), and optionally the `tool` it happened in, `reproSteps`, and `severity`. " +
      "Deduped on (tool, summary): re-reporting the same defect updates the existing open issue instead of spamming. " +
      "Returns the issue id + status.",
    inputShape: {
      summary: z.string().min(1).describe("One-line description of the bug (required)"),
      details: z.string().min(1).describe("What went wrong — the fuller description (required)"),
      tool: z.string().optional().describe("The MCP tool the bug occurred in, if applicable"),
      severity: z.enum(["low", "medium", "high"]).optional().describe("Impact (default 'medium')"),
      reproSteps: z.string().optional().describe("Steps to reproduce, if known"),
      sessionId: z.string().optional().describe("Session id where the bug was hit, if known"),
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      id: z.number().int().describe("The bug (agent issue) id"),
      status: z.string().describe("Current status: open | in_progress | fixed | wontfix"),
      url: urlField,
    },
    examples: [
      {
        title: "Docs gating bug",
        args: {
          tool: "list_showrooms",
          summary: "Docs pages 404 behind /mcp prefix",
          details: "The /mcp route prefix gated the human docs pages so /connect/tools returned 404.",
          severity: "high",
        },
      },
    ],
    handler: async ({ env, db }, input) => {
      const summary = input.summary?.trim();
      const details = input.details?.trim();
      if (!summary) toolError("`summary` is required and cannot be empty.");
      if (!details) toolError("`details` is required and cannot be empty.");

      const dedupeKey = `${input.tool ?? "_"}::${summary}`;
      const now = new Date();
      const [row] = await db
        .insert(mcpAgentIssues)
        .values({
          toolName: input.tool,
          summary,
          details,
          severity: input.severity ?? "medium",
          reproSteps: input.reproSteps,
          sessionId: input.sessionId,
          dedupeKey,
        })
        .onConflictDoUpdate({
          target: mcpAgentIssues.dedupeKey,
          // Re-report = the defect is back: reopen it (a regression of a
          // fixed/wontfix issue must not stay hidden) and clear the stale fix.
          set: {
            details,
            severity: input.severity ?? "medium",
            status: "open",
            fixedByPr: null,
            fixedAt: null,
            updatedAt: now,
          },
        })
        .returning({ id: mcpAgentIssues.id, status: mcpAgentIssues.status });
      return { id: row.id, status: row.status, url: opsUrl(env, "bugs") };
    },
  });
