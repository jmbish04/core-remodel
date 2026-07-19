/**
 * @fileoverview Showroom Scout — MCP registry → OpenAI Agents SDK tool bridge.
 *
 * The platform already has a first-class tool registry (`src/backend/mcp/`)
 * powering the claude.ai OAuth connector and `/api/mcp`. Rather than teach the
 * scout a second, parallel tool system, this adapts `RemodelTool` into the
 * Agents SDK's `tool()` shape and calls the SAME handler in-process — no HTTP,
 * no MCP round-trip, no duplicated business logic. A tool registered once is
 * available to both the connector and this agent.
 *
 * Two non-obvious constraints drove the implementation:
 *
 *  1. **Strict mode rejects the registry.** The Agents SDK only accepts Zod
 *     parameters when `strict: true`, and strict JSON schema forbids optional
 *     properties. Registry tools use `.optional()` throughout, so we convert to
 *     JSON Schema and run non-strict.
 *  2. **Non-strict means UNVALIDATED input.** The SDK explicitly does not
 *     validate against a JSON schema. Model output is untrusted input crossing
 *     into DB writes, so we re-validate with the tool's own Zod shape here
 *     before the handler ever sees it.
 */
import { tool, type FunctionTool } from "@openai/agents";
import { z } from "zod";

import type { RemodelTool, ToolCtx } from "@backend/mcp/types";

/** Emitted for every tool invocation so the DO can stream progress + trace. */
export interface ToolEvent {
  tool: string;
  status: "start" | "ok" | "error" | "invalid_input";
  durationMs?: number;
  detail?: string;
  /** Raw tool output. Diagnostics only — the DO timeline does not store it. */
  result?: string;
}

export interface BridgeOptions {
  ctx: ToolCtx;
  onEvent?: (event: ToolEvent) => void;
  /** Per-call ceiling. Places/Gemini calls can hang; the run must not. */
  timeoutMs?: number;
}

/**
 * Convert one registry tool into an Agents SDK function tool.
 *
 * Failure policy is *degrade, never abort*: a thrown handler error (quota
 * exhausted, upstream 5xx) is returned to the model as a readable message so it
 * can route around the gap, which is exactly the graceful-degradation behavior
 * the secondary place-enrichment layer needs.
 */
export function bridgeTool(remodelTool: RemodelTool, opts: BridgeOptions): FunctionTool<unknown, any, string> {
  const inputSchema = z.object(remodelTool.inputShape);
  // `io: "input"` keeps `.default()` fields optional in the emitted schema,
  // matching what a caller is actually allowed to omit.
  const jsonSchema = z.toJSONSchema(inputSchema, { io: "input", target: "draft-7" }) as Record<string, unknown>;

  return tool({
    name: remodelTool.name,
    description: remodelTool.description,
    parameters: {
      ...jsonSchema,
      type: "object",
      additionalProperties: false,
    } as any,
    strict: false,
    timeoutMs: opts.timeoutMs ?? 45_000,
    // A slow tool reports back as a normal result instead of killing the run.
    timeoutBehavior: "error_as_result",
    execute: async (rawInput: unknown) => {
      const started = Date.now();
      opts.onEvent?.({ tool: remodelTool.name, status: "start" });

      // Trust boundary: the model produced this, and non-strict mode did not
      // check it. Validate before it reaches a handler that can write to D1.
      const parsed = inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        opts.onEvent?.({ tool: remodelTool.name, status: "invalid_input", detail });
        // Returned, not thrown — the model can read this and retry correctly.
        return `Invalid arguments for ${remodelTool.name}: ${detail}`;
      }

      try {
        const result = await remodelTool.handler(opts.ctx, parsed.data as Record<string, unknown>);
        const payload = typeof result === "string" ? result : JSON.stringify(result);
        opts.onEvent?.({
          tool: remodelTool.name,
          status: "ok",
          durationMs: Date.now() - started,
          result: payload,
        });
        return payload;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        opts.onEvent?.({
          tool: remodelTool.name,
          status: "error",
          durationMs: Date.now() - started,
          detail,
        });
        // Degrade, don't abort. Google Maps throws MAPS_QUOTA_EXCEEDED once the
        // free tier is spent; the run continues on built-in search alone.
        return `Tool ${remodelTool.name} failed: ${detail}. Continue without it and note the gap.`;
      }
    },
  });
}

/**
 * Bridge a named subset of the registry.
 *
 * The scout gets an explicit allow-list rather than all ~90 registry tools:
 * a smaller, purpose-built tool surface measurably improves tool choice, and it
 * keeps unrelated destructive tools (budget writes, render jobs) off the table.
 */
export function bridgeTools(
  tools: readonly RemodelTool[],
  names: readonly string[],
  opts: BridgeOptions,
): FunctionTool<unknown, any, string>[] {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const missing = names.filter((n) => !byName.has(n));
  if (missing.length > 0) {
    // Loud, not silent: a renamed registry tool must not degrade the scout into
    // quietly having fewer capabilities.
    console.warn(`[showroom-scout] registry tools not found: ${missing.join(", ")}`);
  }
  return names.filter((n) => byName.has(n)).map((n) => bridgeTool(byName.get(n)!, opts));
}
