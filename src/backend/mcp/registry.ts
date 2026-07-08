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

/** Lightweight metadata for the docs page / `/context` (no handlers). */
export interface ToolMeta {
  name: string;
  category: ToolCategory;
  title: string;
  description: string;
  annotations: RemodelTool["annotations"];
  inputFields: { name: string; type: string; optional: boolean; description?: string }[];
  examples: RemodelTool["examples"];
}

/**
 * Describe every tool for documentation. Field types are derived from the Zod
 * shape via its internal `_def.type` (best-effort — good enough for a docs
 * table; the authoritative schema still lives in each tool's `inputShape`).
 */
export function describeTools(): ToolMeta[] {
  return TOOLS.map((t) => ({
    name: t.name,
    category: t.category,
    title: t.title,
    description: t.description,
    annotations: t.annotations,
    examples: t.examples ?? [],
    inputFields: Object.entries(t.inputShape).map(([name, schema]) => {
      const def = (schema as { _def?: { type?: string }; isOptional?: () => boolean; description?: string });
      let optional = false;
      try {
        optional = typeof def.isOptional === "function" ? def.isOptional() : false;
      } catch {
        optional = false;
      }
      return {
        name,
        type: def._def?.type ?? "unknown",
        optional,
        description: def.description,
      };
    }),
  }));
}
