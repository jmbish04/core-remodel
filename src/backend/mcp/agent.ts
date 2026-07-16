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

import { logInvocation, principalLabel, type McpTransport } from "./logging";
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
          // Register the response schema when the tool declares one so MCP
          // clients can anticipate the shape and we can return validated
          // `structuredContent` below. Omitted for tools without an outputShape.
          ...(tool.outputShape ? { outputSchema: tool.outputShape } : {}),
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
          // Both of these were hardcoded to "streamable", so every SSE session
          // in `mcp_sessions` was mislabelled and the column was worthless for
          // answering "did the SSE transport ever connect?". getTransportType()
          // parses the same DO name as getSessionId() above, and throws the same
          // way before a session is bound — hence the identical guard.
          let transport: McpTransport;
          try {
            transport = this.getTransportType() === "sse" ? "sse" : "streamable";
          } catch {
            transport = "streamable";
          }
          const startedAt = Date.now();
          const input = args ?? {};
          try {
            const result = await tool.handler(ctx, input);
            // Fire-and-forget the transcript write so it never blocks the reply.
            this.ctx.waitUntil(
              logInvocation(this.env, {
                sessionId,
                transport,
                principal: principalLabel(props),
                toolName: tool.name,
                args: input,
                ok: true,
                result,
                durationMs: Date.now() - startedAt,
              }),
            );
            const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
            // When the tool declared an outputSchema, hand back validated
            // structuredContent too (the SDK requires it and validates it
            // against the schema). Handlers with an outputShape always return a
            // plain object; guard defensively so a stray primitive can't crash
            // the transport.
            const isPlainObject =
              typeof result === "object" && result !== null && !Array.isArray(result);
            if (tool.outputShape && isPlainObject) {
              return {
                content: [{ type: "text" as const, text }],
                structuredContent: result as Record<string, unknown>,
              };
            }
            return { content: [{ type: "text" as const, text }] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.ctx.waitUntil(
              logInvocation(this.env, {
                sessionId,
                transport,
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
