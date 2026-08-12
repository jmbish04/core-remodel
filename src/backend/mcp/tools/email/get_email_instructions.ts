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
    updatedAt: z.date().nullable(),
  },
  examples: [{ title: "Read the current instructions doc", args: {} }],
  handler: async ({ db }) => {
    return getInstructions(db);
  },
});
