/**
 * @fileoverview Admin API for Showroom Drive Lists.
 *
 * `GET/PATCH /api/drive-lists*` — admin-gated reads + the drive check-off,
 * backing the `/admin/shopping/drives` landing page and the
 * `/admin/shopping/drives/[slug]` viewport. Drive lists are CREATED through the
 * `create_drive_list` MCP tool (from a chat), not here; these routes cover
 * browsing, opening a drive, and toggling a stop's visited state as you drive.
 *
 * Mounted at `/api/drive-lists`.
 */
import { driveListStops, driveLists } from "@backend/db";
import { isRequestAuthenticated } from "@backend/utils/access";
import { asc, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const driveListsRouter = new Hono<{ Bindings: Env }>();

/** Gate every route behind the admin cookie / bearer auth. */
driveListsRouter.use("*", async (c, next) => {
  if (!(await isRequestAuthenticated(c.req.raw, c.env))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** GET /api/drive-lists — landing list, newest-first, with completion counts. */
driveListsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      id: driveLists.id,
      slug: driveLists.slug,
      title: driveLists.title,
      description: driveLists.description,
      status: driveLists.status,
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

  return c.json({
    count: rows.length,
    driveLists: rows.map((r) => ({
      ...r,
      stopCount: Number(r.stopCount),
      visitedCount: Number(r.visitedCount),
    })),
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

  return c.json({ ...drive, stops });
});

/** PATCH /api/drive-lists/:slug/stops/:stopId — toggle/set a stop's visited state. */
driveListsRouter.patch("/:slug/stops/:stopId", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  const stopId = Number(c.req.param("stopId"));
  if (!Number.isFinite(stopId)) return c.json({ error: "Invalid stop id" }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { visited?: boolean };
  if (typeof body.visited !== "boolean") {
    return c.json({ error: "`visited` (boolean) is required" }, 400);
  }

  // Resolve the drive first so a stop can't be toggled through the wrong slug.
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

  await db
    .update(driveListStops)
    .set({ visited: body.visited, visitedAt: body.visited ? new Date() : null })
    .where(eq(driveListStops.id, stopId))
    .run();
  await db
    .update(driveLists)
    .set({ updatedAt: new Date() })
    .where(eq(driveLists.id, drive.id))
    .run();

  return c.json({ ok: true, visited: body.visited });
});

export default driveListsRouter;
