/**
 * @fileoverview MCP tool — analyze_drive_coverage (Showroom Drive Lists domain).
 */
import { driveListStops, driveLists, showroomStores } from "@backend/db";
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";

export const analyzeDriveCoverage = defineTool({
    name: "analyze_drive_coverage",
    category: "drives",
    title: "Analyze showroom drive coverage",
    description:
      "Coverage analysis for planning the next drive. Returns (1) stops left UNVISITED on the drive(s) " +
      "— for stops linked to a registered showroom, whether that showroom nonetheless has a real visit " +
      "signal (a latest-visit rating), i.e. it was likely visited outside the drive; and (2) registered " +
      "showrooms not yet on ANY drive list, as candidates for a future drive. Pass a `slug`/`id` to scope " +
      "to one drive, or omit to analyze all drives.",
    inputShape: {
      id: z.number().int().positive().optional().describe("Scope to one drive (id)"),
      slug: z.string().optional().describe("Scope to one drive (slug)"),
      candidateLimit: z.number().int().positive().max(200).optional().describe("Max candidate showrooms (default 50)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      unvisitedStops: z.array(
        looseObject({
          stopId: z.number().int(),
          driveSlug: z.string(),
          name: z.string(),
          showroomStoreId: z.number().int().nullable(),
          showroomVisitedElsewhere: z.boolean(),
        }),
      ),
      candidateShowrooms: z.array(
        looseObject({ id: z.number().int(), name: z.string(), url: urlField }),
      ),
      summary: looseObject({
        unvisitedCount: z.number().int(),
        visitedElsewhereCount: z.number().int(),
        candidateCount: z.number().int(),
      }),
    },
    examples: [
      { title: "All drives", args: {} },
      { title: "One drive", args: { slug: "east-bay-stone-run" } },
    ],
    handler: async ({ env, db }, input) => {
      // Resolve optional drive scope.
      let driveScopeId: number | null = null;
      if (input.id != null || input.slug) {
        const [drive] = await db
          .select({ id: driveLists.id })
          .from(driveLists)
          .where(input.id != null ? eq(driveLists.id, input.id) : eq(driveLists.slug, input.slug!))
          .limit(1);
        if (!drive) toolError("Drive list not found. Call list_drive_lists for valid ids/slugs.");
        driveScopeId = drive.id;
      }

      // Unvisited stops (optionally scoped), joined to the drive for its slug and
      // to the showroom for its latest-visit rating (the "visited elsewhere" signal).
      const unvisitedWhere = driveScopeId
        ? and(eq(driveListStops.visited, false), eq(driveListStops.driveListId, driveScopeId))
        : eq(driveListStops.visited, false);
      const unvisitedRows = await db
        .select({
          stopId: driveListStops.id,
          driveSlug: driveLists.slug,
          name: driveListStops.name,
          showroomStoreId: driveListStops.showroomStoreId,
          showroomRating: showroomStores.rating,
        })
        .from(driveListStops)
        .innerJoin(driveLists, eq(driveListStops.driveListId, driveLists.id))
        .leftJoin(showroomStores, eq(driveListStops.showroomStoreId, showroomStores.id))
        .where(unvisitedWhere)
        .all();

      const unvisitedStops = unvisitedRows.map((r) => ({
        stopId: r.stopId,
        driveSlug: r.driveSlug,
        name: r.name,
        showroomStoreId: r.showroomStoreId,
        // A latest-visit rating is only set on an actual visit → a strong signal
        // the showroom was visited even though this stop stayed unchecked.
        showroomVisitedElsewhere: r.showroomStoreId != null && r.showroomRating != null,
      }));

      // Registered showrooms not referenced by ANY drive stop → future candidates.
      // Materialize the used ids first: notInArray wants a primitive array (not a
      // subquery), and an empty `NOT IN ()` is a SQLite syntax error — so only
      // apply the filter when some showrooms are actually in use.
      const usedRows = await db
        .selectDistinct({ id: driveListStops.showroomStoreId })
        .from(driveListStops)
        .where(isNotNull(driveListStops.showroomStoreId))
        .all();
      const usedIds = usedRows
        .map((r) => r.id)
        .filter((id): id is number => id != null);
      const candidateRows = await db
        .select({ id: showroomStores.id, name: showroomStores.name })
        .from(showroomStores)
        .where(usedIds.length ? notInArray(showroomStores.id, usedIds) : undefined)
        .limit(input.candidateLimit ?? 50)
        .all();

      return {
        unvisitedStops,
        candidateShowrooms: candidateRows.map((s) => ({
          id: s.id,
          name: s.name,
          url: showroomUrl(env, s.id),
        })),
        summary: {
          unvisitedCount: unvisitedStops.length,
          visitedElsewhereCount: unvisitedStops.filter((s) => s.showroomVisitedElsewhere).length,
          candidateCount: candidateRows.length,
        },
      };
    },
  });
