/**
 * Shared types + constants for the renovation-studio MCP server (mounted at /api/mcp).
 *
 * One tool = one file under ./tools. Each exports a {@link ToolDef}: the wire
 * schema (name/description/inputSchema) AND its handler, so the registry in
 * ./tools/index.ts is the single source of truth for "what tools exist".
 */
import { drizzle } from "drizzle-orm/d1";

import type { DeepResearchMcpScope } from "@backend/services/gemini/deep-research";

export const SERVER_INFO = { name: "renovation-studio", version: "1.0.0" };
export const PROTOCOL_VERSION = "2024-11-05";

export type Db = ReturnType<typeof drizzle>;

export type McpAuthContext =
  | { kind: "worker" }
  | { kind: "research"; token: string; scope: DeepResearchMcpScope };

/** Everything a tool handler needs. `db` is a ready drizzle(env.DB) instance. */
export interface ToolCtx {
  env: Env;
  db: Db;
  auth: McpAuthContext;
  args: Record<string, any>;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * When true, scoped Deep Research MCP tokens may call this tool. Otherwise it
   * is worker-auth only. Mirrors the old `isResearchTool` allow-list.
   */
  research?: boolean;
  handler: (ctx: ToolCtx) => Promise<string>;
}

/** MCP `tools/list` wire shape — the ToolDef without its handler. */
export interface McpToolWire {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function toWire(tool: ToolDef): McpToolWire {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}
