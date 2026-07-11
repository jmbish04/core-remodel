// src/backend/api/routes/product-photos.ts
/**
 * @fileoverview Showroom Product Photo pipeline — AI extraction + HITL review.
 *
 *   POST /ingest              — upload a photo, AI-extract product/price fields,
 *                                find-or-create the product, embed + index the
 *                                photo, and (best-effort) record a price observation.
 *   GET  /pending              — the HITL review queue (status='pending_review').
 *   POST /:id/review           — REST twin of the `review_product_photo` MCP tool.
 *   GET  /:productId/similar   — visual-similarity lookup via PHOTO_INDEX (Vectorize).
 *
 * Mounts at /api/product-photos (wired in api/index.ts), behind requireAccessAuth.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  brands,
  categories,
  colors,
  photoCategories,
  photoColors,
  productPriceObservations,
  productShowroomPhotos,
  showroomStoreProducts,
} from "@backend/db";
import { ImageProcessorService } from "@backend/services/image-processor";
import {
  extractShowroomProduct,
  type ExtractionVocabContext,
  type ProductExtraction,
} from "@backend/services/image-processor/product-extraction";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import { normalizeModelKey } from "@backend/lib/normalize-model";
import { parseDiscountPct, parsePriceCents } from "@backend/lib/money";
import { reviewProductPhotoCore } from "@backend/mcp/tools/product_photos";

export const productPhotosRouter = new Hono<{ Bindings: Env }>();

type Db = ReturnType<typeof drizzle>;

/** Find (or create) the brand row matching `name`, case-insensitively. Null passthrough for no brand text. */
async function resolveBrandId(db: Db, name: string | null | undefined): Promise<number | null> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;

  const [existing] = await db
    .select()
    .from(brands)
    .where(eq(sql`lower(${brands.name})`, trimmed.toLowerCase()))
    .limit(1);
  if (existing) return existing.id;

  try {
    const [created] = await db.insert(brands).values({ name: trimmed }).returning();
    return created.id;
  } catch {
    // A concurrent ingest created the same brand between our select and insert —
    // re-select instead of failing on the unique-name violation.
    const [row] = await db
      .select()
      .from(brands)
      .where(eq(sql`lower(${brands.name})`, trimmed.toLowerCase()))
      .limit(1);
    if (row) return row.id;
    throw new Error(`brand resolve failed for "${trimmed}"`);
  }
}

/**
 * Load the live config vocabulary (0020-C2) to inject into the AI extraction
 * prompt — active category names, active colors (id/name/hexCode), and brand
 * names. Fed as `ctx` to `extractShowroomProduct` so the model reuses existing
 * definitions instead of drifting into free-text near-duplicates.
 */
async function loadExtractionVocab(db: Db): Promise<ExtractionVocabContext> {
  const [categoryRows, colorRows, brandRows] = await Promise.all([
    db.select({ name: categories.name }).from(categories).where(eq(categories.isActive, true)),
    db
      .select({ id: colors.id, name: colors.name, hexCode: colors.hexCode })
      .from(colors)
      .where(eq(colors.isActive, true)),
    db.select({ name: brands.name }).from(brands),
  ]);

  return {
    categories: categoryRows.map((r) => r.name),
    colors: colorRows,
    brands: brandRows.map((r) => r.name),
  };
}

/**
 * Case-insensitive lookup of an active category by name. Does NOT create —
 * the extraction prompt is instructed to prefer names from the provided
 * vocabulary, so a miss here means the model returned freeform text outside
 * the known list; the photo is simply left uncategorized rather than
 * silently growing the `categories` table from AI guesses (unlike colors,
 * which explicitly supports AI-originated "Other" values per AGENTS.md).
 */
async function resolveCategoryId(db: Db, name: string | null | undefined): Promise<number | null> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;

  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(sql`lower(${categories.name})`, trimmed.toLowerCase()), eq(categories.isActive, true)))
    .limit(1);
  return existing?.id ?? null;
}

/**
 * Find-or-create a color by case-insensitive name — the AI-creates-"Other"
 * path for the `colors` config vocabulary (AGENTS.md "Multi-select &
 * config-driven definitions"). Reuses an existing active color's id when the
 * name matches; otherwise inserts a new `colors` row with the AI-supplied hex.
 */
async function resolveOrCreateColorId(db: Db, name: string, hexCode: string | null | undefined): Promise<number> {
  const trimmed = name.trim();
  const [existing] = await db
    .select({ id: colors.id })
    .from(colors)
    .where(eq(sql`lower(${colors.name})`, trimmed.toLowerCase()))
    .limit(1);
  if (existing) return existing.id;

  try {
    const [created] = await db.insert(colors).values({ name: trimmed, hexCode: hexCode ?? null }).returning();
    return created.id;
  } catch {
    // Concurrent ingest created the same color between our select and insert.
    const [row] = await db
      .select({ id: colors.id })
      .from(colors)
      .where(eq(sql`lower(${colors.name})`, trimmed.toLowerCase()))
      .limit(1);
    if (row) return row.id;
    throw new Error(`color resolve failed for "${trimmed}"`);
  }
}

