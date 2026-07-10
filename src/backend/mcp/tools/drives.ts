/**
 * @fileoverview MCP tools — Showroom Drive Lists domain.
 *
 * Lets Claude build and reason about showroom "drive sheets": an ordered set of
 * showroom stops for a day of visits. `create_drive_list` makes a drive appear
 * on the `/admin/shopping/drives` landing page (openable in the drive viewport);
 * `list_drive_lists` / `get_drive_list` read prior drives with their check-off
 * progress; and `analyze_drive_coverage` cross-references stops that were left
 * unvisited on a drive against the registered showrooms' real visit signal — so
 * the agent can spot showrooms skipped on a drive but visited later, and surface
 * registered showrooms not yet on any drive as candidates for the next one.
 *
 * Registry contract (0015): hand-written Zod v4, annotations, examples.
 */
import { driveListStops, driveLists, showroomStores } from "@backend/db";
import { and, desc, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../format";
import { looseObject, urlField } from "../schemas";
import { driveListUrl, showroomUrl } from "../urls";
import { defineTool, READ_ONLY, WRITE, type RemodelDb, type RemodelTool } from "../types";

/** Kebab-case a title into a URL slug base (letters/digits/hyphens only). */
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "drive-list";
}

/** Find a drive-list slug not already taken (appends -2, -3, … on collision). */
async function uniqueSlug(db: RemodelDb, base: string): Promise<string> {
  const [exact] = await db
    .select({ slug: driveLists.slug })
    .from(driveLists)
    .where(eq(driveLists.slug, base))
    .limit(1);
  if (!exact) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    const [hit] = await db
      .select({ slug: driveLists.slug })
      .from(driveLists)
      .where(eq(driveLists.slug, candidate))
      .limit(1);
    if (!hit) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/** One stop as accepted by create_drive_list. */
const stopInput = looseObject({
  name: z.string().min(1).describe("Showroom / stop name (required)"),
  showroomStoreId: z
    .number()
    .int()
    .optional()
    .describe("Link to a registered showroom (showroom_stores.id) — enables visit cross-referencing"),
  city: z.string().optional(),
  address: z.string().optional().describe("Street address — becomes the tap-to-navigate destination"),
  phone: z.string().optional(),
  hours: z.string().optional().describe("Human-readable hours line, e.g. 'Fri 8:00–4:30'"),
  note: z.string().optional().describe("Why this stop is on the list / what to look for"),
  pick: z.string().optional().describe("Optional 'research pick / detour' label"),
  websiteUrl: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  leg: z.string().optional().describe("Leg / cluster label (groups stops), e.g. 'Tri-Valley'"),
  legWindow: z.string().optional().describe("Time window for the leg, e.g. 'afternoon · down 680 → 580'"),
  isOptional: z.boolean().optional().describe("true = optional research pick; false = core numbered stop"),
});

export const driveTools: RemodelTool[] = [
  defineTool({
    name: "list_drive_lists",
    category: "drives",
    title: "List showroom drive lists",
    description:
      "List showroom drive lists (drive sheets) newest-first, each with its completion progress " +
      "(visited vs. total stops). Use this to see prior drives before creating or analyzing one.",
    inputShape: {
      status: z.enum(["draft", "active", "completed", "archived"]).optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      count: z.number().int(),
      driveLists: z.array(
        looseObject({
          id: z.number().int(),
          slug: z.string(),
          title: z.string(),
          status: z.string(),
          stopCount: z.number().int(),
          visitedCount: z.number().int(),
          url: urlField,
        }),
      ),
    },
    examples: [
      { title: "All drives", args: {} },
      { title: "Active only", args: { status: "active" } },
    ],
    handler: async ({ env, db }, input) => {
      const rows = await db
        .select({
          id: driveLists.id,
          slug: driveLists.slug,
          title: driveLists.title,
          description: driveLists.description,
          status: driveLists.status,
          createdAt: driveLists.createdAt,
          stopCount: sql<number>`count(${driveListStops.id})`,
          visitedCount: sql<number>`coalesce(sum(${driveListStops.visited}), 0)`,
        })
        .from(driveLists)
        .leftJoin(driveListStops, eq(driveLists.id, driveListStops.driveListId))
        .where(input.status ? eq(driveLists.status, input.status) : undefined)
        .groupBy(driveLists.id)
        .orderBy(desc(driveLists.createdAt))
        .limit(input.limit ?? 100)
        .all();

      return {
        count: rows.length,
        driveLists: rows.map((r) => ({
          id: r.id,
          slug: r.slug,
          title: r.title,
          description: r.description,
          status: r.status,
          stopCount: Number(r.stopCount),
          visitedCount: Number(r.visitedCount),
          createdAt: r.createdAt,
          url: driveListUrl(env, r.slug),
        })),
      };
    },
  }),

  defineTool({
    name: "get_drive_list",
    category: "drives",
    title: "Get a showroom drive list",
    description:
      "Full detail for one drive list (by `id` or `slug`): its stops in order, each with its leg, " +
      "details, and visited check-off state.",
    inputShape: {
      id: z.number().int().positive().optional().describe("Drive list id"),
      slug: z.string().optional().describe("Drive list slug (alternative to id)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      id: z.number().int(),
      slug: z.string(),
      title: z.string(),
      status: z.string(),
      url: urlField,
      stopCount: z.number().int(),
      visitedCount: z.number().int(),
      stops: z.array(looseObject({ id: z.number().int(), name: z.string(), visited: z.boolean() })),
    },
    examples: [{ title: "By slug", args: { slug: "east-bay-stone-run" } }],
    handler: async ({ env, db }, input) => {
      if (input.id == null && !input.slug) toolError("Pass either `id` or `slug`.");
      const [drive] = await db
        .select()
        .from(driveLists)
        .where(input.id != null ? eq(driveLists.id, input.id) : eq(driveLists.slug, input.slug!))
        .limit(1);
      if (!drive) toolError("Drive list not found. Call list_drive_lists for valid ids/slugs.");

      const stops = await db
        .select()
        .from(driveListStops)
        .where(eq(driveListStops.driveListId, drive.id))
        .orderBy(driveListStops.sortOrder, driveListStops.id)
        .all();

      return {
        id: drive.id,
        slug: drive.slug,
        title: drive.title,
        description: drive.description,
        notes: drive.notes,
        status: drive.status,
        url: driveListUrl(env, drive.slug),
        stopCount: stops.length,
        visitedCount: stops.filter((s) => s.visited).length,
        stops,
      };
    },
  }),

  defineTool({
    name: "create_drive_list",
    category: "drives",
    title: "Create a showroom drive list",
    description:
      "Create a showroom drive sheet — an ordered set of showroom stops for a day of visits. It " +
      "immediately appears on the `/admin/shopping/drives` landing page and opens in the drive " +
      "viewport. Pass a `title` and a `stops` array (in visit order); each stop needs a `name` and " +
      "should include an `address` (the tap-to-navigate destination) and, when it maps to a " +
      "registered showroom, a `showroomStoreId` so drive coverage can be analyzed later. Group " +
      "stops into legs with `leg`/`legWindow`. Returns { ok, id, slug, url }.",
    inputShape: {
      title: z.string().min(1).describe("Drive title (required)"),
      description: z.string().optional(),
      notes: z.string().optional().describe("Freeform planning notes for the day"),
      status: z.enum(["draft", "active", "completed", "archived"]).optional(),
      sourceConversation: z.string().optional().describe("Note on where this came from (chat context)"),
      stops: z.array(stopInput).min(1).describe("Stops in visit order (at least one)"),
    },
    annotations: WRITE,
    outputShape: {
      ok: z.boolean(),
      id: z.number().int().optional(),
      slug: z.string().optional(),
      url: urlField.optional(),
      stopCount: z.number().int().optional(),
    },
    examples: [
      {
        title: "A two-stop drive",
        args: {
          title: "East Bay Stone Run",
          stops: [
            {
              name: "All Natural Stone",
              city: "Berkeley",
              address: "611 Hearst Ave, Berkeley, CA 94710",
              hours: "Fri 8:00–4:30",
              leg: "West Berkeley → Oakland",
            },
            {
              name: "Arizona Tile",
              city: "Livermore",
              address: "7364 Marathon Dr, Livermore, CA 94550",
              leg: "Tri-Valley",
            },
          ],
        },
      },
    ],
    handler: async ({ env, db }, input) => {
      const title = input.title?.trim();
      if (!title) toolError("`title` is required and cannot be empty.");
      if (!input.stops?.length) toolError("`stops` must contain at least one stop.");

      const slug = await uniqueSlug(db, slugify(title));
      const [drive] = await db
        .insert(driveLists)
        .values({
          slug,
          title,
          description: input.description,
          notes: input.notes,
          status: input.status ?? "active",
          sourceConversation: input.sourceConversation,
        })
        .returning({ id: driveLists.id });

      const stopValues = input.stops.map((s, i) => ({
        driveListId: drive.id,
        showroomStoreId: s.showroomStoreId,
        sortOrder: i,
        leg: s.leg,
        legWindow: s.legWindow,
        name: s.name,
        city: s.city,
        address: s.address,
        phone: s.phone,
        hours: s.hours,
        note: s.note,
        pick: s.pick,
        websiteUrl: s.websiteUrl,
        latitude: s.latitude,
        longitude: s.longitude,
        isOptional: s.isOptional ?? false,
      }));
      // Chunk inserts: a stop row binds 16 params, and D1 caps a query at 100
      // bound params — so a single multi-row insert of a full drive would blow
      // the limit. 5 rows/insert = 80 params, safely under.
      for (let i = 0; i < stopValues.length; i += 5) {
        await db.insert(driveListStops).values(stopValues.slice(i, i + 5));
      }

      return {
        ok: true,
        id: drive.id,
        slug,
        url: driveListUrl(env, slug),
        stopCount: input.stops.length,
      };
    },
  }),

  defineTool({
    name: "analyze_drive_coverage",
    category: "drives",
    title: "Analyze showroom drive coverage",
    description:
      "Coverage analysis for planning the next drive. Returns (1) stops left UNVISITED on the drive(s) " +
      "— for stops linked to a registered showroom, whether that showroom nonetheless has a real visit " +
      "signal (a latest-visit rating), i.e. it was likely visited outside the drive; and (2) registered " +
      "showrooms not yet on ANY drive list, as candidates for a future drive. Pass a `slug`/`id` to scope " +
      "to one drive, or omit to analyze all drives.",
    inputShape: {
      id: z.number().int().positive().optional().describe("Scope to one drive (id)"),
      slug: z.string().optional().describe("Scope to one drive (slug)"),
      candidateLimit: z.number().int().positive().max(200).optional().describe("Max candidate showrooms (default 50)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      unvisitedStops: z.array(
        looseObject({
          stopId: z.number().int(),
          driveSlug: z.string(),
          name: z.string(),
          showroomStoreId: z.number().int().nullable(),
          showroomVisitedElsewhere: z.boolean(),
        }),
      ),
      candidateShowrooms: z.array(
        looseObject({ id: z.number().int(), name: z.string(), url: urlField }),
      ),
      summary: looseObject({
        unvisitedCount: z.number().int(),
        visitedElsewhereCount: z.number().int(),
        candidateCount: z.number().int(),
      }),
    },
    examples: [
      { title: "All drives", args: {} },
      { title: "One drive", args: { slug: "east-bay-stone-run" } },
    ],
    handler: async ({ env, db }, input) => {
      // Resolve optional drive scope.
      let driveScopeId: number | null = null;
      if (input.id != null || input.slug) {
        const [drive] = await db
          .select({ id: driveLists.id })
          .from(driveLists)
          .where(input.id != null ? eq(driveLists.id, input.id) : eq(driveLists.slug, input.slug!))
          .limit(1);
        if (!drive) toolError("Drive list not found. Call list_drive_lists for valid ids/slugs.");
        driveScopeId = drive.id;
      }

      // Unvisited stops (optionally scoped), joined to the drive for its slug and
      // to the showroom for its latest-visit rating (the "visited elsewhere" signal).
      const unvisitedWhere = driveScopeId
        ? and(eq(driveListStops.visited, false), eq(driveListStops.driveListId, driveScopeId))
        : eq(driveListStops.visited, false);
      const unvisitedRows = await db
        .select({
          stopId: driveListStops.id,
          driveSlug: driveLists.slug,
          name: driveListStops.name,
          showroomStoreId: driveListStops.showroomStoreId,
          showroomRating: showroomStores.rating,
        })
        .from(driveListStops)
        .innerJoin(driveLists, eq(driveListStops.driveListId, driveLists.id))
        .leftJoin(showroomStores, eq(driveListStops.showroomStoreId, showroomStores.id))
        .where(unvisitedWhere)
        .all();

      const unvisitedStops = unvisitedRows.map((r) => ({
        stopId: r.stopId,
        driveSlug: r.driveSlug,
        name: r.name,
        showroomStoreId: r.showroomStoreId,
        // A latest-visit rating is only set on an actual visit → a strong signal
        // the showroom was visited even though this stop stayed unchecked.
        showroomVisitedElsewhere: r.showroomStoreId != null && r.showroomRating != null,
      }));

      // Registered showrooms not referenced by ANY drive stop → future candidates.
      // Materialize the used ids first: notInArray wants a primitive array (not a
      // subquery), and an empty `NOT IN ()` is a SQLite syntax error — so only
      // apply the filter when some showrooms are actually in use.
      const usedRows = await db
        .selectDistinct({ id: driveListStops.showroomStoreId })
        .from(driveListStops)
        .where(isNotNull(driveListStops.showroomStoreId))
        .all();
      const usedIds = usedRows
        .map((r) => r.id)
        .filter((id): id is number => id != null);
      const candidateRows = await db
        .select({ id: showroomStores.id, name: showroomStores.name })
        .from(showroomStores)
        .where(usedIds.length ? notInArray(showroomStores.id, usedIds) : undefined)
        .limit(input.candidateLimit ?? 50)
        .all();

      return {
        unvisitedStops,
        candidateShowrooms: candidateRows.map((s) => ({
          id: s.id,
          name: s.name,
          url: showroomUrl(env, s.id),
        })),
        summary: {
          unvisitedCount: unvisitedStops.length,
          visitedElsewhereCount: unvisitedStops.filter((s) => s.showroomVisitedElsewhere).length,
          candidateCount: candidateRows.length,
        },
      };
    },
  }),
];
