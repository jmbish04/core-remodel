import { moodBoardGenerations } from "@backend/db";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listMoodBoards = defineTool({
    name: "list_mood_boards",
    category: "render",
    title: "List mood boards",
    description:
      "List generated mood boards, optionally filtered by keyword (q) or roomId.",
    inputShape: {
      q: z.string().optional().describe("Free-text filter over title/description."),
      roomId: z.number().optional().describe("Filter to a single room id."),
    },
    annotations: READ_ONLY,
    examples: [
      { title: "All mood boards", args: {} },
      { title: "Kitchen mood boards", args: { roomId: 3, q: "kitchen" } },
    ],
    outputShape: {
      items: z.array(
        looseObject({
          id: z.union([z.number(), z.string()]),
          aiTitle: z.string().nullable(),
          outputImageUrl: z.string().nullable(),
        }),
      ),
    },
    handler: async ({ db }, input) => {
      const args = input as { q?: unknown; roomId?: unknown };
      const rows = await db.select().from(moodBoardGenerations).all();
      let filtered = rows;
      if (args.roomId != null) filtered = filtered.filter((r) => r.roomId === Number(args.roomId));
      if (args.q) {
        const q = String(args.q).toLowerCase();
        filtered = filtered.filter(
          (r) =>
            (r.aiTitle ?? "").toLowerCase().includes(q) ||
            (r.aiDescription ?? "").toLowerCase().includes(q),
        );
      }
      return {
        items: filtered.map((r) => ({
          id: r.id,
          aiTitle: r.aiTitle,
          outputImageUrl: r.outputImageUrl,
        })),
      };
    },
  });
