/**
 * @fileoverview MCP tool — get_tesla_status (Tesla domain).
 */
import {
  getTeslaIntegrationStatus,
  runTeslaHealthCheck,
} from "@backend/services/tesla-integration";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const getTeslaStatus = defineTool({
  name: "get_tesla_status",
  category: "tesla",
  title: "Tesla integration status + health",
  description:
    "Whether the Tesla/Tessie integration is configured, whether Fleet Telemetry is being recorded " +
    "to D1, and a health screening of the events already collected (do historical rows still carry " +
    "coordinates, shift state and a VIN?). Credential VALUES are never returned — only whether each " +
    "is set. Call this before any other tesla_* tool so a failure reads as 'not configured' rather " +
    "than an unexplained empty result.",
  inputShape: {
    health: z
      .boolean()
      .optional()
      .describe("Include the health screening over historical events (default true)."),
  },
  annotations: READ_ONLY,
  outputShape: {
    configured: z.boolean(),
    telemetryRecording: z.boolean(),
    secrets: z.array(looseObject({ binding: z.string(), configured: z.boolean() })),
    health: looseObject({ overall: z.string() }).nullable(),
  },
  examples: [
    { title: "Is Tesla wired up?", args: {} },
    { title: "Status only, skip the history scan", args: { health: false } },
  ],
  handler: async ({ env }, input) => {
    const status = await getTeslaIntegrationStatus(env);
    // Never a live vehicle probe from a chat: waking the car to answer a status
    // question is a real-world side effect nobody asked for.
    const health =
      input.health === false ? null : await runTeslaHealthCheck(env, { liveProbe: false });
    return {
      configured: status.configured,
      telemetryRecording: status.telemetryRecording,
      secrets: status.secrets.map((s) => ({
        binding: s.binding,
        label: s.label,
        configured: s.configured,
      })),
      health,
    };
  },
});
