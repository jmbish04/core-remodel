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
 *   GET  /review-queue          — Phase-3: every 'processed' bucket, all showrooms.
 *   POST /buckets/:id/review    — Phase-3: approve (finalize product+mappings+price)
 *                                 or reject (with reason) a bucket.
 *   POST /buckets/:id/regions   — Phase-4: mask a `multi` bucket's wide source
 *                                 photo into N per-product crops, each its own
 *                                 new `single` bucket.
 *
 * Mounts at /api/intake (wired in api/index.ts), behind requireAccessAuth.
 * Reuses the same vocab/brand/category/color/product-ensure helpers as
 * `product-photos.ts` (single-photo ingest) via `image-processor/intake-helpers`,
 * and the config mapping-replace helper from `config.ts`.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { asc, desc, eq, inArray, and, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  brandCategories,
  bucketProductCandidates,
  photoCategories,
  photoColors,
  photoSubcategories,
  productPhotoBuckets,
  productPriceObservations,
  productShowroomPhotos,
  scrapingSitemap,
  showroomProductMappings,
  showroomStoreProducts,
} from "@backend/db";
import { createResearchJob } from "@backend/services/research-jobs";
import {
  cacheSitemap,
  getFreshSitemap,
  type SitemapContext,
} from "@backend/services/scraping/sitemap-cache";
import { discoverSitemap } from "@backend/services/brands/brand-image-harvest";
import { transcribeAudioBase64 } from "@backend/services/estimate-intake";
import { summarizeStyleReaction } from "@backend/services/reaction-summary";
import { ImageProcessorService } from "@backend/services/image-processor";
import { cropAndUploadCfImage } from "@backend/services/render/cf-images";
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
import { normalizeModelKey } from "@backend/lib/normalize-model";
import { replaceMapping } from "./config";

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
/**
 * Per-stack hints a user optionally fills in while grouping (Phase A′). Shared
 * by POST and PATCH so the two paths accept exactly the same fields.
 */
interface BucketHintInput {
  brandId?: number | null;
  brandNameRaw?: string | null;
  productName?: string | null;
  modelNumber?: string | null;
  sku?: string | null;
  productUrl?: string | null;
}

/** Pull the hint fields from a request body into a Drizzle-ready patch,
 *  trimming strings to null. Only keys present on `body` are included, so a
 *  PATCH that omits a field leaves it untouched. */
function readBucketHints(body: BucketHintInput): Partial<typeof productPhotoBuckets.$inferInsert> {
  const patch: Partial<typeof productPhotoBuckets.$inferInsert> = {};
  const str = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  if ("brandId" in body) patch.brandId = Number.isFinite(body.brandId) ? Number(body.brandId) : null;
  if ("brandNameRaw" in body) patch.brandNameRaw = str(body.brandNameRaw);
  if ("productName" in body) patch.productName = str(body.productName);
  if ("modelNumber" in body) patch.modelNumber = str(body.modelNumber);
  if ("sku" in body) patch.sku = str(body.sku);
  if ("productUrl" in body) patch.productUrl = str(body.productUrl);
  return patch;
}

/**
 * A bucket is "ready for workflow" (Phase C) once it carries enough to start a
 * scrape: a brand (matched OR free-typed) OR a direct product URL. This is a
 * derived signal only — nothing is blocked at grouping time.
 */
function bucketReadyForWorkflow(b: {
  brandId: number | null;
  brandNameRaw: string | null;
  productUrl: string | null;
}): boolean {
  return b.brandId != null || !!b.brandNameRaw || !!b.productUrl;
}

/** Hint fields echoed back in every bucket DTO, so the UI round-trips them. */
function bucketHintDto(b: typeof productPhotoBuckets.$inferSelect) {
  return {
    brandId: b.brandId,
    brandNameRaw: b.brandNameRaw,
    productName: b.productName,
    modelNumber: b.modelNumber,
    sku: b.sku,
    productUrl: b.productUrl,
    readyForWorkflow: bucketReadyForWorkflow(b),
  };
}

