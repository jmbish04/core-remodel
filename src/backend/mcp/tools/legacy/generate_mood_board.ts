import { z } from "zod";

import { generateMoodBoard } from "../../../services/render/mood-board";
import { looseObject } from "../../schemas";
import { defineTool, WRITE } from "../../types";

export const generateMoodBoardTool = defineTool({
    name: "generate_mood_board",
    category: "render",
    title: "Generate mood board",
    description:
      "Generate an interior-design mood board from a prompt and/or image URLs.",
    inputShape: {
      prompt: z.string().optional().describe("Text prompt describing the mood board."),
      imageUrls: z
        .array(z.string())
        .optional()
        .describe("Reference image URLs to seed the mood board."),
      roomId: z.number().optional().describe("Optional room id to associate."),
    },
    annotations: WRITE,
    // Envelope the opaque generateMoodBoard result under `moodBoard` (passthrough).
    outputShape: {
      moodBoard: looseObject({ id: z.string() }),
    },
    handler: async ({ env }, input) => {
      const args = input as { prompt?: unknown; imageUrls?: unknown; roomId?: unknown };
      const mb = await generateMoodBoard({
        env,
        prompt: args.prompt ? String(args.prompt) : undefined,
        imageUrls: Array.isArray(args.imageUrls) ? args.imageUrls.map(String) : undefined,
        roomId: (args.roomId as number | null) ?? null,
        source: "api",
      });
      return { moodBoard: mb };
    },
  });
