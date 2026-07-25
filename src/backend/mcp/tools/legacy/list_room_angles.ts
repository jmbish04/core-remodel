import { listingPhotos } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listRoomAngles = defineTool({
    name: "list_room_angles",
    category: "render",
    title: "List room angles",
    description:
      "List a room's blank-canvas angle photos (listing photos) available to render.",
    inputShape: {
      roomId: z.number().describe("Room id whose listing photos to list."),
    },
    annotations: READ_ONLY,
    examples: [{ title: "Angles available for a room", args: { roomId: 3 } }],
    // Envelope the array under `items` so the tool can carry an object
    // outputSchema (MCP structuredContent must be an object, never a bare array).
    outputShape: {
      items: z.array(
        looseObject({
          listingPhotoId: z.number().int(),
          roomName: z.string().nullable(),
          hasBlankCanvas: z.boolean(),
        }),
      ),
    },
    handler: async ({ db }, input) => {
      const args = input as { roomId: unknown };
      const rows = await db
        .select()
        .from(listingPhotos)
        .where(eq(listingPhotos.roomId, Number(args.roomId)))
        .all();
      return {
        items: rows.map((r) => ({
          listingPhotoId: r.id,
          roomName: r.roomName,
          hasBlankCanvas: !!r.blankCanvasCfImageId,
        })),
      };
    },
  });
