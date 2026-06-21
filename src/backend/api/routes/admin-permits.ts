import { Hono } from "hono";
import {
  closePermit,
  getPermitContactsInsights,
  getPermitDashboard,
  getPermitDetail,
  markPermitViewed,
  runPermitSync,
} from "@/services/dbi/permits-sync";

const adminPermitsRouter = new Hono<{ Bindings: Env }>();

adminPermitsRouter.get("/", async (c) => {
  try {
    const dashboard = await getPermitDashboard(c.env);
    const summary = {
      runCount: dashboard.latestRuns.length,
      recordCount: dashboard.latestRecords.length,
      contactCount: dashboard.contacts.length,
      contactActivityCount: dashboard.contactActivity.length,
      propertyPermitCount: dashboard.propertyPermits.length,
      needsReviewCount: dashboard.propertyPermits.filter(
        (row) => row.needsReview,
      ).length,
      recentErrors: dashboard.latestRuns
        .filter((run) => run.status === "error")
        .slice(0, 5),
    };

    return c.json({
      success: true,
      summary,
      ...dashboard,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load permits dashboard",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

adminPermitsRouter.get("/property/:permitIdentifier", async (c) => {
  try {
    const permitIdentifier = decodeURIComponent(
      c.req.param("permitIdentifier"),
    );
    const detail = await getPermitDetail(c.env, permitIdentifier);
    if (!detail) {
      return c.json({ error: "Permit not found" }, 404);
    }
    return c.json({ success: true, detail });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load permit detail",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

adminPermitsRouter.post("/property/:permitIdentifier/viewed", async (c) => {
  try {
    const permitIdentifier = decodeURIComponent(
      c.req.param("permitIdentifier"),
    );
    const result = await markPermitViewed(c.env, permitIdentifier);
    return c.json({ success: true, result });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update permit view state",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

adminPermitsRouter.post("/property/:permitIdentifier/close", async (c) => {
  try {
    const permitIdentifier = decodeURIComponent(
      c.req.param("permitIdentifier"),
    );
    const body = (await c.req.json().catch(() => ({}))) as { note?: string };
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) {
      return c.json({ error: "A closing note is required" }, 400);
    }
    const detail = await closePermit(c.env, permitIdentifier, note, "homeowner");
    if (!detail) {
      return c.json({ error: "Permit not found" }, 404);
    }
    return c.json({ success: true, detail });
  } catch (error) {
    return c.json(
      {
        error: "Failed to close permit",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

adminPermitsRouter.get("/contacts", async (c) => {
  try {
    const dashboard = await getPermitContactsInsights(c.env);
    return c.json({ success: true, ...dashboard });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load contractor permit intelligence",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

adminPermitsRouter.post("/sync", async (c) => {
  try {
    const result = await runPermitSync(c.env);
    const dashboard = await getPermitDashboard(c.env);

    return c.json({
      success: true,
      result,
      dashboard,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to run permits sync",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { adminPermitsRouter };
