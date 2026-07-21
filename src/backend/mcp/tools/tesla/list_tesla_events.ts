/**
 * @fileoverview MCP tool — list_tesla_events (Tesla domain).
 */
import { teslaTelemetryEvents, teslaWebhookEvents } from "@backend/db/schema/tesla";
import { desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listTeslaEvents = defineTool({
  name: "list_tesla_events",
  category: "tesla",
  title: "Recent vehicle events",
  description:
    "Recent rows from the vehicle event log in TESLA_DB, newest first: `webhook` events (discrete " +
    "state changes — parked, drive state, charging, each with the drive-stop match result) or " +
    "`telemetry` frames (the ~500ms stream, when recording is enabled). Use it to answer 'where did " +
    "the car stop today', or to explain why a drive stop did or didn't auto-check-off.",
  inputShape: {
    kind: z
      .enum(["webhook", "telemetry"])
      .optional()
      .describe("Which log to read. Default 'webhook' — the discrete, meaningful events."),
    limit: z.number().int().positive().max(200).optional(),
  },
  annotations: READ_ONLY,
  outputShape: {
    kind: z.string(),
    count: z.number().int(),
    events: z.array(looseObject({ id: z.number().int() })),
  },
  examples: [
    { title: "Where did the car stop recently?", args: {} },
    { title: "Raw telemetry frames", args: { kind: "telemetry", limit: 20 } },
  ],
  handler: async ({ env }, input) => {
    const teslaDb = drizzle(env.TESLA_DB);
    const limit = input.limit ?? 25;

    if (input.kind === "telemetry") {
      const rows = await teslaDb
        .select({
          id: teslaTelemetryEvents.id,
          vin: teslaTelemetryEvents.vin,
          eventTs: teslaTelemetryEvents.eventTs,
          receivedAt: teslaTelemetryEvents.receivedAt,
          latitude: teslaTelemetryEvents.latitude,
          longitude: teslaTelemetryEvents.longitude,
          speed: teslaTelemetryEvents.speed,
          shiftState: teslaTelemetryEvents.shiftState,
          batteryLevel: teslaTelemetryEvents.batteryLevel,
          odometer: teslaTelemetryEvents.odometer,
        })
        .from(teslaTelemetryEvents)
        .orderBy(desc(teslaTelemetryEvents.receivedAt))
        .limit(limit)
        .all();
      return { kind: "telemetry", count: rows.length, events: rows };
    }

    const rows = await teslaDb
      .select({
        id: teslaWebhookEvents.id,
        vin: teslaWebhookEvents.vin,
        eventType: teslaWebhookEvents.eventType,
        latitude: teslaWebhookEvents.latitude,
        longitude: teslaWebhookEvents.longitude,
        matchResult: teslaWebhookEvents.matchResult,
        receivedAt: teslaWebhookEvents.receivedAt,
      })
      .from(teslaWebhookEvents)
      .orderBy(desc(teslaWebhookEvents.receivedAt))
      .limit(limit)
      .all();

    return {
      kind: "webhook",
      count: rows.length,
      // matchResult is stored as JSON text; hand it back parsed so the model
      // doesn't have to guess at a string that is really an object.
      events: rows.map((r) => ({
        ...r,
        matchResult: r.matchResult ? safeJson(r.matchResult) : null,
      })),
    };
  },
});

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