intakeRouter.post("/buckets", async (c) => {
  try {
    const body = await c.req.json<{
      showroomId?: number;
      kind?: "single" | "multi";
      label?: string;
      photoIds?: number[];
    } & BucketHintInput>();

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
      .values({
        showroomId,
        kind: body.kind,
        label: body.label?.trim() || null,
        status: "draft",
        ...readBucketHints(body),
      })
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
      bucket: {
        id: bucket.id,
        kind: bucket.kind,
        label: bucket.label,
        status: bucket.status,
        photoIds: assigned.map((p) => p.id),
        ...bucketHintDto(bucket),
      },
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
    } & BucketHintInput>();

    const db = drizzle(c.env.DB);
    const [bucket] = await db.select().from(productPhotoBuckets).where(eq(productPhotoBuckets.id, bucketId)).limit(1);
    if (!bucket) return c.json({ error: "Bucket not found" }, 404);

    // Hint fields first, then label/kind on top — same object, one update.
    const fieldUpdates: Partial<typeof productPhotoBuckets.$inferInsert> = readBucketHints(body);
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
        ...bucketHintDto(updatedBucket),
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
    // Chunk the id list: one bound param per id vs D1's 100-param cap.
    const photos: (typeof productShowroomPhotos.$inferSelect)[] = [];
    for (let i = 0; i < bucketIds.length; i += 90) {
      const chunk = await db
        .select()
        .from(productShowroomPhotos)
        .where(inArray(productShowroomPhotos.bucketId, bucketIds.slice(i, i + 90)))
        .orderBy(asc(productShowroomPhotos.fileName), asc(productShowroomPhotos.id));
      photos.push(...chunk);
    }

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
        ...bucketHintDto(b),
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

// ─── POST /buckets/:id/intake ────────────────────────────────────────────────

/**
 * POST /api/intake/buckets/:id/intake — Phase C.
 *
 * Kick the durable BucketIntakeWorkflow: it describes the bucket's photos,
 * extracts 0-N product *candidates* (using the per-stack hints), and writes
 * `bucket_product_candidates` for later human review — instead of the inline
 * `/process` path that force-creates exactly one product.
 *
 * Pre-creates a research-console job so the UI can poll `GET
 * /api/research-jobs/{id}` immediately. Returns `{ queued, researchJobId }`.
 */
intakeRouter.post("/buckets/:id/intake", async (c) => {
  const bucketId = Number(c.req.param("id"));
  if (!Number.isFinite(bucketId)) return c.json({ error: "Invalid bucket id" }, 400);

  const db = drizzle(c.env.DB);
  const [bucket] = await db
    .select()
    .from(productPhotoBuckets)
    .where(eq(productPhotoBuckets.id, bucketId))
    .limit(1);
  if (!bucket) return c.json({ error: "Bucket not found" }, 404);
  if (bucket.status === "processing") return c.json({ error: "Bucket is already processing" }, 409);

  const photoCount = (
    await db
      .select({ id: productShowroomPhotos.id })
      .from(productShowroomPhotos)
      .where(eq(productShowroomPhotos.bucketId, bucketId))
  ).length;
  if (photoCount === 0) return c.json({ error: "Bucket has no photos" }, 400);

  const researchJobId = await createResearchJob(c.env, {
    kind: "product",
    title: `Bucket intake — ${bucket.label ?? `#${bucketId}`}`,
    topic: bucket.productName ?? bucket.brandNameRaw ?? bucket.label ?? null,
    entityId: bucketId,
    totalSteps: 5,
  });

  await c.env.BUCKET_INTAKE_WORKFLOW.create({
    params: { bucketId, researchJobId: researchJobId ?? undefined },
  });

  return c.json({ queued: true, bucketId, researchJobId });
});

// ─── GET /buckets/:id/candidates ─────────────────────────────────────────────

/**
 * GET /api/intake/buckets/:id/candidates — Phase C.
 * The candidate rows the workflow produced, rank-ASC. `colors` / `rawExtraction`
 * are parsed back from their stored JSON. Feeds the HITL walkthrough (Phase D/E).
 */
intakeRouter.get("/buckets/:id/candidates", async (c) => {
  const bucketId = Number(c.req.param("id"));
  if (!Number.isFinite(bucketId)) return c.json({ error: "Invalid bucket id" }, 400);

  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(bucketProductCandidates)
    .where(eq(bucketProductCandidates.bucketId, bucketId))
    .orderBy(asc(bucketProductCandidates.rank));

  const parseJson = (s: string | null): unknown => {
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  const candidates = rows.map((r) => ({
    ...r,
    colors: parseJson(r.colors),
    imageSourceUrls: parseJson(r.imageSourceUrls),
    pdfSourceUrls: parseJson(r.pdfSourceUrls),
    reactionSummary: parseJson(r.reactionSummary),
    rawExtraction: parseJson(r.rawExtraction),
  }));

  return c.json({ bucketId, candidates });
});

// ─── Candidate reactions + confirm/reject (Phase D1) ─────────────────────────

/** Load one candidate row by id, or null. */
async function loadCandidate(db: ReturnType<typeof drizzle>, id: number) {
  const [row] = await db
    .select()
    .from(bucketProductCandidates)
    .where(eq(bucketProductCandidates.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * PATCH /api/intake/candidates/:id/reaction — Phase D1.
 * Record the human's reaction to ONE candidate: match (y/n), like (y/n), stars
 * (1-5). All fields optional; only those present are updated. Reactions are kept
 * even on non-matches — that's the style-training signal.
 */
intakeRouter.patch("/candidates/:id/reaction", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Invalid candidate id" }, 400);
  const body = await c.req.json().catch(() => ({}));

  const patch: Partial<typeof bucketProductCandidates.$inferInsert> = {};
  if (typeof body.isMatch === "boolean") patch.isMatch = body.isMatch;
  if (typeof body.liked === "boolean") patch.liked = body.liked;
  if (body.stars === null) patch.stars = null;
  else if (Number.isInteger(body.stars)) {
    if (body.stars < 1 || body.stars > 5) return c.json({ error: "stars must be 1-5 or null" }, 400);
    patch.stars = body.stars;
  }
  if (Object.keys(patch).length === 0) return c.json({ error: "no reaction fields provided" }, 400);

  const db = drizzle(c.env.DB);
  const existing = await loadCandidate(db, id);
  if (!existing) return c.json({ error: "Candidate not found" }, 404);

  await db.update(bucketProductCandidates).set(patch).where(eq(bucketProductCandidates.id, id));
  const updated = await loadCandidate(db, id);
  return c.json({ candidate: updated });
});

/**
 * POST /api/intake/candidates/:id/reject — Phase D1.
 * Mark a candidate rejected. It is KEPT (not deleted) — rejected candidates are
 * retained as negative style signal.
 */
intakeRouter.post("/candidates/:id/reject", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Invalid candidate id" }, 400);

  const db = drizzle(c.env.DB);
  const existing = await loadCandidate(db, id);
  if (!existing) return c.json({ error: "Candidate not found" }, 404);

  await db
    .update(bucketProductCandidates)
    .set({ status: "rejected", isMatch: false })
    .where(eq(bucketProductCandidates.id, id));
  return c.json({ candidate: await loadCandidate(db, id) });
});

/**
 * POST /api/intake/candidates/:id/confirm — Phase D1.
 * Promote a candidate into a REAL product (this is the only place a product /
 * brand is created from the intake pipeline). Ensures the brand + product exist,
 * maps the product to the bucket's showroom, links the bucket, and records
 * `confirmed_product_id` + status 'confirmed' on the candidate.
 */
intakeRouter.post("/candidates/:id/confirm", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Invalid candidate id" }, 400);

  const db = drizzle(c.env.DB);
  const cand = await loadCandidate(db, id);
  if (!cand) return c.json({ error: "Candidate not found" }, 404);
  if (cand.confirmedProductId) {
    return c.json({ error: "Candidate already confirmed", productId: cand.confirmedProductId }, 409);
  }

  let colors: { name: string; hexCode?: string | null }[] | null = null;
  try {
    colors = cand.colors ? JSON.parse(cand.colors) : null;
  } catch {
    colors = null;
  }

  // Map the candidate onto the extraction shape ensureProductFromExtraction wants.
  // resolveBrandId inside it is find-or-create, so the brand is minted here too.
  const { product, created } = await ensureProductFromExtraction(db, {
    brand: cand.brandNameRaw,
    modelNumber: cand.modelNumber,
    itemName: cand.productName,
    colors,
    style: cand.style,
    category: cand.category,
    price: cand.priceText,
    salePrice: cand.salePriceText,
    discountInfo: cand.discountText,
    photoKind: null,
    dominantColors: null,
    confidence: cand.confidence ?? null,
  });

  // Load the bucket for its showroom, to map the product to that location.
  const [bucket] = await db
    .select()
    .from(productPhotoBuckets)
    .where(eq(productPhotoBuckets.id, cand.bucketId))
    .limit(1);

  if (bucket?.showroomId) {
    await db
      .insert(showroomProductMappings)
      .values({ showroomId: bucket.showroomId, productId: product.id })
      .onConflictDoNothing();
  }
  if (bucket) {
    await db
      .update(productPhotoBuckets)
      .set({ productId: product.id, status: "reviewed" })
      .where(eq(productPhotoBuckets.id, bucket.id));
  }

  await db
    .update(bucketProductCandidates)
    .set({ confirmedProductId: product.id, status: "confirmed", isMatch: true })
    .where(eq(bucketProductCandidates.id, id));

  return c.json({
    productId: product.id,
    productCreated: created,
    candidate: await loadCandidate(db, id),
  });
});

/**
 * POST /api/intake/candidates/:id/voice-reaction — Phase D2.
 * Attach a spoken (or typed) reaction to a candidate: transcribe the audio with
 * Whisper (or accept a `transcript` directly), distill it into a compact style
 * summary, and store both on the candidate. Body: { audioBase64 } | { transcript }.
 */
intakeRouter.post("/candidates/:id/voice-reaction", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Invalid candidate id" }, 400);
  const body = await c.req.json().catch(() => ({}));

  const db = drizzle(c.env.DB);
  const cand = await loadCandidate(db, id);
  if (!cand) return c.json({ error: "Candidate not found" }, 404);

  // Accept a direct transcript (typed reaction / retry) or transcribe audio.
  let transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
    if (!audioBase64) return c.json({ error: "audioBase64 or transcript is required" }, 400);
    try {
      transcript = (await transcribeAudioBase64(c.env, audioBase64)).trim();
    } catch (err) {
      return c.json({ error: "Transcription failed", details: err instanceof Error ? err.message : "Unknown" }, 502);
    }
  }
  if (!transcript) return c.json({ error: "Empty transcript" }, 400);

  const summary = await summarizeStyleReaction(c.env, transcript, {
    productName: cand.productName,
    brandName: cand.brandNameRaw,
  });

  await db
    .update(bucketProductCandidates)
    .set({ reactionTranscript: transcript, reactionSummary: JSON.stringify(summary) })
    .where(eq(bucketProductCandidates.id, id));

  return c.json({ candidate: await loadCandidate(db, id), transcript, summary });
});

// ─── Sitemaps (Phase B) ──────────────────────────────────────────────────────

/** Build a SitemapContext from a body/query, or return an error string. */
function readSitemapContext(input: {
  scrapeJobType?: unknown;
  brandId?: unknown;
  showroomId?: unknown;
  productId?: unknown;
}): SitemapContext | { error: string } {
  const type = input.scrapeJobType;
  if (type !== "brand" && type !== "showroom" && type !== "product") {
    return { error: "scrapeJobType must be one of brand|showroom|product" };
  }
  const num = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
  const ctx: SitemapContext = {
    scrapeJobType: type,
    brandId: num(input.brandId),
    showroomId: num(input.showroomId),
    productId: num(input.productId),
  };
  const ownerId =
    type === "brand" ? ctx.brandId : type === "showroom" ? ctx.showroomId : ctx.productId;
  if (ownerId == null) return { error: `${type}Id is required for scrapeJobType='${type}'` };
  return ctx;
}

/**
 * POST /api/intake/sitemaps/discover — Phase B.
 * Discover a site's page list, reusing a fresh cached row when present. Persists
 * a `scraping_sitemap` row on a miss. Body: { scrapeJobType, brandId|showroomId|
 * productId, websiteUrl }. Returns { cached, pageUrls, count, sitemapUrl, status }.
 */
intakeRouter.post("/sitemaps/discover", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ctx = readSitemapContext(body);
  if ("error" in ctx) return c.json({ error: ctx.error }, 400);
  const websiteUrl = typeof body.websiteUrl === "string" ? body.websiteUrl.trim() : "";
  if (!websiteUrl) return c.json({ error: "websiteUrl is required" }, 400);

  const db = drizzle(c.env.DB);

  const cached = await getFreshSitemap(db, ctx, websiteUrl).catch(() => null);
  if (cached) {
    let pageUrls: string[] = [];
    try {
      pageUrls = JSON.parse(cached.pageUrls ?? "[]");
    } catch {
      pageUrls = [];
    }
    return c.json({
      cached: true,
      pageUrls,
      count: cached.pageCount,
      sitemapUrl: cached.sitemapUrl,
      status: cached.status,
    });
  }

  const discovery = await discoverSitemap(websiteUrl);
  await cacheSitemap(db, ctx, websiteUrl, discovery).catch((err) =>
    console.error("[intake] sitemap cache persist failed:", err),
  );
  return c.json({
    cached: false,
    pageUrls: discovery.pageUrls,
    count: discovery.pageUrls.length,
    sitemapUrl: discovery.sitemapUrl,
    status: discovery.status,
  });
});

