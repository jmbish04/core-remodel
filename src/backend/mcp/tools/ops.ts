/**
 * @fileoverview MCP tools — Ops & Observability domain (0017).
 *
 * The self-improving surface of the connector. Tool-call LOGGING is middleware
 * (`mcp/logging.ts`), not a tool — these are the tools an agent calls
 * explicitly:
 *
 *   - `export_conversation` — persist a chat transcript so nothing built in a
 *     session is lost when the chatbot freezes.
 *   - `report_bug` / `list_agent_issues` / `resolve_agent_issue` — the agent
 *     bug backlog: Claude logs defects it hits; coding agents fix + record the
 *     PR.
 *   - `request_feature` / `list_feature_requests` — the capability-gap backlog:
 *     Claude logs what the tools can't do; agents plan it with the user.
 *   - `get_recent_activity` — a quick health/usage read over recent sessions +
 *     tool calls + errors.
 *
 * All hand-written Zod v4, per the 0015 registry contract (never drizzle-zod).
 */
import {
  mcpAgentIssues,
  mcpConversations,
  mcpFeatureRequests,
  mcpSessions,
  mcpToolInvocations,
} from "@backend/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../format";
import { defineTool, READ_ONLY, WRITE, WRITE_IDEMPOTENT, type RemodelTool } from "../types";

/** Inline-vs-R2 threshold (chars) for an exported transcript's content. */
const CONVERSATION_INLINE_CAP = 96_000;

/** Admin ops URLs returned to the agent so the user can open the record. */
const OPS_BASE = "/admin/mcp-ops";

