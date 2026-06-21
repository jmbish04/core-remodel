/**
 * @fileoverview Extended rooms API routes — feature 0005.
 *
 * New endpoints mounted at /api/rooms:
 *
 *   GET  /api/rooms/:roomId/budget-items   — paginated budget items for a room (T3.5 support)
 *   POST /api/rooms/code/:roomCode/options-summary — AI quick summary of room options (T6.1)
 *
 * Routed as a separate Hono instance to keep rooms.ts under 1 000 lines.
 * Both are mounted in api/index.ts under /api/rooms (before the main roomsRouter
 * so the more-specific paths take priority).
 *
 * All queries are live Drizzle/D1 — no mock data.
 * Zod v4 patterns: z.string().min(1), never .nonempty().
 */

import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  budgetTrackerItemRooms,
  budgetTrackerItems,
  rooms,
  scenarioRoomPlans,
  visionPlanNodes,
  visionNodeRoomMappings,
} from "@backend/db";
import { summarizeRoomOptions } from "@backend/services/ai-text";

const roomsExtendedRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a positive integer with a fallback. */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Clamp an integer to [min, max]. */
function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Format cents as a human-readable dollar range string. */
function formatCentsRange(
  lowCents: number | null | undefined,
  highCents: number | null | undefined,
): string | null {
  const low = lowCents ?? null;
  const high = highCents ?? null;
  if (low === null && high === null) return null;
  const fmt = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  if (low !== null && high !== null) return `${fmt(low)} – ${fmt(high)}`;
  if (low !== null) return `from ${fmt(low)}`;
  return `up to ${fmt(high!)}`;
}

// ---------------------------------------------------------------------------
// T3.5 support — GET /api/rooms/:roomId/budget-items
// ---------------------------------------------------------------------------

/**
 * Returns paginated, searchable, filterable budget tracker items for a room.
 *
 * Only active (isActive=true) revision-head items are returned.
 * Uses the `budget_tracker_item_rooms` join table to scope by room.
 *
 * Path param: roomId — integer room ID
 * Query params:
 *   search   — free-text search against title + description
 *   status   — filter by status (open|researching|blocked|approved|done)
 *   page     — 1-based page number (default 1)
 *   pageSize — items per page (default 20, max 100)
 *
 * Response:
 * {
 *   success,
 *   items: BudgetTrackerItem[],  // includes rangeFormatted string
 *   pagination: { page, pageSize, total, totalPages }
 * }
 */
roomsExtendedRouter.get("/:roomId/budget-items", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const roomIdRaw = c.req.param("roomId");
    const roomId = parseInt(roomIdRaw, 10);

    if (!Number.isFinite(roomId) || roomId <= 0) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "roomId must be a positive integer",
          },
        },
        400,
      );
    }

    // Confirm room exists
    const room = await db
      .select({ id: rooms.id, roomName: rooms.roomName })
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .get();

    if (!room) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Room not found" } },
        404,
      );
    }

    // Parse filters
    const search = c.req.query("search")?.trim() ?? "";
    const statusFilter = c.req.query("status")?.trim() ?? "";
    const page = parsePositiveInt(c.req.query("page"), 1);
    const pageSize = clampInt(parsePositiveInt(c.req.query("pageSize"), 20), 1, 100);

    const VALID_STATUSES = new Set([
      "open",
      "researching",
      "blocked",
      "approved",
      "done",
    ]);

    // 1. Fetch all budget_tracker_item IDs linked to this room
    const roomLinks = await db
      .select({ budgetTrackerItemId: budgetTrackerItemRooms.budgetTrackerItemId })
      .from(budgetTrackerItemRooms)
      .where(eq(budgetTrackerItemRooms.roomId, roomId))
      .all();

    if (roomLinks.length === 0) {
      return c.json({
        success: true,
        items: [],
        pagination: { page: 1, pageSize, total: 0, totalPages: 0 },
        room: { id: room.id, roomName: room.roomName },
      });
    }

    const linkedIds = roomLinks.map((r) => r.budgetTrackerItemId);

    // 2. Fetch active items from those IDs, applying text/status filters in JS
    //    (D1 inArray limit is ~90; chunk if needed — here we fetch all matching active)
    const CHUNK = 90;
    let allItems: (typeof budgetTrackerItems.$inferSelect)[] = [];

    for (let i = 0; i < linkedIds.length; i += CHUNK) {
      const chunk = linkedIds.slice(i, i + CHUNK);
      const chunkItems = await db
        .select()
        .from(budgetTrackerItems)
        .where(
          and(
            inArray(budgetTrackerItems.id, chunk),
            eq(budgetTrackerItems.isActive, true),
          ),
        )
        .all();
      allItems.push(...chunkItems);
    }

    // 3. Apply in-memory filters (search + status)
    let filtered = allItems;

    if (statusFilter && VALID_STATUSES.has(statusFilter)) {
      filtered = filtered.filter((item) => item.status === statusFilter);
    }

    if (search) {
      const lower = search.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.title.toLowerCase().includes(lower) ||
          (item.description ?? "").toLowerCase().includes(lower),
      );
    }

    // Sort: active non-done first by datetimeUpdated desc
    filtered.sort((a, b) => {
      if (a.status === "done" && b.status !== "done") return 1;
      if (a.status !== "done" && b.status === "done") return -1;
      const aTs = a.datetimeUpdated ? new Date(a.datetimeUpdated).getTime() : 0;
      const bTs = b.datetimeUpdated ? new Date(b.datetimeUpdated).getTime() : 0;
      return bTs - aTs;
    });

    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const pageItems = filtered.slice(offset, offset + pageSize);

    const items = pageItems.map((item) => ({
      ...item,
      rangeFormatted: formatCentsRange(item.estimatedLowCents, item.estimatedHighCents),
    }));

    return c.json({
      success: true,
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      room: { id: room.id, roomName: room.roomName },
    });
  } catch (error) {
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch budget items",
        },
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// T6.1 — POST /api/rooms/code/:roomCode/options-summary
// ---------------------------------------------------------------------------

