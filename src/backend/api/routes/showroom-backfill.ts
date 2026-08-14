/**
 * @fileoverview Bulk showroom backfill router — `/api/showroom-stores/...`
 *
 * Powers the "Manage" flow on the showrooms page: find showrooms that are
 * missing config a complete intake would have filled, confirm/repair their
 * Google Places match, then piggyback the existing intake pipeline (Places
 * prefill → Gemini review analysis → research agent → scrape workflow) to
 * backfill them in bulk. All writes are FILL-BLANKS ONLY.
 *
 * Endpoints (mounted under `/api/showroom-stores`, gated by `requireAccessAuth`):
 *   GET  /meta/incomplete     List showrooms missing intake-fillable config + badges.
 *   POST /backfill/resolve    Resolve each selected showroom to a Google place card.
 *   POST /backfill/submit     Fill-blank the Places data, then enqueue enrichment.
 *
 * The heavy enrichment (Gemini, deep-sweep research, favicon, scrape, photo
 * upload) runs on the ShowroomResearchAgent's durable, retrying, self-throttling
 * queue — see `ShowroomResearchAgent.enqueueBackfill` / `.backfillEnrichShowroom`.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, ne, inArray, isNull, isNotNull, count } from "drizzle-orm";
import { getAgentByName } from "agents";

import {
  showroomStores,
  showroomStoreHours,
  showroomStoreLinks,
  showroomPhotosMapping,
  showroomStoreCategoryMapping,
} from "@backend/db/schema/showroom/index";
import { GoogleMapsService } from "@backend/services/google/maps";
import { classifyStoreCategoriesDryRun } from "@backend/utils/showroom-categories";
import { getStoreWebsiteUrl } from "@backend/utils/showroom-links";
import { faviconService } from "@backend/services/favicon";
import {
  deriveIsOpenWeekends,
  hoursJsonSchema,
  hoursJsonToRows,
} from "@backend/utils/showroom-hours";
import type { ShowroomResearchAgent } from "@backend/ai/agents/ShowroomResearchAgent";
import type { BackfillPhotoRef } from "@backend/ai/agents/ShowroomResearchAgent/methods";

export const showroomBackfillRouter = new OpenAPIHono<{ Bindings: Env }>();

const ErrorSchema = z.object({ error: z.string() });

/** Resolve the singleton ShowroomResearchAgent DO instance for queue dispatch. */
async function getShowroomResearchAgent(env: Env) {
  return getAgentByName<Env, ShowroomResearchAgent>(
    env.SHOWROOM_RESEARCH_AGENT as any,
    "showroom-research",
  );
}

// ─── Missing-config badge model ──────────────────────────────────────────────

/** Human-readable label per missing-config badge key. */
const BADGE_LABELS = {
  place_id: "Not linked to Google",
  address: "No address",
  phone: "No phone",
  website: "No website",
  hours: "No hours",
  google_rating: "No Google rating",
  photo: "No photo",
  review_summary: "No review summary",
  ai_insight: "Not AI-analyzed",
  categories: "No categories",
  icon: "No icon",
  scrape: "Site not scraped",
} as const;

type BadgeKey = keyof typeof BADGE_LABELS;

/**
 * Gating badges drive whether a showroom appears in the incomplete list. The
 * non-gating badges (`icon`, `scrape`) are shown for context but a showroom that
 * is missing ONLY those does not surface — they are best-effort scrape outputs
 * that a fully-intaked showroom may legitimately still lack.
 */
const GATING_BADGES: ReadonlySet<BadgeKey> = new Set<BadgeKey>([
  "place_id",
  "address",
  "phone",
  "website",
  "hours",
  "google_rating",
  "photo",
  "review_summary",
  "ai_insight",
  "categories",
]);

const BadgeSchema = z.object({
  key: z.enum(Object.keys(BADGE_LABELS) as [BadgeKey, ...BadgeKey[]]),
  label: z.string(),
});

const IncompleteShowroomSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  locationAddress: z.string().nullable(),
  placeId: z.string().nullable(),
  heroImageCfImagesUrl: z.string().nullable(),
  missing: z.array(BadgeSchema),
});

const IncompleteResponseSchema = z.object({
  showrooms: z.array(IncompleteShowroomSchema),
});

// ─── GET /meta/incomplete ────────────────────────────────────────────────────

