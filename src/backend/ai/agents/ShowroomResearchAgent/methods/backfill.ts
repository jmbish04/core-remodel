/**
 * @fileoverview Bulk-backfill enrichment helpers for the ShowroomResearchAgent.
 *
 * These functions implement the "remaining intake steps" that the bulk Manage
 * flow runs for an existing showroom, mirroring the background `waitUntil` work
 * that `POST /api/showroom-stores` fires on create — but adapted for backfill:
 *
 *   1. {@link fillBlanksFromPlacesAI} — run the Gemini review analysis for the
 *      showroom's Google place and fill the AI-derived columns that are still
 *      blank (reviewAiInsight, price point, boolean attribute flags, review
 *      summary, Google rating), plus the brand create/map pipeline.
 *   2. {@link runBackfillPhotoPipeline} — fetch the Places photo media, upload to
 *      Cloudflare Images, write `showroom_photos_mapping` rows, and set the hero.
 *   3. {@link triggerBackfillScrape} — mint a RAG UUID and kick the
 *      `ShowroomScrapeWorkflow` for the website.
 *
 * ALL writes are **fill-blanks only**: a column that already holds a value is
 * never overwritten. Boolean attribute flags are only ever flipped `false → true`
 * (a positive AI signal), never `true → false`. Every step is independently
 * guarded so one failure never aborts the others — transient failures ride the
 * Agent queue's retry.
 *
 * The agent method `backfillEnrichShowroom` (in `../index.ts`) is the queue
 * callback that orchestrates these helpers together with `researchStore` and the
 * favicon service.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq, sql } from "drizzle-orm";

import {
  showroomStores,
  showroomPhotosMapping,
  showroomStoreCategoryMapping,
  storeResearch,
} from "@backend/db/schema/showroom/index";
import { brands, showroomBrandMappings } from "@backend/db/schema/brands/index";
import { GoogleMapsService } from "@backend/services/google/maps";
import { inferAndMapCategories } from "@backend/utils/showroom-categories";
import { ImageProcessorService } from "@backend/services/image-processor";
import {
  resolveCloudflareImagesCredentials,
  getGoogleMapsApiKey,
} from "@backend/utils/secrets";

/** A Google Places photo reference as returned by the Places Details `photos[]`. */
export interface BackfillPhotoRef {
  name: string;
  widthPx?: number | null;
  heightPx?: number | null;
  authorAttributions?: Array<{
    displayName?: string;
    uri?: string;
    photoUri?: string;
  }> | null;
  flagContentUri?: string | null;
  googleMapsUri?: string | null;
}

/** Payload for a single queued backfill task. */
export interface BackfillEnrichPayload {
  showroomId: number;
  /** Google place_id chosen/confirmed in the Manage modal, if any. */
  placeId?: string | null;
  /** Places photo references captured at submit time (avoids a re-fetch). */
  photos?: BackfillPhotoRef[];
}

/**
 * Shape of the Gemini review-insight object persisted to
 * `showroom_stores.review_ai_insight`. Mirrors the Places-details proxy output.
 */
type ReviewAiInsight = NonNullable<
  typeof showroomStores.$inferSelect["reviewAiInsight"]
>;

/**
 * Run the Gemini review analysis for `placeId` and fill any AI-derived columns
 * on the showroom that are still blank. Fill-blanks only.
 *
 * @returns `true` when at least one column was written, else `false`.
 */
