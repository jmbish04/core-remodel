import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";

export const highlightWall = defineTool({
    name: "highlight_wall",
    category: "render",
    title: "Highlight wall",
    description:
      "Point at a wall segment on the live collaborative floor plan: it flashes amber on every connected screen (the phone at /measure plus any open desktop tab) — i.e. 'Claude is pointing here'. This is how you 'touch' a wall during a measuring session so your human can confirm you mean the right one. `elementId` is the traced SVG segment id, e.g. 'upper_wall_segment_12' or 'lower_wall_segment_3'. `room` defaults to the house room '126-colby'. Returns how many screens it lit up.",
    inputShape: {
      elementId: z
        .string()
        .describe("Traced SVG segment id, e.g. 'upper_wall_segment_12'."),
      room: z.string().optional().describe("Floor-plan room key. Defaults to '126-colby'."),
    },
    annotations: WRITE,
    examples: [
      { title: "Point at an upper-floor wall segment", args: { elementId: "upper_wall_segment_12" } },
      {
        title: "Point at a segment on a specific floor plan",
        args: { elementId: "lower_wall_segment_3", room: "126-colby" },
      },
    ],
    outputShape: {
      room: z.string().describe("The floor-plan room key that was signalled"),
      elementId: z.string().describe("The wall segment id that flashed"),
      delivered: z.any().describe("How many connected screens lit up"),
    },
    handler: async ({ env }, input) => {
      const args = input as { elementId?: unknown; room?: unknown };
      const elementId = String(args.elementId ?? "").trim();
      if (!elementId) toolError("elementId is required");
      const room = (args.room ? String(args.room) : "126-colby").trim() || "126-colby";
      // Server-side RPC into the room's DurableObject — broadcasts a WALL_TOUCH to every
      // connected screen without Claude having to hold a WebSocket. See FloorplanSessionDO.
      const delivered = await env.FLOORPLAN_SESSION.getByName(room).injectTouch(elementId, "claude");
      return { room, elementId, delivered };
    },
  });
