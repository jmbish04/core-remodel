/**
 * @fileoverview Admin API for Showroom Drive Lists.
 *
 * `GET/POST/PATCH /api/drive-lists*` — admin-gated reads, create, and the drive
 * check-off, backing the `/admin/shopping/drives` landing page and the
 * `/admin/shopping/drives/[slug]` viewport. Drive lists are usually CREATED
 * through the `create_drive_list` MCP tool (from a chat); `POST` here is the
 * equivalent HTTP surface. Both take `notes` as an optional array of strings.
 *
 * Mounted at `/api/drive-lists`.
 */
import { driveListNotes, driveListStops, driveLists, showroomStores, storeNotes } from "@backend/db";
import { HOME_RADIUS_M } from "@backend/services/drive-home-arrival-rules";
import { getHomeCoords } from "@backend/services/drive-home-arrival";
import {
  addDriveStops,
  createDriveList,
  createDriveNote,
  deleteDriveNote,
  type DriveStopInput,
  type DriveStopUpdateInput,
  fillMissingStopCoords,
  listDriveNotes,
  parseDriveNotes,
  removeDriveStop,
  setActiveDrive,
  setDriveNoteRead,
  updateDriveList,
  updateDriveStop,
} from "@backend/services/drive-lists";
import { getStreamControl, isWithinStreamWindow } from "@backend/services/tesla/gating";
import { isRequestAuthenticated } from "@backend/utils/access";
import { asc, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

/** Body accepted by `POST /api/drive-lists`. `notes` is optional, and an array. */
const createBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  notes: z.array(z.string().min(1)).optional(),
  status: z.enum(["draft", "active", "completed", "archived"]).optional(),
  sourceConversation: z.string().optional(),
  stops: z
    .array(
      z.object({
        name: z.string().min(1),
        showroomStoreId: z.number().int().optional(),
        city: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        hours: z.string().optional(),
        note: z.string().optional(),
        pick: z.string().optional(),
        websiteUrl: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        leg: z.string().optional(),
        legWindow: z.string().optional(),
        isOptional: z.boolean().optional(),
      }),
    )
    .min(1),
});

const driveListsRouter = new Hono<{ Bindings: Env }>();

/** Gate every route behind the admin cookie / bearer auth. */
driveListsRouter.use("*", async (c, next) => {
  if (!(await isRequestAuthenticated(c.req.raw, c.env))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** GET /api/drive-lists — landing list, newest-first, with completion counts,
 * the single-active flag, and per-drive map marker coords. Progress (0 visited /
 * some / all) is what the landing page tabs bucket on, so nothing here mutates
 * status. */
driveListsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      id: driveLists.id,
      slug: driveLists.slug,
      title: driveLists.title,
      description: driveLists.description,
      status: driveLists.status,
      isActive: driveLists.isActive,
      createdAt: driveLists.createdAt,
      updatedAt: driveLists.updatedAt,
      stopCount: sql<number>`count(${driveListStops.id})`,
      visitedCount: sql<number>`coalesce(sum(${driveListStops.visited}), 0)`,
    })
    .from(driveLists)
    .leftJoin(driveListStops, eq(driveLists.id, driveListStops.driveListId))
    .groupBy(driveLists.id)
    .orderBy(desc(driveLists.createdAt))
    .all();

  // Map markers: a stop's own coords, else its linked showroom's coords.
  const markerRows = await db
    .select({
      driveListId: driveListStops.driveListId,
      lat: sql<number | null>`coalesce(${driveListStops.latitude}, ${showroomStores.latitude})`,
      lng: sql<number | null>`coalesce(${driveListStops.longitude}, ${showroomStores.longitude})`,
    })
    .from(driveListStops)
    .leftJoin(showroomStores, eq(driveListStops.showroomStoreId, showroomStores.id))
    .orderBy(asc(driveListStops.driveListId), asc(driveListStops.sortOrder))
    .all();
  const markersByDrive = new Map<number, { lat: number; lng: number }[]>();
  for (const m of markerRows) {
    if (m.lat == null || m.lng == null) continue;
    const list = markersByDrive.get(m.driveListId) ?? [];
    list.push({ lat: m.lat, lng: m.lng });
    markersByDrive.set(m.driveListId, list);
  }

  return c.json({
    count: rows.length,
    driveLists: rows.map((r) => ({
      ...r,
      stopCount: Number(r.stopCount),
      visitedCount: Number(r.visitedCount),
      markers: markersByDrive.get(r.id) ?? [],
    })),
  });
});

