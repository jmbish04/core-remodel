// src/backend/api/routes/intake.ts
/**
 * @fileoverview C2 showroom photo intake wizard (Phase 2) — stage photos for a
 * showroom visit, group them into "buckets" (one bucket = one product), and
 * process a bucket's photos TOGETHER into a single AI extraction.
 *
 *   POST /uploads              — upload N photos for a showroom, staged (no AI yet).
 *   GET  /photos                — staged photos for a showroom, filename-ASC.
 *   POST /buckets               — group photoIds into a new bucket.
 *   PATCH /buckets/:id          — rename/re-kind a bucket, add/remove photos.
 *   GET  /buckets                — buckets for a showroom, each with its photos.
 *   POST /buckets/:id/process   — AI-extract the bucket's photos into ONE product.
 *
 * Mounts at /api/intake (wired in api/index.ts), behind requireAccessAuth.
 * Reuses the same vocab/brand/category/color/product-ensure helpers as
 * `product-photos.ts` (single-photo ingest) via `image-processor/intake-helpers`.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { asc, eq, inArray, and, isNull } from "drizzle-orm";

import { photoCategories, photoColors, productPhotoBuckets, productPriceObservations, productShowroomPhotos } from "@backend/db";
import { ImageProcessorService } from "@backend/services/image-processor";
import { extractShowroomProductFromDescriptions } from "@backend/services/image-processor/product-extraction";
import {
  dataUrlToBlob,
  ensureProductFromExtraction,
  loadExtractionVocab,
  resolveCategoryId,
  resolveOrCreateColorId,
} from "@backend/services/image-processor/intake-helpers";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import { parseDiscountPct, parsePriceCents } from "@backend/lib/money";

export const intakeRouter = new Hono<{ Bindings: Env }>();

// ─── POST /uploads ──────────────────────────────────────────────────────────

/**
 * POST /api/intake/uploads
 * Body: `{ showroomId: number, files: [{ fileName: string, dataUrl: string }] }`.
 *
 * Uploads each file to Cloudflare Images (no AI yet — that happens at
 * "Process with AI" per bucket) and stages a `product_showroom_photos` row per
 * file with `productId=null`, `bucketId=null`, `status='uploaded'`.
 * `sortOrder` is the file's index in the fileName-ASC-sorted batch, so
 * burst-shot photos of one product land adjacent in the UI.
 */
intakeRouter.post("/uploads", async (c) => {
  try {
    const body = await c.req.json<{
      showroomId?: number;
      files?: { fileName?: string; dataUrl?: string }[];
    }>();

    const showroomId = Number(body.showroomId);
    if (!Number.isFinite(showroomId)) {
      return c.json({ error: "showroomId is required (integer)" }, 400);
    }
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      return c.json({ error: "files must be a non-empty array" }, 400);
    }
    for (const f of files) {
      if (!f.fileName || !f.dataUrl) {
        return c.json({ error: "each file requires fileName and dataUrl" }, 400);
      }
    }

    const credentials = await resolveCloudflareImagesCredentials(c.env);
    if (!credentials.accountId || credentials.apiTokens.length === 0) {
      return c.json({ error: "Cloudflare Images credentials not configured" }, 500);
    }
    const processor = new ImageProcessorService(c.env, credentials.accountId, credentials.apiTokens[0], {
      fallbackApiTokens: credentials.apiTokens.slice(1),
    });

    // filename-ASC ordering (burst shots of one product land adjacent).
    const sorted = [...files].sort((a, b) => (a.fileName ?? "").localeCompare(b.fileName ?? ""));

    // Uploads are N independent CF Images API calls — no batch endpoint exists —
    // run them concurrently rather than serially awaiting each one.
    const uploaded = await Promise.all(
      sorted.map(async (f) => {
        const blob = dataUrlToBlob(f.dataUrl!);
        if (!blob) throw new Error(`invalid dataUrl for file "${f.fileName}"`);
        const uploadResponse = await processor.uploadToCloudflareImages(blob, undefined, f.fileName);
        return {
          fileName: f.fileName!,
          imageUrl: processor.getDeliveryUrl(uploadResponse, uploadResponse.result.id),
          cfImageId: uploadResponse.result.id,
        };
      }),
    );

    const db = drizzle(c.env.DB);
    const values = uploaded.map((u, index) => ({
      ragUuid: crypto.randomUUID(),
      productId: null,
      showroomId,
      bucketId: null,
      fileName: u.fileName,
      sortOrder: index,
      imageUrl: u.imageUrl,
      cfImageId: u.cfImageId,
      status: "uploaded" as const,
    }));
    // Chunk inserts: 9 bound params/row vs D1's 100-param cap → ≤11 rows/query.
    const rows: (typeof productShowroomPhotos.$inferSelect)[] = [];
    for (let i = 0; i < values.length; i += 10) {
      const inserted = await db.insert(productShowroomPhotos).values(values.slice(i, i + 10)).returning();
      rows.push(...inserted);
    }

    return c.json({
      photos: rows.map((r) => ({ id: r.id, imageUrl: r.imageUrl, fileName: r.fileName, bucketId: r.bucketId })),
    });
  } catch (error) {
    console.error("Intake upload error:", error);
    return c.json({ error: "Failed to upload photos", details: error instanceof Error ? error.message : "Unknown" }, 500);
  }
});