/**
 * Find-or-create the product this photo depicts:
 *   1. (brandId, modelKey) — the canonical unique index — when both are known.
 *   2. (brandId, case-insensitive itemName) fallback.
 *   3. Otherwise create a new product from the AI attributes; auto-created rows
 *      are expected to be confirmed/corrected via HITL review.
 */
async function ensureProductFromExtraction(db: Db, attrs: ProductExtraction) {
  const brandId = await resolveBrandId(db, attrs.brand);
  const modelKey = normalizeModelKey(attrs.modelNumber);
  const itemName = (attrs.itemName ?? "").trim();

  let found: typeof showroomStoreProducts.$inferSelect | undefined;

  if (brandId != null && modelKey != null) {
    [found] = await db
      .select()
      .from(showroomStoreProducts)
      .where(and(eq(showroomStoreProducts.brandId, brandId), eq(showroomStoreProducts.modelKey, modelKey)))
      .limit(1);
  }

  if (!found && brandId != null && itemName) {
    [found] = await db
      .select()
      .from(showroomStoreProducts)
      .where(
        and(
          eq(showroomStoreProducts.brandId, brandId),
          eq(sql`lower(${showroomStoreProducts.itemName})`, itemName.toLowerCase()),
        ),
      )
      .limit(1);
  }

  if (found) return { created: false, product: found };

  try {
    const [created] = await db
      .insert(showroomStoreProducts)
      .values({
        itemName: itemName || "Unnamed",
        brandId,
        modelNumber: attrs.modelNumber ?? null,
        modelKey,
        colors: attrs.colors && attrs.colors.length > 0 ? attrs.colors.map((c) => c.name).join(", ") : null,
        productType: attrs.category ?? null,
      })
      .returning();
    return { created: true, product: created };
  } catch {
    // A concurrent ingest created the same (brandId, modelKey) product — re-select
    // instead of failing on the unique-index violation.
    if (brandId != null && modelKey != null) {
      const [row] = await db
        .select()
        .from(showroomStoreProducts)
        .where(and(eq(showroomStoreProducts.brandId, brandId), eq(showroomStoreProducts.modelKey, modelKey)))
        .limit(1);
      if (row) return { created: false, product: row };
    }
    throw new Error("product resolve failed after concurrent insert");
  }
}

// ─── POST /ingest ───────────────────────────────────────────────────────────

/**
 * POST /api/product-photos/ingest
 * multipart/form-data: `file` (the photo), `showroomId` (form field, integer).
 *
 * See file header for the pipeline steps. Returns `{ photo, product, observation,
 * attributes }` — everything the HITL review UI needs in one round trip.
 * `observation` is null when the photo carried no readable price text.
 */
