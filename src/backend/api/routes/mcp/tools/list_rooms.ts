import { listActiveRooms } from "@backend/services/measurements";

import type { ToolDef } from "../types";

export const listRooms: ToolDef = {
  name: "list_rooms",
  description:
    "List the home's ACTIVE rooms (id, roomCode, roomName, floorId, areaSqFt). Use a room's `id` as the `roomId` argument to add_measurement. Only active rooms are valid measurement targets.",
  inputSchema: { type: "object", properties: {} },
  handler: async ({ db }) => {
    const activeRooms = await listActiveRooms(db);
    return JSON.stringify(activeRooms);
  },
};
