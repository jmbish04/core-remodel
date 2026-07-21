/**
 * @fileoverview MCP tool — get_vehicle_location (Tesla domain).
 */
import { getLocation, tessieConfigured } from "@backend/services/tesla";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, READ_ONLY } from "../../types";

export const getVehicleLocation = defineTool({
  name: "get_vehicle_location",
  category: "tesla",
  title: "Where the car is right now",
  description:
    "Live GPS position of the configured vehicle, read from Tessie. Use this to answer 'where am I' " +
    "and 'what's near me' when the driver is in the car — for the last known PHONE/browser position " +
    "instead, use get_user_location, which combines both.",
  inputShape: {},
  annotations: READ_ONLY,
  outputShape: {
    latitude: z.number(),
    longitude: z.number(),
    address: z.string().nullable(),
    mapUrl: z.string(),
  },
  examples: [{ title: "Where is the car?", args: {} }],
  handler: async ({ env }) => {
    if (!(await tessieConfigured(env))) {
      toolError(
        "Tesla is not configured (TESSIE_API_TOKEN / TESLA_BETSY_VIN). See /admin/config/integrations/tesla.",
      );
    }
    const loc = await getLocation(env);
    if (!loc) {
      toolError("Tessie returned no position — the car may be asleep or unreachable.");
    }
    return {
      latitude: loc.latitude,
      longitude: loc.longitude,
      address: loc.address ?? null,
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`,
    };
  },
});