/** POST /api/drive-lists — create a drive list (HTTP twin of create_drive_list). */
driveListsRouter.post("/", async (c) => {
  const parsed = createBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }
  const db = drizzle(c.env.DB);
  const { id, slug, stopCount } = await createDriveList(db, parsed.data);
  return c.json({ ok: true, id, slug, stopCount }, 201);
});

/**
 * GET /api/drive-lists/active — THE active drive ({ id, slug, title }) or null.
 *
 * Cheap probe for the global "active drive" banner and the viewport's activate
 * control (so it can name the drive it would deactivate). Declared BEFORE
 * `/:slug` so the literal path wins over the slug pattern.
 */
driveListsRouter.get("/active", async (c) => {
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({ id: driveLists.id, slug: driveLists.slug, title: driveLists.title })
    .from(driveLists)
    .where(eq(driveLists.isActive, true))
    .orderBy(desc(driveLists.updatedAt))
    .limit(1);
  return c.json({ active: row ?? null });
});

/**
 * GET /api/drive-lists/home-location — the project's coordinates, as used by the
 * home-arrival rule that ends an active drive.
 *
 * Resolved from the permit address in `project_system_variables` and cached
 * there after the first lookup, so this is also how you confirm the geocode
 * actually worked. `{ home: null }` means the address is unset or the lookup
 * failed — in which case arriving home ends nothing, by design.
 *
 * Declared BEFORE `/:slug` so the literal path wins over the slug pattern.
 */
driveListsRouter.get("/home-location", async (c) => {
  const home = await getHomeCoords(c.env, drizzle(c.env.DB));
  return c.json({
    home,
    radiusM: HOME_RADIUS_M,
    // No wall-clock cutoff anymore — a car PARKED within radiusM ends the drive
    // at any hour. Field kept (null) so existing readers don't break.
    afterLocalMinutes: null,
    requiresParked: true,
    timezone: "America/Los_Angeles",
  });
});

/** GET /api/drive-lists/:slug — one drive + its ordered stops. */
driveListsRouter.get("/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  const [drive] = await db.select().from(driveLists).where(eq(driveLists.slug, slug)).limit(1);
  if (!drive) return c.json({ error: "Not found" }, 404);

  const stops = await db
    .select()
    .from(driveListStops)
    .where(eq(driveListStops.driveListId, drive.id))
    .orderBy(asc(driveListStops.sortOrder), asc(driveListStops.id))
    .all();
  // Fill any missing stop coords from the linked showroom so the map plots and
  // navigation works even for stops created without their own lat/lng.
  await fillMissingStopCoords(db, stops);

  return c.json({ ...drive, notes: parseDriveNotes(drive.notes), stops });
});

/**
 * PATCH /api/drive-lists/:slug — set/clear THE active drive.
 *
 * `{ isActive: true }` makes this the one active drive (clearing whichever was
 * active before, in the same batch); `{ isActive: false }` leaves NO drive
 * active. Backs the toggle on each card at `/admin/shopping/drives`.
 */
