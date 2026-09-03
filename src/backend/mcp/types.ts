import type { z, ZodRawShape } from "zod";

/**
 * @fileoverview MCP tool registry — shared types.
 *
 * The registry is the single source of truth for every tool the Model Context
 * Protocol server exposes. It is consumed by:
 *   1. `RemodelMcpAgent` (agents/mcp) — the OAuth-gated claude.ai connector at
 *      `/mcp` (+ `/mcp/sse`), which registers each tool on its `McpServer`.
 *   2. `/api/mcp` (legacy Hono JSON-RPC) — the bearer/cookie/research-token
 *      endpoint (kept for back-compat).
 *   3. The `/mcp` + `/mcp/tools` docs site and `/context`, which render the
 *      catalog from this same metadata so the docs can never silently drift.
 *
 * To add a tool: create `tools/<domain>/<tool_name>.ts` exporting a
 * `defineTool({...})`, then add it to `tools/<domain>/index.ts`. One file per tool;
 * domain-shared helpers live in `tools/<domain>/_shared.ts`. Picked up everywhere
 * automatically via the `tools/index.ts` barrel.
 */
import { drizzle } from "drizzle-orm/d1";

/** Drizzle D1 client type used by every tool handler. */
export type RemodelDb = ReturnType<typeof drizzle>;

/**
 * Domain groupings — drive the docs-page section headers and let a transport
 * filter which tools it exposes (e.g. the research scope on `/api/mcp`).
 */
export type ToolCategory =
  | "rooms"
  | "budget"
  | "materials"
  | "showrooms"
  | "drives"
  | "tesla"
  | "brands"
  | "products"
  | "links"
  | "workflow"
  | "render"
  | "measurements"
  | "research"
  | "ops"
  | "artifacts"
  | "changelog"
  | "memory"
  | "email";

/**
 * Identity + authorization context resolved by whichever transport invoked the
 * tool. `kind` records how the caller authenticated; `scope` is the granted
 * OAuth scope (single `remodel` full-parity scope today, see 0015 §0.5).
 */
export interface McpProps extends Record<string, unknown> {
  userId: string;
  scope: string;
  kind: "oauth" | "worker" | "cookie" | "research";
  /**
   * Serve this session as Code Mode (one `code` tool) instead of advertising
   * every registry tool. Set per-path in `src/_worker.ts` — `/mcp` true,
   * `/mcp/direct` false — and read once in `RemodelMcpAgent.init()`. Lives on
   * props rather than a constructor arg because `McpAgent` persists props to DO
   * storage, so the choice survives hibernation for the life of the session.
   */
  codeMode?: boolean;
}

/** Everything a tool handler needs: bindings, a db client, and the caller. */
export interface ToolCtx {
  env: Env;
  db: RemodelDb;
  props: McpProps;
}

/**
 * MCP tool annotations (hints, not security guarantees — see MCP best
 * practices). `readOnlyHint` tools never mutate; `destructiveHint` tools may
 * delete/unlink; `idempotentHint` tools are safe to retry.
 */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** A worked example rendered on the docs page and useful as an agent hint. */
export interface ToolExample {
  title: string;
  args: Record<string, unknown>;
}

/**
 * A single registered tool. `inputShape` and `outputShape` are raw Zod shapes
 * (records of field schemas) so they drop straight into the MCP SDK's
 * `registerTool({ inputSchema, outputSchema })` and can also be wrapped with
 * `z.object()` for validation on the legacy JSON-RPC path.
 *
 * `outputShape` documents the tool's response so an AI client can anticipate the
 * shape before calling. When present, the transport returns validated
 * `structuredContent` alongside the text result (see `agent.ts`). See
 * `schemas.ts` for the validation contract (top-level keys must be enumerated;
 * use `looseObject` for rich nested DTOs).
 */
export interface RemodelTool {
  name: string;
  category: ToolCategory;
  title: string;
  description: string;
  inputShape: ZodRawShape;
  outputShape?: ZodRawShape;
  annotations: ToolAnnotations;
  examples?: ToolExample[];
  handler: (ctx: ToolCtx, input: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Type-safe tool constructor. Infers the handler's `input` type from
 * `inputShape` while erasing to the heterogeneous `RemodelTool` for the
 * registry array. Prefer this over building `RemodelTool` literals by hand.
 */
export function defineTool<S extends ZodRawShape>(tool: {
  name: string;
  category: ToolCategory;
  title: string;
  description: string;
  inputShape: S;
  outputShape?: ZodRawShape;
  annotations: ToolAnnotations;
  examples?: ToolExample[];
  handler: (ctx: ToolCtx, input: z.infer<z.ZodObject<S>>) => Promise<unknown>;
}): RemodelTool {
  return tool as unknown as RemodelTool;
}

/** Common annotation presets to keep call sites terse and consistent. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** Idempotent write (find-or-create / upsert) — safe to retry. */
export const WRITE_IDEMPOTENT: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};
