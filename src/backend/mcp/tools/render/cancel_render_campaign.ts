import { z } from "zod";

import { cancelCampaign, getCampaign } from "../../../services/render/campaign";
import { defineTool, WRITE } from "../../types";
import { campaignOutputShape } from "./_shared";

export const cancelRenderCampaign = defineTool({
  name: "cancel_render_campaign",
  category: "render",
  title: "Cancel render campaign",
  description: "Cancel pending angles in a running or pending campaign and pause it.",
  inputShape: {
    campaignId: z.string().describe("The campaign id to cancel."),
  },
  outputShape: {
    paused: z.number().int().describe("Number of pending angles skipped."),
    campaign: campaignOutputShape.campaign,
    angles: campaignOutputShape.angles,
    sessions: campaignOutputShape.sessions,
  },
  annotations: WRITE,
  examples: [
    { title: "Cancel a campaign", args: { campaignId: "a1b2c3d4-0000-0000-0000-000000000000" } },
  ],
  handler: async ({ db }, input) => {
    const { paused } = await cancelCampaign(db, input.campaignId);
    const detail = await getCampaign(db, input.campaignId);
    if (!detail) throw new Error(`Campaign ${input.campaignId} not found`);
    return { paused, ...detail };
  },
});
