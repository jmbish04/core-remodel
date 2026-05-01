/**
 * @fileoverview Images API routes for remodel mood board
 */

import { Hono } from 'hono';
import type { Bindings } from '../index';
import { ImageProcessorService } from '../../services/image-processor';
import { drizzle } from 'drizzle-orm/d1';
import { images } from '../../db/schema';
import { eq } from 'drizzle-orm';

const imagesRouter = new Hono<{ Bindings: Bindings }>();

/**
 * POST /api/images/upload
 * Upload images with AI analysis
 */
imagesRouter.post('/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const files: File[] = [];

    // Extract all files from form data
    for (const [_key, value] of formData.entries()) {
      if (value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return c.json({ error: 'No files provided' }, 400);
    }

    // Check for account credentials
    const accountId = c.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = c.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      return c.json(
        { error: 'Cloudflare credentials not configured' },
        500
      );
    }

    // Initialize image processor service
    const processor = new ImageProcessorService(
      c.env.AI,
      c.env.VECTOR_INDEX,
      c.env.DB,
      accountId,
      apiToken
    );

    // Process all images
    const isListingPhoto = formData.get('isListingPhoto') === 'true';
    const results = await processor.processBulkImages(files, isListingPhoto);

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    return c.json({
      success: true,
      message: `Processed ${results.length} images: ${successCount} successful, ${failureCount} failed`,
      results,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return c.json(
      {
        error: 'Failed to process images',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/images
 * List all images with optional filters
 */
imagesRouter.get('/', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const roomType = c.req.query('roomType');
    const isInstagram = c.req.query('isInstagram');
    const isListingPhoto = c.req.query('isListingPhoto');

    let query = db.select().from(images);

    // Apply filters (this is simplified - in production use proper query builder)
    const allImages = await query.all();

    let filtered = allImages;

    if (roomType) {
      filtered = filtered.filter((img) => img.roomType === roomType);
    }

    if (isInstagram !== undefined) {
      const instagramFilter = isInstagram === 'true';
      filtered = filtered.filter((img) => img.isInstagram === instagramFilter);
    }

    if (isListingPhoto !== undefined) {
      const listingFilter = isListingPhoto === 'true';
      filtered = filtered.filter((img) => img.isListingPhoto === listingFilter);
    }

    return c.json({
      success: true,
      count: filtered.length,
      images: filtered,
    });
  } catch (error) {
    console.error('List images error:', error);
    return c.json(
      {
        error: 'Failed to list images',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/images/:id
 * Get a specific image by ID
 */
imagesRouter.get('/:id', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const imageId = c.req.param('id');

    const result = await db
      .select()
      .from(images)
      .where(eq(images.id, imageId))
      .get();

    if (!result) {
      return c.json({ error: 'Image not found' }, 404);
    }

    return c.json({
      success: true,
      image: result,
    });
  } catch (error) {
    console.error('Get image error:', error);
    return c.json(
      {
        error: 'Failed to get image',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * PUT /api/images/:id
 * Update image metadata
 */
imagesRouter.put('/:id', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const imageId = c.req.param('id');
    const body = await c.req.json();

    // Check if image exists
    const existing = await db
      .select()
      .from(images)
      .where(eq(images.id, imageId))
      .get();

    if (!existing) {
      return c.json({ error: 'Image not found' }, 404);
    }

    // Update allowed fields
    const updates: any = {};
    if (body.roomType !== undefined) updates.roomType = body.roomType;
    if (body.instagramAccount !== undefined)
      updates.instagramAccount = body.instagramAccount;
    if (body.instagramCaption !== undefined)
      updates.instagramCaption = body.instagramCaption;
    if (body.metadata !== undefined)
      updates.metadata =
        typeof body.metadata === 'string'
          ? body.metadata
          : JSON.stringify(body.metadata);

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400);
    }

    await db.update(images).set(updates).where(eq(images.id, imageId)).run();

    // Get updated record
    const updated = await db
      .select()
      .from(images)
      .where(eq(images.id, imageId))
      .get();

    return c.json({
      success: true,
      image: updated,
    });
  } catch (error) {
    console.error('Update image error:', error);
    return c.json(
      {
        error: 'Failed to update image',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/images/:id
 * Delete an image
 */
imagesRouter.delete('/:id', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const imageId = c.req.param('id');

    // Check if image exists
    const existing = await db
      .select()
      .from(images)
      .where(eq(images.id, imageId))
      .get();

    if (!existing) {
      return c.json({ error: 'Image not found' }, 404);
    }

    // Delete from D1
    await db.delete(images).where(eq(images.id, imageId)).run();

    // Note: In production, you'd also want to:
    // 1. Delete from Cloudflare Images
    // 2. Delete from Vectorize
    // But for now, we'll just remove from D1

    return c.json({
      success: true,
      message: 'Image deleted successfully',
    });
  } catch (error) {
    console.error('Delete image error:', error);
    return c.json(
      {
        error: 'Failed to delete image',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/images/search
 * Semantic search for images
 */
imagesRouter.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const { query, topK = 10 } = body;

    if (!query) {
      return c.json({ error: 'Query is required' }, 400);
    }

    const accountId = c.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = c.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      return c.json(
        { error: 'Cloudflare credentials not configured' },
        500
      );
    }

    const processor = new ImageProcessorService(
      c.env.AI,
      c.env.VECTOR_INDEX,
      c.env.DB,
      accountId,
      apiToken
    );

    const results = await processor.searchImages(query, topK);

    // Fetch full image details from D1
    const db = drizzle(c.env.DB);
    const imageIds = results.matches.map((m) => m.id);

    const imageDetails = await Promise.all(
      imageIds.map((id) =>
        db.select().from(images).where(eq(images.id, id)).get()
      )
    );

    return c.json({
      success: true,
      query,
      count: results.matches.length,
      results: results.matches.map((match, idx) => ({
        ...match,
        image: imageDetails[idx],
      })),
    });
  } catch (error) {
    console.error('Search error:', error);
    return c.json(
      {
        error: 'Failed to search images',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export { imagesRouter };
