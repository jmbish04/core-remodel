/**
 * @fileoverview MCP tool — remove_drive_stop (Showroom Drive Lists domain).
 */
import { removeDriveStop } from "@backend/services/drive-lists";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, DESTRUCTIVE } from "../../types";

export const removeDriveStopTool = defineTool({
  name: "remove_drive_stop",
  category: "drives",
  title: "Remove a stop from a drive list",
  description:
    "Delete a single stop from a drive by its `stopId` (from get_drive_list). This is permanent — " +
    "to keep the stop but take it off the route, prefer update_drive_stop with `skipped: true`. " +
    "Returns { ok, stopId, driveListId }.",
  inputShape: {
    stopId: z.number().int().describe("The drive_list_stops.id to delete (required)"),
  },
  annotations: DESTRUCTIVE,
  outputShape: {
    ok: z.boolean(),
    stopId: z.number().int().optional(),
    driveListId: z.number().int().optional(),
  },
  examples: [{ title: "Delete a stop", args: { stopId: 88 } }],
  handler: async ({ db }, input) => {
    const res = await removeDriveStop(db, input.stopId);
    if (!res) toolError(`No stop found with id ${input.stopId}.`);
    return { ok: true, stopId: input.stopId, driveListId: res.driveListId };
  },
});
