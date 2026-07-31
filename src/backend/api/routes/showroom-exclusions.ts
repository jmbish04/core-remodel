/**
 * @fileoverview Showroom exclusions REST (0032 D2c) — `/api/showroom-exclusions`.
 *
 * The "seen it, not interested, never show me again" list, auto-applied to every
 * discovery sweep. HTTP surface over the shared discovery-search service, which the MCP
 * exclusion tools also call (parity). Admin-gated.
 */
import { addExclusion, listExclusions, removeExclusion } from "@backend/services/showroom/discovery-search";
import { isRequestAuthenticated } from "@backend/utils/access";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

const showroomExclusionsRouter = new Hono<{ Bindings: Env }>();

showroomExclusionsRouter.use("*", async (c, next) => {
  if (!(await isRequestAuthenticated(c.req.raw, c.env))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** GET /api/showroom-exclusions?limit= — the not-interested list. */
showroomExclusionsRouter.get("/", async (c) => {
  const limit = Number.parseInt(c.req.query("limit") || "200", 10) || 200;
  const exclusions = await listExclusions(drizzle(c.env.DB), limit);
  return c.json({ count: exclusions.length, exclusions });
});

const addSchema = z.object({
  placeId: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  locationStreetNumber: z.string().nullable().optional(),
  locationStreetName: z.string().nullable().optional(),
  locationCity: z.string().nullable().optional(),
  locationState: z.string().nullable().optional(),
  locationZipCode: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  reasonMarkdown: z.string().nullable().optional(),
  reasonHtml: z.string().nullable().optional(),
  source: z.enum(["manual", "ai"]).optional(),
});

/** POST /api/showroom-exclusions — add a not-interested place (idempotent by place_id). */
showroomExclusionsRouter.post("/", async (c) => {
  const parsed = addSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid body", detail: parsed.error.issues }, 400);
  const result = await addExclusion(drizzle(c.env.DB), parsed.data);
  return c.json(result);
});

/** DELETE /api/showroom-exclusions/:id — un-exclude (the place can resurface again). */
showroomExclusionsRouter.delete("/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
  const result = await removeExclusion(drizzle(c.env.DB), id);
  if (!result.ok) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

export default showroomExclusionsRouter;
