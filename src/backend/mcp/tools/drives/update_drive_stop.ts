/**
 * @fileoverview MCP tool — update_drive_stop (Showroom Drive Lists domain).
 */
import { updateDriveStop } from "@backend/services/drive-lists";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";

export const updateDriveStopTool = defineTool({
  name: "update_drive_stop",
  category: "drives",
  title: "Edit one stop on a drive list",
  description:
    "Edit a single stop on a drive by its `stopId` (from get_drive_list). Only the fields you pass " +
    "are changed. Use it to fix a name/address/hours, attach a `showroomStoreId`, retarget coords, " +
    "reorder (`sortOrder`), flip `isOptional` (kind is kept in sync), or set `visited`/`skipped` " +
    "(their timestamps are stamped automatically). Text fields are entity-decoded. Returns " +
    "{ ok, stopId, driveListId }.",
  inputShape: {
    stopId: z.number().int().describe("The drive_list_stops.id to edit (required)"),
    name: z.string().min(1).optional(),
    showroomStoreId: z.number().int().nullable().optional().describe("Link/unlink a registered showroom"),
    city: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    hours: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    pick: z.string().nullable().optional(),
    websiteUrl: z.string().nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    leg: z.string().nullable().optional(),
    legWindow: z.string().nullable().optional(),
    isOptional: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    visited: z.boolean().optional(),
    skipped: z.boolean().optional(),
  },
  annotations: WRITE,
  outputShape: {
    ok: z.boolean(),
    stopId: z.number().int().optional(),
    driveListId: z.number().int().optional(),
  },
  examples: [
    {
      title: "Fix a stop's hours and link its showroom",
      args: { stopId: 88, hours: "Fri 9:00–5:00", showroomStoreId: 143 },
    },
    { title: "Mark a stop skipped", args: { stopId: 88, skipped: true } },
  ],
  handler: async ({ db }, input) => {
    const { stopId, ...fields } = input;
    const res = await updateDriveStop(db, stopId, fields);
    if (!res) toolError(`No stop found with id ${stopId}.`);
    return { ok: true, stopId, driveListId: res.driveListId };
  },
});
