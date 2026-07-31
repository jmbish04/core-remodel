import { moodBoardGenerations } from "@backend/db";

import type { ToolDef } from "../types";

export const listMoodBoards: ToolDef = {
  name: "list_mood_boards",
  description: "List generated mood boards, optionally filtered by keyword (q) or roomId.",
  inputSchema: {
    type: "object",
    properties: { q: { type: "string" }, roomId: { type: "number" } },
  },
  handler: async ({ db, args }) => {
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
    return JSON.stringify(
      filtered.map((r) => ({ id: r.id, aiTitle: r.aiTitle, outputImageUrl: r.outputImageUrl })),
    );
  },
};
