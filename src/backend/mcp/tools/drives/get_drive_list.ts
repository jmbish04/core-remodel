/**
 * @fileoverview MCP tool — get_drive_list (Showroom Drive Lists domain).
 */
import { driveListStops, driveLists } from "@backend/db";
import { parseDriveNotes } from "@backend/services/drive-lists";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { driveListUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";

export const getDriveList = defineTool({
    name: "get_drive_list",
    category: "drives",
    title: "Get a showroom drive list",
    description:
      "Full detail for one drive list (by `id` or `slug`): its stops in order, each with its leg, " +
      "details, and visited check-off state.",
    inputShape: {
      id: z.number().int().positive().optional().describe("Drive list id"),
      slug: z.string().optional().describe("Drive list slug (alternative to id)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      id: z.number().int(),
      slug: z.string(),
      title: z.string(),
      status: z.string(),
      url: urlField,
      notes: z.array(z.string()).describe("Planning notes, one entry per note card"),
      stopCount: z.number().int(),
      visitedCount: z.number().int(),
      stops: z.array(looseObject({ id: z.number().int(), name: z.string(), visited: z.boolean() })),
    },
    examples: [{ title: "By slug", args: { slug: "east-bay-stone-run" } }],
    handler: async ({ env, db }, input) => {
      if (input.id == null && !input.slug) toolError("Pass either `id` or `slug`.");
      const [drive] = await db
        .select()
        .from(driveLists)
        .where(input.id != null ? eq(driveLists.id, input.id) : eq(driveLists.slug, input.slug!))
        .limit(1);
      if (!drive) toolError("Drive list not found. Call list_drive_lists for valid ids/slugs.");

      const stops = await db
        .select()
        .from(driveListStops)
        .where(eq(driveListStops.driveListId, drive.id))
        .orderBy(driveListStops.sortOrder, driveListStops.id)
        .all();

      return {
        id: drive.id,
        slug: drive.slug,
        title: drive.title,
        description: drive.description,
        notes: parseDriveNotes(drive.notes),
        status: drive.status,
        url: driveListUrl(env, drive.slug),
        stopCount: stops.length,
        visitedCount: stops.filter((s) => s.visited).length,
        stops,
      };
    },
  });
