import { z } from "zod";

import { createCampaign } from "../../../services/render/campaign";
import { defineTool, WRITE } from "../../types";
import { campaignOutputShape } from "./_shared";

export const createRenderCampaign = defineTool({
  name: "create_render_campaign",
  category: "render",
  title: "Create render campaign",
  description:
    "Create a multi-room, multi-angle render campaign. The campaign renders the SAME design brief across every enrolled angle, using one hero angle as the consistency reference for all remaining angles. Returns the full campaign detail including angles and sessions.",
  inputShape: {
    name: z.string().describe("Human-readable campaign name."),
    prompt: z.string().describe("Render prompt applied to every angle."),
    designConfig: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Optional design tokens (floorMaterial, wallColor, cabinetColor, fixtures, lighting…) as a JSON object.",
      ),
    angles: z
      .array(
        z.object({
          roomId: z.number().int().describe("Room id the angle belongs to."),
          listingPhotoId: z.number().int().describe("Listing photo id to render."),
          isHero: z
            .boolean()
            .optional()
            .describe(
              "Mark this angle as the hero reference. If omitted, the first angle is used.",
            ),
        }),
      )
      .min(1)
      .describe("Angles to render — one per (room, listing photo)."),
  },
  outputShape: campaignOutputShape,
  annotations: WRITE,
  examples: [
    {
      title: "Render a kitchen and living room",
      args: {
        name: "Walnut kitchen + living",
        prompt:
          "Warm walnut cabinetry, Calacatta Viola island, matte black fixtures, herringbone white oak floors.",
        angles: [
          { roomId: 3, listingPhotoId: 12, isHero: true },
          { roomId: 3, listingPhotoId: 13 },
          { roomId: 4, listingPhotoId: 21 },
        ],
      },
    },
  ],
  handler: async ({ env, db }, input) => {
    const { campaignId } = await createCampaign(db, env, {
      name: input.name,
      prompt: input.prompt,
      designConfig: input.designConfig ?? null,
      angles: input.angles,
    });

    const detail = await import("../../../services/render/campaign").then((m) =>
      m.getCampaign(db, campaignId),
    );
    if (!detail) throw new Error("Campaign disappeared after creation");
    return detail;
  },
});