driveListsRouter.patch("/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  const body = (await c.req.json().catch(() => ({}))) as {
    isActive?: boolean;
    title?: string;
    description?: string | null;
    notes?: string[] | null;
    status?: "draft" | "active" | "completed" | "archived";
  };

  // Field edits (title/description/notes/status) are a separate concern from
  // activation. `status` here is a lifecycle label only and never flips the
  // active pointer — activation stays on the gated isActive path below.
  const hasFieldEdit =
    body.title !== undefined ||
    body.description !== undefined ||
    body.notes !== undefined ||
    body.status !== undefined;
  if (body.isActive === undefined && hasFieldEdit) {
    const res = await updateDriveList(db, {
      slug,
      title: body.title,
      description: body.description,
      notes: body.notes,
      status: body.status,
    });
    if (!res) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true, id: res.id, slug: res.slug });
  }

  if (typeof body.isActive !== "boolean") {
    return c.json({ error: "`isActive` (boolean) or an editable field is required" }, 400);
  }
  const [drive] = await db
    .select({ id: driveLists.id })
    .from(driveLists)
    .where(eq(driveLists.slug, c.req.param("slug")))
    .limit(1);
  if (!drive) return c.json({ error: "Not found" }, 404);

  // A drive list may only be ACTIVATED inside the daytime streaming window
  // (default 07:00–20:00 Pacific) — the streaming DO is time-boxed, so activation
  // outside it would only ever poll. Deactivation is always allowed.
  if (body.isActive) {
    const control = await getStreamControl(c.env);
    if (!isWithinStreamWindow(new Date(), control)) {
      return c.json(
        {
          error: `A drive can only be made active between ${String(control.windowStartHour).padStart(2, "0")}:00 and ${String(control.windowEndHour).padStart(2, "0")}:00 Pacific.`,
          windowStartHour: control.windowStartHour,
          windowEndHour: control.windowEndHour,
        },
        409,
      );
    }
  }

  await setActiveDrive(db, body.isActive ? drive.id : null);

  // Match the streaming DO to the new active state (fire-and-forget). The DO's own
  // lifecycle guard is the source of truth; this just makes start/stop prompt
  // instead of waiting for the next alarm tick.
  try {
    const stub = c.env.TESLA_STREAM.get(c.env.TESLA_STREAM.idFromName("singleton"));
    c.executionCtx.waitUntil(
      stub
        .fetch(body.isActive ? "https://do/start" : "https://do/stop", { method: "POST" })
        // Drain the DO response body so the subrequest stream doesn't linger.
        // Return the cancel promise so waitUntil actually tracks it to completion.
        .then((res) => res.body?.cancel())
        .catch((err) => console.error("[drive-lists] tesla stream signal failed:", err)),
    );
  } catch (err) {
    console.error("[drive-lists] tesla stream stub failed:", err);
  }

  return c.json({ ok: true, isActive: body.isActive });
});

/**
 * PATCH /api/drive-lists/:slug/stops/:stopId — edit a stop.
 *
 * Backwards-compatible with the `{ visited }` check-off, but now accepts any of
 * the stop's editable fields (name/address/hours/skipped/sortOrder/…) via the
 * shared `updateDriveStop` service.
 */
driveListsRouter.patch("/:slug/stops/:stopId", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  const stopId = Number(c.req.param("stopId"));
  if (!Number.isFinite(stopId)) return c.json({ error: "Invalid stop id" }, 400);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body === null || typeof body !== "object" || Object.keys(body).length === 0) {
    return c.json({ error: "At least one editable stop field is required" }, 400);
  }

  // Resolve the drive first so a stop can't be edited through the wrong slug.
  const [drive] = await db
    .select({ id: driveLists.id })
    .from(driveLists)
    .where(eq(driveLists.slug, slug))
    .limit(1);
  if (!drive) return c.json({ error: "Not found" }, 404);

  const [stop] = await db
    .select({ id: driveListStops.id, driveListId: driveListStops.driveListId })
    .from(driveListStops)
    .where(eq(driveListStops.id, stopId))
    .limit(1);
  if (!stop || stop.driveListId !== drive.id) {
    return c.json({ error: "Stop not found on this drive" }, 404);
  }

  // The MCP tool is the zod-validated surface; this admin API trusts the caller
  // and forwards recognized keys (the service ignores anything it doesn't read).
  await updateDriveStop(db, stopId, body as DriveStopUpdateInput);

  // Recompute completion for the response. Progress alone decides which landing
  // tab the drive falls in (pending / in progress / finished), so checking a
  // stop off no longer rewrites `status` and never touches the active slot.
  const [counts] = await db
    .select({
      total: sql<number>`count(${driveListStops.id})`,
      visited: sql<number>`coalesce(sum(${driveListStops.visited}), 0)`,
    })
    .from(driveListStops)
    .where(eq(driveListStops.driveListId, drive.id));
  const total = Number(counts?.total ?? 0);
  const visitedCount = Number(counts?.visited ?? 0);

  await db.update(driveLists).set({ updatedAt: new Date() }).where(eq(driveLists.id, drive.id)).run();

  return c.json({ ok: true, visited: body.visited, stopCount: total, visitedCount });
});

