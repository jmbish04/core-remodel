import { generateMoodBoard } from "@backend/services/render/mood-board";

import type { ToolDef } from "../types";

export const generateMoodBoardTool: ToolDef = {
  name: "generate_mood_board",
  description: "Generate an interior-design mood board from a prompt and/or image URLs.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      imageUrls: { type: "array", items: { type: "string" } },
      roomId: { type: "number" },
    },
  },
  handler: async ({ env, args }) => {
    const mb = await generateMoodBoard({
      env,
      prompt: args.prompt ? String(args.prompt) : undefined,
      imageUrls: Array.isArray(args.imageUrls) ? args.imageUrls.map(String) : undefined,
      roomId: args.roomId ?? null,
      source: "api",
    });
    return JSON.stringify(mb);
  },
};