// ─── GET /photos ────────────────────────────────────────────────────────────

/**
 * GET /api/intake/photos?showroomId=
 * All staged photos for a showroom (bucketed or not), filename-ASC then id.
 */
intakeRouter.get("/photos", async (c) => {
  try {
    const showroomId = Number(c.req.query("showroomId"));
    if (!Number.isFinite(showroomId)) return c.json({ error: "showroomId query param is required (integer)" }, 400);

    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(productShowroomPhotos)
      .where(eq(productShowroomPhotos.showroomId, showroomId))
      .orderBy(asc(productShowroomPhotos.fileName), asc(productShowroomPhotos.id));

    return c.json({
      photos: rows.map((r) => ({ id: r.id, imageUrl: r.imageUrl, fileName: r.fileName, bucketId: r.bucketId })),
    });
  } catch (error) {
    console.error("Intake list photos error:", error);
    return c.json({ error: "Failed to list staged photos" }, 500);
  }
});

// ─── POST /buckets ──────────────────────────────────────────────────────────

/**
 * POST /api/intake/buckets
 * Body: `{ showroomId, kind: 'single'|'multi', label?, photoIds: number[] }`.
 * Creates a `product_photo_buckets` row (status='draft') and assigns the given
 * photos to it. Guard: only photos already belonging to `showroomId` are
 * assigned — stray ids from another showroom are silently ignored.
 */
intakeRouter.post("/buckets", async (c) => {
  try {
    const body = await c.req.json<{
      showroomId?: number;
      kind?: "single" | "multi";
      label?: string;
      photoIds?: number[];
    }>();

    const showroomId = Number(body.showroomId);
    if (!Number.isFinite(showroomId)) return c.json({ error: "showroomId is required (integer)" }, 400);
    if (body.kind !== "single" && body.kind !== "multi") {
      return c.json({ error: "kind must be 'single' or 'multi'" }, 400);
    }
    const photoIds = Array.isArray(body.photoIds) ? body.photoIds.filter((id) => Number.isFinite(id)) : [];
    if (photoIds.length === 0) return c.json({ error: "photoIds must be a non-empty array" }, 400);

    const db = drizzle(c.env.DB);
    const [bucket] = await db
      .insert(productPhotoBuckets)
      .values({ showroomId, kind: body.kind, label: body.label?.trim() || null, status: "draft" })
      .returning();

    await db
      .update(productShowroomPhotos)
      .set({ bucketId: bucket.id })
      .where(and(eq(productShowroomPhotos.showroomId, showroomId), inArray(productShowroomPhotos.id, photoIds)))
      .run();

    const assigned = await db
      .select({ id: productShowroomPhotos.id })
      .from(productShowroomPhotos)
      .where(eq(productShowroomPhotos.bucketId, bucket.id));

    return c.json({
      bucket: { id: bucket.id, kind: bucket.kind, label: bucket.label, status: bucket.status, photoIds: assigned.map((p) => p.id) },
    });
  } catch (error) {
    console.error("Create bucket error:", error);
    return c.json({ error: "Failed to create bucket", details: error instanceof Error ? error.message : "Unknown" }, 500);
  }
});

// ─── PATCH /buckets/:id ─────────────────────────────────────────────────────

/**
 * PATCH /api/intake/buckets/:id
 * Body: `{ label?, kind?, addPhotoIds?: number[], removePhotoIds?: number[] }`.
 * `addPhotoIds` sets bucketId on those photos (guarded to the bucket's own
 * showroom); `removePhotoIds` nulls bucketId, but only for photos currently
 * IN this bucket (can't un-bucket a photo belonging to a different bucket).
 */