/** POST /api/drive-lists/:slug/stops — append one or more stops to a drive. */
driveListsRouter.post("/:slug/stops", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  const body = (await c.req.json().catch(() => ({}))) as { stops?: DriveStopInput[] };
  if (!Array.isArray(body.stops) || body.stops.length === 0) {
    return c.json({ error: "`stops` (non-empty array) is required" }, 400);
  }
  const res = await addDriveStops(db, { slug }, body.stops);
  if (!res) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true, ...res }, 201);
});

/** DELETE /api/drive-lists/:slug/stops/:stopId — remove a stop from a drive. */
driveListsRouter.delete("/:slug/stops/:stopId", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  const stopId = Number(c.req.param("stopId"));
  if (!Number.isFinite(stopId)) return c.json({ error: "Invalid stop id" }, 400);

  const [drive] = await db
    .select({ id: driveLists.id })
    .from(driveLists)
    .where(eq(driveLists.slug, slug))
    .limit(1);
  if (!drive) return c.json({ error: "Not found" }, 404);

  const [stop] = await db
    .select({ driveListId: driveListStops.driveListId })
    .from(driveListStops)
    .where(eq(driveListStops.id, stopId))
    .limit(1);
  if (!stop || stop.driveListId !== drive.id) {
    return c.json({ error: "Stop not found on this drive" }, 404);
  }

  await removeDriveStop(db, stopId);
  return c.json({ ok: true, stopId, driveListId: drive.id });
});

/** Resolve a drive id from its slug, or null. */
async function driveIdBySlug(db: ReturnType<typeof drizzle>, slug: string): Promise<number | null> {
  const [drive] = await db
    .select({ id: driveLists.id })
    .from(driveLists)
    .where(eq(driveLists.slug, slug))
    .limit(1);
  return drive?.id ?? null;
}

/** GET /api/drive-lists/:slug/notes — drive-global + per-stop notes. */
driveListsRouter.get("/:slug/notes", async (c) => {
  const db = drizzle(c.env.DB);
  const driveId = await driveIdBySlug(db, c.req.param("slug"));
  if (driveId == null) return c.json({ error: "Not found" }, 404);
  return c.json(await listDriveNotes(db, driveId));
});

/** POST /api/drive-lists/:slug/notes — create a note ({ body, stopId?, source? }). */
driveListsRouter.post("/:slug/notes", async (c) => {
  const db = drizzle(c.env.DB);
  const driveId = await driveIdBySlug(db, c.req.param("slug"));
  if (driveId == null) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as {
    body?: string;
    stopId?: number | null;
    source?: "user" | "ai";
  };
  if (!body.body?.trim()) return c.json({ error: "`body` is required" }, 400);
  const note = await createDriveNote(db, driveId, {
    body: body.body,
    stopId: body.stopId ?? null,
    source: body.source,
  });
  return c.json({ ok: true, note }, 201);
});

