import { showroomStores } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

export const updateShowroom = defineTool({
  name: "update_showroom",
  category: "showrooms",
  title: "Update showroom details",
  description:
    "Patch any known columns on a showroom store (fill-in-missing-details). Only the fields you pass are changed; everything else is left untouched. The `id` cannot be changed. Great for enriching a store after research: address, contact, hours summaries, social links, POC, rating context, access level, notes.",
  inputShape: {
    id: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
    name: z.string().optional(),
    description: z.string().optional(),
    pricePoint: z.enum(["$", "$$", "$$$", "$$$$"]).optional(),
    locationAddress: z.string().optional(),
    phoneNumber: z.string().optional(),
    emailAddress: z.string().optional(),
    websiteUrl: z.string().optional(),
    zipCode: z.string().optional(),
    googleMapsLink: z.string().optional(),
    weekdayHours: z.string().optional().describe("Human-readable weekday hours summary"),
    weekendHours: z.string().optional().describe("Human-readable weekend hours summary"),
    isAppointmentOnly: z.boolean().optional(),
    mainPocFullname: z.string().optional(),
    mainPocPhoneNumber: z.string().optional(),
    mainPocEmailAddress: z.string().optional(),
    rating: z.number().int().min(1).max(5).optional().describe("Latest-visit star rating 1-5"),
    ratingContextHtml: z.string().optional(),
    ratingContextMarkdown: z.string().optional(),
    instagramUrl: z.string().optional(),
    facebookUrl: z.string().optional(),
    pinterestUrl: z.string().optional(),
    overviewNoteHtml: z.string().optional(),
    overviewNoteMarkdown: z.string().optional(),
    accessLevel: z
      .enum([
        "PUBLIC_UNRESTRICTED",
        "STRICT_TRADE_ONLY",
        "HYBRID_ACCOMPANIED",
        "HYBRID_DEALER_NETWORK",
        "HYBRID_APPOINTMENT_ONLY",
        "UNKNOWN",
      ])
      .optional()
      .describe("Homeowner access classification"),
    locationNotes: z.string().optional().describe("Quick freeform location notes"),
  },
  annotations: WRITE,
  examples: [
    { title: "Add a phone number", args: { id: 4, phoneNumber: "(415) 555-0142" } },
    {
      title: "Enrich socials + access",
      args: {
        id: 4,
        instagramUrl: "https://instagram.com/studiobelmontbath",
        accessLevel: "PUBLIC_UNRESTRICTED",
      },
    },
  ],
  outputShape: {
    updated: z.boolean(),
    store: looseObject({ id: z.number().int(), name: z.string().nullable() }),
    url: urlField,
  },
  handler: async ({ env, db }, input) => {
    const { id, ...rest } = input;
    const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length === 0) {
      toolError("No fields to update — pass at least one field besides `id`.");
    }
    const [existing] = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.id, id))
      .limit(1);
    if (!existing) {
      toolError(`Showroom ${id} not found. Call list_showrooms for valid ids.`);
    }
    await db.update(showroomStores).set(patch).where(eq(showroomStores.id, id)).run();
    const [updated] = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.id, id))
      .limit(1);
    return { updated: true, store: updated, url: showroomUrl(env, id) };
  },
});
