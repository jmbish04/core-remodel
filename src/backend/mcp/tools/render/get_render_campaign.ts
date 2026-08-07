import { z } from "zod";

import { getCampaign } from "../../../services/render/campaign";
import { defineTool, READ_ONLY } from "../../types";
import { campaignOutputShape } from "./_shared";

export const getRenderCampaign = defineTool({
  name: "get_render_campaign",
  category: "render",
  title: "Get render campaign",
  description: "Get a render campaign with all its angles, sessions, and current statuses.",
  inputShape: {
    campaignId: z.string().describe("The campaign id returned by create_render_campaign."),
  },
  outputShape: campaignOutputShape,
  annotations: READ_ONLY,
  examples: [
    { title: "Get campaign detail", args: { campaignId: "a1b2c3d4-0000-0000-0000-000000000000" } },
  ],
  handler: async ({ db }, input) => {
    const detail = await getCampaign(db, input.campaignId);
    if (!detail) throw new Error(`Campaign ${input.campaignId} not found`);
    return detail;
  },
});
