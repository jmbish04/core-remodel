/**
 * @fileoverview Visit Logs REST CRUD (0032 V2a) — `/api/showroom-visit-logs`.
 *
 * The human + API surface over `showroom_visit_log` (the receipts drawer). Every
 * route here has an MCP twin (V2b) through the same table, per the parity rule.
 * Admin-gated by the middleware below (single-operator app; the gate is the authz).
 *
 * Statuses: pending = anything not yet SUBMITTED (AI_STAGED / TESLA_SOFT_ARRIVAL /
 * TESLA_STAGED / DRAFT); completed = SUBMITTED. The store name is always JOINed —
 * never denormalized onto the log row.
 */
import { showroomStores, showroomVisitLog } from "@backend/db";
import { isRequestAuthenticated } from "@backend/utils/access";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

const showroomVisitLogsRouter = new Hono<{ Bindings: Env }>();

showroomVisitLogsRouter.use("*", async (c, next) => {
  if (!(await isRequestAuthenticated(c.req.raw, c.env))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

const VISIT_TYPES = [
  "SOFT_ARRIVAL",
  "BROWSED_NO_CONTACT",
  "BRIEF_NO_HELP",
  "FULL_SESSION",
  "APPOINTMENT",
] as const;
const STATUSES = ["AI_STAGED", "TESLA_SOFT_ARRIVAL", "TESLA_STAGED", "DRAFT", "SUBMITTED"] as const;
const PENDING_STATUSES = ["AI_STAGED", "TESLA_SOFT_ARRIVAL", "TESLA_STAGED", "DRAFT"] as const;
const GPS_SOURCES = ["tesla-telemetry", "tesla-poll", "tesla-webhook", "device", "phone", "ai", "manual"] as const;

/** Select shape with the store name JOINed (never denormalized). */
const selectCols = {
  id: showroomVisitLog.id,
  storeId: showroomVisitLog.storeId,
  storeName: showroomStores.name,
  driveListId: showroomVisitLog.driveListId,
  stopId: showroomVisitLog.stopId,
  status: showroomVisitLog.status,
  visitType: showroomVisitLog.visitType,
  rating: showroomVisitLog.rating,
  notesMarkdown: showroomVisitLog.notesMarkdown,
  notesHtml: showroomVisitLog.notesHtml,
  arrivalAt: showroomVisitLog.arrivalAt,
  departureAt: showroomVisitLog.departureAt,
  dwellSeconds: showroomVisitLog.dwellSeconds,
  gpsSource: showroomVisitLog.gpsSource,
  latitude: showroomVisitLog.latitude,
  longitude: showroomVisitLog.longitude,
  matchDistanceM: showroomVisitLog.matchDistanceM,
  softArrivalId: showroomVisitLog.softArrivalId,
  createdAt: showroomVisitLog.createdAt,
  updatedAt: showroomVisitLog.updatedAt,
} as const;

/** GET /api/showroom-visit-logs?status=pending|completed&storeId=&limit= */
showroomVisitLogsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const statusParam = c.req.query("status");
  const storeIdRaw = c.req.query("storeId");
  const storeId = storeIdRaw ? Number.parseInt(storeIdRaw, 10) : null;
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") || "200", 10) || 200, 1), 500);

  const conds = [];
  if (statusParam === "pending") conds.push(inArray(showroomVisitLog.status, [...PENDING_STATUSES]));
  else if (statusParam === "completed") conds.push(eq(showroomVisitLog.status, "SUBMITTED"));
  if (storeId && Number.isFinite(storeId)) conds.push(eq(showroomVisitLog.storeId, storeId));

  const rows = await db
    .select(selectCols)
    .from(showroomVisitLog)
    .leftJoin(showroomStores, eq(showroomVisitLog.storeId, showroomStores.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(showroomVisitLog.createdAt))
    .limit(limit);

  return c.json({ count: rows.length, visits: rows });
});

/** GET /api/showroom-visit-logs/:id */
showroomVisitLogsRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
  const [row] = await db
    .select(selectCols)
    .from(showroomVisitLog)
    .leftJoin(showroomStores, eq(showroomVisitLog.storeId, showroomStores.id))
    .where(eq(showroomVisitLog.id, id))
    .limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ visit: row });
});