intakeRouter.patch("/buckets/:id", async (c) => {
  try {
    const bucketId = Number(c.req.param("id"));
    if (!Number.isFinite(bucketId)) return c.json({ error: "Invalid bucket id" }, 400);

    const body = await c.req.json<{
      label?: string;
      kind?: "single" | "multi";
      addPhotoIds?: number[];
      removePhotoIds?: number[];
    }>();

    const db = drizzle(c.env.DB);
    const [bucket] = await db.select().from(productPhotoBuckets).where(eq(productPhotoBuckets.id, bucketId)).limit(1);
    if (!bucket) return c.json({ error: "Bucket not found" }, 404);

    const fieldUpdates: Partial<typeof productPhotoBuckets.$inferInsert> = {};
    if (body.label !== undefined) fieldUpdates.label = body.label?.trim() || null;
    if (body.kind !== undefined) {
      if (body.kind !== "single" && body.kind !== "multi") return c.json({ error: "kind must be 'single' or 'multi'" }, 400);
      fieldUpdates.kind = body.kind;
    }
    if (Object.keys(fieldUpdates).length > 0) {
      await db.update(productPhotoBuckets).set(fieldUpdates).where(eq(productPhotoBuckets.id, bucketId)).run();
    }

    const addIds = Array.isArray(body.addPhotoIds) ? body.addPhotoIds.filter((id) => Number.isFinite(id)) : [];
    if (addIds.length > 0) {
      await db
        .update(productShowroomPhotos)
        .set({ bucketId })
        .where(
          and(
            // bucket.showroomId is nullable (online/manufacturer intake) — NULL = NULL is
            // never true in SQLite, so match with isNull rather than eq in that case.
            bucket.showroomId == null
              ? isNull(productShowroomPhotos.showroomId)
              : eq(productShowroomPhotos.showroomId, bucket.showroomId),
            inArray(productShowroomPhotos.id, addIds),
          ),
        )
        .run();
    }

    const removeIds = Array.isArray(body.removePhotoIds) ? body.removePhotoIds.filter((id) => Number.isFinite(id)) : [];
    if (removeIds.length > 0) {
      await db
        .update(productShowroomPhotos)
        .set({ bucketId: null })
        .where(and(eq(productShowroomPhotos.bucketId, bucketId), inArray(productShowroomPhotos.id, removeIds)))
        .run();
    }

    const [updatedBucket] = await db.select().from(productPhotoBuckets).where(eq(productPhotoBuckets.id, bucketId)).limit(1);
    const photos = await db
      .select({ id: productShowroomPhotos.id })
      .from(productShowroomPhotos)
      .where(eq(productShowroomPhotos.bucketId, bucketId));

    return c.json({
      bucket: {
        id: updatedBucket.id,
        kind: updatedBucket.kind,
        label: updatedBucket.label,
        status: updatedBucket.status,
        photoIds: photos.map((p) => p.id),
      },
    });
  } catch (error) {
    console.error("Update bucket error:", error);
    return c.json({ error: "Failed to update bucket", details: error instanceof Error ? error.message : "Unknown" }, 500);
  }
});

// ─── GET /buckets ───────────────────────────────────────────────────────────

/**
 * GET /api/intake/buckets?showroomId=
 * Every bucket for the showroom, each with its photos (filename-ASC).
 */
intakeRouter.get("/buckets", async (c) => {
  try {
    const showroomId = Number(c.req.query("showroomId"));
    if (!Number.isFinite(showroomId)) return c.json({ error: "showroomId query param is required (integer)" }, 400);

    const db = drizzle(c.env.DB);
    const buckets = await db.select().from(productPhotoBuckets).where(eq(productPhotoBuckets.showroomId, showroomId));
    if (buckets.length === 0) return c.json({ buckets: [] });

    const bucketIds = buckets.map((b) => b.id);
    const photos = await db
      .select()
      .from(productShowroomPhotos)
      .where(inArray(productShowroomPhotos.bucketId, bucketIds))
      .orderBy(asc(productShowroomPhotos.fileName), asc(productShowroomPhotos.id));

    const photosByBucket = new Map<number, { id: number; imageUrl: string | null; fileName: string | null }[]>();
    for (const p of photos) {
      const key = p.bucketId as number;
      if (!photosByBucket.has(key)) photosByBucket.set(key, []);
      photosByBucket.get(key)!.push({ id: p.id, imageUrl: p.imageUrl, fileName: p.fileName });
    }

    return c.json({
      buckets: buckets.map((b) => ({
        id: b.id,
        kind: b.kind,
        label: b.label,
        status: b.status,
        productId: b.productId,
        photos: photosByBucket.get(b.id) ?? [],
      })),
    });
  } catch (error) {
    console.error("List buckets error:", error);
    return c.json({ error: "Failed to list buckets" }, 500);
  }
});

// ─── POST /buckets/:id/process ──────────────────────────────────────────────

