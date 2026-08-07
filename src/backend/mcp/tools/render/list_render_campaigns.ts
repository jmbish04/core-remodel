import { z } from "zod";

import { listCampaigns } from "../../../services/render/campaign";
import { looseObject, pageOutput } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { campaignStatusSchema } from "./_shared";

export const listRenderCampaigns = defineTool({
  name: "list_render_campaigns",
  category: "render",
  title: "List render campaigns",
  description: "List multi-room render campaigns with status and progress.",
  inputShape: {
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().min(0).optional(),
  },
  outputShape: pageOutput(
    looseObject({
      id: z.string(),
      name: z.string(),
      status: campaignStatusSchema,
      totalAngles: z.number().int(),
      completedAngles: z.number().int(),
      failedAngles: z.number().int(),
      datetimeCreated: z.number().int().nullable(),
    }),
  ),
  annotations: READ_ONLY,
  examples: [{ title: "Recent campaigns", args: {} }],
  handler: async ({ db }, input) => {
    const campaigns = await listCampaigns(db, input.limit ?? 50, input.offset ?? 0);
    return {
      items: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        totalAngles: c.totalAngles,
        completedAngles: c.completedAngles,
        failedAngles: c.failedAngles,
        datetimeCreated: c.datetimeCreated ? Math.floor(c.datetimeCreated.getTime() / 1000) : null,
      })),
      limit: input.limit ?? 50,
      offset: input.offset ?? 0,
      total: campaigns.length,
    };
  },
});
