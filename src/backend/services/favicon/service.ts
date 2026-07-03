/**
 * @fileoverview FaviconService
 *
 * Resolves a website's favicon / brand icon, uploads it to Cloudflare Images,
 * and writes the resulting delivery URL back to the appropriate DB row.
 *
 * Used in `waitUntil()` fire-and-forget contexts — every method is fully
 * wrapped in try/catch and NEVER throws (a thrown error inside waitUntil
 * silently kills the background task with no retries).
 *
 * Upload infra reuses the shared `ImageProcessorService` + `resolveCloudflareImagesCredentials`
 * pattern from showroom-scan.ts — do NOT re-implement CF Images upload logic here.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { showroomStores } from "@backend/db/schema/showroom/stores";
import { brands } from "@backend/db/schema/brands/brands";
import { brandTypeMappings } from "@backend/db/schema/brands/brand_type_mappings";
import { ImageProcessorService } from "@backend/services/image-processor";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";

/** Content-type → file extension mapping for icon types we accept. */
const MIME_TO_EXT: Record<string, string> = {
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Maximum icon size we are willing to upload (1 MB). */
const MAX_ICON_BYTES = 1_048_576;

/** Timeout (ms) for each outbound HTTP fetch. */
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Derives the preferred icon extension from a content-type header value.
 * Falls back to "ico" when the type is unrecognised.
 */
function extFromContentType(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  return MIME_TO_EXT[base] ?? "ico";
}

/**
 * Returns true when the given content-type header describes an image format
 * we are willing to download and upload.
 */
function isAcceptableImageType(contentType: string): boolean {
  const base = contentType.split(";")[0].trim().toLowerCase();
  return base.startsWith("image/");
}

export class FaviconService {
  /**
   * Constructs a new `ImageProcessorService` using the same credential pattern
   * as showroom-scan.ts. Returns null when credentials are unavailable so
   * callers can bail out gracefully.
   */
  private async buildImageProcessor(env: Env): Promise<ImageProcessorService | null> {
    try {
      const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(env);
      if (!accountId || apiTokens.length === 0) return null;
      const [primaryToken, ...fallbackApiTokens] = apiTokens;
      return new ImageProcessorService(env, accountId, primaryToken, { fallbackApiTokens });
    } catch (err) {
      console.error("[FaviconService] Failed to build ImageProcessorService:", err);
      return null;
    }
  }

  /**
   * Given a website URL, scrapes the page HTML and returns the absolute URL of
   * the best available favicon/brand icon.
   *
   * Resolution order:
   *   1. Parse `<link>` tags from the page HTML with rel values:
   *      icon | shortcut icon | apple-touch-icon | apple-touch-icon-precomposed | mask-icon
   *   2. Among matching `<link>` tags, prefer `apple-touch-icon` (largest/cleanest),
   *      then the icon with the largest declared `sizes` attribute, then the first found.
   *   3. If no `<link>` tag resolves to a usable href: try `${origin}/favicon.ico`.
   *   4. If /favicon.ico also fails: fall through to the Google S2 favicon service:
   *      `https://www.google.com/s2/favicons?domain=${host}&sz=128`
   *
   * Returns `null` if every strategy fails.
   */
  async resolveFaviconUrl(websiteUrl: string): Promise<string | null> {
    // Normalise: add https:// when the caller omits the scheme.
    let normalised = websiteUrl.trim();
    if (!/^https?:\/\//i.test(normalised)) {
      normalised = `https://${normalised}`;
    }

    let origin: string;
    let host: string;
    try {
      const parsed = new URL(normalised);
      origin = parsed.origin;
      host = parsed.hostname;
    } catch {
      console.warn(`[FaviconService] Invalid URL: ${websiteUrl}`);
      return null;
    }

    // ── Step 1: fetch page HTML and parse <link> tags ─────────────────────────
    try {
      const response = await fetch(normalised, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; CoreRemodel/1.0; +https://126colby.com)",
        },
      });

      if (response.ok) {
        const iconRels = new Set([
          "icon",
          "shortcut icon",
          "apple-touch-icon",
          "apple-touch-icon-precomposed",
          "mask-icon",
        ]);

        type LinkCandidate = { rel: string; href: string; sizes: string };
        const candidates: LinkCandidate[] = [];

        // Parse <link> tags with the Workers-native, streaming HTMLRewriter API
        // instead of a regex. It reliably handles attributes in any order,
        // unquoted values, and extra attributes — cases a single regex cannot.
        await new HTMLRewriter()
          .on("link", {
            element(el) {
              const rel = (el.getAttribute("rel") ?? "").toLowerCase().trim();
              const href = (el.getAttribute("href") ?? "").trim();
              const sizes = (el.getAttribute("sizes") ?? "").trim();
              if (rel && href && iconRels.has(rel)) {
                candidates.push({ rel, href, sizes });
              }
            },
          })
          .transform(response)
          .arrayBuffer();

        if (candidates.length > 0) {
          // Scoring: prefer apple-touch-icon (score 100), then by declared size.
          const scored = candidates.map((c) => {
            let score = 0;
            if (
              c.rel === "apple-touch-icon" ||
              c.rel === "apple-touch-icon-precomposed"
            ) {
              score += 100;
            }
            const sizeParts = c.sizes.split("x");
            if (sizeParts.length === 2) {
              const dim = parseInt(sizeParts[0], 10);
              if (!isNaN(dim)) score += dim;
            }
            return { ...c, score };
          });

          scored.sort((a, b) => b.score - a.score);

          for (const candidate of scored) {
            try {
              const absolute = new URL(candidate.href, origin).toString();
              return absolute;
            } catch {
              // href was unparseable — try the next candidate.
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[FaviconService] Page fetch failed for ${normalised}:`, err);
    }

    // ── Step 2: /favicon.ico fallback ─────────────────────────────────────────
    const faviconIcoUrl = `${origin}/favicon.ico`;
    try {
      const headResp = await fetch(faviconIcoUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (headResp.ok) return faviconIcoUrl;
    } catch {
      // /favicon.ico HEAD failed — fall through to Google S2.
    }

    // ── Step 3: Google S2 favicon service ─────────────────────────────────────
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  }

  /**
   * Downloads the image at `iconUrl`, validates it is a real image within size
   * limits, and returns the raw `Blob` plus a derived file extension.
   *
   * Accepted content-types: image/x-icon, image/vnd.microsoft.icon, image/png,
   * image/jpeg, image/svg+xml, image/webp, image/gif (and any other image/*).
   *
   * Returns `null` on any fetch/validation failure — callers must handle null.
   */
  async fetchIconBlob(iconUrl: string): Promise<{ blob: Blob; ext: string } | null> {
    try {
      const response = await fetch(iconUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; CoreRemodel/1.0; +https://126colby.com)",
        },
      });

      if (!response.ok) {
        console.warn(
          `[FaviconService] Icon fetch returned ${response.status} for ${iconUrl}`,
        );
        return null;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!isAcceptableImageType(contentType)) {
        console.warn(
          `[FaviconService] Rejected non-image content-type "${contentType}" for ${iconUrl}`,
        );
        return null;
      }

      const blob = await response.blob();

      if (blob.size === 0) {
        console.warn(`[FaviconService] Empty blob received for ${iconUrl}`);
        return null;
      }

      if (blob.size > MAX_ICON_BYTES) {
        console.warn(
          `[FaviconService] Icon too large (${blob.size} bytes) for ${iconUrl}`,
        );
        return null;
      }

      const ext = extFromContentType(contentType);
      return { blob, ext };
    } catch (err) {
      console.warn(`[FaviconService] fetchIconBlob failed for ${iconUrl}:`, err);
      return null;
    }
  }

  /**
   * Full pipeline: resolve favicon URL → download → upload to Cloudflare Images.
   *
   * Uses a stable `customId` derived from `entity` + `entityId` so re-runs
   * overwrite the previous upload rather than creating duplicate images.
   *
   * Returns the Cloudflare Images delivery URL on success, `null` on any failure.
   * This method is safe to call inside `c.executionCtx.waitUntil(...)` — it
   * catches and logs all errors internally and never propagates.
   */
  async uploadFaviconForEntity(
    env: Env,
    opts: { entity: "showroom" | "brand"; entityId: number; websiteUrl: string },
  ): Promise<string | null> {
    try {
      const iconUrl = await this.resolveFaviconUrl(opts.websiteUrl);
      if (!iconUrl) {
        console.warn(
          `[FaviconService] No icon URL resolved for ${opts.entity}:${opts.entityId} (${opts.websiteUrl})`,
        );
        return null;
      }

      const downloaded = await this.fetchIconBlob(iconUrl);
      if (!downloaded) {
        console.warn(
          `[FaviconService] Icon download failed for ${opts.entity}:${opts.entityId} from ${iconUrl}`,
        );
        return null;
      }

      const svc = await this.buildImageProcessor(env);
      if (!svc) {
        console.warn("[FaviconService] ImageProcessorService unavailable — skipping upload");
        return null;
      }

      const customId = `${opts.entity}-icon-${opts.entityId}`;
      const filename = `${opts.entity}-${opts.entityId}.${downloaded.ext}`;

      const uploadResp = await svc.uploadToCloudflareImages(
        downloaded.blob,
        customId,
        filename,
      );

      const deliveryUrl = svc.getDeliveryUrl(uploadResp, customId);
      return deliveryUrl;
    } catch (err) {
      console.error(
        `[FaviconService] uploadFaviconForEntity failed for ${opts.entity}:${opts.entityId}:`,
        err,
      );
      return null;
    }
  }

  /**
   * Hydrates `showroom_stores.icon_cf_images_url` for the given store.
   *
   * Fires the full upload pipeline; if a delivery URL comes back, writes it to
   * D1. Safe to call from `waitUntil()` — never throws.
   */
  async hydrateShowroomIcon(
    env: Env,
    storeId: number,
    websiteUrl: string,
  ): Promise<void> {
    try {
      const url = await this.uploadFaviconForEntity(env, {
        entity: "showroom",
        entityId: storeId,
        websiteUrl,
      });

      if (!url) return;

      const db = drizzle(env.DB);
      await db
        .update(showroomStores)
        .set({ iconCfImagesUrl: url, updatedAt: new Date() })
        .where(eq(showroomStores.id, storeId));

      console.log(
        `[FaviconService] hydrateShowroomIcon: store ${storeId} icon set to ${url}`,
      );
    } catch (err) {
      console.error(
        `[FaviconService] hydrateShowroomIcon failed for store ${storeId}:`,
        err,
      );
    }
  }

  /**
   * Hydrates `brands.icon_cf_images_url` AND mirrors the same URL onto all
   * matching `brand_type_mappings.brand_icon_cf_images_url` rows for the brand.
   *
   * The mapping-level mirror lets category-contextual icon overrides fall back
   * gracefully to the canonical brand icon when no type-specific override exists.
   *
   * Safe to call from `waitUntil()` — never throws.
   */
  async hydrateBrandIcon(
    env: Env,
    brandId: number,
    websiteUrl: string,
  ): Promise<void> {
    try {
      const url = await this.uploadFaviconForEntity(env, {
        entity: "brand",
        entityId: brandId,
        websiteUrl,
      });

      if (!url) return;

      const db = drizzle(env.DB);

      // Write to both the brands table and all brand_type_mappings rows in parallel.
      await Promise.all([
        db
          .update(brands)
          .set({ iconCfImagesUrl: url, updatedAt: new Date() })
          .where(eq(brands.id, brandId)),
        db
          .update(brandTypeMappings)
          .set({ brandIconCfImagesUrl: url })
          .where(eq(brandTypeMappings.brandId, brandId)),
      ]);

      console.log(
        `[FaviconService] hydrateBrandIcon: brand ${brandId} icon set to ${url}`,
      );
    } catch (err) {
      console.error(
        `[FaviconService] hydrateBrandIcon failed for brand ${brandId}:`,
        err,
      );
    }
  }
}

/** Singleton instance shared across request handlers. */
export const faviconService = new FaviconService();
