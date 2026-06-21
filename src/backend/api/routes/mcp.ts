/**
 * MCP (Model Context Protocol) server for the AI image-editing pipeline.
 *
 * Streamable-HTTP JSON-RPC transport mounted at /api/mcp. Exposes the render +
 * mood-board tools so an MCP client (e.g. Claude) can drive the renderer.
 *
 * Auth: inherits the app's /api/* bearer auth (Authorization: Bearer <WORKER_API_KEY>).
 * That is the "token" an MCP client supplies. NOTE: full claude.ai *connector* OAuth
 * (authorize/token/dynamic-client-registration via @cloudflare/workers-oauth-provider)
 * is a documented follow-up; Claude Code can use this today with a bearer header.
 */
import { listingPhotos, moodBoardGenerations, renderCanvases, renderSessions } from "@backend/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { generateMoodBoard } from "../../services/render/mood-board";
import { runStage } from "../../services/render/stage-runner";
import type { StageType } from "../../services/render/types";

const mcpRouter = new Hono<{ Bindings: Env }>();

const SERVER_INFO = { name: "renovation-studio", version: "1.0.0" };
const PROTOCOL_VERSION = "2024-11-05";

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: McpTool[] = [
  {
    name: "create_render_session",
    description: "Create a render session for a room. Returns a sessionId used by other tools.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, roomId: { type: "number" } },
      required: ["name"],
    },
  },
  {
    name: "list_room_angles",
    description: "List a room's blank-canvas angle photos (listing photos) available to render.",
    inputSchema: {
      type: "object",
      properties: { roomId: { type: "number" } },
      required: ["roomId"],
    },
  },
  {
    name: "run_render_stage",
    description:
      "Run a render stage. actionType: INITIAL_BASE (floor+paint from a blank canvas; needs listingPhotoId), STRUCTURAL_MOVE (rough-in), MATERIAL_TWEAK or FINISH (from a prior canvasId).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        listingPhotoId: { type: "number" },
        canvasId: { type: "string" },
        actionType: {
          type: "string",
          enum: ["INITIAL_BASE", "STRUCTURAL_MOVE", "MATERIAL_TWEAK", "FINISH"],
        },
        prompt: { type: "string" },
      },
      required: ["sessionId", "actionType", "prompt"],
    },
  },
  {
    name: "generate_mood_board",
    description: "Generate an interior-design mood board from a prompt and/or image URLs.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        imageUrls: { type: "array", items: { type: "string" } },
        roomId: { type: "number" },
      },
    },
  },
  {
    name: "list_mood_boards",
    description: "List generated mood boards, optionally filtered by keyword (q) or roomId.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string" }, roomId: { type: "number" } },
    },
  },
];

const ACTION_TO_STAGE: Record<string, StageType> = {
  INITIAL_BASE: "stage_1_LP_base",
  STRUCTURAL_MOVE: "stage_2_LP_rough_in",
  MATERIAL_TWEAK: "stage_3_LP_finish",
  FINISH: "stage_3_LP_finish",
};

function deliveryUrlFromToken(token: string): string {
  return token.startsWith("http") ? token : `https://imagedelivery.net/${token}/public`;
}

function metaDeliveryUrl(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { deliveryUrl?: unknown };
    return typeof parsed.deliveryUrl === "string" ? parsed.deliveryUrl : null;
  } catch {
    return null;
  }
}

async function callTool(env: Env, name: string, args: Record<string, any>): Promise<string> {
  const db = drizzle(env.DB);
  switch (name) {
    case "create_render_session": {
      const id = crypto.randomUUID();
      await db
        .insert(renderSessions)
        .values({ id, name: String(args.name), roomId: args.roomId ?? null })
        .run();
      return JSON.stringify({ sessionId: id });
    }
    case "list_room_angles": {
      const rows = await db
        .select()
        .from(listingPhotos)
        .where(eq(listingPhotos.roomId, Number(args.roomId)))
        .all();
      return JSON.stringify(
        rows.map((r) => ({
          listingPhotoId: r.id,
          roomName: r.roomName,
          hasBlankCanvas: !!r.blankCanvasCfImageId,
        })),
      );
    }
    case "run_render_stage": {
      const type = ACTION_TO_STAGE[String(args.actionType)];
      if (!type) throw new Error("Invalid actionType");
      let inputImageUrl: string | null = null;
      let parentCanvasId: string | null = null;
      let listingPhotoId: number | null = args.listingPhotoId ?? null;
      let roomId: number | null = null;

      if (args.canvasId) {
        const parent = await db
          .select()
          .from(renderCanvases)
          .where(eq(renderCanvases.id, String(args.canvasId)))
          .get();
        if (!parent) throw new Error("Parent canvas not found");
        inputImageUrl =
          metaDeliveryUrl(parent.metadata) ??
          (parent.outputCfImageId ? deliveryUrlFromToken(parent.outputCfImageId) : null);
        parentCanvasId = parent.id;
        listingPhotoId = parent.listingPhotoId ?? listingPhotoId;
        roomId = parent.roomId ?? null;
      } else if (listingPhotoId != null) {
        const lp = await db
          .select()
          .from(listingPhotos)
          .where(eq(listingPhotos.id, listingPhotoId))
          .get();
        if (!lp) throw new Error("Listing photo not found");
        const token = lp.blankCanvasCfImageId ?? lp.cfImageId;
        if (!token) throw new Error("No blank canvas for this listing photo");
        inputImageUrl = deliveryUrlFromToken(token);
        roomId = lp.roomId ?? null;
      }
      if (!inputImageUrl) throw new Error("Provide canvasId or listingPhotoId");

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
      return JSON.stringify(result);
    }
    case "generate_mood_board": {
      const mb = await generateMoodBoard({
        env,
        prompt: args.prompt ? String(args.prompt) : undefined,
        imageUrls: Array.isArray(args.imageUrls) ? args.imageUrls.map(String) : undefined,
        roomId: args.roomId ?? null,
        source: "api",
      });
      return JSON.stringify(mb);
    }
    case "list_mood_boards": {
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
      return JSON.stringify(
        filtered.map((r) => ({ id: r.id, aiTitle: r.aiTitle, outputImageUrl: r.outputImageUrl })),
      );
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// JSON-RPC over HTTP (the MCP streamable-HTTP transport).
mcpRouter.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as any;

  const handle = async (msg: any) => {
    const id = msg?.id ?? null;
    const method = msg?.method;
    const params = msg?.params;
    try {
      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        };
      }
      if (method === "tools/list") {
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
      }
      if (method === "tools/call") {
        const text = await callTool(c.env, params?.name, params?.arguments ?? {});
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
      }
      if (method === "ping") {
        return { jsonrpc: "2.0", id, result: {} };
      }
      if (typeof method === "string" && method.startsWith("notifications/")) {
        return null; // notifications get no response
      }
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: String((err as Error)?.message ?? err) },
      };
    }
  };

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter((r) => r !== null);
    return c.json(out);
  }
  const res = await handle(body);
  if (res === null) return c.body(null, 202);
  return c.json(res);
});

// Discovery / health (handy for sanity-checking the server)
mcpRouter.get("/", (c) =>
  c.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocol: "mcp",
    transport: "http",
    tools: TOOLS.map((t) => t.name),
  }),
);

export default mcpRouter;