export const opsTools: RemodelTool[] = [
  defineTool({
    name: "export_conversation",
    category: "ops",
    title: "Export the current conversation",
    description:
      "Persist the current chat onto the Worker so it survives after the session ends (the 'save our conversation' " +
      "tool). Pass the transcript you hold as `messages` (Markdown by default, or a JSON string with format='json'), " +
      "a short `title`, and an optional `summary`. If you pass a `sessionId` and re-export in the same session, the " +
      "existing record is updated rather than duplicated. Large transcripts are offloaded to R2 automatically. " +
      "Returns the stored id + a viewable URL.",
    inputShape: {
      title: z.string().min(1).describe("Short title for the saved conversation (required)"),
      messages: z
        .string()
        .min(1)
        .describe("The full transcript — Markdown, or a JSON string when format='json' (required)"),
      summary: z.string().optional().describe("Optional 1-2 sentence summary of the chat"),
      format: z
        .enum(["markdown", "json"])
        .optional()
        .describe("Transcript format (default 'markdown')"),
      messageCount: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Number of messages in the transcript (best-effort)"),
      sessionId: z
        .string()
        .optional()
        .describe("Session id to dedupe against for same-session re-exports"),
    },
    annotations: WRITE,
    examples: [
      {
        title: "Save a chat",
        args: {
          title: "Kitchen slab sourcing session",
          summary: "Shortlisted 3 slab showrooms and a faucet.",
          messages: "## User\nfind slab showrooms…\n\n## Assistant\n…",
        },
      },
    ],
    handler: async ({ env, db }, input) => {
      const messages = input.messages?.trim();
      const title = input.title?.trim();
      if (!messages) toolError("`messages` is required and cannot be empty.");
      if (!title) toolError("`title` is required and cannot be empty.");
      const format = input.format ?? "markdown";
      const messageCount = input.messageCount ?? 0;

      // Offload large transcripts to R2; keep the D1 row lean with a key.
      let storage: "inline" | "r2" = "inline";
      let content = messages;
      if (messages.length > CONVERSATION_INLINE_CAP) {
        const key = `mcp-conversations/${crypto.randomUUID()}.${format === "json" ? "json" : "md"}`;
        await env.ARTIFACTS_BUCKET.put(key, messages, {
          httpMetadata: {
            contentType: format === "json" ? "application/json" : "text/markdown",
          },
        });
        storage = "r2";
        content = key;
      }

      // Same-session re-export → update the existing row instead of duplicating.
      if (input.sessionId) {
        const [existing] = await db
          .select({ id: mcpConversations.id })
          .from(mcpConversations)
          .where(
            and(
              eq(mcpConversations.sessionId, input.sessionId),
              eq(mcpConversations.title, title),
            ),
          )
          .limit(1);
        if (existing) {
          await db
            .update(mcpConversations)
            .set({
              summary: input.summary,
              format,
              storage,
              content,
              messageCount,
              updatedAt: new Date(),
            })
            .where(eq(mcpConversations.id, existing.id))
            .run();
          return {
            updated: true,
            id: existing.id,
            url: `${OPS_BASE}/conversations/${existing.id}`,
          };
        }
      }

      const [created] = await db
        .insert(mcpConversations)
        .values({
          sessionId: input.sessionId,
          title,
          summary: input.summary,
          format,
          storage,
          content,
          messageCount,
        })
        .returning({ id: mcpConversations.id });
      return { created: true, id: created.id, url: `${OPS_BASE}/conversations/${created.id}` };
    },
  }),

  defineTool({
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
    handler: async ({ db }, input) => {
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
          set: { details, severity: input.severity ?? "medium", updatedAt: now },
        })
        .returning({ id: mcpAgentIssues.id, status: mcpAgentIssues.status });
      return { id: row.id, status: row.status, url: `${OPS_BASE}/bugs` };
    },
  }),

  defineTool({
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
    examples: [
      { title: "Open bugs", args: {} },
      { title: "All bugs", args: { status: "all" } },
    ],
    handler: async ({ db }, input) => {
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
  }),

  defineTool({
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
    examples: [{ title: "Mark fixed", args: { id: 3, status: "fixed", fixedByPr: 81 } }],
    handler: async ({ db }, input) => {
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
      return { updated: true, id: input.id, status: input.status };
    },
  }),

  defineTool({
    name: "request_feature",
    category: "ops",
    title: "Request an MCP feature",
    description:
      "Log a capability the user wants that the current tools can't do. Give a `title`, a `description` of the " +
      "desired capability, and the `useCase` (why they want it). An agent will surface it and plan it with the user " +
      "— it is NOT auto-implemented. Returns the request id.",
    inputShape: {
      title: z.string().min(1).describe("Short title for the feature (required)"),
      description: z.string().min(1).describe("What the capability should do (required)"),
      useCase: z.string().optional().describe("Why the user wants it — the concrete use case"),
      requestedBy: z.string().optional().describe("Who asked (free-text)"),
      sessionId: z.string().optional().describe("Session id where the ask came up, if known"),
    },
    annotations: WRITE,
    examples: [
      {
        title: "Export to PDF",
        args: {
          title: "Export a showroom shortlist to PDF",
          description: "A tool that renders the selected showrooms into a shareable PDF.",
          useCase: "Wanted to email a curated showroom list to my designer.",
        },
      },
    ],
    handler: async ({ db }, input) => {
      const title = input.title?.trim();
      const description = input.description?.trim();
      if (!title) toolError("`title` is required and cannot be empty.");
      if (!description) toolError("`description` is required and cannot be empty.");
      const [created] = await db
        .insert(mcpFeatureRequests)
        .values({
          title,
          description,
          useCase: input.useCase,
          requestedBy: input.requestedBy,
          sessionId: input.sessionId,
        })
        .returning({ id: mcpFeatureRequests.id });
      return { created: true, id: created.id, url: `${OPS_BASE}/features` };
    },
  }),

  defineTool({
    name: "list_feature_requests",
    category: "ops",
    title: "List MCP feature requests",
    description:
      "List logged feature requests so an agent can plan them with the user. Defaults to `status='requested'`; pass " +
      "another status ('planned'|'building'|'shipped'|'declined') or 'all' to widen. Newest first.",
    inputShape: {
      status: z
        .enum(["requested", "planned", "building", "shipped", "declined", "all"])
        .optional()
        .describe("Status filter (default 'requested')"),
      limit: z.number().int().positive().max(200).optional(),
    },
    annotations: READ_ONLY,
    examples: [{ title: "Open requests", args: {} }],
    handler: async ({ db }, input) => {
      const status = input.status ?? "requested";
      const limit = input.limit ?? 50;
      const rows = await db
        .select()
        .from(mcpFeatureRequests)
        .where(status === "all" ? undefined : eq(mcpFeatureRequests.status, status))
        .orderBy(desc(mcpFeatureRequests.createdAt))
        .limit(limit)
        .all();
      return {
        status,
        count: rows.length,
        requests: rows.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          useCase: r.useCase,
          status: r.status,
          planRef: r.planRef,
          prNumber: r.prNumber,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      };
    },
  }),

  defineTool({
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
    examples: [{ title: "Recent activity", args: {} }],
    handler: async ({ db }, input) => {
      const limit = input.limit ?? 10;

      const sessions = await db
        .select()
        .from(mcpSessions)
        .orderBy(desc(mcpSessions.lastSeenAt))
        .limit(limit)
        .all();

      const recentCalls = await db
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
        .limit(limit)
        .all();

      const recentErrors = await db
        .select({
          id: mcpToolInvocations.id,
          toolName: mcpToolInvocations.toolName,
          errorText: mcpToolInvocations.errorText,
          createdAt: mcpToolInvocations.createdAt,
        })
        .from(mcpToolInvocations)
        .where(eq(mcpToolInvocations.ok, false))
        .orderBy(desc(mcpToolInvocations.createdAt))
        .limit(limit)
        .all();

      const [{ total = 0 } = {}] = await db
        .select({ total: sql<number>`count(*)` })
        .from(mcpToolInvocations)
        .all();

      return {
        totalToolCalls: Number(total),
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
  }),
];
