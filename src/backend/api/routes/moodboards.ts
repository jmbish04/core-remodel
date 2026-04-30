/**
 * @fileoverview Mood Boards API routes
 */

import { Hono } from 'hono';
import type { Bindings } from '../index';
import { drizzle } from 'drizzle-orm/d1';
import { moodBoards } from '../../db/schema';
import { eq } from 'drizzle-orm';

const moodBoardsRouter = new Hono<{ Bindings: Bindings }>();

/**
 * GET /api/moodboards
 * List all mood boards
 */
moodBoardsRouter.get('/', async (c) => {
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
        error: 'Failed to list mood boards',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/moodboards
 * Create a new mood board
 */
moodBoardsRouter.post('/', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = await c.req.json();

    const { name, description, backgroundColor } = body;

    if (!name) {
      return c.json({ error: 'Name is required' }, 400);
    }

    const result = await db
      .insert(moodBoards)
      .values({
        name,
        description: description || null,
        backgroundColor: backgroundColor || '#ffffff',
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
        error: 'Failed to create mood board',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/moodboards/:id
 * Get a specific mood board
 */
moodBoardsRouter.get('/:id', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const boardId = parseInt(c.req.param('id'));

    const board = await db
      .select()
      .from(moodBoards)
      .where(eq(moodBoards.id, boardId))
      .get();

    if (!board) {
      return c.json({ error: 'Mood board not found' }, 404);
    }

    return c.json({
      success: true,
      moodBoard: board,
    });
  } catch (error) {
    return c.json(
      {
        error: 'Failed to get mood board',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * PUT /api/moodboards/:id
 * Update a mood board (including layout state)
 */
moodBoardsRouter.put('/:id', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const boardId = parseInt(c.req.param('id'));
    const body = await c.req.json();

    // Check if board exists
    const existing = await db
      .select()
      .from(moodBoards)
      .where(eq(moodBoards.id, boardId))
      .get();

    if (!existing) {
      return c.json({ error: 'Mood board not found' }, 404);
    }

    // Update fields
    const updates: any = {
      datetimeLastModified: Math.floor(Date.now() / 1000),
    };

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.backgroundColor !== undefined)
      updates.backgroundColor = body.backgroundColor;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.layoutState !== undefined) {
      updates.layoutState =
        typeof body.layoutState === 'string'
          ? body.layoutState
          : JSON.stringify(body.layoutState);
    }

    await db
      .update(moodBoards)
      .set(updates)
      .where(eq(moodBoards.id, boardId))
      .run();

    // Get updated record
    const updated = await db
      .select()
      .from(moodBoards)
      .where(eq(moodBoards.id, boardId))
      .get();

    return c.json({
      success: true,
      moodBoard: updated,
    });
  } catch (error) {
    return c.json(
      {
        error: 'Failed to update mood board',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/moodboards/:id
 * Delete a mood board
 */
moodBoardsRouter.delete('/:id', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const boardId = parseInt(c.req.param('id'));

    // Check if board exists
    const existing = await db
      .select()
      .from(moodBoards)
      .where(eq(moodBoards.id, boardId))
      .get();

    if (!existing) {
      return c.json({ error: 'Mood board not found' }, 404);
    }

    await db.delete(moodBoards).where(eq(moodBoards.id, boardId)).run();

    return c.json({
      success: true,
      message: 'Mood board deleted successfully',
    });
  } catch (error) {
    return c.json(
      {
        error: 'Failed to delete mood board',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export { moodBoardsRouter };
