/**
 * @fileoverview Hono API routes for the Research Center.
 *
 * All routes live under /api/admin/research and are protected by
 * the existing requireAccessAuth middleware on /api/admin/*.
 *
 * Endpoints:
 *   POST   /                 — Create a new research session + trigger async research
 *   POST   /backfill         — Seed pre-researched content (markdown + webapp) directly
 *   GET    /                 — List all research sessions
 *   GET    /:id              — Get single session detail
 *   GET    /:id/markdown     — Stream raw markdown from R2
 *   GET    /:id/visualizer   — Serve visualizer via Dynamic Worker sandbox
 *   DELETE /:id              — Delete session + R2 objects + Vectorize vectors
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc } from "drizzle-orm";
import { getAgentByName } from "agents";

import { researchSessions } from "@backend/db/schema/admin/research_sessions";
import { deleteSessionVectors, embedAndUpsertChunks } from "@backend/ai/agents/ResearchAgent/methods/embed-chunks";
import { chunkMarkdown } from "@backend/ai/agents/ResearchAgent/methods/chunk-markdown";
import { r2MarkdownKey, r2WebappKey } from "@backend/ai/agents/ResearchAgent/types";
import type { ResearchAgent } from "@backend/ai/agents/ResearchAgent";

export const researchRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// POST / — Create a new research session
// ---------------------------------------------------------------------------

researchRouter.post("/", async (c) => {
  const body = await c.req.json<{
    topic?: string;
    prompt?: string;
    researchPlan?: string;
    enableMcpBridge?: boolean;
    mode?: "standard" | "max";
    visualization?: "auto" | "off";
    usePlanReview?: boolean;
  }>();
  const topic = body?.topic?.trim();
  const prompt = body?.prompt?.trim() || null;
  const researchPlan = body?.researchPlan?.trim() || null;
  // Default ON: new sessions go through the HITL plan-review gate. Pass
  // usePlanReview:false to preserve the legacy straight-through behavior.
  const usePlanReview = body?.usePlanReview !== false;

  if (!topic || topic.length < 5) {
    return c.json(
      { error: "Topic is required and must be at least 5 characters" },
      400,
    );
  }

  const db = drizzle(c.env.DB);

  // Create the D1 record
  const [session] = await db
    .insert(researchSessions)
    .values({ topic, prompt, researchPlan, status: "pending" })
    .returning();

  // Trigger the ResearchAgent asynchronously and return 202 immediately. The
  // dispatch MUST be registered with executionCtx.waitUntil — otherwise the
  // unawaited RPC is dropped when the response is sent and the session is left
  // stuck at "pending" (the agent's startResearch never runs).
  try {
    const agent = await getAgentByName<Env, ResearchAgent>(
      c.env.RESEARCH_AGENT as any,
      `research-${session.id}`,
    );
    c.executionCtx.waitUntil(
      (agent as any)
        .startResearch({
          topic,
          sessionId: session.id,
          prompt,
          researchPlan,
          enableMcpBridge: body?.enableMcpBridge === true,
          mcpServerUrl: new URL("/api/mcp", c.req.url).toString(),
          mode: body?.mode === "max" ? "max" : "standard",
          visualization: body?.visualization === "auto" ? "auto" : "off",
          usePlanReview,
        })
        .catch((err: unknown) => {
          console.error(`Research pipeline failed for session ${session.id}:`, err);
        }),
    );
  } catch (err) {
    console.error("Failed to dispatch research agent:", err);
    // Update session to failed if we can't even reach the agent
    await db
      .update(researchSessions)
      .set({
        status: "failed",
        errorMessage:
          err instanceof Error ? err.message : "Failed to dispatch agent",
      })
      .where(eq(researchSessions.id, session.id));

    return c.json(
      { error: "Failed to start research pipeline", sessionId: session.id },
      500,
    );
  }

  return c.json(
    { sessionId: session.id, status: usePlanReview ? "planning" : "researching", topic },
    202,
  );
});

// ---------------------------------------------------------------------------
// POST /:id/approve-plan — approve the drafted plan and release the run (gate c)
// ---------------------------------------------------------------------------

researchRouter.post("/:id/approve-plan", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid session ID" }, 400);

  try {
    const agent = await getAgentByName<Env, ResearchAgent>(
      c.env.RESEARCH_AGENT as any,
      `research-${id}`,
    );
    await agent.approvePlan(id);
    return c.json({ success: true, sessionId: id, status: "researching" }, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to approve plan";
    const status = message.includes("not awaiting") || message.includes("not found") ? 409 : 500;
    return c.json({ success: false, error: message }, status);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/request-changes — re-plan with homeowner feedback (gate c loop)
// ---------------------------------------------------------------------------

researchRouter.post("/:id/request-changes", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid session ID" }, 400);

  const body = await c.req.json<{ feedback?: string }>().catch(() => ({}) as { feedback?: string });
  const feedback = body?.feedback?.trim();
  if (!feedback) {
    return c.json({ error: "feedback is required" }, 400);
  }

  try {
    const agent = await getAgentByName<Env, ResearchAgent>(
      c.env.RESEARCH_AGENT as any,
      `research-${id}`,
    );
    await agent.revisePlan(id, feedback);
    return c.json({ success: true, sessionId: id, status: "planning" }, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to request plan changes";
    const status = message.includes("not awaiting") || message.includes("not found") ? 409 : 500;
    return c.json({ success: false, error: message }, status);
  }
});

// ---------------------------------------------------------------------------
// POST /backfill — Seed pre-researched content directly (no Gemini pipeline)
// ---------------------------------------------------------------------------

researchRouter.post("/backfill", async (c) => {
  const body = await c.req.json<{
    topic?: string;
    prompt?: string;
    researchPlan?: string;
    markdown?: string;
    visualizerHtml?: string;
  }>();

  const topic = body?.topic?.trim();
  const prompt = body?.prompt?.trim() || null;
  const researchPlanText = body?.researchPlan?.trim() || null;
  const markdown = body?.markdown?.trim();
  const visualizerHtml = body?.visualizerHtml?.trim() || null;

  if (!topic || topic.length < 5) {
    return c.json(
      { error: "Topic is required and must be at least 5 characters" },
      400,
    );
  }

  if (!markdown || markdown.length < 100) {
    return c.json(
      { error: "Markdown content is required and must be at least 100 characters" },
      400,
    );
  }

  const db = drizzle(c.env.DB);

  // Create the D1 record in "embedding" status since we skip the Gemini phase
  const [session] = await db
    .insert(researchSessions)
    .values({
      topic,
      prompt,
      researchPlan: researchPlanText,
      status: "embedding",
    })
    .returning();

  try {
    // ── Save markdown to R2 ──────────────────────────────────────────────
    const mdKey = r2MarkdownKey(session.id);
    await c.env.ARTIFACTS_BUCKET.put(mdKey, markdown, {
      httpMetadata: { contentType: "text/markdown" },
      customMetadata: { sessionId: String(session.id), topic, backfill: "true" },
    });

    await db
      .update(researchSessions)
      .set({ r2MarkdownKey: mdKey })
      .where(eq(researchSessions.id, session.id));

    // ── Chunk + embed into Vectorize ─────────────────────────────────────
    const { chunks } = chunkMarkdown(markdown);
    const embedResult = await embedAndUpsertChunks(c.env, chunks, session.id);

    await db
      .update(researchSessions)
      .set({
        vectorNamespace: embedResult.namespace,
        chunkCount: embedResult.chunkCount,
      })
      .where(eq(researchSessions.id, session.id));

    // ── Save visualizer to R2 (if provided) ──────────────────────────────
    let webappKey: string | null = null;
    if (visualizerHtml) {
      webappKey = r2WebappKey(session.id);
      await c.env.ARTIFACTS_BUCKET.put(webappKey, visualizerHtml, {
        httpMetadata: { contentType: "text/html" },
        customMetadata: { sessionId: String(session.id), topic, backfill: "true" },
      });
    }

    // ── Mark complete ────────────────────────────────────────────────────
    await db
      .update(researchSessions)
      .set({
        status: "complete",
        r2WebappKey: webappKey,
        completedAt: new Date(),
      })
      .where(eq(researchSessions.id, session.id));

    return c.json(
      {
        sessionId: session.id,
        status: "complete",
        topic,
        chunkCount: embedResult.chunkCount,
        hasVisualizer: !!visualizerHtml,
      },
      201,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await db
      .update(researchSessions)
      .set({ status: "failed", errorMessage })
      .where(eq(researchSessions.id, session.id));

    return c.json(
      { error: "Backfill failed", detail: errorMessage, sessionId: session.id },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET / — List all research sessions
// ---------------------------------------------------------------------------

researchRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);

  const sessions = await db
    .select()
    .from(researchSessions)
    .orderBy(desc(researchSessions.createdAt));

  return c.json({ sessions });
});

// ---------------------------------------------------------------------------
// GET /:id — Get single session detail
// ---------------------------------------------------------------------------

researchRouter.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid session ID" }, 400);

  const db = drizzle(c.env.DB);
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, id))
    .limit(1);

  if (!session) return c.json({ error: "Session not found" }, 404);

  return c.json({ session });
});

// ---------------------------------------------------------------------------
// GET /:id/markdown — Stream raw markdown from R2
// ---------------------------------------------------------------------------

researchRouter.get("/:id/markdown", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid session ID" }, 400);

  const db = drizzle(c.env.DB);
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, id))
    .limit(1);

  if (!session) return c.json({ error: "Session not found" }, 404);
  if (!session.r2MarkdownKey) {
    return c.json({ error: "Markdown not yet available" }, 404);
  }

  const r2Object = await c.env.ARTIFACTS_BUCKET.get(session.r2MarkdownKey);
  if (!r2Object) return c.json({ error: "Markdown file not found in R2" }, 404);

  const markdown = await r2Object.text();
  return c.json({ markdown, topic: session.topic });
});

// ---------------------------------------------------------------------------
// GET /:id/visualizer — Serve via Dynamic Worker sandbox
// ---------------------------------------------------------------------------

researchRouter.get("/:id/visualizer", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid session ID" }, 400);

  const db = drizzle(c.env.DB);
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, id))
    .limit(1);

  if (!session) return c.json({ error: "Session not found" }, 404);
  if (!session.r2WebappKey) {
    return c.json({ error: "Visualizer not yet generated" }, 404);
  }

  const r2Object = await c.env.ARTIFACTS_BUCKET.get(session.r2WebappKey);
  if (!r2Object) {
    return c.json({ error: "Visualizer file not found in R2" }, 404);
  }

  const htmlCode = await r2Object.text();

  // Attempt to serve via Dynamic Worker sandbox if LOADER binding exists
  if (c.env.LOADER) {
    try {
      // Wrap the HTML in a minimal Worker module
      const workerCode = `export default {
        async fetch() {
          return new Response(${JSON.stringify(htmlCode)}, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy": "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com; frame-ancestors 'self'; navigate-to 'none';",
              "X-Frame-Options": "SAMEORIGIN",
              "X-Content-Type-Options": "nosniff",
            }
          });
        }
      };`;

      const dynamicWorker = await (c.env.LOADER as any).load({
        main: workerCode,
      });
      return dynamicWorker.fetch(
        new Request("http://sandbox.internal/"),
      ) as Response;
    } catch (err) {
      console.error("Dynamic Worker failed, falling back to direct serve:", err);
    }
  }

  // Fallback: serve HTML directly with strict CSP headers
  return new Response(htmlCode, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com; frame-ancestors 'self'; navigate-to 'none';",
      "X-Frame-Options": "SAMEORIGIN",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// ---------------------------------------------------------------------------
// DELETE /:id — Delete session + R2 objects + Vectorize vectors
// ---------------------------------------------------------------------------

researchRouter.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid session ID" }, 400);

  const db = drizzle(c.env.DB);
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, id))
    .limit(1);

  if (!session) return c.json({ error: "Session not found" }, 404);

  // Delete R2 objects
  const deletePromises: Promise<void>[] = [];
  if (session.r2MarkdownKey) {
    deletePromises.push(c.env.ARTIFACTS_BUCKET.delete(session.r2MarkdownKey));
  }
  if (session.r2WebappKey) {
    deletePromises.push(c.env.ARTIFACTS_BUCKET.delete(session.r2WebappKey));
  }

  // Delete Vectorize vectors
  if (session.chunkCount && session.chunkCount > 0) {
    deletePromises.push(deleteSessionVectors(c.env, id, session.chunkCount));
  }

  await Promise.allSettled(deletePromises);

  // Delete D1 record
  await db
    .delete(researchSessions)
    .where(eq(researchSessions.id, id));

  return c.json({ deleted: true, sessionId: id });
});
