/**
 * @fileoverview Health monitoring API routes
 */

import { healthChecks } from "@backend/db";
import {
  getHealthCatalogue,
  getLatestHealthSession,
  listHealthSessions,
  runHealthSession,
} from "@backend/services/health/run";
import { runHealthScreen } from "@backend/services/health/screen";
import { isRequestAuthenticated } from "@backend/utils/access";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const healthRouter = new Hono<{ Bindings: Env }>();

/**
 * The full-catalogue endpoints (0028) are ADMIN-ONLY.
 *
 * Unlike the bare `GET /api/health` liveness ping — which stays public so
 * external uptime monitors keep working — a session runs ~50 probes and its
 * results name internal tables, bindings and failure modes. That is a system map,
 * so it sits behind the same `/admin` cookie/bearer gate as the page.
 */
async function requireAdmin(c: { req: { raw: Request }; env: Env }): Promise<Response | null> {
  if (await isRequestAuthenticated(c.req.raw, c.env)) return null;
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

// POST /api/health/session — run every registered probe now, persist one
// `health_results` row per probe under a shared session_uuid, return the session.
// 200 even when probes fail (the session itself succeeded) — read `overall`.
healthRouter.post("/session", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  try {
    const trigger = c.req.query("trigger") === "mcp" ? "mcp" : "ui";
    return c.json(await runHealthSession(c.env, trigger), 200);
  } catch (error) {
    console.error("[api/health] session run failed:", error);
    return c.json({ error: "Health session failed" }, 500);
  }
});

// GET /api/health/session/latest — the last persisted session, for first paint
// and for the header badge. Cheap: one grouped read, no probing.
healthRouter.get("/session/latest", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  try {
    const session = await getLatestHealthSession(c.env);
    return c.json({ session }, 200);
  } catch (error) {
    console.error("[api/health] latest session read failed:", error);
    return c.json({ error: "Failed to read latest health session" }, 500);
  }
});

// GET /api/health/sessions — recent sessions, newest first.
healthRouter.get("/sessions", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "20", 10) || 20, 1), 100);
  try {
    return c.json({ sessions: await listHealthSessions(c.env, limit) }, 200);
  } catch (error) {
    console.error("[api/health] session list failed:", error);
    return c.json({ error: "Failed to list health sessions" }, 500);
  }
});

// GET /api/health/catalogue — every registered test with its full runbook
// (what success/failure means, troubleshooting, playbook, binding types).
healthRouter.get("/catalogue", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  try {
    return c.json({ groups: await getHealthCatalogue(c.env) }, 200);
  } catch (error) {
    console.error("[api/health] catalogue read failed:", error);
    return c.json({ error: "Failed to read health catalogue" }, 500);
  }
});

// GET /api/health/badge — the minimal roll-up behind the header badge. Admin-gated
// like the rest, but deliberately tiny: status + counts + when, nothing else.
healthRouter.get("/badge", async (c) => {
  if (!(await isRequestAuthenticated(c.req.raw, c.env))) {
    return c.json({ status: null }, 200);
  }
  try {
    const session = await getLatestHealthSession(c.env);
    if (!session) return c.json({ status: null }, 200);
    return c.json(
      {
        status: session.overall,
        counts: session.counts,
        timestamp: session.timestamp,
      },
      200,
    );
  } catch (error) {
    console.error("[api/health] badge read failed:", error);
    return c.json({ status: null }, 200);
  }
});

// POST /api/health/run — the on-demand screen behind the /health page's button.
// Actively probes every core binding (D1, TESLA_DB, KV, R2, AI), records one
// health_checks row per service, and returns the per-service results. Public,
// like GET /api/health; the probes are bounded and free. Returns 200 even when a
// service is down (the screen itself succeeded) — read `status` from the body.
healthRouter.post("/run", async (c) => {
  try {
    const screen = await runHealthScreen(c.env);
    return c.json(screen, 200);
  } catch (error) {
    console.error("Health screen error:", error);
    return c.json(
      { status: "down", timestamp: new Date().toISOString(), error: "Health screen failed" },
      503,
    );
  }
});

// GET /api/health
healthRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const startTime = Date.now();

  try {
    // Test database connection
    await db.select().from(healthChecks).limit(1);
    const dbResponseTime = Date.now() - startTime;

    // Get latest health check for each service
    const allChecks = await db
      .select()
      .from(healthChecks)
      .orderBy(desc(healthChecks.timestamp))
      .limit(100);

    const latestChecks = allChecks.reduce(
      (acc, check) => {
        if (!acc[check.serviceName]) {
          acc[check.serviceName] = check;
        }
        return acc;
      },
      {} as Record<string, (typeof allChecks)[0]>,
    );

    // Determine overall status
    const statuses = Object.values(latestChecks).map((c) => c.status);
    let overallStatus = "healthy";

    if (statuses.includes("down")) {
      overallStatus = "down";
    } else if (statuses.includes("degraded")) {
      overallStatus = "degraded";
    }

    // Record this health check
    await db.insert(healthChecks).values({
      serviceName: "api",
      status: "healthy",
      responseTime: dbResponseTime,
      timestamp: new Date(),
    });

    return c.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: latestChecks,
      responseTime: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Health check error:", error);
    return c.json(
      {
        status: "down",
        timestamp: new Date().toISOString(),
        error: "Health check failed",
      },
      503,
    );
  }
});

// GET /api/health/history
healthRouter.get("/history", async (c) => {
  const db = drizzle(c.env.DB);
  const service = c.req.query("service");
  const limit = parseInt(c.req.query("limit") || "100");

  try {
    const history = service
      ? await db
          .select()
          .from(healthChecks)
          .where(eq(healthChecks.serviceName, service))
          .orderBy(desc(healthChecks.timestamp))
          .limit(limit)
      : await db.select().from(healthChecks).orderBy(desc(healthChecks.timestamp)).limit(limit);

    return c.json({ history });
  } catch (error) {
    console.error("Error fetching health history:", error);
    return c.json({ error: "Failed to fetch health history" }, 500);
  }
});

export { healthRouter };
