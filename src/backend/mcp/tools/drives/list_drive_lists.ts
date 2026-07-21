/**
 * @fileoverview MCP tool — list_drive_lists (Showroom Drive Lists domain).
 */
import { driveListStops, driveLists } from "@backend/db";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { looseObject, urlField } from "../../schemas";
import { driveListUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";

export const listDriveLists = defineTool({
    name: "list_drive_lists",
    category: "drives",
    title: "List showroom drive lists",
    description:
      "List showroom drive lists (drive sheets) newest-first, each with its completion progress " +
      "(visited vs. total stops) and `isActive` — at most one drive is THE active drive, the one " +
      "admin devices auto-land on. Use this to see prior drives before creating or analyzing one.",
    inputShape: {
      status: z.enum(["draft", "active", "completed", "archived"]).optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      count: z.number().int(),
      driveLists: z.array(
        looseObject({
          id: z.number().int(),
          slug: z.string(),
          title: z.string(),
          status: z.string(),
          isActive: z.boolean(),
          stopCount: z.number().int(),
          visitedCount: z.number().int(),
          url: urlField,
        }),
      ),
    },
    examples: [
      { title: "All drives", args: {} },
      { title: "Active only", args: { status: "active" } },
    ],
    handler: async ({ env, db }, input) => {
      const rows = await db
        .select({
          id: driveLists.id,
          slug: driveLists.slug,
          title: driveLists.title,
          description: driveLists.description,
          status: driveLists.status,
          isActive: driveLists.isActive,
          createdAt: driveLists.createdAt,
          stopCount: sql<number>`count(${driveListStops.id})`,
          visitedCount: sql<number>`coalesce(sum(${driveListStops.visited}), 0)`,
        })
        .from(driveLists)
        .leftJoin(driveListStops, eq(driveLists.id, driveListStops.driveListId))
        .where(input.status ? eq(driveLists.status, input.status) : undefined)
        .groupBy(driveLists.id)
        .orderBy(desc(driveLists.createdAt))
        .limit(input.limit ?? 100)
        .all();

      return {
        count: rows.length,
        driveLists: rows.map((r) => ({
          id: r.id,
          slug: r.slug,
          title: r.title,
          description: r.description,
          status: r.status,
          isActive: r.isActive,
          stopCount: Number(r.stopCount),
          visitedCount: Number(r.visitedCount),
          createdAt: r.createdAt,
          url: driveListUrl(env, r.slug),
        })),
      };
    },
  });