/**
 * GET /api/intake/sitemaps?scrapeJobType=&brandId=&showroomId=&productId= — Phase B.
 * Cached sitemap rows for one entity, newest-first, `page_urls` parsed back.
 */
intakeRouter.get("/sitemaps", async (c) => {
  const ctx = readSitemapContext({
    scrapeJobType: c.req.query("scrapeJobType"),
    brandId: c.req.query("brandId"),
    showroomId: c.req.query("showroomId"),
    productId: c.req.query("productId"),
  });
  if ("error" in ctx) return c.json({ error: ctx.error }, 400);

  const db = drizzle(c.env.DB);
  const ownerCol =
    ctx.scrapeJobType === "brand"
      ? eq(scrapingSitemap.brandId, ctx.brandId!)
      : ctx.scrapeJobType === "showroom"
        ? eq(scrapingSitemap.showroomId, ctx.showroomId!)
        : eq(scrapingSitemap.productId, ctx.productId!);

  const rows = await db
    .select()
    .from(scrapingSitemap)
    .where(and(eq(scrapingSitemap.scrapeJobType, ctx.scrapeJobType), ownerCol))
    .orderBy(desc(scrapingSitemap.fetchedAt));

  const sitemaps = rows.map((r) => {
    let pageUrls: string[] = [];
    try {
      pageUrls = JSON.parse(r.pageUrls ?? "[]");
    } catch {
      pageUrls = [];
    }
    return { ...r, pageUrls };
  });
  return c.json({ sitemaps });
});

