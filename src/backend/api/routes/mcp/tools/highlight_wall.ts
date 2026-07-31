import type { ToolDef } from "../types";

export const highlightWall: ToolDef = {
  name: "highlight_wall",
  description:
    "Point at a wall segment on the live collaborative floor plan: it flashes amber on every connected screen (the phone at /measure plus any open desktop tab) — i.e. 'Claude is pointing here'. This is how you 'touch' a wall during a measuring session so your human can confirm you mean the right one. `elementId` is the traced SVG segment id, e.g. 'upper_wall_segment_12' or 'lower_wall_segment_3'. `room` defaults to the house room '126-colby'. Returns how many screens it lit up.",
  inputSchema: {
    type: "object",
    properties: {
      elementId: { type: "string" },
      room: { type: "string" },
    },
    required: ["elementId"],
  },
  handler: async ({ env, args }) => {
    const elementId = String(args.elementId ?? "").trim();
    if (!elementId) throw new Error("elementId is required");
    const room = (args.room ? String(args.room) : "126-colby").trim() || "126-colby";
    // Server-side RPC into the room's DurableObject — broadcasts a WALL_TOUCH to every
    // connected screen without Claude having to hold a WebSocket. See FloorplanSessionDO.
    const delivered = await env.FLOORPLAN_SESSION.getByName(room).injectTouch(elementId, "claude");
    return JSON.stringify({ room, elementId, delivered });
  },
};
