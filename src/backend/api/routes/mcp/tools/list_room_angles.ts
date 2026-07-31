import { listingPhotos } from "@backend/db";
import { eq } from "drizzle-orm";

import type { ToolDef } from "../types";

export const listRoomAngles: ToolDef = {
  name: "list_room_angles",
  description: "List a room's blank-canvas angle photos (listing photos) available to render.",
  inputSchema: {
    type: "object",
    properties: { roomId: { type: "number" } },
    required: ["roomId"],
  },
  handler: async ({ db, args }) => {
    const rows = await db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.roomId, Number(args.roomId)))
      .all();
    return JSON.stringify(
      rows.map((r) => ({
        listingPhotoId: r.id,
        roomName: r.roomName,
        hasBlankCanvas: !!r.blankCanvasCfImageId,
      })),
    );
  },
};
