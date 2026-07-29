/**
 * @fileoverview MCP tool — report_location (Tesla domain, 0032 L0).
 *
 * The AI-agent location source: when Claude knows where the user is (they said so,
 * or a connected source told it), it reports the coordinate here and the SAME park
 * pipeline every source runs kicks in — match a drive stop, home/work check, and
 * stage a soft arrival near a registered showroom on the active drive. The fix is
 * persisted to `device_location` (source `ai`) so an AI-staged visit is auditable.
 */
import { ingestLocationFix } from "@backend/services/location/ingest";
import { z } from "zod";

import { defineTool, WRITE } from "../../types";

export const reportLocation = defineTool({
  name: "report_location",
  category: "tesla",
  title: "Report the user's current location (AI source)",
  description:
    "Report a location coordinate on the user's behalf (the `ai` location source). Runs the shared " +
    "park pipeline: checks off a stop on the active drive, ends the drive if this is home/work, and " +
    "stages a soft-arrival visit if it's within range of a registered showroom during an active drive. " +
    "The fix is recorded to device_location (source=ai) for the receipts trail. Does NOT command the " +
    "car — use send_vehicle_navigation for that. Report a fix only when you actually know where the user is.",
  inputShape: {
    latitude: z.number().describe("Decimal degrees."),
    longitude: z.number().describe("Decimal degrees."),
    accuracyMeters: z.number().optional().describe("Reported accuracy radius, metres."),
  },
  annotations: WRITE,
  outputShape: {
    recorded: z.boolean(),
    deviceLocationId: z.number().optional(),
    matched: z.boolean(),
    homeEnded: z.boolean(),
    staged: z.boolean(),
    visitLogId: z.number().optional(),
    storeId: z.number().optional(),
    stageReason: z.string().optional(),
  },
  examples: [
    { title: "Report a coordinate", args: { latitude: 37.7699, longitude: -122.4144 } },
    { title: "With accuracy", args: { latitude: 37.7699, longitude: -122.4144, accuracyMeters: 25 } },
  ],
  handler: async ({ env }, input) => {
    const result = await ingestLocationFix(env, {
      source: "ai",
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters ?? null,
    });
    return {
      recorded: result.recorded,
      deviceLocationId: result.deviceLocationId,
      matched: result.matched,
      homeEnded: result.homeEnded,
      staged: result.staged,
      visitLogId: result.visitLogId,
      storeId: result.storeId,
      stageReason: result.stageReason,
    };
  },
});