export async function fillBlanksFromPlacesAI(
  env: Env,
  showroomId: number,
  placeId: string,
): Promise<boolean> {
  const db = drizzle(env.DB);
  const [store] = await db
    .select()
    .from(showroomStores)
    .where(eq(showroomStores.id, showroomId))
    .limit(1);
  if (!store) return false;

  // Skip the (billed) Gemini call entirely when nothing it produces is blank.
  const needsInsight = store.reviewAiInsight == null;
  const needsRating = store.googleRating == null;
  const needsSummary = !store.reviewSummary;
  const needsPrice = !store.pricePoint;
  const needsAi = needsInsight || needsRating || needsSummary || needsPrice;

  // Category inference is fill-blanks too: only when no mapping rows exist yet.
  const [existingCategory] = await db
    .select({ id: showroomStoreCategoryMapping.id })
    .from(showroomStoreCategoryMapping)
    .where(eq(showroomStoreCategoryMapping.storeId, showroomId))
    .limit(1);
  const needsCategories = !existingCategory;

  if (!needsAi && !needsCategories) {
    return false;
  }

  // placeDetails runs computeReviewInsight (Gemini) unless skipAi — when only
  // categories are missing we still need the (cheap) place types, not Gemini.
  const service = new GoogleMapsService(env);
  const details = (await service.placeDetails(
    placeId,
    undefined,
    needsAi ? undefined : { skipAi: true },
  )) as Record<string, unknown>;

  const aiInference = (details.aiInference ?? null) as ReviewAiInsight | null;
  const update: Partial<typeof showroomStores.$inferInsert> = {};

  if (needsInsight && aiInference) {
    update.reviewAiInsight = aiInference;
  }
  if (needsRating && typeof details.rating === "number") {
    update.googleRating = details.rating as number;
  }
  if (store.userRatingCount == null && typeof details.userRatingCount === "number") {
    update.userRatingCount = details.userRatingCount as number;
  }
  if (needsSummary) {
    const summaryText =
      (details.reviewSummary as { text?: { text?: string } } | undefined)?.text?.text ??
      aiInference?.summary ??
      null;
    if (summaryText) update.reviewSummary = summaryText;
  }
  if (needsPrice) {
    const inferred = aiInference?.inferredPricePoint;
    if (inferred && inferred !== ("PRICE_LEVEL_UNSPECIFIED" as unknown as typeof inferred)) {
      update.pricePoint = inferred;
    }
  }

  // Boolean attribute flags: only ever flip false → true (a positive AI signal).
  const attrs = aiInference?.attributes;
  if (attrs) {
    if (!store.isAppointmentOnly && attrs.appointmentOnly?.value) update.isAppointmentOnly = true;
    if (!store.isFlagshipLocation && attrs.flagshipLocation?.value) update.isFlagshipLocation = true;
    if (!store.isLargeSelection && attrs.largeSelection?.value) update.isLargeSelection = true;
    if (!store.isBespoke && attrs.bespokeCurated?.value) update.isBespoke = true;
    if (!store.isTradeRepRequired && attrs.tradeRepRequired?.value) update.isTradeRepRequired = true;
  }

  let wrote = false;
  if (Object.keys(update).length > 0) {
    update.updatedAt = new Date();
    await db.update(showroomStores).set(update).where(eq(showroomStores.id, showroomId));
    wrote = true;
  }

  // Brand create / map pipeline (mirrors the create handler). Best-effort.
  if (aiInference?.brands?.length) {
    await mapInsightBrands(env, showroomId, aiInference.brands);
  }

  // Category inference — Places types + primaryType + AI-insight brand type
  // strings ("Hardwood Flooring", "Tile", …) mapped onto the internal category
  // vocabulary. Fill-blanks guarded again inside the helper.
  if (needsCategories) {
    const placeTypes = Array.isArray(details.types)
      ? (details.types as unknown[]).filter((t): t is string => typeof t === "string")
      : [];
    const primaryType = typeof details.primaryType === "string" ? details.primaryType : null;
    const insight = aiInference ?? store.reviewAiInsight ?? null;
    const brandTypes = (insight?.brands ?? [])
      .map((b) => (typeof b?.type === "string" ? b.type : null))
      .filter((t): t is string => Boolean(t));
    const mappedCount = await inferAndMapCategories(
      env,
      showroomId,
      [...placeTypes, primaryType, ...brandTypes],
      `Inferred from Google Places types [${[...placeTypes, primaryType].filter(Boolean).join(", ")}]` +
        (brandTypes.length ? ` and stocked-brand types [${brandTypes.join(", ")}]` : ""),
    );
    if (mappedCount > 0) wrote = true;
  }

  return wrote;
}

