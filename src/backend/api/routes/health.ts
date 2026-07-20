/**
 * @fileoverview Health monitoring API routes
 */

import { healthChecks } from "@backend/db";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const healthRouter = new Hono<{ Bindings: Env }>();

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

// GET /api/health/billing
// Durable Object billing-guard status for a frontend banner. Returns the
// latest guard row plus any currently-firing per-namespace offenders so the UI
// can shout when a DO is burning row reads (the cf_agents_schedules incident).
healthRouter.get("/billing", async (c) => {
  const db = drizzle(c.env.DB);
  try {
    const rows = await db
      .select()
      .from(healthChecks)
      .orderBy(desc(healthChecks.timestamp))
      .limit(200);

    const guard = rows.find((r) => r.serviceName === "durable-object-billing");
    // Only the most recent row per offending namespace service.
    const offenders: typeof rows = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (
        r.serviceName.startsWith("durable-object-billing:") &&
        r.status === "down" &&
        !seen.has(r.serviceName)
      ) {
        seen.add(r.serviceName);
        offenders.push(r);
      }
    }

    return c.json({
      status: guard?.status ?? "unknown",
      lastChecked: guard?.timestamp ?? null,
      message: guard?.errorMessage ?? null,
      offenders: offenders.map((o) => ({
        service: o.serviceName,
        message: o.errorMessage,
        at: o.timestamp,
      })),
    });
  } catch (error) {
    console.error("Billing health check error:", error);
    return c.json({ error: "Failed to fetch billing health" }, 500);
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
