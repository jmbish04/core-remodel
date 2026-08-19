import { renderSessions } from "@backend/db";

import type { ToolDef } from "../types";

export const createRenderSession: ToolDef = {
  name: "create_render_session",
  description: "Create a render session for a room. Returns a sessionId used by other tools.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" }, roomId: { type: "number" } },
    required: ["name"],
  },
  handler: async ({ db, args }) => {
    const id = crypto.randomUUID();
    await db
      .insert(renderSessions)
      .values({ id, name: String(args.name), roomId: args.roomId ?? null })
      .run();
    return JSON.stringify({ sessionId: id });
  },
};
