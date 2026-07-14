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
import { eq, and, ne, inArray } from "drizzle-orm";
import { getAgentByName } from "agents";

import {
  showroomStores,
  showroomStoreHours,
  showroomPhotosMapping,
  showroomStoreCategoryMapping,
} from "@backend/db/schema/showroom/index";
import { GoogleMapsService } from "@backend/services/google/maps";
import {
  deriveIsOpenWeekends,
  hoursJsonSchema,
  hoursJsonToRows,
  normalizeHoursJson,
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
        websiteUrl: showroomStores.websiteUrl,
        placeId: showroomStores.placeId,
        googleRating: showroomStores.googleRating,
        hoursJson: showroomStores.hoursJson,
        heroImageCfImagesUrl: showroomStores.heroImageCfImagesUrl,
        reviewSummary: showroomStores.reviewSummary,
        reviewAiInsight: showroomStores.reviewAiInsight,
        iconCfImagesUrl: showroomStores.iconCfImagesUrl,
        scrapeStatus: showroomStores.scrapeStatus,
      })
      .from(showroomStores);

    // Aggregate presence of one-to-many enrichment across all stores in 3 reads.
    const [hoursRows, photoRows, categoryRows] = await Promise.all([
      db.selectDistinct({ id: showroomStoreHours.showroomId }).from(showroomStoreHours),
      db.selectDistinct({ id: showroomPhotosMapping.showroomId }).from(showroomPhotosMapping),
      db.selectDistinct({ id: showroomStoreCategoryMapping.storeId }).from(showroomStoreCategoryMapping),
    ]);
    const hasHours = new Set(hoursRows.map((r) => r.id));
    const hasPhotos = new Set(photoRows.map((r) => r.id));
    const hasCategories = new Set(categoryRows.map((r) => r.id));

    const showrooms = stores
      .map((s) => {
        const missing: Array<{ key: BadgeKey; label: string }> = [];
        const add = (k: BadgeKey) => missing.push({ key: k, label: BADGE_LABELS[k] });

        if (!s.placeId) add("place_id");
        if (!s.locationAddress) add("address");
        if (!s.phoneNumber) add("phone");
        if (!s.websiteUrl) add("website");
        // Hours exist when normalized rows are present OR the store still
        // carries a pre-normalization hoursJson blob (reconciled on backfill).
        if (!hasHours.has(s.id) && s.hoursJson == null) add("hours");
        if (s.googleRating == null) add("google_rating");
        if (!s.heroImageCfImagesUrl && !hasPhotos.has(s.id)) add("photo");
        if (!s.reviewSummary) add("review_summary");
        if (s.reviewAiInsight == null) add("ai_insight");
        if (!hasCategories.has(s.id)) add("categories");
        // Non-gating, website-dependent context badges.
        if (s.websiteUrl && !s.iconCfImagesUrl) add("icon");
        if (s.websiteUrl && s.scrapeStatus !== "complete") add("scrape");

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
      if (!store.websiteUrl && f.websiteUrl) update.websiteUrl = f.websiteUrl;
      if (store.googleRating == null && typeof f.googleRating === "number")
        update.googleRating = f.googleRating;
      if (store.userRatingCount == null && typeof f.userRatingCount === "number")
        update.userRatingCount = f.userRatingCount;
      if (!store.reviewSummary && f.reviewSummary) update.reviewSummary = f.reviewSummary;
      if (!store.pricePoint && f.pricePoint) update.pricePoint = f.pricePoint;

      // Structured hours — fill-blanks the store's hoursJson blob plus the
      // derived isOpenWeekends flag, mirroring what the intake create handler
      // derives. (The normalized showroom_store_hours rows are written below.)
      if (f.hoursJson && store.hoursJson == null) {
        update.hoursJson = normalizeHoursJson(f.hoursJson);
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
      // yet. Falls back to the store's own hoursJson so pre-normalization rows
      // (created before showroom_hours existed) get reconciled on backfill.
      const effectiveHours = f.hoursJson ?? store.hoursJson ?? null;
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
