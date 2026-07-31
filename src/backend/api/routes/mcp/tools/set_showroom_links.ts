import { showroomStoreLinks } from "@backend/db/schema/showroom/index";
import { SHOWROOM_LINK_TYPES, replaceStoreLinks } from "@backend/utils/showroom-links";
import { eq } from "drizzle-orm";

import type { ToolDef } from "../types";

export const setShowroomLinks: ToolDef = {
  name: "set_showroom_links",
  description:
    "Replace ALL of a showroom's links (website + socials + misc). For bulk-filling or correcting URLs. Send the full desired link list — it replaces the existing set.",
  inputSchema: {
    type: "object",
    properties: {
      storeId: { type: "number" },
      links: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            type: { type: "string", enum: [...SHOWROOM_LINK_TYPES] },
            urlNotes: { type: "string" },
          },
          required: ["url", "type"],
        },
      },
    },
    required: ["storeId", "links"],
  },
  handler: async ({ db, args }) => {
    const storeId = Number(args.storeId);
    await replaceStoreLinks(db, storeId, (args.links as any[]) ?? []);
    const links = await db
      .select({ id: showroomStoreLinks.id, url: showroomStoreLinks.url, type: showroomStoreLinks.type })
      .from(showroomStoreLinks)
      .where(eq(showroomStoreLinks.storeId, storeId));
    return JSON.stringify({ ok: true, storeId, links });
  },
};
