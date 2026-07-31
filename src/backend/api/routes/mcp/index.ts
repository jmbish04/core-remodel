/**
 * MCP (Model Context Protocol) server for the AI image-editing pipeline.
 *
 * Streamable-HTTP JSON-RPC transport mounted at /api/mcp. Exposes the render +
 * mood-board + measurement + Deep Research + showroom tools so an MCP client
 * (e.g. Claude) can drive the platform.
 *
 * Auth: inherits the app's /api/* bearer auth (Authorization: Bearer <WORKER_API_KEY>).
 * That is the "token" an MCP client supplies. Scoped Deep Research tokens are also
 * accepted, limited to tools flagged `research: true`. See ./auth.
 *
 * Tools live one-per-file under ./tools and are registered in ./tools/index.ts.
 * This file only does transport + auth + dispatch — no tool logic.
 */
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { logInvocation, principalLabel } from "@backend/mcp/logging";

import { authenticateMcpRequest } from "./auth";
import { TOOLS, TOOLS_BY_NAME } from "./tools";
import { PROTOCOL_VERSION, SERVER_INFO, toWire, type McpAuthContext } from "./types";

const mcpRouter = new Hono<{ Bindings: Env }>();

/**
 * If `text` is a JSON OBJECT (not an array or primitive), parse and return it so
 * it can be surfaced as MCP `structuredContent`. Returns `null` for arrays,
 * primitives, or unparseable prose — callers then fall back to text-only.
 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not JSON — prose result, stays text-only */
  }
  return null;
}

async function callTool(
  env: Env,
  auth: McpAuthContext,
  name: string,
  args: Record<string, any>,
): Promise<string> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (auth.kind !== "worker" && !tool.research) {
    throw new Error(`Tool ${name} is not allowed for scoped Deep Research MCP tokens`);
  }
  const db = drizzle(env.DB);
  return tool.handler({ env, db, auth, args });
}

function visibleTools(auth: McpAuthContext) {
  return TOOLS.filter((tool) => auth.kind === "worker" || tool.research);
}

// JSON-RPC over HTTP (the MCP streamable-HTTP transport).
mcpRouter.post("/", async (c) => {
  const auth = await authenticateMcpRequest(c.req.raw, c.env);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = (await c.req.json().catch(() => null)) as any;

  // The legacy transport has no MCP session concept, so synthesize one id per
  // HTTP request (a JSON-RPC batch shares it) tagged "legacy" for grouping in
  // the ops transcript. See 0017 §3A / open-question #5.
  const legacySessionId = `legacy:${crypto.randomUUID()}`;
  const legacyPrincipal = principalLabel({
    kind: auth.kind,
    userId: auth.kind === "research" ? "research-token" : "worker",
  });

  const handle = async (msg: any) => {
    const id = msg?.id ?? null;
    const method = msg?.method;
    const params = msg?.params;
    try {
      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        };
      }
      if (method === "tools/list") {
        return { jsonrpc: "2.0", id, result: { tools: visibleTools(auth).map(toWire) } };
      }
      if (method === "tools/call") {
        const toolName = String(params?.name ?? "unknown");
        const toolArgs = params?.arguments ?? {};
        const startedAt = Date.now();
        try {
          const text = await callTool(c.env, auth, params?.name, toolArgs);
          c.executionCtx.waitUntil(
            logInvocation(c.env, {
              sessionId: legacySessionId,
              transport: "legacy",
              principal: legacyPrincipal,
              toolName,
              args: toolArgs,
              ok: true,
              result: text,
              durationMs: Date.now() - startedAt,
            }),
          );
          // When a tool's text result is itself a JSON object, also hand it
          // back as `structuredContent` so JSON-RPC clients get a parsed shape
          // without re-parsing the text block (mirrors the registry transport).
          // Prose results stay text-only.
          const structuredContent = parseJsonObject(text);
          const result = structuredContent
            ? { content: [{ type: "text", text }], structuredContent }
            : { content: [{ type: "text", text }] };
          return { jsonrpc: "2.0", id, result };
        } catch (err) {
          c.executionCtx.waitUntil(
            logInvocation(c.env, {
              sessionId: legacySessionId,
              transport: "legacy",
              principal: legacyPrincipal,
              toolName,
              args: toolArgs,
              ok: false,
              error: String((err as Error)?.message ?? err),
              durationMs: Date.now() - startedAt,
            }),
          );
          throw err;
        }
      }
      if (method === "ping") {
        return { jsonrpc: "2.0", id, result: {} };
      }
      if (typeof method === "string" && method.startsWith("notifications/")) {
        return null; // notifications get no response
      }
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: String((err as Error)?.message ?? err) },
      };
    }
  };

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter((r) => r !== null);
    return c.json(out);
  }
  const res = await handle(body);
  if (res === null) return c.body(null, 202);
  return c.json(res);
});

// Discovery / health (handy for sanity-checking the server)
mcpRouter.get("/", async (c) => {
  const auth = await authenticateMcpRequest(c.req.raw, c.env);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocol: "mcp",
    transport: "http",
    tools: visibleTools(auth).map((t) => t.name),
  });
});

export default mcpRouter;
