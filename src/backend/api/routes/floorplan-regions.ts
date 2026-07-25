/**
 * @fileoverview Floorplan region config API — `/api/floorplan-regions`.
 *
 * Lets an admin draw each room's rectangle on the floorplan image (see the
 * `/admin/designs/floorplan-regions` page). Saving a region crops the static
 * whole-house floorplan to that rectangle via Cloudflare Images and stores the
 * cropped token on the room, so the Workshop's furnish-this-plan recipe can run
 * per-room instead of whole-house (docs/0014_ai_photo_workshop).
 *
 * Region coordinates are percents (0–100) of the floorplan image.
 */
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { rooms } from "@backend/db";

import { cropAndUploadCfImage } from "../../services/render/cf-images";

export const floorplanRegionsRouter = new OpenAPIHono<{ Bindings: Env }>();

/** The static whole-house floorplan served from the Worker's /public. */
const FLOOR_PLAN_ASSET_PATH = "/floorplans/126colby-listing-floorplan.jpg";

const RegionSchema = z
  .object({
    xPct: z.number().min(0).max(100),
    yPct: z.number().min(0).max(100),
    wPct: z.number().min(0.5).max(100),
    hPct: z.number().min(0.5).max(100),
  })
  .refine((r) => r.xPct + r.wPct <= 100.5 && r.yPct + r.hPct <= 100.5, {
    message: "Region extends past the floorplan edge",
  });

const RoomRegionSchema = z.object({
  id: z.number(),
  name: z.string(),
  floorplanFloorKey: z.string().nullable(),
  floorplanXPct: z.number().nullable(),
  floorplanYPct: z.number().nullable(),
  region: RegionSchema.nullable(),
  cropUrl: z.string().nullable(),
});

/** Row → the region wire shape (assembles the bbox object or null). */
function serializeRoomRegion(row: typeof rooms.$inferSelect) {
  const hasRegion =
    row.floorplanBboxXPct != null &&
    row.floorplanBboxYPct != null &&
    row.floorplanBboxWPct != null &&
    row.floorplanBboxHPct != null;
  return {
    id: row.id,
    name: row.roomName ?? row.roomCode ?? `Room ${row.id}`,
    floorplanFloorKey: row.floorplanFloorKey,
    floorplanXPct: row.floorplanXPct,
    floorplanYPct: row.floorplanYPct,
    region: hasRegion
      ? {
          xPct: row.floorplanBboxXPct as number,
          yPct: row.floorplanBboxYPct as number,
          wPct: row.floorplanBboxWPct as number,
          hPct: row.floorplanBboxHPct as number,
        }
      : null,
    cropUrl: row.floorplanCropCfImageId
      ? `https://imagedelivery.net/${row.floorplanCropCfImageId}/public`
      : null,
  };
}

// ─── GET /api/floorplan-regions — all rooms placed on a floorplan ────────────
floorplanRegionsRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: {
      200: {
        description: "Rooms with their floorplan dot + region",
        content: {
          "application/json": {
            schema: z.object({
              floorplanImageUrl: z.string(),
              rooms: z.array(RoomRegionSchema),
            }),
          },
        },
      },
    },
    summary: "List rooms with floorplan dots + regions",
    operationId: "listFloorplanRegions",
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(rooms).where(eq(rooms.isActive, true)).all();
    const placed = rows
      .filter((r) => r.floorplanFloorKey != null)
      .map(serializeRoomRegion);
    return c.json(
      { floorplanImageUrl: FLOOR_PLAN_ASSET_PATH, rooms: placed },
      200,
    );
  },
);

// ─── PUT /api/floorplan-regions/rooms/:roomId — set/clear a room's region ────
floorplanRegionsRouter.openapi(
  createRoute({
    method: "put",
    path: "/rooms/{roomId}",
    request: {
      params: z.object({ roomId: z.coerce.number() }),
      body: {
        content: {
          "application/json": {
            // `region: null` clears the region + crop.
            schema: z.object({ region: RegionSchema.nullable() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Region saved (and floorplan cropped)",
        content: { "application/json": { schema: z.object({ room: RoomRegionSchema }) } },
      },
      404: { description: "Room not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      500: { description: "Save failed", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
    },
    summary: "Set or clear a room's floorplan region",
    operationId: "putFloorplanRegion",
  }),
  async (c) => {
    try {
      const { roomId } = c.req.valid("param");
      const { region } = c.req.valid("json");
      const db = drizzle(c.env.DB);

      const room = await db.select().from(rooms).where(eq(rooms.id, roomId)).get();
      if (!room) return c.json({ error: "Room not found" }, 404);

      if (region === null) {
        await db
          .update(rooms)
          .set({
            floorplanBboxXPct: null,
            floorplanBboxYPct: null,
            floorplanBboxWPct: null,
            floorplanBboxHPct: null,
            floorplanCropCfImageId: null,
          })
          .where(eq(rooms.id, roomId))
          .run();
      } else {
        // Crop the whole-house floorplan to this room's rectangle. Source is the
        // Worker's own public asset (absolute origin → subrequest-reachable).
        const sourceUrl = `${new URL(c.req.url).origin}${FLOOR_PLAN_ASSET_PATH}`;
        const cropped = await cropAndUploadCfImage(
          c.env,
          sourceUrl,
          {
            x: region.xPct / 100,
            y: region.yPct / 100,
            width: region.wPct / 100,
            height: region.hPct / 100,
          },
          `floorplan-room-${roomId}.jpg`,
        );
        await db
          .update(rooms)
          .set({
            floorplanBboxXPct: region.xPct,
            floorplanBboxYPct: region.yPct,
            floorplanBboxWPct: region.wPct,
            floorplanBboxHPct: region.hPct,
            floorplanCropCfImageId: cropped.imageId,
          })
          .where(eq(rooms.id, roomId))
          .run();
      }

      const updated = await db.select().from(rooms).where(eq(rooms.id, roomId)).get();
      return c.json({ room: serializeRoomRegion(updated!) }, 200);
    } catch (err) {
      console.error("[floorplan-regions] PUT failed:", err);
      return c.json({ error: "Failed to save region" }, 500);
    }
  },
);
