import { recordResearchSource, resolveResearchScope } from "../lib/research";
import type { ToolDef } from "../types";

export const recordDeepResearchSource: ToolDef = {
  name: "record_deep_research_source",
  description: "Record one scoped source URL or finding discovered by Deep Research.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      finding: { type: "string" },
      sentiment: { type: "string", enum: ["good", "bad", "neutral"] },
    },
    required: ["url"],
  },
  research: true,
  handler: async (ctx) => {
    const scope = resolveResearchScope(ctx);
    return recordResearchSource(ctx.db, ctx.env, scope, ctx.args);
  },
};