/** PATCH /api/drive-lists/:slug/notes/:noteId — set/clear read (collapsed) state. */
driveListsRouter.patch("/:slug/notes/:noteId", async (c) => {
  const db = drizzle(c.env.DB);
  const driveId = await driveIdBySlug(db, c.req.param("slug"));
  if (driveId == null) return c.json({ error: "Not found" }, 404);
  const noteId = Number(c.req.param("noteId"));
  if (!Number.isFinite(noteId)) return c.json({ error: "Invalid note id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { read?: boolean };
  if (typeof body.read !== "boolean") return c.json({ error: "`read` (boolean) is required" }, 400);

  const [note] = await db
    .select({ driveListId: driveListNotes.driveListId })
    .from(driveListNotes)
    .where(eq(driveListNotes.id, noteId))
    .limit(1);
  if (!note || note.driveListId !== driveId) {
    return c.json({ error: "Note not found on this drive" }, 404);
  }
  await setDriveNoteRead(db, noteId, body.read);
  return c.json({ ok: true, read: body.read });
});

/** DELETE /api/drive-lists/:slug/notes/:noteId — delete a note. */
driveListsRouter.delete("/:slug/notes/:noteId", async (c) => {
  const db = drizzle(c.env.DB);
  const driveId = await driveIdBySlug(db, c.req.param("slug"));
  if (driveId == null) return c.json({ error: "Not found" }, 404);
  const noteId = Number(c.req.param("noteId"));
  if (!Number.isFinite(noteId)) return c.json({ error: "Invalid note id" }, 400);

  const [note] = await db
    .select({ driveListId: driveListNotes.driveListId })
    .from(driveListNotes)
    .where(eq(driveListNotes.id, noteId))
    .limit(1);
  if (!note || note.driveListId !== driveId) {
    return c.json({ error: "Note not found on this drive" }, 404);
  }
  await deleteDriveNote(db, noteId);
  return c.json({ ok: true });
});

/**
 * POST /api/drive-lists/:slug/stops/:stopId/rating — rate the stop's showroom.
 *
 * Writes to the canonical showroom visit log (the stop's linked showroom's
 * latest-visit `rating` + `ratingContext*`, plus a `store_notes` visit note) —
 * the same path as the `record_showroom_visit` MCP tool. A stop with no linked
 * showroom cannot be rated (400). `deferFeedback` instead files an AI follow-up
 * note on the stop for after the drive.
 */
driveListsRouter.post("/:slug/stops/:stopId/rating", async (c) => {
  const db = drizzle(c.env.DB);
  const driveId = await driveIdBySlug(db, c.req.param("slug"));
  if (driveId == null) return c.json({ error: "Not found" }, 404);
  const stopId = Number(c.req.param("stopId"));
  if (!Number.isFinite(stopId)) return c.json({ error: "Invalid stop id" }, 400);

  const body = (await c.req.json().catch(() => ({}))) as {
    rating?: number;
    contextMarkdown?: string;
    deferFeedback?: boolean;
  };
  if (!Number.isInteger(body.rating) || body.rating! < 1 || body.rating! > 5) {
    return c.json({ error: "`rating` must be an integer 1–5" }, 400);
  }

  const [stop] = await db
    .select({ id: driveListStops.id, driveListId: driveListStops.driveListId, showroomStoreId: driveListStops.showroomStoreId, name: driveListStops.name })
    .from(driveListStops)
    .where(eq(driveListStops.id, stopId))
    .limit(1);
  if (!stop || stop.driveListId !== driveId) {
    return c.json({ error: "Stop not found on this drive" }, 404);
  }
  if (stop.showroomStoreId == null) {
    return c.json({ error: "This stop is not linked to a registered showroom, so it can't be rated." }, 400);
  }

  const context = body.contextMarkdown?.trim() || `Visit — ${body.rating}★ (from drive)`;
  // Canonical visit log: latest-visit rating on the store + a store note.
  await db
    .update(showroomStores)
    .set({ rating: body.rating, ratingContextMarkdown: context, ratingContextHtml: context })
    .where(eq(showroomStores.id, stop.showroomStoreId))
    .run();
  await db
    .insert(storeNotes)
    .values({
      storeId: stop.showroomStoreId,
      title: `Visit — ${body.rating}★`,
      contentMarkdown: context,
      note: context,
    })
    .run();

  // Deferred feedback: an AI follow-up note pinned to this stop, dated.
  let followUpNote = null;
  if (body.deferFeedback) {
    const date = new Date().toISOString().slice(0, 10);
    followUpNote = await createDriveNote(db, driveId, {
      body: `AI: follow up on feedback after drive list is completed ${date}`,
      stopId,
      source: "ai",
    });
  }
  return c.json({ ok: true, rating: body.rating, showroomStoreId: stop.showroomStoreId, followUpNote });
});

export default driveListsRouter;
