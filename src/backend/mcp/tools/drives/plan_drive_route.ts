/**
 * @fileoverview MCP tool — plan_drive_route (Showroom Drive Lists domain).
 *
 * Traffic-aware, hours-constrained sequencing for a showroom day.
 *
 * Split of responsibility, deliberately: the CALLER (agent or human) supplies
 * judgment — which showrooms matter, how valuable each is, how long to spend.
 * This tool supplies arithmetic — real drive times from the Google Routes API
 * at the actual departure time, then a feasible order with ETAs that respects
 * opening hours. Language models are unreliable at exactly this arithmetic, and
 * a wrong ETA means arriving at a locked door.
 *
 * Does NOT persist anything. Call `create_drive_list` with the resulting order
 * once the plan is agreed.
 */
import { GoogleMapsService } from "@backend/services/google/maps";
import { planRoute, type PlannerStop } from "@backend/services/drive-route-planner";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

/** `"9:30"` / `"09:30"` / `"14:00"` → minutes from midnight. */
function parseClock(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function formatClock(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

const stopInput = looseObject({
  name: z.string().min(1).describe("Showroom / stop name"),
  showroomStoreId: z.number().int().optional().describe("Registered showroom id, when known"),
  address: z.string().optional().describe("Street address — used for routing if no lat/lng"),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  placeId: z.string().optional().describe("Google Places id — most accurate routing input"),
  dwellMinutes: z
    .number()
    .int()
    .min(5)
    .max(240)
    .describe("How long to spend here. Be realistic: a slab yard is 45–90, a fixture showroom 30–45."),
  priority: z
    .number()
    .min(0)
    .max(100)
    .describe("Sourcing value for THIS trip's goal (0–100). Drives ordering when timing allows a choice."),
  opensAt: z.string().optional().describe("Opening time on the trip day, 24h 'HH:MM'. Omit if unknown."),
  closesAt: z.string().optional().describe("Closing time on the trip day, 24h 'HH:MM'. Omit if unknown."),
});

export const planDriveRoute = defineTool({
  name: "plan_drive_route",
  category: "drives",
  title: "Plan a traffic-aware showroom route",
  description:
    "Sequence a set of showroom stops into a feasible day. Fetches real traffic-aware drive times " +
    "between every pair from the Google Routes API at the given departure time, then orders the " +
    "stops so that (a) nothing is scheduled outside its opening hours, (b) early-closing stops go " +
    "first, and (c) higher-priority stops win when timing allows a choice. Returns each stop with " +
    "ETA, wait time, recommended dwell, departure time, drive time to the next stop, and timing " +
    "warnings — plus any stops that could NOT be fitted, with the reason. Supply `priority` and " +
    "`dwellMinutes` yourself; this tool does not judge sourcing value, only feasibility and timing. " +
    "Persist nothing — call create_drive_list once the order is agreed.",
  inputShape: {
    stops: z
      .array(stopInput)
      .min(2)
      .max(24)
      .describe("Stops to sequence (order does not matter — that is what this computes)"),
    origin: looseObject({
      address: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      placeId: z.string().optional(),
    }).describe("Where the day starts (home, office, current position)"),
    departureDate: z
      .string()
      .describe("Trip date as 'YYYY-MM-DD' (California). Used to model traffic for the right day."),
    startsAt: z.string().describe("Earliest departure, 24h 'HH:MM' California time"),
    endsAt: z.string().describe("Hard stop — nothing may begin after this, 24h 'HH:MM'"),
  },
  annotations: READ_ONLY,
  outputShape: {
    stops: z.array(
      looseObject({
        order: z.number().int(),
        name: z.string(),
        showroomStoreId: z.number().int().nullable(),
        eta: z.string(),
        depart: z.string(),
        dwellMinutes: z.number().int(),
        waitMinutes: z.number().int(),
        driveMinutesToNext: z.number().nullable(),
        warnings: z.array(z.string()),
      }),
    ),
    dropped: z.array(looseObject({ name: z.string(), reason: z.string() })),
    totalDriveMinutes: z.number(),
    finishesAt: z.string(),
    trafficDataAvailable: z.boolean(),
  },
  examples: [
    {
      title: "Sequence a Saturday stone + tile run",
      args: {
        origin: { address: "126 Colby St, San Francisco, CA" },
        departureDate: "2026-07-25",
        startsAt: "09:00",
        endsAt: "16:00",
        stops: [
          { name: "Da Vinci Marble", address: "route 1", dwellMinutes: 75, priority: 90, opensAt: "09:00", closesAt: "16:00" },
          { name: "Cactus Stone & Tile", address: "route 2", dwellMinutes: 45, priority: 70, opensAt: "08:00", closesAt: "12:00" },
        ],
      },
    },
  ],
  handler: async (ctx, input) => {
    const startMinute = parseClock(input.startsAt);
    const endMinute = parseClock(input.endsAt);
    if (startMinute == null) toolError(`startsAt must be 24h 'HH:MM' (got "${input.startsAt}")`);
    if (endMinute == null) toolError(`endsAt must be 24h 'HH:MM' (got "${input.endsAt}")`);
    if (endMinute <= startMinute) toolError("endsAt must be after startsAt");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.departureDate)) {
      toolError(`departureDate must be 'YYYY-MM-DD' (got "${input.departureDate}")`);
    }

    const hasTarget = (w: { address?: string; latitude?: number; longitude?: number; placeId?: string }) =>
      Boolean(w.placeId || w.address || (w.latitude != null && w.longitude != null));

    if (!hasTarget(input.origin)) toolError("origin needs a placeId, address, or lat/lng");
    const unroutable = input.stops.filter((s) => !hasTarget(s));
    if (unroutable.length > 0) {
      toolError(
        `these stops need a placeId, address, or lat/lng: ${unroutable.map((s) => s.name).join(", ")}`,
      );
    }

    // Model traffic for the actual trip start. California is UTC-8/-7; building
    // the instant from the local date + time keeps the traffic model honest.
    const departureTime = new Date(
      `${input.departureDate}T${String(Math.floor(startMinute / 60)).padStart(2, "0")}:${String(
        startMinute % 60,
      ).padStart(2, "0")}:00-08:00`,
    );

    const waypoints = [input.origin, ...input.stops].map((w) => ({
      placeId: w.placeId,
      latitude: w.latitude,
      longitude: w.longitude,
      address: w.address,
    }));

    // Traffic data is an enhancement, not a hard dependency. If Maps quota is
    // spent the run still produces a usable ordering from the fallback matrix,
    // flagged so the caller can say so rather than implying real ETAs.
    let travelMinutes: (number | null)[][];
    let trafficDataAvailable = true;
    try {
      const maps = new GoogleMapsService(ctx.env);
      const matrix = await maps.computeRouteMatrix(waypoints, departureTime);
      travelMinutes = matrix.minutes;
    } catch (error) {
      trafficDataAvailable = false;
      const n = waypoints.length;
      travelMinutes = Array.from({ length: n }, () => Array(n).fill(null));
      console.warn(
        `[plan_drive_route] route matrix unavailable, using fallback estimates: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const plannerStops: PlannerStop[] = input.stops.map((s, i) => {
      const open = parseClock(s.opensAt);
      const close = parseClock(s.closesAt);
      return {
        id: String(i),
        name: s.name,
        dwellMinutes: s.dwellMinutes,
        priority: s.priority,
        openMinute: open,
        closeMinute: close,
        hoursUnknown: open == null && close == null,
      };
    });

    const plan = planRoute({ stops: plannerStops, travelMinutes, startMinute, endMinute });

    const byId = new Map(plannerStops.map((s, i) => [s.id, input.stops[i]]));

    return {
      stops: plan.stops.map((s) => {
        const source = byId.get(s.id);
        return {
          order: s.order,
          name: s.name,
          showroomStoreId: source?.showroomStoreId ?? null,
          eta: formatClock(s.arriveMinute),
          depart: formatClock(s.departMinute),
          dwellMinutes: s.dwellMinutes,
          waitMinutes: s.waitMinutes,
          driveMinutesToNext: s.driveMinutesToNext,
          warnings: trafficDataAvailable
            ? s.warnings
            : [...s.warnings, "drive times are estimates — live traffic data was unavailable"],
        };
      }),
      dropped: plan.dropped.map((d) => ({ name: d.name, reason: d.reason })),
      totalDriveMinutes: plan.totalDriveMinutes,
      finishesAt: formatClock(plan.endMinute),
      trafficDataAvailable,
    };
  },
});