/**
 * Generates an AI quick summary of a room's options and deviations.
 *
 * Used by the Room Options section "AI Quick Summary" tab. The summary is
 * not cached on the server (options content changes frequently); the frontend
 * should cache per session if needed.
 *
 * Path param: roomCode — stable room code slug (e.g. "upper-kitchen")
 * Body (JSON, optional):
 *   rawOptions — string — caller may pass pre-assembled raw options text.
 *                         If omitted, the endpoint fetches scenario_room_plans
 *                         + vision nodes for the room automatically.
 *
 * Response: { success, roomCode, roomName, summary }
 */
roomsExtendedRouter.post("/code/:roomCode/options-summary", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const roomCode = c.req.param("roomCode");

    const room = await db
      .select({ id: rooms.id, roomName: rooms.roomName, roomCode: rooms.roomCode })
      .from(rooms)
      .where(eq(rooms.roomCode, roomCode))
      .get();

    if (!room) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Room not found" } },
        404,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      rawOptions?: string;
    };

    let rawOptions = body.rawOptions?.trim() ?? "";

    // If no pre-assembled text, build from scenario_room_plans + vision nodes
    if (!rawOptions) {
      const [roomPlans, nodeLinks] = await Promise.all([
        db
          .select({
            notes: scenarioRoomPlans.notes,
            proposedUse: scenarioRoomPlans.proposedUse,
            estimatedCostCents: scenarioRoomPlans.estimatedCostCents,
            stage: scenarioRoomPlans.stage,
          })
          .from(scenarioRoomPlans)
          .where(eq(scenarioRoomPlans.roomId, room.id))
          .all(),
        db
          .select({ visionNodeId: visionNodeRoomMappings.visionNodeId })
          .from(visionNodeRoomMappings)
          .where(eq(visionNodeRoomMappings.roomId, room.id))
          .all(),
      ]);

      const parts: string[] = [];

      if (roomPlans.length > 0) {
        parts.push("Scenario plans:");
        for (const plan of roomPlans) {
          const stageLabel = plan.stage ? `[${plan.stage}]` : "";
          const useLabel = plan.proposedUse ? ` → ${plan.proposedUse}` : "";
          const costLine =
            plan.estimatedCostCents
              ? ` (~${new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                }).format(plan.estimatedCostCents / 100)})`
              : "";
          const notes = plan.notes?.trim() ?? "(no notes)";
          parts.push(`${stageLabel}${useLabel}${costLine}: ${notes}`);
        }
      }

      if (nodeLinks.length > 0) {
        const nodeIds = nodeLinks.map((n) => n.visionNodeId);
        const CHUNK = 90;
        const nodes: (typeof visionPlanNodes.$inferSelect)[] = [];
        for (let i = 0; i < nodeIds.length; i += CHUNK) {
          const chunk = nodeIds.slice(i, i + CHUNK);
          const chunkNodes = await db
            .select()
            .from(visionPlanNodes)
            .where(inArray(visionPlanNodes.id, chunk))
            .all();
          nodes.push(...chunkNodes);
        }

        if (nodes.length > 0) {
          parts.push("\nVision options:");
          for (const node of nodes) {
            const status = node.status ? `[${node.status}]` : "";
            const title = node.title ?? "(untitled)";
            const summary = node.summary?.trim() ?? "";
            parts.push(
              `${status} ${title}${summary ? `: ${summary}` : ""}`,
            );
          }
        }
      }

      rawOptions = parts.join("\n");
    }

    if (!rawOptions) {
      return c.json({
        success: true,
        roomCode: room.roomCode,
        roomName: room.roomName,
        summary: null,
        message: "No options or deviations found for this room",
      });
    }

    const summary = await summarizeRoomOptions(c.env, rawOptions, room.roomName);

    return c.json({
      success: true,
      roomCode: room.roomCode,
      roomName: room.roomName,
      summary: summary || null,
    });
  } catch (error) {
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to generate room options summary",
        },
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { roomsExtendedRouter };