productPhotosRouter.post("/ingest", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    const showroomIdRaw = formData.get("showroomId");

    if (!(file instanceof File)) {
      return c.json({ error: "file is required (multipart form field)" }, 400);
    }
    // showroomId is OPTIONAL (nullable in the schema) — a photo may be captured
    // with no showroom selected (or from an online source). Only validate when given.
    let showroomId: number | null = null;
    if (showroomIdRaw != null && String(showroomIdRaw).trim() !== "") {
      showroomId = Number(showroomIdRaw);
      if (!Number.isFinite(showroomId)) {
        return c.json({ error: "showroomId must be an integer" }, 400);
      }
    }

    const credentials = await resolveCloudflareImagesCredentials(c.env);
    if (!credentials.accountId || credentials.apiTokens.length === 0) {
      return c.json({ error: "Cloudflare Images credentials not configured" }, 500);
    }

    const processor = new ImageProcessorService(c.env, credentials.accountId, credentials.apiTokens[0], {
      fallbackApiTokens: credentials.apiTokens.slice(1),
    });

    // 1. Upload to CF Images.
    const bytes = await file.arrayBuffer();
    const uploadResponse = await processor.uploadToCloudflareImages(file, undefined, file.name);
    const deliveryUrl = processor.getDeliveryUrl(uploadResponse, uploadResponse.result.id);
    const cfImageId = uploadResponse.result.id;

    // 2. AI extraction (vision description -> structured JSON), primed with the
    //    live categories/colors/brands vocabulary (0020-C2) so the model reuses
    //    existing config-table definitions instead of drifting into near-duplicates.
    const db = drizzle(c.env.DB);
    const dataUrl = ImageProcessorService.arrayBufferToDataUrl(bytes, file.type || "image/jpeg");
    const vocab = await loadExtractionVocab(db);
    const attrs = await extractShowroomProduct(c.env, dataUrl, vocab);

    // 3. Find-or-create the product this photo depicts.
    const { product } = await ensureProductFromExtraction(db, attrs);

    // 4. Embed + upsert into PHOTO_INDEX, keyed by a fresh ragUuid (the join key
    //    shared with the product_showroom_photos row below).
    const ragUuid = crypto.randomUUID();
    const embeddingText = [
      attrs.itemName,
      attrs.brand,
      attrs.modelNumber,
      attrs.colors?.map((cAttr) => cAttr.name).join(", "),
      attrs.style,
      attrs.category,
    ]
      .filter((v): v is string => Boolean(v))
      .join(" — ");
    if (embeddingText) {
      const embeddings = await processor.generateEmbeddings(embeddingText);
      const metadata: Record<string, string | number | boolean> = { productId: product.id };
      if (attrs.category) metadata.category = attrs.category;
      if (showroomId != null) metadata.showroomId = showroomId;
      await c.env.PHOTO_INDEX.upsert([{ id: ragUuid, values: embeddings, metadata }]);
    }

    // 5. Insert the photo row (pending_review — HITL confirms/corrects everything).
    const [photo] = await db
      .insert(productShowroomPhotos)
      .values({
        ragUuid,
        productId: product.id,
        showroomId,
        imageUrl: deliveryUrl,
        cfImageId,
        category: attrs.category ?? null,
        photoKind: attrs.photoKind,
        attributes: attrs,
        status: "pending_review",
      })
      .returning();

    // 5b. Map the photo to its config vocabulary rows (0020-C2): resolve
    //     attrs.category -> an existing active category (no AI-create — see
    //     resolveCategoryId doc), and resolve/create each attrs.colors[]
    //     entry against the shared `colors` table (the AI-creates-"Other"
    //     path for colors). Best-effort — a resolution miss never fails ingest.
    const categoryId = await resolveCategoryId(db, attrs.category);
    if (categoryId != null) {
      await db.insert(photoCategories).values({ photoId: photo.id, categoryId }).onConflictDoNothing();
    }
    if (attrs.colors && attrs.colors.length > 0) {
      const uniqueColors = new Map(attrs.colors.map((cAttr) => [cAttr.name.trim().toLowerCase(), cAttr]));
      for (const cAttr of uniqueColors.values()) {
        if (!cAttr.name.trim()) continue;
        const colorId = await resolveOrCreateColorId(db, cAttr.name, cAttr.hexCode);
        await db.insert(photoColors).values({ photoId: photo.id, colorId }).onConflictDoNothing();
      }
    }

    // 6. Record a price observation, if a price was actually read off the photo.
    let observation: typeof productPriceObservations.$inferSelect | null = null;
    if (attrs.price) {
      [observation] = await db
        .insert(productPriceObservations)
        .values({
          productId: product.id,
          sourceType: "showroom",
          showroomId,
          price: attrs.price,
          salePrice: attrs.salePrice,
          discountInfo: attrs.discountInfo,
          priceCents: parsePriceCents(attrs.price),
          salePriceCents: parsePriceCents(attrs.salePrice),
          discountPct: parseDiscountPct(attrs.discountInfo),
          sourcePhotoId: photo.id,
          confidence: attrs.confidence,
          reviewStatus: "pending",
        })
        .returning();
    }

    return c.json({ photo, product, observation, attributes: attrs });
  } catch (error) {
    console.error("Product photo ingest error:", error);
    return c.json(
      { error: "Failed to ingest product photo", details: error instanceof Error ? error.message : "Unknown" },
      500,
    );
  }
});

// ─── GET /pending ───────────────────────────────────────────────────────────

/**
 * GET /api/product-photos/pending
 * The HITL review queue: every `product_showroom_photos` row with
 * `status='pending_review'`, joined to its product and any linked price
 * observation. Newest first.
 */
productPhotosRouter.get("/pending", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(productShowroomPhotos)
      .where(eq(productShowroomPhotos.status, "pending_review"))
      .orderBy(desc(productShowroomPhotos.createdAt));

    if (rows.length === 0) return c.json({ photos: [] });

    const productIds = [...new Set(rows.map((r) => r.productId))];
    const photoIds = rows.map((r) => r.id);
    const [products, observations] = await Promise.all([
      db.select().from(showroomStoreProducts).where(inArray(showroomStoreProducts.id, productIds)),
      db.select().from(productPriceObservations).where(inArray(productPriceObservations.sourcePhotoId, photoIds)),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const obsByPhotoId = new Map(observations.map((o) => [o.sourcePhotoId as number, o]));

    return c.json({
      photos: rows.map((r) => ({
        ...r,
        product: productById.get(r.productId) ?? null,
        observation: obsByPhotoId.get(r.id) ?? null,
      })),
    });
  } catch (error) {
    console.error("List pending product photos error:", error);
    return c.json({ error: "Failed to list pending product photos" }, 500);
  }
});

