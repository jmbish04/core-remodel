import { mcpAgentIssues } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { opsUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

export const resolveAgentIssue = defineTool({
    name: "resolve_agent_issue",
    category: "ops",
    title: "Resolve an MCP bug",
    description:
      "Mark a logged MCP bug `fixed` or `wontfix` (or `in_progress` while working it). When a fix lands, pass the " +
      "`fixedByPr` PR number so the backlog links to the change. Callable by a coding agent after landing a fix.",
    inputShape: {
      id: z.number().int().positive().describe("Issue id (from list_agent_issues)"),
      status: z
        .enum(["open", "in_progress", "fixed", "wontfix"])
        .describe("New status for the issue"),
      fixedByPr: z.number().int().positive().optional().describe("PR number that fixed it"),
    },
    annotations: WRITE,
    outputShape: {
      updated: z.boolean(),
      id: z.number().int(),
      status: z.string(),
      url: urlField,
    },
    examples: [{ title: "Mark fixed", args: { id: 3, status: "fixed", fixedByPr: 81 } }],
    handler: async ({ env, db }, input) => {
      const [existing] = await db
        .select({ id: mcpAgentIssues.id })
        .from(mcpAgentIssues)
        .where(eq(mcpAgentIssues.id, input.id))
        .limit(1);
      if (!existing) {
        toolError(`Issue ${input.id} not found. Call list_agent_issues for valid ids.`);
      }
      const now = new Date();
      await db
        .update(mcpAgentIssues)
        .set({
          status: input.status,
          fixedByPr: input.fixedByPr,
          fixedAt: input.status === "fixed" ? now : null,
          updatedAt: now,
        })
        .where(eq(mcpAgentIssues.id, input.id))
        .run();
      return { updated: true, id: input.id, status: input.status, url: opsUrl(env, "bugs") };
    },
  });
