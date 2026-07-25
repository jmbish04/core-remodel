import { mcpSessions, mcpToolInvocations } from "@backend/db";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { looseObject, urlField } from "../../schemas";
import { opsUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";

export const getRecentActivity = defineTool({
    name: "get_recent_activity",
    category: "ops",
    title: "Get recent MCP activity",
    description:
      "A quick health/usage read: the most recent MCP sessions (with tool-call counts), the latest tool calls, and " +
      "the latest errors. Handy for spotting whether a tool is failing. Pass `limit` to widen (default 10).",
    inputShape: {
      limit: z.number().int().positive().max(100).optional().describe("Rows per section (default 10)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      totalToolCalls: z.number().int(),
      url: urlField.describe("The MCP Ops console (sessions + logs)"),
      sessions: z.array(looseObject({ id: z.string(), toolCallCount: z.number().int() })),
      recentCalls: z.array(looseObject({ id: z.number().int(), toolName: z.string() })),
      recentErrors: z.array(looseObject({ id: z.number().int(), toolName: z.string() })),
    },
    examples: [{ title: "Recent activity", args: {} }],
    handler: async ({ env, db }, input) => {
      const limit = input.limit ?? 10;

      // One HTTP roundtrip to D1 for all four reads (vs four sequential ones).
      const [sessions, recentCalls, recentErrors, totalRows] = await db.batch([
        db
          .select()
          .from(mcpSessions)
          .orderBy(desc(mcpSessions.lastSeenAt))
          .limit(limit),
        db
          .select({
            id: mcpToolInvocations.id,
            sessionId: mcpToolInvocations.sessionId,
            toolName: mcpToolInvocations.toolName,
            ok: mcpToolInvocations.ok,
            durationMs: mcpToolInvocations.durationMs,
            createdAt: mcpToolInvocations.createdAt,
          })
          .from(mcpToolInvocations)
          .orderBy(desc(mcpToolInvocations.createdAt))
          .limit(limit),
        db
          .select({
            id: mcpToolInvocations.id,
            toolName: mcpToolInvocations.toolName,
            errorText: mcpToolInvocations.errorText,
            createdAt: mcpToolInvocations.createdAt,
          })
          .from(mcpToolInvocations)
          .where(eq(mcpToolInvocations.ok, false))
          .orderBy(desc(mcpToolInvocations.createdAt))
          .limit(limit),
        db.select({ total: sql<number>`count(*)` }).from(mcpToolInvocations),
      ]);

      const total = Number(totalRows?.[0]?.total ?? 0);

      return {
        totalToolCalls: total,
        url: opsUrl(env),
        sessions: sessions.map((s) => ({
          id: s.id,
          transport: s.transport,
          principal: s.principal,
          toolCallCount: s.toolCallCount,
          firstSeenAt: s.firstSeenAt,
          lastSeenAt: s.lastSeenAt,
        })),
        recentCalls,
        recentErrors,
      };
    },
  });
