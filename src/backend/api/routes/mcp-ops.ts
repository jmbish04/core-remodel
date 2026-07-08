/**
 * @fileoverview Admin read API for MCP ops/observability (0017 §8).
 *
 * `GET /api/mcp-ops/*` — admin-gated JSON reads backing the `/admin/mcp-ops`
 * tabbed view: session transcripts, exported conversations, the agent bug
 * backlog, and the feature-request backlog. Read-only; all writes happen
 * through the MCP `ops` tools. Every handler is gated by
 * `isRequestAuthenticated` (the `/admin` cookie / bearer gate).
 *
 * The `pnpm run mcp:issues` convenience script hits `GET /issues?status=open`
 * so agents that aren't chatting over MCP can still read the backlog.
 */
import {
  mcpAgentIssues,
  mcpConversations,
  mcpFeatureRequests,
  mcpSessions,
  mcpToolInvocations,
} from "@backend/db";
import { isRequestAuthenticated } from "@backend/utils/access";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const mcpOpsRouter = new Hono<{ Bindings: Env }>();

/** Gate every route behind the admin cookie / bearer auth. */
mcpOpsRouter.use("*", async (c, next) => {
  if (!(await isRequestAuthenticated(c.req.raw, c.env))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** Clamp a `?limit=` query param into a sane range. */
function limitParam(c: { req: { query: (k: string) => string | undefined } }, def = 100): number {
  const raw = Number(c.req.query("limit"));
  if (!Number.isFinite(raw)) return def;
  return Math.max(1, Math.min(Math.trunc(raw), 500));
}

// ─── Overview / stats ───────────────────────────────────────────────────────

mcpOpsRouter.get("/overview", async (c) => {
  const db = drizzle(c.env.DB);
  const [sessions, calls, errors, openBugs, openFeatures, conversations] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(mcpSessions).get(),
    db.select({ n: sql<number>`count(*)` }).from(mcpToolInvocations).get(),
    db
      .select({ n: sql<number>`count(*)` })
      .from(mcpToolInvocations)
      .where(eq(mcpToolInvocations.ok, false))
      .get(),
    db
      .select({ n: sql<number>`count(*)` })
      .from(mcpAgentIssues)
      .where(eq(mcpAgentIssues.status, "open"))
      .get(),
    db
      .select({ n: sql<number>`count(*)` })
      .from(mcpFeatureRequests)
      .where(eq(mcpFeatureRequests.status, "requested"))
      .get(),
    db.select({ n: sql<number>`count(*)` }).from(mcpConversations).get(),
  ]);
  return c.json({
    sessions: Number(sessions?.n ?? 0),
    toolCalls: Number(calls?.n ?? 0),
    errors: Number(errors?.n ?? 0),
    openBugs: Number(openBugs?.n ?? 0),
    openFeatures: Number(openFeatures?.n ?? 0),
    conversations: Number(conversations?.n ?? 0),
  });
});

// ─── Sessions + transcripts ───────────────────────────────────────────────

mcpOpsRouter.get("/sessions", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(mcpSessions)
    .orderBy(desc(mcpSessions.lastSeenAt))
    .limit(limitParam(c))
    .all();
  return c.json({ count: rows.length, sessions: rows });
});

mcpOpsRouter.get("/sessions/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const [session] = await db
    .select()
    .from(mcpSessions)
    .where(eq(mcpSessions.id, id))
    .limit(1);
  if (!session) return c.json({ error: "Session not found" }, 404);
  const invocations = await db
    .select()
    .from(mcpToolInvocations)
    .where(eq(mcpToolInvocations.sessionId, id))
    .orderBy(desc(mcpToolInvocations.createdAt))
    .limit(limitParam(c, 500))
    .all();
  return c.json({ session, invocations });
});

mcpOpsRouter.get("/invocations", async (c) => {
  const db = drizzle(c.env.DB);
  const okParam = c.req.query("ok");
  const where =
    okParam === "false"
      ? eq(mcpToolInvocations.ok, false)
      : okParam === "true"
        ? eq(mcpToolInvocations.ok, true)
        : undefined;
  const rows = await db
    .select()
    .from(mcpToolInvocations)
    .where(where)
    .orderBy(desc(mcpToolInvocations.createdAt))
    .limit(limitParam(c))
    .all();
  return c.json({ count: rows.length, invocations: rows });
});

// ─── Conversations ──────────────────────────────────────────────────────────

mcpOpsRouter.get("/conversations", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      id: mcpConversations.id,
      sessionId: mcpConversations.sessionId,
      title: mcpConversations.title,
      summary: mcpConversations.summary,
      format: mcpConversations.format,
      messageCount: mcpConversations.messageCount,
      createdAt: mcpConversations.createdAt,
      updatedAt: mcpConversations.updatedAt,
    })
    .from(mcpConversations)
    .orderBy(desc(mcpConversations.updatedAt))
    .limit(limitParam(c))
    .all();
  return c.json({ count: rows.length, conversations: rows });
});

mcpOpsRouter.get("/conversations/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Bad id" }, 400);
  const [row] = await db
    .select()
    .from(mcpConversations)
    .where(eq(mcpConversations.id, id))
    .limit(1);
  if (!row) return c.json({ error: "Conversation not found" }, 404);

  // Resolve R2-offloaded content back to inline text for the viewer.
  let content = row.content;
  if (row.storage === "r2") {
    const obj = await c.env.ARTIFACTS_BUCKET.get(row.content);
    content = obj ? await obj.text() : "";
  }
  return c.json({ ...row, content });
});

// ─── Bug backlog ──────────────────────────────────────────────────────────

mcpOpsRouter.get("/issues", async (c) => {
  const db = drizzle(c.env.DB);
  const status = c.req.query("status") ?? "open";
  const rows = await db
    .select()
    .from(mcpAgentIssues)
    .where(status === "all" ? undefined : eq(mcpAgentIssues.status, status))
    .orderBy(desc(mcpAgentIssues.createdAt))
    .limit(limitParam(c))
    .all();
  return c.json({ status, count: rows.length, issues: rows });
});

// ─── Feature backlog ──────────────────────────────────────────────────────

mcpOpsRouter.get("/features", async (c) => {
  const db = drizzle(c.env.DB);
  const status = c.req.query("status") ?? "all";
  const rows = await db
    .select()
    .from(mcpFeatureRequests)
    .where(status === "all" ? undefined : eq(mcpFeatureRequests.status, status))
    .orderBy(desc(mcpFeatureRequests.createdAt))
    .limit(limitParam(c))
    .all();
  return c.json({ status, count: rows.length, features: rows });
});

export default mcpOpsRouter;