// ─── GET /review-queue ──────────────────────────────────────────────────────

/**
 * GET /api/intake/review-queue
 * Every `status='processed'` bucket across ALL showrooms (the Phase-3 review
 * form's worklist), newest-first. `attributes` is the seed AI extraction taken
 * from the bucket's first photo (filename-ASC) — the review form pre-fills its
 * fields from this and lets the reviewer correct them.
 */
intakeRouter.get("/review-queue", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const buckets = await db
      .select()
      .from(productPhotoBuckets)
      .where(eq(productPhotoBuckets.status, "processed"))
      .orderBy(desc(productPhotoBuckets.createdAt));
    if (buckets.length === 0) return c.json({ buckets: [] });

    const bucketIds = buckets.map((b) => b.id);
    // Chunk the id list: one bound param per id vs D1's 100-param cap.
    const photos: (typeof productShowroomPhotos.$inferSelect)[] = [];
    for (let i = 0; i < bucketIds.length; i += 90) {
      const chunk = await db
        .select()
        .from(productShowroomPhotos)
        .where(inArray(productShowroomPhotos.bucketId, bucketIds.slice(i, i + 90)))
        .orderBy(asc(productShowroomPhotos.fileName), asc(productShowroomPhotos.id));
      photos.push(...chunk);
    }

    const photosByBucket = new Map<number, typeof photos>();
    for (const p of photos) {
      const key = p.bucketId as number;
      if (!photosByBucket.has(key)) photosByBucket.set(key, []);
      photosByBucket.get(key)!.push(p);
    }

    return c.json({
      buckets: buckets.map((b) => {
        const bucketPhotos = photosByBucket.get(b.id) ?? [];
        return {
          id: b.id,
          kind: b.kind,
          label: b.label,
          status: b.status,
          productId: b.productId,
          photos: bucketPhotos.map((p) => ({ id: p.id, imageUrl: p.imageUrl, fileName: p.fileName })),
          attributes: bucketPhotos[0]?.attributes ?? null,
        };
      }),
    });
  } catch (error) {
    console.error("Review queue error:", error);
    return c.json({ error: "Failed to load review queue" }, 500);
  }
});

