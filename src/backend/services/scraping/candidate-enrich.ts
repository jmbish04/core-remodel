// src/backend/services/scraping/candidate-enrich.ts
/**
 * @fileoverview Candidate asset enrichment (Phase C2).
 *
 * For a product candidate, resolve a product page and stage its image + PDF
 * SOURCE URLs (no download — the pipeline holds the URL until a human confirms).
 * Page resolution, in order: the candidate's own product URL, then the bucket's
 * hint URL, then the brand's website via the cached sitemap (Phase B) fuzzy-
 * matched to the candidate's model/name. Never throws — enrichment is best-effort
 * and must not fail the intake workflow.
 */
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { brands } from "@backend/db/schema/brands/index";
import { normalizeModelKey } from "@backend/lib/normalize-model";
import { scrapePageAssets } from "@backend/services/brands/brand-image-harvest";
import { discoverPagesCached } from "@backend/services/scraping/sitemap-cache";

export interface CandidateEnrichInput {
  productUrl?: string | null;
  hintProductUrl?: string | null;
  brandId?: number | null;
  itemName?: string | null;
  modelNumber?: string | null;
}

export interface CandidateEnrichResult {
  /** The page assets were scraped from (may be newly resolved from the sitemap). */
  productUrl: string | null;
  imageSourceUrls: string[];
  pdfSourceUrls: string[];
}

const EMPTY: CandidateEnrichResult = { productUrl: null, imageSourceUrls: [], pdfSourceUrls: [] };

/** Pick the sitemap page that best matches a candidate's model/name, or null. */
function bestPageMatch(pages: string[], itemName?: string | null, modelNumber?: string | null): string | null {
  if (pages.length === 0) return null;

  const modelKey = normalizeModelKey(modelNumber);
  if (modelKey) {
    const hit = pages.find((u) => u.toLowerCase().replace(/[^a-z0-9]/g, "").includes(modelKey));
    if (hit) return hit;
  }

  const tokens = (itemName ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
  if (tokens.length === 0) return null;

  let best: string | null = null;
  let bestScore = 0;
  for (const u of pages) {
    const lower = u.toLowerCase();
    const score = tokens.reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0);
    if (score > bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return bestScore > 0 ? best : null;
}

export async function enrichCandidateAssets(
  env: Env,
  input: CandidateEnrichInput,
): Promise<CandidateEnrichResult> {
  // 1. A direct URL wins — candidate's own, else the bucket hint.
  let target = (input.productUrl ?? input.hintProductUrl ?? "").trim() || null;

  // 2. Otherwise resolve via the brand's cached sitemap.
  if (!target && input.brandId != null) {
    try {
      const db = drizzle(env.DB);
      const [brand] = await db
        .select({ websiteUrl: brands.websiteUrl })
        .from(brands)
        .where(eq(brands.id, input.brandId))
        .limit(1);
      if (brand?.websiteUrl) {
        const pages = await discoverPagesCached(env, brand.websiteUrl, {
          scrapeJobType: "brand",
          brandId: input.brandId,
        });
        target = bestPageMatch(pages, input.itemName, input.modelNumber);
      }
    } catch (err) {
      console.error("[candidate-enrich] sitemap resolve failed:", err);
    }
  }

  if (!target) return EMPTY;

  const { imageUrls, pdfUrls } = await scrapePageAssets(target);
  return { productUrl: target, imageSourceUrls: imageUrls, pdfSourceUrls: pdfUrls };
}
