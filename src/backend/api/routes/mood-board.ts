/**
 * AI Mood Board API — generate (prompt and/or images) + serve (by room/floor/keywords).
 * Distinct from the manual `/api/moodboards` curated-board routes.
 */
import { moodBoardGenerations, rooms } from "@backend/db";
import { isRequestAuthenticated } from "@backend/utils/access";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { generateMoodBoard } from "../../services/render/mood-board";
import { ImageProcessorService } from "../../services/image-processor";
import { resolveCloudflareImagesCredentials } from "../../utils/secrets";

const moodBoardRouter = new Hono<{ Bindings: Env }>();

/** Resolve a free-text room name to a roomId (best-effort). */
async function resolveRoomIdByName(env: Env, name: string): Promise<number | null> {
  const db = drizzle(env.DB);
  const row = await db.select().from(rooms).where(like(rooms.roomName, `%${name}%`)).get();
  return row?.id ?? null;
}

// POST /api/mood-board/generate — multipart (prompt? + file(s)?) or JSON (prompt? + imageUrls?)
moodBoardRouter.post("/generate", async (c) => {
  const contentType = c.req.header("content-type") || "";
  let prompt: string | undefined;
  let roomId: number | null = null;
  let imageUrls: string[] = [];

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const p = form.get("prompt");
    if (typeof p === "string" && p.trim()) prompt = p.trim();
    const r = form.get("roomId");
    if (typeof r === "string" && r.trim()) roomId = Number(r) || null;
    const roomName = form.get("roomName");
    if (!roomId && typeof roomName === "string" && roomName.trim()) {
      roomId = await resolveRoomIdByName(c.env, roomName.trim());
    }

    const creds = await resolveCloudflareImagesCredentials(c.env);
    if (creds.accountId && creds.apiTokens.length > 0) {
      const processor = new ImageProcessorService(c.env, creds.accountId, creds.apiTokens[0], {
        fallbackApiTokens: creds.apiTokens.slice(1),
      });
      for (const [, value] of form.entries()) {
        if (value instanceof File) {
          const up = await processor.uploadToCloudflareImages(value, undefined, value.name || "source.jpg");
          imageUrls.push(processor.getDeliveryUrl(up, up.result.id));
        }
      }
    }
  } else {
    const body = (await c.req.json().catch(() => ({}))) as {
      prompt?: unknown;
      roomId?: unknown;
      imageUrls?: unknown;
    };
    if (typeof body.prompt === "string" && body.prompt.trim()) prompt = body.prompt.trim();
    if (typeof body.roomId === "number") roomId = body.roomId;
    if (Array.isArray(body.imageUrls)) {
      imageUrls = body.imageUrls.filter((x): x is string => typeof x === "string");
    }
  }

  if (!prompt && imageUrls.length === 0) {
    return c.json({ error: "Provide a prompt and/or at least one image" }, 400);
  }

  const result = await generateMoodBoard({
    env: c.env,
    prompt,
    imageUrls,
    roomId,
    source: "api",
  });
  return c.json(result);
});

// GET /api/mood-board — list/serve with filters (?q= keyword, ?roomId=, ?floorId=, ?roomName=)
moodBoardRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const q = c.req.query("q");
  const roomIdQ = c.req.query("roomId");
  const floorIdQ = c.req.query("floorId");
  const roomNameQ = c.req.query("roomName");
  const sharedOnly = c.req.query("shared") === "true";

  const conds = [];
  if (roomIdQ) conds.push(eq(moodBoardGenerations.roomId, Number(roomIdQ)));
  if (floorIdQ) conds.push(eq(moodBoardGenerations.floorId, Number(floorIdQ)));
  if (q) {
    conds.push(
      or(
        like(moodBoardGenerations.aiTitle, `%${q}%`),
        like(moodBoardGenerations.aiDescription, `%${q}%`),
        like(moodBoardGenerations.prompt, `%${q}%`),
      ),
    );
  }
  if (roomNameQ) {
    const matched = await db
      .select()
      .from(rooms)
      .where(like(rooms.roomName, `%${roomNameQ}%`))
      .all();
    const ids = matched.map((r) => r.id);
    conds.push(ids.length ? inArray(moodBoardGenerations.roomId, ids) : eq(moodBoardGenerations.id, "__none__"));
  }

  // Auth check for filtering shared vs all mood boards
  const authenticated = await isRequestAuthenticated(c.req.raw, c.env);
  if (!authenticated || sharedOnly) {
    conds.push(eq(moodBoardGenerations.isShared, true));
  }

  const rowsQuery = db.select().from(moodBoardGenerations);
  const rows = await (conds.length ? rowsQuery.where(and(...conds)) : rowsQuery)
    .orderBy(desc(moodBoardGenerations.datetimeCreated))
    .all();
  return c.json({ moodBoards: rows });
});

// GET /api/mood-board/:id
moodBoardRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const row = await db
    .select()
    .from(moodBoardGenerations)
    .where(eq(moodBoardGenerations.id, c.req.param("id")))
    .get();
  if (!row) return c.json({ error: "Mood board not found" }, 404);
  return c.json({ moodBoard: row });
});

// PATCH /api/mood-board/:id/share — toggle isShared status (Admin only)
moodBoardRouter.patch("/:id/share", async (c) => {
  const authenticated = await isRequestAuthenticated(c.req.raw, c.env);
  if (!authenticated) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const db = drizzle(c.env.DB);
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { isShared?: boolean };

    if (typeof body.isShared !== "boolean") {
      return c.json({ error: "isShared boolean is required" }, 400);
    }

    const updated = await db
      .update(moodBoardGenerations)
      .set({ isShared: body.isShared })
      .where(eq(moodBoardGenerations.id, id))
      .returning()
      .get();

    if (!updated) {
      return c.json({ error: "Mood board not found" }, 404);
    }

    return c.json({ success: true, moodBoard: updated });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update sharing status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export default moodBoardRouter;
