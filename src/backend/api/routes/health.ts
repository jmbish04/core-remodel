/**
 * @fileoverview Health monitoring API routes
 */

import { healthChecks } from "@backend/db";
import { runHealthScreen } from "@backend/services/health/screen";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const healthRouter = new Hono<{ Bindings: Env }>();

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
