/**
 * @fileoverview Shared showroom onboarding service.
 *
 * The single source of truth for the "onboard a showroom" pipeline so the two
 * entry points stay consistent:
 *   1. `POST /api/showroom-stores` (the front-end intake form), and
 *   2. the MCP tools (`import_showroom_from_place`, `create_showroom`).
 *
 * It owns the parts that must NOT drift between those callers:
 *   - `computeStoreGeoPatch` — capture lat/lng + the region hub (A–E) on the row
 *     from the address / coordinates so the directory filter + map are accurate
 *     without ever calling Places on page load.
 *   - `mapPlaceDetailsToStoreInput` — translate a raw Google Places Details
 *     payload (with the Gemini `aiInference` block) into store columns, hours,
 *     photos, category tokens, and the persisted `reviewAiInsight`.
 *   - `scheduleShowroomEnrichment` — kick the same background work the form
 *     triggers: AI research, favicon + website scrape, the Places-photo → CF
 *     Images pipeline, brand create/map, and category inference.
 *
 * The `schedule` callback abstracts over execution context: the HTTP route
 * passes `executionCtx.waitUntil`; the MCP tools (which have no waitUntil) pass
 * a collector they then `await` so the tool call returns only once the work is
 * done.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { getAgentByName } from "agents";

import {
  showroomStores,
  showroomStoreHours,
  showroomPhotosMapping,
  type ShowroomStore,
  type ShowroomStoreInsert,
} from "@backend/db/schema/showroom/index";
import {
  brands,
  brandTypesDef,
  brandTypeMappings,
  showroomBrandMappings,
} from "@backend/db/schema/brands/index";
import { ImageProcessorService } from "@backend/services/image-processor";
import { faviconService } from "@backend/services/favicon";
import {
  resolveCloudflareImagesCredentials,
  getGoogleMapsApiKey,
} from "@backend/utils/secrets";
import { inferAndMapCategories } from "@backend/utils/showroom-categories";
import { getStoreWebsiteUrl } from "@backend/utils/showroom-links";
import { classifyBayAreaRegion } from "@backend/lib/bay-area-region";
// Type-only import (erased at build — no frontend runtime code enters the worker
// bundle). The pure `mapPlaceToHoursJson` logic is inlined below to keep the
// backend free of any runtime dependency on frontend modules.
import type { GooglePlaceDetails } from "@frontend/components/showroom/intake/places-mapper";

/**
 * A single Google Places photo reference — the minimal shape the CF Images
 * pipeline needs. Structurally compatible with both the intake form's zod
 * `photos` and the Places Details payload, so callers pass either without casts.
 */
export interface PlacePhotoRef {
  name: string;
  widthPx?: number | null;
  heightPx?: number | null;
  authorAttributions?: Array<{
    displayName?: string | null;
    uri?: string | null;
    photoUri?: string | null;
  }> | null;
  flagContentUri?: string | null;
  googleMapsUri?: string | null;
}

// ─── Structured hours helpers (shared with the HTTP route) ─────────────────────

/** One open/close window (24-hour "HH:MM") or `null` when closed that day. */
export type DaySlot = { open: string; close: string } | null;

/** Structured weekly hours — all 7 keys present; `null` = closed that day. */
export interface StructuredHours {
  mon: DaySlot;
  tue: DaySlot;
  wed: DaySlot;
  thu: DaySlot;
  fri: DaySlot;
  sat: DaySlot;
  sun: DaySlot;
}

const DAY_LABELS: Record<keyof StructuredHours, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const DAY_KEY_TO_ENUM = {
  mon: "MONDAY",
  tue: "TUESDAY",
  wed: "WEDNESDAY",
  thu: "THURSDAY",
  fri: "FRIDAY",
  sat: "SATURDAY",
  sun: "SUNDAY",
} as const;

