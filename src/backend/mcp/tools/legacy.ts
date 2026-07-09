/**
 * @fileoverview MCP tools — Legacy render + measurement bridge.
 *
 * These tools are a straight port of the worker (bearer/cookie) tools that used
 * to live inline in the legacy `/api/mcp` Hono JSON-RPC handler
 * (`src/backend/api/routes/mcp.ts`). They are lifted here VERBATIM into the
 * shared `RemodelTool` registry so every transport (the OAuth-gated claude.ai
 * connector, the legacy JSON-RPC endpoint, and the docs site) exposes them from
 * one source of truth.
 *
 * Two domains live here:
 *   - **render** — drive the AI image-editing pipeline: create a render session,
 *     list a room's blank-canvas angles, run a render stage, and generate/list
 *     interior-design mood boards. `highlight_wall` also lives here: it points
 *     at a wall segment on the live collaborative floor plan.
 *   - **measurements** — the 0006 master-measurements bridge: record a
 *     measurement, list what's captured, and summarize coverage across rooms.
 *
 * NOTE: the three `*_deep_research_*` tools and `list_rooms` are intentionally
 * NOT ported here — research tools remain transport-specific (scoped tokens)
 * and `list_rooms` is owned by the Rooms domain registry (`tools/rooms.ts`).
 */
import {
  MEASUREMENT_ELEMENT_TYPES,
  MEASUREMENT_SOURCES,
  listingPhotos,
  moodBoardGenerations,
  renderCanvases,
  renderSessions,
  type MeasurementElementType,
  type MeasurementSource,
} from "@backend/db";
import {
  createMeasurement,
  getMeasurementCoverage,
  listMeasurements,
} from "@backend/services/measurements";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { generateMoodBoard } from "../../services/render/mood-board";
import { runStage } from "../../services/render/stage-runner";
import type { StageType } from "../../services/render/types";
import { rowToDto } from "../../api/routes/measurements.schemas";
import { num, toolError } from "../format";
import { looseObject } from "../schemas";
import { defineTool, READ_ONLY, WRITE, type RemodelTool } from "../types";

/**
 * Map a render canvas token to a public Cloudflare Images delivery URL. If the
 * token already looks like a URL we pass it through untouched.
 */
function deliveryUrlFromToken(token: string): string {
  return token.startsWith("http") ? token : `https://imagedelivery.net/${token}/public`;
}

/**
 * Pull a `deliveryUrl` out of a render canvas's JSON `metadata` column, if any.
 * Returns `null` on missing/invalid JSON or a non-string field.
 */
function metaDeliveryUrl(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { deliveryUrl?: unknown };
    return typeof parsed.deliveryUrl === "string" ? parsed.deliveryUrl : null;
  } catch {
    return null;
  }
}

/** Map an MCP `actionType` onto the internal render pipeline stage. */
const ACTION_TO_STAGE: Record<string, StageType> = {
  INITIAL_BASE: "stage_1_LP_base",
  STRUCTURAL_MOVE: "stage_2_LP_rough_in",
  MATERIAL_TWEAK: "stage_3_LP_finish",
  FINISH: "stage_3_LP_finish",
};

