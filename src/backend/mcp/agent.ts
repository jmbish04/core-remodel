/**
 * @fileoverview RemodelMcpAgent — the MCP server Durable Object.
 *
 * Backs every MCP surface, wired up in `src/_worker.ts` via
 * `OAuthProvider.apiHandlers` + `RemodelMcpAgent.serve(...)`. It wraps the
 * official MCP TypeScript SDK's `McpServer` (from agents/mcp's `McpAgent`) and
 * registers every tool from the shared registry — so growing the tool surface
 * is a registry edit, nothing here changes.
 *
 * TWO SURFACES, ONE CLASS. The registry carries 170+ tools; handing all of
 * their JSON schemas to a client costs enormous context before a single call
 * is made. So the same DO serves two shapes, chosen per session by the
 * `codeMode` flag on `props` (set by the path wrapper in `_worker.ts`):
 *
 *   /mcp, /mcp/sse                CODE MODE — two tools. `code` runs
 *                                 model-written JavaScript against
 *                                 `codemode.<tool>` inside an isolated Worker
 *                                 (Worker Loader, no outbound network) and
 *                                 returns only the final value; its description
 *                                 carries a one-line catalog of every registry
 *                                 tool. `describe_tools` returns the exact
 *                                 TypeScript types for the handful the model
 *                                 actually picks.
 *   /mcp/direct, /mcp/direct/sse  RAW — every registry tool advertised
 *                                 individually, the classic MCP shape. Kept as
 *                                 the fallback surface because Code Mode is
 *                                 still experimental.
 *
 * Code Mode never replaces the tools: both surfaces are built from the same
 * `getAllTools()` registry in the same pass, and every call — code-mode or
 * direct — runs through `callTool()`, so the invocation ledger sees them
 * identically.
 *
 * Auth props (`this.props`) come either from the OAuth grant (set by
 * workers-oauth-provider from `completeAuthorization`) or from the API-key path
 * in `_worker.ts`, and are threaded into each tool's `ctx.props`.
 */
import {
  DynamicWorkerExecutor,
  generateTypesFromJsonSchema,
  truncateResult,
  type JsonSchemaToolDescriptors,
} from "@cloudflare/codemode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import type { McpProps, ToolCtx } from "./types";

import { logInvocation, principalLabel, type McpTransport } from "./logging";
import { getAllTools } from "./registry";
import { GITHUB_REPO_URL } from "./urls";

/**
 * `repoUrl` rides on EVERY tool response — declared once here and merged into
 * each tool's outputSchema, so no tool file has to remember it and the declared
 * schema can never disagree with what the transport actually returns.
 */
const REPO_URL_FIELD = {
  repoUrl: z
    .string()
    .describe("GitHub repository backing this MCP server — where the code and issues live"),
};

/** Full-parity props used when a caller is trusted but carries no OAuth grant. */
const DEFAULT_PROPS: McpProps = { userId: "justin", scope: "remodel", kind: "oauth" };

/**
 * Description for the Code Mode `code` tool. `{{catalog}}` is replaced at
 * registration with one line per registry tool.
 *
 * WHY A CATALOG AND NOT THE FULL TYPES: inlining generated TypeScript for all
 * 170+ tools produced a 197KB description — roughly 50k tokens spent on every
 * single connection, before the model does anything. Most of that was the tools'
 * own prose descriptions. A name plus a one-line summary is enough to CHOOSE a
 * tool; the exact parameter types are then fetched for the handful actually
 * needed via `describe_tools`. That is the "search and execute" shape
 * Cloudflare's Code Mode docs recommend for large surfaces.
 */
const CODE_TOOL_DESCRIPTION = `Run JavaScript against the 126 Colby remodel to read and change project data — rooms, budget, materials, products, showrooms, renders, drives, email, and the agent-ops backlogs.

Write a single async arrow function and return a value; that value is the tool result. Every remodel tool below is a method on the \`codemode\` namespace, so you can chain calls, filter intermediate results, and return only what you need — one round trip instead of a dozen.

Rules:
- Plain JavaScript only. No TypeScript annotations, interfaces or generics.
- Write the arrow function directly; do not define named functions and then call them.
- Money is in cents.
- Call \`describe_tools\` FIRST for any method whose arguments you are not sure of — this list gives names, not parameter types.
- The code runs in an isolated Worker with NO outbound network access. It can reach these methods and nothing else.

Example:
async () => {
  const rooms = await codemode.list_rooms({});
  const baths = rooms.rooms.filter((r) => r.name.toLowerCase().includes("bath"));
  return Promise.all(baths.map((r) => codemode.get_room({ id: r.id })));
}

Available methods, by category:

{{catalog}}`;

/** Longest one-line summary kept per tool in the catalog. */
const CATALOG_SUMMARY_CHARS = 110;

/**
 * First sentence of a tool description, capped — enough to pick a tool from a
 * list of 170. The full text comes back from `describe_tools`.
 */