/**
 * Create-or-find each brand from the AI insight and map it to the showroom.
 * Dedupes by lowercased name, caps at 15, and never throws.
 */
async function mapInsightBrands(
  env: Env,
  showroomId: number,
  insightBrands: ReviewAiInsight["brands"],
): Promise<void> {
  try {
    const db = drizzle(env.DB);
    const seen = new Set<string>();
    const unique: Array<{ name: string; type: string; websiteUrl: string }> = [];
    for (const b of insightBrands) {
      if (!b || typeof b.name !== "string") continue;
      const key = b.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push({
        name: b.name.trim(),
        type: typeof b.type === "string" ? b.type.trim() : "",
        websiteUrl: typeof b.websiteUrl === "string" ? b.websiteUrl.trim() : "",
      });
      if (unique.length >= 15) break;
    }

    for (const { name, websiteUrl } of unique) {
      try {
        let brandId: number;
        const [existing] = await db
          .select({ id: brands.id })
          .from(brands)
          .where(sql`lower(${brands.name}) = lower(${name})`)
          .limit(1);
        if (existing) {
          brandId = existing.id;
        } else {
          const [created] = await db
            .insert(brands)
            .values({ name, websiteUrl: websiteUrl || null } as typeof brands.$inferInsert)
            .returning({ id: brands.id });
          brandId = created.id;

          // Newly-discovered brand — kick the deep-research workflow. Its
          // mark-running step upserts brand_intel, and every write it makes
          // is fill-blanks, so duplicate triggers are harmless. Best-effort.
          try {
            await env.BRAND_RESEARCH_WORKFLOW.create({ params: { brandId } });
          } catch (wfErr) {
            console.error(
              `[backfill] brand research workflow create failed for "${name}" (brand ${brandId}):`,
              wfErr,
            );
          }
        }
        await db
          .insert(showroomBrandMappings)
          .values({ showroomId, brandId } as typeof showroomBrandMappings.$inferInsert)
          .onConflictDoNothing();
      } catch (brandErr) {
        console.error(`[backfill] brand map failed for "${name}" (store ${showroomId}):`, brandErr);
      }
    }
  } catch (err) {
    console.error(`[backfill] brand pipeline outer error for store ${showroomId}:`, err);
  }
}

/**
 * Fetch each Places photo, upload to Cloudflare Images, write a
 * `showroom_photos_mapping` row, and set the hero image from photo[0].
 *
 * No-ops (fill-blanks) when the store already has mapping rows or a hero image.
 * Adapted from the `POST /api/showroom-stores` create-handler photo pipeline.
 */
