import { showroomStoreLinks, showroomStores } from "@backend/db";
import { replaceStoreLinks } from "@backend/utils/showroom-links";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";

export const setShowroomLinks = defineTool({
  name: "set_showroom_links",
  category: "showrooms",
  title: "Set a showroom's links",
  description:
    "Replace ALL of a showroom's links (website + socials + misc) in one call. Send the FULL desired list — it replaces the existing set (so include links you want to keep). Each link has a `url` and a `type` (WEBSITE / INSTAGRAM / PINTEREST / FACEBOOK / OTHER) plus optional `urlNotes`. Use this for the website/social URLs that update_showroom no longer accepts. Validates the showroom exists first.",
  inputShape: {
    storeId: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
    links: z
      .array(
        z.object({
          url: z.string().url().describe("The full URL (https://…)"),
          type: z
            .enum(["WEBSITE", "INSTAGRAM", "PINTEREST", "FACEBOOK", "OTHER"])
            .describe("Link type"),
          urlNotes: z.string().optional().describe("Optional note about this link"),
        }),
      )
      .describe("The full desired link set — replaces all existing links for the store"),
  },
  annotations: WRITE_IDEMPOTENT,
  examples: [
    {
      title: "Set website + Instagram",
      args: {
        storeId: 4,
        links: [
          { url: "https://davincimarble.com", type: "WEBSITE" },
          { url: "https://instagram.com/davincimarble", type: "INSTAGRAM" },
        ],
      },
    },
  ],
  outputShape: {
    ok: z.boolean(),
    storeId: z.number().int(),
    links: z.array(
      looseObject({ id: z.number().int(), url: z.string(), type: z.string() }),
    ),
  },
  handler: async ({ db }, input) => {
    const [store] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(eq(showroomStores.id, input.storeId))
      .limit(1);
    if (!store) {
      toolError(`Showroom ${input.storeId} not found. Call list_showrooms for valid ids.`);
    }
    await replaceStoreLinks(db, input.storeId, input.links);
    const links = await db
      .select({
        id: showroomStoreLinks.id,
        url: showroomStoreLinks.url,
        type: showroomStoreLinks.type,
      })
      .from(showroomStoreLinks)
      .where(eq(showroomStoreLinks.storeId, input.storeId));
    return { ok: true, storeId: input.storeId, links };
  },
});
