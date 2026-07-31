/**
 * @fileoverview MCP tool — send_drive_to_tesla (Tesla domain, 0032 N1).
 *
 * Send a whole planned drive (all its stops, in order) to the car as a
 * multi-waypoint route — the voice/chat twin of the drive viewport's "Send drive
 * to car" button. Goes through the same `sendMultiWaypointNavigation` service the
 * REST route uses (a Google Maps directions share; a native Fleet-API waypoints
 * request is a documented follow-up).
 */
import { driveLists, driveListStops, showroomStores } from "@backend/db";
import { sendMultiWaypointNavigation, tessieConfigured } from "@backend/services/tesla";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";

export const sendDriveToTesla = defineTool({
  name: "send_drive_to_tesla",
  category: "tesla",
  title: "Send a whole drive to the car",
  description:
    "Push an entire planned drive to the vehicle as a multi-stop route (in stop order, skipping " +
    "skipped stops and un-promoted pitstops). Pass a `driveListId` or a drive `slug`. This changes " +
    "what the car is routing to, so confirm with the driver first. For a single destination use " +
    "`send_vehicle_navigation` instead. Returns { ok, method, count }.",
  inputShape: {
    driveListId: z.number().int().positive().optional().describe("The drive_lists id to send."),
    slug: z.string().optional().describe("The drive's slug (alternative to driveListId)."),
  },
  annotations: WRITE,
  outputShape: {
    ok: z.boolean(),
    method: z.string().optional().describe("'single' or 'maps-route'."),
    count: z.number().int().optional().describe("How many waypoints were sent."),
  },
  examples: [
    { title: "By id", args: { driveListId: 12 } },
    { title: "By slug", args: { slug: "east-bay-stone-run" } },
  ],
  handler: async ({ env, db }, input) => {
    if (!(await tessieConfigured(env))) {
      toolError(
        "Tesla is not configured (TESSIE_API_TOKEN / TESLA_BETSY_VIN). See /admin/config/integrations/tesla.",
      );
    }

    let driveListId = input.driveListId ?? null;
    if (driveListId == null && input.slug) {
      const [dl] = await db
        .select({ id: driveLists.id })
        .from(driveLists)
        .where(eq(driveLists.slug, input.slug))
        .limit(1);
      driveListId = dl?.id ?? null;
    }
    if (driveListId == null) toolError("Pass a `driveListId` or a drive `slug`.");

    const stops = await db
      .select({
        name: driveListStops.name,
        skipped: driveListStops.skipped,
        suggested: driveListStops.suggested,
        lat: driveListStops.latitude,
        lng: driveListStops.longitude,
        sLat: showroomStores.latitude,
        sLng: showroomStores.longitude,
      })
      .from(driveListStops)
      .leftJoin(showroomStores, eq(driveListStops.showroomStoreId, showroomStores.id))
      .where(eq(driveListStops.driveListId, driveListId as number))
      .orderBy(driveListStops.sortOrder)
      .all();

    const waypoints = stops
      .filter((s) => !s.skipped && !s.suggested)
      .map((s) => {
        const lat = s.lat ?? s.sLat;
        const lng = s.lng ?? s.sLng;
        return lat != null && lng != null ? { latitude: lat, longitude: lng, label: s.name } : null;
      })
      .filter((w): w is { latitude: number; longitude: number; label: string } => w != null);

    if (waypoints.length === 0) {
      toolError("This drive has no stops with coordinates to navigate.");
    }

    const result = await sendMultiWaypointNavigation(env, waypoints);
    if (!result.ok) toolError(`Tessie rejected the drive: ${result.error}`);
    return { ok: true, method: result.method, count: result.count };
  },
});