export async function runBackfillPhotoPipeline(
  env: Env,
  showroomId: number,
  photos: BackfillPhotoRef[],
): Promise<void> {
  if (!photos?.length) return;
  try {
    const db = drizzle(env.DB);

    // Fill-blanks guard: skip when photos already exist for this store.
    const [existing] = await db
      .select({ id: showroomPhotosMapping.id })
      .from(showroomPhotosMapping)
      .where(eq(showroomPhotosMapping.showroomId, showroomId))
      .limit(1);
    const [store] = await db
      .select({ hero: showroomStores.heroImageCfImagesUrl })
      .from(showroomStores)
      .where(eq(showroomStores.id, showroomId))
      .limit(1);
    // Bail if the store row is gone (avoids a FK violation / orphaned photo rows)
    // or if photos already exist (fill-blanks).
    if (!store || existing) return;

    const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(env);
    if (!accountId || apiTokens.length === 0) {
      console.error(`[backfill] photos: CF Images credentials missing for store ${showroomId}`);
      return;
    }
    const [primaryToken, ...fallbackApiTokens] = apiTokens;
    const processor = new ImageProcessorService(env, accountId, primaryToken, { fallbackApiTokens });

    const mapsKey = await getGoogleMapsApiKey(env).catch(() => null);
    if (!mapsKey) {
      console.error(`[backfill] photos: Google Maps API key missing for store ${showroomId}`);
      return;
    }

    const capped = photos.slice(0, 5);
    for (let i = 0; i < capped.length; i++) {
      const photo = capped[i];
      try {
        const mediaUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1600&key=${mapsKey}`;
        const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
          console.warn(`[backfill] photos: non-ok ${res.status} for photo ${i} of store ${showroomId}`);
          continue;
        }
        const blob = await res.blob();
        const customId = `showroom-photo-${showroomId}-${i}`;
        const filename = `showroom-${showroomId}-${i}.jpg`;

        // Per-photo dedup: skip if this exact Places photo was already uploaded
        // (catches partial-run edge cases the outer guard doesn't).
        if (photo.name) {
          const [dup] = await db
            .select({ id: showroomPhotosMapping.id })
            .from(showroomPhotosMapping)
            .where(
              and(
                eq(showroomPhotosMapping.showroomId, showroomId),
                eq(showroomPhotosMapping.photoName, photo.name),
              ),
            )
            .limit(1);
          if (dup) {
            console.log(`[backfill] photos: skipping duplicate photo ${i} (${photo.name}) for store ${showroomId}`);
            continue;
          }
        }

        const uploadResp = await processor.uploadToCloudflareImages(blob, customId, filename);
        const url = processor.getDeliveryUrl(uploadResp, customId);

        await db.insert(showroomPhotosMapping).values({
          showroomId,
          cfImagesPhotoUrl: url,
          photoName: photo.name,
          photoWidthPx: photo.widthPx ?? null,
          photoHeightPx: photo.heightPx ?? null,
          authorAttributes: photo.authorAttributions ?? null,
          flagContentUri: photo.flagContentUri ?? null,
          googleMapsUri: photo.googleMapsUri ?? null,
          sortOrder: i,
        } as typeof showroomPhotosMapping.$inferInsert);

        // Hero from the first photo — fill-blanks only.
        if (i === 0 && !store?.hero) {
          await db
            .update(showroomStores)
            .set({ heroImageCfImagesUrl: url, updatedAt: new Date() })
            .where(eq(showroomStores.id, showroomId));
        }
      } catch (photoErr) {
        console.error(`[backfill] photos: error on photo ${i} for store ${showroomId}:`, photoErr);
      }
    }
  } catch (err) {
    console.error(`[backfill] photos pipeline outer error for store ${showroomId}:`, err);
  }
}

/**
 * Kick the `ShowroomScrapeWorkflow` for the store's website — fill-blanks: only
 * when the store has not been scraped yet (`scrapeStatus === "idle"`). Mints a
 * RAG UUID and marks the store `pending` before creating the workflow instance.
 */
export async function triggerBackfillScrape(
  env: Env,
  showroomId: number,
  websiteUrl: string,
): Promise<void> {
  if (!websiteUrl) return;
  try {
    const db = drizzle(env.DB);
    const [store] = await db
      .select({ scrapeStatus: showroomStores.scrapeStatus, ragUuid: showroomStores.ragUuid })
      .from(showroomStores)
      .where(eq(showroomStores.id, showroomId))
      .limit(1);
    if (!store || store.scrapeStatus !== "idle") return; // already pending/running/complete

    const ragUuid = store.ragUuid ?? crypto.randomUUID();
    await db
      .update(showroomStores)
      .set({ ragUuid, scrapeStatus: "pending", updatedAt: new Date() })
      .where(eq(showroomStores.id, showroomId));
    await env.SHOWROOM_SCRAPE_WORKFLOW.create({
      params: { showroomId, websiteUrl, ragUuid },
    });
  } catch (err) {
    console.error(`[backfill] scrape trigger failed for store ${showroomId}:`, err);
  }
}

/**
 * True when the store has at least one `store_research` finding — used to skip
 * the (expensive) deep-sweep research when the store has already been researched.
 */
export async function hasExistingFindings(env: Env, showroomId: number): Promise<boolean> {
  const db = drizzle(env.DB);
  const [row] = await db
    .select({ id: storeResearch.id })
    .from(storeResearch)
    .where(eq(storeResearch.storeId, showroomId))
    .limit(1);
  return Boolean(row);
}
