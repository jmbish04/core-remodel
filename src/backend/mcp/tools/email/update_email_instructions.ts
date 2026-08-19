import { upsertInstructions } from "@backend/services/email/instructions";
import { z } from "zod";

import { defineTool, WRITE } from "../../types";

export const updateEmailInstructionsTool = defineTool({
  name: "update_email_instructions",
  category: "email",
  title: "Update email instructions",
  description:
    "Replace the reusable vendor-email boilerplate/guidance doc. Markdown is the canonical source; html is sanitized on write and stored as the render cache — pass both, do not hand-author only one and expect the other to be derived.",
  inputShape: {
    markdown: z.string(),
    html: z.string(),
  },
  annotations: WRITE,
  outputShape: {
    markdown: z.string(),
    html: z.string(),
  },
  examples: [
    {
      title: "Set the instructions doc",
      args: {
        markdown: "Always cc justin@126colby.com.",
        html: "<p>Always cc justin@126colby.com.</p>",
      },
    },
  ],
  handler: async ({ db }, input) => {
    return upsertInstructions(db, { markdown: input.markdown, html: input.html });
  },
});