// ─── POST /:id/review ───────────────────────────────────────────────────────

/**
 * POST /api/product-photos/:id/review
 * REST twin of the `review_product_photo` MCP tool — delegates to the same
 * `reviewProductPhotoCore` implementation (see mcp/tools/product_photos.ts for
 * the approve/reject rules).
 *
 * Body: `{ action: 'approve'|'reject', reviewReason?, attributes?, productId?,
 * observationApproved? }`.
 */
productPhotosRouter.post("/:id/review", async (c) => {
  try {
    const photoId = Number(c.req.param("id"));
    if (!Number.isFinite(photoId)) return c.json({ error: "Invalid photo id" }, 400);

    const body = await c.req.json<{
      action?: "approve" | "reject";
      reviewReason?: string;
      attributes?: Record<string, unknown>;
      productId?: number;
      observationApproved?: boolean;
    }>();

    if (body.action !== "approve" && body.action !== "reject") {
      return c.json({ error: "action must be 'approve' or 'reject'" }, 400);
    }

    const db = drizzle(c.env.DB);
    const result = await reviewProductPhotoCore(db, { ...body, photoId, action: body.action });
    return c.json(result);
  } catch (error) {
    console.error("Product photo review error:", error);
    return c.json(
      { error: "Failed to review product photo", details: error instanceof Error ? error.message : "Unknown" },
      500,
    );
  }
});

// ─── GET /:productId/similar ────────────────────────────────────────────────

/**
 * GET /api/product-photos/:productId/similar
 * Visual-similarity lookup: takes the product's newest indexed photo, queries
 * PHOTO_INDEX (Vectorize) for its nearest neighbors, and maps the matched
 * ragUuids back through `product_showroom_photos` to distinct OTHER products.
 */
productPhotosRouter.get("/:productId/similar", async (c) => {
  try {
    const productId = Number(c.req.param("productId"));
    if (!Number.isFinite(productId)) return c.json({ error: "Invalid product id" }, 400);

    const db = drizzle(c.env.DB);
    const [newestPhoto] = await db
      .select()
      .from(productShowroomPhotos)
      .where(eq(productShowroomPhotos.productId, productId))
      .orderBy(desc(productShowroomPhotos.createdAt))
      .limit(1);
    if (!newestPhoto) return c.json({ products: [] });

    const [vector] = await c.env.PHOTO_INDEX.getByIds([newestPhoto.ragUuid]);
    if (!vector) return c.json({ products: [] });

    const matches = await c.env.PHOTO_INDEX.query(vector.values, { topK: 8 });
    const matchIds = matches.matches.map((m) => m.id).filter((id) => id !== newestPhoto.ragUuid);
    if (matchIds.length === 0) return c.json({ products: [] });

    const matchedPhotos = await db
      .select()
      .from(productShowroomPhotos)
      .where(inArray(productShowroomPhotos.ragUuid, matchIds));

    const otherProductIds = [...new Set(matchedPhotos.map((p) => p.productId))].filter((id) => id !== productId);
    if (otherProductIds.length === 0) return c.json({ products: [] });

    const [products, photos] = await Promise.all([
      db
        .select({ id: showroomStoreProducts.id, itemName: showroomStoreProducts.itemName, brandName: brands.name })
        .from(showroomStoreProducts)
        .leftJoin(brands, eq(showroomStoreProducts.brandId, brands.id))
        .where(inArray(showroomStoreProducts.id, otherProductIds)),
      db
        .select()
        .from(productShowroomPhotos)
        .where(inArray(productShowroomPhotos.productId, otherProductIds))
        .orderBy(desc(productShowroomPhotos.createdAt)),
    ]);

    const imageByProductId = new Map<number, string | null>();
    for (const p of photos) {
      if (!imageByProductId.has(p.productId)) imageByProductId.set(p.productId, p.imageUrl);
    }

    return c.json({
      products: products.map((p) => ({
        id: p.id,
        itemName: p.itemName,
        brandName: p.brandName ?? null,
        imageUrl: imageByProductId.get(p.id) ?? null,
      })),
    });
  } catch (error) {
    console.error("Similar products lookup error:", error);
    return c.json({ error: "Failed to find similar products" }, 500);
  }
});
