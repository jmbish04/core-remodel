import { mcpFeatureRequests } from "@backend/db";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { opsUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

export const requestFeature = defineTool({
    name: "request_feature",
    category: "ops",
    title: "Request an MCP feature",
    description:
      "Log a capability the user wants that the current tools can't do. Give a `title`, a `description` of the " +
      "desired capability, and the `useCase` (why they want it). An agent will surface it and plan it with the user " +
      "— it is NOT auto-implemented. Returns the request id.",
    inputShape: {
      title: z.string().min(1).describe("Short title for the feature (required)"),
      description: z.string().min(1).describe("What the capability should do (required)"),
      useCase: z.string().optional().describe("Why the user wants it — the concrete use case"),
      requestedBy: z.string().optional().describe("Who asked (free-text)"),
      sessionId: z.string().optional().describe("Session id where the ask came up, if known"),
    },
    annotations: WRITE,
    outputShape: {
      created: z.boolean(),
      id: z.number().int().describe("The feature request id"),
      url: urlField,
    },
    examples: [
      {
        title: "Export to PDF",
        args: {
          title: "Export a showroom shortlist to PDF",
          description: "A tool that renders the selected showrooms into a shareable PDF.",
          useCase: "Wanted to email a curated showroom list to my designer.",
        },
      },
    ],
    handler: async ({ env, db }, input) => {
      const title = input.title?.trim();
      const description = input.description?.trim();
      if (!title) toolError("`title` is required and cannot be empty.");
      if (!description) toolError("`description` is required and cannot be empty.");
      const [created] = await db
        .insert(mcpFeatureRequests)
        .values({
          title,
          description,
          useCase: input.useCase,
          requestedBy: input.requestedBy,
          sessionId: input.sessionId,
        })
        .returning({ id: mcpFeatureRequests.id });
      return { created: true, id: created.id, url: opsUrl(env, "features") };
    },
  });
