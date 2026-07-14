import { renderSessions } from "@backend/db";
import { z } from "zod";

import { defineTool, WRITE } from "../../types";

export const createRenderSession = defineTool({
    name: "create_render_session",
    category: "render",
    title: "Create render session",
    description:
      "Create a render session for a room. Returns a sessionId used by other tools.",
    inputShape: {
      name: z.string().describe("Human-readable name for the render session."),
      roomId: z
        .number()
        .optional()
        .describe("Optional room id this session belongs to."),
    },
    annotations: WRITE,
    outputShape: {
      sessionId: z.string().describe("The created render session id"),
    },
    handler: async ({ db }, input) => {
      const args = input as { name: unknown; roomId?: unknown };
      const id = crypto.randomUUID();
      await db
        .insert(renderSessions)
        .values({ id, name: String(args.name), roomId: (args.roomId as number | null) ?? null })
        .run();
      return { sessionId: id };
    },
  });
