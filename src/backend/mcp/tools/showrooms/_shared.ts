/**
 * @fileoverview Shared helpers for the Showrooms MCP tool domain.
 */
import { showroomStoreHours, showroomStores } from "@backend/db";
import {
  computeStoreGeoPatch,
  hoursJsonToRows,
  scheduleShowroomEnrichment,
  type MappedPlaceStore,
} from "@backend/services/showroom/onboarding";
import type { RemodelDb } from "../../types";

import { toolError } from "../../format";

/**
 * Turn a `MAPS_QUOTA_EXCEEDED` service error into an actionable tool error, and
 * re-surface any other Places failure verbatim. Keeps the two Places-backed
 * tools DRY and ensures the agent never silently spends past the free tier.
 */
export function rethrowMapsError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("MAPS_QUOTA_EXCEEDED")) {
    toolError(
      "Google Maps monthly free-tier quota is exhausted — showroom search is paused to avoid spend. " +
        "Try again next month or raise the cap in the Maps usage dashboard.",
    );
  }
  toolError(`Google Places request failed: ${message}`);
}

/**
 * Persist a mapped Google Place as a showroom row and run the SAME enrichment
 * the intake form fires: Places-photo → CF Images, brand create/map, favicon +
 * website scrape, AI research, and category inference. Because MCP tool handlers
 * have no `executionCtx.waitUntil`, the enrichment promises are collected and
 * awaited here so the tool returns only once onboarding has actually run (work
 * left un-awaited would be cancelled when the request isolate finishes).
 */
export async function persistPlaceShowroom(
  env: Env,
  db: RemodelDb,
  mapped: MappedPlaceStore,
): Promise<typeof showroomStores.$inferSelect> {
  const geo = computeStoreGeoPatch({
    latitude: mapped.values.latitude,
    longitude: mapped.values.longitude,
    zipCode: mapped.values.zipCode,
    locationAddress: mapped.values.locationAddress,
  });

  const [created] = await db
    .insert(showroomStores)
    .values({ ...mapped.values, ...geo })
    .returning();

  if (mapped.hoursJson) {
    const rows = hoursJsonToRows(created.id, mapped.hoursJson);
    if (rows.length > 0) {
      await db
        .insert(showroomStoreHours)
        .values(rows as [(typeof rows)[number], ...(typeof rows)[number][]]);
    }
  }

  const tasks: Promise<unknown>[] = [];
  scheduleShowroomEnrichment(
    env,
    created,
    {
      websiteUrl: mapped.values.websiteUrl,
      photos: mapped.photos,
      brands: mapped.brands,
      categoryTokens: mapped.categoryTokens,
      categoryRationale: "Inferred from Google Places at MCP import",
    },
    (p) => tasks.push(p),
  );
  await Promise.allSettled(tasks);

  return created;
}
