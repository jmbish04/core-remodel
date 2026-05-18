import { homeownerMessages, images, visitorEvents, visitorSessions } from "@backend/db";
import { desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const adminRouter = new Hono<{ Bindings: Env }>();

function toIsoDate(value: Date | string | number | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

adminRouter.get("/overview", async (c) => {
  try {
    const db = drizzle(c.env.DB);

    const [sessionRows, eventRows, messageRows, uploadRows] = await Promise.all([
      db.select().from(visitorSessions).orderBy(desc(visitorSessions.lastSeenAt)).limit(200).all(),
      db.select().from(visitorEvents).orderBy(desc(visitorEvents.datetimeCreated)).limit(800).all(),
      db
        .select()
        .from(homeownerMessages)
        .orderBy(desc(homeownerMessages.datetimeCreated))
        .limit(100)
        .all(),
      db.select().from(images).orderBy(desc(images.datetimeCreated)).limit(100).all(),
    ]);

    const pageViews = eventRows.filter((event) => event.eventType === "page_view").length;
    const clicks = eventRows.filter((event) => event.eventType === "click").length;
    const exits = eventRows.filter((event) => event.eventType === "page_exit");

    const totalTimeMs = exits.reduce((sum, event) => sum + (event.durationMs || 0), 0);
    const avgTimeSeconds = exits.length > 0 ? Math.round(totalTimeMs / exits.length / 1000) : 0;

    const pathCounts = new Map<string, number>();
    for (const event of eventRows) {
      if (event.eventType !== "page_view") continue;
      const path = event.path || "/";
      pathCounts.set(path, (pathCounts.get(path) || 0) + 1);
    }

    const topPaths = Array.from(pathCounts.entries())
      .map(([path, views]) => ({ path, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 20);

    const recentUploads = uploadRows.slice(0, 20).map((image) => ({
      id: image.id,
      name: image.displayName,
      category: image.photoCategory,
      roomType: image.roomType,
      createdAt: toIsoDate(image.datetimeCreated),
    }));

    return c.json({
      success: true,
      summary: {
        visitors: sessionRows.length,
        pageViews,
        clicks,
        avgTimeSeconds,
        messageCount: messageRows.length,
        uploadCount: uploadRows.length,
      },
      topPaths,
      sessions: sessionRows.map((session) => ({
        ...session,
        firstSeenAt: toIsoDate(session.firstSeenAt),
        lastSeenAt: toIsoDate(session.lastSeenAt),
      })),
      recentEvents: eventRows.slice(0, 200).map((event) => ({
        ...event,
        datetimeCreated: toIsoDate(event.datetimeCreated),
      })),
      messages: messageRows.map((message) => ({
        ...message,
        datetimeCreated: toIsoDate(message.datetimeCreated),
        datetimeUpdated: toIsoDate(message.datetimeUpdated),
        expiresAt: toIsoDate(message.expiresAt),
      })),
      recentUploads,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load admin analytics",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { adminRouter };
