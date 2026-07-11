/**
 * @fileoverview MCP tools — Showrooms domain.
 *
 * Read + write access to the showroom directory: the physical store locations
 * the homeowner is researching / visiting (`showroom_stores`), the contacts
 * captured at each (`showroom_pocs`), the normalized per-day opening hours
 * (`showroom_hours`), and the freeform visit / research notes on each store
 * (`store_notes`).
 *
 * This domain is the field companion for showroom visits: an agent can look up
 * a store, fill in details it discovered (address / phone / website / hours),
 * record a visit note, capture a business-card contact, and log a star rating —
 * all through these tools.
 *
 * Unlike the rooms domain, showrooms ARE created via MCP (a store the homeowner
 * just heard about can be intaked with a single `name`), but they are never
 * deleted here — soft-delete / dedup is handled elsewhere.
 *
 * Column note: `showroom_stores` carries denormalized "latest visit" snapshot
 * columns (`rating`, `ratingContextHtml`, `ratingContextMarkdown`) alongside a
 * full history table (`store_rating`, not touched here). `record_showroom_visit`
 * updates the denormalized snapshot AND appends a `store_notes` row so the visit
 * is both instantly displayable and durably logged.
 */
import { showroomHours, showroomPocs, showroomStores, storeNotes } from "@backend/db";
import { GoogleMapsService } from "@backend/services/google/maps";
import {
  computeStoreGeoPatch,
  hoursJsonToRows,
  mapPlaceDetailsToStoreInput,
  scheduleShowroomEnrichment,
  type MappedPlaceStore,
} from "@backend/services/showroom/onboarding";
import type { GooglePlaceDetails } from "@frontend/components/showroom/intake/places-mapper";
import type { RemodelDb } from "../types";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { matchesQuery, paginate, toolError } from "../format";
import { looseObject, pageOutput, urlField } from "../schemas";
import { showroomUrl } from "../urls";
import {
  defineTool,
  READ_ONLY,
  WRITE,
  WRITE_IDEMPOTENT,
  type RemodelTool,
} from "../types";

/**
 * Turn a `MAPS_QUOTA_EXCEEDED` service error into an actionable tool error, and
 * re-surface any other Places failure verbatim. Keeps the two Places-backed
 * tools DRY and ensures the agent never silently spends past the free tier.
 */
function rethrowMapsError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("MAPS_QUOTA_EXCEEDED")) {
    toolError(
      "Google Maps monthly free-tier quota is exhausted — showroom search is paused to avoid spend. " +
        "Try again next month or raise the cap in the Maps usage dashboard.",
    );
  }
  toolError(`Google Places request failed: ${message}`);
}

/** Day-of-week enum shared by the hours tools — matches the `showroom_hours.day` column. */
const DAY_ENUM = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

/** Shape a store row into a compact list row for `list_showrooms`. */
function storeListDto(s: typeof showroomStores.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    pricePoint: s.pricePoint,
    address: s.locationAddress,
    zipCode: s.zipCode,
    phone: s.phoneNumber,
    website: s.websiteUrl,
    rating: s.rating,
    isAppointmentOnly: s.isAppointmentOnly,
  };
}

/**
 * Persist a mapped Google Place as a showroom row and run the SAME enrichment
 * the intake form fires: Places-photo → CF Images, brand create/map, favicon +
 * website scrape, AI research, and category inference. Because MCP tool handlers
 * have no `executionCtx.waitUntil`, the enrichment promises are collected and
 * awaited here so the tool returns only once onboarding has actually run (work
 * left un-awaited would be cancelled when the request isolate finishes).
 */
