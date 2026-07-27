/**
 * @fileoverview Visit Logs REST CRUD (0032 V2) — `/api/showroom-visit-logs`.
 *
 * HTTP surface over the shared visit-log service (`services/showroom/visit-log.ts`),
 * which the MCP `visits` tools also call — so the human surface and the voice loop
 * never drift. Admin-gated (single-operator app; the gate is the authz).
 */
import {
  createVisitLog,
  deleteVisitLog,
  getVisitLog,
  GPS_SOURCES,
  listVisitLogs,
  updateVisitLog,
  VISIT_STATUSES,
  VISIT_TYPES,
  type VisitLogWrite,
} from "@backend/services/showroom/visit-log";
import { isRequestAuthenticated } from "@backend/utils/access";
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

/** GET /api/showroom-visit-logs?status=pending|completed&storeId=&limit= */
showroomVisitLogsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const statusParam = c.req.query("status");
  const storeIdRaw = c.req.query("storeId");
  const storeId = storeIdRaw ? Number.parseInt(storeIdRaw, 10) : null;
  const limit = Number.parseInt(c.req.query("limit") || "200", 10) || 200;
  const status = statusParam === "pending" || statusParam === "completed" ? statusParam : undefined;
  const visits = await listVisitLogs(db, { status, storeId, limit });
  return c.json({ count: visits.length, visits });
});

/** GET /api/showroom-visit-logs/:id */
showroomVisitLogsRouter.get("/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
  const visit = await getVisitLog(drizzle(c.env.DB), id);
  if (!visit) return c.json({ error: "Not found" }, 404);
  return c.json({ visit });
});

const isoOrEpoch = z.union([z.string(), z.number()]);
const toDate = (v: string | number | undefined): Date | undefined =>
  v == null ? undefined : new Date(typeof v === "number" ? v : Date.parse(v));

const writeBody = z.object({
  storeId: z.number().int().positive().nullable().optional(),
  driveListId: z.number().int().positive().nullable().optional(),
  stopId: z.number().int().positive().nullable().optional(),
  status: z.enum(VISIT_STATUSES).optional(),
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

/** Map a validated body to the service's VisitLogWrite (dates parsed). */
function toWrite(b: z.infer<typeof writeBody>): VisitLogWrite {
  const w: VisitLogWrite = { ...b, arrivalAt: undefined, departureAt: undefined };
  if (b.arrivalAt !== undefined) w.arrivalAt = toDate(b.arrivalAt);
  if (b.departureAt !== undefined) w.departureAt = toDate(b.departureAt) ?? null;
  return w;
}

/** POST /api/showroom-visit-logs — manual/new (human) or cold create. Defaults to DRAFT. */
showroomVisitLogsRouter.post("/", async (c) => {
  const parsed = writeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid body", detail: parsed.error.issues }, 400);
  const id = await createVisitLog(drizzle(c.env.DB), toWrite(parsed.data));
  return c.json({ ok: true, id }, 201);
});

/** PATCH /api/showroom-visit-logs/:id — update / finalize (status → SUBMITTED). */
showroomVisitLogsRouter.patch("/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
  const parsed = writeBody.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid body", detail: parsed.error.issues }, 400);
  const ok = await updateVisitLog(drizzle(c.env.DB), id, toWrite(parsed.data));
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true, id });
});

/** DELETE /api/showroom-visit-logs/:id */
showroomVisitLogsRouter.delete("/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
  await deleteVisitLog(drizzle(c.env.DB), id);
  return c.json({ ok: true, id });
});

export default showroomVisitLogsRouter;
