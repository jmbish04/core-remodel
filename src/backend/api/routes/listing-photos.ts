/**
 * @fileoverview Listing Photos API routes
 */

import { Hono } from 'hono';
import type { Bindings } from '../index';
import { drizzle } from 'drizzle-orm/d1';
import { listingPhotos, aiEdits } from '../../db/schema';
import { eq } from 'drizzle-orm';

const listingPhotosRouter = new Hono<{ Bindings: Bindings }>();

/**
 * GET /api/listing-photos
 * List all listing photos
 */
listingPhotosRouter.get('/', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photos = await db.select().from(listingPhotos).all();

    return c.json({
      success: true,
      count: photos.length,
      listingPhotos: photos,
    });
  } catch (error) {
    return c.json(
      {
        error: 'Failed to list listing photos',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/listing-photos
 * Add a new listing photo
 */
listingPhotosRouter.post('/', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = await c.req.json();

    const { cfImageId, roomName, description } = body;

    if (!cfImageId || !roomName) {
      return c.json({ error: 'cfImageId and roomName are required' }, 400);
    }

    const result = await db
      .insert(listingPhotos)
      .values({
        cfImageId,
        roomName,
        description: description || null,
      })
      .returning()
      .get();

    return c.json({
      success: true,
      listingPhoto: result,
    });
  } catch (error) {
    return c.json(
      {
        error: 'Failed to create listing photo',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/listing-photos/:id/edit
 * Generate an AI-edited version of a listing photo
 */
listingPhotosRouter.post('/:id/edit', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param('id'));
    const body = await c.req.json();

    const { prompt } = body;

    if (!prompt) {
      return c.json({ error: 'Prompt is required' }, 400);
    }

    // Check if listing photo exists
    const listingPhoto = await db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.id, photoId))
      .get();

    if (!listingPhoto) {
      return c.json({ error: 'Listing photo not found' }, 404);
    }

    // TODO: Implement actual AI image editing
    // For now, we'll create a placeholder record
    // In production, you would:
    // 1. Fetch the original image from Cloudflare Images
    // 2. Use Workers AI (e.g., FLUX model) to generate the edited version
    // 3. Upload the result to Cloudflare Images
    // 4. Store the reference in the aiEdits table

    const placeholderEditedImageId = `edited-${listingPhoto.cfImageId}-${Date.now()}`;

    const edit = await db
      .insert(aiEdits)
      .values({
        originalListingId: photoId,
        prompt,
        generatedCfImageId: placeholderEditedImageId,
      })
      .returning()
      .get();

    return c.json({
      success: true,
      message: 'AI edit created (placeholder)',
      edit,
      note: 'In production, this would generate an actual AI-edited image',
    });
  } catch (error) {
    return c.json(
      {
        error: 'Failed to create AI edit',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/listing-photos/:id/edits
 * Get all AI edits for a listing photo
 */
listingPhotosRouter.get('/:id/edits', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param('id'));

    const edits = await db
      .select()
      .from(aiEdits)
      .where(eq(aiEdits.originalListingId, photoId))
      .all();

    return c.json({
      success: true,
      count: edits.length,
      edits,
    });
  } catch (error) {
    return c.json(
      {
        error: 'Failed to get AI edits',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/listing-photos/:id
 * Delete a listing photo
 */
listingPhotosRouter.delete('/:id', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param('id'));

    // Check if exists
    const existing = await db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.id, photoId))
      .get();

    if (!existing) {
      return c.json({ error: 'Listing photo not found' }, 404);
    }

    // Delete (cascade will handle aiEdits)
    await db.delete(listingPhotos).where(eq(listingPhotos.id, photoId)).run();

    return c.json({
      success: true,
      message: 'Listing photo deleted successfully',
    });
  } catch (error) {
    return c.json(
      {
        error: 'Failed to delete listing photo',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export { listingPhotosRouter };
