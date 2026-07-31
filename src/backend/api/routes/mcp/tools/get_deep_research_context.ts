import { getResearchContext, resolveResearchScope } from "../lib/research";
import type { ToolDef } from "../types";

export const getDeepResearchContext: ToolDef = {
  name: "get_deep_research_context",
  description:
    "Return the scoped Core Remodel D1 context for this one Deep Research interaction.",
  inputSchema: { type: "object", properties: {} },
  research: true,
  handler: async (ctx) => {
    const scope = resolveResearchScope(ctx);
    return getResearchContext(ctx.db, ctx.env, scope);
  },
};