function summarize(description: string): string {
  const firstSentence = /^(.+?[.!?])(\s|$)/.exec(description.replaceAll(/\s+/g, " ").trim());
  const text = firstSentence ? firstSentence[1] : description.replaceAll(/\s+/g, " ").trim();
  return text.length > CATALOG_SUMMARY_CHARS
    ? `${text.slice(0, CATALOG_SUMMARY_CHARS - 1).trimEnd()}…`
    : text;
}

/**
 * True when a Zod raw shape can be serialised to JSON Schema.
 *
 * WHY THIS EXISTS: the MCP SDK serialises EVERY registered tool's schema in one
 * pass when it answers `tools/list`. A single unserialisable field therefore
 * fails the whole response, and the client shows **zero** tools — not 172 of
 * 173. That is exactly what a lone `z.date()` in one tool's `outputShape` did:
 * `tools/list` came back `-32603 "Date cannot be represented in JSON Schema"`
 * and every connected client reported an empty tool list while auth looked fine.
 *
 * Probing each shape at registration turns that cliff into a graceful
 * degradation: a bad `outputShape` costs that tool its structured output, a bad
 * `inputShape` costs that one tool, and the other 172 keep working. The
 * `mcp_tool_schema_serializable` health probe (src/backend/mcp/health.ts)
 * reports the same condition at /admin/system/health, so it is visible without
 * tailing the worker.
 */
function isSerializableShape(shape: Record<string, unknown>): boolean {
  try {
    z.toJSONSchema(z.object(shape as Record<string, z.ZodType>));
    return true;
  } catch {
    return false;
  }
}

