/**
 * @fileoverview MCP tool — add_drive_stops (Showroom Drive Lists domain).
 */
import { addDriveStops } from "@backend/services/drive-lists";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { driveListUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

/** One stop as accepted by add_drive_stops (same shape as create_drive_list). */
const stopInput = looseObject({
  name: z.string().min(1).describe("Showroom / stop name (required)"),
  showroomStoreId: z.number().int().optional().describe("Link to a registered showroom (showroom_stores.id)"),
  city: z.string().optional(),
  address: z.string().optional().describe("Street address — the tap-to-navigate destination"),
  phone: z.string().optional(),
  hours: z.string().optional(),
  note: z.string().optional(),
  pick: z.string().optional(),
  websiteUrl: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  leg: z.string().optional(),
  legWindow: z.string().optional(),
  isOptional: z.boolean().optional().describe("true = optional research pick; false = core numbered stop"),
});

export const addDriveStopsTool = defineTool({
  name: "add_drive_stops",
  category: "drives",
  title: "Add stops to a drive list",
  description:
    "Append one or more stops to an existing drive (identified by `id` or `slug`). New stops go " +
    "AFTER the current last stop, in the order given. Same stop shape as create_drive_list; text is " +
    "entity-decoded. To insert in the middle or reorder afterwards, set each stop's `sortOrder` with " +
    "update_drive_stop. Returns { ok, driveListId, added, stopCount, url }.",
  inputShape: {
    id: z.number().int().optional().describe("Drive id (or pass `slug`)"),
    slug: z.string().optional().describe("Drive slug (or pass `id`)"),
    stops: z.array(stopInput).min(1).describe("Stops to append, in order"),
  },
  annotations: WRITE,
  outputShape: {
    ok: z.boolean(),
    driveListId: z.number().int().optional(),
    added: z.number().int().optional(),
    stopCount: z.number().int().optional(),
    url: z.string().optional(),
  },
  examples: [
    {
      title: "Add a detour stop to a drive",
      args: {
        slug: "east-bay-stone-run",
        stops: [{ name: "Cava Marble", city: "Oakland", address: "1234 Broadway, Oakland, CA", isOptional: true, pick: "detour" }],
      },
    },
  ],
  handler: async ({ env, db }, input) => {
    if (input.id == null && !input.slug) toolError("Pass `id` or `slug` to identify the drive.");
    if (!input.stops?.length) toolError("`stops` must contain at least one stop.");
    const res = await addDriveStops(db, { id: input.id, slug: input.slug }, input.stops);
    if (!res) toolError("No drive list matched that id/slug.");
    return {
      ok: true,
      driveListId: res.driveListId,
      added: res.added,
      stopCount: res.stopCount,
      url: input.slug ? driveListUrl(env, input.slug) : undefined,
    };
  },
});