// ─── POST /buckets/:id/review ───────────────────────────────────────────────

const reviewBodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  itemName: z.string().min(1).optional(),
  modelNumber: z.string().optional().nullable(),
  style: z.string().optional().nullable(),
  brandId: z.number().int().positive().optional().nullable(),
  categoryIds: z.array(z.number().int().positive()).optional(),
  subcategoryIds: z.array(z.number().int().positive()).optional(),
  colorIds: z.array(z.number().int().positive()).optional(),
  price: z.string().optional().nullable(),
  priceCents: z.number().int().optional().nullable(),
  salePrice: z.string().optional().nullable(),
  salePriceCents: z.number().int().optional().nullable(),
  discountInfo: z.string().optional().nullable(),
  discountPct: z.number().optional().nullable(),
  reason: z.string().optional(),
  rejectReasonCodes: z.array(z.string()).optional(),
});

/** Build a partial object keeping only keys whose value isn't `undefined`, for merging into a photo's JSON `attributes` without clobbering unset seed fields. */
function definedFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * POST /api/intake/buckets/:id/review
 *
 * approve: finalizes the bucket's product (itemName/modelNumber/brandId),
 * REPLACES the category/subcategory/color mappings on EVERY photo in the
 * bucket (and the brand<->category mapping), upserts ONE price observation
 * for the product, and marks bucket+photos `status='reviewed'`. The edited
 * fields are also merged into each photo's `attributes` JSON (source for the
 * `/config/styles` vocabulary).
 *
 * reject: marks bucket+photos `status='rejected'` and stores the reason /
 * reason codes into each photo's `attributes` JSON. Requires a non-empty
 * `reason` OR at least one `rejectReasonCodes` entry.
 *
 * The bucket's status is only flipped to its terminal value (reviewed/
 * rejected) as the LAST write in each branch — a failure partway through
 * leaves the bucket at `processed` (retryable) rather than a wrong terminal
 * status, and any error is caught and returned as 4xx/5xx with a message.
 */
