import { z } from "zod";

import { listProposals } from "@backend/services/changelog-proposals";
import { looseObject, urlField } from "../../schemas";
import { siteUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";
import { formatBytes, PROPOSAL_STATUSES } from "./_shared";

export const listFeatureProposals = defineTool({
  name: "list_feature_proposals",
  category: "changelog",
  title: "List feature proposals",
  description:
    "List filed feature proposals, newest first, optionally filtered by lifecycle status " +
    "(proposed / accepted / in_progress / shipped / rejected). Returns metadata only — call " +
    "`get_feature_proposal` for a bundle's PRD, PROMPT, and conversation transcript. Use this to find what has " +
    "been proposed but not yet built before starting new work.",
  inputShape: {
    status: z
      .enum(PROPOSAL_STATUSES)
      .optional()
      .describe("Filter by lifecycle status. Omit for all."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)"),
  },
  annotations: READ_ONLY,
  outputShape: {
    count: z.number().int(),
    proposals: z.array(
      looseObject({
        slug: z.string(),
        status: z.string(),
        branch: z.string().nullable(),
        hasContext: z.boolean().describe("Whether a raw transcript is stored"),
        url: urlField,
      }),
    ),
  },
  examples: [
    { title: "Everything still unbuilt", args: { status: "proposed" } },
    { title: "All proposals", args: {} },
  ],
  handler: async ({ env, db }, input) => {
    const rows = await listProposals(db, { status: input.status, limit: input.limit });
    return {
      count: rows.length,
      proposals: rows.map((p) => ({
        slug: p.slug,
        status: p.status,
        branch: p.branch,
        prNumber: p.prNumber,
        planSlug: p.planSlug,
        sourceKind: p.sourceKind,
        sourceModel: p.sourceModel,
        hasContext: Boolean(p.contextR2Key),
        contextSize: formatBytes(p.contextBytes),
        coverageNote: p.contextCoverageNote,
        createdAt: p.createdAt,
        url: siteUrl(env, `/admin/changelog/preview/${p.slug}`),
      })),
    };
  },
});
