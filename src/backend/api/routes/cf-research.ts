/**
 * @fileoverview Hono routes for Engine B — the self-hosted Cloudflare Agents
 * Deep Research engine (DeepResearchAgent).
 *
 * Mounted under /api/admin/research/cf-engine (inherits requireAccessAuth from
 * the /api/admin/* guard). Engine B writes into the SAME `research_sessions`
 * table as Engine A (with engine = "cf"), so the existing Phase-6 portal
 * endpoints — GET /api/admin/research/:id, /:id/markdown, /:id/visualizer —
 * serve Engine-B sessions unchanged.
 *
 *   POST /cf-engine            — create a session + trigger the 6-agent loop
 *   GET  /cf-engine/:id/status — poll the live loop state (D1 row + cf_engine_state)
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { getAgentByName } from "agents";

import { researchSessions } from "@backend/db/schema/admin/research_sessions";
import {
  cfEngineConfigSchema,
  cfTargetTypeSchema,
} from "@backend/ai/agents/DeepResearchAgent/types";
import type { DeepResearchAgent } from "@backend/ai/agents/DeepResearchAgent";

export const cfResearchRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// POST /cf-engine — create session + kick the loop
// ---------------------------------------------------------------------------

cfResearchRouter.post("/", async (c) => {
  const body = await c.req.json<{
    topic?: string;
    prompt?: string;
    targetType?: string;
    targetId?: number;
    config?: Record<string, unknown>;
  }>().catch(() => ({}) as Record<string, unknown>);

  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
  if (!topic || topic.length < 5) {
    return c.json(
      { error: "Topic is required and must be at least 5 characters" },
      400,
    );
  }

  // Validate the optional config + target up front (clear 400 on bad input).
  const configResult = cfEngineConfigSchema.partial().safeParse(body?.config ?? {});
  if (!configResult.success) {
    return c.json(
      { error: "Invalid config", detail: configResult.error.flatten() },
      400,
    );
  }
  const targetType = cfTargetTypeSchema
    .catch("generic")
    .parse(body?.targetType ?? "generic");

  const db = drizzle(c.env.DB);
  const [session] = await db
    .insert(researchSessions)
    .values({
      topic,
      prompt: typeof body?.prompt === "string" ? body.prompt.trim() || null : null,
      engine: "cf",
      status: "pending",
    })
    .returning();

  try {
    const agent = await getAgentByName<Env, DeepResearchAgent>(
      c.env.DEEP_RESEARCH_AGENT as any,
      `cf-research-${session.id}`,
    );
    c.executionCtx.waitUntil(
      (agent as any)
        .runDeepResearch({
          sessionId: session.id,
          topic,
          prompt:
            typeof body?.prompt === "string" ? body.prompt.trim() || null : null,
          targetType,
          targetId:
            typeof body?.targetId === "number" ? body.targetId : null,
          config: configResult.data,
        })
        .catch(async (err: unknown) => {
          console.error(`Engine B failed for session ${session.id}:`, err);
          await db
            .update(researchSessions)
            .set({
              status: "failed",
              errorMessage:
                err instanceof Error ? err.message : "Failed to run Engine B",
            })
            .where(eq(researchSessions.id, session.id))
            .catch(() => {});
        }),
    );
  } catch (err) {
    await db
      .update(researchSessions)
      .set({
        status: "failed",
        errorMessage:
          err instanceof Error ? err.message : "Failed to dispatch Engine B",
      })
      .where(eq(researchSessions.id, session.id));
    return c.json(
      { error: "Failed to start Engine B", sessionId: session.id },
      500,
    );
  }

  return c.json(
    { sessionId: session.id, engine: "cf", status: "researching", topic },
    202,
  );
});

// ---------------------------------------------------------------------------
// GET /cf-engine/:id/status — live loop state for the portal progress UI
// ---------------------------------------------------------------------------

cfResearchRouter.get("/:id/status", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid session ID" }, 400);

  const db = drizzle(c.env.DB);
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, id))
    .limit(1);

  if (!session) return c.json({ error: "Session not found" }, 404);

  let loopState: unknown = null;
  if (session.cfEngineState) {
    try {
      loopState = JSON.parse(session.cfEngineState);
    } catch {
      loopState = null;
    }
  }

  return c.json({
    sessionId: session.id,
    engine: session.engine,
    status: session.status,
    topic: session.topic,
    r2MarkdownKey: session.r2MarkdownKey,
    r2WebappKey: session.r2WebappKey,
    vectorNamespace: session.vectorNamespace,
    chunkCount: session.chunkCount,
    errorMessage: session.errorMessage,
    loopState,
  });
});