async function persistPlaceShowroom(
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
        .insert(showroomHours)
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

export const showroomTools: RemodelTool[] = [
  defineTool({
    name: "list_showrooms",
    category: "showrooms",
    title: "List showrooms",
    description:
      "List showroom store locations as compact rows (id, name, pricePoint, address, phone, website, rating). Optional filters: free-text `q` over name/description/address, exact `pricePoint` ($..$$$$), and `isAppointmentOnly`. Use a store's `id` as the target for get_showroom and every write tool.",
    inputShape: {
      q: z
        .string()
        .optional()
        .describe("Free-text filter over store name / description / address"),
      pricePoint: z
        .enum(["$", "$$", "$$$", "$$$$"])
        .optional()
        .describe("Exact price-point tier filter"),
      isAppointmentOnly: z
        .boolean()
        .optional()
        .describe("Only stores flagged appointment-only (true) or walk-in (false)"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      ...pageOutput(
        looseObject({
          id: z.number().int(),
          name: z.string().nullable(),
          pricePoint: z.string().nullable(),
          address: z.string().nullable(),
          rating: z.number().nullable(),
        }),
      ),
    },
    examples: [
      { title: "All showrooms", args: {} },
      { title: "Affordable tile places", args: { q: "tile", pricePoint: "$$" } },
    ],
    handler: async ({ db }, input) => {
      const all = await db.select().from(showroomStores).all();
      const filtered = all.filter((s) => {
        if (input.q && !matchesQuery([s.name, s.description, s.locationAddress], input.q)) {
          return false;
        }
        if (input.pricePoint && s.pricePoint !== input.pricePoint) return false;
        if (input.isAppointmentOnly != null && s.isAppointmentOnly !== input.isAppointmentOnly) {
          return false;
        }
        return true;
      });
      return paginate(filtered.map(storeListDto), input.limit ?? 50, input.offset ?? 0);
    },
  }),

  defineTool({
    name: "get_showroom",
    category: "showrooms",
    title: "Get showroom detail",
    description:
      "Full detail for one showroom by `id`: the complete store row, its ACTIVE points of contact, ALL per-day opening hours, and its ACTIVE notes (newest first). Call list_showrooms first to find the id.",
    inputShape: {
      id: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      store: looseObject({ id: z.number().int(), name: z.string().nullable() }),
      pocs: z.array(looseObject({ id: z.number().int(), fullName: z.string().nullable() })),
      hours: z.array(looseObject({ id: z.number().int(), day: z.string() })),
      notes: z.array(looseObject({ id: z.number().int(), title: z.string().nullable() })),
    },
    examples: [{ title: "By id", args: { id: 1 } }],
    handler: async ({ db }, input) => {
      const [store] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.id, input.id))
        .limit(1);
      if (!store) {
        toolError(`Showroom ${input.id} not found. Call list_showrooms for valid ids.`);
      }

      const pocs = await db
        .select()
        .from(showroomPocs)
        .where(and(eq(showroomPocs.showroomId, input.id), eq(showroomPocs.isActive, true)))
        .all();

      const hours = await db
        .select()
        .from(showroomHours)
        .where(eq(showroomHours.showroomId, input.id))
        .all();

      const notes = await db
        .select()
        .from(storeNotes)
        .where(and(eq(storeNotes.storeId, input.id), eq(storeNotes.isActive, true)))
        .orderBy(desc(storeNotes.timestamp))
        .all();

      return {
        store,
        pocs: pocs.map((p) => ({
          id: p.id,
          fullName: p.fullName,
          title: p.title,
          company: p.company,
          phone: p.phone,
          email: p.email,
          website: p.website,
          address: p.address,
        })),
        hours: hours.map((h) => ({
          id: h.id,
          day: h.day,
          openHour: h.openHour,
          openMinute: h.openMinute,
          closeHour: h.closeHour,
          closeMinute: h.closeMinute,
        })),
        notes: notes.map((n) => ({
          id: n.id,
          title: n.title,
          contentMarkdown: n.contentMarkdown,
          note: n.note,
          tags: n.tagsJson ? (JSON.parse(n.tagsJson) as string[]) : [],
          timestamp: n.timestamp,
        })),
      };
    },
  }),

  defineTool({
    name: "create_showroom",
    category: "showrooms",
    title: "Create showroom",
    description:
      "Intake a new showroom store location. STRONGLY PREFER passing a Google `placeId` (from search_showrooms): " +
      "with a placeId this runs the exact same FULL onboarding as import_showroom_from_place — Places Details + AI " +
      "review analysis, coordinates + region-hub capture, photos, brands, favicon + website scrape, and AI research " +
      "— and any explicit fields you also pass (e.g. pricePoint) override the Google-derived values. Without a " +
      "placeId it creates a manual row from the fields you provide; only `name` is required. Either way the region " +
      "hub (East Bay / South Bay / …) is captured from the coordinates/address/ZIP so the store shows under the " +
      "correct directory filter, and AI research + a website scrape (when a websiteUrl is present) run in the " +
      "background. Idempotent on `placeId` (an existing placeId returns the existing store unchanged).",
    inputShape: {
      name: z.string().optional().describe("Store / location name (required unless a placeId is given)"),
      placeId: z
        .string()
        .optional()
        .describe("Google Place ID (from search_showrooms) — triggers full AI onboarding when provided"),
      description: z.string().optional(),
      locationAddress: z.string().optional().describe("Street address of the location"),
      latitude: z.number().optional().describe("Latitude — enables the individual map marker"),
      longitude: z.number().optional().describe("Longitude — enables the individual map marker"),
      phoneNumber: z.string().optional(),
      emailAddress: z.string().optional(),
      websiteUrl: z.string().optional(),
      zipCode: z.string().optional(),
      pricePoint: z.enum(["$", "$$", "$$$", "$$$$"]).optional(),
      isAppointmentOnly: z.boolean().optional().describe("True if the store is appointment-only"),
    },
    annotations: WRITE,
    examples: [
      { title: "From a Google Place (full onboarding)", args: { placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" } },
      { title: "Minimal manual", args: { name: "Studio Belmont" } },
      {
        title: "Manual with details",
        args: {
          name: "DaVinci Marble",
          locationAddress: "150 Executive Park Blvd, San Francisco",
          websiteUrl: "https://davincimarble.com",
          pricePoint: "$$$",
        },
      },
    ],
    outputShape: {
      created: z.boolean(),
      store: looseObject({ id: z.number().int(), name: z.string().nullable() }),
      region: z.string().nullable(),
      url: urlField,
    },
    handler: async ({ env, db }, input) => {
      // ── placeId path: full onboarding, idempotent by placeId ──────────────
      const placeId = input.placeId?.trim();
      if (placeId) {
        const [existing] = await db
          .select()
          .from(showroomStores)
          .where(eq(showroomStores.placeId, placeId))
          .limit(1);
        if (existing) {
          return {
            created: false,
            store: existing,
            region: existing.hubName ?? null,
            url: showroomUrl(env, existing.id),
          };
        }

        let details: Record<string, unknown>;
        try {
          details = await new GoogleMapsService(env).placeDetails(placeId);
        } catch (err) {
          rethrowMapsError(err);
        }
        const mapped = mapPlaceDetailsToStoreInput(details as GooglePlaceDetails);
        if (!mapped) toolError(`Google returned no usable place for placeId "${placeId}".`);
        mapped.values.placeId = mapped.values.placeId ?? placeId;

        // Explicit caller fields override the Google-derived values.
        if (input.name?.trim()) mapped.values.name = input.name.trim();
        if (input.description) mapped.values.description = input.description;
        if (input.pricePoint) mapped.values.pricePoint = input.pricePoint;
        if (input.phoneNumber) mapped.values.phoneNumber = input.phoneNumber;
        if (input.emailAddress) mapped.values.emailAddress = input.emailAddress;
        if (input.websiteUrl) mapped.values.websiteUrl = input.websiteUrl;
        if (input.isAppointmentOnly != null) {
          mapped.values.isAppointmentOnly = input.isAppointmentOnly;
        }

        const created = await persistPlaceShowroom(env, db, mapped);
        return {
          created: true,
          store: created,
          region: created.hubName ?? null,
          url: showroomUrl(env, created.id),
        };
      }

      // ── Manual path: name + provided fields, region + enrichment captured ──
      const name = input.name?.trim();
      if (!name) toolError("`name` is required and cannot be empty (or pass a placeId).");

      const geo = computeStoreGeoPatch({
        latitude: input.latitude,
        longitude: input.longitude,
        zipCode: input.zipCode,
        locationAddress: input.locationAddress,
      });

      const [created] = await db
        .insert(showroomStores)
        .values({
          name,
          description: input.description,
          locationAddress: input.locationAddress,
          phoneNumber: input.phoneNumber,
          emailAddress: input.emailAddress,
          websiteUrl: input.websiteUrl,
          zipCode: input.zipCode,
          pricePoint: input.pricePoint,
          isAppointmentOnly: input.isAppointmentOnly,
          ...geo,
        })
        .returning();

      // Fire + await background enrichment (research always; favicon + scrape
      // when a website is known). No waitUntil in MCP, so await it.
      const tasks: Promise<unknown>[] = [];
      scheduleShowroomEnrichment(
        env,
        created,
        { websiteUrl: input.websiteUrl },
        (p) => tasks.push(p),
      );
      await Promise.allSettled(tasks);

      return {
        created: true,
        store: created,
        region: created.hubName ?? null,
        url: showroomUrl(env, created.id),
      };
    },
  }),

  defineTool({
    name: "update_showroom",
    category: "showrooms",
    title: "Update showroom details",
    description:
      "Patch any known columns on a showroom store (fill-in-missing-details). Only the fields you pass are changed; everything else is left untouched. The `id` cannot be changed. Great for enriching a store after research: address, contact, hours summaries, social links, POC, rating context, access level, notes.",
    inputShape: {
      id: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
      name: z.string().optional(),
      description: z.string().optional(),
      pricePoint: z.enum(["$", "$$", "$$$", "$$$$"]).optional(),
      locationAddress: z.string().optional(),
      phoneNumber: z.string().optional(),
      emailAddress: z.string().optional(),
      websiteUrl: z.string().optional(),
      zipCode: z.string().optional(),
      googleMapsLink: z.string().optional(),
      weekdayHours: z.string().optional().describe("Human-readable weekday hours summary"),
      weekendHours: z.string().optional().describe("Human-readable weekend hours summary"),
      isAppointmentOnly: z.boolean().optional(),
      mainPocFullname: z.string().optional(),
      mainPocPhoneNumber: z.string().optional(),
      mainPocEmailAddress: z.string().optional(),
      rating: z.number().int().min(1).max(5).optional().describe("Latest-visit star rating 1-5"),
      ratingContextHtml: z.string().optional(),
      ratingContextMarkdown: z.string().optional(),
      instagramUrl: z.string().optional(),
      facebookUrl: z.string().optional(),
      pinterestUrl: z.string().optional(),
      overviewNoteHtml: z.string().optional(),
      overviewNoteMarkdown: z.string().optional(),
      accessLevel: z
        .enum([
          "PUBLIC_UNRESTRICTED",
          "STRICT_TRADE_ONLY",
          "HYBRID_ACCOMPANIED",
          "HYBRID_DEALER_NETWORK",
          "HYBRID_APPOINTMENT_ONLY",
          "UNKNOWN",
        ])
        .optional()
        .describe("Homeowner access classification"),
      locationNotes: z.string().optional().describe("Quick freeform location notes"),
    },
    annotations: WRITE,
    examples: [
      { title: "Add a phone number", args: { id: 4, phoneNumber: "(415) 555-0142" } },
      {
        title: "Enrich socials + access",
        args: {
          id: 4,
          instagramUrl: "https://instagram.com/studiobelmontbath",
          accessLevel: "PUBLIC_UNRESTRICTED",
        },
      },
    ],
    outputShape: {
      updated: z.boolean(),
      store: looseObject({ id: z.number().int(), name: z.string().nullable() }),
      url: urlField,
    },
    handler: async ({ env, db }, input) => {
      const { id, ...rest } = input;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(patch).length === 0) {
        toolError("No fields to update — pass at least one field besides `id`.");
      }
      const [existing] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.id, id))
        .limit(1);
      if (!existing) {
        toolError(`Showroom ${id} not found. Call list_showrooms for valid ids.`);
      }
      await db.update(showroomStores).set(patch).where(eq(showroomStores.id, id)).run();
      const [updated] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.id, id))
        .limit(1);
      return { updated: true, store: updated, url: showroomUrl(env, id) };
    },
  }),

  defineTool({
    name: "add_showroom_note",
    category: "showrooms",
    title: "Record a showroom note",
    description:
      "Append a freeform note to a showroom (the 'record a visit note' tool). Body is Markdown and is stored in both `contentMarkdown` and the legacy `note` column. Pass an optional `title` and `tags` (string[]). Validates the showroom exists first.",
    inputShape: {
      storeId: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
      title: z.string().optional().describe("Short display title for the note"),
      body: z.string().describe("Note body as Markdown (required)"),
      tags: z.array(z.string()).optional().describe("Free-form tags, stored as JSON"),
    },
    annotations: WRITE,
    examples: [
      {
        title: "Visit note",
        args: {
          storeId: 4,
          title: "Kitchen faucet walkthrough",
          body: "Saw the **Galley** sink in person — brass finish is warmer than online.",
          tags: ["kitchen", "faucet"],
        },
      },
    ],
    outputShape: {
      created: z.boolean(),
      note: looseObject({ id: z.number().int(), title: z.string().nullable() }),
      url: urlField,
    },
    handler: async ({ env, db }, input) => {
      const body = input.body?.trim();
      if (!body) toolError("`body` is required and cannot be empty.");
      const [store] = await db
        .select({ id: showroomStores.id })
        .from(showroomStores)
        .where(eq(showroomStores.id, input.storeId))
        .limit(1);
      if (!store) {
        toolError(`Showroom ${input.storeId} not found. Call list_showrooms for valid ids.`);
      }
      const [created] = await db
        .insert(storeNotes)
        .values({
          storeId: input.storeId,
          title: input.title,
          contentMarkdown: body,
          note: body,
          tagsJson: input.tags ? JSON.stringify(input.tags) : undefined,
        })
        .returning();
      return { created: true, note: created, url: showroomUrl(env, input.storeId) };
    },
  }),

  defineTool({
    name: "add_showroom_poc",
    category: "showrooms",
    title: "Add a showroom contact",
    description:
      "Add a point of contact (sales rep, design consultant, manager) to a showroom — typically captured from a business card during a visit. `showroomId` and `fullName` are required; all other contact fields are optional. Validates the showroom exists first.",
    inputShape: {
      showroomId: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
      fullName: z.string().describe("Contact's full name (required)"),
      title: z.string().optional().describe("Job title as printed on the card"),
      company: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      website: z.string().optional(),
      address: z.string().optional(),
    },
    annotations: WRITE,
    examples: [
      {
        title: "Business-card contact",
        args: {
          showroomId: 4,
          fullName: "Jane Smith",
          title: "Senior Design Consultant",
          phone: "(415) 555-0187",
          email: "jane@studiobelmont.com",
        },
      },
    ],
    outputShape: {
      created: z.boolean(),
      poc: looseObject({ id: z.number().int(), fullName: z.string().nullable() }),
      url: urlField,
    },
    handler: async ({ env, db }, input) => {
      const fullName = input.fullName?.trim();
      if (!fullName) toolError("`fullName` is required and cannot be empty.");
      const [store] = await db
        .select({ id: showroomStores.id })
        .from(showroomStores)
        .where(eq(showroomStores.id, input.showroomId))
        .limit(1);
      if (!store) {
        toolError(`Showroom ${input.showroomId} not found. Call list_showrooms for valid ids.`);
      }
      const [created] = await db
        .insert(showroomPocs)
        .values({
          showroomId: input.showroomId,
          fullName,
          title: input.title,
          company: input.company,
          phone: input.phone,
          email: input.email,
          website: input.website,
          address: input.address,
        })
        .returning();
      return { created: true, poc: created, url: showroomUrl(env, input.showroomId) };
    },
  }),

  defineTool({
    name: "set_showroom_hours",
    category: "showrooms",
    title: "Set a day's opening hours",
    description:
      "Upsert the opening-hours window for ONE day of the week (24-hour clock). If a window already exists for this (showroom, day) it is replaced; otherwise a new one is inserted — so this is safe to retry. To mark a day CLOSED, do not set a window for it (a day with no row is closed). Validates the showroom exists first.",
    inputShape: {
      showroomId: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
      day: DAY_ENUM.describe("Day of week this window applies to"),
      openHour: z.number().int().min(0).max(23).describe("Opening hour, 24-hour clock (0-23)"),
      openMinute: z.number().int().min(0).max(59).optional().describe("Opening minute (0-59), default 0"),
      closeHour: z.number().int().min(0).max(23).describe("Closing hour, 24-hour clock (0-23)"),
      closeMinute: z.number().int().min(0).max(59).optional().describe("Closing minute (0-59), default 0"),
    },
    annotations: WRITE_IDEMPOTENT,
    examples: [
      {
        title: "Mon 9-5",
        args: { showroomId: 4, day: "MONDAY", openHour: 9, closeHour: 17 },
      },
      {
        title: "Sat 10:30-15:00",
        args: {
          showroomId: 4,
          day: "SATURDAY",
          openHour: 10,
          openMinute: 30,
          closeHour: 15,
        },
      },
    ],
    outputShape: {
      upserted: z.boolean(),
      hours: looseObject({ id: z.number().int(), day: z.string() }),
      url: urlField,
    },
    handler: async ({ env, db }, input) => {
      const [store] = await db
        .select({ id: showroomStores.id })
        .from(showroomStores)
        .where(eq(showroomStores.id, input.showroomId))
        .limit(1);
      if (!store) {
        toolError(`Showroom ${input.showroomId} not found. Call list_showrooms for valid ids.`);
      }
      // Replace-if-present: delete any existing (showroom, day) window, then insert.
      await db
        .delete(showroomHours)
        .where(
          and(
            eq(showroomHours.showroomId, input.showroomId),
            eq(showroomHours.day, input.day),
          ),
        )
        .run();
      const [created] = await db
        .insert(showroomHours)
        .values({
          showroomId: input.showroomId,
          day: input.day,
          openHour: input.openHour,
          openMinute: input.openMinute ?? 0,
          closeHour: input.closeHour,
          closeMinute: input.closeMinute ?? 0,
        })
        .returning();
      return { upserted: true, hours: created, url: showroomUrl(env, input.showroomId) };
    },
  }),

  defineTool({
    name: "record_showroom_visit",
    category: "showrooms",
    title: "Record a showroom visit",
    description:
      "Log a completed showroom visit in one call: sets the store's latest-visit `rating` (1-5) and `ratingContextMarkdown` (also mirrored to `ratingContextHtml`) AND appends a `store_notes` visit note with the same Markdown body. Optional `tags` are attached to the note. Validates the showroom exists first.",
    inputShape: {
      showroomId: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
      rating: z.number().int().min(1).max(5).describe("Star rating for this visit, 1-5"),
      note: z.string().describe("Visit note / rating context as Markdown (required)"),
      tags: z.array(z.string()).optional().describe("Free-form tags for the visit note"),
    },
    annotations: WRITE,
    examples: [
      {
        title: "4-star visit",
        args: {
          showroomId: 4,
          rating: 4,
          note: "Great selection but **appointment-only** meant a long wait. Loved the Calacatta slabs.",
          tags: ["slabs", "counters"],
        },
      },
    ],
    outputShape: {
      recorded: z.boolean(),
      store: looseObject({ id: z.number().int(), rating: z.number().nullable() }),
      note: looseObject({ id: z.number().int(), title: z.string().nullable() }),
      url: urlField,
    },
    handler: async ({ env, db }, input) => {
      const note = input.note?.trim();
      if (!note) toolError("`note` is required and cannot be empty.");
      const [store] = await db
        .select({ id: showroomStores.id })
        .from(showroomStores)
        .where(eq(showroomStores.id, input.showroomId))
        .limit(1);
      if (!store) {
        toolError(`Showroom ${input.showroomId} not found. Call list_showrooms for valid ids.`);
      }

      await db
        .update(showroomStores)
        .set({
          rating: input.rating,
          ratingContextMarkdown: note,
          ratingContextHtml: note,
        })
        .where(eq(showroomStores.id, input.showroomId))
        .run();

      const [visitNote] = await db
        .insert(storeNotes)
        .values({
          storeId: input.showroomId,
          title: `Visit — ${input.rating}★`,
          contentMarkdown: note,
          note,
          tagsJson: input.tags ? JSON.stringify(input.tags) : undefined,
        })
        .returning();

      const [updated] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.id, input.showroomId))
        .limit(1);

      return {
        recorded: true,
        store: updated,
        note: visitNote,
        url: showroomUrl(env, input.showroomId),
      };
    },
  }),

  defineTool({
    name: "search_showrooms",
    category: "showrooms",
    title: "Search for showrooms (Google Places)",
    description:
      "Discover candidate showrooms via Google Places text search — the kickstart for showroom research. " +
      "Give a free-text `query` ('stone slab countertop showroom', 'European kitchen cabinetry'); optionally bias " +
      "with `near` (a city like 'San Francisco, CA' or a 'lat,lng' pair), cap with `maxResults` (default 10, max 20), " +
      "or narrow with a Places `includedType`. Returns candidate cards (placeId, name, address, rating, phone, " +
      "website, primaryType, location) with each flagged `alreadyInDb` + `existingShowroomId` so you can skip dupes. " +
      "This is READ-ONLY discovery — nothing is saved. To persist a pick, call import_showroom_from_place (or " +
      "create_showroom). Hits an external, quota-metered API; surfaces MAPS_QUOTA_EXCEEDED clearly.",
    inputShape: {
      query: z.string().min(1).describe("Free-text place search (required)"),
      near: z
        .string()
        .optional()
        .describe("Location bias: a city name ('San Francisco, CA') or a 'lat,lng' pair"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Number of candidates to return (default 10, hard cap 20)"),
      includedType: z
        .string()
        .optional()
        .describe("Optional Google Places primary type filter (e.g. 'home_goods_store')"),
    },
    annotations: { ...READ_ONLY, openWorldHint: true },
    outputShape: {
      query: z.string(),
      near: z.string().nullable(),
      count: z.number().int(),
      candidates: z.array(
        looseObject({
          placeId: z.string(),
          name: z.string().nullable(),
          alreadyInDb: z.boolean(),
          existingShowroomId: z.number().int().nullable(),
        }),
      ),
    },
    examples: [
      {
        title: "Stone/slab near SF",
        args: { query: "stone slab countertop showroom", near: "San Francisco, CA", maxResults: 12 },
      },
      { title: "European cabinetry", args: { query: "European kitchen cabinetry Bay Area" } },
    ],
    handler: async ({ env, db }, input) => {
      const query = input.query?.trim();
      if (!query) toolError("`query` is required and cannot be empty.");

      let candidates: Awaited<ReturnType<GoogleMapsService["placesTextSearchMany"]>>;
      try {
        candidates = await new GoogleMapsService(env).placesTextSearchMany(query, {
          maxResults: input.maxResults,
          near: input.near,
          includedType: input.includedType,
        });
      } catch (err) {
        rethrowMapsError(err);
      }

      // Cross-reference existing stores by placeId so the agent can skip dupes.
      const placeIds = candidates.map((c) => c.placeId);
      const existing =
        placeIds.length > 0
          ? await db
              .select({ id: showroomStores.id, placeId: showroomStores.placeId })
              .from(showroomStores)
              .where(inArray(showroomStores.placeId, placeIds))
              .all()
          : [];
      const byPlaceId = new Map(existing.map((s) => [s.placeId, s.id]));

      return {
        query,
        near: input.near ?? null,
        count: candidates.length,
        candidates: candidates.map((c) => {
          const existingShowroomId = byPlaceId.get(c.placeId);
          return {
            placeId: c.placeId,
            name: c.displayName,
            address: c.formattedAddress,
            rating: c.rating,
            userRatingCount: c.userRatingCount,
            phone: c.nationalPhoneNumber,
            website: c.websiteUri,
            primaryType: c.primaryType,
            location: c.location,
            alreadyInDb: existingShowroomId != null,
            existingShowroomId: existingShowroomId ?? null,
          };
        }),
      };
    },
  }),

  defineTool({
    name: "import_showroom_from_place",
    category: "showrooms",
    title: "Import a showroom from a Google Place",
    description:
      "One-step, FULL onboarding of a showroom from a Google `placeId` (typically one returned by search_showrooms) — " +
      "the same flow the front-end intake form runs. Fetches Places Details WITH the Gemini review analysis to " +
      "populate name, description, address, coordinates, phone, website, structured hours, Google rating/review " +
      "count, an AI review summary, the inferred price tier, and the appointment/flagship/large-selection/bespoke/" +
      "trade-rep flags. It captures the Bay Area region hub (from coordinates/address) so the store shows under the " +
      "right East Bay / South Bay / etc. filter, then runs enrichment in the background: Google photos → Cloudflare " +
      "Images (+ hero), detected-brand create/map, favicon + full website scrape, AI renovation-fit research, and " +
      "category inference. Idempotent by `placeId`: an existing store is returned unchanged (`created:false`); " +
      "otherwise a new row is inserted (`created:true`). Prefer this over create_showroom whenever you have a " +
      "placeId. Quota-metered (Places + Gemini) — surfaces MAPS_QUOTA_EXCEEDED clearly.",
    inputShape: {
      placeId: z
        .string()
        .min(1)
        .describe("Google Place ID from search_showrooms (e.g. 'ChIJ...')"),
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      created: z.boolean(),
      showroomId: z.number().int(),
      url: urlField,
      region: z.string().nullable(),
      store: looseObject({ id: z.number().int(), name: z.string().nullable() }),
    },
    examples: [{ title: "Import a candidate", args: { placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" } }],
    handler: async ({ env, db }, input) => {
      const placeId = input.placeId?.trim();
      if (!placeId) toolError("`placeId` is required and cannot be empty.");

      // Idempotency: a store with this placeId already exists → return it.
      const [existing] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.placeId, placeId))
        .limit(1);
      if (existing) {
        return {
          created: false,
          showroomId: existing.id,
          url: showroomUrl(env, existing.id),
          region: existing.hubName ?? null,
          store: existing,
        };
      }

      // Fetch Google fields + the Gemini review analysis (aiInference) inline so
      // MCP onboarding matches the intake form. Non-fatal if Gemini is skipped.
      let details: Record<string, unknown>;
      try {
        details = await new GoogleMapsService(env).placeDetails(placeId);
      } catch (err) {
        rethrowMapsError(err);
      }

      const mapped = mapPlaceDetailsToStoreInput(details as GooglePlaceDetails);
      if (!mapped) {
        toolError(`Google returned no usable place for placeId "${placeId}".`);
      }
      // Ensure the placeId is stored even if the payload omitted `id`.
      mapped.values.placeId = mapped.values.placeId ?? placeId;

      const created = await persistPlaceShowroom(env, db, mapped);

      return {
        created: true,
        showroomId: created.id,
        url: showroomUrl(env, created.id),
        region: created.hubName ?? null,
        store: created,
      };
    },
  }),

  defineTool({
    name: "backfill_showroom_geo",
    category: "showrooms",
    title: "Backfill showroom coordinates + regions",
    description:
      "One-time maintenance for existing showrooms so the directory REGION filters (East Bay / South Bay / Peninsula / " +
      "North Bay / SF) and the individual map markers are complete. For every store that is missing its captured " +
      "region hub it derives one from the stored address / ZIP at NO API cost; for stores that also lack coordinates " +
      "but have a Google `placeId` it fetches the Place location (one quota-metered Places call each, no Gemini) and " +
      "captures lat/lng + region. Processes up to `limit` stores per call (default 25) so you can pace Places spend — " +
      "re-run until `remaining` is 0. Idempotent: rows that already have a region/coordinates are skipped. Run this " +
      "once after upgrading, or whenever showrooms were added without a placeId-driven import.",
    inputShape: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max stores to process this run (default 25)"),
      fetchCoordinates: z
        .boolean()
        .optional()
        .describe(
          "Fetch missing coordinates from Google Places by placeId (default true). " +
            "Set false to only derive regions from stored addresses with zero API calls.",
        ),
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      processed: z.number().int(),
      regionsSet: z.number().int(),
      coordinatesSet: z.number().int(),
      remaining: z.number().int(),
    },
    examples: [
      { title: "Full backfill (25/run)", args: {} },
      { title: "Regions only, no Places calls", args: { fetchCoordinates: false, limit: 100 } },
    ],
    handler: async ({ env, db }, input) => {
      const limit = input.limit ?? 25;
      const fetchCoordinates = input.fetchCoordinates ?? true;

      const all = await db.select().from(showroomStores).all();
      const candidates = all.filter(
        (s) => s.hubRoute == null || s.latitude == null || s.longitude == null,
      );
      const batch = candidates.slice(0, limit);

      const maps = new GoogleMapsService(env);
      let regionsSet = 0;
      let coordinatesSet = 0;

      for (const s of batch) {
        let lat = s.latitude;
        let lng = s.longitude;

        if ((lat == null || lng == null) && fetchCoordinates && s.placeId) {
          try {
            const d = await maps.placeDetails(s.placeId, undefined, { skipAi: true });
            const loc = d.location as { latitude?: number; longitude?: number } | undefined;
            if (typeof loc?.latitude === "number" && typeof loc?.longitude === "number") {
              lat = loc.latitude;
              lng = loc.longitude;
              coordinatesSet++;
            }
          } catch {
            // Tolerate quota / lookup failures — region derivation below still runs.
          }
        }

        const geo = computeStoreGeoPatch({
          latitude: lat,
          longitude: lng,
          zipCode: s.zipCode,
          locationAddress: s.locationAddress,
        });

        const patch: Partial<typeof showroomStores.$inferInsert> = {};
        if (geo.latitude != null && s.latitude == null) patch.latitude = geo.latitude;
        if (geo.longitude != null && s.longitude == null) patch.longitude = geo.longitude;
        if (geo.hubRoute && s.hubRoute == null) {
          patch.hubRoute = geo.hubRoute;
          patch.hubName = geo.hubName;
          regionsSet++;
        }
        if (Object.keys(patch).length > 0) {
          patch.updatedAt = new Date();
          await db.update(showroomStores).set(patch).where(eq(showroomStores.id, s.id)).run();
        }
      }

      return {
        processed: batch.length,
        regionsSet,
        coordinatesSet,
        remaining: Math.max(0, candidates.length - batch.length),
      };
    },
  }),
];
