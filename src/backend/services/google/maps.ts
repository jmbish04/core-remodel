import { and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { googleMapsUsage } from "@backend/db/schema";
import { getGoogleMapsApiKey } from "@/backend/utils/secrets";

export class GoogleMapsService {
  constructor(private readonly env: Env) {}

  async canUseGoogleMaps(): Promise<boolean> {
    const db = drizzle(this.env.DB);
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const currentMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ).getTime();

    // Google Maps Free Tier: $200/mo.
    // Places Text Search ($17/1000) + Routes ($5/1000) = $22 per 1000 dual-requests.
    // Total maximum dual-requests before exceeding $200 is ~9000. Capped at 8000 for safety.
    const MAX_CALLS_PER_MONTH = 8000;

    try {
      const usageQuery = await db
        .select({ total: sql<number>`count(${googleMapsUsage.id})` })
        .from(googleMapsUsage)
        .where(
          and(
            sql`${googleMapsUsage.timestamp} >= ${currentMonthStart}`,
            sql`${googleMapsUsage.timestamp} <= ${currentMonthEnd}`,
          ),
        )
        .get();

      return (usageQuery?.total ?? 0) <= MAX_CALLS_PER_MONTH;
    } catch (e) {
      console.error("Failed to check Google Maps usage:", e);
      // Fail-open strategy if D1 schema isn't migrated yet
      return true;
    }
  }

  async logUsage(apiType: string, request: any, response: any) {
    const db = drizzle(this.env.DB);
    try {
      await db.insert(googleMapsUsage).values({
        apiType,
        apiRequest: JSON.stringify(request),
        apiResponse: JSON.stringify(response),
        timestamp: new Date(),
      });
    } catch (e) {
      console.error(`Failed to log Google Maps usage for ${apiType}:`, e);
    }
  }

  async computeCommute(
    homeAddress: string,
    searchQuery: string,
    details?: Record<string, unknown>,
  ): Promise<{ commuteSummary: string; distanceMiles: number; durationMinutes: number }> {
    const hasQuota = await this.canUseGoogleMaps();
    const d = details ?? {};
    if (!hasQuota) {
      d.googleMapsStatus = "rate_limited";
      throw new Error("Google Maps is rate limited (monthly free tier exceeded).");
    }

    const gmapKey = await getGoogleMapsApiKey(this.env);

    // Step A: Places API (New) Text Search
    const placesReqBody = { textQuery: searchQuery };
    const placesRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": gmapKey,
        "X-Goog-FieldMask": "places.id,places.formattedAddress",
      },
      body: JSON.stringify(placesReqBody),
      signal: AbortSignal.timeout(5000),
    });

    const placesData = (await placesRes.json()) as any;
    await this.logUsage("places:searchText", placesReqBody, placesData);

    const placeId = placesData.places?.[0]?.id;
    const formattedAddress = placesData.places?.[0]?.formattedAddress;

    if (!placeId) {
      throw new Error(`Google Maps Places API: Could not find place for query "${searchQuery}"`);
    }

    // Step B: Routes API
    const routesReqBody = {
      origin: { address: homeAddress },
      destination: { placeId: placeId },
      travelMode: "DRIVE",
    };

    const routesRes = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": gmapKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify(routesReqBody),
      signal: AbortSignal.timeout(5000),
    });

    const routesData = (await routesRes.json()) as any;
    await this.logUsage("routes:computeRoutes", routesReqBody, routesData);

    const route = routesData.routes?.[0];

    if (!route) {
      throw new Error("Google Maps Routes API: No route found.");
    }

    const durationSecs = parseInt(route.duration.replace("s", ""));
    const durationMins = Math.round(durationSecs / 60);
    const distanceMiles = route.distanceMeters * 0.000621371;

    d.googleMapsResponse = {
      success: true,
      distanceMiles,
      durationMinutes: durationMins,
      formattedAddress,
      placeId,
    };
    d.googleMapsStatus = "ok";

    return {
      commuteSummary: `Google Maps API Driving Data (to ${formattedAddress}): ${distanceMiles.toFixed(1)} miles, ${durationMins} minutes each way.`,
      distanceMiles,
      durationMinutes: durationMins,
    };
  }
}
