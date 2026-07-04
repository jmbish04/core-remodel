/**
 * `/sitemap.json` — machine-readable, always-complete page inventory.
 *
 * This is the frontend counterpart to `/openapi.json`: just as the OpenAPI
 * document is regenerated from the registered backend routes on every deploy,
 * this endpoint returns the full list of page URLs derived from the actual
 * folder tree under `src/frontend/pages/**` (see `@/lib/sitemap`). It includes
 * BOTH static routes and dynamic route patterns, with the `dynamic` flag and
 * `params` list so consumers can tell concrete URLs from URL patterns.
 *
 * Astro endpoint: a `.ts` file under `pages/` that exports `GET` and returns a
 * standard `Response`.
 */
import type { APIRoute } from "astro";

import { getSiteRoutes } from "@/lib/sitemap";

export const GET: APIRoute = () => {
  const routes = getSiteRoutes();

  const body = {
    /** ISO-8601 timestamp of when this response was generated. */
    generatedAt: new Date().toISOString(),
    /** Total number of discovered routes (static + dynamic). */
    count: routes.length,
    /** The full inventory; dynamic patterns are flagged via `dynamic`. */
    routes,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json",
    },
  });
};
