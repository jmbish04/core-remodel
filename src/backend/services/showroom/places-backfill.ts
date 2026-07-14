/**
 * @fileoverview One-shot showroom re-enrichment from Google Places.
 *
 * Migrations 0108/0109 dropped the legacy hours_json / website_url columns
 * BEFORE any backfill ran, so existing stores lost their website + hours (and
 * never had granular address parts). This re-sources all three from Google
 * Places for every store that has a `place_id`, and is driven by the per-minute
 * cron so it finishes on its own — a small batch per tick until nothing remains.
 *
 * Idempotent + self-terminating: candidates are stores with a place_id whose
 * `location_street_number` is still NULL. Each processed store gets its
 * street number set to the parsed value OR an empty-string sentinel (so a store
 * Google returns no street number for still drops out and is never re-fetched).
 * Once every place_id store is processed the candidate query is empty and the
 * job no-ops (one cheap SELECT per tick).
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull, isNotNull, count } from "drizzle-orm";
import {
  showroomStores,
  showroomStoreLinks,
  showroomStoreHours,
} from "@backend/db/schema/showroom/index";
import { GoogleMapsService } from "@backend/services/google/maps";
import {
  placeToStructuredHours,
  hoursJsonToRows,
  deriveHoursSummary,
} from "./onboarding";

/** Stores enriched per cron tick. Two Places calls each (address + details). */
const BATCH = 8;

export async function backfillShowroomPlacesData(
  env: Env,
): Promise<{ processed: number; remaining: number; skippedQuota?: boolean }> {
  const db = drizzle(env.DB);
  const maps = new GoogleMapsService(env);

  // Never blow the Maps free tier — the cron just tries again next minute.
  if (!(await maps.canUseGoogleMaps())) {
    return { processed: 0, remaining: -1, skippedQuota: true };
  }

  const candidates = await db
    .select({ id: showroomStores.id, placeId: showroomStores.placeId })
    .from(showroomStores)
    .where(
      and(
        isNotNull(showroomStores.placeId),
        isNull(showroomStores.locationStreetNumber),
      ),
    )
    .limit(BATCH);

  if (candidates.length === 0) return { processed: 0, remaining: 0 };

  let processed = 0;
  for (const store of candidates) {
    if (!store.placeId) continue;
    try {
      // Address parts (needs the addressComponents field mask).
      const addr = await maps.placeAddressComponents(store.placeId).catch(() => null);
      // Website + opening hours (a fuller Details call, no billable AI pass).
      const details = (await maps
        .placeDetails(store.placeId, undefined, { skipAi: true })
        .catch(() => null)) as
        | { websiteUri?: string; regularOpeningHours?: unknown }
        | null;

      // ── Store row: granular address + formatted address + maps link ──────
      // Always set location_street_number to a non-null value (parsed or "")
      // so this store drops out of the candidate set next tick.
      const patch: Partial<typeof showroomStores.$inferInsert> = {
        locationStreetNumber: addr?.streetNumber ?? "",
        updatedAt: new Date(),
      };
      if (addr?.streetName) patch.locationStreetName = addr.streetName;
      if (addr?.city) patch.locationCity = addr.city;
      if (addr?.state) patch.locationState = addr.state;
      if (addr?.zipCode) {
        patch.locationZipCode = addr.zipCode;
        patch.zipCode = addr.zipCode;
      }
      if (addr?.formattedAddress) patch.locationAddress = addr.formattedAddress;
      if (addr?.googleMapsUri) patch.googleMapsLink = addr.googleMapsUri;

      const hoursJson = placeToStructuredHours(details?.regularOpeningHours);
      if (hoursJson) patch.isOpenWeekends = deriveHoursSummary(hoursJson).isOpenWeekends;

      await db.update(showroomStores).set(patch).where(eq(showroomStores.id, store.id));

      // ── Website → showroom_store_links (WEBSITE), if not already present ──
      const websiteUri = details?.websiteUri?.trim();
      if (websiteUri) {
        const [existing] = await db
          .select({ id: showroomStoreLinks.id })
          .from(showroomStoreLinks)
          .where(
            and(
              eq(showroomStoreLinks.storeId, store.id),
              eq(showroomStoreLinks.type, "WEBSITE"),
            ),
          )
          .limit(1);
        if (!existing) {
          await db.insert(showroomStoreLinks).values({
            storeId: store.id,
            url: websiteUri,
            type: "WEBSITE",
          });
        }
      }

      // ── Hours → showroom_store_hours rows (replace-all for this store) ────
      if (hoursJson) {
        const rows = hoursJsonToRows(store.id, hoursJson);
        await db
          .delete(showroomStoreHours)
          .where(eq(showroomStoreHours.showroomId, store.id));
        if (rows.length > 0) {
          await db
            .insert(showroomStoreHours)
            .values(rows as [(typeof rows)[number], ...(typeof rows)[number][]]);
        }
      }

      processed++;
    } catch (err) {
      console.error(`[places-backfill] store ${store.id} failed:`, err);
      // Leave location_street_number NULL so it retries next tick. To avoid a
      // poison-pill loop, mark it processed with the sentinel after a failure
      // that isn't transient — but a transient Places blip should retry, so we
      // simply skip here and let the next tick try again.
    }
  }

  // Remaining = still-null after this batch (cheap count).
  const [{ remaining } = { remaining: 0 }] = await db
    .select({ remaining: count() })
    .from(showroomStores)
    .where(
      and(
        isNotNull(showroomStores.placeId),
        isNull(showroomStores.locationStreetNumber),
      ),
    );

  return { processed, remaining };
}
