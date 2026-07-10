/**
 * @fileoverview Absolute page-URL builders for MCP tool responses.
 *
 * MCP tools must hand back FULL, clickable URLs to the exact page where a change
 * can be viewed — not bare paths like `/admin/mcp-ops/bugs`. An AI model relays
 * whatever the tool returns, so a relative path shows up as un-clickable text and
 * the user can't jump to it. Every builder here prepends the deployed Worker
 * origin (`env.WORKER_URL`, set in `wrangler.jsonc`) so the response carries a
 * real link.
 *
 * If `WORKER_URL` is somehow unset (local dev without the var), we fall back to
 * the bare path — still correct, just not absolute — rather than emitting a
 * broken `undefined/...` string.
 */

/** Normalize the configured origin: trim, drop any trailing slash. */
function origin(env: Env): string {
  return (env.WORKER_URL ?? "").trim().replace(/\/+$/, "");
}

/**
 * Build an absolute URL for an in-app `path`. Leading slash is optional. When
 * `WORKER_URL` is missing, returns the normalized path unchanged.
 */
export function siteUrl(env: Env, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = origin(env);
  return base ? `${base}${p}` : p;
}

// ─── Domain-specific builders ────────────────────────────────────────────────
// Keep the path scheme in ONE place so a route rename is a single edit and every
// tool response stays consistent.

/** MCP Ops console, optionally a specific tab: bugs | features | logs | sessions | conversations. */
export function opsUrl(env: Env, tab?: string): string {
  return siteUrl(env, tab ? `/admin/mcp-ops/${tab}` : "/admin/mcp-ops");
}

/** A single saved-conversation viewer. */
export function conversationUrl(env: Env, id: number | string): string {
  return siteUrl(env, `/admin/mcp-ops/conversations/${id}`);
}

/** The artifact studio, by slug. */
export function studioUrl(env: Env, slug: string): string {
  return siteUrl(env, `/admin/studio/${slug}`);
}

/** The budget tracker — where planned line items + actual expenses live. */
export function budgetUrl(env: Env): string {
  return siteUrl(env, "/admin/budget/tracker");
}

/** A single material's detail page. */
export function materialUrl(env: Env, materialId: number | string): string {
  return siteUrl(env, `/admin/shopping/material/${materialId}`);
}

/** The materials schedule (the materials list view). */
export function materialsUrl(env: Env): string {
  return siteUrl(env, "/admin/shopping/schedule");
}

/** The showroom directory list. */
export function showroomListUrl(env: Env): string {
  return siteUrl(env, "/admin/shopping/showrooms/list");
}

/** A single showroom store's detail page (keyed by the store row id). */
export function showroomUrl(env: Env, storeId: number | string): string {
  return siteUrl(env, `/admin/shopping/store/${storeId}`);
}

/** The showroom drive-lists landing page. */
export function driveListsUrl(env: Env): string {
  return siteUrl(env, "/admin/shopping/drives");
}

/** A single showroom drive list (the drive viewport), by slug. */
export function driveListUrl(env: Env, slug: string): string {
  return siteUrl(env, `/admin/shopping/drives/${slug}`);
}

/** The brands directory, or a single brand when `brandId` is given. */
export function brandsUrl(env: Env, brandId?: number | string): string {
  return siteUrl(env, brandId != null ? `/admin/shopping/brands/${brandId}` : "/admin/shopping/brands");
}

/** The products catalog, or a single product when `productId` is given. */
export function productsUrl(env: Env, productId?: number | string): string {
  return siteUrl(env, productId != null ? `/admin/products/${productId}` : "/admin/products");
}