intakeRouter.post("/buckets/:id/review", async (c) => {
  const bucketId = Number(c.req.param("id"));
  if (!Number.isFinite(bucketId)) return c.json({ error: "Invalid bucket id" }, 400);

  const bodyParsed = reviewBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyParsed.success) {
    return c.json({ error: "Invalid review body", details: bodyParsed.error.flatten() }, 400);
  }
  const body = bodyParsed.data;

  const db = drizzle(c.env.DB);
  const [bucket] = await db.select().from(productPhotoBuckets).where(eq(productPhotoBuckets.id, bucketId)).limit(1);
  if (!bucket) return c.json({ error: "Bucket not found" }, 404);

  const photos = await db.select().from(productShowroomPhotos).where(eq(productShowroomPhotos.bucketId, bucketId));
  if (photos.length === 0) return c.json({ error: "Bucket has no photos" }, 400);

  try {
    if (body.action === "reject") {
      const hasReason = (body.reason ?? "").trim().length > 0;
      const hasCodes = Array.isArray(body.rejectReasonCodes) && body.rejectReasonCodes.length > 0;
      if (!hasReason && !hasCodes) {
        return c.json({ error: "reason or rejectReasonCodes is required to reject" }, 400);
      }

      for (const photo of photos) {
        const attrs = (photo.attributes as Record<string, unknown> | null) ?? {};
        await db
          .update(productShowroomPhotos)
          .set({
            status: "rejected",
            attributes: { ...attrs, reviewReason: body.reason ?? null, rejectReasonCodes: body.rejectReasonCodes ?? [] },
          })
          .where(eq(productShowroomPhotos.id, photo.id))
          .run();
      }
      // Terminal status write LAST.
      await db.update(productPhotoBuckets).set({ status: "rejected" }).where(eq(productPhotoBuckets.id, bucketId)).run();

      return c.json({ bucketId, status: "rejected" });
    }

    // ── approve ──────────────────────────────────────────────────────────
    if (!bucket.productId) return c.json({ error: "Bucket has no product to approve (process it first)" }, 400);
    const productId = bucket.productId;

    const productUpdates: Partial<typeof showroomStoreProducts.$inferInsert> = {};
    if (body.itemName !== undefined) productUpdates.itemName = body.itemName;
    if (body.modelNumber !== undefined) {
      const trimmed = (body.modelNumber ?? "").trim();
      const modelNumber = trimmed && trimmed.toUpperCase() !== "N/A" ? trimmed : null;
      productUpdates.modelNumber = modelNumber;
      productUpdates.modelKey = normalizeModelKey(modelNumber);
    }
    if (body.brandId !== undefined) productUpdates.brandId = body.brandId;
    // NOTE: `showroom_store_products` has no `style` column — style is
    // persisted only into each photo's `attributes` JSON below (and is the
    // source for GET /api/config/styles).

    if (Object.keys(productUpdates).length > 0) {
      await db.update(showroomStoreProducts).set(productUpdates).where(eq(showroomStoreProducts.id, productId)).run();
    }

    // REPLACE mappings for EVERY photo in the bucket.
    const categoryIds = body.categoryIds ?? [];
    const subcategoryIds = body.subcategoryIds ?? [];
    const colorIds = body.colorIds ?? [];
    for (const photo of photos) {
      await replaceMapping(db, photoCategories, photoCategories.photoId, photo.id, categoryIds, (categoryId) => ({
        photoId: photo.id,
        categoryId,
      }));
      await replaceMapping(db, photoSubcategories, photoSubcategories.photoId, photo.id, subcategoryIds, (subcategoryId) => ({
        photoId: photo.id,
        subcategoryId,
      }));
      await replaceMapping(db, photoColors, photoColors.photoId, photo.id, colorIds, (colorId) => ({
        photoId: photo.id,
        colorId,
      }));
    }
    if (body.brandId != null && categoryIds.length > 0) {
      await replaceMapping(db, brandCategories, brandCategories.brandId, body.brandId, categoryIds, (categoryId) => ({
        brandId: body.brandId!,
        categoryId,
      }));
    }

    // Upsert ONE price observation for the product. `process` (Phase 2) may
    // have already inserted a 'pending' AI-read observation sourced off this
    // bucket's photos — update that one in place; otherwise insert fresh.
    const photoIds = photos.map((p) => p.id);
    const [existingObs] = await db
      .select()
      .from(productPriceObservations)
      .where(and(eq(productPriceObservations.productId, productId), inArray(productPriceObservations.sourcePhotoId, photoIds)))
      .limit(1);

    const priceCents = body.priceCents !== undefined ? body.priceCents : parsePriceCents(body.price ?? null);
    const salePriceCents = body.salePriceCents !== undefined ? body.salePriceCents : parsePriceCents(body.salePrice ?? null);
    const discountPct = body.discountPct !== undefined ? body.discountPct : parseDiscountPct(body.discountInfo ?? null);

    const obsFields = {
      price: body.price ?? null,
      salePrice: body.salePrice ?? null,
      discountInfo: body.discountInfo ?? null,
      priceCents: priceCents ?? null,
      salePriceCents: salePriceCents ?? null,
      discountPct: discountPct ?? null,
      reviewStatus: "approved" as const,
      reviewedAt: new Date(),
    };

    if (existingObs) {
      await db.update(productPriceObservations).set(obsFields).where(eq(productPriceObservations.id, existingObs.id)).run();
    } else if (body.price || priceCents != null) {
      await db.insert(productPriceObservations).values({
        productId,
        sourceType: "showroom",
        showroomId: bucket.showroomId,
        sourcePhotoId: photos[0].id,
        confidence: 100,
        ...obsFields,
      });
    }

    // Persist the reviewer-edited fields back into every photo's `attributes` JSON.
    const editedAttrs = definedFields({
      itemName: body.itemName,
      modelNumber: productUpdates.modelNumber,
      style: body.style,
      brandId: body.brandId,
      price: body.price,
      priceCents,
      salePrice: body.salePrice,
      salePriceCents,
      discountInfo: body.discountInfo,
      discountPct,
    });
    for (const photo of photos) {
      const attrs = (photo.attributes as Record<string, unknown> | null) ?? {};
      await db
        .update(productShowroomPhotos)
        .set({ status: "reviewed", attributes: { ...attrs, ...editedAttrs } })
        .where(eq(productShowroomPhotos.id, photo.id))
        .run();
    }
    // Terminal status write LAST.
    await db.update(productPhotoBuckets).set({ status: "reviewed" }).where(eq(productPhotoBuckets.id, bucketId)).run();

    return c.json({ bucketId, productId, status: "reviewed" });
  } catch (error) {
    console.error("Bucket review error:", error);
    return c.json(
      { error: "Failed to review bucket", details: error instanceof Error ? error.message : "Unknown" },
      500,
    );
  }
});