/**
 * POST /api/intake/buckets/:id/process
 * Processes ALL of a bucket's photos TOGETHER into ONE product:
 *   1. Vision-describe each photo, then run ONE structured extraction over the
 *      combined descriptions (see `extractShowroomProductFromDescriptions` —
 *      "multi-image single-pass" MVP, ponytail-documented there).
 *   2. Find-or-create the product from that extraction.
 *   3. Write `photo_categories` / `photo_colors` mappings for every photo in
 *      the bucket, and a price observation if a price was read.
 *   4. Mark bucket + photos `status='processed'`.
 *
 * Sets `status='processing'` up front (also guards against double-submission)
 * and reverts to `'draft'` on any failure — never left stuck mid-flight.
 */
intakeRouter.post("/buckets/:id/process", async (c) => {
  const bucketId = Number(c.req.param("id"));
  if (!Number.isFinite(bucketId)) return c.json({ error: "Invalid bucket id" }, 400);

  const db = drizzle(c.env.DB);
  const [bucket] = await db.select().from(productPhotoBuckets).where(eq(productPhotoBuckets.id, bucketId)).limit(1);
  if (!bucket) return c.json({ error: "Bucket not found" }, 404);
  if (bucket.status === "processing") return c.json({ error: "Bucket is already processing" }, 409);

  const photos = await db.select().from(productShowroomPhotos).where(eq(productShowroomPhotos.bucketId, bucketId));
  if (photos.length === 0) return c.json({ error: "Bucket has no photos" }, 400);

  await db.update(productPhotoBuckets).set({ status: "processing" }).where(eq(productPhotoBuckets.id, bucketId)).run();

  try {
    // 1. Describe every photo, then one structured pass over all descriptions.
    const service = new ImageProcessorService(c.env, "", "");
    const descriptions = await Promise.all(
      photos.map((p) => {
        if (!p.imageUrl) throw new Error(`photo ${p.id} has no imageUrl`);
        return service.describeImage(p.imageUrl);
      }),
    );
    const vocab = await loadExtractionVocab(db);
    const attrs = await extractShowroomProductFromDescriptions(c.env, descriptions, vocab);

    // 2. Find-or-create the single product this bucket depicts.
    const { product } = await ensureProductFromExtraction(db, attrs);

    // 3. Resolve category + colors ONCE, then map every photo in the bucket to them.
    const categoryId = await resolveCategoryId(db, attrs.category);
    const colorIds: number[] = [];
    if (attrs.colors && attrs.colors.length > 0) {
      const uniqueColors = new Map(attrs.colors.map((cAttr) => [cAttr.name.trim().toLowerCase(), cAttr]));
      for (const cAttr of uniqueColors.values()) {
        if (!cAttr.name.trim()) continue;
        colorIds.push(await resolveOrCreateColorId(db, cAttr.name, cAttr.hexCode));
      }
    }
    for (const photo of photos) {
      if (categoryId != null) {
        await db.insert(photoCategories).values({ photoId: photo.id, categoryId }).onConflictDoNothing();
      }
      for (const colorId of colorIds) {
        await db.insert(photoColors).values({ photoId: photo.id, colorId }).onConflictDoNothing();
      }
    }

    // 4. One price observation for the bucket (product-level, sourced off the
    //    first/representative photo) if a price was actually read.
    if (attrs.price) {
      await db.insert(productPriceObservations).values({
        productId: product.id,
        sourceType: "showroom",
        showroomId: bucket.showroomId,
        price: attrs.price,
        salePrice: attrs.salePrice,
        discountInfo: attrs.discountInfo,
        priceCents: parsePriceCents(attrs.price),
        salePriceCents: parsePriceCents(attrs.salePrice),
        discountPct: parseDiscountPct(attrs.discountInfo),
        sourcePhotoId: photos[0].id,
        // confidence column is NOT NULL (default 100) — attrs.confidence is
        // nullable (the extraction schema allows "unsure"), so coalesce.
        confidence: attrs.confidence ?? 100,
        reviewStatus: "pending",
      });
    }

    // 5. Mark bucket + photos processed.
    await db
      .update(productShowroomPhotos)
      .set({ productId: product.id, status: "processed", attributes: attrs })
      .where(eq(productShowroomPhotos.bucketId, bucketId))
      .run();
    await db
      .update(productPhotoBuckets)
      .set({ productId: product.id, status: "processed" })
      .where(eq(productPhotoBuckets.id, bucketId))
      .run();

    return c.json({ bucketId, productId: product.id, status: "processed", attributes: attrs });
  } catch (error) {
    console.error("Bucket process error:", error);
    // Never leave the bucket stuck in 'processing' — revert to 'draft' so the
    // wizard can retry.
    await db.update(productPhotoBuckets).set({ status: "draft" }).where(eq(productPhotoBuckets.id, bucketId)).run();
    return c.json(
      { error: "Failed to process bucket", details: error instanceof Error ? error.message : "Unknown" },
      500,
    );
  }
});
