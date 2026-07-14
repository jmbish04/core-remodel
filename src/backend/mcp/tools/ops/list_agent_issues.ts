import { mcpAgentIssues } from "@backend/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { looseObject, urlField } from "../../schemas";
import { opsUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";

export const listAgentIssues = defineTool({
    name: "list_agent_issues",
    category: "ops",
    title: "List MCP bug reports",
    description:
      "List logged MCP bugs so an agent can see what needs fixing. Defaults to `status='open'`; pass a different " +
      "status ('in_progress'|'fixed'|'wontfix') or 'all' to widen. Newest first.",
    inputShape: {
      status: z
        .enum(["open", "in_progress", "fixed", "wontfix", "all"])
        .optional()
        .describe("Status filter (default 'open')"),
      limit: z.number().int().positive().max(200).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      status: z.string().describe("The status filter that was applied"),
      count: z.number().int(),
      url: urlField.describe("The bugs board where these issues are listed"),
      issues: z.array(
        looseObject({
          id: z.number().int(),
          tool: z.string().nullable(),
          summary: z.string().nullable(),
          severity: z.string().nullable(),
          status: z.string().nullable(),
          fixedByPr: z.union([z.number(), z.string()]).nullable(),
        }),
      ),
    },
    examples: [
      { title: "Open bugs", args: {} },
      { title: "All bugs", args: { status: "all" } },
    ],
    handler: async ({ env, db }, input) => {
      const status = input.status ?? "open";
      const limit = input.limit ?? 50;
      const rows = await db
        .select()
        .from(mcpAgentIssues)
        .where(status === "all" ? undefined : eq(mcpAgentIssues.status, status))
        .orderBy(desc(mcpAgentIssues.createdAt))
        .limit(limit)
        .all();
      return {
        status,
        count: rows.length,
        url: opsUrl(env, "bugs"),
        issues: rows.map((r) => ({
          id: r.id,
          tool: r.toolName,
          summary: r.summary,
          details: r.details,
          severity: r.severity,
          reproSteps: r.reproSteps,
          status: r.status,
          fixedByPr: r.fixedByPr,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      };
    },
  });