const isoOrEpoch = z.union([z.string(), z.number()]);
const toDate = (v: string | number | undefined): Date | undefined =>
  v == null ? undefined : new Date(typeof v === "number" ? v : Date.parse(v));

const createBody = z.object({
  storeId: z.number().int().positive().nullable().optional(),
  driveListId: z.number().int().positive().nullable().optional(),
  stopId: z.number().int().positive().nullable().optional(),
  status: z.enum(STATUSES).optional(),
  visitType: z.enum(VISIT_TYPES).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  notesMarkdown: z.string().nullable().optional(),
  notesHtml: z.string().nullable().optional(),
  gpsSource: z.enum(GPS_SOURCES).nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  arrivalAt: isoOrEpoch.optional(),
  departureAt: isoOrEpoch.optional(),
});

/** POST /api/showroom-visit-logs — manual/new (human) or cold create. Defaults to DRAFT. */
showroomVisitLogsRouter.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid body", detail: parsed.error.issues }, 400);
  const b = parsed.data;

  const arrival = toDate(b.arrivalAt) ?? new Date();
  const departure = toDate(b.departureAt);
  const dwellSeconds =
    departure && arrival ? Math.max(0, Math.round((departure.getTime() - arrival.getTime()) / 1000)) : null;

  const [row] = await db
    .insert(showroomVisitLog)
    .values({
      storeId: b.storeId ?? null,
      driveListId: b.driveListId ?? null,
      stopId: b.stopId ?? null,
      status: b.status ?? "DRAFT",
      visitType: b.visitType ?? "SOFT_ARRIVAL",
      rating: b.rating ?? null,
      notesMarkdown: b.notesMarkdown ?? null,
      notesHtml: b.notesHtml ?? null,
      gpsSource: b.gpsSource ?? "manual",
      latitude: b.latitude ?? null,
      longitude: b.longitude ?? null,
      arrivalAt: arrival,
      departureAt: departure ?? null,
      dwellSeconds,
    })
    .returning({ id: showroomVisitLog.id });

  return c.json({ ok: true, id: row?.id }, 201);
});

const updateBody = createBody.partial();

/** PATCH /api/showroom-visit-logs/:id — update / finalize (status → SUBMITTED). */
showroomVisitLogsRouter.patch("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
  const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid body", detail: parsed.error.issues }, 400);
  const b = parsed.data;

  const [existing] = await db
    .select({ id: showroomVisitLog.id, arrivalAt: showroomVisitLog.arrivalAt })
    .from(showroomVisitLog)
    .where(eq(showroomVisitLog.id, id))
    .limit(1);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["storeId", "driveListId", "stopId", "status", "visitType", "rating", "notesMarkdown", "notesHtml", "gpsSource", "latitude", "longitude"] as const) {
    if (k in b) patch[k] = b[k];
  }
  const arrival = toDate(b.arrivalAt);
  const departure = toDate(b.departureAt);
  if (arrival) patch.arrivalAt = arrival;
  if (departure) patch.departureAt = departure;
  // Recompute dwell when both ends are known (either supplied here or arrival on the row).
  const arrForDwell = arrival ?? existing.arrivalAt ?? null;
  if (departure && arrForDwell) {
    patch.dwellSeconds = Math.max(0, Math.round((departure.getTime() - arrForDwell.getTime()) / 1000));
  }

  await db.update(showroomVisitLog).set(patch).where(eq(showroomVisitLog.id, id)).run();
  return c.json({ ok: true, id });
});

/** DELETE /api/showroom-visit-logs/:id */
showroomVisitLogsRouter.delete("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
  await db.delete(showroomVisitLog).where(eq(showroomVisitLog.id, id)).run();
  return c.json({ ok: true, id });
});

export default showroomVisitLogsRouter;
