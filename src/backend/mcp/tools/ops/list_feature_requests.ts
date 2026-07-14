import { mcpFeatureRequests } from "@backend/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { looseObject, urlField } from "../../schemas";
import { opsUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";

export const listFeatureRequests = defineTool({
    name: "list_feature_requests",
    category: "ops",
    title: "List MCP feature requests",
    description:
      "List logged feature requests so an agent can plan them with the user. Defaults to `status='requested'`; pass " +
      "another status ('planned'|'building'|'shipped'|'declined') or 'all' to widen. Newest first.",
    inputShape: {
      status: z
        .enum(["requested", "planned", "building", "shipped", "declined", "all"])
        .optional()
        .describe("Status filter (default 'requested')"),
      limit: z.number().int().positive().max(200).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      status: z.string(),
      count: z.number().int(),
      url: urlField.describe("The features board where these requests are listed"),
      requests: z.array(
        looseObject({
          id: z.number().int(),
          title: z.string().nullable(),
          status: z.string().nullable(),
          prNumber: z.union([z.number(), z.string()]).nullable(),
        }),
      ),
    },
    examples: [{ title: "Open requests", args: {} }],
    handler: async ({ env, db }, input) => {
      const status = input.status ?? "requested";
      const limit = input.limit ?? 50;
      const rows = await db
        .select()
        .from(mcpFeatureRequests)
        .where(status === "all" ? undefined : eq(mcpFeatureRequests.status, status))
        .orderBy(desc(mcpFeatureRequests.createdAt))
        .limit(limit)
        .all();
      return {
        status,
        count: rows.length,
        url: opsUrl(env, "features"),
        requests: rows.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          useCase: r.useCase,
          status: r.status,
          planRef: r.planRef,
          prNumber: r.prNumber,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      };
    },
  });
