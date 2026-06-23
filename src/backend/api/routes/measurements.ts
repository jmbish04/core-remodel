/**
 * @fileoverview Measurements API — master, as-is dimensional record for the house.
 *
 * 0006 PHASE 1.  CRUD + list/filter/search over the `measurements` table.
 *
 * Endpoints:
 *   GET    /api/measurements        list (filter by roomId / floorId / elementType / source, search q)
 *   GET    /api/measurements/:id    single measurement
 *   POST   /api/measurements        create
 *   PATCH  /api/measurements/:id    update (partial; explicit null clears a field)
 *   DELETE /api/measurements/:id    hard delete (master data has no soft-delete column)
 *
 * Conventions (matches the repo's truth-table.ts template):
 *   - OpenAPIHono + createRoute, Zod v4 via `@hono/zod-openapi`.
 *   - Request/response Zod schemas + DTO mapping live in `./measurements.schemas`.
 *   - `span` and `metadata` travel as JSON objects and are stored as JSON strings.
 *   - timestamps are emitted as unix seconds.
 *
 * Rule: only ACTIVE rooms (rooms.is_active = true) are valid `roomId` targets; the
 * create/update handlers reject inactive or unknown rooms with 400.  `floorId`, when
 * provided, must reference an existing floor.
 *
 * Auth: intentionally ungated for 0006 (owner directive: "don't worry about auth for
 * now").  `/api/measurements` does not sit under any `requireAccessAuth` prefix.
 */

import {
  type MeasurementElementType,
  type MeasurementSource,
  floors,
  measurements,
  rooms,
} from "@backend/db";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  ErrorSchema,
  ListQuerySchema,
  MeasurementCreateSchema,
  MeasurementSchema,
  MeasurementUpdateSchema,
  rowToDto,
} from "./measurements.schemas";

// ---------------------------------------------------------------------------
// Validation helpers (room/floor target rules)
// ---------------------------------------------------------------------------

/**
 * Validate that a roomId points to an ACTIVE room.
 * Returns an error code string when invalid, or null when ok.
 */
async function validateRoomTarget(
  db: ReturnType<typeof drizzle>,
  roomId: number,
): Promise<"room_not_found" | "room_inactive" | null> {
  const room = await db
    .select({ id: rooms.id, isActive: rooms.isActive })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .get();
  if (!room) return "room_not_found";
  if (!room.isActive) return "room_inactive";
  return null;
}

/** Validate that a floorId references an existing floor. */
async function floorExists(db: ReturnType<typeof drizzle>, floorId: number): Promise<boolean> {
  const floor = await db.select({ id: floors.id }).from(floors).where(eq(floors.id, floorId)).get();
  return Boolean(floor);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const measurementsRouter = new OpenAPIHono<{ Bindings: Env }>();

// ---------- LIST ----------
measurementsRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    request: { query: ListQuerySchema },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              measurements: z.array(MeasurementSchema),
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
            }),
          },
        },
        description: "Measurement list",
      },
    },
    tags: ["measurements"],
  }),
  async (c) => {
    const q = c.req.valid("query");
    const db = drizzle(c.env.DB);

    const elementTypes = q.elementType
      ? q.elementType.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const sources = q.source ? q.source.split(",").map((s) => s.trim()).filter(Boolean) : [];

    const conditions = [];
    if (q.roomId !== undefined) conditions.push(eq(measurements.roomId, q.roomId));
    if (q.floorId !== undefined) conditions.push(eq(measurements.floorId, q.floorId));
    if (elementTypes.length)
      conditions.push(inArray(measurements.elementType, elementTypes as MeasurementElementType[]));
    if (sources.length)
      conditions.push(inArray(measurements.source, sources as MeasurementSource[]));
    if (q.q) {
      // SQLite LIKE is case-insensitive for ASCII, so no lower() wrapper is needed.
      const pat = `%${q.q}%`;
      conditions.push(
        or(
          like(measurements.label, pat),
          like(measurements.notes, pat),
          like(measurements.accuracyNote, pat),
          like(measurements.elementType, pat),
        )!,
      );
    }
    const whereExpr = conditions.length ? and(...conditions) : undefined;

    const sortCol = {
      element_type: measurements.elementType,
      label: measurements.label,
      room_id: measurements.roomId,
      datetime_created: measurements.datetimeCreated,
      datetime_updated: measurements.datetimeUpdated,
    }[q.sort];

    const rows = await db
      .select()
      .from(measurements)
      .where(whereExpr)
      .orderBy(q.order === "asc" ? asc(sortCol) : desc(sortCol))
      .limit(q.limit)
      .offset(q.offset)
      .all();

    const totalRows = await db
      .select({ c: sql<number>`count(*)` })
      .from(measurements)
      .where(whereExpr)
      .all();

    return c.json({
      measurements: rows.map(rowToDto),
      total: Number(totalRows[0]?.c ?? 0),
      limit: q.limit,
      offset: q.offset,
    });
  },
);

