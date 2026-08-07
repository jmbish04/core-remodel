import { z } from "zod";

import { looseObject } from "../../schemas";

export const campaignStatusSchema = z.enum(["pending", "running", "done", "failed", "paused"]);
export const angleStatusSchema = z.enum(["pending", "running", "done", "failed", "skipped"]);

export const campaignAngleOutputShape = {
  id: z.number().int(),
  campaignId: z.string(),
  roomId: z.number().int().nullable(),
  listingPhotoId: z.number().int().nullable(),
  isHero: z.boolean(),
  sortOrder: z.number().int(),
  status: angleStatusSchema,
  sessionId: z.string().nullable(),
  canvasId: z.string().nullable(),
  error: z.string().nullable(),
};

export const campaignOutputShape = {
  campaign: looseObject({
    id: z.string(),
    name: z.string(),
    status: campaignStatusSchema,
    prompt: z.string().nullable(),
    designConfig: z.string().nullable(),
    heroSessionId: z.string().nullable(),
    totalAngles: z.number().int(),
    completedAngles: z.number().int(),
    failedAngles: z.number().int(),
    metadata: z.string().nullable(),
    datetimeCreated: z.number().int().nullable(),
    datetimeLastModified: z.number().int().nullable(),
  }),
  angles: z.array(looseObject(campaignAngleOutputShape)),
  sessions: z.array(
    looseObject({
      id: z.number().int(),
      campaignId: z.string(),
      sessionId: z.string(),
      roomId: z.number().int().nullable(),
      isHero: z.boolean(),
    }),
  ),
};
