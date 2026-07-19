/**
 * @fileoverview Shared helpers for the Showrooms MCP tool domain.
 */
import { showroomStoreHours, showroomStoreLinks, showroomStores } from "@backend/db";
import {
  resolveStoreGeoPatch,
  hoursJsonToRows,
  type MappedPlaceStore,
} from "@backend/services/showroom/onboarding";
import { collectSocialLinks } from "@backend/services/showroom/social-links";

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
 * Persist a mapped Google Place as a showroom row and KICK the same enrichment
 * the intake form fires (Places-photo → CF Images, brand create/map, favicon +
 * website scrape, AI research, category inference) as a durable background
 * workflow — then return immediately.
 *
 * Enrichment used to be awaited inline here, but it takes ~25s+ and routinely
 * outran the MCP client/transport timeout (the tool errored while the work
 * completed server-side, forcing a retry that hit placeId idempotency). Now the
 * row is inserted with `scrapeStatus: "pending"` and ShowroomOnboardingWorkflow
 * runs the enrichment durably; callers poll `check_showroom_intake_status`. The
 * returned row is the freshly-inserted one (before enrichment), so hero image /
 * brands / research populate afterward.
 */
export async function persistPlaceShowroom(
  env: Env,
  db: RemodelDb,
  mapped: MappedPlaceStore,
): Promise<typeof showroomStores.$inferSelect> {
  const geo = await resolveStoreGeoPatch(db, {
    latitude: mapped.values.latitude,
    longitude: mapped.values.longitude,
    zipCode: mapped.values.zipCode,
    locationAddress: mapped.values.locationAddress,
    locationCity: mapped.values.locationCity,
  });

  const [created] = await db
    .insert(showroomStores)
    .values({ ...mapped.values, ...geo, scrapeStatus: "pending" })
    .returning();

  if (mapped.hoursJson) {
    const rows = hoursJsonToRows(created.id, mapped.hoursJson);
    if (rows.length > 0) {
      await db
        .insert(showroomStoreHours)
        .values(rows as [(typeof rows)[number], ...(typeof rows)[number][]]);
    }
  }

  // Website + socials → showroom_store_links. URLs live in the links table now,
  // not on the store row. Socials come from the search-grounded Gemini analysis;
  // they are re-classified by hostname (which also rejects share widgets) rather
  // than trusting Gemini's own `type`. The website scrape adds any it finds later.
  const linkRows: Array<typeof showroomStoreLinks.$inferInsert> = [];
  if (mapped.websiteUrl) {
    linkRows.push({ storeId: created.id, url: mapped.websiteUrl, type: "WEBSITE" });
  }
  for (const social of collectSocialLinks(mapped.socialUrls)) {
    linkRows.push({
      storeId: created.id,
      url: social.url,
      type: social.type,
      urlNotes: social.urlNotes,
    });
  }
  if (linkRows.length > 0) {
    await db
      .insert(showroomStoreLinks)
      .values(linkRows as [(typeof linkRows)[number], ...(typeof linkRows)[number][]]);
  }

  await env.SHOWROOM_ONBOARDING_WORKFLOW.create({
    params: {
      showroomId: created.id,
      enrichment: {
        websiteUrl: mapped.websiteUrl,
        photos: mapped.photos,
        brands: mapped.brands,
        categoryTokens: mapped.categoryTokens,
        categoryRationale: "Inferred from Google Places at MCP import",
      },
    },
  });

  return created;
}
