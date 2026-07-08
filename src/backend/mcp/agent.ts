/**
 * @fileoverview RemodelMcpAgent — the OAuth-gated MCP server Durable Object.
 *
 * Backs the claude.ai connector at `/mcp` (Streamable HTTP) and `/mcp/sse`
 * (SSE fallback), wired up in `src/_worker.ts` via `OAuthProvider.apiHandlers`
 * + `RemodelMcpAgent.serve(...)`. It wraps the official MCP TypeScript SDK's
 * `McpServer` (from agents/mcp's `McpAgent`) and registers every tool from the
 * shared registry — so growing the tool surface is a registry edit, nothing
 * here changes.
 *
 * OAuth grant props (`this.props`, set by workers-oauth-provider from the
 * `completeAuthorization` call in the consent flow) are threaded into each
 * tool's `ctx.props`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { drizzle } from "drizzle-orm/d1";

import { logInvocation, principalLabel } from "./logging";
import { getAllTools } from "./registry";
import type { McpProps, ToolCtx } from "./types";

/** Full-parity props used when a caller is trusted but carries no OAuth grant. */
const DEFAULT_PROPS: McpProps = { userId: "justin", scope: "remodel", kind: "oauth" };

export class RemodelMcpAgent extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer({ name: "core-remodel", version: "1.0.0" });

  /**
   * Registers all registry tools on the MCP server. Runs once per DO instance
   * (per MCP session). Tool handlers get a fresh Drizzle client + the caller's
   * OAuth props on every invocation.
   */
  async init(): Promise<void> {
    for (const tool of getAllTools()) {
      this.server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputShape,
          annotations: { title: tool.title, ...tool.annotations },
        },
        async (args: Record<string, unknown>) => {
          const props = this.props ?? DEFAULT_PROPS;
          const ctx: ToolCtx = {
            env: this.env,
            db: drizzle(this.env.DB),
            props,
          };
          // Resolve the session id defensively — getSessionId() depends on the
          // transport naming scheme and can throw before a session is bound.
          let sessionId: string;
          try {
            sessionId = this.getSessionId() || this.ctx.id.toString();
          } catch {
            sessionId = this.ctx.id.toString();
          }
          const startedAt = Date.now();
          const input = args ?? {};
          try {
            const result = await tool.handler(ctx, input);
            // Fire-and-forget the transcript write so it never blocks the reply.
            this.ctx.waitUntil(
              logInvocation(this.env, {
                sessionId,
                transport: "streamable",
                principal: principalLabel(props),
                toolName: tool.name,
                args: input,
                ok: true,
                result,
                durationMs: Date.now() - startedAt,
              }),
            );
            const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
            return { content: [{ type: "text" as const, text }] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.ctx.waitUntil(
              logInvocation(this.env, {
                sessionId,
                transport: "streamable",
                principal: principalLabel(props),
                toolName: tool.name,
                args: input,
                ok: false,
                error: message,
                durationMs: Date.now() - startedAt,
              }),
            );
            return {
              isError: true,
              content: [{ type: "text" as const, text: `Error: ${message}` }],
            };
          }
        },
      );
    }
  }
}
