import { appendScopedCacheEvent, resolveResearchScope } from "../lib/research";
import type { ToolDef } from "../types";

export const recordDeepResearchProgress: ToolDef = {
  name: "record_deep_research_progress",
  description: "Record a short progress note from the Deep Research agent for the scoped target.",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      status: { type: "string" },
    },
    required: ["message"],
  },
  research: true,
  handler: async (ctx) => {
    const scope = resolveResearchScope(ctx);
    const message = String(ctx.args.message ?? "").trim();
    if (!message) throw new Error("message is required");
    await appendScopedCacheEvent(ctx.env, scope, "progress", {
      message,
      status: ctx.args.status ?? null,
    });
    return JSON.stringify({ recorded: true, scope, message });
  },
};
