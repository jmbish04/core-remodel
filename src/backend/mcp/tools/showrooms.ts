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
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { matchesQuery, paginate, toolError } from "../format";
import { defineTool, READ_ONLY, WRITE, WRITE_IDEMPOTENT, type RemodelTool } from "../types";

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
      "Intake a new showroom store location. Only `name` is required — pass any other details you already know (address, phone, website, email, pricePoint, description, appointmentOnly). Returns the created row. Use update_showroom later to fill in the rest.",
    inputShape: {
      name: z.string().describe("Store / location name (required)"),
      description: z.string().optional(),
      locationAddress: z.string().optional().describe("Street address of the location"),
      phoneNumber: z.string().optional(),
      emailAddress: z.string().optional(),
      websiteUrl: z.string().optional(),
      zipCode: z.string().optional(),
      pricePoint: z.enum(["$", "$$", "$$$", "$$$$"]).optional(),
      isAppointmentOnly: z.boolean().optional().describe("True if the store is appointment-only"),
    },
    annotations: WRITE,
    examples: [
      { title: "Minimal", args: { name: "Studio Belmont" } },
      {
        title: "With details",
        args: {
          name: "DaVinci Marble",
          locationAddress: "150 Executive Park Blvd, San Francisco",
          websiteUrl: "https://davincimarble.com",
          pricePoint: "$$$",
        },
      },
    ],
    handler: async ({ db }, input) => {
      const name = input.name?.trim();
      if (!name) toolError("`name` is required and cannot be empty.");
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
        })
        .returning();
      return { created: true, store: created };
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
    handler: async ({ db }, input) => {
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
      return { updated: true, store: updated };
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
    handler: async ({ db }, input) => {
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
      return { created: true, note: created };
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
    handler: async ({ db }, input) => {
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
      return { created: true, poc: created };
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
    handler: async ({ db }, input) => {
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
      return { upserted: true, hours: created };
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
    handler: async ({ db }, input) => {
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

      return { recorded: true, store: updated, note: visitNote };
    },
  }),
];