export class RemodelMcpAgent extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer({ name: "core-remodel", version: "1.0.0" });

  /**
   * Builds this session's server. Runs once per DO instance (per MCP session),
   * after `this.props` is populated, and `McpAgent` reads `this.server` back
   * afterwards — which is what lets Code Mode swap it for the wrapper.
   */
  async init(): Promise<void> {
    const server = new McpServer({ name: "core-remodel", version: "1.0.0" });
    if (this.props?.codeMode) {
      this.registerCodeTool(server);
    } else {
      this.registerRegistryTools(server);
    }
    this.server = server;
  }

  /**
   * Registers the Code Mode surface: a `code` tool that runs model-written
   * JavaScript against the whole registry inside an isolated Worker, plus a
   * `describe_tools` lookup for the exact types of the methods it names.
   *
   * WHY THIS IS HAND-ROLLED rather than `codeMcpServer()` from
   * `@cloudflare/codemode/mcp`: that helper drives the tool list through an
   * in-memory MCP client, and it constructs that `Client` without a
   * `jsonSchemaValidator`. The SDK then defaults to `AjvJsonSchemaValidator`,
   * which compiles validators with `new Function` — banned in Workers, so every
   * request died with `Code generation from strings disallowed for this
   * context` (the package imports the Workers-safe
   * `CfWorkerJsonSchemaValidator` but only passes it in `openApiMcpServer`).
   * Going straight to the registry skips the client, the Ajv compile and the
   * in-memory transport entirely, and every call still flows through
   * `callTool()` — so Code Mode invocations land in `mcp_tool_invocations` the
   * same as a direct call.
   */
  private registerCodeTool(server: McpServer): void {
    const descriptors: JsonSchemaToolDescriptors = {};
    const fns: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    const byCategory = new Map<string, string[]>();

    for (const tool of getAllTools()) {
      if (!isSerializableShape(tool.inputShape)) {
        console.error(`mcp: skipping tool "${tool.name}" — inputShape is not serialisable`);
        continue;
      }
      descriptors[tool.name] = {
        description: tool.description,
        inputSchema: z.toJSONSchema(
          z.object(tool.inputShape as Record<string, z.ZodType>),
        ) as JsonSchemaToolDescriptors[string]["inputSchema"],
      };
      // The sandbox reaches the host over RPC with JSON-encoded args, so each fn
      // takes the single args object the generated types describe.
      fns[tool.name] = async (args: unknown) =>
        this.callTool(tool, (args ?? {}) as Record<string, unknown>);

      const line = `  ${tool.name} — ${summarize(tool.description)}`;
      const lines = byCategory.get(tool.category);
      if (lines) lines.push(line);
      else byCategory.set(tool.category, [line]);
    }

    const catalog = [...byCategory]
      .map(([category, lines]) => `${category}:\n${lines.join("\n")}`)
      .join("\n\n");
    const executor = new DynamicWorkerExecutor({ loader: this.env.LOADER });

    server.registerTool(
      "describe_tools",
      {
        title: "Describe remodel methods",
        description:
          "Get the exact TypeScript input/output types plus the full description for specific `codemode.*` methods named in the `code` tool's catalog. Call this before writing code that uses a method whose arguments you are not certain of. Ask for every method you need in one call.",
        inputSchema: {
          names: z
            .array(z.string())
            .min(1)
            .max(25)
            .describe("Method names exactly as they appear in the `code` tool catalog"),
        },
        annotations: {
          title: "Describe remodel methods",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ names }: { names: string[] }) => {
        const wanted: JsonSchemaToolDescriptors = {};
        const unknownNames: string[] = [];
        for (const name of names) {
          const descriptor = descriptors[name];
          if (descriptor) wanted[name] = descriptor;
          else unknownNames.push(name);
        }
        const parts: string[] = [];
        if (Object.keys(wanted).length > 0) parts.push(generateTypesFromJsonSchema(wanted));
        if (unknownNames.length > 0) {
          parts.push(
            `Not a method on this server: ${unknownNames.join(", ")}. Check the catalog in the \`code\` tool description.`,
          );
        }
        return { content: [{ type: "text" as const, text: parts.join("\n\n") }] };
      },
    );

    server.registerTool(
      "code",
      {
        title: "Run code against the remodel",
        description: CODE_TOOL_DESCRIPTION.replace("{{catalog}}", catalog),
        inputSchema: {
          code: z
            .string()
            .describe(
              "A JavaScript async arrow function, e.g. `async () => { const r = await codemode.list_rooms({}); return r; }`. No TypeScript syntax.",
            ),
        },
        annotations: {
          title: "Run code against the remodel",
          // The sandbox can reach every registry tool, writes included, so this
          // is deliberately NOT flagged read-only or idempotent.
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async ({ code }: { code: string }) => {
        const outcome = await executor.execute(code, [{ name: "codemode", fns }]);
        if (outcome.error) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Error: ${outcome.error}` }],
          };
        }
        const value = truncateResult(outcome.result);
        const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "null");
        return { content: [{ type: "text" as const, text }] };
      },
    );
  }

  /**
   * Runs one registry tool and writes the invocation ledger row. Shared by both
   * surfaces, so a Code Mode call is logged exactly like a direct one. Throws on
   * handler failure (after logging it) — the caller decides how to surface it.
   */
  private async callTool(
    tool: ReturnType<typeof getAllTools>[number],
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const props = this.props ?? DEFAULT_PROPS;
    const ctx: ToolCtx = { env: this.env, db: drizzle(this.env.DB), props };
    // Resolve the session id defensively — getSessionId() depends on the
    // transport naming scheme and can throw before a session is bound.
    let sessionId: string;
    try {
      sessionId = this.getSessionId() || this.ctx.id.toString();
    } catch {
      sessionId = this.ctx.id.toString();
    }
    // Both of these were hardcoded to "streamable", so every SSE session in
    // `mcp_sessions` was mislabelled and the column was worthless for answering
    // "did the SSE transport ever connect?". getTransportType() parses the same
    // DO name as getSessionId() above, and throws the same way before a session
    // is bound — hence the identical guard.
    let transport: McpTransport;
    try {
      transport = this.getTransportType() === "sse" ? "sse" : "streamable";
    } catch {
      transport = "streamable";
    }
    const startedAt = Date.now();
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
      return result;
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
      throw err;
    }
  }

  /** Registers every registry tool individually — the classic MCP surface. */
  private registerRegistryTools(server: McpServer): void {
    for (const tool of getAllTools()) {
      // Skip a tool whose INPUT schema cannot serialise — it could never be
      // called anyway, and registering it would blank the whole tools/list.
      if (!isSerializableShape(tool.inputShape)) {
        console.error(
          `mcp: skipping tool "${tool.name}" — inputShape is not JSON-Schema serialisable`,
        );
        continue;
      }
      // A bad OUTPUT schema only costs structured output, so drop it and keep
      // the tool callable rather than losing it entirely.
      const outputSchema = tool.outputShape
        ? { ...tool.outputShape, ...REPO_URL_FIELD }
        : undefined;
      const outputOk = outputSchema ? isSerializableShape(outputSchema) : false;
      if (outputSchema && !outputOk) {
        console.error(
          `mcp: tool "${tool.name}" — outputShape is not JSON-Schema serialisable; registering without structured output`,
        );
      }
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputShape,
          // Register the response schema when the tool declares one so MCP
          // clients can anticipate the shape and we can return validated
          // `structuredContent` below. Omitted for tools without an outputShape.
          ...(outputOk ? { outputSchema } : {}),
          annotations: { title: tool.title, ...tool.annotations },
        },
        async (args: Record<string, unknown>) => {
          const input = args ?? {};
          try {
            const result = await this.callTool(tool, input);
            // Stamp the repo on every response — object results get a `repoUrl`
            // key, prose results get a trailing line. A tool that already set
            // its own `repoUrl` wins.
            const isPlainObject =
              typeof result === "object" && result !== null && !Array.isArray(result);
            const stamped = isPlainObject
              ? { repoUrl: GITHUB_REPO_URL, ...(result as Record<string, unknown>) }
              : result;
            const text =
              typeof stamped === "string"
                ? `${stamped}\n\nRepo: ${GITHUB_REPO_URL}`
                : JSON.stringify(stamped, null, 2);
            // When the tool declared a usable outputSchema, hand back validated
            // structuredContent too (the SDK requires it and validates it
            // against the schema). Handlers with an outputShape always return a
            // plain object; guard defensively so a stray primitive can't crash
            // the transport.
            if (outputOk && isPlainObject) {
              return {
                content: [{ type: "text" as const, text }],
                structuredContent: stamped as Record<string, unknown>,
              };
            }
            return { content: [{ type: "text" as const, text }] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
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
