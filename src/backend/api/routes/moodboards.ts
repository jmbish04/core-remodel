/**
 * @fileoverview Mood Boards API routes
 */

import { moodBoards } from "@backend/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const moodBoardsRouter = new Hono<{ Bindings: Env }>();

function slugifyMoodboardName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildMoodboardSlug(board: { id: number; name: string }): string {
  const slug = slugifyMoodboardName(board.name);
  return slug || `board-${board.id}`;
}

/**
 * GET /api/moodboards
 * List all mood boards
 */
moodBoardsRouter.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const boards = await db.select().from(moodBoards).all();

    return c.json({
      success: true,
      count: boards.length,
      moodBoards: boards,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list mood boards",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/moodboards
 * Create a new mood board
 */
moodBoardsRouter.post("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = await c.req.json();

    const { name, description, backgroundColor } = body;

    if (!name) {
      return c.json({ error: "Name is required" }, 400);
    }

    const result = await db
      .insert(moodBoards)
      .values({
        name,
        description: description || null,
        backgroundColor: backgroundColor || "#ffffff",
        isActive: true,
        layoutState: JSON.stringify({ images: [] }),
      })
      .returning()
      .get();

    return c.json({
      success: true,
      moodBoard: result,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to create mood board",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/moodboards/resolve/:identifier
 * Resolve either a numeric ID or slug to a mood board record
 */
moodBoardsRouter.get("/resolve/:identifier", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const identifier = c.req.param("identifier").trim().toLowerCase();

    if (!identifier) {
      return c.json({ error: "Identifier is required" }, 400);
    }

    let board: typeof moodBoards.$inferSelect | undefined;

    if (/^\d+$/.test(identifier)) {
      const boardId = parseInt(identifier, 10);
      board = await db.select().from(moodBoards).where(eq(moodBoards.id, boardId)).get();
    } else {
      const boards = await db.select().from(moodBoards).all();
      board = boards.find((candidate) => {
        const canonicalSlug = buildMoodboardSlug(candidate);
        const plainNameSlug = slugifyMoodboardName(candidate.name);
        return identifier === canonicalSlug || identifier === plainNameSlug;
      });
    }

    if (!board) {
      return c.json({ error: "Mood board not found" }, 404);
    }

    const canonicalSlug = buildMoodboardSlug(board);

    return c.json({
      success: true,
      moodBoard: board,
      canonicalSlug,
      canonicalPath: `/moodboards/${canonicalSlug}`,
      isCanonical: identifier === canonicalSlug,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to resolve mood board",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/moodboards/:id
 * Get a specific mood board
 */
moodBoardsRouter.get("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const boardId = parseInt(c.req.param("id"));

    const board = await db.select().from(moodBoards).where(eq(moodBoards.id, boardId)).get();

    if (!board) {
      return c.json({ error: "Mood board not found" }, 404);
    }

    return c.json({
      success: true,
      moodBoard: board,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to get mood board",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * PUT /api/moodboards/:id
 * Update a mood board (including layout state)
 */
moodBoardsRouter.put("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const boardId = parseInt(c.req.param("id"));
    const body = await c.req.json();

    // Check if board exists
    const existing = await db.select().from(moodBoards).where(eq(moodBoards.id, boardId)).get();

    if (!existing) {
      return c.json({ error: "Mood board not found" }, 404);
    }

    // Update fields
    const updates: any = {
      datetimeLastModified: Math.floor(Date.now() / 1000),
    };

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.backgroundColor !== undefined) updates.backgroundColor = body.backgroundColor;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.layoutState !== undefined) {
      updates.layoutState =
        typeof body.layoutState === "string" ? body.layoutState : JSON.stringify(body.layoutState);
    }

    await db.update(moodBoards).set(updates).where(eq(moodBoards.id, boardId)).run();

    // Get updated record
    const updated = await db.select().from(moodBoards).where(eq(moodBoards.id, boardId)).get();

    return c.json({
      success: true,
      moodBoard: updated,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update mood board",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * DELETE /api/moodboards/:id
 * Delete a mood board
 */
moodBoardsRouter.delete("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const boardId = parseInt(c.req.param("id"));

    // Check if board exists
    const existing = await db.select().from(moodBoards).where(eq(moodBoards.id, boardId)).get();

    if (!existing) {
      return c.json({ error: "Mood board not found" }, 404);
    }

    await db.delete(moodBoards).where(eq(moodBoards.id, boardId)).run();

    return c.json({
      success: true,
      message: "Mood board deleted successfully",
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to delete mood board",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { moodBoardsRouter };
