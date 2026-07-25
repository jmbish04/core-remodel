/**
 * @fileoverview FaviconService
 *
 * Resolves a website's favicon / brand icon and writes its URL back to the
 * appropriate DB row. The icon is HOTLINKED from its source (the site's own
 * `<link>` favicon, `/favicon.ico`, or the Google S2 favicon service) — it is
 * NOT round-tripped through Cloudflare Images.
 *
 * Why hotlink (0025): favicons are almost always `.ico`/`.svg`, which the
 * Cloudflare Images upload API rejects with HTTP 400 — that throw was caught
 * silently, so `iconCfImagesUrl` never got written (icons came back empty).
 * A favicon is already served from the site's own host (or Google's), so we
 * store that URL directly and render it as a plain `<img src>`, mirroring the
 * brand-imagery hotlink pattern (`brands/brand-image-harvest.ts`). The column
 * name (`icon_cf_images_url`) is retained for compatibility; it now holds a
 * hotlinked URL rather than an imagedelivery.net one.
 *
 * Used in `waitUntil()` fire-and-forget contexts — every method is fully
 * wrapped in try/catch and NEVER throws (a thrown error inside waitUntil
 * silently kills the background task with no retries).
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { showroomStores } from "@backend/db/schema/showroom/stores";
import { brands } from "@backend/db/schema/brands/brands";
import { brandTypeMappings } from "@backend/db/schema/brands/brand_type_mappings";

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

/** The always-hotlinkable Google S2 favicon URL for a host (128px PNG). */
function googleS2FaviconUrl(websiteUrl: string): string | null {
  const normalised = /^https?:\/\//i.test(websiteUrl.trim())
    ? websiteUrl.trim()
    : `https://${websiteUrl.trim()}`;
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(normalised).hostname}&sz=128`;
  } catch {
    return null;
  }
}

export class FaviconService {
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
   * Resolve a hotlinkable icon URL for an entity: the site's own favicon when it
   * actually serves an image, otherwise the always-available Google S2 favicon.
   *
   * No Cloudflare Images upload — the returned URL is stored as-is and rendered
   * as a plain `<img src>`. We still download-validate the resolved favicon (it
   * must return a real image within the size limit) so a 404/hotlink-blocked
   * `<link>` href doesn't get persisted; on failure we fall back to Google S2.
   *
   * Returns the icon URL on success, `null` when even the fallback can't be
   * built (e.g. an unparseable website URL). Safe inside `waitUntil(...)` — it
   * catches and logs all errors internally and never propagates.
   */
  async resolveIconUrlForEntity(
    opts: { entity: "showroom" | "brand"; entityId: number; websiteUrl: string },
  ): Promise<string | null> {
    try {
      const resolved = await this.resolveFaviconUrl(opts.websiteUrl);
      const fallback = googleS2FaviconUrl(opts.websiteUrl);

      // The resolved URL is preferred, but a scraped <link>/favicon.ico href can
      // 404 or hotlink-block — validate it actually serves an image first.
      if (resolved) {
        if (resolved === fallback) return resolved; // S2 is trusted, skip the fetch
        const ok = await this.fetchIconBlob(resolved);
        if (ok) return resolved;
        console.warn(
          `[FaviconService] Resolved icon unusable for ${opts.entity}:${opts.entityId} (${resolved}) — falling back to Google S2`,
        );
      }

      if (fallback) return fallback;

      console.warn(
        `[FaviconService] No icon URL resolvable for ${opts.entity}:${opts.entityId} (${opts.websiteUrl})`,
      );
      return null;
    } catch (err) {
      console.error(
        `[FaviconService] resolveIconUrlForEntity failed for ${opts.entity}:${opts.entityId}:`,
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
      const url = await this.resolveIconUrlForEntity({
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
      const url = await this.resolveIconUrlForEntity({
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
