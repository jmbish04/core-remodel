/**
 * `/sitemap.xml` — standard XML sitemap for crawlers (Google, Bing, etc.).
 *
 * Like `/openapi.json`, this is generated dynamically from the actual page
 * foldering under `src/frontend/pages/**` (see `@/lib/sitemap`) so it never
 * drifts from the real set of pages.
 *
 * Only STATIC, PUBLIC routes are emitted: a crawler sitemap must list concrete,
 * fetchable URLs, so dynamic patterns like `/rooms/[slug]` are excluded — and
 * `/admin/*` (auth-gated) is excluded so this public document never advertises
 * the admin surface to search engines. The full route set (incl. admin +
 * dynamic) is still available on the auth-gated `/sitemap.json` and `/sitemap`.
 *
 * Absolute URLs are built from the REQUEST origin (`new URL(request.url).origin`)
 * rather than the `site` value in `astro.config`, so the sitemap is correct
 * across every environment (localhost, preview, prod) without config coupling.
 */
import type { APIRoute } from "astro";

import { getSiteRoutes } from "@/lib/sitemap";

/**
 * Escape the five XML-significant characters. Route paths are effectively a
 * fixed vocabulary, but we escape defensively so the document is always
 * well-formed.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const GET: APIRoute = ({ request }) => {
  const origin = new URL(request.url).origin;
  const lastmod = new Date().toISOString();

  const urls = getSiteRoutes()
    // Static, public routes only — no dynamic patterns, and never the auth-gated
    // /admin surface (leaking admin paths to crawlers is a security risk).
    .filter((route) => !route.dynamic)
    .filter((route) => route.path !== "/admin" && !route.path.startsWith("/admin/"))
    .map((route) => {
      // Root path stays as-is; other paths are appended to the origin verbatim.
      const loc = escapeXml(`${origin}${route.path}`);
      return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
};