// ---------- GET ONE ----------
measurementsRouter.openapi(
  createRoute({
    method: "get",
    path: "/{id}",
    request: { params: z.object({ id: z.coerce.number().int().positive() }) },
    responses: {
      200: { content: { "application/json": { schema: MeasurementSchema } }, description: "Measurement" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
    tags: ["measurements"],
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const row = await db.select().from(measurements).where(eq(measurements.id, id)).get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(rowToDto(row), 200);
  },
);

// ---------- CREATE ----------
measurementsRouter.openapi(
  createRoute({
    method: "post",
    path: "/",
    request: { body: { content: { "application/json": { schema: MeasurementCreateSchema } } } },
    responses: {
      201: { content: { "application/json": { schema: MeasurementSchema } }, description: "Created" },
      400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid room/floor target" },
    },
    tags: ["measurements"],
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);

    // Only active rooms are valid targets.
    if (typeof body.roomId === "number") {
      const roomError = await validateRoomTarget(db, body.roomId);
      if (roomError) return c.json({ error: roomError }, 400);
    }
    if (typeof body.floorId === "number" && !(await floorExists(db, body.floorId))) {
      return c.json({ error: "floor_not_found" }, 400);
    }

    const [created] = await db
      .insert(measurements)
      .values({
        roomId: body.roomId ?? null,
        floorId: body.floorId ?? null,
        elementType: body.elementType,
        label: body.label ?? null,
        lengthFeet: body.lengthFeet ?? null,
        lengthInches: body.lengthInches ?? null,
        widthFeet: body.widthFeet ?? null,
        widthInches: body.widthInches ?? null,
        heightFeet: body.heightFeet ?? null,
        heightInches: body.heightInches ?? null,
        spanJson: body.span != null ? JSON.stringify(body.span) : null,
        areaSqFt: body.areaSqFt ?? null,
        quantity: body.quantity ?? 1,
        source: body.source ?? "estimated",
        isApproximate: body.isApproximate ?? true,
        accuracyNote: body.accuracyNote ?? null,
        notes: body.notes ?? null,
        metadata: body.metadata != null ? JSON.stringify(body.metadata) : null,
      })
      .returning();

    return c.json(rowToDto(created), 201);
  },
);

// ---------- UPDATE ----------
measurementsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/{id}",
    request: {
      params: z.object({ id: z.coerce.number().int().positive() }),
      body: { content: { "application/json": { schema: MeasurementUpdateSchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: MeasurementSchema } }, description: "Updated" },
      400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid room/floor target" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
    tags: ["measurements"],
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);

    const prev = await db.select().from(measurements).where(eq(measurements.id, id)).get();
    if (!prev) return c.json({ error: "not_found" }, 404);

    // Validate a newly-provided room/floor target (skip when clearing to null).
    if (typeof body.roomId === "number") {
      const roomError = await validateRoomTarget(db, body.roomId);
      if (roomError) return c.json({ error: roomError }, 400);
    }
    if (typeof body.floorId === "number" && !(await floorExists(db, body.floorId))) {
      return c.json({ error: "floor_not_found" }, 400);
    }

    // Merge semantics: `key !== undefined` distinguishes "omitted" (keep) from
    // an explicit null (clear).  span/metadata re-serialize to JSON strings.
    const keep = <T>(next: T | undefined, prior: T): T => (next !== undefined ? next : prior);

    const [updated] = await db
      .update(measurements)
      .set({
        roomId: keep(body.roomId, prev.roomId),
        floorId: keep(body.floorId, prev.floorId),
        elementType: keep(body.elementType, prev.elementType),
        label: keep(body.label, prev.label),
        lengthFeet: keep(body.lengthFeet, prev.lengthFeet),
        lengthInches: keep(body.lengthInches, prev.lengthInches),
        widthFeet: keep(body.widthFeet, prev.widthFeet),
        widthInches: keep(body.widthInches, prev.widthInches),
        heightFeet: keep(body.heightFeet, prev.heightFeet),
        heightInches: keep(body.heightInches, prev.heightInches),
        spanJson:
          body.span !== undefined ? (body.span === null ? null : JSON.stringify(body.span)) : prev.spanJson,
        areaSqFt: keep(body.areaSqFt, prev.areaSqFt),
        quantity: keep(body.quantity, prev.quantity),
        source: keep(body.source, prev.source),
        isApproximate: keep(body.isApproximate, prev.isApproximate),
        accuracyNote: keep(body.accuracyNote, prev.accuracyNote),
        notes: keep(body.notes, prev.notes),
        metadata:
          body.metadata !== undefined
            ? body.metadata === null
              ? null
              : JSON.stringify(body.metadata)
            : prev.metadata,
        datetimeUpdated: new Date(),
      })
      .where(eq(measurements.id, id))
      .returning();

    return c.json(rowToDto(updated), 200);
  },
);

// ---------- DELETE ----------
measurementsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    request: { params: z.object({ id: z.coerce.number().int().positive() }) },
    responses: {
      200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "Deleted" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
    tags: ["measurements"],
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const existing = await db
      .select({ id: measurements.id })
      .from(measurements)
      .where(eq(measurements.id, id))
      .get();
    if (!existing) return c.json({ error: "not_found" }, 404);
    await db.delete(measurements).where(eq(measurements.id, id)).run();
    return c.json({ ok: true }, 200);
  },
);
