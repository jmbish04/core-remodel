/**
 * @fileoverview Deterministic floorplan seed generator (0043 Phase 2).
 *
 * Core-Remodel stores NO true wall geometry — only per-room floorplan bounding
 * boxes (percent of the plan image), scalar room dimensions (feet+inches), and
 * element-scoped `measurements` rows. So the seed we emit is honest about that:
 * each room becomes a RECTANGLE sized by its measured feet and positioned by its
 * floorplan bbox. Dimensions are exact; shape + adjacency + walls are the user's
 * job in the Pascal editor (or an AI edit in Phase 3). We deliberately emit NO
 * wall nodes — wall adjacency can't be inferred from rectangles.
 *
 * The emitted container matches Pascal's flat `SceneGraph` ({ nodes, rootNodeIds }).
 * Node internals are a best-effort seed carried largely in `metadata`; reconcile
 * with @pascal-app/core node schemas when they're finalized (hardening task).
 */
import { and, eq, inArray } from "drizzle-orm";

import { floors, measurements, rooms } from "@backend/db";

import type { SceneGraph, SceneRenderingMetadata } from "./shapes";
import type { RemodelDb } from "../../mcp/types";

/** Nominal metric span the floorplan bbox percents map onto (feet). Tunable. */
const CANVAS_FT = 60;

type RoomRow = typeof rooms.$inferSelect;

const feet = (ft: number | null, inch: number | null): number =>
  (ft ?? 0) + (inch ?? 0) / 12;

/** Room rectangle: measured size (ft) + bbox-derived top-left origin (ft). */
function roomRect(r: RoomRow): { x: number; y: number; w: number; h: number } {
  const w = feet(r.widthFeet, r.widthInches) || Math.sqrt(r.areaSqFt ?? 100);
  const h = feet(r.lengthFeet, r.lengthInches) || Math.sqrt(r.areaSqFt ?? 100);
  const x = ((r.floorplanBboxXPct ?? 0) / 100) * CANVAS_FT;
  const y = ((r.floorplanBboxYPct ?? 0) / 100) * CANVAS_FT;
  return { x, y, w, h };
}

export interface SeedResult {
  graph: SceneGraph;
  rendering: SceneRenderingMetadata;
  roomCount: number;
  note: string;
}

/**
 * Build a rectangular seed SceneGraph for a project scope.
 * @param scope floor → rooms on that floor; room → the one room; whole_home → all active rooms.
 */
export async function generateSeedGraph(
  db: RemodelDb,
  input: {
    coreRemodelProjectId: string;
    scopeType: "floor" | "room" | "whole_home";
    floorId?: number | null;
    roomId?: number | null;
    requestId?: string | null;
    generatedAt: string;
  },
): Promise<SeedResult> {
  // Resolve the target rooms.
  const filters = [eq(rooms.isActive, true)];
  if (input.scopeType === "room" && input.roomId != null) {
    filters.push(eq(rooms.id, input.roomId));
  } else if (input.scopeType === "floor" && input.floorId != null) {
    filters.push(eq(rooms.floorId, input.floorId));
  }
  const targetRooms = await db
    .select()
    .from(rooms)
    .where(and(...filters))
    .all();

  const floorRows = await db.select().from(floors).all();
  const floorById = new Map(floorRows.map((f) => [f.id, f]));

  const nodes: Record<string, unknown> = {
    site: { id: "site", type: "site", parentId: null, name: "Site", visible: true },
    building: {
      id: "building",
      type: "building",
      parentId: "site",
      name: "126 Colby",
      visible: true,
    },
  };

  // One level node per distinct floor present in the room set.
  const levelIds = new Set<number>();
  for (const r of targetRooms) {
    if (r.floorId != null && !levelIds.has(r.floorId)) {
      levelIds.add(r.floorId);
      const f = floorById.get(r.floorId);
      nodes[`level_${r.floorId}`] = {
        id: `level_${r.floorId}`,
        type: "level",
        parentId: "building",
        name: f?.name ?? `Floor ${r.floorId}`,
        visible: true,
        metadata: { floorId: r.floorId, levelOrder: f?.levelOrder ?? 0, unit: "ft" },
      };
    }
  }

  for (const r of targetRooms) {
    const levelId = r.floorId != null ? `level_${r.floorId}` : "building";
    const { x, y, w, h } = roomRect(r);
    const slabId = `slab_${r.roomCode}`;
    const zoneId = `zone_${r.roomCode}`;
    // Axis-aligned rectangle polygon (feet), clockwise from top-left.
    nodes[slabId] = {
      id: slabId,
      type: "slab",
      parentId: levelId,
      name: `${r.roomName} floor`,
      visible: true,
      points: [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      metadata: {
        roomId: r.id,
        roomCode: r.roomCode,
        widthFt: w,
        lengthFt: h,
        areaSqFt: r.areaSqFt ?? w * h,
        unit: "ft",
        approximatePosition: true,
      },
    };
    nodes[zoneId] = {
      id: zoneId,
      type: "zone",
      parentId: levelId,
      name: r.roomName,
      visible: true,
      metadata: { roomId: r.id, roomCode: r.roomCode, areaSqFt: r.areaSqFt ?? w * h, unit: "ft" },
    };
  }

  const graph: SceneGraph = { nodes, rootNodeIds: ["site"] };

  // Evidence: real measurement rows for the scoped rooms, when present.
  const roomIds = targetRooms.map((r) => r.id);
  const evidence: SceneRenderingMetadata["measurements"] = [];
  if (roomIds.length > 0) {
    // roomIds is small (house scale); a single inArray is well under the 100-param cap.
    const mrows = await db
      .select()
      .from(measurements)
      .where(inArray(measurements.roomId, roomIds))
      .all();
    for (const m of mrows.slice(0, 10_000)) {
      const val = feet(m.lengthFeet, m.lengthInches) || (m.areaSqFt ?? 0);
      evidence.push({
        measurementId: String(m.id),
        kind: m.elementType ?? "measurement",
        value: val,
        unit: "ft",
        confidence: m.isApproximate ? 0.6 : 0.95,
        sourceRevision: null,
      });
    }
  }
  const aggregate =
    evidence.length > 0
      ? evidence.reduce((s, e) => s + e.confidence, 0) / evidence.length
      : null;

  const rendering: SceneRenderingMetadata = {
    coreRemodelProjectId: input.coreRemodelProjectId,
    variant: null, // filled by the caller once the variant id exists
    measurements: evidence,
    confidence: aggregate,
    provenance: {
      source: "core-remodel",
      generatedAt: input.generatedAt,
      sourceRevision: null,
      requestId: input.requestId ?? null,
    },
  };

  return {
    graph,
    rendering,
    roomCount: targetRooms.length,
    note:
      "Rectangular seed: rooms sized by measured feet, positioned by floorplan bbox. " +
      "No walls (adjacency can't be inferred) — refine walls in the editor.",
  };
}
