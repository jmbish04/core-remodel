/**
 * @fileoverview Park-Finds HITL REST (0032 D1) — `/api/showroom-hitl-queue`.
 *
 * HTTP surface over the shared HITL service (`services/showroom/hitl-queue.ts`),
 * which the MCP park-find tools also call — so the Park-Finds page and the voice loop
 * never drift. Admin-gated (single-operator app; the gate is the authz).
 */
import {
  countPending,
  decideHitlCandidate,
  getHitlCandidate,
  HITL_DECISIONS,
  listHitlQueue,
} from "@backend/services/showroom/hitl-queue";
import { isRequestAuthenticated } from "@backend/utils/access";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

const showroomHitlQueueRouter = new Hono<{ Bindings: Env }>();

showroomHitlQueueRouter.use("*", async (c, next) => {
  if (!(await isRequestAuthenticated(c.req.raw, c.env))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** GET /api/showroom-hitl-queue?decision=TBD|PROCESS|DO_NOT_PROCESS&limit= — list + pending count. */
showroomHitlQueueRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const decisionParam = c.req.query("decision");
  const decision = HITL_DECISIONS.includes(decisionParam as never)
    ? (decisionParam as (typeof HITL_DECISIONS)[number])
    : undefined;
  const limit = Number.parseInt(c.req.query("limit") || "200", 10) || 200;
  const [candidates, pending] = await Promise.all([
    listHitlQueue(db, { decision, limit }),
    countPending(db),
  ]);
  return c.json({ count: candidates.length, pending, candidates });
});

/** GET /api/showroom-hitl-queue/:id */
showroomHitlQueueRouter.get("/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
  const candidate = await getHitlCandidate(drizzle(c.env.DB), id);
  if (!candidate) return c.json({ error: "Not found" }, 404);
  return c.json({ candidate });
});

const decideBody = z.object({
  decision: z.enum(["PROCESS", "DO_NOT_PROCESS"]),
  addExclusion: z.boolean().optional(),
  reasonMarkdown: z.string().nullable().optional(),
  reasonHtml: z.string().nullable().optional(),
});

/** POST /api/showroom-hitl-queue/:id/decide — approve (→ store) or reject (→ optional exclusion). */
showroomHitlQueueRouter.post("/:id/decide", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
  const parsed = decideBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid body", detail: parsed.error.issues }, 400);
  const result = await decideHitlCandidate(drizzle(c.env.DB), id, parsed.data);
  if (!result.ok) return c.json({ error: result.reason ?? "Failed" }, result.reason === "not-found" ? 404 : 400);
  return c.json(result);
});

export default showroomHitlQueueRouter;
