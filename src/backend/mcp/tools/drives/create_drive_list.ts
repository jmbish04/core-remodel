/**
 * @fileoverview MCP tool — create_drive_list (Showroom Drive Lists domain).
 */
import { createDriveList } from "@backend/services/drive-lists";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { driveListUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

/** One stop as accepted by create_drive_list. */
const stopInput = looseObject({
  name: z.string().min(1).describe("Showroom / stop name (required)"),
  showroomStoreId: z
    .number()
    .int()
    .optional()
    .describe("Link to a registered showroom (showroom_stores.id) — enables visit cross-referencing"),
  city: z.string().optional(),
  address: z.string().optional().describe("Street address — becomes the tap-to-navigate destination"),
  phone: z.string().optional(),
  hours: z.string().optional().describe("Human-readable hours line, e.g. 'Fri 8:00–4:30'"),
  note: z.string().optional().describe("Why this stop is on the list / what to look for"),
  pick: z.string().optional().describe("Optional 'research pick / detour' label"),
  websiteUrl: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  leg: z.string().optional().describe("Leg / cluster label (groups stops), e.g. 'Tri-Valley'"),
  legWindow: z.string().optional().describe("Time window for the leg, e.g. 'afternoon · down 680 → 580'"),
  isOptional: z.boolean().optional().describe("true = optional research pick; false = core numbered stop"),
});

export const createDriveListTool = defineTool({
    name: "create_drive_list",
    category: "drives",
    title: "Create a showroom drive list",
    description:
      "Create a showroom drive sheet — an ordered set of showroom stops for a day of visits. It " +
      "immediately appears on the `/admin/shopping/drives` landing page and opens in the drive " +
      "viewport. Pass a `title` and a `stops` array (in visit order); each stop needs a `name` and " +
      "should include an `address` (the tap-to-navigate destination) and, when it maps to a " +
      "registered showroom, a `showroomStoreId` so drive coverage can be analyzed later. Group " +
      "stops into legs with `leg`/`legWindow`. Optional `notes` is an ARRAY of short note strings " +
      "— each renders as its own full-width card at the bottom of the drive (put timing, hard " +
      "constraints, priorities, date checks in separate entries; do NOT jam them into one string). " +
      "Returns { ok, id, slug, url }.",
    inputShape: {
      title: z.string().min(1).describe("Drive title (required)"),
      description: z.string().optional(),
      notes: z
        .array(z.string().min(1))
        .optional()
        .describe("Planning notes as an array — one entry per note card (not required)"),
      status: z.enum(["draft", "active", "completed", "archived"]).optional(),
      sourceConversation: z.string().optional().describe("Note on where this came from (chat context)"),
      stops: z.array(stopInput).min(1).describe("Stops in visit order (at least one)"),
    },
    annotations: WRITE,
    outputShape: {
      ok: z.boolean(),
      id: z.number().int().optional(),
      slug: z.string().optional(),
      url: urlField.optional(),
      stopCount: z.number().int().optional(),
    },
    examples: [
      {
        title: "A two-stop drive",
        args: {
          title: "East Bay Stone Run",
          notes: [
            "City Lights closes 4pm Sat — do it FIRST and budget 1–2 hrs.",
            "All appliance stops carry panel-ready dishwashers + wall ovens.",
          ],
          stops: [
            {
              name: "All Natural Stone",
              city: "Berkeley",
              address: "611 Hearst Ave, Berkeley, CA 94710",
              hours: "Fri 8:00–4:30",
              leg: "West Berkeley → Oakland",
            },
            {
              name: "Arizona Tile",
              city: "Livermore",
              address: "7364 Marathon Dr, Livermore, CA 94550",
              leg: "Tri-Valley",
            },
          ],
        },
      },
    ],
    handler: async ({ env, db }, input) => {
      const title = input.title?.trim();
      if (!title) toolError("`title` is required and cannot be empty.");
      if (!input.stops?.length) toolError("`stops` must contain at least one stop.");

      const { id, slug, stopCount } = await createDriveList(db, {
        title,
        description: input.description,
        notes: input.notes,
        status: input.status,
        sourceConversation: input.sourceConversation,
        stops: input.stops,
      });

      return { ok: true, id, slug, url: driveListUrl(env, slug), stopCount };
    },
  });
