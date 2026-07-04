/**
 * Dynamic sitemap / route inventory.
 *
 * This module is the frontend analogue of `/openapi.json`. Where the OpenAPI
 * spec is regenerated from the *registered Hono routes* on every deploy so it
 * never drifts from the actual backend surface, this module regenerates the
 * list of *page URLs* from the actual Astro page foldering under
 * `src/frontend/pages/**` so the sitemap never drifts from the actual frontend
 * surface.
 *
 * How it stays in sync
 * --------------------
 * We use Vite's `import.meta.glob` to enumerate every `.astro` page file at
 * BUILD time. Vite resolves the glob against the real folder tree during the
 * build, so the resulting list reflects exactly which pages existed at build
 * time — identical in spirit to how the OpenAPI document is a snapshot of the
 * registered routes at deploy time. Add a page file, ship a build, and it shows
 * up here automatically. Delete one, and it disappears. No manual list to keep
 * in sync.
 *
 * We intentionally use `{ eager: false }` and only ever read the *keys* (the
 * file paths) of the returned record. We never call the lazy import functions,
 * so no page module is actually loaded/executed — this is pure static path
 * introspection and adds no runtime cost or bundle weight.
 *
 * Route derivation is filesystem-routing aware: it understands `index.astro`
 * collapsing to the parent directory, `[param]` dynamic segments, and
 * `[...rest]` catch-all segments, mirroring Astro's own file-based router.
 */

/**
 * A single discovered page route.
 */
export interface SiteRoute {
  /**
   * The URL path this page is served at, derived from the file path.
   * Dynamic segments are kept verbatim (e.g. `/rooms/[slug]`,
   * `/questionnaire/[...rest]`).
   */
  path: string;
  /**
   * The source file path (as returned by `import.meta.glob`), e.g.
   * `/src/frontend/pages/rooms/[slug].astro`. Useful for debugging /
   * traceability in the JSON inventory.
   */
  file: string;
  /**
   * True when the route contains at least one `[param]` or `[...rest]`
   * segment. Dynamic routes are patterns, not concrete crawlable URLs, so the
   * XML sitemap excludes them and the human page renders them as
   * non-clickable.
   */
  dynamic: boolean;
  /**
   * The names of the dynamic parameters in path order. For `[slug]` this is
   * `["slug"]`; for `[...rest]` this is `["rest"]`; for a fully static route
   * this is `[]`.
   */
  params: string[];
}

/**
 * The prefix stripped from every glob key to turn a file path into a route.
 * `srcDir` is `./src/frontend`, so pages live at `src/frontend/pages/**` and
 * the glob keys are rooted at the project root with a leading slash.
 */
const PAGES_PREFIX = "/src/frontend/pages";

/**
 * Basenames (without extension) that are never real, crawlable page routes and
 * must be excluded from the inventory:
 *  - `404` — the not-found handler, not a navigable destination.
 *  - the three sitemap files themselves — we don't list the sitemap in the
 *    sitemap (avoids self-reference noise).
 *
 * Note: `sitemap.astro`, `sitemap.json.ts` and `sitemap.xml.ts` all reduce to
 * the basename token `sitemap` after stripping their extension chain, so a
 * single `sitemap` entry here covers all three. We keep the explicit names in
 * this comment for clarity.
 */
const EXCLUDED_BASENAMES = new Set(["404", "sitemap"]);

/**
 * Extract the final path segment's basename with all extensions removed.
 * `rooms/[slug].astro` -> `[slug]`, `sitemap.json.ts` -> `sitemap`.
 */
function basenameWithoutExt(filePath: string): string {
  const last = filePath.split("/").pop() ?? "";
  // Strip everything from the FIRST dot onward so multi-part extensions like
  // `.json.ts` collapse to their base token.
  const dotIndex = last.indexOf(".");
  return dotIndex === -1 ? last : last.slice(0, dotIndex);
}

/**
 * Detect a private/partial page. Astro treats files/dirs whose name starts with
 * an underscore as private (not routed). We honor the same convention and skip
 * any file whose basename begins with `_`.
 */
function isPrivateFile(filePath: string): boolean {
  return basenameWithoutExt(filePath).startsWith("_");
}