export const legacyTools: RemodelTool[] = [
  defineTool({
    name: "create_render_session",
    category: "render",
    title: "Create render session",
    description:
      "Create a render session for a room. Returns a sessionId used by other tools.",
    inputShape: {
      name: z.string().describe("Human-readable name for the render session."),
      roomId: z
        .number()
        .optional()
        .describe("Optional room id this session belongs to."),
    },
    annotations: WRITE,
    outputShape: {
      sessionId: z.string().describe("The created render session id"),
    },
    handler: async ({ db }, input) => {
      const args = input as { name: unknown; roomId?: unknown };
      const id = crypto.randomUUID();
      await db
        .insert(renderSessions)
        .values({ id, name: String(args.name), roomId: (args.roomId as number | null) ?? null })
        .run();
      return { sessionId: id };
    },
  }),

  defineTool({
    name: "list_room_angles",
    category: "render",
    title: "List room angles",
    description:
      "List a room's blank-canvas angle photos (listing photos) available to render.",
    inputShape: {
      roomId: z.number().describe("Room id whose listing photos to list."),
    },
    annotations: READ_ONLY,
    handler: async ({ db }, input) => {
      const args = input as { roomId: unknown };
      const rows = await db
        .select()
        .from(listingPhotos)
        .where(eq(listingPhotos.roomId, Number(args.roomId)))
        .all();
      return rows.map((r) => ({
        listingPhotoId: r.id,
        roomName: r.roomName,
        hasBlankCanvas: !!r.blankCanvasCfImageId,
      }));
    },
  }),

  defineTool({
    name: "run_render_stage",
    category: "render",
    title: "Run render stage",
    description:
      "Run a render stage. actionType: INITIAL_BASE (floor+paint from a blank canvas; needs listingPhotoId), STRUCTURAL_MOVE (rough-in), MATERIAL_TWEAK or FINISH (from a prior canvasId).",
    inputShape: {
      sessionId: z.string().describe("Render session id from create_render_session."),
      listingPhotoId: z
        .number()
        .optional()
        .describe("Listing photo id — required for INITIAL_BASE from a blank canvas."),
      canvasId: z
        .string()
        .optional()
        .describe("Parent canvas id to continue from (STRUCTURAL_MOVE/MATERIAL_TWEAK/FINISH)."),
      actionType: z
        .enum(["INITIAL_BASE", "STRUCTURAL_MOVE", "MATERIAL_TWEAK", "FINISH"])
        .describe("Which render stage to run."),
      prompt: z.string().describe("The render prompt."),
    },
    annotations: WRITE,
    handler: async ({ env, db }, input) => {
      const args = input as {
        actionType: unknown;
        canvasId?: unknown;
        listingPhotoId?: unknown;
        sessionId: unknown;
        prompt: unknown;
      };
      const type = ACTION_TO_STAGE[String(args.actionType)];
      if (!type) toolError("Invalid actionType");
      let inputImageUrl: string | null = null;
      let parentCanvasId: string | null = null;
      let listingPhotoId: number | null = (args.listingPhotoId as number | null) ?? null;
      let roomId: number | null = null;

      if (args.canvasId) {
        const parent = await db
          .select()
          .from(renderCanvases)
          .where(eq(renderCanvases.id, String(args.canvasId)))
          .get();
        if (!parent) toolError("Parent canvas not found");
        inputImageUrl =
          metaDeliveryUrl(parent!.metadata) ??
          (parent!.outputCfImageId ? deliveryUrlFromToken(parent!.outputCfImageId) : null);
        parentCanvasId = parent!.id;
        listingPhotoId = parent!.listingPhotoId ?? listingPhotoId;
        roomId = parent!.roomId ?? null;
      } else if (listingPhotoId != null) {
        const lp = await db
          .select()
          .from(listingPhotos)
          .where(eq(listingPhotos.id, listingPhotoId))
          .get();
        if (!lp) toolError("Listing photo not found");
        const token = lp!.blankCanvasCfImageId ?? lp!.cfImageId;
        if (!token) toolError("No blank canvas for this listing photo");
        inputImageUrl = deliveryUrlFromToken(token!);
        roomId = lp!.roomId ?? null;
      }
      if (!inputImageUrl) toolError("Provide canvasId or listingPhotoId");

      const result = await runStage({
        env,
        sessionId: String(args.sessionId),
        type,
        inputImageUrl,
        prompt: String(args.prompt),
        parentCanvasId,
        listingPhotoId,
        roomId,
      });
      return result;
    },
  }),

  defineTool({
    name: "generate_mood_board",
    category: "render",
    title: "Generate mood board",
    description:
      "Generate an interior-design mood board from a prompt and/or image URLs.",
    inputShape: {
      prompt: z.string().optional().describe("Text prompt describing the mood board."),
      imageUrls: z
        .array(z.string())
        .optional()
        .describe("Reference image URLs to seed the mood board."),
      roomId: z.number().optional().describe("Optional room id to associate."),
    },
    annotations: WRITE,
    handler: async ({ env }, input) => {
      const args = input as { prompt?: unknown; imageUrls?: unknown; roomId?: unknown };
      const mb = await generateMoodBoard({
        env,
        prompt: args.prompt ? String(args.prompt) : undefined,
        imageUrls: Array.isArray(args.imageUrls) ? args.imageUrls.map(String) : undefined,
        roomId: (args.roomId as number | null) ?? null,
        source: "api",
      });
      return mb;
    },
  }),

  defineTool({
    name: "list_mood_boards",
    category: "render",
    title: "List mood boards",
    description:
      "List generated mood boards, optionally filtered by keyword (q) or roomId.",
    inputShape: {
      q: z.string().optional().describe("Free-text filter over title/description."),
      roomId: z.number().optional().describe("Filter to a single room id."),
    },
    annotations: READ_ONLY,
    handler: async ({ db }, input) => {
      const args = input as { q?: unknown; roomId?: unknown };
      const rows = await db.select().from(moodBoardGenerations).all();
      let filtered = rows;
      if (args.roomId != null) filtered = filtered.filter((r) => r.roomId === Number(args.roomId));
      if (args.q) {
        const q = String(args.q).toLowerCase();
        filtered = filtered.filter(
          (r) =>
            (r.aiTitle ?? "").toLowerCase().includes(q) ||
            (r.aiDescription ?? "").toLowerCase().includes(q),
        );
      }
      return filtered.map((r) => ({
        id: r.id,
        aiTitle: r.aiTitle,
        outputImageUrl: r.outputImageUrl,
      }));
    },
  }),

  defineTool({
    name: "highlight_wall",
    category: "render",
    title: "Highlight wall",
    description:
      "Point at a wall segment on the live collaborative floor plan: it flashes amber on every connected screen (the phone at /measure plus any open desktop tab) — i.e. 'Claude is pointing here'. This is how you 'touch' a wall during a measuring session so your human can confirm you mean the right one. `elementId` is the traced SVG segment id, e.g. 'upper_wall_segment_12' or 'lower_wall_segment_3'. `room` defaults to the house room '126-colby'. Returns how many screens it lit up.",
    inputShape: {
      elementId: z
        .string()
        .describe("Traced SVG segment id, e.g. 'upper_wall_segment_12'."),
      room: z.string().optional().describe("Floor-plan room key. Defaults to '126-colby'."),
    },
    annotations: WRITE,
    handler: async ({ env }, input) => {
      const args = input as { elementId?: unknown; room?: unknown };
      const elementId = String(args.elementId ?? "").trim();
      if (!elementId) toolError("elementId is required");
      const room = (args.room ? String(args.room) : "126-colby").trim() || "126-colby";
      // Server-side RPC into the room's DurableObject — broadcasts a WALL_TOUCH to every
      // connected screen without Claude having to hold a WebSocket. See FloorplanSessionDO.
      const delivered = await env.FLOORPLAN_SESSION.getByName(room).injectTouch(elementId, "claude");
      return { room, elementId, delivered };
    },
  }),

  defineTool({
    name: "add_measurement",
    category: "measurements",
    title: "Add measurement",
    description:
      "Record one measurement in the master measurements table. Dimensions are CANONICAL US units: feet (whole number) + inches (decimal) per side, plus optional areaSqFt — not every element has all sides (a window is width × height). `roomId` (optional) must be an ACTIVE room from list_rooms. Use source='measured' and isApproximate=false for a real tape/laser reading (measure twice, cut once); source defaults to 'estimated' and isApproximate to true.",
    inputShape: {
      roomId: z.number().optional().describe("Active room id (from list_rooms)."),
      elementType: z
        .enum([...MEASUREMENT_ELEMENT_TYPES])
        .describe("The kind of element being measured."),
      label: z.string().optional().describe("Optional human label for the element."),
      lengthFeet: z.number().optional(),
      lengthInches: z.number().optional(),
      widthFeet: z.number().optional(),
      widthInches: z.number().optional(),
      heightFeet: z.number().optional(),
      heightInches: z.number().optional(),
      areaSqFt: z.number().optional(),
      quantity: z.number().optional(),
      source: z
        .enum([...MEASUREMENT_SOURCES])
        .optional()
        .describe("How the measurement was obtained. Defaults to 'estimated'."),
      isApproximate: z.boolean().optional().describe("Defaults to true."),
      accuracyNote: z.string().optional(),
      notes: z.string().optional(),
    },
    annotations: WRITE,
    handler: async ({ db }, input) => {
      const args = input as Record<string, any>;
      const elementType = String(args.elementType ?? "");
      if (!(MEASUREMENT_ELEMENT_TYPES as readonly string[]).includes(elementType)) {
        toolError(
          `invalid elementType "${elementType}". Valid: ${MEASUREMENT_ELEMENT_TYPES.join(", ")}`,
        );
      }
      let source: MeasurementSource | undefined;
      if (args.source != null) {
        const candidate = String(args.source);
        if (!(MEASUREMENT_SOURCES as readonly string[]).includes(candidate)) {
          toolError(
            `invalid source "${candidate}". Valid: ${MEASUREMENT_SOURCES.join(", ")}`,
          );
        }
        source = candidate as MeasurementSource;
      }

      // Coerce optional numerics defensively (the MCP path has no Zod gate): a stray
      // non-numeric becomes null rather than poisoning the row with NaN.
      // Local coercion returns null (not undefined) so a cleared field is
      // written as NULL. Named parseNum to avoid shadowing the imported `num`.
      const parseNum = (v: unknown): number | null => {
        if (v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const quantity =
        args.quantity != null && Number.isFinite(Number(args.quantity))
          ? Number(args.quantity)
          : undefined;
      const result = await createMeasurement(db, {
        roomId: parseNum(args.roomId),
        elementType: elementType as MeasurementElementType,
        label: args.label != null ? String(args.label) : null,
        lengthFeet: parseNum(args.lengthFeet),
        lengthInches: parseNum(args.lengthInches),
        widthFeet: parseNum(args.widthFeet),
        widthInches: parseNum(args.widthInches),
        heightFeet: parseNum(args.heightFeet),
        heightInches: parseNum(args.heightInches),
        areaSqFt: parseNum(args.areaSqFt),
        quantity,
        source,
        isApproximate: args.isApproximate != null ? Boolean(args.isApproximate) : undefined,
        accuracyNote: args.accuracyNote != null ? String(args.accuracyNote) : null,
        notes: args.notes != null ? String(args.notes) : null,
      });
      if (!result.ok) toolError(result.error);
      return rowToDto(result.row);
    },
  }),

  defineTool({
    name: "list_measurements",
    category: "measurements",
    title: "List measurements",
    description:
      "List recorded measurements (newest first), optionally filtered by roomId, elementType (single value or comma-separated list), or free-text q. Use this to see what's already captured before adding more.",
    inputShape: {
      roomId: z.number().optional().describe("Filter to a single room id."),
      elementType: z
        .string()
        .optional()
        .describe("Single value or comma-separated list of element types."),
      q: z.string().optional().describe("Free-text filter."),
      limit: z.number().optional().describe("Max rows to return."),
    },
    annotations: READ_ONLY,
    handler: async ({ db }, input) => {
      const args = input as { roomId?: unknown; elementType?: unknown; q?: unknown; limit?: unknown };
      const elementTypes = args.elementType
        ? String(args.elementType)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      const rows = await listMeasurements(db, {
        roomId: num(args.roomId),
        elementTypes: elementTypes as MeasurementElementType[] | undefined,
        q: args.q != null ? String(args.q) : undefined,
        limit: num(args.limit),
      });
      return rows.map(rowToDto);
    },
  }),

  defineTool({
    name: "get_measurement_coverage",
    category: "measurements",
    title: "Get measurement coverage",
    description:
      "Summarize measurement coverage across all active rooms — per-room counts and which element types are recorded — plus the active rooms that still have ZERO measurements. Answers 'what still needs measuring?'.",
    inputShape: {},
    annotations: READ_ONLY,
    handler: async ({ db }) => {
      const coverage = await getMeasurementCoverage(db);
      return coverage;
    },
  }),
];
