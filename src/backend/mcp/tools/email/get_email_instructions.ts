import { getInstructions } from "@backend/services/email/instructions";
import { z } from "zod";

import { defineTool, READ_ONLY } from "../../types";

export const getEmailInstructionsTool = defineTool({
  name: "get_email_instructions",
  category: "email",
  title: "Get email instructions",
  description:
    "Read the reusable vendor-email boilerplate/guidance doc — AGENTS.md-style prose the composing agent folds into a message. Returns markdown (canonical source) and html (render cache). Empty strings if never set.",
  inputShape: {},
  annotations: READ_ONLY,
  outputShape: {
    markdown: z.string(),
    html: z.string(),
    // ISO-8601 string, NOT z.date(). Zod has no JSON-Schema representation for
    // a Date, so a `z.date()` anywhere in a registered shape makes the MCP
    // SDK throw "Date cannot be represented in JSON Schema" while serialising
    // `tools/list` — which zeroes the ENTIRE tool list for every client, not
    // just this tool. Serialise Dates at the boundary instead.
    updatedAt: z.string().nullable().describe("ISO-8601 timestamp of the last edit, or null"),
  },
  examples: [{ title: "Read the current instructions doc", args: {} }],
  handler: async ({ db }) => {
    const { markdown, html, updatedAt } = await getInstructions(db);
    return { markdown, html, updatedAt: updatedAt ? updatedAt.toISOString() : null };
  },
});
