/**
 * @fileoverview Discovery-search REST (0032 D2c) — `/api/showroom-searches`.
 *
 * HTTP surface over the shared discovery-search service (`services/showroom/
 * discovery-search.ts`), which the MCP `find_showrooms` + slug-action tools also call —
 * so the finder page and a voice session never drift (AGENTS.md parity contract).
 * Admin-gated (single-operator app; the gate is the authz).
 */
import {
  excludeSearchResult,
  finalizeSearch,
  findShowrooms,
  getSearch,
  getSearchRevisions,
  importSearchResults,
  listSearches,
} from "@backend/services/showroom/discovery-search";
import { isRequestAuthenticated } from "@backend/utils/access";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

const showroomSearchesRouter = new Hono<{ Bindings: Env }>();

showroomSearchesRouter.use("*", async (c, next) => {
  if (!(await isRequestAuthenticated(c.req.raw, c.env))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

const aiResultSchema = z.object({
  placeId: z.string().nullable().optional(),
  name: z.string(),
  fullAddress: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  category: z.string().nullable().optional(),
  reasoning: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

const runBody = z.object({
  near: z.string().nullable().optional(),
  radiusM: z.number().nullable().optional(),
  query: z.string().nullable().optional(),
  broad: z.boolean().optional(),
  likeStoreId: z.number().int().nullable().optional(),
  excludeCategories: z.array(z.string()).optional(),
  excludeStoreIds: z.array(z.number().int()).optional(),
  usePlaces: z.boolean().optional(),
  aiResults: z.array(aiResultSchema).optional(),
  slug: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  originConversation: z.string().nullable().optional(),
});

/** POST /api/showroom-searches — create+run a new search, or refine an existing slug. */
showroomSearchesRouter.post("/", async (c) => {
  const parsed = runBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid body", detail: parsed.error.issues }, 400);
  const result = await findShowrooms(c.env, { ...parsed.data, origin: "ui" });
  if (!result.ok && result.reason === "not-found") return c.json({ error: "Search slug not found" }, 404);
  return c.json(result);
});

/** GET /api/showroom-searches?limit= — list recent searches. */
showroomSearchesRouter.get("/", async (c) => {
  const limit = Number.parseInt(c.req.query("limit") || "50", 10) || 50;
  const searches = await listSearches(drizzle(c.env.DB), limit);
  return c.json({ count: searches.length, searches });
});

/** GET /api/showroom-searches/:slug — the search + its current result rows. */
showroomSearchesRouter.get("/:slug", async (c) => {
  const data = await getSearch(drizzle(c.env.DB), c.req.param("slug"));
  if (!data) return c.json({ error: "Not found" }, 404);
  return c.json(data);
});

/** GET /api/showroom-searches/:slug/revisions — the numbered revision history. */
showroomSearchesRouter.get("/:slug/revisions", async (c) => {
  const revisions = await getSearchRevisions(drizzle(c.env.DB), c.req.param("slug"));
  if (revisions == null) return c.json({ error: "Not found" }, 404);
  return c.json({ count: revisions.length, revisions });
});

/** POST /api/showroom-searches/:slug/finalize — mark the slug final. */
showroomSearchesRouter.post("/:slug/finalize", async (c) => {
  const result = await finalizeSearch(drizzle(c.env.DB), c.req.param("slug"));
  if (!result.ok) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

const importSchema = z.object({ resultIds: z.array(z.number().int()).min(1) });

/** POST /api/showroom-searches/:slug/import — promote selected results into the directory. */
showroomSearchesRouter.post("/:slug/import", async (c) => {
  const parsed = importSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid body", detail: parsed.error.issues }, 400);
  const result = await importSearchResults(c.env, c.req.param("slug"), parsed.data.resultIds);
  if (!result.ok) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

const excludeSchema = z.object({
  resultId: z.number().int(),
  reasonMarkdown: z.string().nullable().optional(),
  reasonHtml: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
});

/** POST /api/showroom-searches/:slug/exclude — hide a result + add a permanent exclusion. */
showroomSearchesRouter.post("/:slug/exclude", async (c) => {
  const parsed = excludeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid body", detail: parsed.error.issues }, 400);
  const { resultId, ...reason } = parsed.data;
  const result = await excludeSearchResult(c.env, c.req.param("slug"), resultId, reason);
  if (!result.ok) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

export default showroomSearchesRouter;