function to12h(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

function collapseHoursGroups(
  days: Array<keyof StructuredHours>,
  hours: StructuredHours,
): string[] {
  const openDays = days.filter((d) => hours[d] !== null);
  if (openDays.length === 0) return [];
  const groups: Array<{ open: string; close: string; startDay: string; endDay: string }> = [];
  for (const day of openDays) {
    const slot = hours[day]!;
    const last = groups[groups.length - 1];
    if (last && last.open === slot.open && last.close === slot.close) {
      last.endDay = DAY_LABELS[day];
    } else {
      groups.push({ open: slot.open, close: slot.close, startDay: DAY_LABELS[day], endDay: DAY_LABELS[day] });
    }
  }
  return groups.map((g) => {
    const dayRange = g.startDay === g.endDay ? g.startDay : `${g.startDay}–${g.endDay}`;
    return `${dayRange} ${to12h(g.open)}–${to12h(g.close)}`;
  });
}

/** Derive the back-compat weekday/weekend summary strings from structured hours. */
export function deriveHoursSummary(hours: StructuredHours): {
  weekdayHours: string;
  weekendHours: string;
  isOpenWeekends: boolean;
} {
  const weekdayGroups = collapseHoursGroups(["mon", "tue", "wed", "thu", "fri"], hours);
  const weekendGroups = collapseHoursGroups(["sat", "sun"], hours);
  return {
    weekdayHours: weekdayGroups.length > 0 ? weekdayGroups.join(", ") : "Closed",
    weekendHours: weekendGroups.length > 0 ? weekendGroups.join(", ") : "Closed",
    isOpenWeekends: Boolean(hours.sat || hours.sun),
  };
}

function parseHhmm(hhmm: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return { hour: 0, minute: 0 };
  return {
    hour: Math.min(Math.max(parseInt(m[1], 10) || 0, 0), 23),
    minute: Math.min(Math.max(parseInt(m[2], 10) || 0, 0), 59),
  };
}

/** Convert structured hours to `showroom_store_hours` insert rows — one per OPEN day. */
export function hoursJsonToRows(
  showroomId: number,
  hours: StructuredHours,
): Array<typeof showroomStoreHours.$inferInsert> {
  const rows: Array<typeof showroomStoreHours.$inferInsert> = [];
  for (const [key, day] of Object.entries(DAY_KEY_TO_ENUM)) {
    const slot = hours[key as keyof StructuredHours];
    if (!slot) continue;
    const open = parseHhmm(slot.open);
    const close = parseHhmm(slot.close);
    rows.push({
      showroomId,
      day,
      openHour: open.hour,
      openMinute: open.minute,
      closeHour: close.hour,
      closeMinute: close.minute,
    });
  }
  return rows;
}

// ─── Google opening-hours → structured hours (inlined pure helper) ─────────────

const GOOGLE_DAY_TO_KEY: Record<number, keyof StructuredHours> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

const STRUCTURED_DAY_ORDER: Array<keyof StructuredHours> = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

function formatGoogleTime(point: { hour?: number | null; minute?: number | null }): string {
  const h = Math.min(Math.max(Math.trunc(point.hour ?? 0), 0), 23);
  const m = Math.min(Math.max(Math.trunc(point.minute ?? 0), 0), 59);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Map Google `regularOpeningHours.periods` to structured weekly hours. Keyed by
 * each period's OPEN day; split periods collapse to earliest-open→latest-close.
 * Returns null when there are no usable periods (caller leaves hours unset).
 * Mirrors the intake form's `mapPlaceToHoursJson`.
 */
export function placeToStructuredHours(regularOpeningHours: unknown): StructuredHours | null {
  const roh = regularOpeningHours as { periods?: unknown } | null | undefined;
  const periods = roh?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return null;

  const toMin = (hhmm: string): number => {
    const [h, m] = hhmm.split(":");
    return parseInt(h, 10) * 60 + parseInt(m, 10);
  };

  const spans = {} as Record<
    keyof StructuredHours,
    { openMin: number; open: string; closeMin: number; close: string } | undefined
  >;

  for (const raw of periods as Array<{
    open?: { day?: number | null; hour?: number | null; minute?: number | null } | null;
    close?: { hour?: number | null; minute?: number | null } | null;
  }>) {
    const openPoint = raw?.open;
    if (!openPoint || typeof openPoint.day !== "number") continue;
    const key = GOOGLE_DAY_TO_KEY[openPoint.day];
    if (!key) continue;

    const open = formatGoogleTime(openPoint);
    const close = raw?.close ? formatGoogleTime(raw.close) : "23:59";
    const openMin = toMin(open);
    const closeMin = toMin(close);

    const existing = spans[key];
    if (!existing) {
      spans[key] = { openMin, open, closeMin, close };
    } else {
      if (openMin < existing.openMin) {
        existing.openMin = openMin;
        existing.open = open;
      }
      if (closeMin > existing.closeMin) {
        existing.closeMin = closeMin;
        existing.close = close;
      }
    }
  }

  const out = {} as StructuredHours;
  let any = false;
  for (const key of STRUCTURED_DAY_ORDER) {
    const span = spans[key];
    if (span) {
      out[key] = { open: span.open, close: span.close };
      any = true;
    } else {
      out[key] = null;
    }
  }
  return any ? out : null;
}

// ─── Region capture ────────────────────────────────────────────────────────────

/**
 * Compute the geo columns to persist on a showroom row: pass through lat/lng
 * when known and derive the region hub (A–E) from coordinates / address / ZIP.
 * Everything is best-effort — an out-of-area or unclassifiable location simply
 * leaves the hub columns unset (the read-time fallback still tries again).
 */
export function computeStoreGeoPatch(fields: {
  latitude?: number | null;
  longitude?: number | null;
  zipCode?: string | null;
  locationAddress?: string | null;
}): Pick<ShowroomStoreInsert, "latitude" | "longitude" | "hubRoute" | "hubName"> {
  const latitude = fields.latitude ?? null;
  const longitude = fields.longitude ?? null;
  const region = classifyBayAreaRegion({
    latitude,
    longitude,
    zipCode: fields.zipCode,
    address: fields.locationAddress,
  });
  return {
    latitude,
    longitude,
    hubRoute: region?.route ?? null,
    hubName: region?.name ?? null,
  };
}

// ─── Places Details → store input ──────────────────────────────────────────────

const PRICE_LEVEL_MAP: Record<string, "$" | "$$" | "$$$" | "$$$$"> = {
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

const REAL_PRICE_TIERS = new Set(["$", "$$", "$$$", "$$$$"]);

/** Parse a trailing US ZIP out of a formatted address (state-anchored). */
function parseZip(formattedAddress?: string | null): string | undefined {
  if (!formattedAddress) return undefined;
  const match = /\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b/i.exec(formattedAddress);
  return match ? match[1] : undefined;
}

function extractSummary(place: GooglePlaceDetails): string | undefined {
  const gen = place.generativeSummary as
    | { text?: { text?: string } | string; overview?: { text?: string } }
    | null
    | undefined;
  if (gen) {
    const t = gen.text;
    if (typeof t === "string" && t.trim()) return t.trim();
    if (t && typeof t === "object" && t.text?.trim()) return t.text.trim();
    if (gen.overview?.text?.trim()) return gen.overview.text.trim();
  }
  const editorial = place.editorialSummary?.text;
  return editorial && editorial.trim() ? editorial.trim() : undefined;
}

function extractReviewSummary(place: GooglePlaceDetails): string | undefined {
  const rs = place.reviewSummary?.text?.text;
  if (rs && rs.trim()) return rs.trim();
  return extractSummary(place);
}

/** The shape of the Gemini `aiInference` block written by the Places proxy. */
type AiInference = NonNullable<GooglePlaceDetails["aiInference"]> & {
  summary?: string | null;
};

/** Persisted `review_ai_insight` column value (typed loosely, cast on write). */
export type ReviewAiInsight = ShowroomStoreInsert["reviewAiInsight"];

export interface MappedPlaceStore {
  /** Store columns ready to merge into an insert (name guaranteed non-empty). */
  values: Partial<ShowroomStoreInsert> & { name: string };
  /** Website URL (from Places or explicit input) → persisted as a WEBSITE link,
   *  NOT a store column. Null when unknown. */
  websiteUrl: string | null;
  /** Structured hours parsed from Google periods (or null when unavailable). */
  hoursJson: StructuredHours | null;
  /** First 5 Places photo refs to run through the CF Images pipeline. */
  photos: PlacePhotoRef[];
  /** Signal tokens (place types + brand types) for category inference. */
  categoryTokens: Array<string | null | undefined>;
  /** Detected brands to create + map (from the AI insight). */
  brands: Array<{ name?: string; type?: string; websiteUrl?: string }>;
  /**
   * Social profile URLs the Gemini (search-grounded) review analysis found →
   * persisted as typed rows in `showroom_store_links`. Raw URLs only: the
   * hostname classifier in `services/showroom/social-links` decides the type and
   * rejects share widgets, so a mislabeled Gemini `type` can never poison the row.
   */
  socialUrls: string[];
}

/**
 * Translate a raw Google Places Details payload (fetched WITHOUT `skipAi`, so it
 * carries the Gemini `aiInference` block) into store columns + enrichment
 * inputs — the same mapping the intake form performs client-side, kept here so
 * MCP onboarding is identical.
 */
export function mapPlaceDetailsToStoreInput(
  place: GooglePlaceDetails,
): MappedPlaceStore | null {
  const name = place.displayName?.text?.trim();
  if (!name) return null;

  const ai = (place.aiInference ?? null) as AiInference | null;
  const values: Partial<ShowroomStoreInsert> & { name: string } = { name };

  const description = extractSummary(place);
  if (description) values.description = description;

  if (place.formattedAddress) values.locationAddress = place.formattedAddress;
  const zip = parseZip(place.formattedAddress);
  if (zip) values.zipCode = zip;

  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (typeof lat === "number") values.latitude = lat;
  if (typeof lng === "number") values.longitude = lng;

  const phone =
    place.internationalPhoneNumber?.trim() || place.nationalPhoneNumber?.trim();
  if (phone) values.phoneNumber = phone;
  // Website goes to the showroom_store_links table (WEBSITE), not a store column.
  const websiteUrl = place.websiteUri?.trim() || null;
  if (place.id) {
    values.googleMapsLink = `https://www.google.com/maps/place/?q=place_id:${place.id}`;
    values.placeId = place.id;
  }

  // Price: prefer the AI's informed read over Google's structured level.
  const aiTier = ai?.inferredPricePoint ?? null;
  if (aiTier && REAL_PRICE_TIERS.has(aiTier)) {
    values.pricePoint = aiTier as "$" | "$$" | "$$$" | "$$$$";
  } else if (place.priceLevel && PRICE_LEVEL_MAP[place.priceLevel]) {
    values.pricePoint = PRICE_LEVEL_MAP[place.priceLevel];
  }

  if (typeof place.rating === "number") values.googleRating = place.rating;
  if (typeof place.userRatingCount === "number") {
    values.userRatingCount = place.userRatingCount;
  }
  const reviewSummary = extractReviewSummary(place);
  if (reviewSummary) values.reviewSummary = reviewSummary;

  // AI attribute flags → the authoritative boolean columns.
  const attrs = ai?.attributes ?? null;
  if (attrs) {
    values.isAppointmentOnly = !!attrs.appointmentOnly?.value;
    values.isFlagshipLocation = !!attrs.flagshipLocation?.value;
    values.isLargeSelection = !!attrs.largeSelection?.value;
    values.isBespoke = !!attrs.bespokeCurated?.value;
    values.isTradeRepRequired = !!attrs.tradeRepRequired?.value;
  }

  // Persist the full AI insight blob (display/context only; brands drive the
  // brand pipeline). Cast to the column's tighter type on write.
  if (ai) {
    values.reviewAiInsight = {
      summary: ai.summary ?? reviewSummary ?? "",
      inferredPricePoint: (aiTier && REAL_PRICE_TIERS.has(aiTier) ? aiTier : "$$") as
        | "$"
        | "$$"
        | "$$$"
        | "$$$$",
      priceReasoning: ai.priceReasoning ?? "",
      attributes: {
        appointmentOnly: {
          value: !!attrs?.appointmentOnly?.value,
          rationale: attrs?.appointmentOnly?.rationale ?? "",
        },
        flagshipLocation: {
          value: !!attrs?.flagshipLocation?.value,
          rationale: attrs?.flagshipLocation?.rationale ?? "",
        },
        largeSelection: {
          value: !!attrs?.largeSelection?.value,
          rationale: attrs?.largeSelection?.rationale ?? "",
        },
        bespokeCurated: {
          value: !!attrs?.bespokeCurated?.value,
          rationale: attrs?.bespokeCurated?.rationale ?? "",
        },
        tradeRepRequired: {
          value: !!attrs?.tradeRepRequired?.value,
          rationale: attrs?.tradeRepRequired?.rationale ?? "",
        },
      },
      reviewAuthenticity: {
        assessment: ai.reviewAuthenticity?.assessment ?? "UNVERIFIED",
        rationale: ai.reviewAuthenticity?.rationale ?? "",
        sources: ai.reviewAuthenticity?.sources ?? [],
      },
      brands: (ai.brands ?? []).map((b) => ({
        name: b?.name ?? "",
        type: b?.type ?? "",
        websiteUrl: b?.websiteUrl ?? "",
      })),
    } as ReviewAiInsight;
  }

  const hoursJson = placeToStructuredHours(place.regularOpeningHours);
  if (hoursJson) {
    // Hours live in showroom_store_hours rows (written by the caller from
    // hoursJson). Only the derived is_open_weekends flag stays on the store.
    values.isOpenWeekends = deriveHoursSummary(hoursJson).isOpenWeekends;
  }

  return {
    values,
    websiteUrl,
    hoursJson,
    photos: (place.photos ?? []).slice(0, 5),
    categoryTokens: [...(place.types ?? []), place.primaryType],
    brands: ai?.brands ?? [],
    socialUrls: ((ai as { socialLinks?: Array<{ url?: string }> } | undefined)?.socialLinks ?? [])
      .map((s) => s?.url)
      .filter((u): u is string => typeof u === "string" && u.length > 0),
  };
}

// ─── Enrichment pipeline ───────────────────────────────────────────────────────

async function getShowroomResearchAgent(env: Env): Promise<{ researchStore(id: number): Promise<unknown> }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getAgentByName(env.SHOWROOM_RESEARCH_AGENT as any, "showroom-research") as Promise<{
    researchStore(id: number): Promise<unknown>;
  }>;
}

/**
 * Kick the website scrape workflow: mint a ragUuid, mark pending, create it.
 *
 * Idempotent, because the caller now runs AFTER the research agent and can race
 * the Manage-backfill path's `triggerBackfillScrape`, which mints its own
 * ragUuid for the same store. Whichever lost that race would overwrite the
 * other's ragUuid and orphan a live workflow's Vectorize rows.
 *
 * THE GUARD IS ON ragUuid, NOT scrapeStatus. `scrapeStatus` cannot answer "has a
 * scrape been kicked?": the MCP tools (create_showroom, import_showroom_from_place)
 * INSERT the row with scrapeStatus "pending" as an optimistic state before any
 * workflow exists. A `status !== "idle"` guard therefore silently disables the
 * scrape for every MCP-created showroom. A ragUuid is minted ONLY here and in the
 * two sibling kickers, always alongside "pending", so its presence is the real
 * "a workflow was created for this store" marker.
 */
async function kickShowroomScrape(env: Env, showroomId: number, websiteUrl: string) {
  if (!websiteUrl) return;
  const db = drizzle(env.DB);
  const [store] = await db
    .select({ scrapeStatus: showroomStores.scrapeStatus, ragUuid: showroomStores.ragUuid })
    .from(showroomStores)
    .where(eq(showroomStores.id, showroomId))
    .limit(1);
  if (!store) return;
  // Already kicked (pending/running/complete/failed with a minted uuid) — leave
  // it alone. Re-running a finished or failed scrape is the Manage backfill's
  // job, on the user's explicit say-so, not something intake decides.
  if (store.ragUuid && store.scrapeStatus !== "idle") return;

  const ragUuid = store.ragUuid ?? crypto.randomUUID();
  await db
    .update(showroomStores)
    .set({ ragUuid, scrapeStatus: "pending", updatedAt: new Date() })
    .where(eq(showroomStores.id, showroomId));
  await env.SHOWROOM_SCRAPE_WORKFLOW.create({
    params: { showroomId, websiteUrl, ragUuid },
  });
}

/**
 * Fetch each Google Places photo's media bytes, upload to Cloudflare Images,
 * store a `showroom_photos_mapping` row, and set the hero image from photo[0].
 * Error-guarded per photo — one failure never aborts the pipeline.
 */
async function runPhotoPipeline(
  env: Env,
  showroomId: number,
  photos: PlacePhotoRef[],
) {
  const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(env);
  if (!accountId || apiTokens.length === 0) {
    console.error(`[showroom-onboarding] photos: CF Images credentials missing for store ${showroomId}`);
    return;
  }
  const [primaryToken, ...fallbackApiTokens] = apiTokens;
  const processor = new ImageProcessorService(env, accountId, primaryToken, { fallbackApiTokens });

  const mapsKey = await getGoogleMapsApiKey(env).catch(() => null);
  if (!mapsKey) {
    console.error(`[showroom-onboarding] photos: Google Maps API key missing for store ${showroomId}`);
    return;
  }

  const db = drizzle(env.DB);
  const capped = photos.slice(0, 5);
  for (let i = 0; i < capped.length; i++) {
    const photo = capped[i];
    try {
      const mediaUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1600&key=${mapsKey}`;
      const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        console.warn(`[showroom-onboarding] photos: non-ok ${res.status} for photo ${i} of store ${showroomId}`);
        continue;
      }
      const blob = await res.blob();
      const customId = `showroom-photo-${showroomId}-${i}`;
      const filename = `showroom-${showroomId}-${i}.jpg`;
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

      if (i === 0) {
        await db
          .update(showroomStores)
          .set({ heroImageCfImagesUrl: url, updatedAt: new Date() })
          .where(eq(showroomStores.id, showroomId));
      }
    } catch (photoErr) {
      console.error(`[showroom-onboarding] photos: error on photo ${i} for store ${showroomId}:`, photoErr);
    }
  }
}

/**
 * Create/find each detected brand, map it to the showroom, and record its type.
 * Deduped by lowercase name; capped at 15. Error-guarded per brand.
 */
async function runBrandPipeline(
  env: Env,
  showroomId: number,
  insightBrands: Array<{ name?: string; type?: string; websiteUrl?: string }>,
) {
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

  for (const { name, type, websiteUrl } of unique) {
    try {
      let brandId: number;
      const [existingBrand] = await db
        .select({ id: brands.id })
        .from(brands)
        .where(sql`lower(${brands.name}) = lower(${name})`)
        .limit(1);
      if (existingBrand) {
        brandId = existingBrand.id;
      } else {
        const [newBrand] = await db
          .insert(brands)
          .values({ name, websiteUrl: websiteUrl || null } as typeof brands.$inferInsert)
          .returning({ id: brands.id });
        brandId = newBrand.id;
      }

      await db
        .insert(showroomBrandMappings)
        .values({ showroomId, brandId } as typeof showroomBrandMappings.$inferInsert)
        .onConflictDoNothing();

      if (type) {
        let typeId: number;
        const [existingType] = await db
          .select({ id: brandTypesDef.id })
          .from(brandTypesDef)
          .where(sql`lower(${brandTypesDef.name}) = lower(${type})`)
          .limit(1);
        if (existingType) {
          typeId = existingType.id;
        } else {
          const [newType] = await db
            .insert(brandTypesDef)
            .values({ name: type, isActive: true } as typeof brandTypesDef.$inferInsert)
            .returning({ id: brandTypesDef.id });
          typeId = newType.id;
        }
        await db
          .insert(brandTypeMappings)
          .values({ brandId, typeId } as typeof brandTypeMappings.$inferInsert)
          .onConflictDoNothing();
      }
    } catch (brandErr) {
      console.error(`[showroom-onboarding] brands: error on "${name}" for store ${showroomId}:`, brandErr);
    }
  }
}

export interface EnrichmentInput {
  /** Website to hydrate the favicon from and crawl via the scrape workflow. */
  websiteUrl?: string | null;
  /** Store description — a category-inference signal when Places gave no types. */
  description?: string | null;
  /** Google Places photo refs to fetch + persist to CF Images. */
  photos?: PlacePhotoRef[] | null;
  /** Detected brands (from the AI insight) to create + map. */
  brands?: Array<{ name?: string; type?: string; websiteUrl?: string }> | null;
  /** Signal tokens for fill-blanks category inference (place types, brand types). */
  categoryTokens?: Array<string | null | undefined> | null;
  /** Provenance recorded on inferred category mappings. */
  categoryRationale?: string;
}

/**
 * Fire the full background enrichment pipeline for a freshly-created showroom —
 * the same work the intake form triggers. Each unit is guarded so one failure
 * never blocks the others. `schedule` decides whether the work runs detached
 * (HTTP `waitUntil`) or is awaited by the caller (MCP).
 */
export function scheduleShowroomEnrichment(
  env: Env,
  // `name` is needed for category inference — it is the strongest signal we have
  // when Places supplied nothing.
  store: Pick<ShowroomStore, "id" | "name">,
  input: EnrichmentInput,
  schedule: (p: Promise<unknown>) => void,
): void {
  const showroomId = store.id;

  // 1. AI research agent — aligns the store to the user's renovation context.
  //    Retained as a promise because step 3 must wait on it: research is often
  //    what DISCOVERS the website, and the scrape can't start without one.
  const research = (async () => {
    try {
      const agent = await getShowroomResearchAgent(env);
      await agent.researchStore(showroomId);
    } catch (err) {
      console.error(`[showroom-onboarding] research failed for ${showroomId}:`, err);
    }
  })();
  schedule(research);

  // 2. Category inference (fill-blanks).
  //
  // THIS USED TO REQUIRE GOOGLE PLACES TOKENS and did nothing without them —
  // `if (input.categoryTokens && …)`. Places `types` were the only token source,
  // so any store added without a Places match got no categories at all, forever.
  // Audited 2026-07-16: 86 of 146 prod stores had ZERO categories.
  //
  // The classifier never needed Places — it takes free text. The store NAME is
  // the strongest signal in practice ("Archetype Lighting", "Tez Marble",
  // "Tileshop"), so name + description + any Places tokens are all fed in and
  // inference always runs. `inferAndMapCategories` is fill-blanks, so a store
  // the user categorised by hand is untouched.
  const categoryTokens = [
    store.name,
    input.description ?? null,
    ...(input.categoryTokens ?? []),
    ...(input.brands ?? []).map((b) => b?.name ?? null),
    ...(input.brands ?? []).map((b) => b?.type ?? null),
  ].filter(Boolean);
  if (categoryTokens.length > 0) {
    schedule(
      inferAndMapCategories(
        env,
        showroomId,
        categoryTokens,
        input.categoryRationale ?? "Inferred from store name, description and brands at intake",
      ).catch((err) => {
        console.error(`[showroom-onboarding] categories failed for ${showroomId}:`, err);
      }),
    );
  }

  // 3. Favicon hydration + website scrape workflow.
  //
  // THE WEBSITE IS RESOLVED FROM THE DB, NOT THE INTAKE PAYLOAD, AND ONLY AFTER
  // RESEARCH. This block used to be gated on `input.websiteUrl` alone, which is
  // whatever the intake form happened to send. When Google Places returns no
  // website, the form seeds no WEBSITE link, the gate failed, and NOTHING ever
  // kicked the scrape — even though the research agent discovered the site ~10s
  // later and wrote the link itself. Measured in prod on 2026-07-16: stores
  // #133/#134/#135 each got their WEBSITE link 10-38s after creation and sat at
  // scrape_status "idle" with rag_uuid NULL forever, while #130/#131/#132 (whose
  // website WAS in the payload, link lag 0s) all kicked fine. The Manage-backfill
  // path never had this bug because it reads the website with getStoreWebsiteUrl.
  //
  // Awaiting `research` is what closes the gap; the payload value is still
  // preferred so a store that already has a website doesn't wait on research.
  schedule(
    (async () => {
      const payloadUrl = input.websiteUrl?.trim();
      if (!payloadUrl) {
        // Nothing to scrape yet — let research try to find one first. It is
        // already error-guarded internally and never rejects.
        await research;
      }
      let websiteUrl = payloadUrl ?? "";
      if (!websiteUrl) {
        try {
          websiteUrl = (await getStoreWebsiteUrl(drizzle(env.DB), showroomId)) ?? "";
        } catch (err) {
          console.error(`[showroom-onboarding] website lookup failed for ${showroomId}:`, err);
        }
      }
      if (!websiteUrl) return; // genuinely no website — nothing to scrape

      await faviconService.hydrateShowroomIcon(env, showroomId, websiteUrl).catch((err) => {
        console.error(`[showroom-onboarding] favicon failed for ${showroomId}:`, err);
      });
      await kickShowroomScrape(env, showroomId, websiteUrl).catch((err) => {
        console.error(`[showroom-onboarding] scrape trigger failed for ${showroomId}:`, err);
      });
    })(),
  );

  // 4. Places photos → Cloudflare Images pipeline (+ hero image).
  if (input.photos && input.photos.length > 0) {
    const photos = input.photos;
    schedule(
      runPhotoPipeline(env, showroomId, photos).catch((err) => {
        console.error(`[showroom-onboarding] photos failed for ${showroomId}:`, err);
      }),
    );
  }

  // 5. Brand create / map / type pipeline from the AI insight.
  if (input.brands && input.brands.length > 0) {
    const insightBrands = input.brands;
    schedule(
      runBrandPipeline(env, showroomId, insightBrands).catch((err) => {
        console.error(`[showroom-onboarding] brands failed for ${showroomId}:`, err);
      }),
    );
  }
}
