/**
 * @fileoverview Showroom Field-Scan Batch Sync API
 *
 * Bulk capture from a showroom visit: each "card" groups all photos of ONE
 * product (plus optional barcode/notes). On sync we create a product draft,
 * upload the photos to Cloudflare Images, log each to showroom_scan_log, and
 * fire a deep-research enrichment pass (findings land in the HITL review queue).
 * Mounts on /api/showroom-stores.
 *
 *   POST /scan/batch-sync
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { getAgentByName } from "agents";
import { z } from "zod";

import {
  showroomStoreProducts,
  showroomScanLog,
  showroomProductMappings,
} from "@backend/db/schema/showroom/index";
import { ImageProcessorService } from "@backend/services/image-processor";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import type { ShowroomResearchAgent } from "@backend/ai/agents/ShowroomResearchAgent";

export const showroomScanRouter = new Hono<{ Bindings: Env }>();

const cardSchema = z.object({
  label: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  storeId: z.number().int().positive().optional().nullable(),
  photos: z.array(z.string()).default([]), // base64 data URLs
});

const batchSchema = z.object({
  storeId: z.number().int().positive().optional().nullable(),
  runResearch: z.boolean().optional().default(true),
  cards: z.array(cardSchema).min(1),
});

/** Decode a `data:<mime>;base64,<data>` URL into a Blob. */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, mime, b64] = match;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

async function tryCreateProcessor(env: Env): Promise<ImageProcessorService | null> {
  try {
    const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(env);
    const [primaryToken, ...fallbackApiTokens] = apiTokens;
    if (!accountId || !primaryToken) return null;
    return new ImageProcessorService(env, accountId, primaryToken, { fallbackApiTokens });
  } catch {
    return null;
  }
}

/**
 * POST /scan/batch-sync — sync a batch of captured product cards.
 */
showroomScanRouter.post("/scan/batch-sync", async (c) => {
  const db = drizzle(c.env.DB);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  // Every card must resolve to a showroom (storeId is a required FK).
  const unresolved = parsed.data.cards.filter((card) => !(card.storeId ?? parsed.data.storeId));
  if (unresolved.length > 0) {
    return c.json({ error: "Each card needs a storeId (set it on the batch or per card)" }, 400);
  }

  const processor = await tryCreateProcessor(c.env);
  const created: { label: string; productId: number; photosUploaded: number; photosFailed: number }[] = [];

  for (const card of parsed.data.cards) {
    const storeId = (card.storeId ?? parsed.data.storeId) as number;
    const itemName = (card.label?.trim() || card.barcode?.trim() || "Field capture").slice(0, 200);

    // Products are global (no owning store) — insert the row, then upsert a
    // showroom_product_mappings link to the showroom this card was captured at.
    const [product] = await db
      .insert(showroomStoreProducts)
      .values({
        itemName,
        sku: card.barcode?.trim() || null,
        notes: card.notes?.trim() || null,
      })
      .returning();

    await db
      .insert(showroomProductMappings)
      .values({ showroomId: storeId, productId: product.id })
      .onConflictDoNothing();

    const jsonExtractedData = JSON.stringify({
      notes: card.notes ?? null,
      capturedVia: "field-scan-batch",
      awaitingEnrichment: true,
    });
    const barcodeDecodedValue = card.barcode?.trim() || null;
    const isBarcode = Boolean(card.barcode);

    let uploaded = 0;
    let failed = 0;
    // cfImageUrl per log row: one row per photo, or a single null-image row when
    // a card has no photos (barcode/notes-only) so every scan keeps an audit trail.
    const cfImageUrls: (string | null)[] = [];
    for (const photo of card.photos) {
      const blob = processor ? dataUrlToBlob(photo) : null;
      let cfImageUrl: string | null = null;
      if (processor && blob) {
        try {
          const upload = await processor.uploadToCloudflareImages(blob, undefined, `field-scan-${product.id}.jpg`);
          cfImageUrl = processor.getDeliveryUrl(upload, upload.result.id);
          uploaded += 1;
        } catch {
          failed += 1;
        }
      } else {
        failed += 1;
      }
      cfImageUrls.push(cfImageUrl);
    }
    if (cfImageUrls.length === 0) cfImageUrls.push(null);

    const logInserts = cfImageUrls.map((cfImageUrl) =>
      db.insert(showroomScanLog).values({
        isBarcode,
        cfImageUrl,
        barcodeDecodedValue,
        jsonExtractedData,
        autoCreatedProductId: product.id,
        storeId,
      }),
    );
    // db.batch keeps single-row inserts under D1's 100-bound-parameter limit.
    await db.batch(logInserts as [(typeof logInserts)[number], ...typeof logInserts]);

    // Fire-and-forget deep-research enrichment; findings land in HITL review.
    if (parsed.data.runResearch) {
      c.executionCtx.waitUntil(
        (async () => {
          try {
            const agent = await getAgentByName<Env, ShowroomResearchAgent>(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              c.env.SHOWROOM_RESEARCH_AGENT as any,
              "showroom-research",
            );
            await agent.deepSweepProduct({ productId: product.id, triggerSource: "manual" });
          } catch {
            /* enrichment is best-effort */
          }
        })(),
      );
    }

    created.push({ label: itemName, productId: product.id, photosUploaded: uploaded, photosFailed: failed });
  }

  return c.json({ success: true, created, imagesEnabled: processor != null });
});