showroomBackfillRouter.openapi(
  createRoute({
    method: "get",
    path: "/meta/incomplete",
    operationId: "listIncompleteShowrooms",
    tags: ["Showroom Backfill"],
    summary: "List showrooms missing intake-fillable config",
    description:
      "Returns every showroom missing at least one config field a complete intake " +
      "would have populated, each annotated with a badge per missing item. Drives the " +
      "Manage modal's selection step.",
    responses: {
      200: {
        description: "Incomplete showrooms with per-item missing badges.",
        content: { "application/json": { schema: IncompleteResponseSchema } },
      },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);

    const stores = await db
      .select({
        id: showroomStores.id,
        name: showroomStores.name,
        locationAddress: showroomStores.locationAddress,
        phoneNumber: showroomStores.phoneNumber,
        placeId: showroomStores.placeId,
        googleRating: showroomStores.googleRating,
        heroImageCfImagesUrl: showroomStores.heroImageCfImagesUrl,
        reviewSummary: showroomStores.reviewSummary,
        reviewAiInsight: showroomStores.reviewAiInsight,
        iconCfImagesUrl: showroomStores.iconCfImagesUrl,
        scrapeStatus: showroomStores.scrapeStatus,
      })
      .from(showroomStores)
      // Soft-deleted stores are not enrichment candidates.
      .where(eq(showroomStores.isActive, true));

    // Aggregate presence of one-to-many enrichment across all stores in 4 reads.
    const [hoursRows, photoRows, categoryRows, websiteRows] = await Promise.all([
      db.selectDistinct({ id: showroomStoreHours.showroomId }).from(showroomStoreHours),
      db.selectDistinct({ id: showroomPhotosMapping.showroomId }).from(showroomPhotosMapping),
      db.selectDistinct({ id: showroomStoreCategoryMapping.storeId }).from(showroomStoreCategoryMapping),
      db
        .selectDistinct({ id: showroomStoreLinks.storeId })
        .from(showroomStoreLinks)
        .where(eq(showroomStoreLinks.type, "WEBSITE")),
    ]);
    const hasHours = new Set(hoursRows.map((r) => r.id));
    const hasPhotos = new Set(photoRows.map((r) => r.id));
    const hasCategories = new Set(categoryRows.map((r) => r.id));
    const hasWebsite = new Set(websiteRows.map((r) => r.id));

    const showrooms = stores
      .map((s) => {
        const missing: Array<{ key: BadgeKey; label: string }> = [];
        const add = (k: BadgeKey) => missing.push({ key: k, label: BADGE_LABELS[k] });

        if (!s.placeId) add("place_id");
        if (!s.locationAddress) add("address");
        if (!s.phoneNumber) add("phone");
        if (!hasWebsite.has(s.id)) add("website");
        // Hours exist when normalized rows are present OR the store still
        // present (showroom_store_hours is the sole store of truth now).
        if (!hasHours.has(s.id)) add("hours");
        if (s.googleRating == null) add("google_rating");
        if (!s.heroImageCfImagesUrl && !hasPhotos.has(s.id)) add("photo");
        if (!s.reviewSummary) add("review_summary");
        if (s.reviewAiInsight == null) add("ai_insight");
        if (!hasCategories.has(s.id)) add("categories");
        // Non-gating, website-dependent context badges.
        if (hasWebsite.has(s.id) && !s.iconCfImagesUrl) add("icon");
        if (hasWebsite.has(s.id) && s.scrapeStatus !== "complete") add("scrape");

        return {
          id: s.id,
          name: s.name,
          locationAddress: s.locationAddress,
          placeId: s.placeId,
          heroImageCfImagesUrl: s.heroImageCfImagesUrl,
          missing,
        };
      })
      // Surface only showrooms missing at least one GATING field.
      .filter((s) => s.missing.some((m) => GATING_BADGES.has(m.key)))
      .sort((a, b) => b.missing.length - a.missing.length);

    return c.json({ showrooms }, 200);
  },
);

// ─── POST /backfill/resolve ──────────────────────────────────────────────────

const PlaceCardSchema = z.object({
  placeId: z.string(),
  displayName: z.string().nullable(),
  formattedAddress: z.string().nullable(),
  rating: z.number().nullable(),
  userRatingCount: z.number().nullable(),
  phoneNumber: z.string().nullable(),
  websiteUri: z.string().nullable(),
});

const ResolveResultSchema = z.object({
  showroomId: z.number().int(),
  name: z.string(),
  currentPlaceId: z.string().nullable(),
  source: z.enum(["existing", "matched", "not_found", "error"]),
  card: PlaceCardSchema.nullable(),
  error: z.string().nullable(),
});

/** Normalize a Places Details payload into the uniform confirmation card. */
function detailsToCard(placeId: string, d: Record<string, unknown>) {
  const displayName = (d.displayName as { text?: string } | undefined)?.text ?? null;
  return {
    placeId,
    displayName,
    formattedAddress: (d.formattedAddress as string) ?? null,
    rating: typeof d.rating === "number" ? (d.rating as number) : null,
    userRatingCount:
      typeof d.userRatingCount === "number" ? (d.userRatingCount as number) : null,
    phoneNumber: (d.nationalPhoneNumber as string) ?? null,
    websiteUri: (d.websiteUri as string) ?? null,
  };
}

showroomBackfillRouter.openapi(
  createRoute({
    method: "post",
    path: "/backfill/resolve",
    operationId: "resolveShowroomPlaces",
    tags: ["Showroom Backfill"],
    summary: "Resolve selected showrooms to Google place cards",
    description:
      "For each selected showroom, returns a Google place card for confirmation. " +
      "Showrooms already linked to a place_id are fetched via Places Details; unlinked " +
      "showrooms are matched via Places Text Search on name + address. The user can then " +
      "confirm or repair each match before submitting.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              showroomIds: z.array(z.number().int()).min(1).max(50),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "One resolution result per requested showroom.",
        content: {
          "application/json": {
            schema: z.object({ results: z.array(ResolveResultSchema) }),
          },
        },
      },
      429: {
        description: "Monthly Google Maps free-tier quota exceeded.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { showroomIds } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const service = new GoogleMapsService(c.env);

    const stores = await db
      .select({
        id: showroomStores.id,
        name: showroomStores.name,
        locationAddress: showroomStores.locationAddress,
        placeId: showroomStores.placeId,
      })
      .from(showroomStores)
      .where(inArray(showroomStores.id, showroomIds));
    const byId = new Map(stores.map((s) => [s.id, s]));

    const results: Array<z.infer<typeof ResolveResultSchema>> = [];
    for (const showroomId of showroomIds) {
      const store = byId.get(showroomId);
      if (!store) {
        results.push({
          showroomId,
          name: `#${showroomId}`,
          currentPlaceId: null,
          source: "error",
          card: null,
          error: "Showroom not found",
        });
        continue;
      }
      try {
        if (store.placeId) {
          const d = (await service.placeDetails(store.placeId, undefined, {
            skipAi: true,
          })) as Record<string, unknown>;
          results.push({
            showroomId,
            name: store.name,
            currentPlaceId: store.placeId,
            source: "existing",
            card: detailsToCard(store.placeId, d),
            error: null,
          });
        } else {
          const query = [store.name, store.locationAddress].filter(Boolean).join(", ");
          const match = await service.placesTextSearch(query);
          results.push({
            showroomId,
            name: store.name,
            currentPlaceId: null,
            source: match ? "matched" : "not_found",
            card: match
              ? {
                  placeId: match.placeId,
                  displayName: match.displayName,
                  formattedAddress: match.formattedAddress,
                  rating: match.rating,
                  userRatingCount: match.userRatingCount,
                  phoneNumber: match.nationalPhoneNumber,
                  websiteUri: match.websiteUri,
                }
              : null,
            error: null,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "MAPS_QUOTA_EXCEEDED") {
          return c.json({ error: "Monthly Google Maps free-tier quota exceeded." }, 429);
        }
        results.push({
          showroomId,
          name: store.name,
          currentPlaceId: store.placeId ?? null,
          source: "error",
          card: null,
          error: message,
        });
      }
    }

    return c.json({ results }, 200);
  },
);

// ─── POST /backfill/submit ───────────────────────────────────────────────────

/** Places-derived fields the frontend already mapped from the confirmed place. */
const SubmitFieldsSchema = z.object({
  locationAddress: z.string().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  websiteUrl: z.string().optional().nullable(),
  googleRating: z.number().optional().nullable(),
  userRatingCount: z.number().int().optional().nullable(),
  reviewSummary: z.string().optional().nullable(),
  pricePoint: z.enum(["$", "$$", "$$$", "$$$$"]).optional().nullable(),
  hoursJson: hoursJsonSchema.optional(),
  // Places photo references — passed through to the enrichment queue payload.
  photos: z
    .array(
      z.object({
        name: z.string(),
        widthPx: z.number().int().optional().nullable(),
        heightPx: z.number().int().optional().nullable(),
        authorAttributions: z.array(z.record(z.string(), z.unknown())).optional().nullable(),
        flagContentUri: z.string().optional().nullable(),
        googleMapsUri: z.string().optional().nullable(),
      }),
    )
    .optional(),
});

const SubmitItemSchema = z.object({
  showroomId: z.number().int(),
  placeId: z.string().min(1),
  fields: SubmitFieldsSchema.default({}),
});

showroomBackfillRouter.openapi(
  createRoute({
    method: "post",
    path: "/backfill/submit",
    operationId: "submitShowroomBackfill",
    tags: ["Showroom Backfill"],
    summary: "Fill-blank Places data, then enqueue enrichment",
    description:
      "Synchronously writes the already-available Google Places data to each showroom " +
      "(FILL-BLANKS ONLY — never overwrites existing values), links the confirmed place_id, " +
      "then enqueues the heavier Gemini + research + scrape + photo enrichment on the " +
      "ShowroomResearchAgent's durable queue.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              items: z.array(SubmitItemSchema).min(1).max(50),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Count of showrooms updated + enqueued, with any skips.",
        content: {
          "application/json": {
            schema: z.object({
              updated: z.number().int(),
              queued: z.number().int(),
              skipped: z.array(
                z.object({ showroomId: z.number().int(), reason: z.string() }),
              ),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    const { items } = c.req.valid("json");
    const db = drizzle(c.env.DB);

    const skipped: Array<{ showroomId: number; reason: string }> = [];
    const queuePayload: Array<{
      showroomId: number;
      placeId: string;
      photos?: BackfillPhotoRef[];
    }> = [];
    let updated = 0;

    for (const item of items) {
      const [store] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.id, item.showroomId))
        .limit(1);
      if (!store) {
        skipped.push({ showroomId: item.showroomId, reason: "Showroom not found" });
        continue;
      }

      const f = item.fields;
      const update: Partial<typeof showroomStores.$inferInsert> = {};

      // Fill-blanks: only write a column that is currently null/empty.
      if (!store.locationAddress && f.locationAddress) update.locationAddress = f.locationAddress;
      if (!store.phoneNumber && f.phoneNumber) update.phoneNumber = f.phoneNumber;
      // Website lives in showroom_store_links now — add a WEBSITE link only when
      // the store has none yet (fill-blanks).
      if (f.websiteUrl) {
        const existingWebsite = await getStoreWebsiteUrl(db, item.showroomId);
        if (!existingWebsite) {
          await db.insert(showroomStoreLinks).values({
            storeId: item.showroomId,
            url: f.websiteUrl.trim(),
            type: "WEBSITE",
          });
        }
      }
      if (store.googleRating == null && typeof f.googleRating === "number")
        update.googleRating = f.googleRating;
      if (store.userRatingCount == null && typeof f.userRatingCount === "number")
        update.userRatingCount = f.userRatingCount;
      if (!store.reviewSummary && f.reviewSummary) update.reviewSummary = f.reviewSummary;
      if (!store.pricePoint && f.pricePoint) update.pricePoint = f.pricePoint;

      // Structured hours — derive the isOpenWeekends flag from the payload.
      // (The normalized showroom_store_hours rows are written below; there is no
      // hours_json column any more.)
      if (f.hoursJson) {
        update.isOpenWeekends = deriveIsOpenWeekends(f.hoursJson);
      }

      // Link the confirmed place_id — only when the store has none AND no other
      // showroom already owns it (the unique index would otherwise reject it).
      if (!store.placeId) {
        const [conflict] = await db
          .select({ id: showroomStores.id })
          .from(showroomStores)
          .where(and(eq(showroomStores.placeId, item.placeId), ne(showroomStores.id, item.showroomId)))
          .limit(1);
        if (conflict) {
          skipped.push({
            showroomId: item.showroomId,
            reason: `place_id already linked to showroom #${conflict.id}`,
          });
          // Still enrich (Gemini/photos) using the payload place_id, just don't link it.
        } else {
          update.placeId = item.placeId;
        }
      }

      if (Object.keys(update).length > 0) {
        update.updatedAt = new Date();
        await db.update(showroomStores).set(update).where(eq(showroomStores.id, item.showroomId));
        updated++;
      }

      // Normalized hours — fill-blanks: only when the store has NO hours rows
      // yet, from the submitted hoursJson payload.
      const effectiveHours = f.hoursJson ?? null;
      if (effectiveHours) {
        const [existingHours] = await db
          .select({ id: showroomStoreHours.id })
          .from(showroomStoreHours)
          .where(eq(showroomStoreHours.showroomId, item.showroomId))
          .limit(1);
        if (!existingHours) {
          const rows = hoursJsonToRows(item.showroomId, effectiveHours);
          if (rows.length > 0) {
            await db.insert(showroomStoreHours).values(
              rows as [(typeof rows)[number], ...(typeof rows)[number][]],
            );
          }
        }
      }

      queuePayload.push({
        showroomId: item.showroomId,
        placeId: item.placeId,
        photos: (f.photos as BackfillPhotoRef[] | undefined) ?? undefined,
      });
    }

    // Enqueue the heavy enrichment on the agent's durable, self-throttling queue.
    let queued = 0;
    if (queuePayload.length > 0) {
      try {
        const agent = await getShowroomResearchAgent(c.env);
        const res = await agent.enqueueBackfill(queuePayload);
        queued = res.queued;
      } catch (err) {
        console.error("[showroom-backfill] enqueue failed:", err);
      }
    }

    return c.json({ updated, queued, skipped }, 200);
  },
);

// ─── POST /backfill/addresses ────────────────────────────────────────────────
//
// One-shot maintenance: split each place-linked store's address into the
// granular location_* columns and refresh location_address + google_maps_link
// from Google Places (authoritative — overwrites city-only stubs like
// "San Carlos, CA"). Targets stores that have a place_id but no
// location_street_number yet, so re-runs skip completed rows.
//
// Dry-run by default; pass ?apply=true to write. ?limit=N caps the batch
// (default 25, hard max 50). Each Places lookup is a billable external call;
// running hundreds sequentially in one Worker request blows the CPU/time
// budget, so we cap low and run small concurrent batches. The candidate filter
// (place_id set AND location_street_number NULL) naturally pages: once ?apply
// writes the granular parts, those rows drop out, so re-invoking advances until
// `remaining` reaches 0.
const ADDR_BACKFILL_BATCH = 6; // ponytail: 6 concurrent Places calls/req; raise if quota+time allow
showroomBackfillRouter.post("/backfill/addresses", async (c) => {
  const apply = c.req.query("apply") === "true" || c.req.query("apply") === "1";
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "25", 10) || 25, 1), 50);
  const db = drizzle(c.env.DB);
  const maps = new GoogleMapsService(c.env);

  if (!(await maps.canUseGoogleMaps())) {
    return c.json({ error: "Google Maps monthly free tier exceeded" }, 429);
  }

  // Total still-incomplete so the caller knows how many re-invokes remain.
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(showroomStores)
    .where(
      and(
        isNotNull(showroomStores.placeId),
        isNull(showroomStores.locationStreetNumber),
        eq(showroomStores.isActive, true),
      ),
    );

  const candidates = await db
    .select({
      id: showroomStores.id,
      placeId: showroomStores.placeId,
      locationAddress: showroomStores.locationAddress,
    })
    .from(showroomStores)
    .where(
      and(
        isNotNull(showroomStores.placeId),
        isNull(showroomStores.locationStreetNumber),
        eq(showroomStores.isActive, true),
      ),
    )
    .limit(limit);

  let updated = 0;
  const errors: Array<{ id: number; error: string }> = [];
  const preview: Array<{ id: number; formattedAddress: string | null; city: string | null; zip: string | null }> = [];

  const processOne = async (store: (typeof candidates)[number]) => {
    if (!store.placeId) return;
    try {
      const parsed = await maps.placeAddressComponents(store.placeId);
      if (!parsed) {
        errors.push({ id: store.id, error: "no address components" });
        return;
      }
      preview.push({ id: store.id, formattedAddress: parsed.formattedAddress, city: parsed.city, zip: parsed.zipCode });
      if (!apply) return;

      await db
        .update(showroomStores)
        .set({
          // Places is authoritative — overwrite the granular parts + the
          // formatted address + maps link + zip. Only writes non-null values so
          // a partial Google response never nulls out existing good data.
          ...(parsed.streetNumber ? { locationStreetNumber: parsed.streetNumber } : {}),
          ...(parsed.streetName ? { locationStreetName: parsed.streetName } : {}),
          ...(parsed.city ? { locationCity: parsed.city } : {}),
          ...(parsed.state ? { locationState: parsed.state } : {}),
          ...(parsed.zipCode ? { locationZipCode: parsed.zipCode, zipCode: parsed.zipCode } : {}),
          ...(parsed.formattedAddress ? { locationAddress: parsed.formattedAddress } : {}),
          ...(parsed.googleMapsUri ? { googleMapsLink: parsed.googleMapsUri } : {}),
          updatedAt: new Date(),
        })
        .where(eq(showroomStores.id, store.id));
      updated++;
    } catch (err) {
      errors.push({ id: store.id, error: err instanceof Error ? err.message : String(err) });
    }
  };

  // Bounded concurrency: process the capped candidate set in small batches so
  // one request never fans out hundreds of Places calls.
  for (let i = 0; i < candidates.length; i += ADDR_BACKFILL_BATCH) {
    await Promise.all(candidates.slice(i, i + ADDR_BACKFILL_BATCH).map(processOne));
  }

  return c.json(
    {
      apply,
      candidates: candidates.length,
      updated,
      // Rows still needing a backfill AFTER this batch (only decremented on apply).
      remaining: apply ? Math.max(total - updated, 0) : total,
      errorCount: errors.length,
      errors: errors.slice(0, 25),
      preview: apply ? undefined : preview.slice(0, 25),
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// POST /backfill/apply-plan — apply a reviewed audit plan. NO GOOGLE PLACES.
// ---------------------------------------------------------------------------

/**
 * Applies a plan produced by `scripts/showroom-audit.mjs`.
 *
 * Deliberately separate from `/backfill/addresses` above, which resolves data by
 * calling Google Places. Everything here is derived from data already in D1
 * (store name, description, mapped brands) plus favicon fetches, so it costs no
 * Places quota and no AI calls.
 *
 * Every section is opt-in and dry-run by default: the caller sends only the
 * sections it wants, and nothing is written unless `apply` is true. All writes
 * are FILL-BLANKS — a store that has since gained categories, a logo, or a
 * kicked scrape is skipped, so re-running is safe and converges.
 */
const applyPlanSchema = z.object({
  apply: z.boolean().optional().default(false),
  categories: z
    .array(z.object({ storeId: z.number().int(), categoryIds: z.array(z.number().int()).min(1), rationale: z.string().optional() }))
    .optional()
    .default([]),
  addresses: z
    .array(z.object({ storeId: z.number().int(), proposed: z.string().min(1) }))
    .optional()
    .default([]),
  storeLogos: z
    .array(z.object({ storeId: z.number().int(), websiteUrl: z.string().min(1) }))
    .optional()
    .default([]),
  brandLogos: z
    .array(z.object({ brandId: z.number().int(), websiteUrl: z.string().min(1) }))
    .optional()
    .default([]),
  scrapeKicks: z
    .array(z.object({ storeId: z.number().int(), websiteUrl: z.string().min(1) }))
    .optional()
    .default([]),
});

/** Favicon fetches per wave — same throttle shape as the photo pipeline. */
const LOGO_WAVE = 5;

/**
 * IDs per `inArray` — D1 rejects a query with more than 100 bound parameters,
 * so id lists are chunked below that. Mirrors D1_IN_CHUNK in utils/showroom-links.
 */
const IN_CHUNK = 90;

/**
 * Chunked `inArray` select. Every lookup in apply-plan pre-loads its rows in one
 * pass instead of querying per item: the script batches up to 40 stores per
 * request, and 40 sequential D1 roundtrips inside a single Worker invocation is
 * both slow and needless.
 */
async function selectByIds<T>(
  ids: number[],
  run: (chunk: number[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    // inArray([]) is invalid SQL — the slice is always non-empty here.
    out.push(...(await run(ids.slice(i, i + IN_CHUNK))));
  }
  return out;
}

showroomBackfillRouter.post("/backfill/apply-plan", async (c) => {
  const parsed = applyPlanSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid plan", detail: parsed.error.flatten() }, 400);
  }
  const plan = parsed.data;
  const apply = plan.apply;
  const db = drizzle(c.env.DB);
  const result = {
    apply,
    categories: { applied: 0, skipped: 0 },
    addresses: { applied: 0, skipped: 0 },
    storeLogos: { applied: 0, failed: 0 },
    brandLogos: { applied: 0, failed: 0 },
    scrapeKicks: { applied: 0, skipped: 0 },
    notes: [] as string[],
  };

  // ── Categories (fill-blanks: skip any store that already has one) ──────────
  if (plan.categories.length > 0) {
    const already = new Set(
      (
        await selectByIds(
          plan.categories.map((r) => r.storeId),
          (chunk) =>
            db
              .select({ storeId: showroomStoreCategoryMapping.storeId })
              .from(showroomStoreCategoryMapping)
              .where(inArray(showroomStoreCategoryMapping.storeId, chunk)),
        )
      ).map((r) => r.storeId),
    );

    const rows: Array<typeof showroomStoreCategoryMapping.$inferInsert> = [];
    for (const row of plan.categories) {
      if (already.has(row.storeId)) {
        result.categories.skipped++;
        continue;
      }
      if (apply) {
        for (const categoryId of row.categoryIds) {
          rows.push({
            storeId: row.storeId,
            categoryId,
            aiRationale: row.rationale ?? "Backfilled from audit plan (no Places)",
            aiRationaleConfidenceScore: 5,
          });
        }
      }
      result.categories.applied++;
    }
    // 4 bound params per row — 20 rows keeps each batch under D1's 100 cap.
    for (let i = 0; i < rows.length; i += 20) {
      const chunk = rows
        .slice(i, i + 20)
        .map((r) => db.insert(showroomStoreCategoryMapping).values(r).onConflictDoNothing());
      if (chunk.length === 0) continue;
      await db.batch(chunk as [(typeof chunk)[number], ...(typeof chunk)[number][]]);
    }
  }

  // ── Addresses — ONLY values the plan explicitly proposed. Never invented. ──
  const addressRows: Array<{ storeId: number; proposed: string }> = [];
  for (const row of plan.addresses) {
    if (apply) addressRows.push({ storeId: row.storeId, proposed: row.proposed });
    result.addresses.applied++;
  }
  for (let i = 0; i < addressRows.length; i += 20) {
    const chunk = addressRows
      .slice(i, i + 20)
      .map((r) =>
        db
          .update(showroomStores)
          .set({ locationAddress: r.proposed, updatedAt: new Date() })
          .where(eq(showroomStores.id, r.storeId)),
      );
    if (chunk.length === 0) continue;
    await db.batch(chunk as [(typeof chunk)[number], ...(typeof chunk)[number][]]);
  }

  // ── Store logos (favicon) — fill-blanks, throttled ────────────────────────
  // Icons pre-loaded in one pass so the throttled waves below do no DB work.
  const existingIcons = new Set(
    (
      await selectByIds(
        plan.storeLogos.map((r) => r.storeId),
        (chunk) =>
          db
            .select({ id: showroomStores.id, icon: showroomStores.iconCfImagesUrl })
            .from(showroomStores)
            .where(inArray(showroomStores.id, chunk)),
      )
    )
      .filter((r) => r.icon)
      .map((r) => r.id),
  );
  for (let i = 0; i < plan.storeLogos.length; i += LOGO_WAVE) {
    const wave = plan.storeLogos.slice(i, i + LOGO_WAVE);
    await Promise.all(
      wave.map(async (row) => {
        try {
          if (existingIcons.has(row.storeId)) return; // already has one
          if (apply) await faviconService.hydrateShowroomIcon(c.env, row.storeId, row.websiteUrl);
          result.storeLogos.applied++;
        } catch (err) {
          result.storeLogos.failed++;
          console.error(`[apply-plan] store logo failed for ${row.storeId}:`, err);
        }
      }),
    );
  }

  // ── Brand logos (favicon) — the big one: ~280 brands ──────────────────────
  for (let i = 0; i < plan.brandLogos.length; i += LOGO_WAVE) {
    const wave = plan.brandLogos.slice(i, i + LOGO_WAVE);
    await Promise.all(
      wave.map(async (row) => {
        try {
          if (apply) await faviconService.hydrateBrandIcon(c.env, row.brandId, row.websiteUrl);
          result.brandLogos.applied++;
        } catch (err) {
          result.brandLogos.failed++;
          console.error(`[apply-plan] brand logo failed for ${row.brandId}:`, err);
        }
      }),
    );
  }

  // ── Stranded scrape kicks — REAL Browser Run spend, so guarded hard ───────
  const kickStates = new Map(
    (
      await selectByIds(
        plan.scrapeKicks.map((r) => r.storeId),
        (chunk) =>
          db
            .select({
              id: showroomStores.id,
              scrapeStatus: showroomStores.scrapeStatus,
              ragUuid: showroomStores.ragUuid,
            })
            .from(showroomStores)
            .where(inArray(showroomStores.id, chunk)),
      )
    ).map((r) => [r.id, r]),
  );
  for (const row of plan.scrapeKicks) {
    const store = kickStates.get(row.storeId);
    // Same guard as kickShowroomScrape: a minted ragUuid means a workflow exists.
    if (!store || (store.ragUuid && store.scrapeStatus !== "idle")) {
      result.scrapeKicks.skipped++;
      continue;
    }
    if (apply) {
      const ragUuid = store.ragUuid ?? crypto.randomUUID();
      await db
        .update(showroomStores)
        .set({ ragUuid, scrapeStatus: "pending", updatedAt: new Date() })
        .where(eq(showroomStores.id, row.storeId));
      await c.env.SHOWROOM_SCRAPE_WORKFLOW.create({
        params: { showroomId: row.storeId, websiteUrl: row.websiteUrl, ragUuid },
      });
    }
    result.scrapeKicks.applied++;
  }

  if (!apply) result.notes.push("DRY RUN — nothing written. Re-send with apply:true.");
  return c.json(result, 200);
});

/**
 * GET /backfill/categorize?limit=&offset=&apply= — classify showrooms that
 * currently have ZERO category mappings (gemini-2.5-flash), over a paged slice.
 *
 * DRY RUN by default (`apply` unset/false): predicts + returns, writes NOTHING.
 * With `apply=true`: persists the SAME prediction it returns — the first id is the
 * store's primary category — so the report matches exactly what was written. Only
 * ever writes when the store still has zero mappings (fill-blanks; re-checked per
 * row), so a concurrent write can't produce a duplicate/second-primary.
 *
 * `total` is the full uncategorized count so a caller can page with offset.
 * Response 200: { total, offset, limit, apply, appliedCount, results }
 */
showroomBackfillRouter.get("/backfill/categorize", async (c) => {
  const db = drizzle(c.env.DB);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 15, 1), 25);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);
  const apply = c.req.query("apply") === "true";

  // Uncategorized = active store with no category_mapping row. Compute the whole
  // set with two cheap (AI-free) queries, then classify only the requested slice.
  const mapped = await db
    .selectDistinct({ storeId: showroomStoreCategoryMapping.storeId })
    .from(showroomStoreCategoryMapping);
  const mappedSet = new Set(mapped.map((m) => m.storeId));
  const active = await db
    .select({ id: showroomStores.id })
    .from(showroomStores)
    .where(eq(showroomStores.isActive, true))
    .orderBy(showroomStores.id);
  const uncategorized = active.map((s) => s.id).filter((id) => !mappedSet.has(id));

  const slice = uncategorized.slice(offset, offset + limit);
  const results = await Promise.all(
    slice.map((id) => classifyStoreCategoriesDryRun(c.env, id, [])),
  );

  let appliedCount = 0;
  if (apply) {
    for (const pred of results) {
      if (pred.hasExistingCategories || pred.predicted.length === 0) continue;
      // Re-check fill-blanks at write time (defends against a concurrent classify).
      const [row] = await db
        .select({ id: showroomStoreCategoryMapping.id })
        .from(showroomStoreCategoryMapping)
        .where(eq(showroomStoreCategoryMapping.storeId, pred.storeId))
        .limit(1);
      if (row) continue;
      for (const [i, cat] of pred.predicted.entries()) {
        await db.insert(showroomStoreCategoryMapping).values({
          storeId: pred.storeId,
          categoryId: cat.id,
          aiRationale: "Bulk categorize backfill (dry-run classifier, gemini-2.5-flash)",
          aiRationaleConfidenceScore: pred.usedAi ? 7 : 5,
          isPrimary: i === 0,
        });
      }
      appliedCount++;
    }
  }

  return c.json({ total: uncategorized.length, offset, limit, apply, appliedCount, results }, 200);
});
