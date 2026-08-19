/**
 * @fileoverview MCP tool — update_drive_list (Showroom Drive Lists domain).
 */
import { updateDriveList } from "@backend/services/drive-lists";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { driveListUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

export const updateDriveListTool = defineTool({
  name: "update_drive_list",
  category: "drives",
  title: "Edit a drive list's details",
  description:
    "Edit a drive sheet's own fields — `title`, `description`, `notes`, or `status` — identified by " +
    "`id` or `slug`. Only the fields you pass are changed. `notes` REPLACES the whole notes array " +
    "(one short string per card; pass `null` or `[]` to clear). HTML entities in text are decoded. " +
    "`status` is a lifecycle LABEL only — it does NOT make the drive active; activation happens on " +
    "the drive page and is limited to 07:00–20:00 Pacific. This does NOT touch stops — use " +
    "update_drive_stop / add_drive_stops / remove_drive_stop for those. Returns { ok, id, slug, url }.",
  inputShape: {
    id: z.number().int().optional().describe("Drive id (or pass `slug`)"),
    slug: z.string().optional().describe("Drive slug (or pass `id`)"),
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    notes: z
      .array(z.string().min(1))
      .nullable()
      .optional()
      .describe("REPLACES the notes array — one entry per card; null or [] clears all notes"),
    status: z.enum(["draft", "active", "completed", "archived"]).optional(),
  },
  annotations: WRITE,
  outputShape: {
    ok: z.boolean(),
    id: z.number().int().optional(),
    slug: z.string().optional(),
    url: urlField.optional(),
  },
  examples: [
    {
      title: "Rename a drive and mark it complete",
      args: { slug: "east-bay-stone-run", title: "East Bay Stone Run (done)", status: "completed" },
    },
    {
      title: "Replace the notes on a drive",
      args: { id: 12, notes: ["City Lights closes 4pm Sat — go FIRST.", "All appliance stops carry panel-ready units."] },
    },
  ],
  handler: async ({ env, db }, input) => {
    if (input.id == null && !input.slug) {
      toolError("Pass `id` or `slug` to identify the drive to update.");
    }
    const res = await updateDriveList(db, input);
    if (!res) toolError("No drive list matched that id/slug.");
    return { ok: true, id: res.id, slug: res.slug, url: driveListUrl(env, res.slug) };
  },
});
