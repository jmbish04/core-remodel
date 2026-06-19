/**
 * Photo Viewer Notes API — contractor/professional feedback on images.
 *
 * Routes (mounted at /api/images):
 *   GET  /:imageId/viewer-notes  → list notes for an image (newest first)
 *   POST /:imageId/viewer-notes  → create a new note
 *
 * These endpoints are intentionally PUBLIC (no requireAccessAuth) — the photo
 * collection viewport is designed for read-only contractor/vendor access. The
 * only data written is the note text + a display-name / role pair that the
 * caller self-reports (no session/auth FK).
 */

import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { photoViewerNotes } from "@backend/db/schema";

const photoViewerNotesRouter = new Hono<{ Bindings: Env }>();

/**
 * GET /:imageId/viewer-notes
 *
 * Returns all notes for the given image, ordered newest-first.
 * Response: `{ success: true, notes: PhotoViewerNote[] }`
 */
photoViewerNotesRouter.get("/:imageId/viewer-notes", async (c) => {
  const imageId = c.req.param("imageId");
  if (!imageId) {
    return c.json({ success: false, error: "imageId is required" }, 400);
  }

  const db = drizzle(c.env.DB);
  const notes = await db
    .select()
    .from(photoViewerNotes)
    .where(eq(photoViewerNotes.imageId, imageId))
    .orderBy(desc(photoViewerNotes.datetimeCreated));

  return c.json({ success: true, notes });
});

/**
 * POST /:imageId/viewer-notes
 *
 * Creates a new note for the given image.
 * Body: `{ authorName?: string, authorRole?: string, noteText: string }`
 * Response: `{ success: true, note: PhotoViewerNote }`
 */
photoViewerNotesRouter.post("/:imageId/viewer-notes", async (c) => {
  const imageId = c.req.param("imageId");
  if (!imageId) {
    return c.json({ success: false, error: "imageId is required" }, 400);
  }

  let body: { authorName?: string; authorRole?: string; noteText?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const noteText = typeof body.noteText === "string" ? body.noteText.trim() : "";
  if (!noteText) {
    return c.json({ success: false, error: "noteText is required" }, 400);
  }

  const authorName =
    typeof body.authorName === "string" && body.authorName.trim()
      ? body.authorName.trim()
      : null;
  const authorRole =
    typeof body.authorRole === "string" && body.authorRole.trim()
      ? body.authorRole.trim()
      : null;

  const db = drizzle(c.env.DB);
  const [created] = await db
    .insert(photoViewerNotes)
    .values({
      imageId,
      authorName,
      authorRole,
      noteText,
    } as typeof photoViewerNotes.$inferInsert)
    .returning();

  return c.json({ success: true, note: created }, 201);
});

export { photoViewerNotesRouter };
