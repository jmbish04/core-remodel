/**
 * @fileoverview MCP tool — send_vehicle_navigation (Tesla domain).
 */
import { driveListStops, driveLists, showroomStores } from "@backend/db";
import { sendNavigation, tessieConfigured } from "@backend/services/tesla";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";

export const sendVehicleNavigation = defineTool({
  name: "send_vehicle_navigation",
  category: "tesla",
  title: "Send a destination to the car",
  description:
    "Push a destination to the vehicle's navigation. Accepts a free-text `destination`, explicit " +
    "`latitude`/`longitude`, or a `stopId` from a drive list (whose coordinates — or address — are " +
    "resolved for you). This changes what the car's screen is routing to, so confirm the destination " +
    "with the driver before calling it.",
  inputShape: {
    destination: z.string().optional().describe("Address or place name."),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    stopId: z.number().int().positive().optional().describe("A drive_list_stops id."),
  },
  annotations: WRITE,
  outputShape: {
    ok: z.boolean(),
    destination: z.string(),
  },
  examples: [
    { title: "By address", args: { destination: "1400 16th St, San Francisco, CA" } },
    { title: "To a drive stop", args: { stopId: 42 } },
  ],
  handler: async ({ env, db }, input) => {
    if (!(await tessieConfigured(env))) {
      toolError(
        "Tesla is not configured (TESSIE_API_TOKEN / TESLA_BETSY_VIN). See /admin/config/integrations/tesla.",
      );
    }

    let dest: string | null = null;
    if (typeof input.latitude === "number" && typeof input.longitude === "number") {
      dest = `${input.latitude},${input.longitude}`;
    } else if (input.destination?.trim()) {
      dest = input.destination.trim();
    } else if (input.stopId != null) {
      const [stop] = await db
        .select({
          name: driveListStops.name,
          city: driveListStops.city,
          address: driveListStops.address,
          lat: driveListStops.latitude,
          lng: driveListStops.longitude,
          sLat: showroomStores.latitude,
          sLng: showroomStores.longitude,
        })
        .from(driveListStops)
        .innerJoin(driveLists, eq(driveListStops.driveListId, driveLists.id))
        .leftJoin(showroomStores, eq(driveListStops.showroomStoreId, showroomStores.id))
        .where(eq(driveListStops.id, input.stopId))
        .limit(1);
      if (!stop) toolError("Stop not found. Call get_drive_list for valid stop ids.");
      // Prefer precise coordinates (the stop's own, else its showroom's); the
      // address text is the fallback because Tesla's geocoder can miss.
      const lat = stop.lat ?? stop.sLat;
      const lng = stop.lng ?? stop.sLng;
      dest = lat != null && lng != null ? `${lat},${lng}` : (stop.address ?? `${stop.name} ${stop.city ?? ""}`.trim());
    }

    if (!dest) toolError("Pass `destination`, or `latitude` + `longitude`, or `stopId`.");

    const result = await sendNavigation(env, dest);
    if (!result.ok) toolError(`Tessie rejected the navigation: ${result.error}`);
    return { ok: true, destination: dest };
  },
});
