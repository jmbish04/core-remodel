import { deviceLocation } from "@backend/db";
import { classifyBayAreaRegion } from "@backend/lib/bay-area-region";
import { getLocation as getTeslaLocation } from "@backend/services/tesla";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

/** Seconds since a captured timestamp (null-safe). */
function ageSeconds(when: Date | null | undefined): number | null {
  if (!when) return null;
  return Math.max(0, Math.round((Date.now() - when.getTime()) / 1000));
}

export const getUserLocation = defineTool({
  name: "get_user_location",
  category: "showrooms",
  title: "Get the user's current location",
  description:
    "Resolve WHERE THE USER IS RIGHT NOW so you can answer 'what showrooms are near me?', 'log the showroom I just " +
    "passed', or plan a route. Returns up to two sources: `phone` — the last-known position the web app reported " +
    "from the device's browser geolocation (may be a few minutes old; includes an `ageSeconds`) — and `tesla` — the " +
    "vehicle's LIVE GPS from Tessie (fetched fresh on each call, null when Tessie isn't configured or the car is " +
    "unreachable). `best` is the recommended fix to use: the Tesla GPS is preferred when available because it is " +
    "live and, when the user is out driving, the most accurate; otherwise the phone fix is used. Each fix carries " +
    "its coordinates and the derived California `region` (e.g. 'East Bay'). Returns `best: null` when no source is " +
    "available — say you don't know where they are rather than guessing.",
  inputShape: {},
  annotations: READ_ONLY,
  outputShape: {
    best: looseObject({
      source: z.string(),
      latitude: z.number(),
      longitude: z.number(),
    }).nullable(),
    recommendedSource: z.enum(["tesla", "phone"]).nullable(),
    phone: looseObject({ latitude: z.number(), longitude: z.number() }).nullable(),
    tesla: looseObject({ latitude: z.number(), longitude: z.number() }).nullable(),
    note: z.string(),
  },
  examples: [{ title: "Where am I?", args: {} }],
  handler: async ({ env, db }) => {
    // Live vehicle GPS (fetched fresh) + last-known device fix (from the web app).
    const [tesla, deviceRows] = await Promise.all([
      getTeslaLocation(env).catch(() => null),
      db.select().from(deviceLocation).orderBy(desc(deviceLocation.capturedAt)).limit(1),
    ]);
    const device = deviceRows[0] ?? null;

    const regionOf = (lat: number, lng: number): string | null =>
      classifyBayAreaRegion({ latitude: lat, longitude: lng })?.name ?? null;

    const phone = device
      ? {
          source: device.source,
          latitude: device.latitude,
          longitude: device.longitude,
          accuracyMeters: device.accuracyMeters ?? null,
          address: device.address ?? null,
          ageSeconds: ageSeconds(device.capturedAt),
          region: regionOf(device.latitude, device.longitude),
        }
      : null;

    const teslaFix = tesla
      ? {
          source: "tesla" as const,
          latitude: tesla.latitude,
          longitude: tesla.longitude,
          address: tesla.address ?? null,
          region: regionOf(tesla.latitude, tesla.longitude),
        }
      : null;

    // Prefer the live Tesla GPS when present (best while driving); otherwise the
    // last-known phone fix. `best` is null when neither source is available.
    const recommendedSource: "tesla" | "phone" | null = teslaFix ? "tesla" : phone ? "phone" : null;
    const best =
      recommendedSource === "tesla"
        ? {
            source: "tesla",
            latitude: teslaFix!.latitude,
            longitude: teslaFix!.longitude,
            region: teslaFix!.region,
          }
        : recommendedSource === "phone"
          ? {
              source: phone!.source,
              latitude: phone!.latitude,
              longitude: phone!.longitude,
              region: phone!.region,
            }
          : null;

    const note = best
      ? recommendedSource === "tesla"
        ? "Using the live Tesla GPS. If the user is at home rather than in the car, the phone fix may better reflect where they are."
        : `Using the last-known phone fix${phone?.ageSeconds != null ? ` (~${phone.ageSeconds}s old)` : ""}. No live Tesla GPS was available.`
      : "No location is available — ask the user to open the showroom directory and allow location, or share where they are.";

    return { best, recommendedSource, phone, tesla: teslaFix, note };
  },
});