/**
 * Turn a single glob file-path key into a {@link SiteRoute}, or `null` if the
 * file should be excluded from the inventory.
 *
 * Derivation rules (mirrors Astro file-based routing):
 *  1. Strip the `/src/frontend/pages` prefix and the `.astro` suffix.
 *  2. A trailing `/index` collapses to its parent directory:
 *       `/index`        -> `/`
 *       `/admin/index`  -> `/admin`
 *  3. `[param]` and `[...rest]` segments are kept verbatim in the path and
 *     recorded in `params` (`param`, `rest`). Presence of any such segment
 *     sets `dynamic: true`.
 *  4. Files whose basename starts with `_`, plus `404` and the sitemap files,
 *     are skipped (handled by the caller / helpers).
 */
function fileToRoute(filePath: string): SiteRoute | null {
  if (isPrivateFile(filePath)) return null;
  if (EXCLUDED_BASENAMES.has(basenameWithoutExt(filePath))) return null;

  // 1. Strip prefix + `.astro` suffix -> route body (no leading slash yet).
  let route = filePath;
  if (route.startsWith(PAGES_PREFIX)) {
    route = route.slice(PAGES_PREFIX.length);
  }
  route = route.replace(/\.astro$/, "");

  // 2. Collapse a trailing `/index` to its parent.
  //    `/index` -> ``  (becomes `/` below), `/admin/index` -> `/admin`.
  if (route === "/index") {
    route = "";
  } else if (route.endsWith("/index")) {
    route = route.slice(0, -"/index".length);
  }

  // Normalize: ensure a single leading slash and no trailing slash (root stays `/`).
  if (route === "") {
    route = "/";
  }

  // 3. Discover dynamic params from `[param]` / `[...rest]` segments.
  const params: string[] = [];
  for (const segment of route.split("/")) {
    const match = segment.match(/^\[(?:\.\.\.)?([^\]]+)\]$/);
    if (match) params.push(match[1]);
  }

  return {
    path: route,
    file: filePath,
    dynamic: params.length > 0,
    params,
  };
}

/**
 * Enumerate every page route from the actual folder tree under
 * `src/frontend/pages/**`.
 *
 * Uses `import.meta.glob(..., { eager: false })` and reads only the KEYS (file
 * paths). No page module is imported or executed. The returned list is sorted
 * by `path` for stable, deterministic output (so the JSON inventory diffs
 * cleanly between builds).
 *
 * This is the single source of truth consumed by:
 *  - `/sitemap.json` — the full machine-readable inventory (static + dynamic).
 *  - `/sitemap.xml`  — the crawler sitemap (static routes only).
 *  - `/sitemap`      — the human-readable page.
 */
export function getSiteRoutes(): SiteRoute[] {
  // Vite statically resolves this glob at build time against the real tree.
  const files = import.meta.glob("/src/frontend/pages/**/*.astro", {
    eager: false,
  });

  const routes: SiteRoute[] = [];
  for (const filePath of Object.keys(files)) {
    const route = fileToRoute(filePath);
    if (route) routes.push(route);
  }

  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}

/**
 * The grouping key used for a route on the human-readable page. Routes are
 * bucketed by their first path segment:
 *   `/`               -> "(root)"
 *   `/floor-plan`     -> "(root)"   (single top-level page, no sub-segment)
 *   `/admin/config`   -> "admin"
 *   `/rooms/[slug]`   -> "rooms"
 *
 * Root-level pages (paths with no nested segment, including `/` itself) are
 * grouped under the sentinel `"(root)"` so they render together in one section
 * rather than each becoming its own singleton group.
 */
export function topSegmentOf(route: SiteRoute): string {
  // Trim the leading slash, then take the first segment.
  const trimmed = route.path.replace(/^\//, "");
  if (trimmed === "") return "(root)";
  const firstSegment = trimmed.split("/")[0];
  // A path like `/floor-plan` has exactly one segment -> group it under root.
  const hasNesting = trimmed.includes("/");
  return hasNesting ? firstSegment : "(root)";
}

/**
 * Group the discovered routes by their top-level path segment for the
 * human-readable sitemap page. Returns a plain object keyed by group name
 * (`"(root)"`, `"admin"`, `"rooms"`, ...), each value the routes in that group
 * preserving the already-sorted order from {@link getSiteRoutes}.
 */
export function groupRoutesByTopSegment(
  routes: SiteRoute[],
): Record<string, SiteRoute[]> {
  const groups: Record<string, SiteRoute[]> = {};
  for (const route of routes) {
    const key = topSegmentOf(route);
    (groups[key] ??= []).push(route);
  }
  return groups;
}