// ─── POST /buckets/:id/regions ──────────────────────────────────────────────

const NormalizedBboxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    // width/height must be > 0 — a zero-area crop is a client error, not a valid region.
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  // The box must fit inside the image — otherwise the crop trim would run past
  // the source bounds. x+width and y+height must both stay within [0,1].
  .refine((b) => b.x + b.width <= 1 && b.y + b.height <= 1, {
    message: "bbox must fit within the image (x+width and y+height ≤ 1)",
  });

const RegionsBodySchema = z.object({
  sourcePhotoId: z.number().int().positive(),
  regions: z
    .array(z.object({ bbox: NormalizedBboxSchema, label: z.string().min(1).optional() }))
    .min(1),
});

/**
 * POST /api/intake/buckets/:id/regions — Phase 4 "multiple products" masking.
 * Body: `{ sourcePhotoId, regions: [{ bbox: {x,y,width,height} (0..1), label? }] }`.
 *
 * The source bucket (`:id`) is a `multi`-kind bucket whose wide shot depicts
 * several products; `sourcePhotoId` must be one of its own photos. For each
 * region: crop the source image to the normalized bbox via the shared
 * `cropAndUploadCfImage` primitive (re-uploads a NEW CF Images asset — never
 * mutates the original), spin up a fresh `single` bucket, and insert ONE
 * crop-child photo row (`parentPhotoId` + `cropRegion` linking back to the
 * source) into it. Each new bucket then flows through the existing
 * `/buckets/:id/process` + review path unchanged — no changes needed there.
 *
 * Regions are cropped sequentially (few regions per photo; not worth the
 * concurrency complexity) and independently try/caught — one bad region
 * (e.g. a transient CF Images failure) doesn't lose the others. The source
 * bucket is only flipped to `status='processed'` (masked) if AT LEAST ONE
 * crop succeeded; if every region fails, nothing is mutated and a 500 with
 * per-region error details is returned.
 */
