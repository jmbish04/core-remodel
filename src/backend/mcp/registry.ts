/**
 * @fileoverview MCP tool registry — the single source of truth.
 *
 * Every transport (OAuth `RemodelMcpAgent`, legacy `/api/mcp`) and the docs
 * site read the tool list from here. Nothing else should hard-code a tool
 * list. See `types.ts` for the design rationale.
 */
import { ALL_TOOL_GROUPS } from "./tools";
import type { RemodelTool, ToolCategory } from "./types";

/** Frozen, de-duplicated tool list. Throws at module load on a name clash. */
const TOOLS: readonly RemodelTool[] = (() => {
  const seen = new Set<string>();
  for (const tool of ALL_TOOL_GROUPS) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate MCP tool name "${tool.name}" — tool names must be unique.`);
    }
    seen.add(tool.name);
  }
  return Object.freeze([...ALL_TOOL_GROUPS]);
})();

/** All registered tools. */
export function getAllTools(): readonly RemodelTool[] {
  return TOOLS;
}

/** Look up one tool by name (undefined if absent). */
export function getTool(name: string): RemodelTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Tools in the given categories (used to scope a transport's exposure). */
export function getToolsByCategory(...categories: ToolCategory[]): RemodelTool[] {
  const set = new Set(categories);
  return TOOLS.filter((t) => set.has(t.category));
}

/** One introspected field row for the docs table (input or output). */
export interface ToolField {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
}

/** Lightweight metadata for the docs page / `/context` (no handlers). */
export interface ToolMeta {
  name: string;
  category: ToolCategory;
  title: string;
  description: string;
  annotations: RemodelTool["annotations"];
  inputFields: ToolField[];
  /** Top-level fields of the tool's response (empty when no outputSchema). */
  outputFields: ToolField[];
  examples: RemodelTool["examples"];
}

/** Zod v4 `_def` shape we introspect (kind on `.type`, wrappers hold `.innerType`). */
interface ZodDefLike {
  type?: string;
  innerType?: { _def?: ZodDefLike };
}
const WRAPPER_TYPES = new Set(["optional", "nullable", "default"]);

/**
 * Best-effort field type + optionality for the docs table.
 *
 * Zod v4 exposes the schema KIND on `_def.type` ("string" | "number" |
 * "optional" | ...) — NOT `_def.typeName` (that was Zod v3). Optional/nullable/
 * default wrappers nest the real schema under `_def.innerType`, so we unwrap to
 * report the underlying kind and flag the field optional when an optional/
 * default wrapper is present. The authoritative schema still lives in each
 * tool's `inputShape`; this is only for display.
 */
function introspectField(schema: unknown): { type: string; optional: boolean } {
  let def = (schema as { _def?: ZodDefLike })._def;
  let optional = false;
  while (def?.type && WRAPPER_TYPES.has(def.type) && def.innerType?._def) {
    if (def.type === "optional" || def.type === "default") optional = true;
    def = def.innerType._def;
  }
  return { type: def?.type ?? "unknown", optional };
}

/** Map a Zod raw shape to introspected doc fields (used for input + output). */
function describeShape(shape: RemodelTool["inputShape"] | undefined): ToolField[] {
  if (!shape) return [];
  return Object.entries(shape).map(([name, schema]) => {
    const { type, optional } = introspectField(schema);
    return {
      name,
      type,
      optional,
      description: (schema as { description?: string }).description,
    };
  });
}

/** Describe every tool for documentation (`/api/mcp-docs` → `/mcp/tools`). */
export function describeTools(): ToolMeta[] {
  return TOOLS.map((t) => ({
    name: t.name,
    category: t.category,
    title: t.title,
    description: t.description,
    annotations: t.annotations,
    examples: t.examples ?? [],
    inputFields: describeShape(t.inputShape),
    outputFields: describeShape(t.outputShape),
  }));
}