intakeRouter.post("/buckets/:id/regions", async (c) => {
  const bucketIdParsed = z.coerce.number().int().positive().safeParse(c.req.param("id"));
  if (!bucketIdParsed.success) return c.json({ error: "Invalid bucket id" }, 400);
  const bucketId = bucketIdParsed.data;

  const bodyParsed = RegionsBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyParsed.success) {
    return c.json({ error: "Invalid regions body", details: bodyParsed.error.flatten() }, 400);
  }
  const { sourcePhotoId, regions } = bodyParsed.data;

  const db = drizzle(c.env.DB);
  const [bucket] = await db.select().from(productPhotoBuckets).where(eq(productPhotoBuckets.id, bucketId)).limit(1);
  if (!bucket) return c.json({ error: "Bucket not found" }, 404);

  const [sourcePhoto] = await db
    .select()
    .from(productShowroomPhotos)
    .where(eq(productShowroomPhotos.id, sourcePhotoId))
    .limit(1);
  if (!sourcePhoto || sourcePhoto.bucketId !== bucketId) {
    return c.json({ error: "sourcePhotoId does not belong to this bucket" }, 400);
  }
  if (!sourcePhoto.imageUrl) return c.json({ error: "Source photo has no imageUrl to crop" }, 400);

  const sourceBase = (sourcePhoto.fileName ?? "photo").replace(/\.[^./]+$/, "");

  const newBuckets: {
    id: number;
    kind: string;
    label: string | null;
    status: string;
    photos: { id: number; imageUrl: string | null; fileName: string | null }[];
  }[] = [];
  const errors: { index: number; message: string }[] = [];

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    try {
      const cropped = await cropAndUploadCfImage(
        c.env,
        sourcePhoto.imageUrl,
        region.bbox,
        `${sourceBase}-crop-${i}.jpg`,
      );

      const [newBucket] = await db
        .insert(productPhotoBuckets)
        .values({
          kind: "single",
          showroomId: sourcePhoto.showroomId,
          label: region.label ?? null,
          status: "draft",
        })
        .returning();

      const [childPhoto] = await db
        .insert(productShowroomPhotos)
        .values({
          ragUuid: crypto.randomUUID(),
          productId: null,
          showroomId: sourcePhoto.showroomId,
          bucketId: newBucket.id,
          parentPhotoId: sourcePhotoId,
          cropRegion: region.bbox,
          fileName: region.label || `${sourceBase}-crop-${i}`,
          sortOrder: 0,
          imageUrl: cropped.deliveryUrl,
          cfImageId: cropped.imageId,
          status: "uploaded",
        })
        .returning();

      newBuckets.push({
        id: newBucket.id,
        kind: newBucket.kind,
        label: newBucket.label,
        status: newBucket.status,
        photos: [{ id: childPhoto.id, imageUrl: childPhoto.imageUrl, fileName: childPhoto.fileName }],
      });
    } catch (error) {
      console.error(`Region ${i} crop failed for bucket ${bucketId}:`, error);
      errors.push({ index: i, message: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  if (newBuckets.length === 0) {
    return c.json({ error: "All region crops failed", details: errors }, 500);
  }

  // At least one crop succeeded — the source (multi) bucket is now masked;
  // its crops carry the products forward through the normal process/review path.
  await db.update(productPhotoBuckets).set({ status: "processed" }).where(eq(productPhotoBuckets.id, bucketId)).run();

  return c.json({ buckets: newBuckets, ...(errors.length > 0 ? { errors } : {}) });
});
